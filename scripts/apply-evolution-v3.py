from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
server_path = ROOT / 'server.js'
html_path = ROOT / 'public' / 'index.html'
pkg_path = ROOT / 'package.json'
server = server_path.read_text(encoding='utf-8')
html = html_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'[patch] anchor ausente: {label}')
    return text.replace(old, new, 1)

# -------------------- SERVER --------------------
server = replace_once(server, "const { WeeklyRanking } = require('./ranking');", "const { WeeklyRanking } = require('./ranking');\nconst { Progression } = require('./progression');", 'progression require')
server = server.replace("const BUILD = 'v4-mobile-beta-2.4-visual-overhaul';", "const BUILD = 'v5-evolution-3.0-preview';", 1)

server_block = r"const server = http\.createServer\(\(req, res\) => \{.*?\n\}\);\n\nconst wss"
new_server_block = r'''const server = http.createServer((req, res) => {
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

const wss'''
server, count = re.subn(server_block, new_server_block, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] não encontrou bloco HTTP server')

server = replace_once(server,
"const ranking = new WeeklyRanking();\nfunction rankingSafe(promise) { Promise.resolve(promise).catch(err => console.error('[ranking]', err.message)); }",
"const ranking = new WeeklyRanking();\nconst progression = new Progression();\nfunction rankingSafe(promise) { Promise.resolve(promise).catch(err => console.error('[ranking]', err.message)); }\nfunction progressSafe(promise) { Promise.resolve(promise).catch(err => console.error('[progression]', err.message)); }",
'ranking/progression init')
server = server.replace('let bannedThisRound = null;', 'let bannedThisRound = {};', 1)

server = replace_once(server, "const healthPickups = [];", "const healthPickups = [];\nconst ROOM_PUBLIC = 'PUBLIC';\nconst destructiblesByRoom = new Map();\nconst BOT_NAMES = ['Bot Márcia','Bot Pedrin','Bot Pepeu','Bot Lilika','Bot Vado'];", 'room globals')

server = replace_once(server,
"    rankingKey: '',\n    banned: false,",
"    rankingKey: '',\n    room: ROOM_PUBLIC,\n    isBot: false,\n    lastEmote: 0,\n    combo: 0,\n    lastKillAt: 0,\n    banned: false,",
'player room fields')

# Bots use the same authoritative player model, but never enter ranking/progression.
bot_anchor = "function levelBuff(level) {\n  const l = Math.max(1, level | 0);\n  return {\n    hp: MAX_HP + (l - 1) * 8,          // +8 HP por nível\n    dmgMult: 1 + (l - 1) * 0.04        // +4% de dano por nível\n  };\n}\n"
bot_extra = bot_anchor + r'''
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
'''
server = replace_once(server, bot_anchor, bot_extra, 'bot engine')

health_pattern = r"function randomHealthRespawn\(\) \{.*?\nresetHealthPickups\(\);"
health_replacement = r'''function randomHealthRespawn() {
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
resetHealthPickups();'''
server, count = re.subn(health_pattern, health_replacement, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] bloco health pickup não encontrado')

server = replace_once(server,
"  player.rankingKey = ranking.playerKey(persistentPlayerToken);\n  rankingSafe(ranking.ensurePlayer(player));",
"  player.rankingKey = ranking.playerKey(persistentPlayerToken);\n  rankingSafe(ranking.ensurePlayer(player));\n  progressSafe(progression.ensurePlayer(player));\n  ensureRoomPickups(player.room); ensureRoomDestructibles(player.room);",
'connection persistence')

server = replace_once(server,
"ws.send(JSON.stringify({ type: 'init', id, sessionToken: token, resumed, build: BUILD, world: WORLD, weapons: WEAPONS, utilities: UTILITIES, skins: SKINS, map: currentMap(), killReward: KILL_REWARD, rankingPersistent: ranking.isPersistent(), phase, timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)) }));",
"ws.send(JSON.stringify({ type: 'init', id, sessionToken: token, resumed, build: BUILD, world: WORLD, weapons: WEAPONS, utilities: UTILITIES, skins: SKINS, map: currentMap(), killReward: KILL_REWARD, rankingPersistent: ranking.isPersistent(), progressionPersistent: progression.isPersistent(), room: player.room, season: progression.season, phase, timeLeft: Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)) }));",
'init payload')

# Sync identity after setName whether or not the level changed.
server = replace_once(server,
"        }\n        break;\n      case 'pause':",
"        }\n        progressSafe(progression.updateIdentity(pl));\n        break;\n      case 'pause':",
'identity sync')

server = replace_once(server,
"      case 'rankingRequest':\n        ranking.snapshot(pl, 10).then(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ranking', ...data })); }).catch(err => console.error('[ranking]', err.message));\n        break;\n      case 'pong':",
"      case 'rankingRequest':\n        ranking.snapshot(pl, 10).then(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ranking', ...data })); }).catch(err => console.error('[ranking]', err.message));\n        break;\n      case 'profileRequest':\n        progression.snapshot(pl).then(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type:'profile', data })); }).catch(err => console.error('[progression]', err.message));\n        break;\n      case 'roomJoin':\n        joinRoom(pl, msg.room, ws);\n        break;\n      case 'emote':\n        handleEmote(pl, msg.emoji);\n        break;\n      case 'pong':",
'new websocket cases')

server = replace_once(server,
"  pl.lastChat = now; chatLog.push({ name: pl.name, color: pl.color, text });",
"  pl.lastChat = now; chatLog.push({ room: pl.room, name: pl.name, color: pl.color, text });",
'room chat')

server = replace_once(server,
"    fuseAt: now + item.fuseMs, radius: item.radius, damage: item.damage,\n    travelled: 0, stopped: false",
"    fuseAt: now + item.fuseMs, radius: item.radius, damage: item.damage, room: pl.room,\n    travelled: 0, stopped: false",
'bomb room')
server = server.replace("events.push({ kind: 'bombThrow', x: pl.x, y: pl.y, angle: a, owner: pl.id });", "events.push({ kind: 'bombThrow', room:pl.room, x: pl.x, y: pl.y, angle: a, owner: pl.id });", 1)
server = replace_once(server,
"  events.push({ kind: 'bombExplosion', x: b.x, y: b.y, radius: b.radius });\n  const attacker = players.get(b.owner) || null;\n  for (const pl of players.values()) {\n    if (!pl.connected || !pl.alive || isSpectating(pl)) continue;",
"  events.push({ kind: 'bombExplosion', room:b.room, x: b.x, y: b.y, radius: b.radius });\n  const attacker = players.get(b.owner) || null;\n  for (const pl of players.values()) {\n    if (!pl.connected || pl.room !== b.room || !pl.alive || isSpectating(pl)) continue;",
'bomb isolation')

server = replace_once(server,
"      id: nextBulletId++, owner: pl.id, wpn: pl.weapon, wave: !!w.wave, pierce: !!w.pierce,\n      gas: !!w.gas, possessed: !!w.possessed, fire: !!w.fire,",
"      id: nextBulletId++, owner: pl.id, room: pl.room, wpn: pl.weapon, wave: !!w.wave, pierce: !!w.pierce,\n      gas: !!w.gas, possessed: !!w.possessed, fire: !!w.fire,",
'bullet room')
server = server.replace("events.push({ kind: 'muzzle', x: pl.x, y: pl.y, angle: pl.angle, shooter: pl.id, weapon: pl.weapon });", "events.push({ kind: 'muzzle', room:pl.room, x: pl.x, y: pl.y, angle: pl.angle, shooter: pl.id, weapon: pl.weapon });", 1)

apply_pattern = r"function applyDamage\(target, attacker, dmg\) \{.*?\n\}\n\nfunction respawn"
apply_replacement = r'''function applyDamage(target, attacker, dmg) {
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

function respawn'''
server, count = re.subn(apply_pattern, apply_replacement, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] applyDamage não encontrado')

# Per-room round stats, so private lobbies do not compete with public placement.
start_vote_pattern = r"function startVoting\(\) \{.*?\n  phase = 'voting';"
start_vote_replacement = r'''function startVoting() {
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
  phase = 'voting';'''
server, count = re.subn(start_vote_pattern, start_vote_replacement, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] startVoting não encontrado')

# Vote tally per room.
tally_pattern = r"function tallyVotesAndBan\(\) \{.*?\n\}\n\nfunction nextRound"
tally_replacement = r'''function tallyVotesAndBan() {
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

function nextRound'''
server, count = re.subn(tally_pattern, tally_replacement, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] tallyVotes não encontrado')

server = replace_once(server,
"  const target = players.get(Number(targetId));\n  if (!target || !target.connected || target.id === voter.id || isSpectating(target)) return;",
"  const target = players.get(Number(targetId));\n  if (!target || !target.connected || target.isBot || target.room !== voter.room || target.id === voter.id || isSpectating(target)) return;",
'room vote target')

server = replace_once(server,
"  thrownBombs.length = 0;\n  resetHealthPickups();",
"  thrownBombs.length = 0;\n  destructiblesByRoom.clear();\n  resetHealthPickups();\n  for (const room of activeRooms()) ensureRoomDestructibles(room);",
'round destructible reset')

# Heartbeat must never expire synthetic bots.
server = replace_once(server, "  for (const [id, pl] of players) {\n    if (pl.connected && now - pl.lastSeen > 15000) {", "  for (const [id, pl] of players) {\n    if (pl.isBot) continue;\n    if (pl.connected && now - pl.lastSeen > 15000) {", 'bot heartbeat')

# Ambient events are cosmetic but server-authoritative, so everyone sees the same event timing.
ambient_anchor = "// ==================== LOOP PRINCIPAL ====================\nconst STEP = 9.6; // deslocamento por tick"
ambient_extra = r'''// ==================== EVENTOS AMBIENTAIS ====================
const AMBIENT_EVENTS = [
  {mode:'snow',label:'❄️ Neve dos Alpes'}, {mode:'rain',label:'🌧️ Chuva forte'},
  {mode:'lightsOut',label:'💡 A energia caiu!'}, {mode:'tv',label:'📺 A TV ligou sozinha'},
  {mode:'dog',label:'🐕 Cachorro no quintal'}, {mode:'grill',label:'🔥 A churrasqueira pegou fogo'}
];
let ambientMode='snow',nextAmbientAt=Date.now()+18000;
setInterval(()=>{const now=Date.now();if(phase!=='playing'||now<nextAmbientAt)return;const ev=AMBIENT_EVENTS[Math.floor(Math.random()*AMBIENT_EVENTS.length)];ambientMode=ev.mode;events.push({kind:'ambient',room:'*',mode:ev.mode,label:ev.label});nextAmbientAt=now+22000+Math.floor(Math.random()*22000)},1000);

// ==================== LOOP PRINCIPAL ====================
const STEP = 9.6; // deslocamento por tick'''
server = replace_once(server, ambient_anchor, ambient_extra, 'ambient engine')

# Destructibles stop normal projectiles before walls; waves remain supernatural and pass through.
server = replace_once(server,
"      // ondas sonoras atravessam paredes; projéteis normais colidem\n      if (!b.wave && hitsWall(b.x, b.y, 3)) { events.push({ kind: 'spark', x: b.x, y: b.y }); done = true; break; }",
"      // ondas sonoras atravessam paredes e objetos; projéteis normais colidem\n      if (!b.wave) {\n        const propHit = damageDestructible(b.room || ROOM_PUBLIC, b.x, b.y, b.hitRadius || 8, b.damage);\n        if (propHit) { done = true; break; }\n        if (hitsWall(b.x, b.y, 3)) { events.push({ kind:'spark', room:b.room, x:b.x, y:b.y }); done = true; break; }\n      }",
'destructible bullet collision')
server = replace_once(server,
"        if (!pl.connected || pl.id === b.owner || !pl.alive || isSpectating(pl) || b.hitIds.has(pl.id)) continue;",
"        if (!pl.connected || pl.room !== (b.room || ROOM_PUBLIC) || pl.id === b.owner || !pl.alive || isSpectating(pl) || b.hitIds.has(pl.id)) continue;",
'bullet room isolation')

# Pickups are isolated per lobby.
server = replace_once(server,
"    if (!moving) continue;\n    for (const pl of players.values()) {\n      if (!pl.connected || !pl.alive || isSpectating(pl) || pl.hp >= pl.maxHp) continue;",
"    if (!moving) continue;\n    for (const pl of players.values()) {\n      if (!pl.connected || pl.room !== hp.room || !pl.alive || isSpectating(pl) || pl.hp >= pl.maxHp) continue;",
'pickup room isolation')

# Replace one global payload with a filtered payload per connected socket.
broadcast_pattern = r"  // Broadcast\n  const state = \{.*?\n  events = \[\];\n  chatLog = \[\];"
broadcast_replacement = r'''  // Broadcast isolado por sala. O relógio/mapa continuam compartilhados nesta primeira geração de lobbies.
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
  chatLog = [];'''
server, count = re.subn(broadcast_pattern, broadcast_replacement, server, count=1, flags=re.S)
if count != 1:
    raise SystemExit('[patch] broadcast não encontrado')

server = replace_once(server,
"ranking.init().catch(err => console.error('[ranking] init:', err.message)).finally(() => {\n  server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name} — ranking: ${ranking.isPersistent() ? 'postgres' : 'memory'}`));\n});",
"Promise.all([ranking.init(), progression.init()]).catch(err => console.error('[boot]', err.message)).finally(() => {\n  server.listen(PORT, () => console.log(`DEADZONE rodando na porta ${PORT} — mapa: ${currentMap().name} — ranking: ${ranking.isPersistent() ? 'postgres' : 'memory'} — progression: ${progression.isPersistent() ? 'postgres' : 'memory'}`));\n});",
'boot persistence')

# -------------------- CLIENT HTML BRIDGE --------------------
html = replace_once(html, '<title>DEADZONE</title>', '<title>DEADZONE</title>\n<link rel="manifest" href="/manifest.webmanifest">\n<meta name="theme-color" content="#0d111a">', 'manifest')
html = replace_once(html, '<script>\nconst canvas = document.getElementById(\'game\');', '<script src="/runtime-config.js"></script>\n<script>\nconst canvas = document.getElementById(\'game\');', 'runtime config')
html = replace_once(html,
"  DPR=Math.min(window.devicePixelRatio||1,COARSE_POINTER?1.5:2);",
"  const dprCap=Number(window.DEADZONE_MAX_DPR)||(COARSE_POINTER?1.5:2); DPR=Math.min(window.devicePixelRatio||1,dprCap);",
'adaptive DPR')

connect_old = "const proto=location.protocol==='https:'?'wss':'ws',socket=new WebSocket(`${proto}://${location.host}?session=${encodeURIComponent(sessionToken)}&player=${encodeURIComponent(playerToken)}`);"
connect_new = "const override=String(window.DEADZONE_WS_URL||'').trim(),endpoint=override?new URL(override):new URL(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);endpoint.searchParams.set('session',sessionToken);endpoint.searchParams.set('player',playerToken);const socket=new WebSocket(endpoint.toString());"
html = replace_once(html, connect_old, connect_new, 'native websocket endpoint')
html = replace_once(html,
"let msg;try{msg=JSON.parse(ev.data)}catch{return}if(msg.type==='init')",
"let msg;try{msg=JSON.parse(ev.data)}catch{return}try{window.dispatchEvent(new CustomEvent('deadzone:message',{detail:msg}))}catch{}if(msg.type==='init')",
'client message bridge')

zoom_pattern = r"function getGameZoom\(\) \{\n  const mobile = W <= 820 \|\| \(window\.matchMedia && window\.matchMedia\('\(pointer: coarse\)'\)\.matches\);\n  if \(!mobile\) return 0\.72;\n  return H >= W \? 0\.82 : 0\.74; // portrait é o alvo principal; player/mapa ficam mais legíveis\n\}"
zoom_repl = "function getGameZoom() {\n  const mobile = W <= 820 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);\n  const base = !mobile ? 0.72 : (H >= W ? 0.82 : 0.74);\n  return base * (1 + Math.max(0,Math.min(.08,Number(window.DEADZONE_ZOOM_BOOST)||0)));\n}"
html, count = re.subn(zoom_pattern, zoom_repl, html, count=1)
if count != 1:
    raise SystemExit('[patch] getGameZoom não encontrado')

html = replace_once(html,
"  let camX = meX - viewW / 2;\n  let camY = meY - viewH / 2;\n  // clamp:",
"  let camX = meX - viewW / 2;\n  let camY = meY - viewH / 2;\n  if(meRaw&&!meRaw.spectating&&meRaw.alive){camX+=Math.cos(myAngle)*(COARSE_POINTER?54:72);camY+=Math.sin(myAngle)*(COARSE_POINTER?34:46)}\n  // clamp:",
'camera look ahead')
html = replace_once(html,
"  const me = meRaw; // alias p/ o resto do código (dados: hp, weapon, etc.)",
"  window.__DZ_FRAME={camX,camY,zoom:ZOOM,viewW,viewH,meX,meY,w:W,h:H,dpr:DPR};\n  const me = meRaw; // alias p/ o resto do código (dados: hp, weapon, etc.)",
'frame bridge')

bridge_code = r'''window.DEADZONE_BRIDGE={
  getState:()=>state,getMe:()=>myData,getMyId:()=>myId,getWeapons:()=>weapons,getMap:()=>gameMap,getFrame:()=>window.__DZ_FRAME||null,
  send:(msg)=>send(msg),flash:(text)=>flashMsg(text),setMaxDpr:(value)=>{window.DEADZONE_MAX_DPR=Number(value)||1;resize()},
  openPractice:()=>{location.href='/practice.html'}
};
draw();'''
html = replace_once(html, 'draw();\n</script>\n</body>', bridge_code + '\n</script>\n<script src="/evolution-v3.js"></script>\n</body>', 'evolution bundle')

server_path.write_text(server, encoding='utf-8')
html_path.write_text(html, encoding='utf-8')

pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = '2.0.0-preview.1'
pkg['description'] = 'DEADZONE Evolution V3 - multiplayer top-down, ranking, progression, private rooms and offline training'
pkg.setdefault('scripts', {})['build:client'] = 'esbuild client-v3/src/evolution.ts --bundle --minify --format=iife --target=es2020 --outfile=public/evolution-v3.js'
pkg['scripts']['test:syntax'] = "node --check server.js && node --check progression.js && node --check public/practice.js"
pkg['scripts']['cap:sync'] = 'npm run build:client && cap sync'
pkg['engines'] = {'node': '>=20'}
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('[patch] Evolution V3 integrado com sucesso')
