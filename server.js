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

// ==================== FASES DE JOGO ====================
const ROUND_MS = 3 * 60 * 1000; // 3 min jogando
const VOTE_MS = 30 * 1000;      // 30s de votação
let phase = 'playing';          // 'playing' | 'voting'
let phaseEndsAt = Date.now() + ROUND_MS;
let votes = {};                 // voterId -> targetId (ou 'skip')
let bannedThisRound = null;     // id do ejetado na última votação

// Arsenal DeadZone: Alpes Edition — cada arma tem dano e comportamento próprios.
const WEAPONS = {
  chinelo: { name: 'Chinelo',       emoji: '🩴', cost: 0,   damage: 22, cooldown: 260, speed: 17, range: 720, pellets: 1, tint: '#ff5fa2' },
  grito:   { name: 'Grito do Vado', emoji: '📢', cost: 0,   damage: 7,  cooldown: 520, speed: 26, range: 1500, pellets: 1, tint: '#7fe0ff', wave: true },
  escova:  { name: 'Escova',        emoji: '🪥', cost: 120, damage: 9,  cooldown: 90,  speed: 20, range: 640, pellets: 1, tint: '#ff3b52' },
  coco:    { name: 'Cocô',          emoji: '💩', cost: 280, damage: 16, cooldown: 620, speed: 12, range: 460, pellets: 5, spread: 0.4, tint: '#8a5a2b' },
  espada:  { name: 'Espada',        emoji: '⚔️', cost: 480, damage: 60, cooldown: 900, speed: 24, range: 1300, pellets: 1, tint: '#ffd23b' }
};

// ==================== MAPAS: CASAS BRASILEIRAS ====================
// Casa média no centro (cômodos conectados por portas) + área aberta em volta (quintal/rua).
// rooms: rótulos e cor de piso de cada área. walls: paredes que bloqueiam de verdade.
const MAPS = [
  {
    name: 'Sobrado dos Alpes 859',
    floor: '#20252e', // rua/calçada escura em volta
    rooms: [
      { x: 520, y: 120, w: 560, h: 180, label: '🚗 Garagem',   color: '#2c3038' },
      { x: 520, y: 320, w: 300, h: 240, label: '🛋️ Sala',      color: '#4a3f30' },
      { x: 840, y: 320, w: 240, h: 240, label: '🍳 Cozinha',   color: '#3f4535' },
      { x: 520, y: 580, w: 240, h: 240, label: '🚿 Banheiro',  color: '#35434a' },
      { x: 780, y: 580, w: 300, h: 240, label: '🛏️ Quarto',    color: '#453540' },
      { x: 140, y: 300, w: 340, h: 540, label: '🌳 Quintal',    color: '#2e4a32' },
      { x: 1120, y: 300, w: 340, h: 540, label: '🧺 Lavanderia', color: '#35454a' }
    ],
    walls: [
      // contorno da casa (com aberturas = portas)
      { x: 520, y: 300, w: 560, h: 20 },             // parede sob a garagem
      { x: 500, y: 320, w: 20, h: 240 },             // lateral esq sala
      { x: 1080, y: 320, w: 20, h: 500 },            // lateral dir cozinha/quarto
      { x: 820, y: 340, w: 20, h: 200 },             // sala|cozinha (porta embaixo)
      { x: 520, y: 560, w: 240, h: 20 },             // sala/banheiro (porta na direita)
      { x: 840, y: 560, w: 240, h: 20 },             // cozinha/quarto
      { x: 760, y: 600, w: 20, h: 220 },             // banheiro|quarto
      // paredes externas que separam quintal e lavanderia da rua (com passagens)
      { x: 480, y: 300, w: 20, h: 180 }, { x: 480, y: 620, w: 20, h: 220 },
      { x: 1100, y: 300, w: 20, h: 180 }, { x: 1100, y: 620, w: 20, h: 220 }
    ]
  },
  {
    name: 'Casa da Vó',
    floor: '#241f18',
    rooms: [
      { x: 430, y: 160, w: 340, h: 240, label: '🛋️ Sala',      color: '#4a3f30' },
      { x: 800, y: 160, w: 320, h: 240, label: '🍳 Cozinha',   color: '#3f4535' },
      { x: 430, y: 430, w: 340, h: 260, label: '🛏️ Quarto',    color: '#453540' },
      { x: 800, y: 430, w: 320, h: 260, label: '🚿 Banheiro',  color: '#35434a' },
      { x: 120, y: 200, w: 280, h: 700, label: '🌳 Quintal',    color: '#2e4a32' },
      { x: 430, y: 720, w: 690, h: 180, label: '🧺 Área/Varal', color: '#35454a' }
    ],
    walls: [
      { x: 770, y: 160, w: 20, h: 180 },   // sala|cozinha (porta embaixo)
      { x: 430, y: 400, w: 340, h: 20 },   // sala/quarto
      { x: 800, y: 400, w: 320, h: 20 },   // cozinha/banheiro
      { x: 770, y: 470, w: 20, h: 220 },   // quarto|banheiro
      { x: 400, y: 200, w: 20, h: 260 }, { x: 400, y: 560, w: 20, h: 340 }, // quintal
      { x: 430, y: 700, w: 300, h: 20 }, { x: 820, y: 700, w: 300, h: 20 }  // área embaixo
    ]
  },
  {
    name: 'Kitnet do Zé',
    floor: '#1e2226',
    rooms: [
      { x: 400, y: 200, w: 420, h: 320, label: '🛋️ Sala/Quarto', color: '#453f38' },
      { x: 850, y: 200, w: 340, h: 160, label: '🍳 Cozinha',      color: '#3f4535' },
      { x: 850, y: 390, w: 340, h: 130, label: '🚿 Banheiro',     color: '#35434a' },
      { x: 120, y: 200, w: 250, h: 500, label: '🚪 Corredor',     color: '#2c3038' },
      { x: 400, y: 550, w: 790, h: 200, label: '🌳 Quintal',       color: '#2e4a32' }
    ],
    walls: [
      { x: 820, y: 200, w: 20, h: 320 },   // sala|cozinha/banheiro
      { x: 850, y: 360, w: 340, h: 20 },   // cozinha/banheiro
      { x: 370, y: 200, w: 20, h: 200 }, { x: 370, y: 480, w: 20, h: 220 }, // corredor (porta)
      { x: 400, y: 520, w: 300, h: 20 }, { x: 780, y: 520, w: 410, h: 20 }  // quintal (passagem)
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
    banned: false,               // ejetado nesta tela (volta na próxima)
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

  ws.send(JSON.stringify({ type: 'init', id, world: WORLD, weapons: WEAPONS, map: currentMap(), killReward: KILL_REWARD, phase, timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)) }));

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
        if (pl.alive && phase === 'playing') tryAttack(pl);
        break;
      case 'vote':
        handleVote(pl, msg.target);
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
  if (pl.banned) return; // banido não renasce nesta tela
  const sp = spawnPoint();
  pl.x = sp.x; pl.y = sp.y;
  pl.hp = pl.maxHp || MAX_HP; pl.alive = true;
}

// ==================== SISTEMA DE VOTAÇÃO ====================
function startVoting() {
  phase = 'voting';
  votes = {};
  phaseEndsAt = Date.now() + VOTE_MS;
  chatLog.push({ name: 'sistema', color: '#ffd23b', text: '🗳️ REUNIÃO! Votem em quem sai desta tela.' });
}

function tallyVotesAndBan() {
  // conta votos por alvo
  const count = {};
  for (const voter in votes) {
    const t = votes[voter];
    if (t && t !== 'skip') count[t] = (count[t] || 0) + 1;
  }
  // acha o mais votado (empate ou zero votos = ninguém sai)
  let top = null, topN = 0, tie = false;
  for (const id in count) {
    if (count[id] > topN) { top = id; topN = count[id]; tie = false; }
    else if (count[id] === topN) tie = true;
  }
  bannedThisRound = null;
  if (top && topN > 0 && !tie) {
    const pl = players.get(+top);
    if (pl) {
      pl.banned = true; pl.alive = false;
      bannedThisRound = { id: pl.id, name: pl.name };
      chatLog.push({ name: 'sistema', color: '#ff3b52', text: `🚪 ${pl.name} foi banido desta tela!` });
    }
  } else {
    chatLog.push({ name: 'sistema', color: '#9fc4e8', text: 'Ninguém foi banido (empate ou sem votos).' });
  }
}

function nextRound() {
  // sorteia novo mapa, restaura banidos, reseta placar da tela
  currentMapIndex = Math.floor(Math.random() * MAPS.length);
  phase = 'playing';
  phaseEndsAt = Date.now() + ROUND_MS;
  votes = {};
  for (const pl of players.values()) {
    pl.banned = false; // todos voltam na nova tela
    const sp = spawnPoint();
    pl.x = sp.x; pl.y = sp.y;
    pl.hp = pl.maxHp || MAX_HP; pl.alive = true;
  }
  // avisa o novo mapa a todos
  const initMap = currentMap();
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'newMap', map: initMap, name: initMap.name }));
  }
  chatLog.push({ name: 'sistema', color: '#4ade5f', text: `🏠 Nova tela: ${initMap.name}` });
}

// gerência de tempo das fases:
// playing -> (fim) startVoting -> (fim) tallyVotesAndBan (ejeta, curto intervalo mostrando resultado) -> nextRound
let banFreezeUntil = 0;
setInterval(() => {
  const now = Date.now();
  if (now < phaseEndsAt) return;
  if (phase === 'playing') {
    startVoting();
  } else if (phase === 'voting') {
    // fim da votação: apura e ejeta, dá 4s mostrando o banido antes de trocar de tela
    tallyVotesAndBan();
    phase = 'result';
    phaseEndsAt = now + 4000;
  } else if (phase === 'result') {
    nextRound();
  }
}, 300);

function handleVote(voter, targetId) {
  if (phase !== 'voting') return;
  if (voter.banned) return; // banido não vota
  votes[voter.id] = targetId; // 'skip' ou id
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
  const moving = (phase === 'playing');
  // Movimento com colisão (testa eixos separadamente pra deslizar na parede)
  for (const pl of players.values()) {
    if (!pl.alive || !moving) continue;
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

      // ondas sonoras atravessam paredes; projéteis normais colidem
      if (!b.wave && hitsWall(b.x, b.y, 3)) { events.push({ kind: 'spark', x: b.x, y: b.y }); done = true; break; }

      const hitR = b.wave ? 34 : 20; // onda acerta num raio maior
      for (const pl of players.values()) {
        if (pl.id === b.owner || !pl.alive) continue;
        if (Math.hypot(pl.x - b.x, pl.y - b.y) < hitR) {
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
      level: p.level, owned: p.owned, color: p.color, banned: p.banned
    })),
    bullets: bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), a: +Math.atan2(b.vy, b.vx).toFixed(2), w: b.wpn, wave: b.wave ? 1 : 0 })),
    events,
    chat: chatLog,
    phase,
    timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)),
    votes: phase === 'voting' ? votes : null
  };
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  events = [];
  chatLog = [];
}, 1000 / 30);

server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name}`));
