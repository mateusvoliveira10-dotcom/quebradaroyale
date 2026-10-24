"""Correntes de MC do personagem-base: elos 3D, pingentes, encaixe no pescoço e export.

blender -b --python tools/blender/chains.py -- <personagem-base.blend> <jersey_base.glb> <pasta de saída> [--sem-miniaturas]

Saída (em public/assets/customization/chains/):
  chains_base.glb   malhas com skinning no esqueleto do personagem, por corrente:
                    <Corrente>_Ouro e, quando há pedras, <Corrente>_Pedras
  <id>/thumb.webp   miniatura no peito do manequim (com camisa escura)

Como funciona:
  1. Trajeto: uma volta em torno da base do pescoço que desce pelo peito até a altura de
     cada modelo. Cada ponto é assentado na pele (a uma folga fixa) e depois empurrado para
     fora de TODAS as camisas (manga curta, manga longa e regata, lidas do jersey_base.glb),
     então a corrente passa por cima de qualquer camisa sem atravessá-la. O trajeto é
     suavizado e reamostrado por comprimento.
  2. Elos: um elo 3D por passo do trajeto (grumet/cubana deitada no peito e torcida de leve,
     bismarck de elos duplos, laço de fita torcida). Cada elo é rígido e herda os pesos de
     skinning do ponto do corpo onde está (tronco/pescoço), então acompanha as animações
     sem esticar.
  3. Pingente rígido no ponto mais baixo, deitado no peito: medalha "FOCO FÉ FORÇA",
     placa "7" com coroa cravejada, cifrão cravejado, ou nenhum.
Coordenadas do Blender: z para cima, frente em −Y, esquerda do personagem em +X.
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src_blend, jersey_glb, out_dir = (os.path.abspath(a) for a in args[:3])
make_thumbs = '--sem-miniaturas' not in args
t_start = time.time()
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=src_blend)
body = bpy.data.objects['Corpo']
rig = bpy.data.objects['Esqueleto']
rig.data.pose_position = 'REST'


def bvh_of(obj):
    mw = obj.matrix_world
    verts = [mw @ v.co for v in obj.data.vertices]
    polys = [list(p.vertices) for p in obj.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


BODY_BVH = bvh_of(body)

# Camisas (para a corrente passar por cima): importa o GLB e pega as malhas.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=jersey_glb)
shirts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH' and o.name.startswith(('Camisa', 'Regata'))]
SHIRT_BVHS = [bvh_of(o) for o in shirts]
print(f'[correntes] camisas consideradas: {", ".join(o.name for o in shirts)}')
for o in [o for o in bpy.data.objects if o not in before]:
    bpy.data.objects.remove(o, do_unlink=True)

# Grupos de pesos do corpo que a corrente pode herdar (tronco e pescoço).
ALLOWED = {'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'}
vg_names = {g.index: g.name for g in body.vertex_groups}


def weights_at(p):
    """Pesos de skinning do corpo no ponto da pele mais próximo de p (só tronco/pescoço)."""
    loc, nrm, fi, _ = BODY_BVH.find_nearest(p)
    poly = body.data.polygons[fi]
    acc = {}
    for vi in poly.vertices:
        for g in body.data.vertices[vi].groups:
            name = vg_names[g.group]
            if name in ALLOWED and g.weight > 0:
                acc[name] = acc.get(name, 0) + g.weight
    tot = sum(acc.values())
    if tot <= 0:
        return {'Spine2': 1.0}
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
    tot = sum(w for _, w in top)
    return {k: w / tot for k, w in top}


# ------------------------------------------------------------------ trajeto
NECK_Y = -0.014


def initial_loop(n, drop_z, width=0.083):
    """Volta inicial: atrás do pescoço (a=0) até a frente (a=π), descendo até drop_z."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x = width * math.sin(a)
        y = NECK_Y + 0.082 * math.cos(a) - 0.035 * (1 - math.cos(a)) / 2
        front = ((1 - math.cos(a)) / 2) ** 2.2
        z = 1.452 - 0.03 * math.sin(a) ** 2 - (1.452 - drop_z) * front
        pts.append(Vector((x, y, z)))
    return pts


def settle(pts, half, iters=10):
    """Assenta a corrente: encosta na pele a uma folga fixa, sai de dentro das camisas e
    suaviza (sem encolher), repetindo até estabilizar."""
    skin_gap = half + 0.006
    shirt_gap = half + 0.0035
    P = [p.copy() for p in pts]
    n = len(P)
    for it in range(iters):
        for i, p in enumerate(P):
            loc, nrm, _, _ = BODY_BVH.find_nearest(p)
            p = loc + nrm * skin_gap
            for b in SHIRT_BVHS:
                for _ in range(3):
                    hit = b.find_nearest(p)
                    if hit[0] is None:
                        break
                    sl, sn = hit[0], hit[1]
                    # A normal da camisa deve apontar para longe da pele (na gola há faces
                    # dobradas para dentro): orienta pela normal da pele no mesmo ponto. Assim,
                    # em cima do ombro o empurrão é para cima, não para os lados.
                    if sn.dot(nrm) < 0:
                        sn = -sn
                    d = (p - sl).dot(sn)
                    if d >= shirt_gap or (p - sl).length > 0.08:
                        break
                    p = p + sn * (shirt_gap - d)
            P[i] = p
        # suavização de Taubin no laço fechado (alisa sem encolher); mais forte no começo,
        # para a volta não embolar sobre os ombros
        for _ in range(4 if it < iters - 2 else 1):
            for lam in (0.5, -0.52):
                Q = [P[i] + (P[(i - 1) % n] + P[(i + 1) % n] - 2 * P[i]) * (lam / 2) for i in range(n)]
                P = Q
    return P


def resample(P, step):
    """Reamostra o laço fechado com espaçamento constante (um ponto por elo)."""
    n = len(P)
    seg = [(P[(i + 1) % n] - P[i]).length for i in range(n)]
    total = sum(seg)
    count = max(8, int(round(total / step)))
    step = total / count
    out, i, acc = [], 0, 0.0
    for k in range(count):
        target = k * step
        while acc + seg[i] < target:
            acc += seg[i]
            i = (i + 1) % n
        t = (target - acc) / seg[i]
        out.append(P[i].lerp(P[(i + 1) % n], t))
    return out, total


# ------------------------------------------------------------------ geometria
def torus_verts(R, r, seg_major, seg_minor, sx=1.0, sz=1.0, flat=1.0):
    """Toro no plano XY (eixo Z = normal do elo). sx alonga o elo, flat achata a espessura."""
    vs = []
    for i in range(seg_major):
        u = 2 * math.pi * i / seg_major
        cu, su = math.cos(u), math.sin(u)
        for j in range(seg_minor):
            v = 2 * math.pi * j / seg_minor
            cv, sv = math.cos(v), math.sin(v)
            vs.append(Vector(((R + r * cv) * cu * sx, (R + r * cv) * su, r * sv * flat * sz)))
    faces = []
    for i in range(seg_major):
        for j in range(seg_minor):
            a = i * seg_minor + j
            b = ((i + 1) % seg_major) * seg_minor + j
            c = ((i + 1) % seg_major) * seg_minor + (j + 1) % seg_minor
            d = i * seg_minor + (j + 1) % seg_minor
            faces.append((a, b, c, d))
    return vs, faces


class Builder:
    """Acumula peças (vértices já posicionados + pesos) numa malha."""

    def __init__(self):
        self.verts, self.faces, self.weights = [], [], []

    def add(self, vs, faces, mat, w):
        base = len(self.verts)
        self.verts.extend(mat @ v for v in vs)
        self.faces.extend(tuple(base + i for i in f) for f in faces)
        self.weights.extend([w] * len(vs))

    def add_mesh(self, me, mat, w):
        self.add([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons], mat, w)

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


def frame_at(P, i, normal_hint=None):
    """Base local (T = tangente, N = normal da pele/para fora, B = T×N) no ponto i."""
    n = len(P)
    T = (P[(i + 1) % n] - P[(i - 1) % n]).normalized()
    _, N, _, _ = BODY_BVH.find_nearest(P[i])
    N = (N - T * N.dot(T)).normalized()
    B = T.cross(N).normalized()
    return T, N, B


def basis(X, Y, Z, origin):
    m = Matrix.Identity(4)
    for k in range(3):
        m[k][0], m[k][1], m[k][2] = X[k], Y[k], Z[k]
        m[k][3] = origin[k]
    return m


def links(builder, P, style):
    n = len(P)
    for i in range(n):
        T, N, B = frame_at(P, i)
        w = weights_at(P[i])
        if style['kind'] == 'cuban':
            # Grumet: elo alongado, deitado no peito (normal do elo ≈ N), torcido ±25°.
            ang = math.radians(25 if i % 2 else -25)
            Z = (N * math.cos(ang) + B * math.sin(ang)).normalized()
            Y = Z.cross(T).normalized()
            vs, fs = torus_verts(style['R'], style['r'], style['seg'][0], style['seg'][1], sx=style.get('sx', 1.45), flat=0.62)
            builder.add(vs, fs, basis(T, Y, Z, P[i]), w)
        elif style['kind'] == 'bismarck':
            # Elos duplos: dois elos lado a lado, alternando 90° (corrente grossa e "cheia").
            for side in (-1, 1):
                Z = N if i % 2 else B
                Y = Z.cross(T).normalized()
                off = (B if i % 2 else N) * (side * style['R'] * 0.55)
                vs, fs = torus_verts(style['R'] * 0.78, style['r'], style['seg'][0], style['seg'][1], sx=1.35)
                builder.add(vs, fs, basis(T, Y, Z, P[i] + off), w)
        elif style['kind'] == 'ribbon':
            # Laço: elo de fita larga e fina, alternando 90°, com torção.
            twist = math.radians(35 if i % 2 else -35)
            base_z = N if i % 2 else B
            other = B if i % 2 else N
            Z = (base_z * math.cos(twist) + other * math.sin(twist)).normalized()
            Y = Z.cross(T).normalized()
            vs, fs = torus_verts(style['R'], style['r'], style['seg'][0], style['seg'][1], sx=1.3, sz=1.0, flat=0.35)
            # fita: alarga na direção radial do toro (achatado em Z = espessura fina)
            builder.add(vs, fs, basis(T, Y, Z, P[i]), w)


def text_mesh(txt, size, extrude, bevel=0.0):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = txt
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    return me


def prim(kind, **kw):
    bm = bmesh.new()
    if kind == 'cyl':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=kw.get('seg', 32), radius1=kw['r'], radius2=kw['r'], depth=kw['h'])
    elif kind == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=kw['r'])
    elif kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=kw['s'], verts=bm.verts)
    me = bpy.data.meshes.new(kind)
    bm.to_mesh(me)
    bm.free()
    return me


def prism(profile, depth):
    """Prisma a partir de um perfil 2D (x, y) no plano XY, extrudado em Z (centrado)."""
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, y, -depth / 2)) for x, y in profile]
    vs1 = [bm.verts.new((x, y, depth / 2)) for x, y in profile]
    bm.faces.new(list(reversed(vs0)))
    bm.faces.new(vs1)
    n = len(profile)
    for i in range(n):
        bm.faces.new((vs0[i], vs0[(i + 1) % n], vs1[(i + 1) % n], vs1[i]))
    me = bpy.data.meshes.new('prisma')
    bm.to_mesh(me)
    bm.free()
    return me


# ------------------------------------------------------------------ pingentes
# Montados no plano local XY (X = direita do personagem vista de frente, Y = para cima,
# Z = para fora do peito), depois posicionados no ponto mais baixo da corrente.
def pendant_medal(gold, stones, M, w):
    R = 0.046
    gold.add_mesh(prim('cyl', r=R, h=0.0055, seg=40), M, w)          # disco virado para fora (eixo Z)
    # borda de "bolinhas" (frisada)
    for k in range(48):
        a = 2 * math.pi * k / 48
        gold.add_mesh(prim('ico', r=0.0026), M @ Matrix.Translation((R * 0.93 * math.cos(a), R * 0.93 * math.sin(a), 0.0028)), w)
    for txt, y, s in (('FOCO', 0.021, 0.0165), ('FÉ', 0.0, 0.0165), ('FORÇA', -0.021, 0.0150)):
        me = text_mesh(txt, s, 0.0016)
        gold.add_mesh(me, M @ Matrix.Translation((0, y, 0.0030)), w)
    # argola (bail)
    vs, fs = torus_verts(0.006, 0.0018, 16, 6)
    gold.add(vs, fs, M @ Matrix.Translation((0, R + 0.005, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), w)
    return R + 0.011


def pendant_crown7(gold, stones, M, w):
    W, H = 0.044, 0.054
    c = 0.008
    prof = [(-W / 2 + c, -H / 2), (W / 2 - c, -H / 2), (W / 2, -H / 2 + c), (W / 2, H / 2 - c), (W / 2 - c, H / 2),
            (-W / 2 + c, H / 2), (-W / 2, H / 2 - c), (-W / 2, -H / 2 + c)]
    gold.add_mesh(prism(prof, 0.005), M, w)
    # cravejado: pedras na borda e no fundo da placa (fora do "7")
    for k in range(10):
        for j in range(12):
            x = -W / 2 + 0.005 + k * (W - 0.01) / 9
            y = -H / 2 + 0.005 + j * (H - 0.01) / 11
            in_seven = (abs(y - 0.017) < 0.007 and abs(x) < 0.014) or (abs(x - (0.004 - (0.017 - y) * 0.35)) < 0.0055 and y < 0.017)
            if not in_seven:
                stones.add_mesh(prim('ico', r=0.0017), M @ Matrix.Translation((x, y, 0.0028)), w)
    me = text_mesh('7', 0.05, 0.0025)
    gold.add_mesh(me, M @ Matrix.Translation((0, -0.002, 0.003)), w)
    # coroa: perfil com três pontas, pedras nas pontas e na faixa
    cw, base_y = 0.03, H / 2 + 0.002
    crown = [(-cw / 2, 0), (cw / 2, 0), (cw / 2, 0.006), (cw / 2 + 0.002, 0.016), (cw / 4, 0.009), (0, 0.019),
             (-cw / 4, 0.009), (-cw / 2 - 0.002, 0.016), (-cw / 2, 0.006)]
    gold.add_mesh(prism(crown, 0.006), M @ Matrix.Translation((0, base_y, 0)), w)
    for x, y in ((cw / 2 + 0.002, 0.017), (0, 0.020), (-cw / 2 - 0.002, 0.017)):
        stones.add_mesh(prim('ico', r=0.0026), M @ Matrix.Translation((x, base_y + y, 0.0)), w)
    for k in range(7):
        stones.add_mesh(prim('ico', r=0.0018), M @ Matrix.Translation((-cw / 2 + 0.003 + k * (cw - 0.006) / 6, base_y + 0.003, 0.0032)), w)
    vs, fs = torus_verts(0.0055, 0.0017, 16, 6)
    gold.add(vs, fs, M @ Matrix.Translation((0, base_y + 0.024, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), w)
    return H / 2 + 0.03


def pendant_dollar(gold, stones, M, w):
    me = text_mesh('$', 0.075, 0.0035, bevel=0.0006)
    gold.add_mesh(me, M, w)
    # pedras sobre a frente do "$" (amostra dos centros das faces voltadas para fora)
    me.calc_loop_triangles()
    pts = [Vector(t.center) for t in me.loop_triangles if t.normal.z > 0.9]
    pts.sort(key=lambda p: (round(p.y / 0.0045), p.x))
    taken = []
    for p in pts:
        if all((p - q).length > 0.0042 for q in taken):
            taken.append(p)
    for p in taken:
        stones.add_mesh(prim('ico', r=0.0016), M @ Matrix.Translation((p.x, p.y, p.z + 0.0012)), w)
    bb = [v.co for v in me.vertices]
    top = max(v.y for v in bb)
    vs, fs = torus_verts(0.005, 0.0016, 16, 6)
    gold.add(vs, fs, M @ Matrix.Translation((0, top + 0.004, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), w)
    return top + 0.009


CHAINS = [
    # id, malha, estilo dos elos, fundo da volta (z), pingente
    ('corrente_foco_fe_forca', 'Corrente_Foco', {'kind': 'bismarck', 'R': 0.0062, 'r': 0.0019, 'seg': (10, 5), 'step': 0.0105}, 1.27, pendant_medal),
    ('corrente_coroa_7', 'Corrente_Coroa7', {'kind': 'ribbon', 'R': 0.0068, 'r': 0.0030, 'seg': (12, 6), 'step': 0.0118}, 1.28, pendant_crown7),
    ('corrente_cifrao', 'Corrente_Cifrao', {'kind': 'cuban', 'R': 0.0036, 'r': 0.0013, 'seg': (10, 4), 'step': 0.0058}, 1.26, pendant_dollar),
    ('corrente_grumet', 'Corrente_Grumet', {'kind': 'cuban', 'R': 0.0085, 'r': 0.0030, 'seg': (12, 6), 'step': 0.0145, 'sx': 1.4}, 1.31, None),
]

objects = []
built = {}
for cid, mesh_name, style, drop_z, pend in CHAINS:
    half = style['r'] * 1.6 + style['R'] * (0.5 if style['kind'] == 'bismarck' else 0.25)
    loop = settle(initial_loop(160, drop_z), half, iters=20)
    pts, length = resample(loop, style['step'])
    # repete o assentamento nos pontos finais (cada elo também fica fora das camisas)
    pts = settle(pts, half, iters=2)
    gold, stones = Builder(), Builder()
    links(gold, pts, style)
    if pend:
        # ponto mais baixo da frente
        i0 = min(range(len(pts)), key=lambda i: pts[i].z + (0 if pts[i].y < NECK_Y else 1))
        T, N, B = frame_at(pts, i0)
        down = (Vector((0, 0, -1)) - N * N.dot(Vector((0, 0, -1)))).normalized()
        # base do pingente (destra): Y = para cima ao longo do peito, Z = para fora, X = Y × Z
        X = (-down).cross(N).normalized()
        w = weights_at(pts[i0])
        anchor = pts[i0]
        M0 = basis(X, -down, N, Vector((0, 0, 0)))
        # mede o pingente para pendurá-lo pela argola no ponto mais baixo
        probe_g, probe_s = Builder(), Builder()
        hang = pend(probe_g, probe_s, M0, w)
        center = anchor + down * hang
        # afasta do peito/camisa se precisar (pingente rígido, inclinado como o peito)
        for _ in range(6):
            pushed = False
            for b in [BODY_BVH, *SHIRT_BVHS]:
                hit = b.find_nearest(center)
                if hit[0] is not None and (center - hit[0]).length < 0.009:
                    center = center + N * 0.002
                    pushed = True
            if not pushed:
                break
        pend(gold, stones, basis(X, -down, N, center), w)
    built[cid] = (mesh_name, gold, stones)
    print(f'[correntes] {cid}: volta de {length:.2f} m, {len(pts)} elos, {gold.tris + stones.tris} triângulos')


def make_object(name, b):
    me = bpy.data.meshes.new(name)
    me.from_pydata([v[:] for v in b.verts], [], b.faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    groups = {}
    for i, wd in enumerate(b.weights):
        for gname, wt in wd.items():
            g = groups.get(gname) or ob.vertex_groups.new(name=gname)
            groups[gname] = g
            g.add([i], wt, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Esqueleto', 'ARMATURE')
    mod.object = rig
    return ob


gold_mat = bpy.data.materials.new('Ouro')
gold_mat.use_nodes = True
gb = next(n for n in gold_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
gb.inputs['Base Color'].default_value = (1.0, 0.66, 0.16, 1)
gb.inputs['Metallic'].default_value = 1.0
gb.inputs['Roughness'].default_value = 0.2
stone_mat = bpy.data.materials.new('Pedras')
stone_mat.use_nodes = True
sb = next(n for n in stone_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
sb.inputs['Base Color'].default_value = (0.95, 0.97, 1.0, 1)
sb.inputs['Metallic'].default_value = 0.6
sb.inputs['Roughness'].default_value = 0.03

parts = {}
for cid, (mesh_name, gold, stones) in built.items():
    og = make_object(f'{mesh_name}_Ouro', gold)
    og.data.materials.append(gold_mat)
    parts[cid] = [og]
    if stones.verts:
        os_ = make_object(f'{mesh_name}_Pedras', stones)
        os_.data.materials.append(stone_mat)
        parts[cid].append(os_)

for o in bpy.context.view_layer.objects:
    o.select_set(False)
rig.select_set(True)
for obs in parts.values():
    for o in obs:
        o.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = os.path.join(out_dir, 'chains_base.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=False,
                          export_normals=True, export_materials='PLACEHOLDER', export_skins=True, export_all_influences=False,
                          export_def_bones=False, export_rest_position_armature=True, export_animations=False, export_morph=False)
print(f'[correntes] exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

# ------------------------------------------------------------------ miniaturas e prévias
if make_thumbs:
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 88
    # mesmo "estúdio" dos óculos: fundo neutro para a câmera, céu/horizonte/chão nos reflexos
    world = bpy.data.worlds.new('Fundo')
    world.use_nodes = True
    wn, wl = world.node_tree.nodes, world.node_tree.links
    bg_cam = wn['Background']
    bg_cam.inputs['Color'].default_value = (0.62, 0.67, 0.74, 1)
    bg_ref = wn.new('ShaderNodeBackground')
    coord, sep, to01, ramp = wn.new('ShaderNodeTexCoord'), wn.new('ShaderNodeSeparateXYZ'), wn.new('ShaderNodeMath'), wn.new('ShaderNodeValToRGB')
    to01.operation = 'MULTIPLY_ADD'
    to01.inputs[1].default_value = 0.5
    to01.inputs[2].default_value = 0.5
    wl.new(coord.outputs['Generated'], sep.inputs['Vector'])
    wl.new(sep.outputs['Z'], to01.inputs[0])
    wl.new(to01.outputs['Value'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.40, (0.05, 0.05, 0.055, 1)
    els[1].position, els[1].color = 0.62, (0.85, 0.9, 1.0, 1)
    els.new(0.51).color = (1.6, 1.6, 1.6, 1)
    wl.new(ramp.outputs['Color'], bg_ref.inputs['Color'])
    lp, mix = wn.new('ShaderNodeLightPath'), wn.new('ShaderNodeMixShader')
    wl.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    wl.new(bg_ref.outputs['Background'], mix.inputs[1])
    wl.new(bg_cam.outputs['Background'], mix.inputs[2])
    wl.new(mix.outputs['Shader'], wn['World Output'].inputs['Surface'])
    scene.world = world
    for nm, energy, rot in (('Chave', 3.0, (0.9, 0.2, -0.5)), ('Recorte', 1.6, (1.1, 0.0, 2.6))):
        ld = bpy.data.lights.new(nm, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(nm, ld)
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
    # camisa escura de gola redonda por cima do corpo, como na vitrine das referências
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=jersey_glb)
    shirt = next((o for o in bpy.data.objects if o not in before and o.type == 'MESH' and o.name.startswith('Camisa_GolaRedonda')), None)
    for o in [o for o in bpy.data.objects if o not in before and o is not shirt and o.type == 'MESH']:
        o.hide_render = True
    if shirt:
        dark = bpy.data.materials.new('CamisaEscura')
        dark.use_nodes = True
        db = next(n for n in dark.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        db.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
        db.inputs['Roughness'].default_value = 0.85
        shirt.data.materials.clear()
        shirt.data.materials.append(dark)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    def shoot(path, loc, rot, scale, res=320):
        cam.location, cam.rotation_euler, cam.data.ortho_scale = loc, rot, scale
        scene.render.resolution_x = scene.render.resolution_y = res
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    prev = os.path.join(os.path.dirname(src_blend), 'correntes_previa')
    os.makedirs(prev, exist_ok=True)
    for cid, obs in parts.items():
        for other, oobs in parts.items():
            for o in oobs:
                o.hide_render = other != cid
        d = os.path.join(out_dir, cid)
        os.makedirs(d, exist_ok=True)
        shoot(os.path.join(d, 'thumb.webp'), (0.0, -3.0, 1.34), (math.pi / 2, 0, 0), 0.36)
        shoot(os.path.join(prev, f'{cid}_lado.webp'), (3.0, -0.6, 1.36), (math.pi / 2, 0, math.radians(79)), 0.42, 512)
        shoot(os.path.join(prev, f'{cid}_costas.webp'), (0.0, 3.0, 1.40), (math.pi / 2, 0, math.pi), 0.42, 512)
        print(f'[correntes] miniatura {cid}')

print(f'[correntes] concluído em {time.time() - t_start:.1f}s')
