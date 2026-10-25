"""Peças do lobby (boteco de laje) e troncos da mata, modeladas no lugar das caixas.

Objetos (papéis de material entre parênteses; o jogo troca pelos dele):
  MesaBar       mesa quadrada de plástico de bar: tampo com borda, saia, pés afunilados e
                travessas (plastic)
  CadeiraBar    cadeira de plástico de bar com braços, encosto de ripas e pés abertos (plastic)
  Engradado     engradado de cerveja vazado com alças, nervuras e 24 garrafas com tampinha
                (crate, bottle, cap, shadow)
  Isopor        caixa de isopor com cantos arredondados, tampa e alça de corda (foam, lid, rope)
  CaixaSom      caixa de som de festa: gabinete chanfrado, tela, alça, painel e pés
                (case, grille, metal, panel) — os alto-falantes pulsando ficam no jogo
  Tronco_a/b    troncos caídos com casca irregular, toco de galho e pontas cortadas com
                anéis (bark_log, wood_end); deitados no eixo X
Colisores: Col_<nome>_<n>. Eixos (Blender): Z para cima, base em z = 0.

  blender -b --python tools/blender/lobby_props.py -- public/assets/world/lobby.glb [preview.png]
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402
from meshkit import Builder, collider, export  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/lobby.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None
rnd = random.Random(20261025)
reset_scene()
objs = []


# ------------------------------------------------------------------ mesa de bar
def mesa():
    b = Builder('MesaBar')
    h = 0.72
    b.box((0, 0, h - 0.02), (0.72, 0.72, 0.04), 'plastic', bevel=0.012)
    # Borda levantada do tampo e saia por baixo.
    for s in (-1, 1):
        b.box((0, s * 0.355, h + 0.004), (0.72, 0.018, 0.02), 'plastic', bevel=0.006)
        b.box((s * 0.355, 0, h + 0.004), (0.018, 0.72, 0.02), 'plastic', bevel=0.006)
        b.box((0, s * 0.33, h - 0.075), (0.66, 0.02, 0.08), 'plastic', bevel=0.006)
        b.box((s * 0.33, 0, h - 0.075), (0.02, 0.66, 0.08), 'plastic', bevel=0.006)
    # Pés afunilados, um pouco abertos, e travessas baixas.
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = Vector((sx * 0.3, sy * 0.3, h - 0.06))
            foot = Vector((sx * 0.335, sy * 0.335, 0.0))
            b.tube([foot, (foot + top) / 2, top], lambda t: 0.017 + 0.009 * t, 'plastic', segs=8)
    for s in (-1, 1):
        b.tube([(-0.31, s * 0.31, 0.22), (0.31, s * 0.31, 0.22)], 0.011, 'plastic', segs=6)
        b.tube([(s * 0.31, -0.31, 0.22), (s * 0.31, 0.31, 0.22)], 0.011, 'plastic', segs=6)
    b.build(objs)
    collider(objs, 'Col_MesaBar_1', (0, 0, h / 2), (0.72, 0.72, h))


# ------------------------------------------------------------------ cadeira de bar
def cadeira():
    b = Builder('CadeiraBar')
    sh = 0.44
    # Assento levemente côncavo (duas placas) com borda arredondada.
    b.box((0, 0.02, sh), (0.46, 0.42, 0.035), 'plastic', bevel=0.014)
    b.box((0, 0.02, sh + 0.02), (0.4, 0.36, 0.008), 'plastic', bevel=0.003)
    # Pés: os de trás sobem e viram o encosto.
    for sx in (-1, 1):
        b.tube([(sx * 0.23, 0.22, 0.0), (sx * 0.215, 0.2, sh)], 0.018, 'plastic', segs=8)
        b.tube([(sx * 0.23, -0.2, 0.0), (sx * 0.215, -0.19, sh), (sx * 0.2, -0.24, 0.62), (sx * 0.19, -0.27, 0.86)], 0.019, 'plastic', segs=8)
        # Braço: do encosto até a frente.
        b.tube([(sx * 0.2, -0.24, 0.62), (sx * 0.225, 0.0, 0.63), (sx * 0.225, 0.2, 0.6), (sx * 0.215, 0.2, sh)], 0.016, 'plastic', segs=8)
    # Encosto de ripas, inclinado para trás.
    for k, z in enumerate((0.58, 0.68, 0.78)):
        y = -0.235 - (z - 0.58) * 0.14
        b.box((0, y, z), (0.38, 0.018, 0.06 if k < 2 else 0.08), 'plastic', bevel=0.007, rot=(-0.15, 0, 0))
    b.box((0, -0.275, 0.865), (0.42, 0.02, 0.035), 'plastic', bevel=0.008, rot=(-0.15, 0, 0))
    b.build(objs)


# ------------------------------------------------------------------ engradado de cerveja
def engradado():
    b = Builder('Engradado')
    w, d, h = 0.36, 0.5, 0.29
    # Fundo, faixa de cima e de baixo, colunas nos cantos e nervuras verticais (vazado).
    b.box((0, 0, 0.012), (w, d, 0.024), 'crate', bevel=0.005)
    for z, t in ((0.02, 0.04), (h - 0.03, 0.06)):
        for s in (-1, 1):
            b.box((0, s * (d / 2 - 0.008), z + t / 2 - 0.02), (w, 0.016, t), 'crate', bevel=0.004)
            b.box((s * (w / 2 - 0.008), 0, z + t / 2 - 0.02), (0.016, d, t), 'crate', bevel=0.004)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((sx * (w / 2 - 0.015), sy * (d / 2 - 0.015), h / 2), (0.03, 0.03, h), 'crate', bevel=0.006)
    for k in range(1, 5):
        y = -d / 2 + d * k / 5
        for s in (-1, 1):
            b.box((s * (w / 2 - 0.008), y, h / 2), (0.016, 0.022, h - 0.05), 'crate', bevel=0.003)
    for k in range(1, 3):
        x = -w / 2 + w * k / 3
        for s in (-1, 1):
            b.box((x, s * (d / 2 - 0.008), h / 2), (0.022, 0.016, h - 0.05), 'crate', bevel=0.003)
    # Alças (vão escuro) nas cabeceiras.
    for s in (-1, 1):
        b.box((0, s * (d / 2 - 0.006), h - 0.045), (0.12, 0.02, 0.035), 'shadow')
    # Divisórias internas (grade) e 24 garrafas com tampinha.
    for k in range(1, 4):
        b.box((-w / 2 + w * k / 4, 0, 0.12), (0.008, d - 0.03, 0.2), 'crate')
    for k in range(1, 6):
        b.box((0, -d / 2 + d * k / 6, 0.12), (w - 0.03, 0.008, 0.2), 'crate')
    for i in range(4):
        for j in range(6):
            x = -w / 2 + w * (i + 0.5) / 4
            y = -d / 2 + d * (j + 0.5) / 6
            b.lathe([(0.0, 0.025), (0.032, 0.025), (0.032, 0.2), (0.026, 0.24), (0.013, 0.29), (0.013, 0.315)], 10, 'bottle', (x, y, 0))
            b.cyl((x, y, 0.318), 0.015, 0.012, 'cap', segs=10)
    b.build(objs)
    collider(objs, 'Col_Engradado_1', (0, 0, h / 2), (w, d, h))


# ------------------------------------------------------------------ isopor
def isopor():
    b = Builder('Isopor')
    w, d, h = 0.62, 0.42, 0.4
    b.box((0, 0, h / 2), (w, d, h), 'foam', bevel=0.035)
    # Frisos horizontais do molde.
    for z in (0.12, 0.26):
        b.box((0, 0, z), (w + 0.006, d + 0.006, 0.014), 'foam', bevel=0.006)
    b.box((0, 0, h + 0.03), (w + 0.03, d + 0.03, 0.06), 'lid', bevel=0.025)
    b.box((0, 0, h + 0.065), (w - 0.1, d - 0.1, 0.02), 'lid', bevel=0.01)
    # Alça de corda passando pelas laterais.
    for s in (-1, 1):
        b.tube([(s * (w / 2 + 0.005), -0.08, h - 0.05), (s * (w / 2 + 0.03), 0, h + 0.02), (s * (w / 2 + 0.005), 0.08, h - 0.05)], 0.008, 'rope', segs=6)
    b.build(objs)


# ------------------------------------------------------------------ caixa de som
def caixa_som():
    b = Builder('CaixaSom')
    w, d, h = 0.55, 0.42, 0.85
    b.box((0, 0, h / 2 + 0.03), (w, d, h), 'case', bevel=0.04)
    # Tela frontal (frente = +Y) com moldura.
    b.box((0, d / 2 + 0.002, h / 2 + 0.05), (w - 0.08, 0.012, h - 0.18), 'grille', bevel=0.01)
    b.box((0, d / 2 - 0.004, 0.13), (w - 0.1, 0.02, 0.07), 'panel', bevel=0.006)
    # Alça de cima e pezinhos de borracha.
    b.tube([(-0.12, 0, h + 0.03), (-0.1, 0, h + 0.09), (0.1, 0, h + 0.09), (0.12, 0, h + 0.03)], 0.014, 'metal', segs=8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl((sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0.015), 0.025, 0.03, 'panel', segs=10)
    b.build(objs)


# ------------------------------------------------------------------ troncos caídos
def tronco(name, length, radius, seed):
    b = Builder(name)
    rings = 18
    prof = [(0.0, -length / 2)]
    for i in range(rings + 1):
        t = i / rings
        r = radius * (1.0 - 0.18 * t) * (1 + 0.06 * math.sin(t * 11 + seed))
        prof.append((r, -length / 2 + length * t))
    prof.append((0.0, length / 2))

    def radial(k, i):
        # Casca grossa: sulcos ao longo do tronco e calombos.
        a = 2 * math.pi * k / 16
        return 1 + 0.07 * math.sin(a * 5 + seed) + 0.05 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, i * 0.35 + seed)))

    def role(i):
        return 'wood_end' if i == 0 or i == len(prof) - 2 else 'bark_log'
    # Deitado no eixo X, apoiado no chão (centro a um raio do chão).
    b.lathe(prof, 16, role, (0, 0, radius * 0.92), (0, math.pi / 2, 0), radial)
    # Toco de galho quebrado e uma lasca solta.
    gx = length * (0.15 if seed > 1 else -0.2)
    b.cyl((gx, radius * 0.6, radius * 1.5), radius * 0.28, radius * 1.1, 'bark_log', axis='z', segs=8, r2=radius * 0.16)
    b.lathe([(0.0, 0), (radius * 0.3, 0.0), (radius * 0.18, radius * 0.9), (0.0, radius * 0.95)], 8, 'bark_log', (-gx * 0.6, -radius * 0.7, radius * 1.1), (0.9, 0.2, 0))
    b.build(objs, smooth_angle=60)
    collider(objs, f'Col_{name}_1', (0, 0, radius * 0.9), (length, radius * 2, radius * 1.8))


mesa()
cadeira()
engradado()
isopor()
caixa_som()
tronco('Tronco_a', 3.6, 0.28, 0.7)
tronco('Tronco_b', 2.2, 0.22, 2.3)

COLORS = {
    'plastic': ((0.75, 0.06, 0.04), 0.0, 0.45),
    'crate': ((0.9, 0.7, 0.05), 0.0, 0.5),
    'bottle': ((0.25, 0.1, 0.02), 0.0, 0.15),
    'cap': ((0.8, 0.7, 0.3), 0.8, 0.3),
    'shadow': ((0.02, 0.02, 0.02), 0.0, 1.0),
    'foam': ((0.93, 0.92, 0.88), 0.0, 0.9),
    'lid': ((0.15, 0.35, 0.8), 0.0, 0.5),
    'rope': ((0.85, 0.8, 0.65), 0.0, 1.0),
    'case': ((0.05, 0.05, 0.06), 0.0, 0.6),
    'grille': ((0.1, 0.1, 0.11), 0.6, 0.5),
    'panel': ((0.12, 0.12, 0.13), 0.0, 0.5),
    'metal': ((0.6, 0.6, 0.62), 1.0, 0.3),
    'bark_log': ((0.3, 0.2, 0.12), 0.0, 1.0),
    'wood_end': ((0.75, 0.58, 0.38), 0.0, 0.9),
}
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
export(objs, out_glb, COLORS)
print(f'[lobby] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for o in objs:
        if o.name.startswith('Col_'):
            o.hide_render = True
    pos = {'MesaBar': (-1.2, 0), 'CadeiraBar': (-0.3, 0.2), 'Engradado': (0.6, 0), 'Isopor': (1.4, 0), 'CaixaSom': (2.3, 0), 'Tronco_a': (0, 1.6), 'Tronco_b': (2.6, 1.6)}
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
    bpy.ops.object.camera_add(location=(0.6, -4.2, 2.2))
    cam = bpy.context.active_object
    cam.data.lens = 35
    dvec = Vector((0.6, 0.6, 0.4)) - cam.location
    cam.rotation_euler = dvec.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
