from pathlib import Path
import re

html_path = Path('public/index.html')
server_path = Path('server.js')
h = html_path.read_text()
s = server_path.read_text()

# Keep gameplay/networking intact. This patch only changes presentation/rendering.
assert "const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });" in h
assert "function draw(frameTs = performance.now())" in h
assert "function drawPlayerLabel(" in h
assert "// ---- piso base / rua ----" in h
assert "// ---- PROJÉTEIS: forma coerente com cada arma ----" in h

# Version marker for live verification.
s = re.sub(r"const BUILD = '[^']+';", "const BUILD = 'v4-mobile-beta-2.4-visual-overhaul';", s, count=1)

# High quality smoothing without raising the existing DPR caps.
resize_marker = "  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // desenha em coordenadas CSS, nitidez retina\n"
assert resize_marker in h
h = h.replace(resize_marker, resize_marker + "  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';\n", 1)

# Visual-system CSS. All art remains procedural and dependency-free.
css = r'''
  /* ===== DEADZONE VISUAL OVERHAUL V1 ===== */
  :root{--dz-glass:rgba(8,11,18,.84);--dz-glass2:rgba(17,22,33,.92);--dz-edge:rgba(255,255,255,.11);--dz-gold:#ffd45d;--dz-ice:#a9efff}
  html,body{background:#070910;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  #game{filter:saturate(1.08) contrast(1.035);image-rendering:auto}
  #scoreboard,#status{background:linear-gradient(160deg,rgba(23,28,41,.91),rgba(7,10,17,.86));border:1px solid rgba(175,216,255,.12);box-shadow:0 12px 32px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.055)}
  #scoreboard{border-left:2px solid rgba(127,224,255,.38)}#status{border-right:2px solid rgba(255,210,59,.38)}
  #levelBadge{background:linear-gradient(180deg,#fff1a1 0%,#ffd34e 54%,#eba61c 100%);box-shadow:0 4px 0 #8e5f00,0 10px 30px rgba(0,0,0,.35),0 0 24px rgba(255,207,58,.15);border:1px solid rgba(255,255,255,.62)}
  .iconbtn{background:linear-gradient(180deg,rgba(31,37,51,.96),rgba(10,13,20,.94));border-color:rgba(187,224,255,.18);box-shadow:0 8px 22px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.06)}
  #stickBase{background:radial-gradient(circle at 50% 50%,rgba(127,224,255,.075),rgba(255,255,255,.018) 55%,rgba(0,0,0,.1));border-color:rgba(168,226,255,.22);box-shadow:inset 0 0 28px rgba(0,0,0,.28),0 10px 30px rgba(0,0,0,.22),0 0 0 5px rgba(127,224,255,.025)}
  #stickKnob{background:radial-gradient(circle at 34% 28%,#ff7080,#b51f39 70%,#7d1126);box-shadow:0 6px 15px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.25)}
  #aimBase{background:radial-gradient(circle,rgba(255,59,82,.16),rgba(255,59,82,.025) 63%,rgba(255,59,82,.075));box-shadow:inset 0 0 30px rgba(255,59,82,.09),0 0 0 5px rgba(255,59,82,.025)}
  #aimKnob{background:radial-gradient(circle at 36% 28%,#ff7182,#e52d45 56%,#ad172d);box-shadow:0 5px 0 #8c1022,0 10px 25px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.28)}
  #weaponQuick{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:0 11px 30px rgba(0,0,0,.40),inset 0 1px 0 rgba(255,255,255,.055)!important}
  #weapons.weaponDrawerOpen{box-shadow:0 20px 48px rgba(0,0,0,.52),0 0 0 1px rgba(127,224,255,.06) inset!important}
  #weapons .wbtn{background:linear-gradient(180deg,rgba(34,39,52,.96),rgba(12,15,23,.96));border-color:rgba(255,255,255,.10)}
  #weapons .wbtn.active{background:linear-gradient(180deg,rgba(255,216,88,.26),rgba(76,53,4,.78));box-shadow:0 0 0 1px rgba(255,210,59,.26),0 7px 18px rgba(0,0,0,.32),0 0 20px rgba(255,210,59,.08)}
  #shopBox,#rankingCard,#voteCard{background:linear-gradient(180deg,rgba(24,29,42,.99),rgba(7,10,17,.99));border-color:rgba(143,205,255,.18);box-shadow:0 28px 90px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.04)}
  #shopHeader,#rankingHeader{background:linear-gradient(180deg,rgba(33,39,54,.98),rgba(17,21,31,.98))}
  .shopItem,.rankRow,.voteRow{background:linear-gradient(160deg,rgba(34,40,54,.86),rgba(16,20,30,.9));border-color:rgba(255,255,255,.075)}
  #dead{background:radial-gradient(circle at center,rgba(165,15,34,.32),rgba(8,5,10,.9) 72%)}
  #dead .big{text-shadow:0 0 28px rgba(255,59,82,.28),3px 3px 0 #000}
  @media (max-width:820px),(pointer:coarse){
    #game{filter:saturate(1.06) contrast(1.025)}
    #scoreboard,#status{box-shadow:0 8px 20px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.04)}
    #weaponQuick{background:linear-gradient(180deg,rgba(25,30,42,.97),rgba(8,11,18,.97))!important}
    #weapons{background:rgba(7,10,17,.97)!important}
  }
'''
assert '</style>\n</head>' in h
h = h.replace('</style>\n</head>', css + '\n</style>\n</head>', 1)

# Invalidate the procedural static cache whenever a map arrives/changes.
init_marker = "gameMap=msg.map;currentMapName=(msg.map&&msg.map.name)||'';"
assert init_marker in h
h = h.replace(init_marker, init_marker + "invalidateSceneCache();", 1)
state_marker = "else if(msg.type==='state'){state=msg;"
assert state_marker in h
h = h.replace(state_marker, state_marker + "if(msg.map&&msg.map.name!==currentMapName){gameMap=msg.map;currentMapName=msg.map.name||'';invalidateSceneCache();}", 1)

# Replace player labels with cleaner plates and bars.
label_re = re.compile(r"function drawPlayerLabel\(sx, sy, p, topY\) \{.*?\n\}\nfunction drawDefaultBean", re.S)
assert label_re.search(h)
new_label = r'''function drawPlayerLabel(sx, sy, p, topY) {
  const labelY = sy + (topY || -38);
  const maxHp = p.maxHp || 100;
  const label = (p.level && p.level > 1 ? 'Lv' + p.level + '  ' : '') + p.name;
  ctx.save();
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='800 11px system-ui,sans-serif';
  const tw=Math.min(132,Math.max(54,ctx.measureText(label).width+16));
  const plateX=sx-tw/2,plateY=labelY-9;
  ctx.fillStyle='rgba(5,8,14,.78)'; roundRect(plateX,plateY,tw,18,8); ctx.fill();
  ctx.strokeStyle=p.id===myId?'rgba(255,210,59,.78)':'rgba(186,221,255,.18)';ctx.lineWidth=1;roundRect(plateX,plateY,tw,18,8);ctx.stroke();
  ctx.fillStyle=p.id===myId?'#ffe27a':'#f3f7fb';ctx.fillText(label,sx,labelY);
  const barY=labelY+12,bw=46,hpPct=Math.max(0,Math.min(1,p.hp/maxHp));
  ctx.fillStyle='rgba(2,4,8,.84)';roundRect(sx-bw/2,barY,bw,6,3);ctx.fill();
  const hpGrad=ctx.createLinearGradient(sx-bw/2,0,sx+bw/2,0);
  if(hpPct>.5){hpGrad.addColorStop(0,'#35d96d');hpGrad.addColorStop(1,'#86ef8e')}else if(hpPct>.25){hpGrad.addColorStop(0,'#ff9d36');hpGrad.addColorStop(1,'#ffd45d')}else{hpGrad.addColorStop(0,'#ff314c');hpGrad.addColorStop(1,'#ff7a83')}
  ctx.fillStyle=hpGrad;if(hpPct>0){roundRect(sx-bw/2+1,barY+1,(bw-2)*hpPct,4,2);ctx.fill()}
  if(p.armor>0){const ap=Math.max(0,Math.min(1,p.armor/60));ctx.fillStyle='rgba(5,8,14,.8)';roundRect(sx-bw/2,barY+8,bw,4,2);ctx.fill();ctx.fillStyle='#8ccaff';roundRect(sx-bw/2+1,barY+9,(bw-2)*ap,2,1);ctx.fill()}
  ctx.restore();
}
function drawDefaultBean'''
h = label_re.sub(new_label, h, count=1)

# Actor-level lighting and selection ring, shared by every skin.
bean_marker = "function drawBean(sx, sy, p, isMe) {\n"
assert bean_marker in h
h = h.replace(bean_marker, bean_marker + "  drawActorBase(sx,sy,p,isMe);\n", 1)

# Visual engine helpers. Static world art is cached once per map using OffscreenCanvas when available.
visual_helpers = r'''
// ==================== VISUAL ENGINE V1 ====================
let sceneCacheCanvas=null,sceneCacheKey='',sceneCacheRevision=0;
function invalidateSceneCache(){sceneCacheKey='';sceneCacheRevision++}
function rr(g,x,y,w,h,r){const q=Math.max(0,Math.min(r,Math.min(w,h)/2));g.beginPath();g.moveTo(x+q,y);g.arcTo(x+w,y,x+w,y+h,q);g.arcTo(x+w,y+h,x,y+h,q);g.arcTo(x,y+h,x,y,q);g.arcTo(x,y,x+w,y,q);g.closePath()}
function hashNoise(x,y,s=0){let n=(x*374761393+y*668265263+s*69069)|0;n=(n^(n>>>13))*1274126177;n^=n>>>16;return (n>>>0)/4294967295}
function sceneKey(){return `${currentMapName}|${world.w}x${world.h}|${(gameMap.rooms||[]).length}|${(gameMap.walls||[]).length}|${gameMap.floor||''}|${sceneCacheRevision}`}
function roomLight(kind){if(kind==='kitchen')return'rgba(255,219,153,.12)';if(kind==='bath')return'rgba(158,224,255,.12)';if(kind==='bedroom')return'rgba(255,176,146,.095)';if(kind==='living')return'rgba(255,210,133,.105)';if(kind==='garage')return'rgba(140,182,215,.08)';if(kind==='yard')return'rgba(135,210,128,.08)';return'rgba(190,210,255,.06)'}
function paintRoomFloorV2(g,rm){
  const kind=roomKind(rm.label),x=rm.x,y=rm.y;
  g.save();g.fillStyle=rm.color||'#262b36';g.fillRect(x,y,rm.w,rm.h);
  const sheen=g.createLinearGradient(x,y,x+rm.w,y+rm.h);sheen.addColorStop(0,'rgba(255,255,255,.075)');sheen.addColorStop(.5,'rgba(255,255,255,0)');sheen.addColorStop(1,'rgba(0,0,0,.12)');g.fillStyle=sheen;g.fillRect(x,y,rm.w,rm.h);
  if(kind==='living'||kind==='bedroom'){
    g.strokeStyle='rgba(255,235,205,.075)';g.lineWidth=1;
    for(let yy=y+18;yy<y+rm.h;yy+=24){g.beginPath();g.moveTo(x,yy);g.lineTo(x+rm.w,yy);g.stroke()}
    for(let xx=x+48;xx<x+rm.w;xx+=96){g.beginPath();g.moveTo(xx,y);g.lineTo(xx,y+rm.h);g.stroke()}
  }else if(kind==='bath'||kind==='kitchen'){
    const step=40;g.strokeStyle='rgba(255,255,255,.065)';g.lineWidth=1;
    for(let xx=x;xx<=x+rm.w;xx+=step){g.beginPath();g.moveTo(xx,y);g.lineTo(xx,y+rm.h);g.stroke()}
    for(let yy=y;yy<=y+rm.h;yy+=step){g.beginPath();g.moveTo(x,yy);g.lineTo(x+rm.w,yy);g.stroke()}
  }else if(kind==='yard'){
    g.strokeStyle='rgba(111,178,103,.12)';g.lineWidth=1;
    for(let yy=y+12;yy<y+rm.h;yy+=26){g.beginPath();g.moveTo(x,yy);g.lineTo(x+rm.w,yy+4);g.stroke()}
    g.fillStyle='rgba(204,234,149,.15)';for(let i=0;i<Math.min(70,Math.floor(rm.w*rm.h/9000));i++){const px=x+hashNoise(i,7,rm.x)*rm.w,py=y+hashNoise(i,13,rm.y)*rm.h;g.beginPath();g.arc(px,py,1.4+hashNoise(i,17,rm.w)*1.6,0,Math.PI*2);g.fill()}
  }else{
    g.strokeStyle='rgba(255,255,255,.035)';g.lineWidth=1;for(let xx=x+54;xx<x+rm.w;xx+=54){g.beginPath();g.moveTo(xx,y);g.lineTo(xx,y+rm.h);g.stroke()}
  }
  const lg=g.createRadialGradient(x+rm.w*.52,y+rm.h*.40,8,x+rm.w*.52,y+rm.h*.40,Math.max(rm.w,rm.h)*.58);lg.addColorStop(0,roomLight(kind));lg.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=lg;g.fillRect(x,y,rm.w,rm.h);
  g.fillStyle='rgba(0,0,0,.12)';g.fillRect(x,y,rm.w,7);g.fillRect(x,y,7,rm.h);g.fillStyle='rgba(255,255,255,.035)';g.fillRect(x+7,y+7,rm.w-14,2);
  g.restore();
}
function paintDecorV2(g,rm){
  const kind=roomKind(rm.label),x=rm.x,y=rm.y,w=rm.w,h=rm.h;
  g.save();g.globalAlpha=.88;g.lineWidth=1.6;
  const box=(bx,by,bw,bh,r,fill,stroke='rgba(0,0,0,.32)')=>{g.fillStyle=fill;rr(g,bx,by,bw,bh,r);g.fill();g.strokeStyle=stroke;g.stroke()};
  if(kind==='living'){
    box(x+w*.13,y+h*.58,w*.44,38,10,'#76513f');box(x+w*.16,y+h*.50,w*.38,16,7,'#98705a');
    box(x+w*.60,y+h*.58,w*.23,h*.18,9,'rgba(139,88,49,.62)');box(x+w*.64,y+h*.25,w*.22,10,4,'#242834');g.fillStyle='#111722';g.fillRect(x+w*.66,y+h*.13,w*.18,h*.12);g.fillStyle='rgba(167,225,255,.16)';g.fillRect(x+w*.675,y+h*.145,w*.15,h*.085);
    box(x+w*.20,y+h*.20,w*.25,h*.18,12,'rgba(146,72,66,.32)','rgba(255,210,166,.12)');
  }else if(kind==='kitchen'){
    box(x+12,y+h-48,w-24,34,7,'#697268');g.fillStyle='#adb7b2';g.fillRect(x+20,y+h-46,w-40,5);box(x+w*.10,y+h*.18,50,78,8,'#d7d9d1','#8f9790');
    g.strokeStyle='#5d6868';g.beginPath();g.moveTo(x+w*.10+25,y+h*.18+6);g.lineTo(x+w*.10+25,y+h*.18+72);g.stroke();
    box(x+w*.52,y+h-43,54,24,6,'#242a2c','#99a6a6');g.strokeStyle='#b8dce5';g.beginPath();g.arc(x+w*.52+27,y+h-33,9,0,Math.PI);g.stroke();
    for(let i=0;i<4;i++){g.fillStyle='#101316';g.beginPath();g.arc(x+w*.72+i%2*18,y+h-32+Math.floor(i/2)*13,5,0,Math.PI*2);g.fill()}
  }else if(kind==='bath'){
    box(x+w*.12,y+h*.16,w*.32,h*.27,10,'rgba(168,216,226,.22)','rgba(205,244,255,.4)');g.strokeStyle='rgba(207,245,255,.45)';g.beginPath();g.moveTo(x+w*.28,y+h*.16);g.lineTo(x+w*.28,y+h*.43);g.stroke();
    g.fillStyle='#ddd9cf';g.beginPath();g.ellipse(x+w*.72,y+h*.62,22,29,0,0,Math.PI*2);g.fill();g.fillStyle='#8fa7ac';g.beginPath();g.ellipse(x+w*.72,y+h*.60,13,17,0,0,Math.PI*2);g.fill();box(x+w*.60,y+h*.18,58,18,7,'#c7d4d5');
  }else if(kind==='bedroom'){
    box(x+w*.14,y+h*.38,w*.45,h*.33,11,'#7a524c');box(x+w*.17,y+h*.41,w*.39,h*.27,8,'#b47b78');
    box(x+w*.18,y+h*.43,w*.16,h*.09,7,'#e8d3bc','#ba9f87');box(x+w*.67,y+h*.20,w*.22,h*.49,7,'#523e35');g.strokeStyle='rgba(236,216,190,.18)';g.beginPath();g.moveTo(x+w*.78,y+h*.22);g.lineTo(x+w*.78,y+h*.67);g.stroke();
    box(x+w*.12,y+h*.75,w*.48,h*.11,9,'rgba(163,77,88,.28)','rgba(255,211,175,.10)');
  }else if(kind==='garage'){
    g.fillStyle='rgba(255,210,59,.11)';for(let i=0;i<4;i++)g.fillRect(x+28+i*72,y+h-32,44,5);
    box(x+w*.24,y+h*.30,w*.48,h*.32,20,'#394457','#1c2230');g.fillStyle='#1c2028';g.beginPath();g.arc(x+w*.34,y+h*.64,14,0,Math.PI*2);g.arc(x+w*.62,y+h*.64,14,0,Math.PI*2);g.fill();g.fillStyle='rgba(170,225,255,.20)';rr(g,x+w*.39,y+h*.34,w*.18,h*.11,6);g.fill();
    box(x+w*.78,y+h*.18,34,72,6,'#7a3434');
  }else if(kind==='laundry'){
    box(x+w*.14,y+h*.45,56,65,9,'#d8dedf','#8b999b');g.fillStyle='#50616a';g.beginPath();g.arc(x+w*.14+28,y+h*.45+32,18,0,Math.PI*2);g.fill();g.strokeStyle='#d6dde2';g.beginPath();g.arc(x+w*.14+28,y+h*.45+32,13,0,Math.PI*2);g.stroke();
    g.strokeStyle='rgba(224,230,235,.65)';g.lineWidth=2;g.beginPath();g.moveTo(x+w*.48,y+h*.22);g.lineTo(x+w*.88,y+h*.22);g.stroke();for(let i=0;i<4;i++){g.fillStyle=['#e46a7b','#6f9ed1','#e3c96c','#77b27b'][i];g.fillRect(x+w*(.52+i*.085),y+h*.22,18,24)}
  }else if(kind==='yard'){
    for(let i=0;i<5;i++){const px=x+w*(.18+i*.14),py=y+h*(.62+(i%2)*.08);g.fillStyle='rgba(210,205,176,.22)';g.beginPath();g.ellipse(px,py,20,12,0,0,Math.PI*2);g.fill()}
    for(const [px,py] of [[.14,.22],[.82,.22],[.76,.74]]){g.fillStyle='#6b4430';g.beginPath();g.arc(x+w*px,y+h*py,13,0,Math.PI*2);g.fill();g.fillStyle='rgba(83,154,82,.66)';for(let a=0;a<6;a++){g.beginPath();g.ellipse(x+w*px+Math.cos(a)*10,y+h*py-8+Math.sin(a)*8,6,10,a,0,Math.PI*2);g.fill()}}
  }else if(kind==='corridor'){
    box(x+w*.18,y+h*.18,w*.64,h*.64,10,'rgba(150,73,76,.15)','rgba(255,225,190,.08)');
  }
  g.restore();
}
function paintWallV2(g,wl){
  const x=wl.x,y=wl.y,w=wl.w,h=wl.h,vertical=h>w;
  g.save();g.shadowColor='rgba(0,0,0,.38)';g.shadowBlur=12;g.shadowOffsetX=5;g.shadowOffsetY=7;g.fillStyle='#272c3a';g.fillRect(x,y,w,h);g.shadowColor='transparent';g.shadowBlur=0;g.shadowOffsetX=0;g.shadowOffsetY=0;
  const grad=vertical?g.createLinearGradient(x,y,x+w,y):g.createLinearGradient(x,y,x,y+h);grad.addColorStop(0,'#757a8c');grad.addColorStop(.18,'#5b6072');grad.addColorStop(.68,'#3a3f50');grad.addColorStop(1,'#252a38');g.fillStyle=grad;g.fillRect(x,y,w,h);
  g.fillStyle='rgba(255,255,255,.16)';if(vertical)g.fillRect(x+1,y,4,h);else g.fillRect(x,y+1,w,4);
  g.fillStyle='rgba(0,0,0,.20)';if(vertical)g.fillRect(x+w-5,y,5,h);else g.fillRect(x,y+h-5,w,5);
  g.strokeStyle='rgba(163,226,255,.27)';g.lineWidth=1.2;g.strokeRect(x+.5,y+.5,w-1,h-1);g.restore();
}
function paintStaticScene(){
  if(!gameMap||!world||!world.w||!world.h)return null;
  const c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(world.w,world.h):document.createElement('canvas');c.width=world.w;c.height=world.h;const g=c.getContext('2d',{alpha:false});if(!g)return null;g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
  const bg=g.createLinearGradient(0,0,world.w,world.h);bg.addColorStop(0,gameMap.floor||'#202633');bg.addColorStop(.58,'#1c222e');bg.addColorStop(1,'#111620');g.fillStyle=bg;g.fillRect(0,0,world.w,world.h);
  g.fillStyle='rgba(255,255,255,.025)';for(let i=0;i<260;i++){const x=hashNoise(i,11,world.w)*world.w,y=hashNoise(i,23,world.h)*world.h,r=.7+hashNoise(i,41,7)*1.8;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()}
  if(gameMap.rooms)for(const rm of gameMap.rooms){paintRoomFloorV2(g,rm);paintDecorV2(g,rm);const lx=rm.x+rm.w/2,ly=rm.y+29;g.font='800 13px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';const tw=Math.min(rm.w-24,g.measureText(rm.label).width+24);g.fillStyle='rgba(5,8,14,.34)';rr(g,lx-tw/2,ly-10,tw,20,8);g.fill();g.strokeStyle='rgba(255,255,255,.055)';g.stroke();g.fillStyle='rgba(241,246,252,.58)';g.fillText(rm.label,lx,ly)}
  if(gameMap.walls)for(const wl of gameMap.walls)paintWallV2(g,wl);
  g.strokeStyle='rgba(255,59,82,.72)';g.lineWidth=5;g.strokeRect(2.5,2.5,world.w-5,world.h-5);
  g.strokeStyle='rgba(255,255,255,.022)';g.lineWidth=1;for(let x=0;x<=world.w;x+=160){g.beginPath();g.moveTo(x,0);g.lineTo(x,world.h);g.stroke()}for(let y=0;y<=world.h;y+=160){g.beginPath();g.moveTo(0,y);g.lineTo(world.w,y);g.stroke()}
  return c;
}
function ensureSceneCache(){const key=sceneKey();if(sceneCacheCanvas&&sceneCacheKey===key)return;sceneCacheCanvas=paintStaticScene();sceneCacheKey=key}
function drawAmbientSceneLighting(camX,camY,viewW,viewH,meX,meY){
  const sx=meX-camX,sy=meY-camY,rad=Math.max(viewW,viewH)*.72;ctx.save();const v=ctx.createRadialGradient(sx,sy,Math.min(150,rad*.16),sx,sy,rad);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(.64,'rgba(0,0,0,.035)');v.addColorStop(1,COARSE_POINTER?'rgba(0,0,0,.16)':'rgba(0,0,0,.20)');ctx.fillStyle=v;ctx.fillRect(-camX,-camY,world.w,world.h);ctx.restore()
}
function drawActorBase(sx,sy,p,isMe){
  ctx.save();const shadow=ctx.createRadialGradient(sx,sy+22,2,sx,sy+22,isMe?34:28);shadow.addColorStop(0,'rgba(0,0,0,.36)');shadow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=shadow;ctx.beginPath();ctx.ellipse(sx,sy+22,isMe?34:29,12,0,0,Math.PI*2);ctx.fill();if(isMe){const g=ctx.createRadialGradient(sx,sy,18,sx,sy,46);g.addColorStop(0,'rgba(255,210,59,.05)');g.addColorStop(.7,'rgba(255,210,59,.06)');g.addColorStop(1,'rgba(255,210,59,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(sx,sy,46,0,Math.PI*2);ctx.fill()}if(p.moving){ctx.strokeStyle='rgba(210,225,236,.09)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx-23,sy+23);ctx.lineTo(sx-35,sy+25);ctx.moveTo(sx-18,sy+28);ctx.lineTo(sx-29,sy+31);ctx.stroke()}ctx.restore()
}
function drawProjectileAura(wpn,bx,by,pr){
  let c=null,r=18,a=.16;if(wpn==='dracarys'){c='255,120,45';r=28;a=.28}else if(wpn==='grito'){c='127,224,255';r=24;a=.20}else if(wpn==='lilika'){c='200,92,255';r=25;a=.24}else if(wpn==='peido'){c='139,188,88';r=22;a=.14}else if(wpn==='gin10'){c='255,55,112';r=18;a=.12}else if(wpn==='espada'){c='117,211,93';r=17;a=.11}if(!c)return;ctx.save();ctx.globalCompositeOperation='lighter';const g=ctx.createRadialGradient(bx,by,1,bx,by,r);g.addColorStop(0,`rgba(${c},${a*(1-Math.min(.8,pr||0))})`);g.addColorStop(1,`rgba(${c},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(bx,by,r,0,Math.PI*2);ctx.fill();ctx.restore()
}
function drawScreenGrade(me){
  ctx.save();const cx=W*.5,cy=H*.47,r=Math.max(W,H)*.72;const v=ctx.createRadialGradient(cx,cy,Math.min(W,H)*.22,cx,cy,r);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(.68,'rgba(0,0,0,.015)');v.addColorStop(1,COARSE_POINTER?'rgba(0,0,0,.17)':'rgba(0,0,0,.22)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);if(me&&!me.spectating&&me.alive){const hp=Math.max(0,me.hp)/(me.maxHp||100);if(hp<.32){const pulse=.045+(1-hp)*.07+Math.sin(animTime*5)*.012;const red=ctx.createRadialGradient(cx,cy,Math.min(W,H)*.34,cx,cy,r);red.addColorStop(0,'rgba(255,25,55,0)');red.addColorStop(1,`rgba(255,25,55,${pulse})`);ctx.fillStyle=red;ctx.fillRect(0,0,W,H)}}ctx.restore()
}
'''
helper_marker = "let lastHudPaintAt=0,lastScoreHtml='',lastStatusHtml='';\n"
assert helper_marker in h
h = h.replace(helper_marker, visual_helpers + "\n" + helper_marker, 1)

# Replace per-frame static world drawing with the cached procedural scene.
start = h.index("  // ---- piso base / rua ----\n")
end_line = "  ctx.strokeStyle = '#ff3b52'; ctx.lineWidth = 5; ctx.strokeRect(-camX, -camY, world.w, world.h);\n"
end = h.index(end_line, start) + len(end_line)
replacement = "  // ---- cenário estático procedural cacheado: mais rico e mais barato por frame ----\n  ensureSceneCache();\n  if(sceneCacheCanvas)ctx.drawImage(sceneCacheCanvas,-camX,-camY);\n  drawAmbientSceneLighting(camX,camY,viewW,viewH,meX,meY);\n"
h = h[:start] + replacement + h[end:]

# Add cheap projectile bloom before the existing projectile art.
proj_marker = "    const bx = b.x - camX, by = b.y - camY, a = b.a || 0, wpn = b.w || 'chinelo';\n    ctx.save(); ctx.translate(bx, by); ctx.rotate(a);\n"
assert proj_marker in h
h = h.replace(proj_marker, "    const bx = b.x - camX, by = b.y - camY, a = b.a || 0, wpn = b.w || 'chinelo';\n    drawProjectileAura(wpn,bx,by,b.progress||0);\n    ctx.save(); ctx.translate(bx, by); ctx.rotate(a);\n", 1)

# Apply screen-space grade after particles and before DOM HUD.
grade_marker = "  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);\n\n  updateHudDom(me, frameTs);\n"
assert grade_marker in h
h = h.replace(grade_marker, "  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);\n  drawScreenGrade(me);\n\n  updateHudDom(me, frameTs);\n", 1)

# Client-visible marker for diagnostics.
script_marker = "const COARSE_POINTER = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);\n"
assert script_marker in h
h = h.replace(script_marker, script_marker + "window.DEADZONE_VISUAL_BUILD='graphics-overhaul-v1';\n", 1)

html_path.write_text(h)
server_path.write_text(s)
print('graphics overhaul patch applied')
