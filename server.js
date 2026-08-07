// server.js — Servidor autoritativo do DEADZONE (Node.js + ws)
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const full = path.join(__dirname, 'public', filePath);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(full);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// ==================== CONFIG ====================
const WORLD = { w: 1600, h: 1200 };
const MAX_HP = 100;
const RESPAWN_MS = 3000;
const KILL_REWARD = 50;   // pontos ganhos por kill
const DEATH_REWARD = 15;  // pontos de consolação ao morrer

// Arsenal DeadZone: Alpes Edition — cada arma tem dano e comportamento próprios.
const WEAPONS = {
  chinelo: { name: 'Chinelo',       emoji: '🩴', cost: 0,   damage: 22, cooldown: 260, speed: 17, range: 720, pellets: 1, tint: '#ff5fa2' },
  grito:   { name: 'Grito do Vado', emoji: '📢', cost: 0,   damage: 7,  cooldown: 520, speed: 26, range: 1500, pellets: 1, tint: '#7fe0ff', wave: true },
  escova:  { name: 'Escova',        emoji: '🪥', cost: 120, damage: 9,  cooldown: 90,  speed: 20, range: 640, pellets: 1, tint: '#ff3b52' },
  coco:    { name: 'Cocô',          emoji: '💩', cost: 280, damage: 16, cooldown: 620, speed: 12, range: 460, pellets: 5, spread: 0.4, tint: '#8a5a2b' },
  espada:  { name: 'Espada',        emoji: '⚔️', cost: 480, damage: 60, cooldown: 900, speed: 24, range: 1300, pellets: 1, tint: '#ffd23b' }
};

// ==================== MAPAS ====================
// Cada mapa tem uma lista de paredes (retângulos) que bloqueiam movimento e tiro.
const MAPS = [
  {
    name: 'A Nave',
    floor: '#2a2e3a',
    walls: [
      { x: 300, y: 200, w: 40, h: 300 },
      { x: 300, y: 200, w: 320, h: 40 },
      { x: 900, y: 300, w: 40, h: 400 },
      { x: 700, y: 700, w: 400, h: 40 },
      { x: 1200, y: 150, w: 40, h: 350 },
      { x: 200, y: 850, w: 500, h: 40 }
    ]
  },
  {
    name: 'Labirinto',
    floor: '#2e2a3a',
    walls: [
      { x: 250, y: 150, w: 40, h: 500 },
      { x: 500, y: 400, w: 40, h: 600 },
      { x: 750, y: 150, w: 40, h: 500 },
      { x: 1000, y: 400, w: 40, h: 600 },
      { x: 1250, y: 150, w: 40, h: 500 },
      { x: 250, y: 150, w: 300, h: 40 },
      { x: 750, y: 610, w: 300, h: 40 }
    ]
  },
  {
    name: 'Arena Aberta',
    floor: '#2a3a2e',
    walls: [
      { x: 400, y: 400, w: 160, h: 160 },
      { x: 1040, y: 400, w: 160, h: 160 },
      { x: 400, y: 700, w: 160, h: 160 },
      { x: 1040, y: 700, w: 160, h: 160 },
      { x: 720, y: 540, w: 160, h: 160 }
    ]
  },
  {
    name: 'Corredores',
    floor: '#3a2e2a',
    walls: [
      { x: 200, y: 300, w: 500, h: 40 },
      { x: 900, y: 300, w: 500, h: 40 },
      { x: 200, y: 600, w: 500, h: 40 },
      { x: 900, y: 600, w: 500, h: 40 },
      { x: 200, y: 900, w: 500, h: 40 },
      { x: 900, y: 900, w: 500, h: 40 },
      { x: 780, y: 150, w: 40, h: 900 }
    ]
  }
];

let currentMapIndex = Math.floor(Math.random() * MAPS.length);
function currentMap() { return MAPS[currentMapIndex]; }

// colisão ponto-em-retângulo com margem (raio do jogador/bala)
function hitsWall(x, y, r) {
  for (const wall of currentMap().walls) {
    if (x + r > wall.x && x - r < wall.x + wall.w &&
        y + r > wall.y && y - r < wall.y + wall.h) return true;
  }
  return false;
}

const players = new Map();
const bullets = [];
let events = [];
let chatLog = [];   // últimas mensagens de chat a distribuir neste tick
let nextId = 1;
let nextBulletId = 1;

function spawnPoint() {
  // acha um ponto que não esteja dentro de parede
  for (let i = 0; i < 50; i++) {
    const x = 60 + Math.random() * (WORLD.w - 120);
    const y = 60 + Math.random() * (WORLD.h - 120);
    if (!hitsWall(x, y, 20)) return { x, y };
  }
  return { x: 80, y: 80 };
}

function makePlayer(id, name) {
  const p = spawnPoint();
  return {
    id, name: name || ('P' + id),
    x: p.x, y: p.y, angle: 0,
    hp: MAX_HP, maxHp: MAX_HP, alive: true,
    weapon: 'chinelo',
    owned: { chinelo: true, grito: true },  // ambas grátis desde o início
    points: 0,                   // moeda pra comprar
    level: 1,                    // nível (informado pelo cliente, vem do localStorage)
    kills: 0, deaths: 0,
    lastShot: 0,
    lastSeen: Date.now(),        // heartbeat
    input: { up: false, down: false, left: false, right: false },
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
  };
}

// Buff por nível: cada nível dá um pouco mais de vida e dano.
function levelBuff(level) {
  const l = Math.max(1, level | 0);
  return {
    hp: MAX_HP + (l - 1) * 8,          // +8 HP por nível
    dmgMult: 1 + (l - 1) * 0.04        // +4% de dano por nível
  };
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = makePlayer(id, null);
  players.set(id, player);
  ws.playerId = id;

  ws.send(JSON.stringify({ type: 'init', id, world: WORLD, weapons: WEAPONS, map: currentMap(), killReward: KILL_REWARD }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const pl = players.get(id);
    if (!pl) return;
    pl.lastSeen = Date.now();

    switch (msg.type) {
      case 'setName':
        pl.name = String(msg.name || '').slice(0, 12) || pl.name;
        if (typeof msg.level === 'number') {
          pl.level = Math.max(1, Math.min(999, msg.level | 0));
          const buff = levelBuff(pl.level);
          pl.maxHp = buff.hp;
          if (pl.hp > pl.maxHp) pl.hp = pl.maxHp;
          else if (pl.hp === MAX_HP) pl.hp = pl.maxHp; // ainda cheio, sobe pro novo máximo
        }
        break;
      case 'input':
        if (pl.alive) { pl.input = msg.input; pl.angle = msg.angle; }
        break;
      case 'switchWeapon':
        if (WEAPONS[msg.weapon] && pl.owned[msg.weapon]) pl.weapon = msg.weapon;
        break;
      case 'buy':
        buyWeapon(pl, msg.weapon, ws);
        break;
      case 'attack':
        if (pl.alive) tryAttack(pl);
        break;
      case 'chat':
        handleChat(pl, msg.text);
        break;
      case 'pong':
        break; // resposta ao ping, já atualizou lastSeen
    }
  });

  ws.on('close', () => players.delete(id));
});

function buyWeapon(pl, weaponKey, ws) {
  const w = WEAPONS[weaponKey];
  if (!w) return;
  if (pl.owned[weaponKey]) return;               // já tem
  if (pl.points < w.cost) {                       // sem pontos
    ws.send(JSON.stringify({ type: 'buyResult', ok: false, reason: 'pontos insuficientes' }));
    return;
  }
  pl.points -= w.cost;
  pl.owned[weaponKey] = true;
  pl.weapon = weaponKey; // equipa automaticamente
  ws.send(JSON.stringify({ type: 'buyResult', ok: true, weapon: weaponKey }));
}

function handleChat(pl, text) {
  text = String(text || '').slice(0, 120).trim();
  if (!text) return;
  chatLog.push({ name: pl.name, color: pl.color, text });
}

function tryAttack(pl) {
  const w = WEAPONS[pl.weapon];
  const now = Date.now();
  if (now - pl.lastShot < w.cooldown) return;
  pl.lastShot = now;

  const pellets = w.pellets || 1;
  const dmg = Math.round(w.damage * levelBuff(pl.level).dmgMult);
  for (let i = 0; i < pellets; i++) {
    let a = pl.angle;
    if (w.spread) a += (Math.random() - 0.5) * w.spread * 2;
    bullets.push({
      id: nextBulletId++, owner: pl.id, wpn: pl.weapon, wave: !!w.wave,
      x: pl.x, y: pl.y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      damage: dmg, dist: 0, range: w.range
    });
  }
  events.push({ kind: 'muzzle', x: pl.x, y: pl.y, angle: pl.angle });
}

function applyDamage(target, attacker, dmg) {
  if (!target.alive) return;
  target.hp -= dmg;
  events.push({ kind: 'hit', x: target.x, y: target.y, angle: attacker ? Math.atan2(target.y - attacker.y, target.x - attacker.x) : 0 });
  if (target.hp <= 0) {
    target.alive = false;
    target.deaths++;
    target.points += DEATH_REWARD;  // consolação: morrer também dá pontos
    if (attacker && attacker.id !== target.id) {
      attacker.kills++;
      attacker.points += KILL_REWARD;
      events.push({ kind: 'kill', killer: attacker.id, x: attacker.x, y: attacker.y });
    }
    events.push({ kind: 'death', x: target.x, y: target.y, color: target.color });
    setTimeout(() => respawn(target), RESPAWN_MS);
  }
}

function respawn(pl) {
  const sp = spawnPoint();
  pl.x = sp.x; pl.y = sp.y;
  pl.hp = pl.maxHp || MAX_HP; pl.alive = true;
}

// ==================== HEARTBEAT ====================
// Remove jogadores que sumiram (fecharam aba sem o close disparar) e fecha sockets mortos.
setInterval(() => {
  const now = Date.now();
  for (const [id, pl] of players) {
    if (now - pl.lastSeen > 12000) players.delete(id); // 12s sem sinal = saiu
  }
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'ping' }));
  }
}, 4000);

// ==================== LOOP PRINCIPAL ====================
const STEP = 9.6; // deslocamento por tick
setInterval(() => {
  // Movimento com colisão (testa eixos separadamente pra deslizar na parede)
  for (const pl of players.values()) {
    if (!pl.alive) continue;
    let dx = 0, dy = 0;
    if (pl.input.up) dy -= 1;
    if (pl.input.down) dy += 1;
    if (pl.input.left) dx -= 1;
    if (pl.input.right) dx += 1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (dx / len) * STEP, ny = (dy / len) * STEP;

    let tx = Math.max(20, Math.min(WORLD.w - 20, pl.x + nx));
    if (!hitsWall(tx, pl.y, 18)) pl.x = tx;
    let ty = Math.max(20, Math.min(WORLD.h - 20, pl.y + ny));
    if (!hitsWall(pl.x, ty, 18)) pl.y = ty;
  }

  // Projéteis (colidem com jogador OU parede) — sub-passos p/ velocidade alta
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let done = false;
    const speed = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil(speed / 8)); // avança em fatias de ~8px
    const sx = b.vx / steps, sy = b.vy / steps;

    for (let s = 0; s < steps && !done; s++) {
      b.x += sx; b.y += sy; b.dist += Math.hypot(sx, sy);

      if (hitsWall(b.x, b.y, 3)) { events.push({ kind: 'spark', x: b.x, y: b.y }); done = true; break; }

      for (const pl of players.values()) {
        if (pl.id === b.owner || !pl.alive) continue;
        if (Math.hypot(pl.x - b.x, pl.y - b.y) < 20) {
          applyDamage(pl, players.get(b.owner), b.damage);
          done = true; break;
        }
      }
    }
    if (done || b.dist > b.range || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h) {
      bullets.splice(i, 1);
    }
  }

  // Broadcast
  const state = {
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      angle: +p.angle.toFixed(2), hp: p.hp, maxHp: p.maxHp, alive: p.alive,
      weapon: p.weapon, kills: p.kills, deaths: p.deaths, points: p.points,
      level: p.level, owned: p.owned, color: p.color
    })),
    bullets: bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), a: +Math.atan2(b.vy, b.vx).toFixed(2), w: b.wpn })),
    events,
    chat: chatLog
  };
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  events = [];
  chatLog = [];
}, 1000 / 30);

server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name}`));
