"""Mede o personagem para posicionar o esqueleto.

blender -b --python tools/blender/analyze.py -- <entrada.glb>

Imprime, por faixa de altura, os segmentos contíguos em X (braço / tronco / pernas)
e a profundidade em Y, além do lado da frente (onde está o nariz).
"""
import os
import sys

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

src = common.script_args()[0]
common.reset_scene()
obj, _ = common.import_glb(src)
k = common.normalize_height(obj)
print(f'escala aplicada: {k:.4f}')

verts = [v.co.copy() for v in obj.data.vertices]
H = common.TARGET_HEIGHT

# Frente: na altura do nariz (~93% da altura), o ponto mais saliente em |y| perto de x=0.
band = [v for v in verts if 0.90 * H < v.z < 0.94 * H and abs(v.x) < 0.02]
ymin = min(v.y for v in band)
ymax = max(v.y for v in band)
print(f'cabeça y: min={ymin:.3f} max={ymax:.3f} -> frente em {"-Y" if abs(ymin) > abs(ymax) else "+Y"}')

STEP = 0.025
GAP = 0.012
for i in range(int(1 / STEP), -1, -1):
    z0 = i * STEP * H
    z1 = z0 + STEP * H
    xs = sorted(v.x for v in verts if z0 <= v.z < z1)
    if not xs:
        continue
    segs = []
    start = xs[0]
    prev = xs[0]
    for x in xs[1:]:
        if x - prev > GAP:
            segs.append((start, prev))
            start = x
        prev = x
    segs.append((start, prev))
    ys = [v.y for v in verts if z0 <= v.z < z1]
    seg_txt = ' | '.join(f'{a:+.3f}..{b:+.3f}' for a, b in segs)
    print(f'z {z0:.3f}-{z1:.3f} ({i * STEP:.3f}H) y[{min(ys):+.3f},{max(ys):+.3f}] segs: {seg_txt}')

# Pontas: mão (vértices mais baixos com |x| grande), dedos dos pés.
outer = [v for v in verts if abs(v.x) > 0.17]
if outer:
    low = min(outer, key=lambda v: v.z)
    print(f'ponta mais baixa da mão: x={low.x:+.3f} y={low.y:+.3f} z={low.z:.3f}')
feet = [v for v in verts if v.z < 0.03]
print(f'pés y: {min(v.y for v in feet):+.3f}..{max(v.y for v in feet):+.3f} x: {min(v.x for v in feet):+.3f}..{max(v.x for v in feet):+.3f}')
