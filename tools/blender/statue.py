"""Estátua de braços abertos no alto do morro (marco visual do mapa).

Lembra os monumentos de braços abertos sobre os morros brasileiros sem replicar nenhum:
figura genérica de túnica com pregas, braços abertos um pouco ACIMA da horizontal (num
gesto de abraço, não em cruz), mangas largas pendendo, faixa amarrada na cintura com as
pontas caídas, cabeça erguida e lisa (sem rosto detalhado) e pedestal de degraus quadrados
com cornija simples. O uso comercial da imagem do Cristo Redentor é controlado pela
Arquidiocese do Rio de Janeiro, então o desenho foge de propósito das proporções, do
pedestal e da pose exata dele.

Saída: objeto Estatua (materiais 'stone' e 'pedestal') e colisores Col_estatua_<n>.
Eixos (Blender): Z para cima, frente da figura em -Y (no jogo vira +Z), base em z = 0.

Uso:
  blender -b --python tools/blender/statue.py -- public/assets/world/statue.glb [preview.png]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args, select_only  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/statue.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None

MATS = ['stone', 'pedestal']
# Medidas abaixo em "unidades de projeto"; tudo é multiplicado por SCALE na saída
# (1,35 → pedestal de 9,5 m e figura de 27 m: marco visível do outro lado do mapa).
SCALE = 1.35
PED_H = 7.0          # altura do pedestal
FIG_H = 20.0         # altura da figura (dos pés ao topo da cabeça)
SHOULDER = PED_H + 15.6
ARM_RISE = math.radians(9)


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Builder:
    def __init__(self):
        self.verts, self.faces, self.mats = [], [], []

    def v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def f(self, idx, mat):
        self.faces.append(tuple(idx))
        self.mats.append(MATS.index(mat))

    def loft(self, rings, mat, cap0=True, cap1=True):
        """Une anéis (listas de pontos com a mesma contagem) em quads; tampa as pontas."""
        ids = [[self.v(p) for p in r] for r in rings]
        n = len(ids[0])
        for a, b in zip(ids, ids[1:]):
            for k in range(n):
                j = (k + 1) % n
                self.f([a[k], a[j], b[j], b[k]], mat)
        if cap0:
            self.f(list(reversed(ids[0])), mat)
        if cap1:
            self.f(ids[-1], mat)

    def box(self, c, s, mat):
        cx, cy, cz = c
        sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        p = [self.v((cx + x * sx, cy + y * sy, cz + z * sz)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
        for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.f([p[i] for i in q], mat)

    def ellipsoid(self, c, r, mat, segs=24, rings=14):
        cx, cy, cz = c
        out = []
        for i in range(1, rings):
            phi = math.pi * i / rings
            out.append([(cx + r[0] * math.sin(phi) * math.cos(2 * math.pi * k / segs),
                         cy + r[1] * math.sin(phi) * math.sin(2 * math.pi * k / segs),
                         cz + r[2] * math.cos(phi)) for k in range(segs)])
        top = self.v((cx, cy, cz + r[2]))
        bot = self.v((cx, cy, cz - r[2]))
        ids = [[self.v(p) for p in ring] for ring in out]
        for a, b in zip(ids, ids[1:]):
            for k in range(segs):
                j = (k + 1) % segs
                self.f([a[k], b[k], b[j], a[j]], mat)
        for k in range(segs):
            j = (k + 1) % segs
            self.f([top, ids[0][k], ids[0][j]], mat)
            self.f([bot, ids[-1][j], ids[-1][k]], mat)

    def tube(self, path, radius, mat, segs=8):
        rings = []
        for i, p in enumerate(path):
            a = path[max(0, i - 1)]
            b = path[min(len(path) - 1, i + 1)]
            t = (Vector(b) - Vector(a)).normalized()
            u = t.cross(Vector((0, 0, 1)))
            if u.length < 1e-3:
                u = t.cross(Vector((1, 0, 0)))
            u.normalize()
            w = t.cross(u).normalized()
            r = radius(i / (len(path) - 1)) if callable(radius) else radius
            rings.append([tuple(Vector(p) + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        self.loft(rings, mat)

    def build(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v * SCALE) for v in self.verts], [], self.faces)
        for m in MATS:
            me.materials.append(bpy.data.materials.get(m) or new_mat(m))
        for poly, mi in zip(me.polygons, self.mats):
            poly.material_index = mi
        me.validate()
        obj = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(obj)
        return obj


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.86, 0.84, 0.78, 1) if name == 'stone' else (0.55, 0.53, 0.5, 1)
    bsdf.inputs['Roughness'].default_value = 0.8
    return m


bd = Builder()

# ------------------------------------------------------------------ pedestal
# Três degraus largos, base quadrada alta com almofadas rebaixadas e cornija.
bd.box((0, 0, 0.4), (11, 11, 0.8), 'pedestal')
bd.box((0, 0, 1.1), (9.4, 9.4, 0.6), 'pedestal')
bd.box((0, 0, 1.6), (8.2, 8.2, 0.4), 'pedestal')
bd.box((0, 0, 1.8 + 2.3), (6.0, 6.0, 4.6), 'pedestal')
for s in (-1, 1):
    # Almofadas (painéis rebaixados) nas quatro faces.
    bd.box((0, s * 3.0, 4.1), (4.0, 0.12, 3.2), 'pedestal')
    bd.box((s * 3.0, 0, 4.1), (0.12, 4.0, 3.2), 'pedestal')
bd.box((0, 0, 6.6), (6.8, 6.8, 0.4), 'pedestal')
bd.box((0, 0, 6.9), (6.2, 6.2, 0.2), 'pedestal')

# ------------------------------------------------------------------ túnica (corpo)
# (z relativo aos pés, raio lateral, raio frente-trás)
ROBE = [(0.0, 2.35, 1.75), (0.6, 2.2, 1.65), (2.5, 2.0, 1.5), (6.0, 1.88, 1.38), (9.4, 1.78, 1.28), (10.2, 1.8, 1.3),
        (12.6, 2.1, 1.46), (14.4, 2.55, 1.52), (15.5, 2.75, 1.42), (16.15, 2.2, 1.25), (16.6, 1.25, 0.95), (16.9, 0.72, 0.68)]
SEG = 36
FOLDS = 13
rings = []
for i in range(len(ROBE) - 1):
    z0, rx0, ry0 = ROBE[i]
    z1, rx1, ry1 = ROBE[i + 1]
    steps = max(1, int((z1 - z0) / 0.7))
    for s in range(steps):
        t = s / steps
        t2 = t * t * (3 - 2 * t)
        z = z0 + (z1 - z0) * t
        rx = rx0 + (rx1 - rx0) * t2
        ry = ry0 + (ry1 - ry0) * t2
        # Pregas verticais: fortes na barra, somem no peito; menos nas costas.
        amp = 0.075 * (1 - smooth(0, 12.5, z)) + 0.012
        ring = []
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            front = 0.6 + 0.4 * max(0.0, -math.sin(a))
            r = 1 + amp * front * math.sin(FOLDS * a)
            ring.append((rx * r * math.cos(a), ry * r * math.sin(a), PED_H + z))
        rings.append(ring)
z, rx, ry = ROBE[-1]
rings.append([(rx * math.cos(2 * math.pi * k / SEG), ry * math.sin(2 * math.pi * k / SEG), PED_H + z) for k in range(SEG)])
bd.loft(rings, 'stone')

# Pescoço e cabeça (erguida, lisa) com cabelo curto como uma touca.
bd.loft([[(0.62 * math.cos(2 * math.pi * k / 16), 0.6 * math.sin(2 * math.pi * k / 16), PED_H + z) for k in range(16)] for z in (16.7, 17.6)], 'stone')
head_c = (0, -0.05, PED_H + 18.55)
bd.ellipsoid(head_c, (0.95, 1.08, 1.3), 'stone')
bd.ellipsoid((0, 0.18, PED_H + 18.85), (1.0, 1.08, 1.12), 'stone', segs=20, rings=10)
# Nariz e queixo discretos (só volume, sem feições).
bd.ellipsoid((0, -1.08, PED_H + 18.5), (0.16, 0.18, 0.3), 'stone', segs=10, rings=6)

# Faixa amarrada na cintura e as duas pontas caídas na frente.
waist = []
for k in range(SEG + 1):
    a = 2 * math.pi * k / SEG
    waist.append((1.86 * math.cos(a), 1.36 * math.sin(a), PED_H + 10.1))
bd.tube(waist, 0.2, 'stone', segs=8)
for s in (-1, 1):
    end = [(s * (0.45 + 0.08 * t), -1.38 - 0.06 * t, PED_H + 10.0 - 3.2 * t) for t in [i / 6 for i in range(7)]]
    bd.tube(end, lambda t: 0.17 * (1 - 0.35 * t), 'stone', segs=8)

# ------------------------------------------------------------------ braços
ARM_X0, WRIST, TIP = 2.0, 9.1, 10.75


def arm_point(x):
    return (x, 0.0, SHOULDER + (x - ARM_X0) * math.tan(ARM_RISE))


for side in (-1, 1):
    rings = []
    xs = [ARM_X0 + (WRIST - ARM_X0) * i / 16 for i in range(17)] + [WRIST + 0.12, WRIST + 0.5, 9.9, 10.4, TIP]
    for x in xs:
        cx, cy, cz = arm_point(x)
        if x <= WRIST:
            r = 0.82 - 0.36 * smooth(ARM_X0, WRIST, x)
            # Manga larga: pende mais perto do punho e fecha na borda.
            hang = (0.25 + 1.45 * smooth(2.6, 8.4, x)) * (1 - smooth(8.75, WRIST, x))
            thick = 1.0
        else:
            # Mão aberta, palma para a frente: chata em Y, larga em Z.
            t = (x - WRIST) / (TIP - WRIST)
            r = 0.5 * (1 - 0.3 * t * t)
            hang = 0.0
            thick = 0.42
        ring = []
        for k in range(18):
            a = 2 * math.pi * k / 18
            ca, sa = math.cos(a), math.sin(a)
            y = r * ca * thick
            zz = r * sa
            if x <= WRIST and sa < 0:
                zz -= hang * (-sa) ** 1.6
                y *= 1 - 0.25 * smooth(0, 1, -sa) * min(1, hang)
            ring.append((side * cx, cy + y, cz + zz))
        if side < 0:
            ring.reverse()
        rings.append(ring)
    bd.loft(rings, 'stone')
    # Polegar.
    px, _, pz = arm_point(WRIST + 0.35)
    bd.tube([(side * px, -0.08, pz + 0.3), (side * (px + 0.3), -0.3, pz + 0.55)], 0.13, 'stone', segs=6)

statue = bd.build('Estatua')
select_only(statue)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.001)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
statue.data.shade_smooth()
try:
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50), keep_sharp_edges=True)
except Exception:
    statue.data.use_auto_smooth = True
    statue.data.auto_smooth_angle = math.radians(50)
tris = sum(len(p.vertices) - 2 for p in statue.data.polygons)
print(f'[estatua] {len(statue.data.vertices)} vértices, {tris} triângulos')

# ------------------------------------------------------------------ colisores
cols = []


def col(n, c, s):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(v * SCALE for v in c))
    o = bpy.context.active_object
    o.name = f'Col_estatua_{n}'
    o.scale = tuple(v * SCALE for v in s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cols.append(o)


col(0, (0, 0, 0.9), (11, 11, 1.8))
col(1, (0, 0, 1.8 + 2.65), (6.4, 6.4, 5.3))
col(2, (0, 0, PED_H + 8.2), (4.2, 3.2, 16.4))
col(3, (0, 0, SHOULDER + 0.6), (21.6, 1.8, 2.6))
col(4, (0, 0, PED_H + 18.5), (2.0, 2.2, 3.0))

for o in bpy.context.view_layer.objects:
    o.select_set(o is statue or o in cols)
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=False,
                          export_normals=True, export_materials='EXPORT', export_animations=False, export_morph=False, export_skins=False)
print(f'[estatua] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for c in cols:
        c.hide_render = True
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.72, 0.92, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(55), 0, math.radians(-35)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.object.camera_add(location=(14 * SCALE, -46 * SCALE, 18 * SCALE))
    cam = bpy.context.active_object
    cam.data.lens = 50
    d = Vector((0, 0, 15 * SCALE)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
    print(f'[estatua] prévia {preview_png}')
