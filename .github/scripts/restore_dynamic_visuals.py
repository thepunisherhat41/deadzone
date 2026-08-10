from pathlib import Path
import subprocess

p=Path('public/index.html')
h=p.read_text()
base=subprocess.check_output(['git','show','origin/main:public/index.html'], text=True)
start_marker='  // poças de sangue e marcas queimadas da Pinga do Lelê\n'
end_marker='  // ---- paredes: mais volumosas e legíveis no mobile ----\n'
assert start_marker in base and end_marker in base
start=base.index(start_marker)
end=base.index(end_marker,start)
dynamic=base[start:end]
call='  drawAmbientSceneLighting(camX,camY,viewW,viewH,meX,meY);\n'
assert call in h
assert start_marker not in h[h.index('function draw(frameTs'):]
h=h.replace(call,call+dynamic,1)
p.write_text(h)
print('restored dynamic decals and aim guide')
