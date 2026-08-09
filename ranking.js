'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

const TIME_ZONE = 'America/Sao_Paulo';
const KILL_RP = 10;
const ROUND_RP = 3;
const PLACE_BONUS = { 1: 15, 2: 8, 3: 5 };

function saoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}

function currentWeekStart(date = new Date()) {
  const p = saoPauloDateParts(date);
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  const base = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const backToMonday = (weekday + 6) % 7;
  base.setUTCDate(base.getUTCDate() - backToMonday);
  return base.toISOString().slice(0, 10);
}

function nextWeekStart(weekStart = currentWeekStart()) {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function cleanDisplayName(name) {
  return String(name || 'Player').replace(/[\x00-\x1F\x7F<>]/g, '').trim().slice(0, 20) || 'Player';
}

class WeeklyRanking {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
    this.secret = options.secret || process.env.RANKING_SECRET || 'deadzone-ranking-local-fallback';
    this.pool = null;
    this.mode = 'memory';
    this.memory = new Map();
    this.roundAwards = new Set();
    this.ready = false;
  }

  playerKey(rawToken) {
    const token = String(rawToken || '').trim() || crypto.randomBytes(24).toString('hex');
    return crypto.createHmac('sha256', this.secret).update(token).digest('hex');
  }

  async init() {
    if (!this.databaseUrl) {
      this.ready = true;
      console.log('[ranking] DATABASE_URL ausente: ranking semanal em memória (não persiste após restart).');
      return;
    }
    const isLocal = /localhost|127\.0\.0\.1/.test(this.databaseUrl);
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 7000
    });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS weekly_rankings (
          week_start date NOT NULL,
          player_key varchar(64) NOT NULL,
          display_name varchar(32) NOT NULL,
          ranking_points integer NOT NULL DEFAULT 0,
          kills integer NOT NULL DEFAULT 0,
          deaths integer NOT NULL DEFAULT 0,
          rounds_played integer NOT NULL DEFAULT 0,
          round_wins integer NOT NULL DEFAULT 0,
          second_places integer NOT NULL DEFAULT 0,
          third_places integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (week_start, player_key)
        );
        CREATE INDEX IF NOT EXISTS idx_weekly_rankings_board
          ON weekly_rankings (week_start, ranking_points DESC, kills DESC, round_wins DESC, updated_at ASC);
        CREATE TABLE IF NOT EXISTS weekly_round_awards (
          week_start date NOT NULL,
          round_key varchar(80) NOT NULL,
          player_key varchar(64) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (week_start, round_key, player_key)
        );
      `);
      this.mode = 'postgres';
      this.ready = true;
      console.log('[ranking] PostgreSQL conectado. Ranking semanal persistente ativo.');
    } catch (err) {
      console.error('[ranking] Falha ao iniciar PostgreSQL; usando memória:', err.message);
      try { await this.pool.end(); } catch {}
      this.pool = null;
      this.mode = 'memory';
      this.ready = true;
    }
  }

  isPersistent() { return this.mode === 'postgres'; }

  memoryKey(weekStart, playerKey) { return `${weekStart}:${playerKey}`; }

  getMemoryRow(weekStart, playerKey, displayName) {
    const key = this.memoryKey(weekStart, playerKey);
    let row = this.memory.get(key);
    if (!row) {
      row = {
        week_start: weekStart, player_key: playerKey, display_name: cleanDisplayName(displayName),
        ranking_points: 0, kills: 0, deaths: 0, rounds_played: 0,
        round_wins: 0, second_places: 0, third_places: 0, updated_at: Date.now()
      };
      this.memory.set(key, row);
    } else if (displayName) row.display_name = cleanDisplayName(displayName);
    return row;
  }

  async ensurePlayer(player) {
    if (!player || !player.rankingKey) return;
    const week = currentWeekStart();
    const name = cleanDisplayName(player.name);
    if (this.mode === 'memory') { this.getMemoryRow(week, player.rankingKey, name); return; }
    await this.pool.query(`
      INSERT INTO weekly_rankings (week_start, player_key, display_name)
      VALUES ($1,$2,$3)
      ON CONFLICT (week_start, player_key)
      DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now()
    `, [week, player.rankingKey, name]);
  }

  async updateName(player) { return this.ensurePlayer(player); }

  async recordKill(player) {
    if (!player || !player.rankingKey) return;
    const week = currentWeekStart();
    const name = cleanDisplayName(player.name);
    if (this.mode === 'memory') {
      const r = this.getMemoryRow(week, player.rankingKey, name);
      r.ranking_points += KILL_RP; r.kills += 1; r.updated_at = Date.now();
      return;
    }
    await this.pool.query(`
      INSERT INTO weekly_rankings (week_start, player_key, display_name, ranking_points, kills)
      VALUES ($1,$2,$3,$4,1)
      ON CONFLICT (week_start, player_key)
      DO UPDATE SET display_name=EXCLUDED.display_name,
                    ranking_points=weekly_rankings.ranking_points + $4,
                    kills=weekly_rankings.kills + 1,
                    updated_at=now()
    `, [week, player.rankingKey, name, KILL_RP]);
  }

  async recordDeath(player) {
    if (!player || !player.rankingKey) return;
    const week = currentWeekStart();
    const name = cleanDisplayName(player.name);
    if (this.mode === 'memory') {
      const r = this.getMemoryRow(week, player.rankingKey, name);
      r.deaths += 1; r.updated_at = Date.now();
      return;
    }
    await this.pool.query(`
      INSERT INTO weekly_rankings (week_start, player_key, display_name, deaths)
      VALUES ($1,$2,$3,1)
      ON CONFLICT (week_start, player_key)
      DO UPDATE SET display_name=EXCLUDED.display_name,
                    deaths=weekly_rankings.deaths + 1,
                    updated_at=now()
    `, [week, player.rankingKey, name]);
  }

  async recordRound(roundKey, participants) {
    const week = currentWeekStart();
    const valid = (participants || []).filter(p => p && p.rankingKey);
    valid.sort((a,b) => (b.roundKills || 0) - (a.roundKills || 0) || (a.roundDeaths || 0) - (b.roundDeaths || 0) || a.id - b.id);
    for (let i = 0; i < valid.length; i++) {
      const p = valid[i];
      const place = i + 1;
      const bonus = PLACE_BONUS[place] || 0;
      const award = ROUND_RP + bonus;
      const name = cleanDisplayName(p.name);
      const awardKey = `${week}:${roundKey}:${p.rankingKey}`;
      if (this.mode === 'memory') {
        if (this.roundAwards.has(awardKey)) continue;
        this.roundAwards.add(awardKey);
        const r = this.getMemoryRow(week, p.rankingKey, name);
        r.ranking_points += award;
        r.rounds_played += 1;
        if (place === 1) r.round_wins += 1;
        if (place === 2) r.second_places += 1;
        if (place === 3) r.third_places += 1;
        r.updated_at = Date.now();
        continue;
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(`
          INSERT INTO weekly_round_awards (week_start, round_key, player_key)
          VALUES ($1,$2,$3)
          ON CONFLICT DO NOTHING
          RETURNING player_key
        `, [week, String(roundKey), p.rankingKey]);
        if (inserted.rowCount) {
          await client.query(`
            INSERT INTO weekly_rankings
              (week_start, player_key, display_name, ranking_points, rounds_played, round_wins, second_places, third_places)
            VALUES ($1,$2,$3,$4,1,$5,$6,$7)
            ON CONFLICT (week_start, player_key)
            DO UPDATE SET display_name=EXCLUDED.display_name,
                          ranking_points=weekly_rankings.ranking_points + EXCLUDED.ranking_points,
                          rounds_played=weekly_rankings.rounds_played + 1,
                          round_wins=weekly_rankings.round_wins + EXCLUDED.round_wins,
                          second_places=weekly_rankings.second_places + EXCLUDED.second_places,
                          third_places=weekly_rankings.third_places + EXCLUDED.third_places,
                          updated_at=now()
          `, [week, p.rankingKey, name, award, place === 1 ? 1 : 0, place === 2 ? 1 : 0, place === 3 ? 1 : 0]);
        }
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally { client.release(); }
    }
  }

  async snapshot(player, limit = 10) {
    const week = currentWeekStart();
    const topLimit = Math.max(3, Math.min(25, limit | 0 || 10));
    if (this.mode === 'memory') {
      const rows = [...this.memory.values()].filter(r => r.week_start === week)
        .sort((a,b) => b.ranking_points - a.ranking_points || b.kills - a.kills || b.round_wins - a.round_wins || a.updated_at - b.updated_at);
      const top = rows.slice(0, topLimit).map((r,i) => this.publicRow(r, i + 1));
      const idx = player && player.rankingKey ? rows.findIndex(r => r.player_key === player.rankingKey) : -1;
      return { weekStart: week, nextWeekStart: nextWeekStart(week), persistent: false, rules: { kill: KILL_RP, round: ROUND_RP, first: 15, second: 8, third: 5 }, top, me: idx >= 0 ? this.publicRow(rows[idx], idx + 1) : null };
    }
    const topRes = await this.pool.query(`
      SELECT display_name, ranking_points, kills, deaths, rounds_played, round_wins, second_places, third_places,
             ROW_NUMBER() OVER (ORDER BY ranking_points DESC, kills DESC, round_wins DESC, updated_at ASC)::int AS rank
      FROM weekly_rankings WHERE week_start=$1
      ORDER BY ranking_points DESC, kills DESC, round_wins DESC, updated_at ASC
      LIMIT $2
    `, [week, topLimit]);
    let me = null;
    if (player && player.rankingKey) {
      const meRes = await this.pool.query(`
        WITH ranked AS (
          SELECT player_key, display_name, ranking_points, kills, deaths, rounds_played, round_wins, second_places, third_places,
                 ROW_NUMBER() OVER (ORDER BY ranking_points DESC, kills DESC, round_wins DESC, updated_at ASC)::int AS rank
          FROM weekly_rankings WHERE week_start=$1
        )
        SELECT * FROM ranked WHERE player_key=$2
      `, [week, player.rankingKey]);
      if (meRes.rows[0]) me = this.publicRow(meRes.rows[0], meRes.rows[0].rank);
    }
    return { weekStart: week, nextWeekStart: nextWeekStart(week), persistent: true, rules: { kill: KILL_RP, round: ROUND_RP, first: 15, second: 8, third: 5 }, top: topRes.rows.map(r => this.publicRow(r, r.rank)), me };
  }

  publicRow(r, rank) {
    return {
      rank: Number(rank),
      name: r.display_name,
      rp: Number(r.ranking_points || 0),
      kills: Number(r.kills || 0),
      deaths: Number(r.deaths || 0),
      rounds: Number(r.rounds_played || 0),
      wins: Number(r.round_wins || 0),
      seconds: Number(r.second_places || 0),
      thirds: Number(r.third_places || 0)
    };
  }
}

module.exports = { WeeklyRanking, currentWeekStart, nextWeekStart, KILL_RP, ROUND_RP, PLACE_BONUS };
