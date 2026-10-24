"""Vegetação e caçamba de entulho do mapa (árvores brasileiras, bananeira, mato, trepadeira).

Modelos (cada um é UM objeto com materiais nomeados pelo papel; o jogo troca cada papel por
um StandardMaterial da biblioteca do mapa):
  Arv_mangueira   copa densa e escura em cúpula, tronco curto que abre em três galhos
  Arv_amendoeira  "chapéu-de-sol": galhos em andares horizontais, folhas verdes e avermelhadas
  Arv_coqueiro    tronco curvo com anéis, folhas compridas caídas e cocos
  Arv_calcada     árvore de calçada (tipo oiti/fícus) de copa compacta e tronco caiado
  Bananeira       touceira de três pés com folhas largas rasgadas
  Mato, Capim     tufos de folhas finas (o jogo espalha por thin instances)
  Trepadeira      placa de folhas para cobrir muros
  Cacamba         caçamba estacionária amarela de obra: chapa com nervuras, alças de içamento,
                  faixas refletivas, ferrugem e entulho dentro (sem nome de empresa)
As árvores têm uma versão leve <nome>_lod1 (usada de longe). Colisores: Col_<nome>_<n>.

Eixos (Blender): Z para cima, frente em -Y, base em z = 0.

Uso:
  blender -b --python tools/blender/vegetation.py -- public/assets/world/vegetation.glb [preview.png]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/vegetation.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None

ROLES = {
    'bark': (0.32, 0.22, 0.15), 'cal': (0.92, 0.92, 0.88), 'leaf': (0.25, 0.5, 0.18), 'leaf_dark': (0.13, 0.32, 0.1),
    'leaf_red': (0.62, 0.22, 0.1), 'palm': (0.35, 0.55, 0.2), 'coco': (0.35, 0.4, 0.12), 'grass': (0.4, 0.55, 0.2),
    'yellow': (0.95, 0.72, 0.05), 'yellow_in': (0.6, 0.45, 0.05), 'rust': (0.45, 0.22, 0.1), 'metal': (0.2, 0.2, 0.22),
    'debris_brick': (0.7, 0.35, 0.2), 'debris_conc': (0.6, 0.6, 0.58), 'wood': (0.5, 0.35, 0.2),
    'refl_r': (0.8, 0.05, 0.05), 'refl_w': (0.95, 0.95, 0.95),
}
MATS = {}


def material(role):
    if role not in MATS:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*ROLES[role], 1)
        bsdf.inputs['Roughness'].default_value = 0.8
        MATS[role] = m
    return MATS[role]


_ICO = {}


def unit_ico(sub):
    if sub not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        bm.verts.ensure_lookup_table()
        _ICO[sub] = ([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces])
        bm.free()
    return _ICO[sub]


class Builder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.roles = [], [], []

    def v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def f(self, idx, role):
        self.faces.append(tuple(idx))
        self.roles.append(role)

    def tube(self, path, radius, role, segs=7, cap=True, wobble=0.0):
        """Tubo cônico por um caminho; radius(t) dá o raio ao longo dele."""
        rings = []
        n = len(path)
        for i, p in enumerate(path):
            p = Vector(p)
            a = Vector(path[max(0, i - 1)])
            b = Vector(path[min(n - 1, i + 1)])
            t = (b - a).normalized()
            u = t.cross(Vector((0, 0, 1)))
            if u.length < 1e-3:
                u = t.cross(Vector((1, 0, 0)))
            u.normalize()
            w = t.cross(u).normalized()
            r = radius(i / (n - 1))
            ring = []
            for k in range(segs):
                ang = 2 * math.pi * k / segs
                rr = r * (1 + wobble * noise.noise(p * 3 + Vector((k, 0, 0))))
                ring.append(self.v(p + (u * math.cos(ang) + w * math.sin(ang)) * rr))
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for k in range(segs):
                j = (k + 1) % segs
                self.f([ra[k], ra[j], rb[j], rb[k]], role)
        if cap:
            self.f(list(reversed(rings[0])), role)
            self.f(rings[-1], role)

    def blob(self, c, r, role, sub=1, amp=0.22, seed=0.0):
        """Tufo de folhas: icosfera deformada por ruído (copas)."""
        verts, faces = unit_ico(sub)
        c = Vector(c)
        base = len(self.verts)
        off = Vector((seed * 7.1, seed * 3.3, seed * 5.7))
        for p in verts:
            d = 1 + amp * noise.noise(p * 1.8 + off)
            self.verts.append(c + Vector((p.x * r[0], p.y * r[1], p.z * r[2])) * d)
        for f in faces:
            self.f([base + i for i in f], role)

    def box(self, c, s, role, rz=0.0, rx=0.0):
        cx, cy, cz = c
        pts = []
        for z in (-1, 1):
            for y in (-1, 1):
                for x in (-1, 1):
                    p = Vector((x * s[0] / 2, y * s[1] / 2, z * s[2] / 2))
                    p.rotate(_euler(rx, 0, rz))
                    pts.append(self.v(Vector((cx, cy, cz)) + p))
        for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.f([pts[i] for i in q], role)

    def build(self, collection, recalc=True):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        used = sorted(set(self.roles), key=list(ROLES).index)
        for r in used:
            me.materials.append(material(r))
        for poly, r in zip(me.polygons, self.roles):
            poly.material_index = used.index(r)
        me.validate()
        obj = bpy.data.objects.new(self.name, me)
        collection.append(obj)
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        if recalc:
            # Troncos, copas e chapas são fechados: normais para fora. Folhas soltas usam
            # material de dois lados no jogo, então a orientação delas não importa.
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.shade_smooth()
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f'[vegetacao] {self.name}: {tris} triângulos')
        return obj


def _euler(x, y, z):
    from mathutils import Euler
    return Euler((x, y, z))


OBJECTS = []


def collider(name, c, s):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = s
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    OBJECTS.append(o)


def canopy(bd, center, radius, height, n, roles, rnd, sub=1, flat=1.0):
    """Copa em cúpula: um tufo central e n em volta, mais altos no meio."""
    cx, cy, cz = center
    bd.blob((cx, cy, cz + height * 0.15), (radius * 0.75, radius * 0.75, height * 0.55 * flat), roles[0], sub, seed=rnd.random())
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.3, 0.3)
        d = radius * rnd.uniform(0.45, 0.65)
        r = radius * rnd.uniform(0.42, 0.55)
        z = cz + rnd.uniform(-0.25, 0.2) * height
        bd.blob((cx + math.cos(a) * d, cy + math.sin(a) * d, z), (r, r, r * 0.8 * flat), rnd.choice(roles), sub, seed=rnd.random())


# ------------------------------------------------------------------ árvores

def mangueira(lod, rnd):
    bd = Builder('Arv_mangueira' + ('_lod1' if lod else ''))
    segs = 4 if lod else 7
    bd.tube([(0, 0, 0), (0.05, 0, 0.9), (0.1, 0.02, 1.8)], lambda t: 0.3 - 0.08 * t, 'bark', segs, wobble=0.12)
    if lod:
        bd.blob((0, 0, 4.6), (3.8, 3.6, 2.5), 'leaf_dark', 1, amp=0.18, seed=1)
        return bd
    for end in ((1.7, 0.5, 3.7), (-1.4, 0.9, 3.9), (0.2, -1.5, 4.1), (0.1, 0.2, 4.3)):
        bd.tube([(0.1, 0.02, 1.7), ((0.1 + end[0]) / 2, (0.02 + end[1]) / 2, 2.9), end], lambda t: 0.17 - 0.1 * t, 'bark', 6)
    canopy(bd, (0, 0, 4.5), 3.9, 3.0, 9, ['leaf_dark', 'leaf_dark', 'leaf'], rnd, sub=2)
    bd.blob((0, 0, 6.2), (2.0, 2.0, 1.2), 'leaf_dark', 2, seed=2)
    return bd


def amendoeira(lod, rnd):
    bd = Builder('Arv_amendoeira' + ('_lod1' if lod else ''))
    segs = 4 if lod else 7
    bd.tube([(0, 0, 0), (0, 0, 3.5), (0.05, 0, 7.4)], lambda t: 0.24 - 0.15 * t, 'bark', segs, wobble=0.08)
    tiers = [(3.0, 3.8), (4.6, 3.0), (6.0, 2.1), (7.2, 1.1)]
    for ti, (z, r) in enumerate(tiers):
        if lod:
            bd.blob((0, 0, z + 0.25), (r, r, 0.55), 'leaf' if ti % 2 == 0 else 'leaf_red', 1, amp=0.25, seed=ti)
            continue
        # Galhos horizontais saindo em estrela (o "andar" típico da amendoeira).
        for k in range(5):
            a = 2 * math.pi * k / 5 + ti * 0.6
            bd.tube([(0, 0, z - 0.3), (math.cos(a) * r * 0.5, math.sin(a) * r * 0.5, z - 0.05), (math.cos(a) * r * 0.85, math.sin(a) * r * 0.85, z + 0.1)],
                    lambda t: 0.08 - 0.05 * t, 'bark', 5)
        n = max(3, int(r * 1.8))
        for k in range(n):
            a = 2 * math.pi * k / n + rnd.uniform(-0.2, 0.2)
            d = r * rnd.uniform(0.45, 0.7)
            rr = r * rnd.uniform(0.33, 0.45)
            role = 'leaf_red' if rnd.random() < 0.25 else 'leaf'
            bd.blob((math.cos(a) * d, math.sin(a) * d, z + 0.25), (rr, rr, 0.42), role, 2, amp=0.3, seed=rnd.random())
        bd.blob((0, 0, z + 0.3), (r * 0.45, r * 0.45, 0.45), 'leaf', 2, seed=rnd.random())
    return bd


def coqueiro(lod, rnd):
    bd = Builder('Arv_coqueiro' + ('_lod1' if lod else ''))
    pts = [(0, 0, 0), (0.25, 0, 2.5), (0.75, 0.05, 5.0), (1.45, 0.1, 7.4), (1.9, 0.1, 8.6)]
    path = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        steps = 2 if lod else 5
        for s in range(steps):
            path.append(a.lerp(b, s / steps))
    path.append(Vector(pts[-1]))
    # Anéis do tronco: o raio pulsa a cada segmento.
    bd.tube(path, lambda t: (0.21 - 0.06 * t) * (1 if lod else 1 + 0.06 * math.cos(t * 60)), 'bark', 5 if lod else 8)
    top = Vector(pts[-1])
    fronds = 6 if lod else 11
    segs = 5 if lod else 12
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + rnd.uniform(-0.15, 0.15)
        d = Vector((math.cos(a), math.sin(a), 0))
        length = rnd.uniform(3.0, 3.6)
        lift = rnd.uniform(0.5, 1.1)
        side = d.cross(Vector((0, 0, 1))).normalized()
        prev = None
        for i in range(segs + 1):
            t = i / segs
            p = top + d * length * t + Vector((0, 0, length * (lift * t - 1.25 * t * t)))
            if prev is not None:
                w = 0.85 * math.sin(math.pi * min(1.0, t * 1.15)) + 0.08
                for s in (-1, 1):
                    tip = (prev + p) / 2 + side * s * w + Vector((0, 0, -0.35 * w)) + d * 0.18
                    ia, ib, ic = bd.v(prev), bd.v(p), bd.v(tip)
                    bd.f([ia, ib, ic] if s > 0 else [ib, ia, ic], 'palm')
            prev = p
    if not lod:
        for k in range(4):
            a = 2 * math.pi * k / 4 + 0.4
            bd.blob(top + Vector((math.cos(a) * 0.22, math.sin(a) * 0.22, -0.25)), (0.14, 0.14, 0.16), 'coco', 1, amp=0.05)
    return bd


def calcada(lod, rnd):
    bd = Builder('Arv_calcada' + ('_lod1' if lod else ''))
    segs = 4 if lod else 7
    # Tronco caiado até 1 m (cal branca, como nas calçadas brasileiras).
    bd.tube([(0, 0, 0), (0, 0, 1.0)], lambda t: 0.17, 'cal', segs)
    bd.tube([(0, 0, 0.98), (0.02, 0, 2.0), (0.05, 0.02, 2.8)], lambda t: 0.15 - 0.05 * t, 'bark', segs, wobble=0.1)
    if lod:
        bd.blob((0, 0, 3.8), (2.0, 2.0, 1.6), 'leaf', 1, amp=0.15, seed=3)
        return bd
    for end in ((0.9, 0.3, 3.4), (-0.7, 0.6, 3.5), (0.1, -0.9, 3.6)):
        bd.tube([(0.03, 0, 2.4), end], lambda t: 0.09 - 0.05 * t, 'bark', 5)
    canopy(bd, (0, 0, 3.8), 2.1, 2.2, 7, ['leaf', 'leaf', 'leaf_dark'], rnd, sub=2)
    return bd


# ------------------------------------------------------------------ plantas

def bananeira(rnd):
    bd = Builder('Bananeira')
    for (ox, oy, h) in ((0, 0, 2.3), (0.55, 0.3, 1.8), (-0.45, 0.35, 1.5)):
        bd.tube([(ox, oy, 0), (ox, oy, h)], lambda t: 0.13 - 0.04 * t, 'palm', 7)
        for k in range(rnd.randint(5, 7)):
            a = 2 * math.pi * k / 6 + rnd.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), math.sin(a), 0))
            side = d.cross(Vector((0, 0, 1))).normalized()
            base = Vector((ox, oy, h - 0.1))
            length = rnd.uniform(1.4, 2.0)
            prev_mid = prev_l = prev_r = None
            n = 7
            for i in range(n + 1):
                t = i / n
                mid = base + d * length * t + Vector((0, 0, length * (0.9 * t - 1.1 * t * t)))
                w = 0.3 * math.sin(math.pi * min(1.0, t * 1.05 + 0.05))
                l = mid + side * w + Vector((0, 0, -0.05))
                r = mid - side * w + Vector((0, 0, -0.05))
                if prev_mid is not None and not (0.3 < t < 0.9 and rnd.random() < 0.2):  # folha rasgada
                    a1, b1, c1, d1 = bd.v(prev_mid), bd.v(mid), bd.v(l), bd.v(prev_l)
                    bd.f([a1, b1, c1, d1], 'palm')
                    a2, b2, c2, d2 = bd.v(prev_mid), bd.v(prev_r), bd.v(r), bd.v(mid)
                    bd.f([a2, b2, c2, d2], 'palm')
                prev_mid, prev_l, prev_r = mid, l, r
    return bd


def tufo(name, rnd, blades, hmin, hmax, stalks=0):
    bd = Builder(name)
    for _ in range(blades):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0, 0.22)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        h = rnd.uniform(hmin, hmax)
        lean = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.1, 0.35) * h
        side = Vector((-math.sin(a + 0.7), math.cos(a + 0.7), 0)) * 0.035
        mid = base + lean * 0.4 + Vector((0, 0, h * 0.55))
        tip = base + lean + Vector((0, 0, h))
        i0, i1, i2, i3, i4 = bd.v(base - side), bd.v(base + side), bd.v(mid + side * 0.7), bd.v(mid - side * 0.7), bd.v(tip)
        bd.f([i0, i1, i2, i3], 'grass')
        bd.f([i3, i2, i4], 'grass')
    for _ in range(stalks):
        a = rnd.uniform(0, 2 * math.pi)
        h = rnd.uniform(hmax, hmax * 1.4)
        top = Vector((math.cos(a) * 0.15, math.sin(a) * 0.15, h))
        side = Vector((0.012, 0, 0))
        i0, i1, i2 = bd.v(-side), bd.v(side), bd.v(top)
        bd.f([i0, i1, i2], 'grass')
        # Espiga: um losango achatado (2 triângulos) em vez de volume.
        w = Vector((0.035, 0, 0))
        j0, j1, j2, j3 = bd.v(top + Vector((0, 0, -0.14))), bd.v(top + w), bd.v(top + Vector((0, 0, 0.06))), bd.v(top - w)
        bd.f([j0, j1, j2, j3], 'grass')
    return bd


def trepadeira(rnd):
    """Placa de folhas 2,2 x 2,6 m no plano XZ, de frente para -Y (encosta na parede em y = 0)."""
    bd = Builder('Trepadeira')
    w, h = 2.2, 2.6
    for _ in range(330):
        x = rnd.uniform(-w / 2, w / 2)
        # Borda de cima irregular: mais folhas embaixo, menos no alto.
        top = h * (0.65 + 0.35 * (0.5 + 0.5 * math.sin(x * 2.3 + 1.0)))
        z = top * (1 - rnd.random() ** 1.6)
        s = rnd.uniform(0.1, 0.19)
        y = -rnd.uniform(0.01, 0.07)
        a = rnd.uniform(0, math.pi)
        dx, dz = math.cos(a) * s, math.sin(a) * s
        tilt = -rnd.uniform(0.02, 0.06)
        q = [bd.v((x - dx, y, z - dz)), bd.v((x + dz, y + tilt, z - dx)), bd.v((x + dx, y, z + dz)), bd.v((x - dz, y + tilt, z + dx))]
        # Folha de um lado só: a face tem de olhar para fora da parede (-Y).
        n = (bd.verts[q[1]] - bd.verts[q[0]]).cross(bd.verts[q[2]] - bd.verts[q[0]])
        if n.y > 0:
            q.reverse()
        bd.f(q, 'leaf_dark' if rnd.random() < 0.7 else 'leaf')
    return bd


# ------------------------------------------------------------------ caçamba

def cacamba(rnd):
    bd = Builder('Cacamba')
    L_top, L_bot, W, Z0, H, T = 1.65, 1.22, 0.83, 0.17, 1.2, 0.05

    def shell(lt, lb, w, z0, h, role, inward):
        p = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                p[(sx, sy, 0)] = bd.v((sx * lb, sy * w, z0))
                p[(sx, sy, 1)] = bd.v((sx * lt, sy * w, h))
        faces = [
            [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)],          # fundo
            [(-1, -1, 0), (-1, -1, 1), (1, -1, 1), (1, -1, 0)],        # lado -Y
            [(1, 1, 0), (1, 1, 1), (-1, 1, 1), (-1, 1, 0)],            # lado +Y
            [(1, -1, 0), (1, -1, 1), (1, 1, 1), (1, 1, 0)],            # ponta +X
            [(-1, 1, 0), (-1, 1, 1), (-1, -1, 1), (-1, -1, 0)],        # ponta -X
        ]
        for fc in faces:
            bd.f([p[k] for k in fc], role)
        return p

    outer = shell(L_top, L_bot, W, Z0, H, 'yellow', False)
    inner = shell(L_top - T, L_bot - T, W - T, Z0 + T, H, 'yellow_in', True)
    # Borda de cima (une a chapa de fora com a de dentro).
    ring = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i in range(4):
        a, b = ring[i], ring[(i + 1) % 4]
        bd.f([outer[(*a, 1)], inner[(*a, 1)], inner[(*b, 1)], outer[(*b, 1)]], 'yellow')
    # Nervuras verticais e reforço de cima nos lados.
    for sy in (-1, 1):
        for x in (-0.9, -0.3, 0.3, 0.9):
            bd.box((x, sy * (W + 0.03), (Z0 + H) / 2), (0.09, 0.06, H - Z0), 'yellow')
        bd.box((0, sy * (W + 0.04), H - 0.05), (L_top * 2 + 0.05, 0.08, 0.1), 'yellow')
        bd.box((0, sy * (W + 0.035), Z0 + 0.06), (L_bot * 2, 0.07, 0.12), 'yellow')
        # Faixas refletivas (vermelho e branco) perto das pontas.
        for sx in (-1, 1):
            for k in range(4):
                bd.box((sx * (1.3 - 0.11 * k), sy * (W + 0.065), 0.75), (0.1, 0.01, 0.22), 'refl_r' if k % 2 == 0 else 'refl_w')
        # Alças de içamento nas quatro quinas.
        for sx in (-1, 1):
            c = Vector((sx * (L_top - 0.18), sy * (W + 0.12), H - 0.2))
            loop = [c + Vector((0.11 * math.cos(2 * math.pi * k / 10), 0, 0.11 * math.sin(2 * math.pi * k / 10))) for k in range(11)]
            bd.tube(loop, lambda t: 0.025, 'metal', 5, cap=False)
    # Patins (perfis) embaixo.
    for sy in (-0.55, 0.55):
        bd.box((0, sy, Z0 / 2), (L_bot * 2 + 0.5, 0.16, Z0), 'metal')
    # Ferrugem: manchas irregulares coladas na chapa dos lados e na base.
    for _ in range(14):
        sy = rnd.choice((-1, 1))
        cx = rnd.uniform(-1.2, 1.2)
        cz = rnd.uniform(Z0 + 0.12, H - 0.15) if rnd.random() < 0.6 else Z0 + rnd.uniform(0.05, 0.2)
        r = rnd.uniform(0.06, 0.2)
        pts = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            rr = r * rnd.uniform(0.6, 1.3)
            pts.append(bd.v((cx + math.cos(a) * rr * 1.3, sy * (W + 0.007), cz + math.sin(a) * rr)))
        bd.f(pts if sy < 0 else list(reversed(pts)), 'rust')
    # Entulho: tijolo, pedaço de concreto e tábuas, mais alto no meio.
    for _ in range(26):
        x = rnd.uniform(-1.25, 1.25)
        y = rnd.uniform(-0.65, 0.65)
        hump = 0.55 + 0.35 * (1 - abs(x) / 1.4) * (1 - abs(y) / 0.8)
        z = Z0 + 0.1 + rnd.uniform(0.1, hump)
        kind = rnd.random()
        if kind < 0.4:
            bd.box((x, y, z), (0.24, 0.12, 0.09), 'debris_brick', rz=rnd.uniform(0, 3), rx=rnd.uniform(-0.4, 0.4))
        elif kind < 0.75:
            s = rnd.uniform(0.2, 0.45)
            bd.box((x, y, z), (s, s * 0.8, s * 0.5), 'debris_conc', rz=rnd.uniform(0, 3), rx=rnd.uniform(-0.5, 0.5))
        else:
            bd.box((x, y, z + 0.1), (rnd.uniform(0.8, 1.5), 0.12, 0.025), 'wood', rz=rnd.uniform(0, 3), rx=rnd.uniform(-0.5, 0.5))
    # Volume de entulho que enche o fundo.
    bd.blob((0, 0, Z0 + 0.35), (1.25, 0.72, 0.35), 'debris_conc', 1, amp=0.25, seed=5)
    return bd


# ------------------------------------------------------------------ main

reset_scene()
objs = []
rnd = random.Random(20261018)
for fn in (mangueira, amendoeira, coqueiro, calcada):
    for lod in (0, 1):
        # Mesma semente nos dois níveis: o LOD acompanha a silhueta da árvore cheia.
        fn(lod, random.Random(len(fn.__name__) * 97)).build(objs)
bananeira(rnd).build(objs)
tufo('Mato', rnd, 16, 0.3, 0.6).build(objs)
tufo('Capim', rnd, 22, 0.5, 0.85, stalks=4).build(objs)
trepadeira(rnd).build(objs, recalc=False)
cacamba(rnd).build(objs)

collider('Col_Arv_mangueira_0', (0, 0, 1.2), (0.7, 0.7, 2.4))
collider('Col_Arv_amendoeira_0', (0, 0, 1.5), (0.55, 0.55, 3.0))
collider('Col_Arv_coqueiro_0', (0.15, 0, 1.6), (0.5, 0.5, 3.2))
collider('Col_Arv_calcada_0', (0, 0, 1.2), (0.42, 0.42, 2.4))
collider('Col_Bananeira_0', (0.05, 0.2, 0.9), (0.9, 0.8, 1.8))
collider('Col_Cacamba_0', (0, 0, 0.6), (3.3, 1.75, 1.2))

for o in bpy.context.view_layer.objects:
    o.select_set(o in objs or o in OBJECTS)
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=False,
                          export_normals=True, export_materials='EXPORT', export_animations=False, export_morph=False, export_skins=False)
print(f'[vegetacao] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for c in OBJECTS:
        c.hide_render = True
    layout = ['Arv_mangueira', 'Arv_amendoeira', 'Arv_coqueiro', 'Arv_calcada', 'Bananeira', 'Cacamba', 'Mato', 'Capim', 'Trepadeira',
              'Arv_mangueira_lod1', 'Arv_amendoeira_lod1', 'Arv_coqueiro_lod1', 'Arv_calcada_lod1']
    pos = {'Arv_mangueira': (-14, 0), 'Arv_amendoeira': (-5, 0), 'Arv_coqueiro': (3, 0), 'Arv_calcada': (10, 0), 'Bananeira': (15, -2),
           'Cacamba': (5, -7), 'Mato': (0, -8), 'Capim': (1, -8.5), 'Trepadeira': (-4, -8),
           'Arv_mangueira_lod1': (-14, 12), 'Arv_amendoeira_lod1': (-5, 12), 'Arv_coqueiro_lod1': (3, 12), 'Arv_calcada_lod1': (10, 12)}
    for o in objs:
        o.location = (*pos.get(o.name, (0, 20)), 0)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.75, 0.9, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.mesh.primitive_plane_add(size=80)
    bpy.ops.object.camera_add(location=(0, -32, 12))
    cam = bpy.context.active_object
    cam.data.lens = 32
    d = Vector((0, 2, 3)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
    print(f'[vegetacao] prévia {preview_png}')
