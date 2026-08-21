// server.js — Servidor autoritativo do DEADZONE (Node.js + ws)
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { WeeklyRanking } = require('./ranking');
const { Progression } = require('./progression');

const PORT = process.env.PORT || 3000;
const BUILD = 'v5-evolution-3.0-preview';

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://deadzone.local').pathname); } catch {}
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, build: BUILD,
      players: [...players.values()].filter(p => p.connected && !p.isBot).length,
      bots: [...players.values()].filter(p => p.connected && p.isBot).length,
      ranking: ranking.isPersistent() ? 'postgres' : 'memory',
      progression: progression.isPersistent() ? 'postgres' : 'memory'
    }));
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const publicRoot = path.resolve(__dirname, 'public');
  const rel = String(pathname || '/index.html').replace(/^\/+/, '');
  const full = path.resolve(publicRoot, rel);
  if (full !== publicRoot && !full.startsWith(publicRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Forbidden'); return;
  }
  const typeByExt = {
    '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
    '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon'
  };
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
    res.writeHead(200, {
      'Content-Type': typeByExt[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache', 'Expires': '0',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

// ==================== CONFIG ====================
const WORLD = { w: 1600, h: 1200 };
const MAX_HP = 100;
const RESPAWN_MS = 3000;
const KILL_REWARD = 50;   // pontos ganhos por kill
const DEATH_REWARD = 15;  // pontos de consolação ao morrer
const SESSION_GRACE_MS = 3 * 60 * 1000; // mantém a sessão por 3 min fora do browser
const HEALTH_PICKUP_COUNT = 5;
const HEALTH_PICKUP_HEAL = 35;
const HEALTH_RESPAWN_MIN_MS = 12000;
const HEALTH_RESPAWN_MAX_MS = 20000;

const ranking = new WeeklyRanking();
const progression = new Progression();
function rankingSafe(promise) { Promise.resolve(promise).catch(err => console.error('[ranking]', err.message)); }
function progressSafe(promise) { Promise.resolve(promise).catch(err => console.error('[progression]', err.message)); }
let roundStartedAt = Date.now();

// ==================== FASES DE JOGO ====================
const ROUND_MS = 3 * 60 * 1000; // 3 min jogando
const VOTE_MS = 30 * 1000;      // 30s de votação
let phase = 'playing';          // 'playing' | 'voting'
let phaseEndsAt = Date.now() + ROUND_MS;
let votes = {};                 // voterId -> targetId (ou 'skip')
let bannedThisRound = {};     // dados do ejetado na última votação
let roundNumber = 1;              // rodada atual; usado para suspensão de 1 rodada

// Arsenal DeadZone: Alpes Edition — cada arma tem dano e comportamento próprios.
const UTILITIES = {
  mamaeMarcia: {
    name: 'Mamãe Márcia', icon: 'armor', cost: 30, armor: 60,
    description: 'Colete à prova de bala barato. Absorve até 60 de dano antes do HP.'
  },
  pingaLele: {
    name: 'Pinga do Lelê', icon: 'bomb', cost: 25, maxCarry: 3,
    damage: 72, radius: 150, fuseMs: 1250, speed: 17,
    description: 'Garrafa-bomba arremessável. Explode em área e respeita paredes.'
  }
};

const SKINS = {
  bean: { name: 'Clássico', icon: 'bean', cost: 0, description: 'O personagem clássico do DEADZONE.' },
  gravida: { name: 'Gestante', icon: 'pregnant', cost: 15, description: 'Mulher negra grávida em estilo cartunesco.' },
  bubu: { name: 'Bubu', icon: 'bubu', cost: 20, description: 'Mulher branca grávida. Seu poder exclusivo é o Dracarys da Bubu.' },
  capivara: { name: 'Capivara', icon: 'capybara', cost: 15, description: 'Capivara dos Alpes. Mesmas hitbox e velocidade dos demais.' }
};

const WEAPONS = {
  chinelo: {
    name: 'Chinelo', emoji: '🩴', icon: 'chinelo', cost: 0,
    damage: 24, cooldown: 320, speed: 15, range: 520, pellets: 1, hitRadius: 19,
    tint: '#ff5fa2', description: 'Arremesso médio, simples e confiável.'
  },
  gin10: {
  name: 'Gin de 10 do Pedrin', emoji: '🥤', icon: 'gin10', cost: 0,
  damage: 12, cooldown: 420, speed: 17, range: 560, pellets: 1, hitRadius: 22,
  tint: '#ff2f68',
  description: 'Arma poderosa de um bêbado. Arremessa um copo de gin de 10: pouco dano, alcance médio e não atravessa paredes.'
},
  dracarys: {
    name: 'Dracarys da Bubu', emoji: '🔥', icon: 'dracarys', cost: 0,
    damage: 11, cooldown: 190, speed: 12, range: 245, pellets: 5, spread: 0.20, hitRadius: 22,
    tint: '#ff8c42', fire: true, hiddenShop: true, specialSkin: 'bubu',
    description: 'Sopro curto de fogo em cone. Poder exclusivo da Bubu.'
  },
  peido: {
    name: 'Peido do Pepeu', emoji: '💨', icon: 'fart', cost: 20,
    damage: 10, cooldown: 520, speed: 7.5, range: 210, pellets: 4, spread: 0.62, hitRadius: 30,
    tint: '#8fbc58', gas: true,
    description: 'Nuvem curta e barata. Espalha vários puffs de perto.'
  },
  lilika: {
    name: 'Lilika Possuída', emoji: '👹', icon: 'lilika', cost: 160,
    damage: 32, cooldown: 900, speed: 15, range: 600, pellets: 1, hitRadius: 27,
    tint: '#c85cff', possessed: true,
    description: 'Arremessa uma mini Lilika cartunesca girando pelo mapa.'
  },
  grito: {
    name: 'Grito do Vado', emoji: '📣', icon: 'grito', cost: 0,
    damage: 8, cooldown: 820, speed: 22, range: 1050, pellets: 1, hitRadius: 42,
    tint: '#7fe0ff', wave: true, pierce: true,
    description: 'Onda sonora de longo alcance. Atravessa paredes e jogadores.'
  },
  escova: {
    name: 'Escova de Cabelo', emoji: '', icon: 'hairbrush', cost: 120,
    damage: 18, cooldown: 330, speed: 19, range: 610, pellets: 1, hitRadius: 22,
    tint: '#ff4fa3', description: 'Escova rosa arremessada. Alcance médio e boa cadência.'
  },
  coco: {
    name: 'Cocô', emoji: '💩', icon: 'coco', cost: 280,
    damage: 14, cooldown: 650, speed: 11, range: 380, pellets: 5, spread: 0.42, hitRadius: 20,
    tint: '#8a5a2b', description: 'Rajada curta de cinco projéteis. Forte de perto.'
  },
  espada: {
    name: 'Espada-de-São-Jorge', emoji: '🌿', icon: 'snakeplant', cost: 480,
    damage: 48, cooldown: 780, speed: 23, range: 760, pellets: 1, hitRadius: 20,
    tint: '#77c44a', description: 'Folha pontuda lançada em linha reta. Alto dano.'
  }
};

// ==================== MAPAS: CASAS BRASILEIRAS ====================
// Casa média no centro (cômodos conectados por portas) + área aberta em volta (quintal/rua).
// rooms: rótulos e cor de piso de cada área. walls: paredes que bloqueiam de verdade.
const MAPS = [
  {
    name: 'Sobrado dos Alpes 859',
    floor: '#20252e', // rua/calçada escura em volta
    rooms: [
      { x: 520, y: 120, w: 560, h: 180, label: '🚗 Garagem',   color: '#303744' },
      { x: 520, y: 320, w: 300, h: 240, label: '🛋️ Sala',      color: '#594934' },
      { x: 840, y: 320, w: 240, h: 240, label: '🍳 Cozinha',   color: '#4a523b' },
      { x: 520, y: 580, w: 240, h: 240, label: '🚿 Banheiro',  color: '#3b5260' },
      { x: 780, y: 580, w: 300, h: 240, label: '🛏️ Quarto',    color: '#563d50' },
      { x: 140, y: 300, w: 340, h: 540, label: '🌳 Quintal',    color: '#315b39' },
      { x: 1120, y: 300, w: 340, h: 540, label: '🧺 Lavanderia', color: '#39515a' }
    ],
    walls: [
      // Garagem -> casa: porta central com 100px livres
      { x: 520, y: 300, w: 180, h: 20 }, { x: 800, y: 300, w: 280, h: 20 },
      // Quintal -> sala/banheiro: duas passagens largas
      { x: 500, y: 320, w: 20, h: 105 }, { x: 500, y: 515, w: 20, h: 120 }, { x: 500, y: 725, w: 20, h: 95 },
      // Casa -> lavanderia: duas passagens largas
      { x: 1080, y: 320, w: 20, h: 105 }, { x: 1080, y: 515, w: 20, h: 120 }, { x: 1080, y: 725, w: 20, h: 95 },
      // Sala <-> cozinha, abertura de 90px
      { x: 820, y: 320, w: 20, h: 75 }, { x: 820, y: 485, w: 20, h: 75 },
      // Sala <-> banheiro
      { x: 520, y: 560, w: 100, h: 20 }, { x: 710, y: 560, w: 50, h: 20 },
      // Cozinha <-> quarto
      { x: 840, y: 560, w: 70, h: 20 }, { x: 1000, y: 560, w: 80, h: 20 },
      // Banheiro <-> quarto
      { x: 760, y: 580, w: 20, h: 70 }, { x: 760, y: 740, w: 20, h: 80 }
    ],
    doors: [
      { x:700,y:300,w:100,h:20 }, { x:500,y:425,w:20,h:90 }, { x:500,y:635,w:20,h:90 },
      { x:1080,y:425,w:20,h:90 }, { x:1080,y:635,w:20,h:90 }, { x:820,y:395,w:20,h:90 },
      { x:620,y:560,w:90,h:20 }, { x:910,y:560,w:90,h:20 }, { x:760,y:650,w:20,h:90 }
    ]
  },
  {
    name: 'Casa da Vó',
    floor: '#241f18',
    rooms: [
      { x: 430, y: 160, w: 340, h: 240, label: '🛋️ Sala',      color: '#594934' },
      { x: 800, y: 160, w: 320, h: 240, label: '🍳 Cozinha',   color: '#4a523b' },
      { x: 430, y: 430, w: 340, h: 260, label: '🛏️ Quarto',    color: '#563d50' },
      { x: 800, y: 430, w: 320, h: 260, label: '🚿 Banheiro',  color: '#3b5260' },
      { x: 120, y: 200, w: 280, h: 700, label: '🌳 Quintal',    color: '#315b39' },
      { x: 430, y: 720, w: 690, h: 180, label: '🧺 Área/Varal', color: '#39515a' }
    ],
    walls: [
      // Sala <-> cozinha
      { x:780,y:160,w:20,h:80 }, { x:780,y:330,w:20,h:70 },
      // Sala <-> quarto
      { x:430,y:410,w:120,h:20 }, { x:650,y:410,w:120,h:20 },
      // Cozinha <-> banheiro
      { x:800,y:410,w:90,h:20 }, { x:990,y:410,w:130,h:20 },
      // Quarto <-> banheiro
      { x:780,y:430,w:20,h:75 }, { x:780,y:595,w:20,h:95 },
      // Quintal -> casa com dois acessos
      { x:410,y:200,w:20,h:120 }, { x:410,y:410,w:20,h:100 }, { x:410,y:600,w:20,h:300 },
      // Casa -> área/varal
      { x:430,y:705,w:150,h:20 }, { x:680,y:705,w:170,h:20 }, { x:950,y:705,w:170,h:20 }
    ],
    doors: [
      {x:780,y:240,w:20,h:90}, {x:550,y:410,w:100,h:20}, {x:890,y:410,w:100,h:20},
      {x:780,y:505,w:20,h:90}, {x:410,y:320,w:20,h:90}, {x:410,y:510,w:20,h:90},
      {x:580,y:705,w:100,h:20}, {x:850,y:705,w:100,h:20}
    ]
  },
  {
    name: 'Kitnet do Zé',
    floor: '#1e2226',
    rooms: [
      { x: 400, y: 200, w: 420, h: 320, label: '🛋️ Sala/Quarto', color: '#55483e' },
      { x: 850, y: 200, w: 340, h: 160, label: '🍳 Cozinha',      color: '#4a523b' },
      { x: 850, y: 390, w: 340, h: 130, label: '🚿 Banheiro',     color: '#3b5260' },
      { x: 120, y: 200, w: 250, h: 500, label: '🚪 Corredor',     color: '#303744' },
      { x: 400, y: 550, w: 790, h: 200, label: '🌳 Quintal',       color: '#315b39' }
    ],
    walls: [
      // Sala/Quarto <-> cozinha/banheiro com duas portas
      {x:830,y:200,w:20,h:80}, {x:830,y:370,w:20,h:55}, {x:830,y:505,w:20,h:15},
      // Cozinha <-> banheiro
      {x:850,y:375,w:110,h:20}, {x:1050,y:375,w:140,h:20},
      // Corredor -> sala/quarto
      {x:380,y:200,w:20,h:105}, {x:380,y:395,w:20,h:125}, {x:380,y:610,w:20,h:90},
      // Casa -> quintal
      {x:400,y:530,w:130,h:20}, {x:620,y:530,w:190,h:20}, {x:900,y:530,w:290,h:20}
    ],
    doors: [
      {x:830,y:280,w:20,h:90}, {x:830,y:425,w:20,h:80}, {x:960,y:375,w:90,h:20},
      {x:380,y:305,w:20,h:90}, {x:380,y:520,w:20,h:90}, {x:530,y:530,w:90,h:20}, {x:810,y:530,w:90,h:20}
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
let nextBombId = 1;
const thrownBombs = [];
const sessions = new Map(); // sessionToken -> playerId
let nextPickupId = 1;
const healthPickups = [];
const ROOM_PUBLIC = 'PUBLIC';
const destructiblesByRoom = new Map();
const BOT_NAMES = ['Bot Márcia','Bot Pedrin','Bot Pepeu','Bot Lilika','Bot Vado'];

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
    owned: { chinelo: true, gin10: true, grito: true },  // armas grátis desde o início
    skin: 'bean',
    ownedSkins: { bean: true },
    armor: 0,
    bombs: 0,
    points: 0,                   // moeda pra comprar
    level: 1,                    // nível (informado pelo cliente, vem do localStorage)
    kills: 0, deaths: 0,
    roundKills: 0, roundDeaths: 0,
    rankingKey: '',
    room: ROOM_PUBLIC,
    isBot: false,
    lastEmote: 0,
    combo: 0,
    lastKillAt: 0,
    banned: false,               // compatibilidade de UI: true enquanto estiver espectador
    spectatorUntilRound: 0,       // número da última rodada em que deve ficar fora
    lastShot: 0,
    lastBomb: 0,
    lastChat: 0,
    lastSeen: Date.now(),        // heartbeat
    connected: true,
    disconnectedAt: 0,
    sessionToken: '',
    socket: null,
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

function makeBot(index) {
  const bot = makePlayer(nextId++, BOT_NAMES[index % BOT_NAMES.length]);
  bot.isBot = true; bot.room = ROOM_PUBLIC; bot.socket = null; bot.sessionToken = '';
  bot.owned = { chinelo:true, gin10:true, grito:true, peido:true };
  bot.weapon = ['chinelo','gin10','grito','peido'][index % 4];
  bot.color = `hsl(${(index * 73 + 18) % 360}, 72%, 57%)`;
  return bot;
}
function balanceBots() {
  const humans = [...players.values()].filter(p => p.connected && !p.isBot && p.room === ROOM_PUBLIC).length;
  const desired = humans > 0 && humans < 3 ? 3 - humans : 0;
  const bots = [...players.values()].filter(p => p.isBot && p.room === ROOM_PUBLIC);
  while (bots.length < desired) {
    const bot = makeBot(bots.length); players.set(bot.id, bot); bots.push(bot);
  }
  while (bots.length > desired) { const bot = bots.pop(); if (bot) players.delete(bot.id); }
}
function botThink() {
  if (phase !== 'playing') return;
  const humans = [...players.values()].filter(p => p.connected && !p.isBot && p.alive && !isSpectating(p));
  for (const bot of players.values()) {
    if (!bot.isBot || !bot.alive || isSpectating(bot)) continue;
    const targets = humans.filter(p => p.room === bot.room);
    if (!targets.length) { resetInput(bot); continue; }
    targets.sort((a,b) => Math.hypot(a.x-bot.x,a.y-bot.y) - Math.hypot(b.x-bot.x,b.y-bot.y));
    const t = targets[0], dx=t.x-bot.x, dy=t.y-bot.y, dist=Math.hypot(dx,dy)||1;
    bot.angle = Math.atan2(dy,dx);
    const side = Math.sin(Date.now()/620 + bot.id) > 0 ? 1 : -1;
    bot.input = { up:dy < -20, down:dy > 20, left:dx < -20, right:dx > 20 };
    if (dist < 180) { bot.input.left = side > 0; bot.input.right = side < 0; }
    if (dist < 650) tryAttack(bot);
  }
}
setInterval(balanceBots, 1200);
setInterval(botThink, 180);

function isSpectating(pl) {
  return !!pl && pl.spectatorUntilRound >= roundNumber;
}

function resetInput(pl) {
  pl.input = { up: false, down: false, left: false, right: false };
}

function cleanSessionToken(raw) {
  const token = String(raw || '').trim();
  return /^[a-zA-Z0-9_-]{20,128}$/.test(token) ? token : crypto.randomBytes(24).toString('base64url');
}

function playerTokenFromRequest(req) {
  try {
    const url = new URL(req.url || '/', 'http://deadzone.local');
    const raw = String(url.searchParams.get('player') || '').trim();
    return /^[a-zA-Z0-9_-]{20,128}$/.test(raw) ? raw : '';
  } catch { return ''; }
}

function sessionTokenFromRequest(req) {
  try {
    const url = new URL(req.url || '/', 'http://deadzone.local');
    return cleanSessionToken(url.searchParams.get('session'));
  } catch {
    return cleanSessionToken('');
  }
}

function randomHealthRespawn() {
  return HEALTH_RESPAWN_MIN_MS + Math.floor(Math.random() * (HEALTH_RESPAWN_MAX_MS - HEALTH_RESPAWN_MIN_MS + 1));
}
function activeRooms() {
  const set = new Set([ROOM_PUBLIC]);
  for (const p of players.values()) if (p.connected) set.add(p.room || ROOM_PUBLIC);
  return [...set];
}
function makeHealthPickup(room = ROOM_PUBLIC) {
  const sp = spawnPoint();
  return { id: nextPickupId++, x: sp.x, y: sp.y, heal: HEALTH_PICKUP_HEAL, respawnAt: 0, room };
}
function ensureRoomPickups(room = ROOM_PUBLIC) {
  room = room || ROOM_PUBLIC;
  let count = healthPickups.filter(h => h.room === room).length;
  while (count++ < HEALTH_PICKUP_COUNT) healthPickups.push(makeHealthPickup(room));
}
function resetHealthPickups() {
  const rooms = activeRooms(); healthPickups.length = 0;
  for (const room of rooms) ensureRoomPickups(room);
}
function cleanRoomCode(raw) {
  const v = String(raw || '').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,8);
  return !v || v === ROOM_PUBLIC ? ROOM_PUBLIC : v;
}
function roomDestructibles(room = ROOM_PUBLIC) {
  const current = destructiblesByRoom.get(room); if (current) return current;
  const types = ['tv','vase','chair','crate','grill']; const list=[]; let id=1;
  for (const [i,rm] of (currentMap().rooms || []).entries()) {
    const type = types[i % types.length], maxHp = type === 'crate' ? 72 : type === 'grill' ? 90 : 52;
    list.push({ id:`${room}-${id++}`, type, x:Math.round(rm.x+rm.w*(.28+(i%3)*.18)), y:Math.round(rm.y+rm.h*(.56+(i%2)*.12)), hp:maxHp, maxHp });
  }
  destructiblesByRoom.set(room,list); return list;
}
function ensureRoomDestructibles(room = ROOM_PUBLIC) { return roomDestructibles(room); }
function damageDestructible(room,x,y,r,damage) {
  const list = ensureRoomDestructibles(room);
  for (const d of list) {
    if (d.hp <= 0 || Math.hypot(d.x-x,d.y-y) > (r||8)+20) continue;
    d.hp = Math.max(0,d.hp-Math.max(1,damage|0));
    events.push({kind:d.hp<=0?'destructibleBreak':'destructibleHit',room,x:d.x,y:d.y,id:d.id,objectType:d.type,hp:d.hp,maxHp:d.maxHp});
    return d;
  }
  return null;
}
function joinRoom(pl, raw, ws) {
  const room = cleanRoomCode(raw);
  pl.room = room; resetInput(pl); pl.combo = 0;
  const sp = spawnPoint(); pl.x=sp.x; pl.y=sp.y; pl.hp=pl.maxHp||MAX_HP; pl.alive=true;
  ensureRoomPickups(room); ensureRoomDestructibles(room);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'roomInfo',room,private:room!==ROOM_PUBLIC}));
}
function handleEmote(pl, raw) {
  const now=Date.now(); if(now-pl.lastEmote<900)return;
  const emoji=String(raw||'').trim().slice(0,8); if(!emoji)return;
  pl.lastEmote=now; events.push({kind:'emote',room:pl.room,player:pl.id,emoji,x:pl.x,y:pl.y});
}
resetHealthPickups();

wss.on('connection', (ws, req) => {
  const token = sessionTokenFromRequest(req);
  const persistentPlayerToken = playerTokenFromRequest(req) || token;
  let id = sessions.get(token);
  let player = id ? players.get(id) : null;
  let resumed = false;
  const now = Date.now();

  // Token conhecido: retoma a sessão se ela ainda estiver dentro da janela de 3 minutos.
  if (player && !player.connected && player.disconnectedAt && now - player.disconnectedAt > SESSION_GRACE_MS) {
    players.delete(player.id);
    sessions.delete(token);
    player = null;
    id = null;
  }

  if (player) {
    resumed = true;
    if (player.socket && player.socket !== ws && player.socket.readyState === 1) {
      try { player.socket.close(4001, 'session resumed'); } catch {}
    }
    player.connected = true;
    player.disconnectedAt = 0;
    player.lastSeen = now;
    player.socket = ws;
    resetInput(player);
  } else {
    id = nextId++;
    player = makePlayer(id, null);
    player.sessionToken = token;
    player.socket = ws;
    players.set(id, player);
    sessions.set(token, id);
  }
  ws.playerId = id;
  player.rankingKey = ranking.playerKey(persistentPlayerToken);
  rankingSafe(ranking.ensurePlayer(player));
  progressSafe(progression.ensurePlayer(player));
  ensureRoomPickups(player.room); ensureRoomDestructibles(player.room);
  // Gin de 10 do Pedrin é gratuita, inclusive em sessão retomada.
  player.owned.gin10 = true;

  ws.send(JSON.stringify({ type: 'init', id, sessionToken: token, resumed, build: BUILD, world: WORLD, weapons: WEAPONS, utilities: UTILITIES, skins: SKINS, map: currentMap(), killReward: KILL_REWARD, rankingPersistent: ranking.isPersistent(), progressionPersistent: progression.isPersistent(), room: player.room, season: progression.season, phase, timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)) }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const pl = players.get(ws.playerId);
    if (!pl) return;
    pl.lastSeen = Date.now();

    switch (msg.type) {
      case 'setName':
        pl.name = String(msg.name || '').replace(/[\x00-\x1F\x7F<>]/g, '').trim().slice(0, 12) || pl.name;
        rankingSafe(ranking.updateName(pl));
        if (typeof msg.level === 'number') {
          pl.level = Math.max(1, Math.min(999, msg.level | 0));
          const buff = levelBuff(pl.level);
          pl.maxHp = buff.hp;
          if (pl.hp > pl.maxHp) pl.hp = pl.maxHp;
          else if (pl.hp === MAX_HP) pl.hp = pl.maxHp; // ainda cheio, sobe pro novo máximo
        }
        progressSafe(progression.updateIdentity(pl));
        break;
      case 'pause':
        resetInput(pl);
        break;
      case 'input':
        if (pl.alive && !isSpectating(pl) && phase === 'playing') {
          const i = msg.input || {};
          pl.input = { up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right };
          if (Number.isFinite(msg.angle)) pl.angle = Math.atan2(Math.sin(msg.angle), Math.cos(msg.angle));
        }
        break;
      case 'switchWeapon': {
        const w = WEAPONS[msg.weapon];
        if (w && pl.owned[msg.weapon] && (!w.specialSkin || pl.skin === w.specialSkin)) pl.weapon = msg.weapon;
        break;
      }
      case 'buy':
        buyWeapon(pl, msg.weapon, ws);
        break;
      case 'buyUtility':
        buyUtility(pl, msg.item, ws);
        break;
      case 'buySkin':
        buySkin(pl, msg.skin, ws);
        break;
      case 'switchSkin':
        switchSkin(pl, msg.skin);
        break;
      case 'useBomb':
        if (pl.alive && !isSpectating(pl) && phase === 'playing') {
          if (Number.isFinite(msg.angle)) pl.angle = Math.atan2(Math.sin(msg.angle), Math.cos(msg.angle));
          throwBomb(pl, ws);
        }
        break;
      case 'attack':
        if (pl.alive && !isSpectating(pl) && phase === 'playing') {
          if (Number.isFinite(msg.angle)) pl.angle = Math.atan2(Math.sin(msg.angle), Math.cos(msg.angle));
          tryAttack(pl);
        }
        break;
      case 'vote':
        handleVote(pl, msg.target);
        break;
      case 'chat':
        handleChat(pl, msg.text);
        break;
      case 'rankingRequest':
        ranking.snapshot(pl, 10).then(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ranking', ...data })); }).catch(err => console.error('[ranking]', err.message));
        break;
      case 'profileRequest':
        progression.snapshot(pl).then(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type:'profile', data })); }).catch(err => console.error('[progression]', err.message));
        break;
      case 'roomJoin':
        joinRoom(pl, msg.room, ws);
        break;
      case 'emote':
        handleEmote(pl, msg.emoji);
        break;
      case 'pong':
        break; // resposta ao ping, já atualizou lastSeen
    }
  });

  ws.on('close', () => {
    const pl = players.get(ws.playerId);
    if (!pl || pl.socket !== ws) return; // socket antigo fechado após um resume não derruba a sessão nova
    pl.connected = false;
    pl.disconnectedAt = Date.now();
    pl.socket = null;
    resetInput(pl);
  });
});

function buyWeapon(pl, weaponKey, ws) {
  const w = WEAPONS[weaponKey];
  if (!w || w.hiddenShop || w.specialSkin) return;
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

function buyUtility(pl, itemKey, ws) {
  const item = UTILITIES[itemKey];
  if (!item) return;

  if (itemKey === 'mamaeMarcia') {
    if (pl.armor >= item.armor) {
      ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: 'Mamãe Márcia já está protegendo você' }));
      return;
    }
    if (pl.points < item.cost) {
      ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: 'pontos insuficientes' }));
      return;
    }
    pl.points -= item.cost;
    pl.armor = item.armor;
    ws.send(JSON.stringify({ type: 'shopResult', ok: true, kind: 'utility', item: itemKey, message: `🛡️ ${item.name} equipado: +${item.armor} de proteção` }));
    return;
  }

  if (itemKey === 'pingaLele') {
    if (pl.bombs >= item.maxCarry) {
      ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: `máximo de ${item.maxCarry} Pingas do Lelê` }));
      return;
    }
    if (pl.points < item.cost) {
      ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: 'pontos insuficientes' }));
      return;
    }
    pl.points -= item.cost;
    pl.bombs++;
    ws.send(JSON.stringify({ type: 'shopResult', ok: true, kind: 'utility', item: itemKey, message: `🍾 ${item.name} comprada. Você tem ${pl.bombs}.` }));
  }
}

function equipSkin(pl, skinKey) {
  if (!SKINS[skinKey] || !pl.ownedSkins[skinKey]) return false;
  pl.skin = skinKey;
  if (skinKey === 'bubu') { pl.owned.dracarys = true; pl.weapon = 'dracarys'; }
  else if (pl.weapon === 'dracarys') pl.weapon = 'chinelo';
  return true;
}

function buySkin(pl, skinKey, ws) {
  const skin = SKINS[skinKey];
  if (!skin || skinKey === 'bean') return;
  if (pl.ownedSkins[skinKey]) { equipSkin(pl, skinKey); ws.send(JSON.stringify({ type:'shopResult',ok:true,kind:'skin',skin:skinKey,message:skinKey==='bubu'?'🔥 Bubu equipada. Dracarys liberado.':`🧍 ${skin.name} equipado.` })); return; }
  if (pl.points < skin.cost) { ws.send(JSON.stringify({ type:'shopResult',ok:false,reason:'pontos insuficientes' })); return; }
  pl.points -= skin.cost; pl.ownedSkins[skinKey] = true; equipSkin(pl, skinKey);
  ws.send(JSON.stringify({ type:'shopResult',ok:true,kind:'skin',skin:skinKey,message:skinKey==='bubu'?'🔥 Bubu comprada e equipada. Dracarys liberado!':`🧍 Personagem ${skin.name} comprado e equipado.` }));
}

function switchSkin(pl, skinKey) { equipSkin(pl, skinKey); }

function throwBomb(pl, ws) {
  const item = UTILITIES.pingaLele;
  const now = Date.now();
  if (now - pl.lastBomb < 450) return;
  if (pl.bombs <= 0) {
    ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: 'você não tem Pinga do Lelê' }));
    return;
  }
  pl.lastBomb = now;
  pl.bombs--;
  const a = pl.angle;
  thrownBombs.push({
    id: nextBombId++, owner: pl.id,
    x: pl.x + Math.cos(a) * 30, y: pl.y + Math.sin(a) * 30,
    vx: Math.cos(a) * item.speed, vy: Math.sin(a) * item.speed,
    fuseAt: now + item.fuseMs, radius: item.radius, damage: item.damage, room: pl.room,
    travelled: 0, stopped: false
  });
  events.push({ kind: 'bombThrow', room:pl.room, x: pl.x, y: pl.y, angle: a, owner: pl.id });
}

function segmentHitsWall(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist / 10));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsWall(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2)) return true;
  }
  return false;
}

function explodeBomb(b) {
  events.push({ kind: 'bombExplosion', room:b.room, x: b.x, y: b.y, radius: b.radius });
  for (const d of ensureRoomDestructibles(b.room || ROOM_PUBLIC)) {
    if (d.hp <= 0) continue;
    const dd=Math.hypot(d.x-b.x,d.y-b.y); if(dd>b.radius)continue;
    const pdmg=Math.max(12,Math.round(b.damage*(1-Math.min(1,dd/b.radius)*.55)));
    d.hp=Math.max(0,d.hp-pdmg); events.push({kind:d.hp<=0?'destructibleBreak':'destructibleHit',room:b.room,x:d.x,y:d.y,id:d.id,objectType:d.type,hp:d.hp,maxHp:d.maxHp});
  }
  const attacker = players.get(b.owner) || null;
  for (const pl of players.values()) {
    if (!pl.connected || pl.room !== b.room || !pl.alive || isSpectating(pl)) continue;
    const d = Math.hypot(pl.x - b.x, pl.y - b.y);
    if (d > b.radius) continue;
    if (segmentHitsWall(b.x, b.y, pl.x, pl.y)) continue;
    const falloff = 1 - Math.min(1, d / b.radius) * 0.65;
    const dmg = Math.max(18, Math.round(b.damage * falloff));
    applyDamage(pl, attacker, dmg);
  }
}

function handleChat(pl, text) {
  const now = Date.now();
  if (now - pl.lastChat < 550) return;
  text = String(text || '').replace(/[\x00-\x1F\x7F]/g, ' ').slice(0, 120).trim();
  if (!text) return;
  pl.lastChat = now; chatLog.push({ room: pl.room, name: pl.name, color: pl.color, text });
}

function tryAttack(pl) {
  const w = WEAPONS[pl.weapon];
  if (!w || (w.specialSkin && pl.skin !== w.specialSkin)) return;
  const now = Date.now();
  if (now - pl.lastShot < w.cooldown) return;
  pl.lastShot = now;

  const pellets = w.pellets || 1;
  const dmg = Math.round(w.damage * levelBuff(pl.level).dmgMult);
  for (let i = 0; i < pellets; i++) {
    let a = pl.angle;
    if (w.spread) a += (Math.random() - 0.5) * w.spread * 2;
    const spawnOffset = w.wave ? 30 : 26;
    bullets.push({
      id: nextBulletId++, owner: pl.id, room: pl.room, wpn: pl.weapon, wave: !!w.wave, pierce: !!w.pierce,
      gas: !!w.gas, possessed: !!w.possessed, fire: !!w.fire,
      x: pl.x + Math.cos(a) * spawnOffset,
      y: pl.y + Math.sin(a) * spawnOffset,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      damage: dmg, dist: 0, range: w.range, hitRadius: w.hitRadius || 20,
      hitIds: new Set()
    });
  }
  events.push({ kind: 'muzzle', room:pl.room, x: pl.x, y: pl.y, angle: pl.angle, shooter: pl.id, weapon: pl.weapon });
}

function applyDamage(target, attacker, dmg) {
  if (!target.alive || isSpectating(target)) return;
  if (attacker && attacker.room !== target.room) return;
  let remaining = Math.max(0, dmg | 0);
  if (target.armor > 0 && remaining > 0) {
    const absorbed = Math.min(target.armor, remaining);
    target.armor -= absorbed; remaining -= absorbed;
    events.push({ kind:'armorHit', room:target.room, x:target.x, y:target.y, amount:absorbed });
  }
  if (remaining <= 0) return;
  target.hp -= remaining;
  events.push({ kind:'hit', room:target.room, x:target.x, y:target.y, angle:attacker ? Math.atan2(target.y-attacker.y,target.x-attacker.x) : 0 });
  if (target.hp > 0) return;
  target.alive = false; target.armor = 0; target.deaths++; target.roundDeaths++; target.combo = 0;
  if (!target.isBot) { rankingSafe(ranking.recordDeath(target)); progressSafe(progression.recordDeath(target)); }
  target.points += DEATH_REWARD;
  let killerId = null, killerName = null, combo = 0, weapon = null;
  if (attacker && attacker.id !== target.id) {
    const now=Date.now(); attacker.kills++; attacker.roundKills++;
    attacker.combo = now - (attacker.lastKillAt || 0) <= 5200 ? Math.min(99,(attacker.combo||0)+1) : 1;
    attacker.lastKillAt = now; combo = attacker.combo; killerId = attacker.id; killerName = attacker.name; weapon = attacker.weapon;
    if (!attacker.isBot && !target.isBot) { rankingSafe(ranking.recordKill(attacker)); progressSafe(progression.recordKill(attacker, attacker.weapon, combo)); }
    attacker.points += target.isBot ? 15 : KILL_REWARD;
    events.push({ kind:'kill', room:target.room, killer:attacker.id, killerName:attacker.name, victim:target.id, victimName:target.name, weapon:attacker.weapon, combo, x:attacker.x, y:attacker.y });
  }
  events.push({ kind:'death', room:target.room, victim:target.id, victimName:target.name, killer:killerId, killerName, weapon, combo, x:target.x, y:target.y, color:target.color });
  setTimeout(() => respawn(target), RESPAWN_MS);
}

function respawn(pl) {
  if (isSpectating(pl) || phase !== 'playing' || pl.alive) return; // evita respawn atrasado após votação/troca de rodada
  const sp = spawnPoint();
  pl.x = sp.x; pl.y = sp.y;
  pl.hp = pl.maxHp || MAX_HP; pl.armor = 0; pl.alive = true;
}

// ==================== SISTEMA DE VOTAÇÃO ====================
function startVoting() {
  const groups = new Map();
  for (const p of players.values()) {
    if (!p.connected || p.isBot || isSpectating(p)) continue;
    const room=p.room||ROOM_PUBLIC; if(!groups.has(room))groups.set(room,[]);
    groups.get(room).push({ id:p.id, name:p.name, rankingKey:p.rankingKey, level:p.level, isBot:false, roundKills:p.roundKills||0, roundDeaths:p.roundDeaths||0 });
  }
  for (const [room, list] of groups) {
    rankingSafe(ranking.recordRound(`${roundStartedAt}:${room}`, list));
    const placed=[...list].sort((a,b)=>(b.roundKills||0)-(a.roundKills||0)||(a.roundDeaths||0)-(b.roundDeaths||0)||a.id-b.id).map((p,i)=>({...p,place:i+1}));
    progressSafe(progression.recordRound(placed));
  }
  phase = 'voting';
  votes = {};
  bullets.length = 0; // nenhum projétil continua causando dano durante a reunião
  thrownBombs.length = 0;
  for (const pl of players.values()) resetInput(pl);
  phaseEndsAt = Date.now() + VOTE_MS;
  chatLog.push({ name: 'sistema', color: '#ffd23b', text: '🗳️ REUNIÃO! Votem em quem fica fora da próxima rodada.' });
}

function tallyVotesAndBan() {
  bannedThisRound = {};
  const rooms = activeRooms();
  for (const room of rooms) {
    const count = {};
    for (const [voterId,targetId] of Object.entries(votes)) {
      const voter=players.get(Number(voterId)); if(!voter||voter.room!==room||!targetId||targetId==='skip')continue;
      const target=players.get(Number(targetId)); if(!target||target.room!==room||target.isBot)continue;
      count[targetId]=(count[targetId]||0)+1;
    }
    let top=null,topN=0,tie=false;
    for(const id in count){if(count[id]>topN){top=id;topN=count[id];tie=false}else if(count[id]===topN)tie=true}
    if(top&&topN>0&&!tie){const pl=players.get(Number(top));if(pl&&pl.connected&&!pl.isBot){pl.spectatorUntilRound=roundNumber+1;pl.banned=true;pl.alive=false;pl.hp=0;resetInput(pl);bannedThisRound[room]={id:pl.id,name:pl.name,spectatorRound:roundNumber+1};chatLog.push({room,name:'sistema',color:'#ff3b52',text:`🚪 ${pl.name} foi ejetado e ficará 1 rodada como espectador.`})}}
    else chatLog.push({room,name:'sistema',color:'#9fc4e8',text:'Ninguém foi banido (empate ou sem votos).'});
  }
}

function nextRound() {
  // nova tela. O jogador ejetado permanece espectador durante esta rodada inteira.
  roundNumber++;
  roundStartedAt = Date.now();
  currentMapIndex = Math.floor(Math.random() * MAPS.length);
  phase = 'playing';
  phaseEndsAt = Date.now() + ROUND_MS;
  votes = {};
  bullets.length = 0;
  thrownBombs.length = 0;
  destructiblesByRoom.clear();
  resetHealthPickups();
  for (const room of activeRooms()) ensureRoomDestructibles(room);
  for (const pl of players.values()) {
    resetInput(pl);
    pl.roundKills = 0; pl.roundDeaths = 0;
    const spectating = isSpectating(pl);
    pl.banned = spectating;
    if (spectating) {
      pl.alive = false;
      pl.hp = 0;
      continue;
    }
    const sp = spawnPoint();
    pl.x = sp.x; pl.y = sp.y;
    pl.hp = pl.maxHp || MAX_HP; pl.alive = true;
  }
  const initMap = currentMap();
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'newMap', map: initMap, name: initMap.name, round: roundNumber }));
  }
  chatLog.push({ name: 'sistema', color: '#4ade5f', text: `🏠 Rodada ${roundNumber}: ${initMap.name}` });
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
  if (isSpectating(voter)) return; // espectador não vota
  if (targetId === 'skip') {
    votes[voter.id] = 'skip';
    return;
  }
  const target = players.get(Number(targetId));
  if (!target || !target.connected || target.isBot || target.room !== voter.room || target.id === voter.id || isSpectating(target)) return;
  votes[voter.id] = target.id;
}

// ==================== HEARTBEAT + SESSÃO DE 3 MIN ====================
// Se o browser dormir/fechar, o jogador some da arena mas o estado fica guardado por 3 minutos.
setInterval(() => {
  const now = Date.now();
  for (const [id, pl] of players) {
    if (pl.isBot) continue;
    if (pl.connected && now - pl.lastSeen > 15000) {
      // Força o cliente a reconectar. A sessão não é apagada, só entra em grace period.
      pl.connected = false;
      pl.disconnectedAt = now;
      resetInput(pl);
      const sock = pl.socket;
      pl.socket = null;
      try { if (sock && sock.readyState === 1) sock.close(4000, 'heartbeat timeout'); } catch {}
    } else if (!pl.connected && pl.disconnectedAt && now - pl.disconnectedAt > SESSION_GRACE_MS) {
      players.delete(id);
      if (pl.sessionToken) sessions.delete(pl.sessionToken);
    }
  }
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'ping' }));
  }
}, 4000);

// ==================== EVENTOS AMBIENTAIS ====================
const AMBIENT_EVENTS = [
  {mode:'snow',label:'❄️ Neve dos Alpes'}, {mode:'rain',label:'🌧️ Chuva forte'},
  {mode:'lightsOut',label:'💡 A energia caiu!'}, {mode:'tv',label:'📺 A TV ligou sozinha'},
  {mode:'dog',label:'🐕 Cachorro no quintal'}, {mode:'grill',label:'🔥 A churrasqueira pegou fogo'}
];
let ambientMode='snow',nextAmbientAt=Date.now()+18000;
setInterval(()=>{const now=Date.now();if(phase!=='playing'||now<nextAmbientAt)return;const ev=AMBIENT_EVENTS[Math.floor(Math.random()*AMBIENT_EVENTS.length)];ambientMode=ev.mode;events.push({kind:'ambient',room:'*',mode:ev.mode,label:ev.label});nextAmbientAt=now+22000+Math.floor(Math.random()*22000)},1000);

// ==================== LOOP PRINCIPAL ====================
const STEP = 9.6; // deslocamento por tick
setInterval(() => {
  const moving = (phase === 'playing');
  if (!moving && bullets.length) bullets.length = 0;
  // Movimento com colisão (testa eixos separadamente pra deslizar na parede)
  for (const pl of players.values()) {
    if (!pl.connected || !pl.alive || isSpectating(pl) || !moving) continue;
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

      // ondas sonoras atravessam paredes e objetos; projéteis normais colidem
      if (!b.wave) {
        const propHit = damageDestructible(b.room || ROOM_PUBLIC, b.x, b.y, b.hitRadius || 8, b.damage);
        if (propHit) { done = true; break; }
        if (hitsWall(b.x, b.y, 3)) { events.push({ kind:'spark', room:b.room, x:b.x, y:b.y }); done = true; break; }
      }

      const hitR = b.hitRadius || (b.wave ? 42 : 20);
      for (const pl of players.values()) {
        if (!pl.connected || pl.room !== (b.room || ROOM_PUBLIC) || pl.id === b.owner || !pl.alive || isSpectating(pl) || b.hitIds.has(pl.id)) continue;
        if (Math.hypot(pl.x - b.x, pl.y - b.y) < hitR) {
          applyDamage(pl, players.get(b.owner), b.damage);
          b.hitIds.add(pl.id);
          if (!b.pierce) { done = true; break; }
        }
      }
    }
    if (done || b.dist > b.range || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h) {
      bullets.splice(i, 1);
    }
  }

  // Churrasco da Mamãe Márcia: cura espalhada aleatoriamente pela arena.
  const nowTick = Date.now();
  for (const hp of healthPickups) {
    if (hp.respawnAt) {
      if (nowTick < hp.respawnAt) continue;
      const sp = spawnPoint(); hp.x = sp.x; hp.y = sp.y; hp.respawnAt = 0;
    }
    if (!moving) continue;
    for (const pl of players.values()) {
      if (!pl.connected || pl.room !== hp.room || !pl.alive || isSpectating(pl) || pl.hp >= pl.maxHp) continue;
      if (Math.hypot(pl.x - hp.x, pl.y - hp.y) > 31) continue;
      const before = pl.hp;
      pl.hp = Math.min(pl.maxHp, pl.hp + hp.heal);
      const healed = pl.hp - before;
      hp.respawnAt = nowTick + randomHealthRespawn();
      events.push({ kind: 'heal', room:hp.room, x: hp.x, y: hp.y, player: pl.id, amount: healed });
      break;
    }
  }

  // Pinga do Lelê: garrafa-bomba autoritativa, com colisão e explosão em área.
  for (let i = thrownBombs.length - 1; i >= 0; i--) {
    const b = thrownBombs[i];
    if (!b.stopped) {
      const speed = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil(speed / 7));
      const sx = b.vx / steps, sy = b.vy / steps;
      for (let st = 0; st < steps; st++) {
        const nx = b.x + sx, ny = b.y + sy;
        if (hitsWall(nx, ny, 5)) {
          b.stopped = true; b.vx = 0; b.vy = 0;
          b.fuseAt = Math.min(b.fuseAt, nowTick + 280);
          break;
        }
        b.x = nx; b.y = ny; b.travelled += Math.hypot(sx, sy);
      }
      b.vx *= 0.965; b.vy *= 0.965;
      if (Math.hypot(b.vx, b.vy) < 1.3 || b.travelled > 470) { b.stopped = true; b.vx = 0; b.vy = 0; }
    }
    if (nowTick >= b.fuseAt || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h) {
      explodeBomb(b);
      thrownBombs.splice(i, 1);
    }
  }

  // Broadcast isolado por sala. O relógio/mapa continuam compartilhados nesta primeira geração de lobbies.
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const viewer=players.get(client.playerId); if(!viewer)continue;
    const room=viewer.room||ROOM_PUBLIC;
    const roomVotes={};
    if(phase==='voting')for(const [v,t] of Object.entries(votes)){const vp=players.get(Number(v));if(vp&&vp.room===room)roomVotes[v]=t}
    const state = {
      type:'state', room, ambient:ambientMode, season:progression.season,
      players:[...players.values()].filter(p=>p.connected&&p.room===room).map(p=>({
        id:p.id,name:p.name,x:Math.round(p.x),y:Math.round(p.y),angle:+p.angle.toFixed(2),hp:p.hp,maxHp:p.maxHp,alive:p.alive,
        weapon:p.weapon,kills:p.kills,deaths:p.deaths,points:p.points,level:p.level,owned:p.owned,color:p.color,banned:p.banned,spectating:isSpectating(p),
        armor:p.armor,bombs:p.bombs,skin:p.skin,ownedSkins:p.ownedSkins,isBot:!!p.isBot,combo:p.combo||0
      })),
      bullets:bullets.filter(b=>(b.room||ROOM_PUBLIC)===room).map(b=>({x:Math.round(b.x),y:Math.round(b.y),a:+Math.atan2(b.vy,b.vx).toFixed(2),w:b.wpn,wave:b.wave?1:0,gas:b.gas?1:0,possessed:b.possessed?1:0,fire:b.fire?1:0,progress:Math.max(0,Math.min(1,b.dist/b.range))})),
      bombs:thrownBombs.filter(b=>(b.room||ROOM_PUBLIC)===room).map(b=>({id:b.id,x:Math.round(b.x),y:Math.round(b.y),a:+Math.atan2(b.vy,b.vx).toFixed(2),fuse:Math.max(0,b.fuseAt-Date.now())})),
      pickups:healthPickups.filter(h=>h.room===room&&!h.respawnAt).map(h=>({id:h.id,x:Math.round(h.x),y:Math.round(h.y),heal:h.heal,kind:'churrasco'})),
      destructibles:ensureRoomDestructibles(room).filter(d=>d.hp>0).map(d=>({id:d.id,type:d.type,x:d.x,y:d.y,hp:d.hp,maxHp:d.maxHp})),
      events:events.filter(e=>!e.room||e.room==='*'||e.room===room),
      chat:chatLog.filter(c=>!c.room||c.room===room),
      phase,timeLeft:Math.max(0,Math.round((phaseEndsAt-Date.now())/1000)),votes:phase==='voting'?roomVotes:null,
      ejected:phase==='result'?(bannedThisRound&&bannedThisRound[room]||null):null,round:roundNumber
    };
    client.send(JSON.stringify(state));
  }
  events = [];
  chatLog = [];
}, 1000 / 30);

Promise.all([ranking.init(), progression.init()]).catch(err => console.error('[boot]', err.message)).finally(() => {
  server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name} — ranking: ${ranking.isPersistent() ? 'postgres' : 'memory'} — progression: ${progression.isPersistent() ? 'postgres' : 'memory'}`));
});
