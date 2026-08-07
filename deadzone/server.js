// server.js — Servidor autoritativo do jogo (Node.js + ws)
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ---- Servidor HTTP: entrega o index.html ----
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

// ---- Estado do jogo ----
const WORLD = { w: 1600, h: 1200 };
const WEAPONS = {
  pistol: { name: 'Pistola', type: 'ranged', damage: 20, cooldown: 350, speed: 9, range: 700 },
  rifle:  { name: 'Rifle',   type: 'ranged', damage: 12, cooldown: 120, speed: 12, range: 900 },
  knife:  { name: 'Faca',    type: 'melee',  damage: 45, cooldown: 400, range: 55 }
};
const MAX_HP = 100;
const RESPAWN_MS = 3000;

const players = new Map(); // id -> player
const bullets = [];        // projéteis ativos
let nextId = 1;
let nextBulletId = 1;

function spawnPoint() {
  return {
    x: 60 + Math.random() * (WORLD.w - 120),
    y: 60 + Math.random() * (WORLD.h - 120)
  };
}

function makePlayer(id, name) {
  const p = spawnPoint();
  return {
    id, name: name || ('P' + id),
    x: p.x, y: p.y, angle: 0,
    hp: MAX_HP, alive: true,
    weapon: 'pistol',
    kills: 0, deaths: 0,
    lastShot: 0,
    input: { up: false, down: false, left: false, right: false },
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
  };
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = makePlayer(id, null);
  players.set(id, player);
  ws.playerId = id;

  ws.send(JSON.stringify({ type: 'init', id, world: WORLD, weapons: WEAPONS }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const pl = players.get(id);
    if (!pl) return;

    switch (msg.type) {
      case 'setName':
        pl.name = String(msg.name || '').slice(0, 12) || pl.name;
        break;
      case 'input':
        if (pl.alive) {
          pl.input = msg.input;
          pl.angle = msg.angle;
        }
        break;
      case 'switchWeapon':
        if (WEAPONS[msg.weapon]) pl.weapon = msg.weapon;
        break;
      case 'attack':
        if (pl.alive) tryAttack(pl);
        break;
    }
  });

  ws.on('close', () => players.delete(id));
});

function tryAttack(pl) {
  const w = WEAPONS[pl.weapon];
  const now = Date.now();
  if (now - pl.lastShot < w.cooldown) return;
  pl.lastShot = now;

  if (w.type === 'ranged') {
    bullets.push({
      id: nextBulletId++,
      owner: pl.id,
      x: pl.x, y: pl.y,
      vx: Math.cos(pl.angle) * w.speed,
      vy: Math.sin(pl.angle) * w.speed,
      damage: w.damage,
      dist: 0, range: w.range
    });
  } else {
    // Melee: acerta quem estiver no alcance à frente
    for (const target of players.values()) {
      if (target.id === pl.id || !target.alive) continue;
      const dx = target.x - pl.x, dy = target.y - pl.y;
      const d = Math.hypot(dx, dy);
      if (d <= w.range) {
        const facing = Math.abs(normalizeAngle(Math.atan2(dy, dx) - pl.angle));
        if (facing < 1.0) applyDamage(target, pl, w.damage);
      }
    }
  }
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function applyDamage(target, attacker, dmg) {
  if (!target.alive) return;
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.alive = false;
    target.deaths++;
    if (attacker && attacker.id !== target.id) attacker.kills++;
    setTimeout(() => respawn(target), RESPAWN_MS);
  }
}

function respawn(pl) {
  const sp = spawnPoint();
  pl.x = sp.x; pl.y = sp.y;
  pl.hp = MAX_HP; pl.alive = true;
}

// ---- Loop principal (server tick ~30fps) ----
const SPEED = 3.2;
setInterval(() => {
  // Movimento
  for (const pl of players.values()) {
    if (!pl.alive) continue;
    let dx = 0, dy = 0;
    if (pl.input.up) dy -= 1;
    if (pl.input.down) dy += 1;
    if (pl.input.left) dx -= 1;
    if (pl.input.right) dx += 1;
    const len = Math.hypot(dx, dy) || 1;
    pl.x = Math.max(20, Math.min(WORLD.w - 20, pl.x + (dx / len) * SPEED * 3));
    pl.y = Math.max(20, Math.min(WORLD.h - 20, pl.y + (dy / len) * SPEED * 3));
  }

  // Projéteis
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.dist += Math.hypot(b.vx, b.vy);
    let hit = false;
    for (const pl of players.values()) {
      if (pl.id === b.owner || !pl.alive) continue;
      if (Math.hypot(pl.x - b.x, pl.y - b.y) < 22) {
        applyDamage(pl, players.get(b.owner), b.damage);
        hit = true; break;
      }
    }
    if (hit || b.dist > b.range || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h) {
      bullets.splice(i, 1);
    }
  }

  // Broadcast do estado
  const state = {
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      angle: +p.angle.toFixed(2), hp: p.hp, alive: p.alive,
      weapon: p.weapon, kills: p.kills, deaths: p.deaths, color: p.color
    })),
    bullets: bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }))
  };
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}, 1000 / 30);

server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
