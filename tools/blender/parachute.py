"""Paraquedas do Battle Royale: velame retangular (ram-air) com células infladas e linhas.

blender -b --python tools/blender/parachute.py -- <pasta public/assets/world> [--sem-previa]

Saída:
  parachute.glb   Velame (asa em arco com 9 células infladas, perfil aerodinâmico, células
                  verdes e amarelas com a do meio azul) e Linhas (linhas de suspensão de
                  cada nervura até dois pontos de junção e os tirantes até os ombros).
                  Origem no ponto entre os ombros do personagem; frente em −Y no Blender
                  (+Z no glTF/jogo); o velame fica ~4,3 m acima.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
out_dir = os.path.abspath(args[0])
make_preview = '--sem-previa' not in args
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def pbr(name, hex_, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


MAT = {
    'verde': pbr('chute_verde', '#12a24f'),
    'amarelo': pbr('chute_amarelo', '#ffd21f'),
    'azul': pbr('chute_azul', '#2050c8'),
    'linha': pbr('chute_linha', '#ece8dc', 0.7),
    'tirante': pbr('chute_tirante', '#2a2c33', 0.8),
}
KEYS = list(MAT)

CELLS = 9
SPAN = 6.6          # comprimento do arco
CHORD = 2.5
ARC_R = 6.8         # raio do arco (velame curvado para baixo nas pontas)
TOP = 4.6           # altura do centro do velame (bordo superior) acima do ombro
THICK = 0.17
LE_Y = -0.9         # bordo de ataque um pouco à frente do personagem


def airfoil(n=16):
    xs = [(1 - math.cos(math.pi * i / n)) / 2 for i in range(n + 1)]
    up, lo = [], []
    for x in xs:
        yt = 5 * THICK * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yc = 0.04 * 4 * x * (1 - x)
        up.append((x, yc + yt))
        lo.append((x, yc - yt * 0.55))      # parte de baixo mais reta (velame)
    return up[::-1] + lo[1:-1]


AF = airfoil()
SEG = 7     # amostras por célula ao longo da envergadura


def arc_point(s):
    """Posição (x, z) e normal do arco para a coordenada s ∈ [-SPAN/2, SPAN/2]."""
    phi = s / ARC_R
    x = ARC_R * math.sin(phi)
    z = TOP - (ARC_R - ARC_R * math.cos(phi))
    return x, z, (math.sin(phi), math.cos(phi))


rings = []
cell_of_ring = []
n_s = CELLS * SEG + 1
for i in range(n_s):
    s = -SPAN / 2 + SPAN * i / (n_s - 1)
    frac = (i % SEG) / SEG
    bulge = math.sin(math.pi * frac)       # célula inflada entre duas nervuras
    ax, az, (nx, nz) = arc_point(s)
    ring = []
    for (u, v) in AF:
        thick = v * CHORD * (1 + 0.22 * bulge * (1 if v > 0 else 0.6))
        y = LE_Y + u * CHORD
        ring.append((ax + nx * thick, y, az + nz * thick))
    rings.append(ring)
    cell_of_ring.append(min(CELLS - 1, i // SEG))

n = len(AF)
verts = [p for r in rings for p in r]
faces, roles = [], []
for i in range(len(rings) - 1):
    cell = cell_of_ring[i]
    role = 'azul' if cell == CELLS // 2 else ('verde' if cell % 2 == 0 else 'amarelo')
    for j in range(n):
        a = i * n + j
        b = i * n + (j + 1) % n
        faces.append([a, b, b + n, a + n])
        roles.append(role)
faces.append(list(range(n))[::-1])
roles.append('verde')
k = (len(rings) - 1) * n
faces.append(list(range(k, k + n)))
roles.append('verde')
me = bpy.data.meshes.new('Velame')
me.from_pydata(verts, [], faces)
for key in KEYS:
    me.materials.append(MAT[key])
me.polygons.foreach_set('material_index', [KEYS.index(r) for r in roles])
for p in me.polygons:
    p.use_smooth = True
me.update()
canopy = bpy.data.objects.new('Velame', me)
bpy.context.collection.objects.link(canopy)

# ------------------------------------------------------------------ linhas e tirantes
def tube(path_pts, radius, sides=4):
    """Tubo fino ao longo de uma polilinha: (verts, faces)."""
    vs, fs = [], []
    for i, p in enumerate(path_pts):
        p = Vector(p)
        d = (Vector(path_pts[min(i + 1, len(path_pts) - 1)]) - Vector(path_pts[max(i - 1, 0)])).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        for s in range(sides):
            ang = 2 * math.pi * s / sides
            vs.append(tuple(p + (a * math.cos(ang) + b * math.sin(ang)) * radius))
    for i in range(len(path_pts) - 1):
        for s in range(sides):
            a0 = i * sides + s
            a1 = i * sides + (s + 1) % sides
            fs.append([a0, a1, a1 + sides, a0 + sides])
    return vs, fs


lv, lf, lr = [], [], []


def add_tube(pts, radius, role):
    vs, fs = tube(pts, radius)
    base = len(lv)
    lv.extend(vs)
    lf.extend([[i + base for i in f] for f in fs])
    lr.extend([role] * len(fs))


SHOULDER = 0.2
for side in (-1, 1):
    shoulder = (side * SHOULDER, 0.0, 0.0)
    join = (side * 0.32, -0.05, 0.75)            # junção das linhas, acima do ombro
    add_tube([shoulder, join], 0.022, 'tirante')  # tirante (fita)
    for rib in range(CELLS + 1):
        s = -SPAN / 2 + SPAN * rib / CELLS
        if (s < 0) != (side < 0) and abs(s) > 1e-3:
            continue
        if abs(s) < 1e-3 and side > 0:
            continue
        ax, az, (nx, nz) = arc_point(s)
        for u in (0.12, 0.45, 0.82):
            # ponto na parte de baixo do velame naquela nervura
            yb = LE_Y + u * CHORD
            vb = -5 * THICK * 0.55 * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4) + 0.04 * 4 * u * (1 - u)
            anchor = (ax + nx * vb * CHORD, yb, az + nz * vb * CHORD)
            add_tube([join, anchor], 0.008, 'linha')

lme = bpy.data.meshes.new('Linhas')
lme.from_pydata(lv, [], lf)
for key in KEYS:
    lme.materials.append(MAT[key])
lme.polygons.foreach_set('material_index', [KEYS.index(r) for r in lr])
lme.update()
lines = bpy.data.objects.new('Linhas', lme)
bpy.context.collection.objects.link(lines)
print(f'[paraquedas] velame {len(me.polygons)} faces, linhas {len(lme.polygons)} faces')

common.select_only(canopy)
lines.select_set(True)
bpy.context.view_layer.objects.active = canopy
glb = os.path.join(out_dir, 'parachute.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_materials='EXPORT')
print(f'[paraquedas] exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

if make_preview:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 800, 600
    scene.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.7, 0.9, 1)
    scene.world = world
    sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (0.6, 0.2, 0.6)
    scene.collection.objects.link(sun)
    # manequim simples só para dar escala na prévia (não vai para o GLB)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.75, location=(0, 0, -0.7))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    prev = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', 'build', 'paraquedas_previa')
    os.makedirs(prev, exist_ok=True)
    c = Vector((0, 0, 2.2))
    for nm, d in (('tras', Vector((0.25, 1, 0.25))), ('lado', Vector((1, 0.1, 0.15))), ('baixo', Vector((0.3, 0.6, -0.5)))):
        cam.location = c + d.normalized() * 12
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(prev, f'{nm}.png')
        bpy.ops.render.render(write_still=True)
print('[paraquedas] concluído')
