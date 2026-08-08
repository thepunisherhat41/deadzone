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
let bannedThisRound = null;     // dados do ejetado na última votação
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
  capivara: { name: 'Capivara', icon: 'capybara', cost: 15, description: 'Capivara dos Alpes. Mesmas hitbox e velocidade dos demais.' },
  bubu: { name: 'Bubu', icon: 'bubu', cost: 60, power: 'dracarys', description: 'Bubu grávida. Desbloqueia o poder exclusivo Dracarys 🔥 (bola de fogo que explode).' }
};

const WEAPONS = {
  chinelo: {
    name: 'Chinelo', emoji: '🩴', icon: 'chinelo', cost: 0,
    damage: 24, cooldown: 320, speed: 15, range: 520, pellets: 1, hitRadius: 19,
    tint: '#ff5fa2', description: 'Arremesso médio, simples e confiável.'
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
  },
  peido: {
    name: 'Peido do Pepeu', emoji: '💨', icon: 'peido', cost: 40,
    damage: 10, cooldown: 480, speed: 7, range: 190, pellets: 3, spread: 0.55, hitRadius: 26,
    tint: '#c7e59a', gas: true,
    description: 'Nuvem de gás fedorento. Curtíssimo alcance, mas garante o corpo a corpo.'
  },
  lilika: {
    name: 'Lilika Possuída', emoji: '👹', icon: 'lilika', cost: 360,
    damage: 34, cooldown: 720, speed: 16, range: 720, pellets: 1, hitRadius: 26,
    tint: '#d94f8a', spin: true,
    description: 'Arremessa uma criança possuída girando pela arena. Dano alto.'
  },
  dracarys: {
    name: 'Dracarys da Bubu', emoji: '🔥', icon: 'dracarys', cost: 0,
    damage: 30, cooldown: 900, speed: 13, range: 620, pellets: 1, hitRadius: 24,
    tint: '#ff6a1a', fireball: true, explodeRadius: 90, explodeDamage: 22,
    exclusive: 'bubu',
    description: 'Poder exclusivo da Bubu. Bola de fogo que explode ao acertar, causando dano em área.'
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
let nextBombId = 1;
const thrownBombs = [];

// ==================== CHURRASCO DA MAMÃE MÁRCIA (pickups de HP) ====================
const BBQ_HEAL = 30;        // quanto cura
const BBQ_COUNT = 5;        // quantos no mapa
const BBQ_RESPAWN_MS = 12000; // tempo pra reaparecer após coletado
let churrascos = [];        // { id, x, y, active, respawnAt }
let nextBbqId = 1;

function spawnChurrascos() {
  churrascos = [];
  for (let i = 0; i < BBQ_COUNT; i++) {
    const p = spawnPoint();
    churrascos.push({ id: nextBbqId++, x: p.x, y: p.y, active: true, respawnAt: 0 });
  }
}

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
    skin: 'bean',
    ownedSkins: { bean: true },
    armor: 0,
    bombs: 0,
    points: 0,                   // moeda pra comprar
    level: 1,                    // nível (informado pelo cliente, vem do localStorage)
    kills: 0, deaths: 0,
    banned: false,               // compatibilidade de UI: true enquanto estiver espectador
    spectatorUntilRound: 0,       // número da última rodada em que deve ficar fora
    lastShot: 0,
    lastBomb: 0,
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

function isSpectating(pl) {
  return !!pl && pl.spectatorUntilRound >= roundNumber;
}

function resetInput(pl) {
  pl.input = { up: false, down: false, left: false, right: false };
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = makePlayer(id, null);
  players.set(id, player);
  ws.playerId = id;

  ws.send(JSON.stringify({ type: 'init', id, world: WORLD, weapons: WEAPONS, utilities: UTILITIES, skins: SKINS, map: currentMap(), killReward: KILL_REWARD, phase, timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)) }));

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
        if (pl.alive && !isSpectating(pl) && phase === 'playing') {
          const i = msg.input || {};
          pl.input = { up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right };
          if (Number.isFinite(msg.angle)) pl.angle = Math.atan2(Math.sin(msg.angle), Math.cos(msg.angle));
        }
        break;
      case 'switchWeapon':
        if (WEAPONS[msg.weapon] && canUseWeapon(pl, msg.weapon)) pl.weapon = msg.weapon;
        break;
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
        if (pl.alive && !isSpectating(pl) && phase === 'playing') throwBomb(pl, ws);
        break;
      case 'attack':
        if (pl.alive && !isSpectating(pl) && phase === 'playing') tryAttack(pl);
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

function canUseWeapon(pl, weaponKey) {
  const w = WEAPONS[weaponKey];
  if (!w) return false;
  // arma exclusiva de skin: só se estiver com aquela skin equipada
  if (w.exclusive) return pl.skin === w.exclusive;
  return !!pl.owned[weaponKey];
}

function buyWeapon(pl, weaponKey, ws) {
  const w = WEAPONS[weaponKey];
  if (!w) return;
  if (w.exclusive) {   // armas exclusivas não se compram aqui; vêm com a skin
    ws.send(JSON.stringify({ type: 'buyResult', ok: false, reason: 'poder exclusivo de personagem' }));
    return;
  }
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

function buySkin(pl, skinKey, ws) {
  const skin = SKINS[skinKey];
  if (!skin || skinKey === 'bean') return;
  if (pl.ownedSkins[skinKey]) {
    pl.skin = skinKey; syncSkinPower(pl);
    ws.send(JSON.stringify({ type: 'shopResult', ok: true, kind: 'skin', skin: skinKey, message: `🧍 ${skin.name} equipado.` }));
    return;
  }
  if (pl.points < skin.cost) {
    ws.send(JSON.stringify({ type: 'shopResult', ok: false, reason: 'pontos insuficientes' }));
    return;
  }
  pl.points -= skin.cost;
  pl.ownedSkins[skinKey] = true;
  pl.skin = skinKey; syncSkinPower(pl);
  ws.send(JSON.stringify({ type: 'shopResult', ok: true, kind: 'skin', skin: skinKey, message: `🧍 Personagem ${skin.name} comprado e equipado.` }));
}

function syncSkinPower(pl) {
  const skin = SKINS[pl.skin];
  const powerWeapon = skin && skin.power;
  // libera a arma de poder da skin atual
  if (powerWeapon && WEAPONS[powerWeapon]) pl.owned[powerWeapon] = true;
  // remove armas exclusivas de outras skins e desequipa se necessário
  for (const wk in WEAPONS) {
    const w = WEAPONS[wk];
    if (w.exclusive && w.exclusive !== pl.skin) {
      delete pl.owned[wk];
      if (pl.weapon === wk) pl.weapon = 'chinelo';
    }
  }
}

function switchSkin(pl, skinKey) {
  if (SKINS[skinKey] && pl.ownedSkins[skinKey]) { pl.skin = skinKey; syncSkinPower(pl); }
}

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
    fuseAt: now + item.fuseMs, radius: item.radius, damage: item.damage,
    travelled: 0, stopped: false
  });
  events.push({ kind: 'bombThrow', x: pl.x, y: pl.y, angle: a, owner: pl.id });
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
  events.push({ kind: 'bombExplosion', x: b.x, y: b.y, radius: b.radius });
  const attacker = players.get(b.owner) || null;
  for (const pl of players.values()) {
    if (!pl.alive || isSpectating(pl)) continue;
    const d = Math.hypot(pl.x - b.x, pl.y - b.y);
    if (d > b.radius) continue;
    if (segmentHitsWall(b.x, b.y, pl.x, pl.y)) continue;
    const falloff = 1 - Math.min(1, d / b.radius) * 0.65;
    const dmg = Math.max(18, Math.round(b.damage * falloff));
    applyDamage(pl, attacker, dmg);
  }
}

function handleChat(pl, text) {
  text = String(text || '').slice(0, 120).trim();
  if (!text) return;
  chatLog.push({ name: pl.name, color: pl.color, text });
}

function tryAttack(pl) {
  const w = WEAPONS[pl.weapon];
  if (!w) return;
  if (!canUseWeapon(pl, pl.weapon)) return; // ex.: Dracarys só com a skin Bubu
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
      id: nextBulletId++, owner: pl.id, wpn: pl.weapon, wave: !!w.wave, pierce: !!w.pierce,
      x: pl.x + Math.cos(a) * spawnOffset,
      y: pl.y + Math.sin(a) * spawnOffset,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      damage: dmg, dist: 0, range: w.range, hitRadius: w.hitRadius || 20,
      fireball: !!w.fireball, explodeRadius: w.explodeRadius || 0, explodeDamage: w.explodeDamage || 0,
      hitIds: new Set()
    });
  }
  events.push({ kind: 'muzzle', x: pl.x, y: pl.y, angle: pl.angle, shooter: pl.id, weapon: pl.weapon });
}

function applyDamage(target, attacker, dmg) {
  if (!target.alive || isSpectating(target)) return;
  let remaining = Math.max(0, dmg | 0);
  if (target.armor > 0 && remaining > 0) {
    const absorbed = Math.min(target.armor, remaining);
    target.armor -= absorbed;
    remaining -= absorbed;
    events.push({ kind: 'armorHit', x: target.x, y: target.y, amount: absorbed });
  }
  if (remaining <= 0) return;
  target.hp -= remaining;
  events.push({ kind: 'hit', x: target.x, y: target.y, angle: attacker ? Math.atan2(target.y - attacker.y, target.x - attacker.x) : 0 });
  if (target.hp <= 0) {
    target.alive = false;
    target.armor = 0;
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
  if (isSpectating(pl) || phase !== 'playing' || pl.alive) return; // evita respawn atrasado após votação/troca de rodada
  const sp = spawnPoint();
  pl.x = sp.x; pl.y = sp.y;
  pl.hp = pl.maxHp || MAX_HP; pl.armor = 0; pl.alive = true;
}

// ==================== SISTEMA DE VOTAÇÃO ====================
function startVoting() {
  phase = 'voting';
  votes = {};
  bullets.length = 0; // nenhum projétil continua causando dano durante a reunião
  thrownBombs.length = 0;
  for (const pl of players.values()) resetInput(pl);
  phaseEndsAt = Date.now() + VOTE_MS;
  chatLog.push({ name: 'sistema', color: '#ffd23b', text: '🗳️ REUNIÃO! Votem em quem fica fora da próxima rodada.' });
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
      pl.spectatorUntilRound = roundNumber + 1; // fica fora da próxima rodada inteira
      pl.banned = true;
      pl.alive = false;
      pl.hp = 0;
      resetInput(pl);
      bannedThisRound = { id: pl.id, name: pl.name, spectatorRound: roundNumber + 1 };
      chatLog.push({ name: 'sistema', color: '#ff3b52', text: `🚪 ${pl.name} foi ejetado e ficará 1 rodada como espectador.` });
    }
  } else {
    chatLog.push({ name: 'sistema', color: '#9fc4e8', text: 'Ninguém foi banido (empate ou sem votos).' });
  }
}

function nextRound() {
  // nova tela. O jogador ejetado permanece espectador durante esta rodada inteira.
  roundNumber++;
  currentMapIndex = Math.floor(Math.random() * MAPS.length);
  phase = 'playing';
  phaseEndsAt = Date.now() + ROUND_MS;
  votes = {};
  bullets.length = 0;
  thrownBombs.length = 0;
  spawnChurrascos(); // novos churrascos na nova tela
  for (const pl of players.values()) {
    resetInput(pl);
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
  if (!target || target.id === voter.id || isSpectating(target)) return;
  votes[voter.id] = target.id;
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
  if (!moving && bullets.length) bullets.length = 0;
  // Movimento com colisão (testa eixos separadamente pra deslizar na parede)
  for (const pl of players.values()) {
    if (!pl.alive || isSpectating(pl) || !moving) continue;
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

  // ---- Churrasco: coleta (cura) autoritativa + respawn ----
  if (moving) {
    const now = Date.now();
    for (const bbq of churrascos) {
      if (!bbq.active) {
        if (now >= bbq.respawnAt) { const sp = spawnPoint(); bbq.x = sp.x; bbq.y = sp.y; bbq.active = true; }
        continue;
      }
      for (const pl of players.values()) {
        if (!pl.alive || isSpectating(pl)) continue;
        if (pl.hp >= (pl.maxHp || MAX_HP)) continue; // não desperdiça em quem está cheio
        if (Math.hypot(pl.x - bbq.x, pl.y - bbq.y) < 30) {
          pl.hp = Math.min(pl.maxHp || MAX_HP, pl.hp + BBQ_HEAL);
          bbq.active = false; bbq.respawnAt = now + BBQ_RESPAWN_MS;
          events.push({ kind: 'heal', x: pl.x, y: pl.y, id: pl.id });
          break;
        }
      }
    }
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
      if (!b.wave && hitsWall(b.x, b.y, 3)) {
        if (!b.fireball) events.push({ kind: 'spark', x: b.x, y: b.y });
        done = true; break;
      }

      const hitR = b.hitRadius || (b.wave ? 42 : 20);
      for (const pl of players.values()) {
        if (pl.id === b.owner || !pl.alive || isSpectating(pl) || b.hitIds.has(pl.id)) continue;
        if (Math.hypot(pl.x - b.x, pl.y - b.y) < hitR) {
          applyDamage(pl, players.get(b.owner), b.damage);
          b.hitIds.add(pl.id);
          if (!b.pierce) { done = true; break; }
        }
      }
    }
    const ended = done || b.dist > b.range || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h;
    if (ended) {
      // Dracarys: bola de fogo explode em área ao terminar
      if (b.fireball && b.explodeRadius > 0) {
        events.push({ kind: 'fireExplosion', x: b.x, y: b.y, radius: b.explodeRadius });
        const attacker = players.get(b.owner) || null;
        for (const pl of players.values()) {
          if (!pl.alive || isSpectating(pl) || pl.id === b.owner) continue;
          const d = Math.hypot(pl.x - b.x, pl.y - b.y);
          if (d > b.explodeRadius) continue;
          if (segmentHitsWall(b.x, b.y, pl.x, pl.y)) continue;
          if (b.hitIds.has(pl.id)) continue; // não soma dano no alvo direto duas vezes
          const falloff = 1 - Math.min(1, d / b.explodeRadius) * 0.6;
          applyDamage(pl, attacker, Math.max(8, Math.round(b.explodeDamage * falloff)));
        }
      }
      bullets.splice(i, 1);
    }
  }

  // Pinga do Lelê: garrafa-bomba autoritativa, com colisão e explosão em área.
  const nowTick = Date.now();
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

  // Broadcast
  const state = {
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      angle: +p.angle.toFixed(2), hp: p.hp, maxHp: p.maxHp, alive: p.alive,
      weapon: p.weapon, kills: p.kills, deaths: p.deaths, points: p.points,
      level: p.level, owned: p.owned, color: p.color, banned: p.banned, spectating: isSpectating(p),
      armor: p.armor, bombs: p.bombs, skin: p.skin, ownedSkins: p.ownedSkins
    })),
    bullets: bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), a: +Math.atan2(b.vy, b.vx).toFixed(2), w: b.wpn, wave: b.wave ? 1 : 0, progress: Math.max(0, Math.min(1, b.dist / b.range)) })),
    bombs: thrownBombs.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), a: +Math.atan2(b.vy, b.vx).toFixed(2), fuse: Math.max(0, b.fuseAt - Date.now()) })),
    bbq: churrascos.filter(c => c.active).map(c => ({ x: Math.round(c.x), y: Math.round(c.y) })),
    events,
    chat: chatLog,
    phase,
    timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)),
    votes: phase === 'voting' ? votes : null,
    ejected: phase === 'result' ? bannedThisRound : null,
    round: roundNumber
  };
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  events = [];
  chatLog = [];
}, 1000 / 30);

spawnChurrascos();
server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name}`));
