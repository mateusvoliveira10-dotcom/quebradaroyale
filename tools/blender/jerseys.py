"""Camisas do personagem-base: malha, UV, texturas, miniaturas e export.

blender -b --python tools/blender/jerseys.py -- <personagem-base.blend> <pasta de saída> [--sem-miniaturas]

Saída (em public/assets/customization/jerseys/):
  jersey_base.glb            malhas com skinning no esqueleto do personagem (SHELLS):
                             Camisa_GolaRedonda (manga curta), Camisa_MangaLonga e
                             Regata, todas de gola redonda, mesmo atlas
  fabric_normal.png          normal map de tecido (malha, costuras), comum a todas
  <id>/albedo.webp           atlas usado no jogo (frente, costas, mangas, gola)
  <id>/front.png, back.png   frente e costas planificadas (referência/edição)
  <id>/thumb.webp            miniatura renderizada no manequim

A malha sai do próprio corpo do manequim (tronco + manga curta), suavizada para
não marcar a musculatura, afastada ~1 cm, com gola extrudada e bainhas com
espessura. Os pesos de skinning são os do corpo, então a camisa acompanha
todas as animações. As regras de cobertura (COVER_*) são as mesmas que o
shader do corpo usa para esconder a pele coberta (ClothingMaterial.ts).
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src_blend, out_dir = os.path.abspath(args[0]), os.path.abspath(args[1])
make_thumbs = '--sem-miniaturas' not in args
# --apenas=id1,id2: só essas peças ganham textura/miniatura (para iterar rápido; a malha sai inteira)
ONLY = next((a.split('=', 1)[1].split(',') for a in args if a.startswith('--apenas=')), None)
t_start = time.time()
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=src_blend)
body = bpy.data.objects['Corpo']
rig = bpy.data.objects['Esqueleto']
# O .blend guarda as animações em trilhas NLA ativas: tudo aqui é feito na pose de repouso.
rig.data.pose_position = 'REST'

# ------------------------------------------------------------------ regras de cobertura
# Coordenadas do Blender: z para cima, frente em -Y, esquerda do personagem em +X.
HEM_Z = 0.845          # barra da camisa
SLEEVE_T = 0.40        # fim da manga (0 = ombro, 1 = punho)
HIDE_FROM_Z = 0.90     # pele escondida acima disto
HIDE_SLEEVE_T = 0.36
NECK_MARGIN = 0.035     # pele mantida abaixo do decote (sem vão visível entre gola e pescoço)

bones = rig.data.bones
SHOULDER = bones['LeftArm'].head_local.copy()
WRIST = bones['LeftHand'].head_local.copy()
ARM_AXIS = WRIST - SHOULDER
ARM_LEN2 = ARM_AXIS.length_squared
NECK_Y = bones['Neck'].head_local.y


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# Gola redonda (a única): plano inclinado (mais baixo na frente) só perto do pescoço.
NECK_A, NECK_B, NECK_HALF = 1.415, 0.25, 0.12
# Costura raglan: plano vertical do pescoço até a axila.
RAGLAN_P = (0.115, 1.43)
RAGLAN_N = (0.28, 0.04)


TOP_Z = 1.46           # nada da camisa acima disto (topo dos ombros ~1,43)

# Modelos de malha (cada um vira uma malha no jersey_base.glb), todos de gola redonda.
# As regras de cobertura de cada modelo são repetidas no shader do corpo (ClothingMaterial.ts).
#   neck_drop decote abaixo da gola redonda padrão (m)
#   sleeve_t  fim da manga (t ao longo do braço); None = regata, sem manga (cava própria)
#   hide_t    pele do braço escondida até este t (None = nenhuma)
#   loose     folga extra em relação à camiseta (m)
#   t1        fim da faixa da manga no atlas (t)
SHELLS = {
    'crew': {'mesh': 'Camisa_GolaRedonda', 'neck_drop': 0.0, 'sleeve_t': 0.42, 'hide_t': 0.34, 'loose': 0.0, 't1': 0.44},
    'long': {'mesh': 'Camisa_MangaLonga', 'neck_drop': 0.0, 'sleeve_t': 0.97, 'hide_t': 0.89, 'loose': 0.004, 't1': 1.0},
    'tank': {'mesh': 'Regata', 'neck_drop': 0.015, 'sleeve_t': None, 'hide_t': None, 'loose': 0.0, 't1': 0.44},
}
TANK_TOP_Z = 1.445     # topo das alças (não sobe pela lateral do pescoço)
# Cava da regata: plano paralelo ao raglan, mais para fora, deixando alças de ~5 cm
# entre o decote (|x| < 0,12) e a cava.
TANK_P = (0.17, 1.43)


def in_raglan(x, z):
    """Lado do tronco da cava da regata."""
    return (abs(x) - TANK_P[0]) * RAGLAN_N[0] + (z - TANK_P[1]) * RAGLAN_N[1] <= 0


def neck_z(x, y, kind):
    """Altura do decote; acima disto não há camisa (mesma regra do shader do corpo)."""
    spec = SHELLS[kind]
    top = TANK_TOP_Z if spec['sleeve_t'] is None else TOP_Z
    if abs(x) >= NECK_HALF:
        return top
    return min(top, NECK_A - spec['neck_drop'] + NECK_B * y)


ARM_RE = ('Shoulder', 'Arm', 'ForeArm', 'Hand')
arm_groups = {g.index for g in body.vertex_groups if any(g.name.startswith(s) and g.name[len(s):].startswith(ARM_RE) for s in ('Left', 'Right'))}


def arm_t(co):
    p = Vector((abs(co.x), co.y, co.z))
    return (p - SHOULDER).dot(ARM_AXIS) / ARM_LEN2


def body_vertex_info():
    info = []
    for v in body.data.vertices:
        armw = sum(g.weight for g in v.groups if g.group in arm_groups)
        info.append((armw, arm_t(v.co)))
    return info


BODY_INFO = body_vertex_info()
# Pele em repouso, para garantir que a camisa nunca fique dentro do corpo.
BODY_BVH = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

def covered_body(kind):
    """Cópia do corpo sem a pele coberta pela camisa, para as miniaturas. Corta pelos
    mesmos planos e com a mesma margem que o shader do jogo usa para descartar pixels
    (ClothingMaterial.ts), então a miniatura mostra exatamente o que o jogo mostra."""
    spec = SHELLS[kind]
    tank = spec['sleeve_t'] is None
    hide_t = spec['hide_t']
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = f'CorpoMiniatura_{kind}'
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active

    def armw(f):
        return sum(sum(w for gi, w in v[dl].items() if gi in arm_groups) for v in f.verts) / len(f.verts)

    def split(faces, co, no):
        faces = list(faces)
        bmesh.ops.bisect_plane(bm, geom=list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces,
                               dist=1e-5, plane_co=co, plane_no=no)

    split(bm.faces, (0, 0, HIDE_FROM_Z), (0, 0, 1))
    split(bm.faces, (0, 0, TOP_Z), (0, 0, 1))
    near_neck = [f for f in bm.faces if abs(f.calc_center_median().x) < NECK_HALF and f.calc_center_median().z > 1.25]
    split(near_neck, (0, 0, NECK_A - spec['neck_drop'] - NECK_MARGIN), (0, -NECK_B, 1))
    if tank:
        split(list(bm.faces), (0, 0, TANK_TOP_Z - NECK_MARGIN), (0, 0, 1))
    if hide_t is not None:
        for s in (1, -1):
            faces = [f for f in bm.faces if f.calc_center_median().x * s > 0.15 and armw(f) > 0.3]
            split(faces, mirror_x(SHOULDER + ARM_AXIS * hide_t, s), mirror_x(ARM_AXIS, s))
    else:
        for s in (1, -1):
            faces = [f for f in bm.faces if f.calc_center_median().x * s > 0.05 and f.calc_center_median().z > 1.0]
            split(faces, (TANK_P[0] * s, 0, TANK_P[1]), (RAGLAN_N[0] * s, 0, RAGLAN_N[1]))
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        a = armw(f)
        sleeve_hidden = hide_t is not None and a >= 0.5 and arm_t(c) < hide_t and c.z < TOP_Z
        if hide_t is None:
            torso_hidden = HIDE_FROM_Z < c.z < neck_z(c.x, c.y, kind) - NECK_MARGIN and in_raglan(c.x, c.z)
        else:
            torso_hidden = a < 0.5 and HIDE_FROM_Z < c.z < neck_z(c.x, c.y, kind) - NECK_MARGIN
        if sleeve_hidden or torso_hidden:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    return obj

# ------------------------------------------------------------------ malha da camisa
W = 0.25               # meia largura do painel frente/costas no atlas (m)
Z0, Z1 = 0.80, 1.52    # faixa de altura do tronco no atlas
T0, T1 = -0.2, 0.42    # faixa da manga no atlas
PART_TORSO, PART_SLEEVE, PART_COLLAR = 0, 1, 2
COLLAR_BAND = 0.014    # largura da ribana pintada abaixo da borda do decote (m)
NECK_SEGMENTS = {}     # gola -> segmentos da borda do decote no espaço UV (para pintar a ribana)


def mirror_x(v, s):
    return Vector((v.x * s, v.y, v.z))


def build_shell(kind):
    spec = SHELLS[kind]
    sleeve_t = spec['sleeve_t']
    loose = spec['loose']
    t1 = spec['t1']
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = spec['mesh']
    bpy.context.collection.objects.link(obj)
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            obj.modifiers.remove(m)
    for g in list(obj.vertex_groups):
        if g.name.startswith('coberto_'):
            obj.vertex_groups.remove(g)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active

    def armw(v):
        return sum(w for gi, w in v[dl].items() if gi in arm_groups)

    # 1) recorte grosseiro com folga (os cortes exatos vêm depois)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        a = sum(armw(v) for v in f.verts) / len(f.verts)
        if sleeve_t is None:
            # Regata: pela posição (as alças ficam sobre a clavícula, que pesa no osso do
            # ombro), dentro da cava com folga; o corte exato vem depois.
            keep = HEM_Z - 0.04 < c.z < neck_z(c.x, c.y, kind) + 0.05 and in_raglan(c.x - 0.03 * (1 if c.x > 0 else -1), c.z)
        elif a >= 0.5:
            keep = arm_t(c) < sleeve_t + 0.08 and c.z < TOP_Z
        else:
            keep = HEM_Z - 0.04 < c.z < neck_z(c.x, c.y, 'crew') + 0.05
        if not keep:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')

    def cut(faces, co, no, remove_positive):
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + list(faces), dist=1e-5,
                               plane_co=co, plane_no=no, clear_outer=remove_positive, clear_inner=not remove_positive)

    # 2) cortes exatos: barra, fim das mangas, decote
    cut(list(bm.faces), (0, 0, HEM_Z), (0, 0, 1), remove_positive=False)
    for s in (1, -1):
        if sleeve_t is not None:
            faces = [f for f in bm.faces if f.calc_center_median().x * s > 0.15 and sum(armw(v) for v in f.verts) / len(f.verts) > 0.3]
            cut(faces, mirror_x(SHOULDER + ARM_AXIS * sleeve_t, s), mirror_x(ARM_AXIS, s), remove_positive=True)
        else:
            # Cava da regata: corta exatamente no plano da cava (o mesmo do shader do corpo).
            faces = [f for f in bm.faces if f.calc_center_median().x * s > 0.05 and f.calc_center_median().z > 0.95]
            cut(faces, (TANK_P[0] * s, 0, TANK_P[1]), (RAGLAN_N[0] * s, 0, RAGLAN_N[1]), remove_positive=True)
    neck = [f for f in bm.faces if abs(f.calc_center_median().x) < NECK_HALF and f.calc_center_median().z > 1.30]
    cut(neck, (0, 0, NECK_A - spec['neck_drop']), (0, -NECK_B, 1), remove_positive=True)
    if sleeve_t is None:
        cut(list(bm.faces), (0, 0, TANK_TOP_Z), (0, 0, 1), remove_positive=True)
    # 3) costura raglan (só divide, para separar manga e tronco numa linha reta)
    for s in ((1, -1) if sleeve_t is not None else ()):
        faces = [f for f in bm.faces if f.calc_center_median().x * s > 0.05 and f.calc_center_median().z > 1.0]
        cut_geom = {v for f in faces for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(cut_geom) + list({e for f in faces for e in f.edges}) + faces, dist=1e-5,
                               plane_co=(RAGLAN_P[0] * s, 0, RAGLAN_P[1]), plane_no=(RAGLAN_N[0] * s, 0, RAGLAN_N[1]))
    # Remove pedaços soltos (sobra de pescoço etc.): fica só a maior ilha.
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for f0 in bm.faces:
        if f0 in seen:
            continue
        stack, isl = [f0], []
        seen.add(f0)
        while stack:
            f = stack.pop()
            isl.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    bmesh.ops.delete(bm, geom=[f for isl in islands[1:] for f in isl], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    # Furos: além da barra, dos dois punhos e do decote, qualquer borda fechada é tapada.
    loops, used = [], set()
    for e0 in [e for e in bm.edges if e.is_boundary]:
        if e0 in used:
            continue
        loop, stack = [], [e0]
        used.add(e0)
        while stack:
            e = stack.pop()
            loop.append(e)
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2.is_boundary and e2 not in used:
                        used.add(e2)
                        stack.append(e2)
        loops.append(loop)
    loops.sort(key=len, reverse=True)
    holes = [e for loop in loops[4:] for e in loop]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes, sides=0)
    print(f'[camisas] {kind}: {len(loops)} bordas, {len(loops) - 4 if len(loops) > 4 else 0} furos tapados')

    part = bm.faces.layers.int.new('part')

    def side_sleeve(f):
        c = f.calc_center_median()
        ax = abs(c.x)
        if ax <= 0.13 or (ax - RAGLAN_P[0]) * RAGLAN_N[0] + (c.z - RAGLAN_P[1]) * RAGLAN_N[1] <= 0:
            return False
        # Abaixo de 1,0 m só o antebraço da manga longa (pelo peso dos ossos do braço).
        return c.z > 1.0 or sum(armw(v) for v in f.verts) / len(f.verts) > 0.5

    for f in bm.faces:
        f[part] = PART_SLEEVE if sleeve_t is not None and side_sleeve(f) else PART_TORSO

    # 4) suavização de Taubin (não encolhe) no interior: tira abdômen, mamilos e marcas musculares
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    verts = list(bm.verts)
    boundary = [v.is_boundary for v in verts]
    nbrs = [[e.other_vert(v).index for e in v.link_edges] for v in verts]
    P = np.array([v.co[:] for v in verts])
    for _ in range(14):
        for lam in (0.55, -0.58):
            avg = np.array([P[n].mean(axis=0) if (not b and n) else P[i] for i, (b, n) in enumerate(zip(boundary, nbrs))])
            P = P + lam * (avg - P)
    for v, p in zip(verts, P):
        v.co = p
    bm.normal_update()

    # 5) caimento. Em vez de só afastar a pele (camisa "pintada" no corpo), cada região
    # ganha a forma de tecido de verdade:
    #  - tronco: abaixo do peito o tecido cai reto (preenche a cintura e a lombar) até a barra;
    #  - mangas: tubo arredondado (sem marcar o músculo), com leve boca de sino na manga curta
    #    e punho franzido na manga longa; o lado de dentro (axila) fica mais justo;
    #  - perto da gola, a folga diminui para o decote encostar no pescoço.
    # O deslocamento é suavizado na malha inteira (sem degraus entre tronco e manga) e, no fim,
    # nenhum ponto fica a menos de MIN_GAP da pele (sem atravessar o corpo em repouso).
    NRM = np.array([v.normal[:] for v in verts])
    for _ in range(8):
        NRM = np.array([(NRM[n].sum(axis=0) + NRM[i]) for i, n in enumerate(nbrs)])
        NRM /= np.linalg.norm(NRM, axis=1, keepdims=True) + 1e-9
    is_sleeve = np.array([sum(1 for f in v.link_faces if f[part] == PART_SLEEVE) > len(v.link_faces) / 2 for v in verts])
    base = 0.010 + loose

    # Tronco: raio de referência do peito por ângulo em volta do eixo do tronco.
    torso_idx = np.where(~is_sleeve)[0]
    band = P[torso_idx][(P[torso_idx, 2] > 1.20) & (P[torso_idx, 2] < 1.30)]
    cy_ref = band[:, 1].mean()
    NB = 72
    ang_b = ((np.arctan2(band[:, 0], -(band[:, 1] - cy_ref)) + math.pi) / (2 * math.pi) * NB).astype(int) % NB
    rad_b = np.hypot(band[:, 0], band[:, 1] - cy_ref)
    chest_r = np.zeros(NB)
    for b, r in zip(ang_b, rad_b):
        chest_r[b] = max(chest_r[b], r)
    for _ in range(3):  # suaviza o perfil (e preenche ângulos vazios)
        filled = np.where(chest_r > 0, chest_r, np.nan)
        chest_r = np.nan_to_num(np.nanmean(np.stack([np.roll(filled, -1), filled, np.roll(filled, 1)]), axis=0), nan=0.0)

    # Mangas: raio médio e máximo em volta do eixo do braço, por faixa de t.
    a_dir = ARM_AXIS.normalized()
    o_dir = (Vector((1, 0, 0)) - a_dir * a_dir.x).normalized()
    A = np.array(a_dir[:])
    O = np.array(o_dir[:])
    S = np.array(SHOULDER[:])
    Pm = P.copy()
    Pm[:, 0] = np.abs(Pm[:, 0])
    Q = Pm - S
    T_ = Q @ A / math.sqrt(ARM_LEN2)
    RADV = Q - np.outer(Q @ A, A)
    RHO = np.linalg.norm(RADV, axis=1)
    cos_out = (RADV @ O) / (RHO + 1e-9)   # 1 = lado de fora do braço, -1 = axila
    t_bins = np.round(T_ * 40).astype(int)
    rho_max = {}
    for tb, r, sl in zip(t_bins, RHO, is_sleeve):
        if sl:
            rho_max[tb] = max(rho_max.get(tb, 0.0), r)

    neck_dist = np.full(len(verts), 1.0)
    neck_pts = np.array([v.co[:] for v in verts if v.is_boundary and v.co.z > 1.3 and abs(v.co.x) < NECK_HALF])
    if len(neck_pts):
        for i, p in enumerate(P):
            if p[2] > 1.28:
                neck_dist[i] = np.min(np.linalg.norm(neck_pts - p, axis=1))

    D = np.zeros_like(P)
    for i, p in enumerate(P):
        n = NRM[i]
        if is_sleeve[i] and sleeve_t is not None:
            t = T_[i]
            rmax = rho_max.get(t_bins[i], RHO[i])
            # arredonda o tubo: aproxima do raio máximo da faixa, mais no lado de fora
            round_k = 0.55 * (0.5 + 0.5 * cos_out[i]) * smoothstep(0.02, 0.14, t)
            target = max(RHO[i] + base, RHO[i] + (rmax - RHO[i]) * round_k + base)
            if sleeve_t < 0.6:
                target += 0.007 * smoothstep(0.15, sleeve_t, t)          # boca de sino suave
            else:
                target += 0.004 * smoothstep(0.1, 0.5, t)
                target -= (0.006 + loose) * smoothstep(sleeve_t - 0.08, sleeve_t, t)  # punho
            radial = RADV[i] / (RHO[i] + 1e-9)
            radial[0] *= 1 if p[0] >= 0 else -1
            D[i] = radial * (target - RHO[i])
        else:
            yy = p[1] - cy_ref
            r = math.hypot(p[0], yy)
            ab = int((math.atan2(p[0], -yy) + math.pi) / (2 * math.pi) * NB) % NB
            hang = smoothstep(1.24, 0.98, p[2])           # 0 no peito, 1 na cintura e abaixo
            target = r + base
            if chest_r[ab] > 0:
                target = max(target, r + (chest_r[ab] * 0.985 - r) * 0.8 * hang + base)
            target += 0.004 * smoothstep(0.90, HEM_Z, p[2])  # barra levemente solta
            radial = np.array([p[0], yy, 0.0]) / (r + 1e-9)
            # perto do pescoço e no alto dos ombros o tecido segue a normal (não o eixo do tronco)
            shoulder_k = smoothstep(1.30, 1.40, p[2])
            dirv = radial * (1 - shoulder_k) + n * shoulder_k
            dirv /= np.linalg.norm(dirv) + 1e-9
            D[i] = dirv * (target - r) if shoulder_k < 1 else n * base
        # decote: folga menor para a gola encostar no pescoço
        if neck_dist[i] < 0.04:
            D[i] *= 0.55 + 0.45 * smoothstep(0.0, 0.04, neck_dist[i])
    # suaviza o campo de deslocamento como um pano (sem degraus entre regiões)
    for _ in range(25):
        D = 0.5 * D + 0.5 * np.array([D[nb].mean(axis=0) if nb else D[i] for i, nb in enumerate(nbrs)])
    P = P + D
    for v, p in zip(verts, P):
        v.co = p

    # Garantia: nada a menos de MIN_GAP da pele na pose de repouso.
    MIN_GAP = 0.006
    pushed = 0
    for v in verts:
        hit = BODY_BVH.find_nearest(v.co)
        if hit[0] is None:
            continue
        loc, nrm = hit[0], hit[1]
        d = (v.co - loc).dot(nrm)
        if d < MIN_GAP:
            v.co = loc + nrm * MIN_GAP
            pushed += 1
    smooth_normal = {v.index: Vector(n) for v, n in zip(verts, NRM)}
    bm.normal_update()
    print(f'[camisas] {kind}: {pushed} vértices empurrados para fora da pele')

    # 6) gola redonda em ribana: faixa estreita que sobe ~9 mm e encosta no pescoço
    neck_edges = [e for e in bm.edges if e.is_boundary and all(v.co.z > 1.25 and abs(v.co.x) < NECK_HALF for v in e.verts)]
    neck_pairs = [(e.verts[0], e.verts[1], e.link_faces[0]) for e in neck_edges]
    key = lambda co: (round(co.x, 6), round(co.y, 6), round(co.z, 6))  # noqa: E731
    edge_normals = {key(v.co): smooth_normal[v.index] for e in neck_edges for v in e.verts}
    res = bmesh.ops.extrude_edge_only(bm, edges=neck_edges)
    new_verts = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in new_verts:
        # sobe e chega um pouco mais perto do pescoço só na horizontal (não pela normal,
        # que na nuca aponta para cima/trás e enfiava a ribana na pele)
        to_axis = Vector((-v.co.x, NECK_Y - v.co.y, 0.0))
        if to_axis.length > 1e-6:
            to_axis.normalize()
        v.co += to_axis * 0.002 + Vector((0, 0, 0.009))
        hit = BODY_BVH.find_nearest(v.co)
        if hit[0] is not None and (v.co - hit[0]).dot(hit[1]) < 0.003:
            v.co = hit[0] + hit[1] * 0.003
    for f in {f for v in new_verts for f in v.link_faces}:
        f[part] = PART_COLLAR
    bm.verts.index_update()
    bm.normal_update()

    # ---------------------------------------------------------------- UV
    uv = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')
    a_dir = ARM_AXIS.normalized()
    o = (Vector((1, 0, 0)) - a_dir * a_dir.x).normalized()
    fw = a_dir.cross(o)
    if fw.y > 0:
        fw = -fw
    for f in bm.faces:
        p = f[part]
        if p == PART_COLLAR:
            us = [(math.atan2(l.vert.co.x, -(l.vert.co.y - NECK_Y)) + math.pi) / (2 * math.pi) for l in f.loops]
            if max(us) - min(us) > 0.5:
                us = [u + 1 if u < 0.5 else u for u in us]
            for loop, u in zip(f.loops, us):
                loop[uv].uv = (u, 0.028)
        elif p == PART_SLEEVE:
            side_off = 0.0 if f.calc_center_median().x > 0 else 0.5
            uls, vs = [], []
            for loop in f.loops:
                c = loop.vert.co
                q = Vector((abs(c.x), c.y, c.z)) - SHOULDER
                t = q.dot(ARM_AXIS) / ARM_LEN2
                d = q - a_dir * q.dot(a_dir)
                th = math.atan2(d.dot(fw), d.dot(o))
                uls.append((th + math.pi) / (2 * math.pi))
                vs.append(0.245 - (min(max(t, T0), t1) - T0) / (t1 - T0) * 0.21)
            if max(uls) - min(uls) > 0.5:
                low = sum(1 for u in uls if u < 0.5) < len(uls) / 2
                uls = [(u + 1 if u < 0.5 else u) if low else (u - 1 if u >= 0.5 else u) for u in uls]
            for loop, ul, vv in zip(f.loops, uls, vs):
                loop[uv].uv = (side_off + 0.05 + ul * 0.40, vv)
        else:
            # Pela posição (o centro do tronco fica em y ≈ 0): no fundo do V e no topo dos
            # ombros a normal não diz com segurança se a face é da frente ou das costas.
            back = f.calc_center_median().y > 0.0
            for loop in f.loops:
                c = loop.vert.co
                x = max(-W, min(W, c.x))
                u = 0.5 + (-x + W) / (2 * W) * 0.5 if back else (x + W) / (2 * W) * 0.5
                v = 0.25 + (min(max(c.z, Z0), Z1) - Z0) / (Z1 - Z0) * 0.75
                loop[uv].uv = (u, v)

    # Borda do decote no espaço UV (faces do tronco), para pintar a ribana.
    segs = []
    for a, b, f in neck_pairs:
        if f[part] != PART_TORSO:
            continue
        ua = next(l[uv].uv.copy() for l in f.loops if l.vert == a)
        ub = next(l[uv].uv.copy() for l in f.loops if l.vert == b)
        segs.append((ua.x, ua.y, ub.x, ub.y))
    NECK_SEGMENTS[kind] = np.array(segs, np.float32)

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    # Pesos de tecido: os do corpo, suavizados, para o pano não esticar como pele nos
    # ombros e na axila quando o braço sobe (até 4 ossos por vértice, normalizados).
    common.select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=6)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # 7) espessura só nas bordas (barra, mangas, gola), sem casca interna dupla
    common.select_only(obj)
    sol = obj.modifiers.new('Espessura', 'SOLIDIFY')
    sol.thickness = 0.0045
    sol.offset = -1.0
    sol.use_rim = True
    sol.use_rim_only = True
    bpy.ops.object.modifier_move_to_index(modifier=sol.name, index=0)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'[camisas] {obj.name}: {len(obj.data.vertices)} vértices, {tris} triângulos, {len(segs)} segmentos no decote')
    return obj


shells = {k: build_shell(k) for k in SHELLS}

# ------------------------------------------------------------------ pintura das texturas
SS = 2                 # supersampling
N = 1024 * SS
uu = (np.arange(N) + 0.5) / N
U, V = np.meshgrid(uu, uu)          # linha 0 = v perto de 0 (embaixo, como o Blender guarda)


def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


BLACK, WHITE = '#161616', '#f3f3f1'

m_torso = V >= 0.25
m_sleeve = (V >= 0.03125) & (V < 0.25)
m_collar = V < 0.03125
back = U >= 0.5
TX = np.where(back, -(((U - 0.5) / 0.5) * 2 * W - W), (U / 0.5) * 2 * W - W)
TZ = Z0 + (V - 0.25) / 0.75 * (Z1 - Z0)
sl_left = U < 0.5
UL = np.where(sl_left, (U - 0.05) / 0.40, (U - 0.55) / 0.40)
TH = UL * 2 * math.pi - math.pi      # 0 = lado de fora do braço
# t ao longo do braço em cada pixel da faixa da manga: depende do modelo (manga longa
# ocupa a mesma faixa do atlas, de T0 até 1,0). As funções de pintura leem o ST e o
# CUR_SLEEVE_T globais, definidos antes de pintar cada peça.
ST_BY = {k: T0 + (0.245 - V) / 0.21 * (s['t1'] - T0) for k, s in SHELLS.items()}
ST = ST_BY['crew']
CUR_SLEEVE_T = SLEEVE_T
# Altura aproximada (z do corpo) de cada pixel da manga, para listras horizontais que
# continuam as do tronco através da costura raglan (raio médio da manga ~5,5 cm).
_a = ARM_AXIS.normalized()
_o = (Vector((1, 0, 0)) - _a * _a.x).normalized()
_fw = _a.cross(_o)
if _fw.y > 0:
    _fw = -_fw
SZ_BY = {k: SHOULDER.z + ARM_AXIS.z * st + (_o.z * np.cos(TH) + _fw.z * np.sin(TH)) * 0.055 for k, st in ST_BY.items()}
SZ = SZ_BY['crew']
CU = U
CV = V / 0.03125


def solid(shape, col):
    out = np.empty(shape + (3,), np.float32)
    out[...] = hexc(col)
    return out


def stripes(coord, seq, center=0.0):
    """Listras periódicas; o primeiro item fica centrado em `center`."""
    widths = np.array([w for _, w in seq])
    period = widths.sum()
    q = (coord - center + widths[0] / 2) % period
    edges = np.cumsum(widths)
    idx = np.minimum(np.searchsorted(edges, q, side='right'), len(seq) - 1)
    cols = np.stack([hexc(c) for c, _ in seq])
    return cols[idx]


def paint(img, mask, col):
    img[mask] = hexc(col) if isinstance(col, str) else col[mask] if col.ndim == img.ndim else col


def angdist(a, b):
    return np.abs((a - b + math.pi) % (2 * math.pi) - math.pi)


def bands(coord, seq, start):
    """Faixas a partir de `start` (lista de (cor, largura)); devolve máscara e cores."""
    out = np.zeros(coord.shape + (3,), np.float32)
    m = np.zeros(coord.shape, bool)
    pos = start
    for col, w in seq:
        sel = (coord >= pos) & (coord < pos + w)
        out[sel] = hexc(col)
        m |= sel
        pos += w
    return m, out


def chevron(x, z, amount=0.06, size=0.07):
    return 1 - amount * ((((z + np.abs(x) * 0.9) / size) % 1.0) < 0.5)


# ----- escudos genéricos (desenhos próprios; nada de logotipos oficiais)
def shield_poly(n=48):
    pts = []
    for i in range(n + 1):
        lx = -1 + 2 * i / n
        pts.append((lx, 1.0 - 0.14 * (1 - abs(lx))))            # topo com chanfro
    for i in range(n + 1):
        a = i / n
        lz = -0.25 - a * 1.0
        pts.append((1 - a ** 1.6, lz))                          # lateral até a ponta
    pts2 = [(-x, z) for x, z in reversed(pts[n + 1:])]
    return pts[:n + 1] + pts[n + 1:] + pts2


def star_poly(r_out=1.0, r_in=0.42, rot=math.pi / 2):
    return [((r_out if i % 2 == 0 else r_in) * math.cos(rot + i * math.pi / 5), (r_out if i % 2 == 0 else r_in) * math.sin(rot + i * math.pi / 5)) for i in range(10)]


def inside(px, py, poly):
    res = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > py) != (y2 > py)
        xin = (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1
        res ^= cond & (px < xin)
    return res


SHIELD = shield_poly()


def crest(img, spec):
    """Desenha o escudo na frente do tronco (coordenadas do corpo)."""
    cx, cz, s = spec.get('pos', (0.085, 1.31, 0.036))
    fm = m_torso & ~back & (np.abs(TX - cx) < s * 1.8) & (np.abs(TZ - cz) < s * 2.6)
    lx = (TX[fm] - cx) / s
    lz = (TZ[fm] - cz) / s
    outer = inside(lx, lz, SHIELD)
    inner = inside(lx / 0.8, (lz + 0.03) / 0.82, SHIELD)
    sub = img[fm]
    sub[outer] = hexc(spec['outline'])
    fill = spec['fill']
    kind = fill[0]
    if kind == 'solid':
        sub[inner] = hexc(fill[1])
    elif kind == 'vstripes':
        cols = fill[1]
        k = np.floor((lx + 0.8) / 1.6 * len(cols)).astype(int).clip(0, len(cols) - 1)
        st = np.stack([hexc(c) for c in cols])[k]
        sub[inner] = st[inner]
    elif kind == 'hbands':
        cols = fill[1]
        k = np.floor((1.0 - lz) / 2.2 * len(cols)).astype(int).clip(0, len(cols) - 1)
        st = np.stack([hexc(c) for c in cols])[k]
        sub[inner] = st[inner]
    elif kind == 'quarters':          # topo dividido em duas cores, base de outra
        top_l, top_r, bottom = fill[1]
        sub[inner & (lz > 0.05) & (lx < 0)] = hexc(top_l)
        sub[inner & (lz > 0.05) & (lx >= 0)] = hexc(top_r)
        sub[inner & (lz <= 0.05)] = hexc(bottom)
        bar = inner & (np.abs(lx) < 0.12) & (lz < 0.05) & (lz > -0.75)
        sub[bar] = hexc(top_l)
    for st in spec.get('stars', []):
        sx, sz, sr, col = st
        sub[inside((lx - sx) / sr, (lz - sz) / sr, star_poly())] = hexc(col)
    img[fm] = sub


KNIT_FREQ = 1024 * 2 * math.pi / 6     # trama com período de ~6 px na textura final


def knit_pattern():
    return 0.5 + 0.5 * np.sin(U * KNIT_FREQ) * np.sin(V * KNIT_FREQ)


def knit(img, amount=0.035):
    """Trama do tecido esportivo (bem sutil na cor)."""
    img *= (1 - amount * knit_pattern())[..., None]


# ----- cada camisa: tronco(x, z, costas), manga(t, θ), gola(u, v), escudo
def cuffs(seq):
    """Punho: faixas a partir do fim da manga, em unidades de t."""
    total = sum(w for _, w in seq)
    return bands(ST, list(reversed(seq)), CUR_SLEEVE_T - total)


def jersey_atletico(img):
    paint(img, m_torso, stripes(TX, [(WHITE, 0.044), (BLACK, 0.044)]))
    sl = solid(ST.shape, BLACK)
    sl[angdist(TH, 0.0) < 0.32] = hexc(WHITE)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(BLACK, 0.012), (WHITE, 0.01), (BLACK, 0.014)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(BLACK, 0.4), (WHITE, 0.2), (BLACK, 0.4)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': BLACK, 'fill': ('vstripes', [WHITE, BLACK, WHITE, BLACK, WHITE])})


def jersey_cruzeiro(img):
    blue = '#1d3fc2'
    t = solid(TX.shape, blue) * chevron(TX, TZ, 0.07)[..., None]
    paint(img, m_torso, t)
    sl = solid(ST.shape, blue) * chevron(TH * 0.05, ST * 0.5, 0.07)[..., None]
    for a in (-0.42, 0.0, 0.42):
        sl[angdist(TH, a) < 0.1] = hexc(WHITE)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(WHITE, 0.03)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, WHITE)
    stars = [(0.0, 0.42, 0.2, WHITE), (-0.38, 0.0, 0.17, WHITE), (0.38, 0.0, 0.17, WHITE), (0.0, -0.4, 0.17, WHITE), (0.12, -0.05, 0.08, WHITE)]
    crest(img, {'outline': WHITE, 'fill': ('solid', blue), 'stars': stars})


def jersey_sao_paulo(img):
    t = solid(TX.shape, WHITE)
    red, black = '#d01d24', BLACK
    t[(TZ > 1.268) & (TZ < 1.305)] = hexc(red)
    t[(TZ > 1.205) & (TZ < 1.242)] = hexc(black)
    paint(img, m_torso, t)
    paint(img, m_sleeve, WHITE)
    cm, cc = cuffs([(red, 0.01), (WHITE, 0.006), (black, 0.01), (WHITE, 0.006)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(WHITE, 0.35), (red, 0.25), (black, 0.25), (WHITE, 0.15)], 0)
    paint(img, m_collar, col)
    crest(img, {'pos': (0.0, 1.255, 0.042), 'outline': black, 'fill': ('quarters', (red, black, WHITE))})


def jersey_santos(img):
    t = solid(TX.shape, WHITE)
    t *= (1 - 0.035 * (((TX / 0.035) % 1.0) < 0.5))[..., None]   # listras tom sobre tom
    t[(np.abs(TX) > 0.150) & (np.abs(TX) < 0.178)] = hexc(BLACK)
    paint(img, m_torso, t)
    sl = solid(ST.shape, WHITE)
    sl[(angdist(TH, -0.55) < 0.05) | (angdist(TH, 0.55) < 0.05)] = hexc(BLACK)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(BLACK, 0.01), (WHITE, 0.008), (BLACK, 0.01)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(BLACK, 0.45), (WHITE, 0.2), (BLACK, 0.35)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': BLACK, 'fill': ('vstripes', [BLACK, WHITE, BLACK, WHITE, BLACK]), 'stars': [(0.0, 1.45, 0.22, BLACK)]})


def jersey_palmeiras(img):
    green = '#0f5b38'
    t = solid(TX.shape, green) * chevron(TX, TZ, 0.08)[..., None]
    t[(np.abs(TX) > 0.166) & (np.abs(TX) < 0.174)] = hexc(WHITE)
    paint(img, m_torso, t)
    paint(img, m_sleeve, solid(ST.shape, green))
    cm, cc = cuffs([(WHITE, 0.009), (green, 0.006), (WHITE, 0.009)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(WHITE, 0.4), (green, 0.2), (WHITE, 0.4)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': WHITE, 'fill': ('vstripes', [WHITE, green, WHITE, green, WHITE]), 'stars': [(0.0, 1.45, 0.22, WHITE)]})


def jersey_flamengo(img):
    red, black = '#d0151c', BLACK
    paint(img, m_torso, stripes(TZ, [(red, 0.075), (black, 0.075)], center=1.43))
    paint(img, m_sleeve, stripes(SZ, [(red, 0.075), (black, 0.075)], center=1.43))
    cm, cc = cuffs([(black, 0.02)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, black)
    crest(img, {'outline': WHITE, 'fill': ('hbands', [red, black, red, black, red])})


def jersey_bahia(img):
    blue, red = '#1f4fd6', '#d81e2a'
    t = solid(TX.shape, WHITE)
    front = ~back
    t[front & (TX > 0.040) & (TX < 0.066)] = hexc(blue)
    t[front & (TX > 0.068) & (TX < 0.086)] = hexc(red)
    paint(img, m_torso, t)
    sl = solid(ST.shape, WHITE)
    sl[angdist(TH, -0.08) < 0.07] = hexc(blue)
    sl[angdist(TH, 0.08) < 0.06] = hexc(red)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(blue, 0.01), (WHITE, 0.006), (red, 0.01)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(blue, 0.6), (red, 0.25), (WHITE, 0.15)], 0)
    paint(img, m_collar, col)
    gold = '#e3b53a'
    crest(img, {'pos': (0.07, 1.30, 0.036), 'outline': blue, 'fill': ('vstripes', [blue, WHITE, red, WHITE, blue]),
                'stars': [(-0.45, 1.45, 0.16, gold), (0.0, 1.5, 0.16, gold), (0.45, 1.45, 0.16, gold)]})


def jersey_gremio(img):
    blue = '#3a8fe6'
    paint(img, m_torso, stripes(TX, [(BLACK, 0.046), (WHITE, 0.008), (blue, 0.046), (WHITE, 0.008)]))
    sl = solid(ST.shape, blue)
    sl[angdist(TH, 0.0) < 0.2] = hexc(BLACK)
    sl[(angdist(TH, 0.0) >= 0.2) & (angdist(TH, 0.0) < 0.26)] = hexc(WHITE)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(BLACK, 0.012), (WHITE, 0.008), (BLACK, 0.012)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(WHITE, 0.45), (BLACK, 0.3), (WHITE, 0.25)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': BLACK, 'fill': ('vstripes', [blue, BLACK, blue, BLACK, blue])})


def jersey_fluminense(img):
    green, grena = '#0f6b3d', '#7d1a26'
    paint(img, m_torso, stripes(TX, [(green, 0.046), (WHITE, 0.008), (grena, 0.046), (WHITE, 0.008)]))
    sl = stripes(TH, [(grena, 0.5), (WHITE, 0.08), (green, 0.5), (WHITE, 0.08)])
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(WHITE, 0.008), (grena, 0.012), (WHITE, 0.008)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(WHITE, 0.4), (grena, 0.2), (green, 0.2), (WHITE, 0.2)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': WHITE, 'fill': ('hbands', [green, WHITE, grena])})


def jersey_botafogo(img):
    paint(img, m_torso, stripes(TX, [(BLACK, 0.042), (WHITE, 0.042)]))
    sl = solid(ST.shape, WHITE)
    for a in (-0.5, 0.0, 0.5):
        sl[angdist(TH, a) < 0.13] = hexc(BLACK)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(BLACK, 0.01), (WHITE, 0.008), (BLACK, 0.012)])
    paint(img, m_sleeve & cm, cc)
    _, col = bands(CV, [(BLACK, 0.4), (WHITE, 0.25), (BLACK, 0.35)], 0)
    paint(img, m_collar, col)
    crest(img, {'outline': WHITE, 'fill': ('solid', BLACK), 'stars': [(0.0, 0.05, 0.5, WHITE)]})


# ----- marcas fictícias "Mike" e "Adimas" ------------------------------------------------
# Logotipos e letreiros originais, inspirados na linguagem visual do streetwear esportivo,
# sem reproduzir símbolos reais (nada de "swoosh", trevo ou três listras):
#   MIKE   — "Onda-M": uma fita contínua, fina nas pontas e cheia no meio, que desenha um
#            M inclinado para a frente (fluidez e velocidade); letreiro em fonte black itálica.
#   ADIMAS — "Losango cortado": losango com duas listras diagonais vazadas; a linha usa
#            sempre DUAS listras paralelas; letreiro em fonte black reta e espaçada.
# Texto e logos são rasterizados com antisserrilhado (fonte de verdade, via objeto de texto
# do Blender convertido em triângulos) e carimbados no atlas com mistura alfa.
FONT_DIR = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts')
FONT_MIKE = 'seguibli.ttf'      # Segoe UI Black Italic
FONT_ADIMAS = 'ariblk.ttf'      # Arial Black
FONT_NUMBER = 'impact.ttf'


def load_font(name):
    path = os.path.join(FONT_DIR, name)
    if os.path.exists(path):
        return bpy.data.fonts.load(path, check_existing=True)
    print(f'[camisas] aviso: fonte {name} não encontrada, usando a padrão do Blender')
    return None


def text_tris(text, fontfile, spacing=1.0):
    """Triângulos (n, 3, 2) do texto preenchido, em unidades do Blender (altura ~1)."""
    cu = bpy.data.curves.new('letreiro', 'FONT')
    cu.body = text
    f = load_font(fontfile)
    if f:
        cu.font = f
    cu.space_character = spacing
    cu.resolution_u = 16
    ob = bpy.data.objects.new('letreiro', cu)
    bpy.context.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    co = np.array([v.co[:2] for v in me.vertices], np.float64)
    tris = co[np.array([t.vertices[:] for t in me.loop_triangles], np.int64)]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return tris


class Mask:
    """Máscara alfa (0..1) com a caixa do desenho; carimbada no atlas por amostragem bilinear."""

    def __init__(self, alpha, aspect, pad=0.0):
        self.alpha = alpha
        self.aspect = aspect  # largura / altura (com a margem)
        self.pad = pad        # margem em volta do desenho, em fração do tamanho dele

    def sample(self, lx, lz):
        h, w = self.alpha.shape
        fx = np.clip(lx * (w - 1), 0, w - 1.001)
        fz = np.clip(lz * (h - 1), 0, h - 1.001)
        x0 = fx.astype(int)
        z0 = fz.astype(int)
        tx = fx - x0
        tz = fz - z0
        a = self.alpha
        s = (a[z0, x0] * (1 - tx) * (1 - tz) + a[z0, x0 + 1] * tx * (1 - tz) + a[z0 + 1, x0] * (1 - tx) * tz + a[z0 + 1, x0 + 1] * tx * tz)
        inside_box = (lx >= 0) & (lx <= 1) & (lz >= 0) & (lz <= 1)
        return np.where(inside_box, s, 0.0)

    def dilated(self, px):
        """Contorno: a máscara engordada `px` pixels (para letreiro com borda)."""
        a = self.alpha
        out = a.copy()
        for dz in range(-px, px + 1):
            for dx in range(-px, px + 1):
                if dx * dx + dz * dz <= px * px:
                    out = np.maximum(out, np.roll(np.roll(a, dz, 0), dx, 1))
        return Mask(out, self.aspect, self.pad)


def mask_from_tris(tris, res=640, pad=0.18):
    lo = tris.reshape(-1, 2).min(0)
    hi = tris.reshape(-1, 2).max(0)
    size = hi - lo
    lo = lo - size * pad
    size = size * (1 + 2 * pad)
    aspect = size[0] / size[1]
    H = res
    Wd = max(8, int(round(res * aspect)))
    ss = 3
    Hs, Ws = H * ss, Wd * ss
    acc = np.zeros((Hs, Ws), bool)
    P = (tris - lo) / size * np.array([Ws - 1, Hs - 1])
    for tri in P:
        x0, y0 = np.floor(tri.min(0)).astype(int)
        x1, y1 = np.ceil(tri.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, Ws - 1), min(y1, Hs - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = tri
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        m = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
        acc[y0:y1 + 1, x0:x1 + 1] |= m
    alpha = acc.reshape(H, ss, Wd, ss).mean(axis=(1, 3))
    return Mask(alpha, aspect, pad)


def mask_from_polys(polys, holes=(), res=256, pad=0.12, extra=()):
    """Máscara de polígonos (lista de listas de pontos), com furos opcionais; `extra` são
    polígonos desenhados depois dos furos (por cima)."""
    allp = np.array([p for poly in list(polys) + list(extra) for p in poly], np.float64)
    lo, hi = allp.min(0), allp.max(0)
    size = hi - lo
    lo = lo - size * pad
    size = size * (1 + 2 * pad)
    aspect = size[0] / size[1]
    ss = 3
    Hs = res * ss
    Ws = max(8, int(round(res * aspect))) * ss
    gx, gy = np.meshgrid((np.arange(Ws) + 0.5) / Ws, (np.arange(Hs) + 0.5) / Hs)
    px = lo[0] + gx * size[0]
    py = lo[1] + gy * size[1]
    m = np.zeros(px.shape, bool)
    for poly in polys:
        m |= inside(px, py, poly)
    for poly in holes:
        m &= ~inside(px, py, poly)
    for poly in extra:
        m |= inside(px, py, poly)
    alpha = m.reshape(res, ss, Ws // ss, ss).mean(axis=(1, 3))
    return Mask(alpha, aspect, pad)


def ribbon_poly(ctrl, w_min, w_max, samples=80, power=0.9):
    """Fita com largura variável (fina nas pontas) ao longo de uma Catmull-Rom."""
    pts = np.array(ctrl, np.float64)
    ext = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    curve = []
    nseg = len(pts) - 1
    for i in range(samples + 1):
        s = i / samples * nseg
        k = min(int(s), nseg - 1)
        t = s - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        t2, t3 = t * t, t * t * t
        curve.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    curve = np.array(curve)
    tang = np.gradient(curve, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-12
    nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
    s = np.linspace(0, 1, len(curve))
    w = w_min + (w_max - w_min) * np.sin(np.pi * s) ** power
    left = curve + nrm * w[:, None] / 2
    right = curve - nrm * w[:, None] / 2
    return [tuple(p) for p in left] + [tuple(p) for p in right[::-1]]


def ribbon_quads(ctrl, w_min, w_max, samples=90, power=0.9):
    """A mesma fita como união de quadriláteros (sem furos onde a curva se dobra)."""
    poly = ribbon_poly(ctrl, w_min, w_max, samples, power)
    n = len(poly) // 2
    left, right = poly[:n], poly[n:][::-1]
    return [[left[i], left[i + 1], right[i + 1], right[i]] for i in range(n - 1)]


# Símbolos (geometria própria).
# MIKE: fita única que desenha um M inclinado, fina nas pontas e cheia no meio.
MIKE_WAVE = mask_from_polys(ribbon_quads([(0.0, 0.08), (0.2, 0.9), (0.42, 0.4), (0.64, 0.98), (1.0, 0.36)], 0.03, 0.2))
# ADIMAS: losango vazado (contorno) com duas barras diagonais paralelas dentro.
_D = [(0.5, 0.0), (1.0, 0.5), (0.5, 1.0), (0.0, 0.5)]
_DI = [(0.5, 0.15), (0.85, 0.5), (0.5, 0.85), (0.15, 0.5)]
_BARS = [[(0.30 + o, 0.36 - o), (0.38 + o, 0.28 - o), (0.70 + o, 0.60 - o), (0.62 + o, 0.68 - o)] for o in (-0.06, 0.06)]
ADIMAS_DIAMOND = mask_from_polys([[(x * 1.2, y) for x, y in _D]], holes=[[(x * 1.2, y) for x, y in _DI]],
                                 extra=[[(x * 1.2, y) for x, y in b] for b in _BARS])

_WORD_CACHE = {}


def wordmark(text, font, spacing=1.0):
    key = (text, font, spacing)
    if key not in _WORD_CACHE:
        _WORD_CACHE[key] = mask_from_tris(text_tris(text, font, spacing))
    return _WORD_CACHE[key]


def stamp(img, mask, cx, cz, height, col, side='front', region=None):
    """Carimba a máscara centrada em (cx, cz) (metros do corpo) na frente ou nas costas."""
    sel = (m_torso if region is None else region) & ((~back) if side == 'front' else back)
    ax = TX if side == 'front' else -TX       # nas costas o texto corre para −x (lido de fora)
    height = height * (1 + 2 * mask.pad)      # height é a altura do desenho, sem a margem
    w = height * mask.aspect
    box = sel & (np.abs(ax - cx) < w / 2 + 0.002) & (np.abs(TZ - cz) < height / 2 + 0.002)
    lx = (ax[box] - (cx - w / 2)) / w
    lz = (TZ[box] - (cz - height / 2)) / height
    a = mask.sample(lx, lz)[:, None]
    sub = img[box]
    c = hexc(col) if isinstance(col, str) else col
    img[box] = sub * (1 - a) + c * a


def stamp_outlined(img, mask, cx, cz, height, col, outline_col, outline_m=0.0045, side='front'):
    """Letreiro/número com contorno de espessura fixa em metros (como numeração de camisa)."""
    px = max(2, int(round(outline_m / (height * (1 + 2 * mask.pad)) * mask.alpha.shape[0])))
    stamp(img, mask.dilated(px), cx, cz, height, outline_col, side)
    stamp(img, mask, cx, cz, height, col, side)


def stamp_sleeve(img, mask, th, st, height, col):
    """Carimba nas duas mangas, centrado no ângulo `th` (0 = lado de fora) e no t `st`."""
    rho = 0.058
    arm_len = math.sqrt(ARM_LEN2)
    height = height * (1 + 2 * mask.pad)
    w = height * mask.aspect
    sel = m_sleeve & (np.abs(angdist(TH, th) * rho) < w / 2 + 0.002) & (np.abs((ST - st) * arm_len) < height / 2 + 0.002)
    d_th = (TH[sel] - th + math.pi) % (2 * math.pi) - math.pi
    left = sl_left[sel]
    # nas duas mangas o desenho é lido de fora: na esquerda o ângulo cresce para a frente
    lx = np.where(left, -d_th, d_th) * rho / w + 0.5
    lz = 0.5 - (ST[sel] - st) * arm_len / height
    a = mask.sample(lx, lz)[:, None]
    c = hexc(col)
    img[sel] = img[sel] * (1 - a) + c * a


def paint_alpha(img, mask_bool_or_alpha, col):
    a = mask_bool_or_alpha.astype(np.float32)[..., None]
    img[:] = img * (1 - a) + hexc(col) * a


def soft(x, w=0.002):
    """Borda suave (antisserrilhado) para recortes em metros: 0 → 1 em torno de x = 0."""
    return np.clip(0.5 + x / w, 0, 1)


def two_stripes_sleeve(img, col, th=0.0, w=0.011, gap=0.011):
    """Duas listras paralelas do ombro ao fim da manga, no lado de fora (marca Adimas)."""
    rho = 0.058
    for k in (-1, 1):
        c = th + k * (gap / 2 + w / 2) / rho
        d = angdist(TH, c) * rho
        paint_alpha(img, m_sleeve * soft(w / 2 - d), col)


def two_stripes_side(img, col, w=0.012, gap=0.012, z_top=1.30):
    """Duas listras nas laterais do tronco, da cava até a barra."""
    for s in (1, -1):
        for k in (-1, 1):
            x_c = s * (0.205 + k * (gap / 2 + w / 2))
            d = np.abs(TX - x_c)
            paint_alpha(img, m_torso * soft(w / 2 - d) * soft(z_top - TZ), col)


def tonal(img, region, amount=0.05, freq=55.0, angle=0.5):
    """Textura tonal sutil (linhas diagonais finas) para dar acabamento técnico ao tecido."""
    u = TX * math.cos(angle) + TZ * math.sin(angle)
    k = 1 - amount * (0.5 + 0.5 * np.sin(u * freq * 2 * math.pi))
    img[region] *= k[region][..., None]


def neck_tape(img, col, text, font, txt_col):
    """Fita da nuca com o nome da marca (detalhe de acabamento)."""
    zone = m_torso & back & (np.abs(TX) < 0.045) & (np.abs(TZ - 1.405) < 0.009)
    img[zone] = hexc(col)
    stamp(img, wordmark(text, font), 0.0, 1.405, 0.011, txt_col, side='back')


# ------------------------------- linha MIKE -------------------------------
def mike_tee_wave(img):
    black = '#121214'
    paint(img, m_torso, solid(TX.shape, black))
    paint(img, m_sleeve, solid(ST.shape, black))
    cm, cc = cuffs([(black, 0.025)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, black)
    stamp(img, MIKE_WAVE, 0.0, 1.27, 0.115, WHITE)
    stamp(img, wordmark('MIKE', FONT_MIKE, 0.95), 0.0, 1.16, 0.042, WHITE)
    stamp(img, MIKE_WAVE, 0.0, 1.33, 0.05, WHITE, side='back')
    stamp_sleeve(img, MIKE_WAVE, 0.0, 0.22, 0.03, '#ff4b3a')
    neck_tape(img, '#ff4b3a', 'MIKE', FONT_MIKE, WHITE)


def mike_tee_sport(img):
    red, white, black = '#e3262f', '#f4f4f2', '#141416'
    paint(img, m_torso, solid(TX.shape, white))
    paint(img, m_sleeve, solid(ST.shape, white))
    # faixa de velocidade curva atravessando o peito (vermelha com fio preto)
    curve = TZ - (1.16 + 0.14 * TX + 0.25 * TX * TX)
    paint_alpha(img, m_torso * soft(0.028 - np.abs(curve)), red)
    paint_alpha(img, m_torso * soft(0.003 - np.abs(curve + 0.034)), black)
    cm, cc = cuffs([(red, 0.012), (white, 0.006), (black, 0.01)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, black)
    stamp(img, MIKE_WAVE, 0.075, 1.33, 0.045, red)
    stamp(img, wordmark('MIKE', FONT_MIKE, 0.95), 0.0, 1.31, 0.06, black, side='back')
    stamp(img, MIKE_WAVE, 0.0, 1.22, 0.08, red, side='back')
    neck_tape(img, black, 'MIKE', FONT_MIKE, white)


def mike_long_tech(img):
    navy, graphite, volt = '#1a2238', '#33373f', '#c8ff2e'
    t = solid(TX.shape, navy)
    # painéis curvos nas laterais (grafite) com fio neon na emenda
    side = np.abs(TX) - (0.13 + 0.06 * np.cos((TZ - 0.85) * 4.0))
    t = t * (1 - soft(side, 0.003)[..., None]) + hexc(graphite) * soft(side, 0.003)[..., None]
    paint(img, m_torso, t)
    paint_alpha(img, m_torso * soft(0.0022 - np.abs(side)), volt)
    tonal(img, m_torso, 0.035, 70, 0.9)
    sl = solid(ST.shape, navy)
    under = np.cos(TH) < -0.2            # lado de dentro da manga em grafite
    sl[under] = hexc(graphite)
    paint(img, m_sleeve, sl)
    cm, cc = cuffs([(graphite, 0.06)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, graphite)
    stamp(img, MIKE_WAVE, 0.08, 1.33, 0.042, volt)
    stamp(img, wordmark('MIKE', FONT_MIKE, 0.95), 0.0, 1.32, 0.05, WHITE, side='back')
    stamp_sleeve(img, wordmark('MIKE', FONT_MIKE, 0.95), 0.0, 0.62, 0.028, volt)
    neck_tape(img, volt, 'MIKE', FONT_MIKE, navy)


def mike_tank(img):
    red, black, white = '#d0121b', '#121214', '#f4f4f2'
    paint(img, m_torso, solid(TX.shape, red))
    # laterais pretas com fio branco
    side = np.abs(TX) - 0.165
    paint_alpha(img, m_torso * soft(side, 0.003), black)
    paint_alpha(img, m_torso * soft(0.0025 - np.abs(side)), white)
    armhole_trim(img, black)
    hem_band(img, black, 0.018)
    paint(img, m_collar, black)
    word = wordmark('MIKE', FONT_MIKE, 0.95)
    stamp_outlined(img, word, 0.0, 1.255, 0.06, white, black)
    num = wordmark('7', FONT_NUMBER)
    stamp_outlined(img, num, 0.0, 1.12, 0.12, white, black)
    stamp_outlined(img, num, 0.0, 1.18, 0.17, white, black, side='back')
    stamp(img, MIKE_WAVE, 0.0, 1.37, 0.035, white, side='back')


# ------------------------------- linha ADIMAS ------------------------------
def adimas_tee_classic(img):
    white, black = '#f4f4f2', '#141416'
    paint(img, m_torso, solid(TX.shape, white))
    paint(img, m_sleeve, solid(ST.shape, white))
    two_stripes_sleeve(img, black)
    cm, cc = cuffs([(black, 0.014)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, black)
    stamp(img, ADIMAS_DIAMOND, 0.0, 1.27, 0.1, black)
    stamp(img, wordmark('ADIMAS', FONT_ADIMAS, 1.05), 0.0, 1.17, 0.032, black)
    neck_tape(img, black, 'ADIMAS', FONT_ADIMAS, white)


def adimas_tee_street(img):
    black, gold, white = '#121214', '#e1b54a', '#f4f4f2'
    paint(img, m_torso, solid(TX.shape, black))
    paint(img, m_sleeve, solid(ST.shape, black))
    two_stripes_sleeve(img, gold)
    cm, cc = cuffs([(black, 0.02)])
    paint(img, m_sleeve & cm, cc)
    paint(img, m_collar, black)
    stamp(img, ADIMAS_DIAMOND, 0.078, 1.33, 0.04, gold)
    word = wordmark('ADIMAS', FONT_ADIMAS, 1.05)
    stamp(img, word, 0.0, 1.32, 0.045, white, side='back')
    stamp(img, ADIMAS_DIAMOND, 0.0, 1.2, 0.13, gold, side='back')
    neck_tape(img, gold, 'ADIMAS', FONT_ADIMAS, black)


def adimas_long_track(img):
    navy, white, red = '#14204a', '#f4f4f2', '#c8202a'
    t = solid(TX.shape, navy)
    t[TZ > 1.30] = hexc('#0e1736')
    paint(img, m_torso, t)
    paint_alpha(img, m_torso * soft(0.0025 - np.abs(TZ - 1.30)), red)
    tonal(img, m_torso, 0.025, 60, -0.6)
    paint(img, m_sleeve, solid(ST.shape, navy))
    two_stripes_sleeve(img, white, w=0.012, gap=0.012)
    two_stripes_side(img, white)
    cm, cc = cuffs([(white, 0.01), (navy, 0.05)])
    paint(img, m_sleeve & cm, cc)
    hem_band(img, '#0e1736', 0.03)
    paint(img, m_collar, white)
    stamp(img, ADIMAS_DIAMOND, 0.08, 1.335, 0.04, white)
    stamp(img, wordmark('ADIMAS', FONT_ADIMAS, 1.05), 0.0, 1.335, 0.04, white, side='back')
    neck_tape(img, red, 'ADIMAS', FONT_ADIMAS, white)


def adimas_tank(img):
    white, blue, navy = '#f4f4f2', '#1f4fd6', '#14204a'
    paint(img, m_torso, solid(TX.shape, white))
    two_stripes_side(img, blue, w=0.014, gap=0.012, z_top=1.36)
    armhole_trim(img, blue)
    hem_band(img, blue, 0.018)
    paint(img, m_collar, blue)
    stamp(img, wordmark('ADIMAS', FONT_ADIMAS, 1.05), 0.0, 1.26, 0.04, navy)
    num = wordmark('10', FONT_NUMBER)
    stamp_outlined(img, num, 0.0, 1.13, 0.11, blue, navy)
    stamp_outlined(img, num, 0.0, 1.18, 0.16, blue, navy, side='back')
    stamp(img, ADIMAS_DIAMOND, 0.0, 1.375, 0.03, navy, side='back')


# ------------------------------- acabamento comum ---------------------------
def hem_band(img, col, h=0.03):
    paint(img, m_torso & (TZ < HEM_Z + h), col)


def armhole_trim(img, col, w=0.012):
    """Viés na cava da regata (distância ao plano da cava, só do lado de dentro)."""
    nl = math.hypot(*RAGLAN_N)
    d = ((np.abs(TX) - TANK_P[0]) * RAGLAN_N[0] + (TZ - TANK_P[1]) * RAGLAN_N[1]) / nl
    paint_alpha(img, m_torso * soft(d + w) * soft(0.002 - d), col)


def team_back(img, number_col, outline_col, name='QUEBRADA', num='10'):
    """Costas das camisas de time: nome e número em fonte de numeração esportiva."""
    nm = wordmark(name, FONT_NUMBER, 1.08)
    stamp_outlined(img, nm, 0.0, 1.335, 0.032, number_col, outline_col, outline_m=0.0022, side='back')
    n = wordmark(num, FONT_NUMBER)
    stamp_outlined(img, n, 0.0, 1.18, 0.16, number_col, outline_col, side='back')


JERSEYS = [
    ('jersey_atletico_mg', 'crew', jersey_atletico),
    ('jersey_cruzeiro', 'crew', jersey_cruzeiro),
    ('jersey_sao_paulo', 'crew', jersey_sao_paulo),
    ('jersey_santos', 'crew', jersey_santos),
    ('jersey_palmeiras', 'crew', jersey_palmeiras),
    ('jersey_flamengo', 'crew', jersey_flamengo),
    ('jersey_bahia', 'crew', jersey_bahia),
    ('jersey_gremio', 'crew', jersey_gremio),
    ('jersey_fluminense', 'crew', jersey_fluminense),
    ('jersey_botafogo', 'crew', jersey_botafogo),
    ('mike_tee_wave', 'crew', mike_tee_wave),
    ('mike_tee_sport', 'crew', mike_tee_sport),
    ('mike_long_tech', 'long', mike_long_tech),
    ('mike_tank', 'tank', mike_tank),
    ('adimas_tee_classic', 'crew', adimas_tee_classic),
    ('adimas_tee_street', 'crew', adimas_tee_street),
    ('adimas_long_track', 'long', adimas_long_track),
    ('adimas_tank', 'tank', adimas_tank),
]

# Costas das camisas de time: cor do nome/número e do contorno (combinando com cada camisa).
TEAM_BACK = {
    'jersey_atletico_mg': (WHITE, BLACK),
    'jersey_cruzeiro': (WHITE, '#0d2e7d'),
    'jersey_sao_paulo': (BLACK, '#d01d24'),
    'jersey_santos': (BLACK, '#c9c9c4'),
    'jersey_palmeiras': (WHITE, '#06331f'),
    'jersey_flamengo': (WHITE, BLACK),
    'jersey_bahia': ('#1f4fd6', '#d81e2a'),
    'jersey_gremio': (WHITE, BLACK),
    'jersey_fluminense': (WHITE, '#5a121c'),
    'jersey_botafogo': (WHITE, BLACK),
}


def collar_band(img, collar):
    """Ribana: repete o perfil da faixa da gola numa tira que acompanha a borda do decote.
    A distância é medida no espaço UV do tronco, que tem quase a mesma escala em metros
    nos dois eixos (u: 4W m por unidade, v: (Z1-Z0)/0.75 m por unidade)."""
    segs = NECK_SEGMENTS[collar]
    rows = int(0.03125 * N)
    prof = img[:rows, N // 2].copy()
    sel = m_torso & (TZ > 1.22) & (np.abs(TX) < 0.2)
    su, sv = 4 * W, (Z1 - Z0) / 0.75
    px, py = U[sel] * su, V[sel] * sv
    d = np.full(px.shape, 1e9, np.float32)
    for ua, va, ub, vb in segs:
        ax, ay, bx, by = ua * su, va * sv, ub * su, vb * sv
        dx, dy = bx - ax, by - ay
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-12), 0, 1)
        d = np.minimum(d, (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2)
    d = np.sqrt(d)
    band = d < COLLAR_BAND
    idx = ((1 - d[band] / COLLAR_BAND) * (rows - 1)).astype(int)
    sub = img[sel]
    sub[band] = prof[idx]
    img[sel] = sub


def downsample(a):
    h, w = a.shape[0] // SS, a.shape[1] // SS
    return a.reshape(h, SS, w, SS, -1).mean(axis=(1, 3))


def save_rgb(arr, path, fmt, quality=90, colorspace='sRGB'):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr[..., :3], 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.save(filepath=path, quality=quality)
    return img


albedo_images = {}
ACTIVE = [j for j in JERSEYS if ONLY is None or j[0] in ONLY]
for jid, kind, fn in ACTIVE:
    ST = ST_BY[kind]
    SZ = SZ_BY[kind]
    CUR_SLEEVE_T = SHELLS[kind]['sleeve_t'] or SLEEVE_T
    img = np.zeros((N, N, 3), np.float32)
    fn(img)
    if jid in TEAM_BACK:
        team_back(img, *TEAM_BACK[jid])
    collar_band(img, kind)
    knit(img)
    small = downsample(img)
    d = os.path.join(out_dir, jid)
    os.makedirs(d, exist_ok=True)
    albedo_images[jid] = save_rgb(small, os.path.join(d, 'albedo.webp'), 'WEBP', 90)
    h = small.shape[0]
    tr0 = h // 4
    save_rgb(small[tr0:, : h // 2], os.path.join(d, 'front.png'), 'PNG')
    save_rgb(small[tr0:, h // 2:], os.path.join(d, 'back.png'), 'PNG')
    print(f'[camisas] texturas de {jid}')

# ----- normal map de tecido (comum): trama + pespontos na barra, punhos, ombro e gola
ST = ST_BY['crew']
hgt = knit_pattern() * 0.35


def stitch(mask, along):
    """Pesponto contínuo (o tracejado aparecia como pontos soltos à distância)."""
    return mask


hem = m_torso & (np.abs(TZ - (HEM_Z + 0.014)) < 0.0012)
cuffline = m_sleeve & (np.abs(ST - (SLEEVE_T - 0.03)) < 0.0012)
shoulder_seam = m_sleeve & (np.abs(ST - 0.0) < 0.0015)
collar_seam = m_collar & (np.abs(CV - 0.2) < 0.06)
for m, along in ((hem, TX), (cuffline, TH * 0.05), (shoulder_seam, TH * 0.05), (collar_seam, CU)):
    hgt[stitch(m, along)] -= 0.15
gy, gx = np.gradient(hgt)
strength = 2.2
nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(hgt)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
fabric_normal = save_rgb(downsample(nrm), os.path.join(out_dir, 'fabric_normal.png'), 'PNG', colorspace='Non-Color')
print('[camisas] normal map de tecido')

# ------------------------------------------------------------------ materiais e export
mat = bpy.data.materials.new('Camisa')
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Roughness'].default_value = 0.85
tex = nt.nodes.new('ShaderNodeTexImage')
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
ntex = nt.nodes.new('ShaderNodeTexImage')
ntex.image = fabric_normal
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
for s in shells.values():
    s.data.materials.clear()
    s.data.materials.append(mat)

tex.image = albedo_images[ACTIVE[0][0]]
for o in bpy.context.view_layer.objects:
    o.select_set(False)
rig.select_set(True)
for s in shells.values():
    s.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = os.path.join(out_dir, 'jersey_base.glb')
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='PLACEHOLDER',
    export_skins=True,
    export_all_influences=False,
    export_def_bones=False,
    export_rest_position_armature=True,
    export_animations=False,
    export_morph=False,
)
print(f'[camisas] exportado {glb} ({os.path.getsize(glb) / 1e6:.2f} MB)')

# ------------------------------------------------------------------ miniaturas
if make_thumbs:
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 88
    world = bpy.data.worlds.new('Fundo')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.67, 0.74, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 0.78
    cam = bpy.data.objects.new('Cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -3.0, 1.2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    for name, energy, rot in (('Chave', 3.2, (0.9, 0.2, -0.5)), ('Recorte', 1.6, (1.2, 0.0, 2.6))):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
    thumb_bodies = {k: covered_body(k) for k in SHELLS}
    body.hide_render = True
    for jid, kind, _ in ACTIVE:
        tex.image = albedo_images[jid]
        for k, s in shells.items():
            s.hide_render = k != kind
            thumb_bodies[k].hide_render = k != kind
        cam.location = (0.0, -3.0, 1.2)
        cam.rotation_euler = (math.pi / 2, 0, 0)
        scene.render.filepath = os.path.join(out_dir, jid, 'thumb.webp')
        bpy.ops.render.render(write_still=True)
        # Costas: só para conferência (fora da pasta pública).
        cam.location = (0.0, 3.0, 1.2)
        cam.rotation_euler = (math.pi / 2, 0, math.pi)
        scene.render.filepath = os.path.join(os.path.dirname(src_blend), 'camisas_previa', f'{jid}_costas.webp')
        bpy.ops.render.render(write_still=True)
        # Lado (caimento): também só para conferência.
        cam.location = (3.0, 0.0, 1.2)
        cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
        scene.render.filepath = os.path.join(os.path.dirname(src_blend), 'camisas_previa', f'{jid}_lado.webp')
        bpy.ops.render.render(write_still=True)
        print(f'[camisas] miniatura {jid}')
    for o in thumb_bodies.values():
        bpy.data.objects.remove(o, do_unlink=True)
    body.hide_render = False

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(src_blend), 'camisas.blend'))
print(f'[camisas] concluído em {time.time() - t_start:.1f}s')
