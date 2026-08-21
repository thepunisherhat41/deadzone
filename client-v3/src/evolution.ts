import { Application, Graphics } from 'pixi.js';

type QualityTier = 'economy' | 'normal' | 'high' | 'ultra';
type AnyObj = Record<string, any>;

declare global {
  interface Window {
    DEADZONE_BRIDGE?: AnyObj;
    __DZ_FRAME?: AnyObj;
    DEADZONE_MAX_DPR?: number;
    DEADZONE_ZOOM_BOOST?: number;
    DEADZONE_EVOLUTION_BUILD?: string;
  }
}

window.DEADZONE_EVOLUTION_BUILD = 'evolution-v3.0';

const QUALITY: Record<QualityTier, { dpr: number; particles: number; label: string }> = {
  economy: { dpr: 1, particles: 45, label: 'ECONOMIA' },
  normal: { dpr: 1.25, particles: 85, label: 'NORMAL' },
  high: { dpr: 1.5, particles: 140, label: 'ALTO' },
  ultra: { dpr: 2, particles: 220, label: 'ULTRA' }
};

const qKeys = Object.keys(QUALITY) as QualityTier[];
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const bridge = () => window.DEADZONE_BRIDGE || null;
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

function detectQuality(): QualityTier {
  const mem = Number((navigator as any).deviceMemory || 4);
  const cores = Number(navigator.hardwareConcurrency || 4);
  const pixels = Math.max(1, window.devicePixelRatio || 1) * innerWidth * innerHeight;
  if (mem <= 2 || cores <= 4 || pixels > 5_500_000) return 'economy';
  if (mem <= 4 || cores <= 6) return 'normal';
  if (mem >= 8 && cores >= 8 && pixels < 5_000_000) return 'ultra';
  return 'high';
}

let quality = (localStorage.getItem('deadzone_quality') as QualityTier) || detectQuality();
if (!qKeys.includes(quality)) quality = detectQuality();
let ambientEnabled = localStorage.getItem('deadzone_ambient') !== '0';
let cinematicEnabled = localStorage.getItem('deadzone_cinematic') !== '0';

function applyQuality(next: QualityTier) {
  quality = next;
  localStorage.setItem('deadzone_quality', quality);
  window.DEADZONE_MAX_DPR = QUALITY[quality].dpr;
  bridge()?.setMaxDpr?.(QUALITY[quality].dpr);
  const label = $('#evoQualityLabel');
  if (label) label.textContent = QUALITY[quality].label;
}

const css = `
#evoCanvas{position:fixed;inset:0;z-index:7;pointer-events:none;width:100%;height:100%;}
#evoDock{position:fixed;right:max(12px,env(safe-area-inset-right));top:42%;z-index:24;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:system-ui,sans-serif}
#evoDockMain,#evoDockMenu button{border:1px solid rgba(255,255,255,.13);background:linear-gradient(180deg,rgba(30,36,52,.96),rgba(8,11,18,.96));color:#fff;box-shadow:0 9px 24px rgba(0,0,0,.38);font-weight:900}
#evoDockMain{width:48px;height:48px;border-radius:16px;font-size:20px}
#evoDockMenu{display:none;flex-direction:column;gap:7px;align-items:flex-end}#evoDock.open #evoDockMenu{display:flex}
#evoDockMenu button{width:44px;height:44px;border-radius:14px;font-size:18px}
#evoKillFeed{position:fixed;top:max(150px,calc(env(safe-area-inset-top) + 132px));left:50%;transform:translateX(-50%);z-index:19;width:min(92vw,460px);display:flex;flex-direction:column;gap:5px;pointer-events:none;font-family:system-ui,sans-serif}
.evoKill{align-self:center;background:rgba(6,9,15,.82);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:6px 11px;color:#dce9f7;font-size:11px;font-weight:800;box-shadow:0 8px 20px rgba(0,0,0,.28);animation:evoIn .18s ease-out}
.evoKill.me{color:#ffe16a;border-color:rgba(255,210,59,.32)}
#evoCombo{position:fixed;left:50%;top:34%;transform:translate(-50%,-50%) scale(.8);z-index:22;color:#ffe16a;font:1000 clamp(30px,8vw,64px)/1 system-ui,sans-serif;text-shadow:0 0 25px rgba(255,210,59,.45),4px 4px 0 #000;opacity:0;pointer-events:none;transition:.18s}
#evoCombo.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#evoWorldLabels{position:fixed;inset:0;z-index:18;pointer-events:none;overflow:hidden}.evoEmoji{position:absolute;font-size:30px;filter:drop-shadow(0 4px 4px rgba(0,0,0,.55));animation:evoFloat 1.8s ease-out forwards}
.evoModal{position:fixed;inset:0;z-index:35;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,5,10,.76);font-family:system-ui,sans-serif}.evoModal.show{display:flex}
.evoCard{width:min(94vw,440px);max-height:84dvh;overflow:auto;background:linear-gradient(180deg,#181e2b,#080c14);border:1px solid rgba(127,224,255,.20);border-radius:22px;padding:18px;color:#eaf3fb;box-shadow:0 30px 90px rgba(0,0,0,.65)}
.evoHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.evoHead h2{font-size:18px;color:#ffd23b}.evoClose{border:0;background:#2b3344;color:#fff;width:38px;height:38px;border-radius:12px;font-size:18px}
.evoCard input,.evoCard select{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0d1320;color:#fff;margin:7px 0 10px}.evoPrimary{width:100%;padding:12px;border:0;border-radius:12px;background:linear-gradient(180deg,#ff5669,#df263d);color:#fff;font-weight:950}.evoSecondary{width:100%;padding:11px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#182031;color:#dce9f7;font-weight:850;margin-top:7px}
.evoStats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0}.evoStat{padding:10px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06)}.evoStat b{display:block;font-size:19px;color:#fff}.evoStat small{color:#91a7bd}
.evoChallenge{padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.04);margin-top:7px}.evoBar{height:6px;background:#111827;border-radius:99px;overflow:hidden;margin-top:5px}.evoBar i{display:block;height:100%;background:linear-gradient(90deg,#7fe0ff,#ffd23b)}
.evoEmotes{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.evoEmotes button{height:58px;border-radius:15px;border:1px solid rgba(255,255,255,.10);background:#111827;font-size:28px}
.evoToggle{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
#evoToast{position:fixed;left:50%;bottom:calc(max(18px,env(safe-area-inset-bottom)) + 140px);transform:translateX(-50%);z-index:40;background:rgba(5,9,16,.94);border:1px solid rgba(127,224,255,.22);color:#e8f5ff;padding:9px 13px;border-radius:999px;font:850 11px system-ui;opacity:0;pointer-events:none;transition:.2s;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis}#evoToast.show{opacity:1}
#evoReplayWrap{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:31;display:none;width:min(86vw,420px);background:rgba(3,6,11,.95);border:1px solid rgba(255,59,82,.45);border-radius:18px;padding:9px;box-shadow:0 25px 65px rgba(0,0,0,.6);pointer-events:none}#evoReplayWrap.show{display:block}#evoReplayWrap strong{display:block;color:#ff6b7c;font:950 11px system-ui;letter-spacing:1.7px;margin:0 0 6px 4px}#evoReplay{width:100%;height:auto;border-radius:12px;background:#0c111a;display:block}
@keyframes evoIn{from{opacity:0;transform:translateY(-8px) scale(.94)}to{opacity:1;transform:none}}@keyframes evoFloat{0%{opacity:0;transform:translate(-50%,0) scale(.7)}15%{opacity:1}100%{opacity:0;transform:translate(-50%,-70px) scale(1.15)}}
@media(max-width:820px),(pointer:coarse){#evoDock{top:auto;bottom:calc(max(18px,env(safe-area-inset-bottom)) + 210px)}#evoDockMain{width:44px;height:44px}#evoDockMenu button{width:40px;height:40px}.evoCard{padding:15px}}
`;

function injectUi() {
  if ($('#evoDock')) return;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const html = `
    <div id="evoKillFeed"></div><div id="evoCombo"></div><div id="evoWorldLabels"></div><div id="evoToast"></div>
    <div id="evoReplayWrap"><strong>REPLAY DA MORTE</strong><canvas id="evoReplay" width="640" height="300"></canvas></div>
    <div id="evoDock"><div id="evoDockMenu">
      <button data-evo="profile" title="Perfil e temporada">👤</button><button data-evo="room" title="Sala privada">🔐</button><button data-evo="emote" title="Emotes">😎</button><button data-evo="settings" title="Gráficos">⚙️</button><button data-evo="practice" title="Treino offline">🤖</button>
    </div><button id="evoDockMain" aria-label="Abrir menu Evolution">⚡</button></div>
    <div id="evoProfile" class="evoModal"><div class="evoCard"><div class="evoHead"><h2>👤 PERFIL</h2><button class="evoClose">✕</button></div><div id="evoProfileBody">Carregando...</div></div></div>
    <div id="evoRoom" class="evoModal"><div class="evoCard"><div class="evoHead"><h2>🔐 SALA PRIVADA</h2><button class="evoClose">✕</button></div><div id="evoRoomNow">Sala atual: PÚBLICA</div><input id="evoRoomCode" maxlength="8" placeholder="Código, ex: CASA859"><button id="evoRoomJoin" class="evoPrimary">ENTRAR / CRIAR SALA</button><button id="evoRoomPublic" class="evoSecondary">VOLTAR PARA PÚBLICA</button><small style="display:block;color:#8fa6bd;margin-top:10px">Compartilhe o mesmo código com os amigos. O servidor isola jogadores, tiros e objetos por sala.</small></div></div>
    <div id="evoEmote" class="evoModal"><div class="evoCard"><div class="evoHead"><h2>😎 EMOTES</h2><button class="evoClose">✕</button></div><div class="evoEmotes">${['😂','💩','🍺','❤️','🔥','😈','🩴','📣','🤡','😎','🤰','🐹'].map(e=>`<button data-emote="${e}">${e}</button>`).join('')}</div></div></div>
    <div id="evoSettings" class="evoModal"><div class="evoCard"><div class="evoHead"><h2>⚙️ GRÁFICOS</h2><button class="evoClose">✕</button></div><label>Qualidade</label><select id="evoQuality">${qKeys.map(k=>`<option value="${k}">${QUALITY[k].label}</option>`).join('')}</select><div class="evoToggle"><span>🎥 Câmera cinematográfica</span><input id="evoCinematic" type="checkbox"></div><div class="evoToggle"><span>❄️ Efeitos ambientais</span><input id="evoAmbient" type="checkbox"></div><p style="color:#91a7bd;font-size:11px;margin-top:12px">Modo automático considera memória, CPU, resolução e pode reduzir DPR e partículas em aparelhos mais fracos.</p><div style="margin-top:10px;color:#ffd23b;font-weight:900">Atual: <span id="evoQualityLabel"></span></div></div></div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  $('#evoDockMain')?.addEventListener('click', () => { $('#evoDock')?.classList.toggle('open'); initAudio(); });
  document.querySelectorAll<HTMLButtonElement>('[data-evo]').forEach(btn => btn.addEventListener('click', () => {
    $('#evoDock')?.classList.remove('open');
    const action = btn.dataset.evo;
    if (action === 'practice') { location.href = '/practice.html'; return; }
    if (action === 'profile') { showModal('#evoProfile'); bridge()?.send?.({ type: 'profileRequest' }); }
    if (action === 'room') showModal('#evoRoom');
    if (action === 'emote') showModal('#evoEmote');
    if (action === 'settings') showModal('#evoSettings');
  }));
  document.querySelectorAll<HTMLButtonElement>('.evoClose').forEach(btn => btn.addEventListener('click', () => btn.closest('.evoModal')?.classList.remove('show')));
  document.querySelectorAll<HTMLElement>('.evoModal').forEach(m => m.addEventListener('pointerdown', e => { if (e.target === m) m.classList.remove('show'); }));
  document.querySelectorAll<HTMLButtonElement>('[data-emote]').forEach(btn => btn.addEventListener('click', () => {
    bridge()?.send?.({ type: 'emote', emoji: btn.dataset.emote });
    $('#evoEmote')?.classList.remove('show');
  }));
  $('#evoRoomJoin')?.addEventListener('click', () => {
    const code = ($('#evoRoomCode') as HTMLInputElement | null)?.value || '';
    bridge()?.send?.({ type: 'roomJoin', room: code });
  });
  $('#evoRoomPublic')?.addEventListener('click', () => bridge()?.send?.({ type: 'roomJoin', room: 'PUBLIC' }));
  const select = $('#evoQuality') as HTMLSelectElement | null; if (select) { select.value = quality; select.addEventListener('change', () => applyQuality(select.value as QualityTier)); }
  const cine = $('#evoCinematic') as HTMLInputElement | null; if (cine) { cine.checked = cinematicEnabled; cine.addEventListener('change', () => { cinematicEnabled = cine.checked; localStorage.setItem('deadzone_cinematic', cine.checked ? '1' : '0'); }); }
  const amb = $('#evoAmbient') as HTMLInputElement | null; if (amb) { amb.checked = ambientEnabled; amb.addEventListener('change', () => { ambientEnabled = amb.checked; localStorage.setItem('deadzone_ambient', amb.checked ? '1' : '0'); }); }
  applyQuality(quality);
}

function showModal(sel: string) { $(sel)?.classList.add('show'); }
let toastTimer = 0;
function toast(text: string) {
  const el = $('#evoToast'); if (!el) return; el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

function renderProfile(data: AnyObj) {
  const body = $('#evoProfileBody'); if (!body) return;
  const p = data?.profile || {};
  const season = data?.season || {};
  const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : String(p.kills || 0);
  const weaponName = p.favoriteWeapon ? (bridge()?.getWeapons?.()?.[p.favoriteWeapon]?.name || p.favoriteWeapon) : 'Ainda não definido';
  body.innerHTML = `
    <div style="color:#9fc4e8;font-size:11px;font-weight:850">${esc(season.name || 'Temporada atual')}</div>
    <h3 style="font-size:22px;margin:3px 0 8px">${esc(p.displayName || 'Player')} <span style="color:#ffd23b">Lv${Number(p.level || 1)}</span></h3>
    <div class="evoStats"><div class="evoStat"><b>${Number(p.kills || 0)}</b><small>Kills</small></div><div class="evoStat"><b>${Number(p.wins || 0)}</b><small>Vitórias</small></div><div class="evoStat"><b>${kd}</b><small>K/D</small></div><div class="evoStat"><b>${Number(p.bestCombo || 0)}x</b><small>Melhor combo</small></div></div>
    <div style="font-size:12px;color:#b7c7d8">🎯 Arma favorita: <b style="color:white">${esc(weaponName)}</b><br>🎮 Partidas: <b style="color:white">${Number(p.matches || 0)}</b></div>
    <h4 style="margin-top:15px;color:#ffd23b">DESAFIOS</h4>
    ${(data?.challenges || []).map((c: AnyObj) => `<div class="evoChallenge"><div>${c.complete ? '✅' : '🎯'} ${esc(c.label)}</div><div class="evoBar"><i style="width:${Math.min(100, (Number(c.progress || 0) / Math.max(1, Number(c.target || 1))) * 100)}%"></i></div><small>${Number(c.progress || 0)}/${Number(c.target || 0)}</small></div>`).join('')}
    <div style="margin-top:12px;color:${data?.persistent ? '#8ef3a1' : '#ffe080'};font-size:10px">${data?.persistent ? '● Perfil persistente em PostgreSQL' : '● Perfil temporário até DATABASE_URL estar ativo'}</div>`;
}

let currentRoom = 'PUBLIC';
function renderRoom(room: string) {
  currentRoom = room || 'PUBLIC';
  const now = $('#evoRoomNow'); if (now) now.innerHTML = `Sala atual: <b style="color:#ffd23b">${esc(currentRoom)}</b>`;
  if (currentRoom !== 'PUBLIC') toast(`Sala ${currentRoom} ativa. Compartilhe o código.`); else toast('Você voltou para a sala pública.');
}

let audioCtx: AudioContext | null = null;
function initAudio() {
  if (!audioCtx) { try { audioCtx = new AudioContext(); } catch {} }
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
}
function tone(freq: number, dur = .08, vol = .035) {
  if (!audioCtx) return; const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
  o.frequency.setValueAtTime(freq, t); o.type = 'triangle'; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
}
function killSound(combo: number) { initAudio(); tone(520 + combo * 70, .08, .04); setTimeout(() => tone(780 + combo * 60, .1, .035), 55); }

function addKillFeed(e: AnyObj, state: AnyObj) {
  const feed = $('#evoKillFeed'); if (!feed) return;
  const killer = e.killerName || state?.players?.find((p: AnyObj) => p.id === e.killer)?.name || 'Alguém';
  const victim = e.victimName || state?.players?.find((p: AnyObj) => p.id === e.victim)?.name || 'alvo';
  const weapon = bridge()?.getWeapons?.()?.[e.weapon]?.name || e.weapon || 'arma';
  const me = e.killer === bridge()?.getMyId?.();
  const el = document.createElement('div'); el.className = `evoKill${me ? ' me' : ''}`; el.innerHTML = `${esc(killer)} <b>${esc(weapon)}</b> ${esc(victim)}`; feed.prepend(el);
  setTimeout(() => el.remove(), 4300);
  while (feed.children.length > 5) feed.lastElementChild?.remove();
  if (me) {
    const combo = Number(e.combo || 1); if (combo >= 2) showCombo(combo); killSound(combo);
    if (navigator.vibrate) navigator.vibrate(combo >= 3 ? [22, 28, 34] : 18);
    if (cinematicEnabled) cinematicPulse(combo);
  }
}

let comboTimer = 0;
function showCombo(combo: number) {
  const el = $('#evoCombo'); if (!el) return; el.textContent = combo === 2 ? 'DOUBLE KILL' : combo === 3 ? 'TRIPLE KILL' : `${combo}x INSANO`; el.classList.add('show');
  clearTimeout(comboTimer); comboTimer = window.setTimeout(() => el.classList.remove('show'), 1100);
}
function cinematicPulse(combo = 1) {
  const peak = Math.min(.065, .025 + combo * .008); const start = performance.now();
  const step = (t: number) => { const p = Math.min(1, (t - start) / 520); window.DEADZONE_ZOOM_BOOST = peak * (1 - p); if (p < 1) requestAnimationFrame(step); else window.DEADZONE_ZOOM_BOOST = 0; };
  requestAnimationFrame(step);
}

interface ReplayFrame { t: number; players: AnyObj[]; }
const replayFrames: ReplayFrame[] = [];
let lastReplayCapture = 0;
function captureReplay(state: AnyObj) {
  const now = performance.now(); if (now - lastReplayCapture < 95) return; lastReplayCapture = now;
  replayFrames.push({ t: now, players: (state?.players || []).map((p: AnyObj) => ({ id:p.id,name:p.name,x:p.x,y:p.y,color:p.color,alive:p.alive,weapon:p.weapon })) });
  while (replayFrames.length > 32) replayFrames.shift();
}
function startReplay(e: AnyObj) {
  const wrap = $('#evoReplayWrap'); const canvas = $('#evoReplay') as HTMLCanvasElement | null; if (!wrap || !canvas || replayFrames.length < 4) return;
  const frames = replayFrames.slice(-26); const ctx = canvas.getContext('2d'); if (!ctx) return; wrap.classList.add('show');
  const victimId = e.victim || bridge()?.getMyId?.(); const killerId = e.killer; const start = performance.now();
  const render = (now: number) => {
    const p = Math.min(1, (now - start) / 2600); const idx = Math.min(frames.length - 1, Math.floor(p * frames.length)); const f = frames[idx];
    const victim = f.players.find(x => x.id === victimId) || f.players[0]; const cx = victim?.x || 800, cy = victim?.y || 600; const sx = canvas.width / 520, sy = canvas.height / 300;
    ctx.fillStyle = '#09101a'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.strokeStyle='rgba(255,255,255,.05)'; ctx.lineWidth=1;
    for(let x=0;x<canvas.width;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke()} for(let y=0;y<canvas.height;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke()}
    for(const pl of f.players){const x=canvas.width/2+(pl.x-cx)*sx,y=canvas.height/2+(pl.y-cy)*sy;if(x<-30||y<-30||x>canvas.width+30||y>canvas.height+30)continue;ctx.globalAlpha=pl.alive?.95:.3;ctx.fillStyle=pl.color||'#58c7ff';ctx.beginPath();ctx.arc(x,y,pl.id===victimId?18:15,0,Math.PI*2);ctx.fill();ctx.strokeStyle=pl.id===killerId?'#ff3b52':pl.id===victimId?'#ffd23b':'rgba(255,255,255,.35)';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#fff';ctx.font='700 12px system-ui';ctx.textAlign='center';ctx.fillText(pl.name||'Player',x,y-23);ctx.globalAlpha=1;}
    if (p < 1) requestAnimationFrame(render); else setTimeout(() => wrap.classList.remove('show'), 500);
  }; requestAnimationFrame(render);
}

interface FloatingEmoji { el: HTMLElement; player: number; born: number; }
const emojis: FloatingEmoji[] = [];
function spawnEmoji(e: AnyObj) {
  const holder = $('#evoWorldLabels'); if (!holder) return; const el = document.createElement('div'); el.className='evoEmoji'; el.textContent=String(e.emoji||'😎').slice(0,4); holder.appendChild(el); emojis.push({el,player:Number(e.player),born:performance.now()}); setTimeout(()=>el.remove(),1900);
}
function updateEmojiPositions(state: AnyObj) {
  const frame = bridge()?.getFrame?.() || window.__DZ_FRAME; if (!frame) return; const now=performance.now();
  for (let i=emojis.length-1;i>=0;i--) { const it=emojis[i]; if(now-it.born>1900||!it.el.isConnected){emojis.splice(i,1);continue;} const p=state?.players?.find((x:AnyObj)=>x.id===it.player); if(!p)continue; const x=(p.x-frame.camX)*frame.zoom,y=(p.y-frame.camY)*frame.zoom-36; it.el.style.left=`${x}px`;it.el.style.top=`${y}px`; }
}

let ambientMode = 'snow';
let lastState: AnyObj = { players: [], destructibles: [] };
let app: Application | null = null;
let ambientG: Graphics | null = null, propG: Graphics | null = null, fxG: Graphics | null = null;
const ambientParticles: AnyObj[] = [];
const fxParticles: AnyObj[] = [];

function worldToScreen(x: number, y: number) {
  const f = bridge()?.getFrame?.() || window.__DZ_FRAME; if (!f) return null; return { x:(x-f.camX)*f.zoom, y:(y-f.camY)*f.zoom, zoom:f.zoom, w:f.w, h:f.h };
}
function spawnFx(x: number, y: number, color: number, count = 9) {
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=1+Math.random()*3;fxParticles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,color,r:2+Math.random()*3});}
  while(fxParticles.length>QUALITY[quality].particles)fxParticles.shift();
}
function handleState(msg: AnyObj) {
  lastState = msg; captureReplay(msg); updateEmojiPositions(msg);
  for (const e of msg.events || []) {
    if (e.kind === 'kill') addKillFeed(e,msg);
    if (e.kind === 'death' && e.victim === bridge()?.getMyId?.()) startReplay(e);
    if (e.kind === 'emote') spawnEmoji(e);
    if (e.kind === 'ambient') { ambientMode = e.mode || 'snow'; if (ambientEnabled) toast(e.label || `Evento: ${ambientMode}`); }
    if (e.kind === 'destructibleHit' || e.kind === 'destructibleBreak') spawnFx(Number(e.x||0),Number(e.y||0),e.kind==='destructibleBreak'?0xff9a52:0xbfe6ff,e.kind==='destructibleBreak'?18:7);
  }
}

async function initPixi() {
  try {
    app = new Application();
    await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: quality !== 'economy', autoDensity: true, resolution: 1, preference: 'webgl' });
    app.canvas.id = 'evoCanvas'; document.body.appendChild(app.canvas);
    ambientG = new Graphics(); propG = new Graphics(); fxG = new Graphics(); app.stage.addChild(ambientG, propG, fxG);
    app.ticker.add((ticker) => renderPixi(Math.min(2.2, ticker.deltaTime || 1)));
  } catch (err) { console.warn('[evolution-v3] Pixi indisponível, seguindo sem overlay WebGL.', err); }
}

function ensureAmbient() {
  if (!ambientEnabled) { ambientParticles.length = 0; return; }
  const target = ambientMode === 'rain' ? QUALITY[quality].particles : Math.round(QUALITY[quality].particles * .55);
  while(ambientParticles.length<target) ambientParticles.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,s:ambientMode==='rain'?9+Math.random()*8:.7+Math.random()*1.8,drift:(Math.random()-.5)*.5});
  while(ambientParticles.length>target) ambientParticles.pop();
}

function renderPixi(dt: number) {
  if (!ambientG || !propG || !fxG) return;
  ambientG.clear(); propG.clear(); fxG.clear(); ensureAmbient();
  if (ambientEnabled) {
    if (ambientMode === 'lightsOut') ambientG.rect(0,0,innerWidth,innerHeight).fill({color:0x00030a,alpha:.48});
    for(const p of ambientParticles){if(ambientMode==='rain'){p.y+=p.s*dt;p.x+=1.5*dt;if(p.y>innerHeight+20){p.y=-20;p.x=Math.random()*innerWidth}ambientG.moveTo(p.x,p.y).lineTo(p.x-3,p.y-14).stroke({width:1.2,color:0x9edfff,alpha:.32});}else{p.y+=p.s*dt;p.x+=p.drift*dt;if(p.y>innerHeight+8){p.y=-8;p.x=Math.random()*innerWidth}if(p.x<0)p.x=innerWidth;if(p.x>innerWidth)p.x=0;ambientG.circle(p.x,p.y,1.1+p.s*.55).fill({color:0xffffff,alpha:.33});}}
  }
  for(const d of lastState?.destructibles || []){const s=worldToScreen(Number(d.x),Number(d.y));if(!s||s.x<-80||s.y<-80||s.x>s.w+80||s.y>s.h+80)continue;const hp=Math.max(0,Number(d.hp||0))/Math.max(1,Number(d.maxHp||1));const colors:Record<string,number>={tv:0x34495e,vase:0x9a5b79,chair:0x8a5a32,crate:0x7b5738,grill:0x343942};const c=colors[d.type]||0x566274;const z=Math.max(.7,Math.min(1.2,s.zoom));propG.ellipse(s.x+5,s.y+10,18*z,7*z).fill({color:0x000000,alpha:.25});propG.roundRect(s.x-14*z,s.y-15*z,28*z,27*z,5*z).fill({color:c,alpha:.92}).stroke({width:1.4,color:0xd3deea,alpha:.25});if(hp<1){propG.rect(s.x-15*z,s.y-23*z,30*z,4*z).fill({color:0x0a0d12,alpha:.8});propG.rect(s.x-14*z,s.y-22*z,28*z*hp,2*z).fill({color:hp>.4?0x7be06f:0xff5a68,alpha:.95});}}
  for(let i=fxParticles.length-1;i>=0;i--){const p=fxParticles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy*=.96;p.life-=.035*dt;if(p.life<=0){fxParticles.splice(i,1);continue;}const s=worldToScreen(p.x,p.y);if(s)fxG.circle(s.x,s.y,p.r*p.life).fill({color:p.color,alpha:.75*p.life});}
}

function onMessage(ev: Event) {
  const msg = (ev as CustomEvent).detail || {};
  if (msg.type === 'state') handleState(msg);
  if (msg.type === 'profile') renderProfile(msg.data || msg);
  if (msg.type === 'roomInfo') renderRoom(msg.room || 'PUBLIC');
  if (msg.type === 'roomError') toast(msg.reason || 'Não foi possível entrar na sala.');
}

function setupPwa() {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('offline', () => toast('Sem internet. O Treino Offline continua disponível.'));
  window.addEventListener('online', () => toast('Conexão restaurada.'));
}

async function boot() {
  injectUi(); applyQuality(quality); setupPwa(); window.addEventListener('deadzone:message', onMessage as EventListener); await initPixi();
  setTimeout(() => bridge()?.send?.({type:'profileRequest'}), 1800);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot()); else void boot();
