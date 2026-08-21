'use strict';

const { Pool } = require('pg');

const SEASON = Object.freeze({
  id: 'S1-2026-CASA-DA-VO',
  name: 'Temporada 1: Casa da Vó',
  startsAt: '2026-08-01',
  endsAt: '2026-09-30',
  theme: 'Casa brasileira, caos doméstico e Alpes'
});

function cleanName(name) {
  return String(name || 'Player').replace(/[\x00-\x1F\x7F<>]/g, '').trim().slice(0, 20) || 'Player';
}

function safeWeaponStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/^[a-z0-9_-]{1,32}$/i.test(k)) out[k] = Math.max(0, Number(v) | 0);
  }
  return out;
}

class Progression {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
    this.pool = null;
    this.mode = 'memory';
    this.memory = new Map();
    this.season = SEASON;
  }

  async init() {
    if (!this.databaseUrl) {
      console.log('[progression] DATABASE_URL ausente: perfil em memória.');
      return;
    }
    const isLocal = /localhost|127\.0\.0\.1/.test(this.databaseUrl);
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 7000
    });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS player_profiles (
          player_key varchar(64) PRIMARY KEY,
          display_name varchar(32) NOT NULL,
          level integer NOT NULL DEFAULT 1,
          lifetime_kills integer NOT NULL DEFAULT 0,
          lifetime_deaths integer NOT NULL DEFAULT 0,
          matches_played integer NOT NULL DEFAULT 0,
          match_wins integer NOT NULL DEFAULT 0,
          best_combo integer NOT NULL DEFAULT 0,
          weapon_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
          first_seen timestamptz NOT NULL DEFAULT now(),
          last_seen timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_player_profiles_last_seen ON player_profiles(last_seen DESC);
      `);
      this.mode = 'postgres';
      console.log('[progression] PostgreSQL conectado. Perfil persistente ativo.');
    } catch (err) {
      console.error('[progression] Falha no PostgreSQL; usando memória:', err.message);
      try { await this.pool.end(); } catch {}
      this.pool = null;
      this.mode = 'memory';
    }
  }

  isPersistent() { return this.mode === 'postgres'; }

  rowFor(player) {
    if (!player || !player.rankingKey) return null;
    let row = this.memory.get(player.rankingKey);
    if (!row) {
      row = {
        player_key: player.rankingKey,
        display_name: cleanName(player.name),
        level: Math.max(1, player.level | 0),
        lifetime_kills: 0,
        lifetime_deaths: 0,
        matches_played: 0,
        match_wins: 0,
        best_combo: 0,
        weapon_stats: {},
        last_seen: Date.now()
      };
      this.memory.set(player.rankingKey, row);
    }
    return row;
  }

  async ensurePlayer(player) {
    if (!player || !player.rankingKey || player.isBot) return null;
    if (this.mode === 'memory') {
      const row = this.rowFor(player);
      row.display_name = cleanName(player.name);
      row.level = Math.max(row.level || 1, player.level | 0 || 1);
      row.last_seen = Date.now();
      return row;
    }
    await this.pool.query(`
      INSERT INTO player_profiles (player_key, display_name, level)
      VALUES ($1,$2,$3)
      ON CONFLICT (player_key) DO UPDATE
        SET display_name=EXCLUDED.display_name,
            level=GREATEST(player_profiles.level, EXCLUDED.level),
            last_seen=now()
    `, [player.rankingKey, cleanName(player.name), Math.max(1, player.level | 0)]);
    return this.getRow(player.rankingKey);
  }

  async getRow(playerKey) {
    if (!playerKey) return null;
    if (this.mode === 'memory') return this.memory.get(playerKey) || null;
    const r = await this.pool.query(`
      SELECT player_key, display_name, level, lifetime_kills, lifetime_deaths,
             matches_played, match_wins, best_combo, weapon_stats, last_seen
      FROM player_profiles WHERE player_key=$1
    `, [playerKey]);
    return r.rows[0] || null;
  }

  async updateIdentity(player) {
    return this.ensurePlayer(player);
  }

  async recordKill(player, weapon, combo = 1) {
    if (!player || !player.rankingKey || player.isBot) return;
    const weaponKey = /^[a-z0-9_-]{1,32}$/i.test(String(weapon || '')) ? String(weapon) : 'unknown';
    const c = Math.max(1, Math.min(99, combo | 0 || 1));
    if (this.mode === 'memory') {
      const row = this.rowFor(player);
      row.display_name = cleanName(player.name);
      row.level = Math.max(row.level || 1, player.level | 0 || 1);
      row.lifetime_kills += 1;
      row.best_combo = Math.max(row.best_combo, c);
      row.weapon_stats[weaponKey] = (row.weapon_stats[weaponKey] || 0) + 1;
      row.last_seen = Date.now();
      return;
    }
    await this.ensurePlayer(player);
    await this.pool.query(`
      UPDATE player_profiles
         SET display_name=$2,
             level=GREATEST(level,$3),
             lifetime_kills=lifetime_kills+1,
             best_combo=GREATEST(best_combo,$4),
             weapon_stats=jsonb_set(
               weapon_stats,
               ARRAY[$5],
               to_jsonb(COALESCE((weapon_stats->>$5)::int,0)+1),
               true
             ),
             last_seen=now()
       WHERE player_key=$1
    `, [player.rankingKey, cleanName(player.name), Math.max(1, player.level | 0), c, weaponKey]);
  }

  async recordDeath(player) {
    if (!player || !player.rankingKey || player.isBot) return;
    if (this.mode === 'memory') {
      const row = this.rowFor(player);
      row.lifetime_deaths += 1;
      row.last_seen = Date.now();
      return;
    }
    await this.ensurePlayer(player);
    await this.pool.query(`UPDATE player_profiles SET lifetime_deaths=lifetime_deaths+1,last_seen=now() WHERE player_key=$1`, [player.rankingKey]);
  }

  async recordRound(participants) {
    const valid = (participants || []).filter(p => p && p.rankingKey && !p.isBot);
    for (const p of valid) {
      const win = p.place === 1 ? 1 : 0;
      if (this.mode === 'memory') {
        const row = this.rowFor(p);
        row.matches_played += 1;
        row.match_wins += win;
        row.level = Math.max(row.level || 1, p.level | 0 || 1);
        row.last_seen = Date.now();
      } else {
        await this.pool.query(`
          INSERT INTO player_profiles (player_key, display_name, level, matches_played, match_wins)
          VALUES ($1,$2,$3,1,$4)
          ON CONFLICT (player_key) DO UPDATE
            SET display_name=EXCLUDED.display_name,
                level=GREATEST(player_profiles.level, EXCLUDED.level),
                matches_played=player_profiles.matches_played+1,
                match_wins=player_profiles.match_wins+EXCLUDED.match_wins,
                last_seen=now()
        `, [p.rankingKey, cleanName(p.name), Math.max(1, p.level | 0), win]);
      }
    }
  }

  challengeSnapshot(row) {
    const weapons = safeWeaponStats(row && row.weapon_stats);
    const variety = Object.values(weapons).filter(v => v > 0).length;
    const kills = Number(row && row.lifetime_kills) || 0;
    const matches = Number(row && row.matches_played) || 0;
    const wins = Number(row && row.match_wins) || 0;
    return [
      { key: 'kills10', label: 'Faça 10 eliminações', progress: Math.min(10, kills), target: 10, complete: kills >= 10 },
      { key: 'matches5', label: 'Complete 5 partidas', progress: Math.min(5, matches), target: 5, complete: matches >= 5 },
      { key: 'wins2', label: 'Vença 2 rodadas', progress: Math.min(2, wins), target: 2, complete: wins >= 2 },
      { key: 'arsenal3', label: 'Elimine com 3 armas diferentes', progress: Math.min(3, variety), target: 3, complete: variety >= 3 }
    ];
  }

  publicProfile(row, player) {
    const weapons = safeWeaponStats(row && row.weapon_stats);
    let favoriteWeapon = null, favoriteKills = -1;
    for (const [weapon, count] of Object.entries(weapons)) {
      if (count > favoriteKills) { favoriteWeapon = weapon; favoriteKills = count; }
    }
    return {
      displayName: cleanName((row && row.display_name) || (player && player.name)),
      level: Math.max(1, Number((row && row.level) || (player && player.level)) || 1),
      kills: Number(row && row.lifetime_kills) || 0,
      deaths: Number(row && row.lifetime_deaths) || 0,
      matches: Number(row && row.matches_played) || 0,
      wins: Number(row && row.match_wins) || 0,
      bestCombo: Number(row && row.best_combo) || 0,
      favoriteWeapon,
      weaponStats: weapons
    };
  }

  async snapshot(player) {
    if (!player || !player.rankingKey || player.isBot) return { persistent: this.isPersistent(), season: this.season, profile: null, challenges: [] };
    await this.ensurePlayer(player);
    const row = await this.getRow(player.rankingKey);
    return {
      persistent: this.isPersistent(),
      season: this.season,
      profile: this.publicProfile(row, player),
      challenges: this.challengeSnapshot(row)
    };
  }
}

module.exports = { Progression, SEASON };
