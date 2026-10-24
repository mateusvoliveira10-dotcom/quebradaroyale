"""Props de favela: sacos de lixo de verdade, pneus e barricadas.

Objetos (papéis de material entre parênteses; o jogo troca pelos dele):
  Lixo_a, Lixo_b, Lixo_c  montes de sacos amarrados e amassados (bag_black, bag_blue,
                          bag_white), com caixa de papelão (cardboard) e garrafa (bottle)
  Pneu                    pneu deitado com banda de rodagem e sulcos (rubber)
  PilhaPneus              quatro pneus empilhados meio tortos
  BarricadaPneus          monte de pneus queimados, tambor enferrujado e tábua (rubber,
                          rubber_burnt, rust, wood)
  BarricadaMadeira        dois paletes em pé, tábuas cruzadas, blocos de concreto e um saco
                          de areia (wood, concrete, sack)
Colisores: Col_<nome>_<n>. Eixos (Blender): Z para cima, base em z = 0.

  blender -b --python tools/blender/favela_props.py -- public/assets/world/favela.glb [preview.png]
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402
from meshkit import Builder, collider, export  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/favela.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None
rnd = random.Random(20261024)
reset_scene()
objs = []


# ------------------------------------------------------------------ sacos de lixo

def bag(bd, c, size, role, lean=(0.0, 0.0), yaw=0.0, seed=0.0):
    """Saco plástico cheio e amarrado: corpo amassado, fundo achatado, boca franzida e nó."""
    w, h = size

    def shape(p):
        q = p.copy()
        # Fundo assentado no chão e corpo mais "barrigudo" embaixo.
        if q.z < -0.55:
            q.z = -0.55 - (q.z + 0.55) * 0.25
        belly = 1.0 + 0.12 * (1 - abs(q.z))
        q.x *= belly
        q.y *= belly
        # Boca franzida: estreita bem perto do topo.
        if q.z > 0.45:
            k = (q.z - 0.45) / 0.55
            s = 1 - 0.82 * k ** 0.8
            q.x *= s
            q.y *= s
            q.z = 0.45 + (q.z - 0.45) * 1.25
        return q

    bd.push(c, (lean[0], lean[1], yaw))
    bd.blob((0, 0, h * 0.5), (w * 0.5, w * 0.46, h * 0.5), role, sub=3, amp=0.07, freq=4.5, seed=seed, shape=shape)
    # Rugas grandes (duas ondas lentas por cima do ruído fino).
    top = h * 0.5 + h * 0.5 * 1.04
    # Nó e as "orelhas" da amarração.
    bd.blob((0, 0, top + 0.015), (0.035, 0.035, 0.03), role, sub=1, amp=0.1, seed=seed + 1)
    for s in (-1, 1):
        bd.blob((s * 0.055, 0, top + 0.05), (0.06, 0.018, 0.035), role, sub=1, amp=0.15, seed=seed + 2 + s, shape=lambda p: Vector((p.x, p.y, p.z + 0.6 * p.x * p.x)))
    bd.pop()


def cardboard(bd, c, s, yaw, rot=(0, 0, 0)):
    bd.push(c, (rot[0], rot[1], yaw))
    bd.box((0, 0, s[2] / 2), s, 'cardboard', bevel=0.004)
    # Abas abertas.
    for side in (-1, 1):
        bd.box((side * s[0] * 0.5, 0, s[2] + 0.03), (0.005, s[1] * 0.96, 0.08), 'cardboard', rot=(0, side * 0.5, 0))
    bd.pop()


def bottle(bd, c, rot):
    bd.push(c, rot)
    bd.lathe([(0.0, 0.0), (0.035, 0.0), (0.036, 0.16), (0.016, 0.22), (0.013, 0.27), (0.0, 0.27)], 10, 'bottle')
    bd.pop()


def lixo(name, layout):
    bd = Builder(name)
    for i, (kind, x, y, extra) in enumerate(layout):
        if kind == 'bag':
            role, w, h, lean, yaw = extra
            bag(bd, (x, y, 0), (w, h), role, lean, yaw, seed=rnd.random() * 10 + i)
        elif kind == 'box':
            cardboard(bd, (x, y, 0), extra[0], extra[1], extra[2])
        elif kind == 'bottle':
            bottle(bd, (x, y, 0.035), extra)
    bd.build(objs)


lixo('Lixo_a', [
    ('bag', 0.0, 0.0, ('bag_black', 0.55, 0.62, (0.05, -0.08), 0.3)),
    ('bag', 0.42, 0.18, ('bag_black', 0.48, 0.55, (-0.12, 0.1), 1.2)),
    ('bag', -0.38, 0.22, ('bag_blue', 0.42, 0.48, (0.1, 0.15), 2.0)),
    ('bag', 0.12, -0.4, ('bag_black', 0.5, 0.5, (0.25, 0.05), 0.8)),
    ('box', -0.25, -0.45, ((0.42, 0.34, 0.3), 0.4, (0, 0, 0))),
    ('bottle', 0.55, -0.3, (math.pi / 2, 0, 0.7)),
])
lixo('Lixo_b', [
    ('bag', 0.0, 0.0, ('bag_black', 0.6, 0.66, (0.0, 0.08), 0.0)),
    ('bag', 0.45, -0.12, ('bag_white', 0.42, 0.46, (0.1, -0.15), 0.9)),
    ('bag', -0.42, -0.1, ('bag_black', 0.46, 0.52, (-0.18, 0.0), 2.4)),
    ('bottle', 0.2, 0.42, (math.pi / 2, 0, 2.0)),
    ('bottle', -0.15, 0.48, (math.pi / 2, 0, 0.3)),
])
lixo('Lixo_c', [
    ('bag', 0.0, 0.0, ('bag_black', 0.62, 0.7, (0.0, 0.0), 0.5)),
    ('bag', 0.48, 0.1, ('bag_black', 0.5, 0.56, (0.0, -0.2), 1.0)),
    ('bag', -0.46, 0.05, ('bag_black', 0.52, 0.58, (0.0, 0.2), 2.0)),
    ('bag', 0.05, 0.48, ('bag_blue', 0.46, 0.5, (-0.2, 0.0), 2.8)),
    ('bag', 0.02, -0.46, ('bag_white', 0.4, 0.44, (0.22, 0.0), 0.2)),
    ('box', 0.62, -0.5, ((0.5, 0.4, 0.22), 0.9, (0.2, 0, 0))),
])


# ------------------------------------------------------------------ pneus

def tire(bd, c, rot=(0, 0, 0), r=0.31, width=0.2, role='rubber'):
    """Pneu: perfil arredondado com sulcos na banda de rodagem (modulação radial)."""
    hw = width / 2
    prof = [(0.19, -hw * 0.8), (r - 0.04, -hw), (r - 0.006, -hw * 0.6), (r, 0.0), (r - 0.006, hw * 0.6), (r - 0.04, hw), (0.19, hw * 0.8), (0.18, 0.0), (0.19, -hw * 0.8)]
    segs = 28

    def tread(k, i):
        # Só a banda de rodagem (pontos 2..4) tem sulcos alternados.
        return 1.0 - (0.025 if (2 <= i <= 4 and k % 2 == 0) else 0.0)

    bd.lathe(prof, segs, role, c, rot, radial=tread)


bd = Builder('Pneu')
tire(bd, (0, 0, 0.1))
bd.build(objs)

bd = Builder('PilhaPneus')
for i in range(4):
    tire(bd, (rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 0.1 + i * 0.2), (rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), 0))
bd.build(objs)
collider(objs, 'Col_PilhaPneus_0', (0, 0, 0.4), (0.66, 0.66, 0.8))

bd = Builder('BarricadaPneus')
spots = [(-0.6, 0, 0.1), (0.0, 0.05, 0.1), (0.6, -0.05, 0.1), (-0.3, 0.02, 0.3), (0.32, 0.0, 0.3), (0.0, 0.0, 0.5), (-0.95, 0.35, 0.1), (0.95, 0.3, 0.1)]
for i, (x, y, z) in enumerate(spots):
    tire(bd, (x, y, z), (rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 0), role='rubber_burnt' if i % 3 == 0 else 'rubber')
# Um pneu em pé encostado e o tambor de 200 L enferrujado.
tire(bd, (1.15, -0.35, 0.32), (math.pi / 2 - 0.25, 0, 0.4))
bd.lathe([(0.0, 0.0), (0.29, 0.0), (0.29, 0.3), (0.3, 0.32), (0.29, 0.34), (0.29, 0.58), (0.3, 0.6), (0.29, 0.62), (0.29, 0.88), (0.0, 0.88)], 18, 'rust', (-1.25, -0.3, 0))
# Tábua atravessada por cima.
bd.box((0.0, -0.25, 0.75), (2.2, 0.18, 0.03), 'wood', rot=(0.15, 0.08, 0.05))
bd.build(objs)
collider(objs, 'Col_BarricadaPneus_0', (0.0, 0.0, 0.42), (2.9, 1.0, 0.85))

bd = Builder('BarricadaMadeira')
for px in (-0.65, 0.65):
    # Palete em pé: três tábuas largas na frente e três travessas.
    bd.push((px, 0, 0), (0, 0, rnd.uniform(-0.08, 0.08)))
    for k in range(5):
        bd.box((-0.48 + k * 0.24, 0, 0.6), (0.14, 0.025, 1.2), 'wood', bevel=0.004)
    for z in (0.1, 0.6, 1.1):
        bd.box((0, 0.06, z), (1.2, 0.1, 0.09), 'wood', bevel=0.005)
    bd.pop()
# Tábuas cruzadas.
bd.box((0, -0.08, 0.7), (2.6, 0.03, 0.14), 'wood', bevel=0.004, rot=(0, 0.35, 0))
bd.box((0, -0.1, 0.7), (2.6, 0.03, 0.14), 'wood', bevel=0.004, rot=(0, -0.3, 0))
# Blocos de concreto na base e um saco de areia.
for i, x in enumerate((-1.1, -0.5, 0.2, 0.9)):
    bd.box((x, -0.35, 0.1), (0.39, 0.19, 0.19), 'concrete', bevel=0.006, rot=(0, 0, rnd.uniform(-0.2, 0.2)))
bd.blob((0.45, -0.38, 0.32), (0.3, 0.18, 0.12), 'sack', sub=2, amp=0.1, seed=4)
bd.build(objs)
collider(objs, 'Col_BarricadaMadeira_0', (0, -0.1, 0.6), (2.7, 0.7, 1.2))

COLORS = {
    'bag_black': ((0.025, 0.025, 0.03), 0.0, 0.28),
    'bag_blue': ((0.05, 0.18, 0.55), 0.0, 0.3),
    'bag_white': ((0.82, 0.82, 0.8), 0.0, 0.35),
    'cardboard': ((0.55, 0.38, 0.2), 0.0, 0.9),
    'bottle': ((0.1, 0.35, 0.12), 0.0, 0.1),
    'rubber': ((0.04, 0.04, 0.045), 0.0, 0.85),
    'rubber_burnt': ((0.02, 0.018, 0.016), 0.0, 1.0),
    'rust': ((0.42, 0.18, 0.08), 0.3, 0.8),
    'wood': ((0.5, 0.36, 0.22), 0.0, 0.85),
    'concrete': ((0.55, 0.55, 0.53), 0.0, 0.95),
    'sack': ((0.72, 0.64, 0.46), 0.0, 1.0),
}
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
export(objs, out_glb, COLORS)
print(f'[favela] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for o in objs:
        if o.name.startswith('Col_'):
            o.hide_render = True
    pos = {'Lixo_a': (-3, 0), 'Lixo_b': (-1.5, 0), 'Lixo_c': (0.2, 0), 'Pneu': (2, 0.5), 'PilhaPneus': (3, 0.5), 'BarricadaPneus': (-1, 2.5), 'BarricadaMadeira': (2.5, 2.8)}
    for o in objs:
        if o.name in pos:
            o.location = (*pos[o.name], 0)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.7, 0.85, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.mesh.primitive_plane_add(size=30)
    bpy.ops.object.camera_add(location=(0, -7.5, 4.2))
    cam = bpy.context.active_object
    cam.data.lens = 35
    d = Vector((0, 1.2, 0.4)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
