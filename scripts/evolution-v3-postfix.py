from pathlib import Path

root = Path(__file__).resolve().parents[1]
server_path = root / 'server.js'
html_path = root / 'public' / 'index.html'
server = server_path.read_text(encoding='utf-8')
html = html_path.read_text(encoding='utf-8')

changes = 0

def swap(text, old, new):
    global changes
    if old in text:
        changes += 1
        return text.replace(old, new, 1)
    return text

server = swap(
    server,
    "events.push({ kind: 'heal', x: hp.x, y: hp.y, player: pl.id, amount: healed });",
    "events.push({ kind: 'heal', room:hp.room, x: hp.x, y: hp.y, player: pl.id, amount: healed });"
)

# Churrasco/objects stay isolated, and a bomb can also damage nearby destructible props.
server = swap(
    server,
    "events.push({ kind: 'bombExplosion', room:b.room, x: b.x, y: b.y, radius: b.radius });\n  const attacker = players.get(b.owner) || null;",
    "events.push({ kind: 'bombExplosion', room:b.room, x: b.x, y: b.y, radius: b.radius });\n  for (const d of ensureRoomDestructibles(b.room || ROOM_PUBLIC)) {\n    if (d.hp <= 0) continue;\n    const dd=Math.hypot(d.x-b.x,d.y-b.y); if(dd>b.radius)continue;\n    const pdmg=Math.max(12,Math.round(b.damage*(1-Math.min(1,dd/b.radius)*.55)));\n    d.hp=Math.max(0,d.hp-pdmg); events.push({kind:d.hp<=0?'destructibleBreak':'destructibleHit',room:b.room,x:d.x,y:d.y,id:d.id,objectType:d.type,hp:d.hp,maxHp:d.maxHp});\n  }\n  const attacker = players.get(b.owner) || null;"
)

# Do not offer bots as vote targets in the UI.
html = swap(
    html,
    "const votePlayersSig = state.players.map(p => `${p.id}:${p.kills}:${p.spectating?1:0}:${p.name}`).join(';');",
    "const votePlayersSig = state.players.map(p => `${p.id}:${p.kills}:${p.spectating?1:0}:${p.isBot?1:0}:${p.name}`).join(';');"
)
html = swap(
    html,
    "for (const p of state.players) {\n      if (p.spectating) continue;",
    "for (const p of state.players) {\n      if (p.spectating || p.isBot) continue;"
)

# Make bot identity explicit in labels/scoreboard without changing gameplay.
html = swap(
    html,
    "const label = (p.level && p.level > 1 ? 'Lv' + p.level + ' ' : '') + p.name;",
    "const label = (p.isBot ? '🤖 ' : '') + (p.level && p.level > 1 ? 'Lv' + p.level + ' ' : '') + p.name;"
)

server_path.write_text(server, encoding='utf-8')
html_path.write_text(html, encoding='utf-8')
print(f'[postfix] changes={changes}')
