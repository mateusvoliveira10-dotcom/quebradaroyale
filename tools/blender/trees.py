"""Árvores realistas: tronco e galhos de verdade e copa feita de "cartões" de folhas.

No lugar das copas de bolotas de vegetation.py (que pareciam blocos de longe e de perto),
cada árvore tem tronco afunilado com raízes aparentes, galhos que se dividem e dezenas de
cachos de folhas; cada cacho são vários cartões cruzados (plano com textura de folhas e
transparência), virados para fora como uma copa de verdade. O jogo desenha os cartões com
teste de transparência (folhas recortadas) e luz dos dois lados.

Objetos (mesmos nomes de vegetation.py, que este arquivo substitui no jogo):
  Arv_mangueira, Arv_amendoeira, Arv_coqueiro, Arv_calcada  (+ _lod1, versão leve de longe)
Papéis de material: bark (casca), cal (tronco caiado), leaf_card (folhas), leaf_card_red
(folhas avermelhadas da amendoeira), palm_card (folha de coqueiro), coco.
Colisores: Col_Arv_<espécie>_0 (tronco). Eixos (Blender): Z para cima, base em z = 0.
Exporta com UV (cartões 0..1; casca em metros: u em volta, v ao longo do galho).

  blender -b --python tools/blender/trees.py -- public/assets/world/trees.glb [preview.png]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/trees.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None
reset_scene()
OBJS = []
MATS = {}
COLORS = {
    'bark': (0.33, 0.24, 0.17), 'cal': (0.92, 0.92, 0.88), 'leaf_card': (0.25, 0.48, 0.16),
    'leaf_card_red': (0.6, 0.25, 0.1), 'bark_base': (0.7, 0.45, 0.2), 'palm_card': (0.35, 0.55, 0.2), 'coco': (0.35, 0.4, 0.12),
}


def material(role):
    if role not in MATS:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*COLORS[role], 1)
        MATS[role] = m
    return MATS[role]


class TreeBuilder:
    """Malha com UV por canto de face e papel de material por face."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []  # (índices, uvs, papel)

    def v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def face(self, idx, uvs, role):
        self.faces.append((tuple(idx), tuple(uvs), role))

    def branch(self, path, radius, role='bark', segs=8, role_low=None, low_h=0.0):
        """Tubo afunilado pelo caminho; UV da casca em metros."""
        rings = []
        length = 0.0
        prev = None
        n = len(path)
        for i, p in enumerate(path):
            p = Vector(p)
            if prev is not None:
                length += (p - prev).length
            prev = p
            a = Vector(path[max(0, i - 1)])
            b = Vector(path[min(n - 1, i + 1)])
            t = (b - a).normalized()
            u = t.cross(Vector((0, 0, 1)))
            if u.length < 1e-3:
                u = t.cross(Vector((1, 0, 0)))
            u.normalize()
            w = t.cross(u).normalized()
            r = radius(i / max(1, n - 1)) if callable(radius) else radius
            ring = []
            for k in range(segs + 1):
                ang = 2 * math.pi * k / segs
                # Casca irregular: sulcos e calombos.
                bump = 1 + 0.08 * math.sin(ang * 5 + i * 0.7) + 0.05 * noise.noise(p * 3 + Vector((math.cos(ang), math.sin(ang), 0)))
                ring.append(self.v(p + (u * math.cos(ang) + w * math.sin(ang)) * r * bump))
            rings.append((ring, length, r, p.z))
        for (ra, la, rra, za), (rb, lb, rrb, zb) in zip(rings, rings[1:]):
            circ = 2 * math.pi * max(rra, 0.05)
            for k in range(segs):
                role_here = role_low if role_low and (za + zb) / 2 < low_h else role
                uvs = [(k / segs * circ, la), ((k + 1) / segs * circ, la), ((k + 1) / segs * circ, lb), (k / segs * circ, lb)]
                self.face([ra[k], ra[k + 1], rb[k + 1], rb[k]], uvs, role_here)

    def card(self, c, normal, up, w, h, role, u0=0.0, u1=1.0):
        """Quadrado de w × h centrado em c, virado para `normal`."""
        n = Vector(normal).normalized()
        upv = Vector(up)
        side = upv.cross(n)
        if side.length < 1e-3:
            side = Vector((1, 0, 0)).cross(n)
        side.normalize()
        upv = n.cross(side).normalized()
        c = Vector(c)
        a = self.v(c - side * w / 2 - upv * h / 2)
        b = self.v(c + side * w / 2 - upv * h / 2)
        d = self.v(c + side * w / 2 + upv * h / 2)
        e = self.v(c - side * w / 2 + upv * h / 2)
        self.face([a, b, d, e], [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], role)

    def sphere(self, c, r, role, segs=6):
        rings = []
        for i in range(segs // 2 + 1):
            phi = math.pi * i / (segs // 2)
            ring = [self.v(Vector(c) + Vector((math.sin(phi) * math.cos(2 * math.pi * k / segs), math.sin(phi) * math.sin(2 * math.pi * k / segs), math.cos(phi))) * r) for k in range(segs + 1)]
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for k in range(segs):
                self.face([ra[k], rb[k], rb[k + 1], ra[k + 1]], [(0, 0), (0, 1), (1, 1), (1, 0)], role)

    def build(self):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], [f[0] for f in self.faces])
        roles = []
        for f in self.faces:
            if f[2] not in roles:
                roles.append(f[2])
        for r in roles:
            me.materials.append(material(r))
        uv = me.uv_layers.new(name='UVMap')
        for poly, (idx, uvs, role) in zip(me.polygons, self.faces):
            poly.material_index = roles.index(role)
            for li, uvp in zip(poly.loop_indices, uvs):
                uv.data[li].uv = uvp
        me.validate()
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(obj)
        # Casca lisa; cartões planos.
        for poly in me.polygons:
            poly.use_smooth = not roles[poly.material_index].endswith('card')
        OBJS.append(obj)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f'[{self.name}] {tris} triângulos')
        return obj


def cluster(tb, rnd, c, radius, cards, size, role, flat=1.0, outward_from=None, red=None):
    """Cacho de folhas: cartões cruzados espalhados numa esfera achatada."""
    c = Vector(c)
    for _ in range(cards):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 1) * flat))
        if d.length > 1:
            d.normalize()
        p = c + Vector((d.x * radius, d.y * radius, d.z * radius * flat))
        # Normal puxada para fora da copa (copa "cheia" vista de fora) e um pouco para cima.
        out = (p - (Vector(outward_from) if outward_from is not None else c))
        if out.length < 1e-3:
            out = Vector((0, 0, 1))
        out.normalize()
        n = (out + Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(-0.2, 0.8)))).normalized()
        s = size * rnd.uniform(0.8, 1.25)
        r = red if red and rnd.random() < 0.22 else role
        up = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 1))
        tb.card(p, n, up, s, s, r)
        # Cartão cruzado (volume de lado).
        tb.card(p, n.cross(up).normalized() if n.cross(up).length > 1e-3 else Vector((1, 0, 0)), up, s * 0.9, s * 0.9, r)


def curve(a, b, bend, steps=5):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2 + Vector(bend)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        pts.append(a * (1 - t) ** 2 + mid * 2 * (1 - t) * t + b * t * t)
    return pts


def roots(tb, rnd, r, n=5):
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        tb.branch([d * r * 0.4 + Vector((0, 0, 0.5)), d * r * 1.2 + Vector((0, 0, 0.12)), d * r * 2.2 + Vector((0, 0, -0.05))], lambda t: r * 0.45 * (1 - t * 0.8), segs=5)


def mangueira(lod, rnd):
    tb = TreeBuilder('Arv_mangueira' + ('_lod1' if lod else ''))
    segs = 5 if lod else 9
    top = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 2.3))
    tb.branch(curve((0, 0, 0), top, (0.15, 0, 0)), lambda t: 0.38 - 0.12 * t, segs=segs)
    if not lod:
        roots(tb, rnd, 0.38)
    tips = []
    for k in range(4):
        a = 2 * math.pi * k / 4 + rnd.uniform(-0.3, 0.3)
        end = top + Vector((math.cos(a) * 2.0, math.sin(a) * 2.0, rnd.uniform(1.8, 2.6)))
        tb.branch(curve(top, end, (0, 0, 0.6)), lambda t: 0.2 - 0.12 * t, segs=max(4, segs - 3))
        for j in range(2):
            b = 2 * math.pi * rnd.random()
            tip = end + Vector((math.cos(b) * 1.2, math.sin(b) * 1.2, rnd.uniform(0.6, 1.4)))
            if not lod:
                tb.branch(curve(end, tip, (0, 0, 0.3), 3), lambda t: 0.09 - 0.06 * t, segs=4)
            tips.append(tip)
    center = Vector((0, 0, 5.2))
    for t in tips:
        cluster(tb, rnd, t, 1.7, 5 if lod else 16, 2.2 if lod else 1.4, 'leaf_card', 0.75, center)
    cluster(tb, rnd, center + Vector((0, 0, 1.6)), 1.8, 3 if lod else 14, 2.2 if lod else 1.4, 'leaf_card', 0.6, center)
    tb.build()


def amendoeira(lod, rnd):
    tb = TreeBuilder('Arv_amendoeira' + ('_lod1' if lod else ''))
    segs = 5 if lod else 8
    tb.branch([(0, 0, 0), (0.05, 0, 3.0), (0, 0.05, 7.2)], lambda t: 0.3 - 0.2 * t, segs=segs)
    if not lod:
        roots(tb, rnd, 0.3, 4)
    # Andares de galhos horizontais (copa em "chapéu-de-sol").
    for tier, (z, length) in enumerate(((3.3, 3.4), (4.8, 2.7), (6.2, 1.9))):
        n = 5 if tier < 2 else 4
        for k in range(n):
            a = 2 * math.pi * k / n + tier * 0.6 + rnd.uniform(-0.2, 0.2)
            d = Vector((math.cos(a), math.sin(a), 0))
            base = Vector((0, 0, z))
            end = base + d * length + Vector((0, 0, 0.35))
            tb.branch(curve(base, end, (0, 0, 0.25), 3), lambda t: 0.1 - 0.07 * t, segs=4)
            for s in range(2 if lod else 3):
                p = base + d * length * (0.45 + 0.28 * s) + Vector((0, 0, 0.45))
                cluster(tb, rnd, p, 0.95, 2 if lod else 6, 1.9 if lod else 1.2, 'leaf_card', 0.35, Vector((0, 0, z - 1.5)), 'leaf_card_red')
    tb.build()


def calcada(lod, rnd):
    tb = TreeBuilder('Arv_calcada' + ('_lod1' if lod else ''))
    segs = 5 if lod else 8
    tb.branch([(0, 0, 0), (0.05, 0.02, 1.0), (0, 0, 2.3)], lambda t: 0.2 - 0.06 * t, segs=segs, role_low='cal', low_h=1.0)
    tips = []
    for k in range(3):
        a = 2 * math.pi * k / 3 + rnd.uniform(-0.3, 0.3)
        tip = Vector((math.cos(a) * 1.0, math.sin(a) * 1.0, rnd.uniform(3.3, 4.1)))
        tb.branch(curve((0, 0, 2.2), tip, (0, 0, 0.3), 3), lambda t: 0.1 - 0.06 * t, segs=4)
        tips.append(tip)
    center = Vector((0, 0, 4.0))
    for t in tips:
        cluster(tb, rnd, t, 1.2, 4 if lod else 12, 1.7 if lod else 1.1, 'leaf_card', 0.8, center)
    cluster(tb, rnd, center + Vector((0, 0, 0.9)), 1.2, 3 if lod else 10, 1.7 if lod else 1.1, 'leaf_card', 0.7, center)
    tb.build()


def coqueiro(lod, rnd):
    tb = TreeBuilder('Arv_coqueiro' + ('_lod1' if lod else ''))
    segs = 5 if lod else 8
    top = Vector((0.9, 0.2, 8.6))
    trunk = curve((0, 0, 0), top, (0.9, 0.1, 0), 8)
    tb.branch(trunk, lambda t: 0.24 - 0.08 * t, segs=segs)
    # Folhas (palmas) caídas em arco: cada palma é uma fita de cartões ao longo da nervura.
    fronds = 9 if lod else 15
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + rnd.uniform(-0.15, 0.15)
        d = Vector((math.cos(a), math.sin(a), 0))
        lift = rnd.uniform(0.2, 1.0)
        pts = []
        L = rnd.uniform(3.6, 4.4)
        steps = 3 if lod else 6
        for i in range(steps + 1):
            t = i / steps
            pts.append(top + d * L * t + Vector((0, 0, lift * math.sin(t * math.pi * 0.9) * 1.4 - t * t * 2.2)))
        for i in range(steps):
            p0, p1 = pts[i], pts[i + 1]
            mid = (p0 + p1) / 2
            along = (p1 - p0)
            seg_len = along.length
            along.normalize()
            side = along.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            # Palma meio dobrada em "V": dois cartões inclinados ao longo da nervura.
            width = 1.3 * (1 - abs((i + 0.5) / steps - 0.4) * 0.8)
            for s in (-1, 1):
                n = (Vector((0, 0, 1)) + side * s * 0.9).normalized()
                c = mid + side * s * width * 0.25 + Vector((0, 0, -0.05))
                tb.card(c, n, along, width * 0.55, seg_len * 1.05, 'palm_card', i / steps, (i + 1) / steps)
    if not lod:
        for k in range(5):
            a = 2 * math.pi * k / 5
            tb.sphere(top + Vector((math.cos(a) * 0.28, math.sin(a) * 0.28, -0.35)), 0.15, 'coco')
    tb.build()


def copa(name, lod, rnd, h_trunk, crown_r, crown_h):
    """Árvore de copa redonda e alta: tronco reto escuro (base clara), galhos para fora e copa
    oval cheia de cachos (estilo das árvores de campo do Fortnite)."""
    tb = TreeBuilder(name + ('_lod1' if lod else ''))
    segs = 5 if lod else 8
    top = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), h_trunk + crown_h * 0.6))
    tb.branch([(0, 0, 0), (0.03, 0, h_trunk * 0.5), top], lambda t: 0.26 - 0.17 * t, segs=segs, role_low='bark_base', low_h=0.7)
    center = Vector((0, 0, h_trunk + crown_h * 0.5))
    tips = []
    for k in range(6 if not lod else 4):
        a = 2 * math.pi * k / (6 if not lod else 4) + rnd.uniform(-0.3, 0.3)
        z0 = h_trunk + rnd.uniform(0, crown_h * 0.45)
        base = Vector((0, 0, z0))
        tip = Vector((math.cos(a) * crown_r * 0.75, math.sin(a) * crown_r * 0.75, z0 + rnd.uniform(0.4, 1.4)))
        tb.branch(curve(base, tip, (0, 0, 0.4), 3), lambda t: 0.1 - 0.07 * t, segs=4)
        tips.append(tip)
    for t in tips:
        cluster(tb, rnd, t, crown_r * 0.55, 4 if lod else 13, 2.0 if lod else 1.25, 'leaf_card', 1.0, center)
    for _ in range(2 if lod else 5):
        p = center + Vector((rnd.uniform(-0.5, 0.5) * crown_r, rnd.uniform(-0.5, 0.5) * crown_r, rnd.uniform(0.0, 0.5) * crown_h))
        cluster(tb, rnd, p, crown_r * 0.5, 3 if lod else 10, 2.0 if lod else 1.25, 'leaf_card', 1.0, center)
    tb.build()


def arbusto(name, rnd, r, h):
    """Arbusto baixo e cheio: galhinhos saindo do chão e cachos de folhas até o chão."""
    tb = TreeBuilder(name)
    for k in range(5):
        a = 2 * math.pi * k / 5 + rnd.uniform(-0.4, 0.4)
        tip = Vector((math.cos(a) * r * 0.6, math.sin(a) * r * 0.6, h * rnd.uniform(0.5, 0.8)))
        tb.branch(curve((0, 0, 0), tip, (0, 0, 0.2), 3), lambda t: 0.05 - 0.03 * t, segs=4)
    for _ in range(7):
        p = Vector((rnd.uniform(-0.6, 0.6) * r, rnd.uniform(-0.6, 0.6) * r, rnd.uniform(0.35, 0.75) * h))
        cluster(tb, rnd, p, r * 0.6, 7, 1.0, 'leaf_card', 0.8, Vector((0, 0, 0)))
    tb.build()


def collider(name, c, s):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = s
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    OBJS.append(o)


for lod in (False, True):
    mangueira(lod, random.Random(11))
    amendoeira(lod, random.Random(22))
    coqueiro(lod, random.Random(33))
    calcada(lod, random.Random(44))
    copa('Arv_copa', lod, random.Random(55), 3.6, 2.9, 4.2)
    copa('Arv_copa2', lod, random.Random(66), 2.8, 2.4, 3.4)
arbusto('Arbusto_a', random.Random(77), 1.3, 1.4)
arbusto('Arbusto_b', random.Random(88), 0.95, 1.0)
collider('Col_Arv_mangueira_0', (0, 0, 1.2), (0.7, 0.7, 2.4))
collider('Col_Arv_amendoeira_0', (0, 0, 1.5), (0.55, 0.55, 3.0))
collider('Col_Arv_coqueiro_0', (0.15, 0, 1.6), (0.5, 0.5, 3.2))
collider('Col_Arv_calcada_0', (0, 0, 1.2), (0.42, 0.42, 2.4))
collider('Col_Arv_copa_0', (0, 0, 1.5), (0.5, 0.5, 3.0))
collider('Col_Arv_copa2_0', (0, 0, 1.3), (0.45, 0.45, 2.6))

for o in bpy.context.view_layer.objects:
    o.select_set(o in OBJS)
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT', export_animations=False, export_morph=False, export_skins=False)
print(f'[arvores] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for o in OBJS:
        if o.name.startswith('Col_') or o.name.endswith('_lod1'):
            o.hide_render = True
    pos = {'Arv_mangueira': (-14, 0), 'Arv_amendoeira': (-7, 0), 'Arv_coqueiro': (-1, 0), 'Arv_calcada': (4, 0), 'Arv_copa': (9, 0), 'Arv_copa2': (14, 0), 'Arbusto_a': (6.5, -4), 'Arbusto_b': (11, -4)}
    for o in OBJS:
        if o.name in pos:
            o.location = (*pos[o.name], 0)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 700
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.7, 0.85, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.mesh.primitive_plane_add(size=60)
    bpy.ops.object.camera_add(location=(0, -30, 7))
    cam = bpy.context.active_object
    cam.data.lens = 30
    d = Vector((1, 0, 4)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
