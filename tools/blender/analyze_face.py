"""Mede o rosto do personagem-base para ajustar os óculos.

blender -b --python tools/blender/analyze_face.py -- <personagem-base.blend>

Imprime: perfil da frente do rosto (y mínimo por altura, no centro), a superfície
da frente na altura dos olhos ao longo de x, a largura da cabeça por altura e por
profundidade (para as hastes) e a posição das orelhas.
"""
import os
import sys

import bpy

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(common.script_args()[0]))
V = [v.co.copy() for v in bpy.data.objects['Corpo'].data.vertices]
head = [p for p in V if p.z > 1.45]

print('[rosto] perfil central (z: y da frente)')
for i in range(0, 26):
    z = 1.52 + i * 0.01
    pts = [p for p in head if abs(p.z - z) < 0.005 and abs(p.x) < 0.006]
    if pts:
        print(f'[rosto]   z={z:.2f}  y_frente={min(p.y for p in pts):+.4f}')

for z in (1.60, 1.615, 1.63):
    print(f'[rosto] frente na altura z={z} (x: y)')
    for i in range(0, 15):
        x = i * 0.01
        pts = [p for p in head if abs(p.z - z) < 0.006 and abs(abs(p.x) - x) < 0.004 and p.y < 0.02]
        if pts:
            print(f'[rosto]   x={x:.2f}  y={min(p.y for p in pts):+.4f}')

print('[rosto] meia-largura da cabeça (z, faixa de y: |x| máx)')
for z in (1.58, 1.60, 1.62, 1.64):
    for y0 in (-0.08, -0.05, -0.02, 0.01, 0.04, 0.07):
        pts = [p for p in head if abs(p.z - z) < 0.006 and abs(p.y - y0) < 0.012]
        if pts:
            print(f'[rosto]   z={z:.2f} y={y0:+.2f}  |x|max={max(abs(p.x) for p in pts):.4f}')

ear = [p for p in head if 1.54 < p.z < 1.70 and abs(p.x) > 0.105]
if ear:
    print(f'[rosto] orelhas (|x|>0.105): z {min(p.z for p in ear):.3f}..{max(p.z for p in ear):.3f}  '
          f'y {min(p.y for p in ear):+.3f}..{max(p.y for p in ear):+.3f}  |x|max {max(abs(p.x) for p in ear):.3f}')
