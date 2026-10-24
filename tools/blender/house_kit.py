"""Kit de peças das casas (geometria de verdade, com chanfros): janelas, porta, portão,
caixa d'água, medidor de luz, ar-condicionado e antena.

blender -b --python tools/blender/house_kit.py -- <pasta public/assets/world> [--sem-previa]

Saída: kit.glb com um objeto por peça (Kit_<nome>). Materiais por papel (o jogo troca
pelos dele): aluminio, vidro, madeira, metal (tingido com a cor do portão), concreto,
caixa (azul), plastico (branco), borracha.

Convenção: origem no centro do vão, no plano da face externa da parede; a peça olha
para −Y no Blender (+Z no glTF/jogo) e fica recuada para dentro do vão (para +Y). As
peças de parede (medidor, ar-condicionado) ficam na face externa, para fora (−Y).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
out_dir = os.path.abspath(args[0])
make_preview = '--sem-previa' not in args
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def pbr(name, hex_, metal=0.0, rough=0.5, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


MAT = {
    'aluminio': pbr('aluminio', '#c9ccd0', 0.8, 0.35),
    'vidro': pbr('vidro', '#22313d', 0.3, 0.06, 0.6),
    'madeira': pbr('madeira', '#7a4a2a', 0.0, 0.65),
    'metal': pbr('metal', '#d0d0d0', 0.4, 0.5),
    'concreto': pbr('concreto', '#a6a197', 0.0, 0.9),
    'caixa': pbr('caixa', '#2c6fd6', 0.0, 0.45),
    'plastico': pbr('plastico', '#ecebe6', 0.0, 0.5),
    'borracha': pbr('borracha', '#1c1d20', 0.0, 0.8),
}
ROLES = list(MAT)
parts = []


class Piece:
    """Acumula caixas/cilindros (com chanfro) num objeto só, cada um com seu papel."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.roles = []

    def _mark(self, faces, role):
        for f in faces:
            f.material_index = ROLES.index(role)

    def box(self, size, center, role, bevel=0.006, rot=None):
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = ret['verts']
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        if rot:
            from mathutils import Euler
            bmesh.ops.rotate(self.bm, cent=Vector((0, 0, 0)), matrix=Euler(rot).to_matrix(), verts=verts)
        bmesh.ops.translate(self.bm, vec=Vector(center), verts=verts)
        faces = list({f for v in verts for f in v.link_faces})
        self._mark(faces, role)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel, segments=1, affect='EDGES', profile=0.5)
            self._mark(res['faces'], role)

    def cyl(self, r1, r2, depth, center, role, segs=16, axis='Z', rot=None):
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
        verts = ret['verts']
        if axis == 'X':
            bmesh.ops.rotate(self.bm, cent=Vector(), matrix=Vector((0, 1, 0)).to_track_quat('Z', 'Y').to_matrix(), verts=verts)
            bmesh.ops.rotate(self.bm, cent=Vector(), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=verts)
        elif axis == 'Y':
            bmesh.ops.rotate(self.bm, cent=Vector(), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'X'), verts=verts)
        if rot:
            from mathutils import Euler
            bmesh.ops.rotate(self.bm, cent=Vector(), matrix=Euler(rot).to_matrix(), verts=verts)
        bmesh.ops.translate(self.bm, vec=Vector(center), verts=verts)
        faces = list({f for v in verts for f in v.link_faces})
        self._mark(faces, role)

    def done(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for k in ROLES:
            me.materials.append(MAT[k])
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(o)
        mod = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        parts.append(o)
        return o


def frame(p, w, h, depth, prof, y, role):
    """Batente/moldura retangular (quatro barras) com o vão w × h centrado em (0, z=0)."""
    p.box((w + 2 * prof, depth, prof), (0, y, h / 2 + prof / 2), role)
    p.box((w + 2 * prof, depth, prof), (0, y, -h / 2 - prof / 2), role)
    p.box((prof, depth, h), (-w / 2 - prof / 2, y, 0), role)
    p.box((prof, depth, h), (w / 2 + prof / 2, y, 0), role)


# ------------------------------------------------------------------ janela de correr 1,2 × 1,0
W, H = 1.2, 1.0
REC = 0.08          # recuo do caixilho para dentro do vão
p = Piece('Kit_Janela')
frame(p, W, H, 0.07, 0.045, REC, 'aluminio')
for i, off in enumerate((-W / 4, W / 4)):
    yy = REC - 0.012 + i * 0.024
    frame(p, W / 2 - 0.05, H - 0.07, 0.025, 0.03, yy, 'aluminio')
    p.box((W / 2 - 0.05, 0.006, H - 0.07), (off, yy, 0), 'vidro', bevel=0)
p.box((W / 2 + 0.02, 0.02, 0.03), (-W / 4, REC - 0.02, H * 0.05), 'aluminio')       # puxador
p.box((W + 0.2, 0.2, 0.05), (0, -0.04, -H / 2 - 0.045), 'concreto', bevel=0.01)     # peitoril
p.done()

# grade da janela (por fora)
p = Piece('Kit_Grade')
for i in range(7):
    x = -W / 2 + 0.05 + i * (W - 0.1) / 6
    p.cyl(0.008, 0.008, H + 0.08, (x, -0.06, 0), 'metal', segs=6)
for z in (-H / 2 + 0.06, 0, H / 2 - 0.06):
    p.box((W + 0.08, 0.02, 0.02), (0, -0.06, z), 'metal', bevel=0.003)
frame(p, W + 0.02, H + 0.02, 0.025, 0.025, -0.06, 'metal')
p.done()

# ------------------------------------------------------------------ basculante 0,6 × 0,6
p = Piece('Kit_Basculante')
frame(p, 0.6, 0.6, 0.06, 0.035, REC, 'aluminio')
for i in range(3):
    z = -0.2 + i * 0.2
    p.box((0.58, 0.006, 0.19), (0, REC - 0.03, z), 'vidro', bevel=0, rot=(-0.45, 0, 0))
    p.box((0.58, 0.012, 0.02), (0, REC - 0.03, z - 0.09), 'aluminio', bevel=0.002)
p.box((0.72, 0.16, 0.04), (0, -0.03, -0.32), 'concreto', bevel=0.008)
p.done()

# ------------------------------------------------------------------ porta de madeira 0,9 × 2,1
DW, DH = 0.9, 2.1
p = Piece('Kit_Porta')
frame(p, DW, DH, 0.12, 0.06, 0.05, 'madeira')
p.box((DW, 0.04, DH), (0, 0.09, 0), 'madeira', bevel=0.004)
for zi in range(3):
    for xi in (-1, 1):
        cz = -DH / 2 + 0.38 + zi * 0.66
        p.box((0.3, 0.025, 0.5), (xi * 0.2, 0.07, cz), 'madeira', bevel=0.012)        # almofadas
p.box((0.03, 0.06, 0.16), (DW / 2 - 0.1, 0.05, 0.0), 'aluminio')                    # espelho
p.cyl(0.012, 0.012, 0.12, (DW / 2 - 0.1, 0.03, 0.03), 'aluminio', segs=8, axis='X')   # maçaneta
p.box((DW + 0.3, 0.32, 0.12), (0, -0.12, -DH / 2 - 0.06), 'concreto', bevel=0.01)   # degrau
p.done()

# ------------------------------------------------------------------ portão de chapa 2,6 × 2,2
GW, GH = 2.6, 2.2
p = Piece('Kit_Portao')
frame(p, GW, GH, 0.08, 0.06, 0.04, 'metal')
p.box((GW, 0.02, GH), (0, 0.06, 0), 'metal', bevel=0.003)
for i in range(14):                                                               # nervuras
    x = -GW / 2 + 0.1 + i * (GW - 0.2) / 13
    p.box((0.035, 0.025, GH - 0.1), (x, 0.04, 0), 'metal', bevel=0.004)
p.box((GW, 0.03, 0.06), (0, 0.035, GH * 0.18), 'metal', bevel=0.005)
# portinha de pedestre recortada e fechadura
frame(p, 0.85, 1.95, 0.03, 0.025, 0.025, 'metal')
p.box((0.06, 0.05, 0.12), (0.4, 0.0, 0.0), 'borracha')
# grade de ventilação em cima
for i in range(10):
    p.cyl(0.008, 0.008, 0.32, (-0.45 + i * 0.1, 0.03, GH / 2 - 0.25), 'metal', segs=6)
p.done()

# ------------------------------------------------------------------ caixa d'água 1000 L
p = Piece('Kit_Caixa')
bm = p.bm
rings = []
for i in range(9):
    t = i / 8
    r = 0.52 + 0.2 * t
    z = t * 0.82
    rings.append([(r * math.cos(a * 2 * math.pi / 32), r * math.sin(a * 2 * math.pi / 32), z) for a in range(32)])
vs = [[bm.verts.new(v) for v in r] for r in rings]
for i in range(8):
    for j in range(32):
        f = bm.faces.new((vs[i][j], vs[i][(j + 1) % 32], vs[i + 1][(j + 1) % 32], vs[i + 1][j]))
        f.material_index = ROLES.index('caixa')
fb = bm.faces.new(list(reversed(vs[0])))
fb.material_index = ROLES.index('caixa')
for k in range(4):                                                                 # nervuras
    p.cyl(0.55 + 0.2 * (0.2 + k * 0.2) + 0.012, 0.55 + 0.2 * (0.2 + k * 0.2) + 0.012, 0.03, (0, 0, 0.17 + k * 0.17), 'caixa', segs=32)
p.cyl(0.76, 0.74, 0.08, (0, 0, 0.86), 'caixa', segs=32)                             # tampa
p.cyl(0.6, 0.3, 0.08, (0, 0, 0.94), 'caixa', segs=32)
p.cyl(0.14, 0.14, 0.04, (0, 0, 1.0), 'caixa', segs=16)
p.cyl(0.025, 0.025, 0.5, (0.65, 0, 0.5), 'plastico', segs=8)                         # cano de entrada
p.done()

# ------------------------------------------------------------------ medidor de luz (padrão de energia)
p = Piece('Kit_Medidor')
p.box((0.42, 0.2, 0.55), (0, -0.1, 0), 'concreto', bevel=0.01)
p.box((0.32, 0.02, 0.4), (0, -0.205, 0.02), 'plastico', bevel=0.004)
p.box((0.12, 0.012, 0.12), (0, -0.215, 0.08), 'vidro', bevel=0)
p.cyl(0.02, 0.02, 1.6, (0.12, -0.06, 1.05), 'plastico', segs=8)                     # eletroduto subindo
p.done()

# ------------------------------------------------------------------ ar-condicionado (condensadora)
p = Piece('Kit_ArCondicionado')
p.box((0.8, 0.3, 0.55), (0, -0.25, 0), 'plastico', bevel=0.02)
p.cyl(0.21, 0.21, 0.01, (-0.12, -0.405, 0), 'borracha', segs=24, axis='Y')
for i in range(6):                                                                # grade do ventilador
    p.cyl(0.21 - i * 0.035, 0.21 - i * 0.035, 0.012, (-0.12, -0.41, 0), 'metal', segs=24, axis='Y')
for x in (-0.3, 0.3):                                                             # suportes
    p.box((0.04, 0.42, 0.04), (x, -0.21, -0.3), 'metal', bevel=0.004)
    p.box((0.04, 0.04, 0.32), (x, -0.02, -0.15), 'metal', bevel=0.004, rot=(0.6, 0, 0))
p.done()

# ------------------------------------------------------------------ antena de TV (mastro e yagi)
p = Piece('Kit_Antena')
p.cyl(0.02, 0.02, 2.2, (0, 0, 1.1), 'metal', segs=8)
p.cyl(0.012, 0.012, 1.2, (0, 0, 2.05), 'metal', segs=6, axis='Y')
for i in range(7):
    y = -0.55 + i * 0.18
    p.cyl(0.006, 0.006, 0.7 - i * 0.05, (0, y, 2.05), 'metal', segs=4, axis='X')
p.done()

# ------------------------------------------------------------------ export
common.select_only(parts[0])
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
glb = os.path.join(out_dir, 'kit.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_materials='EXPORT', export_apply=True)
print(f'[kit] {len(parts)} peças; exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

if make_preview:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 1100, 560
    scene.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.75, 0.82, 1)
    scene.world = world
    sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (0.9, 0.1, -0.5)
    scene.collection.objects.link(sun)
    for i, o in enumerate(parts):
        o.location = ((i - len(parts) / 2) * 2.0, 0, 1.2)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0.0, -12, 2.6)
    cam.rotation_euler = (math.radians(84), 0, 0)
    cam.data.lens = 35
    prev = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', 'build', 'kit_previa')
    os.makedirs(prev, exist_ok=True)
    scene.render.filepath = os.path.join(prev, 'kit.png')
    bpy.ops.render.render(write_still=True)
print('[kit] concluído')
