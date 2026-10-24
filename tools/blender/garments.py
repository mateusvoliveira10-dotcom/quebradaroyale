"""Partes de baixo e tênis do personagem-base: malhas, UV, texturas, miniaturas e export.

blender -b --python tools/blender/garments.py -- <personagem-base.blend> <pasta public/assets/customization> [--sem-miniaturas]

Saída:
  bottoms/bottoms_base.glb   Bermuda_Curta, Bermuda_Longa e Calca (skinning no esqueleto do personagem)
  bottoms/<id>/albedo.webp   textura de cada peça (a UV é a da malha da peça)
  bottoms/<id>/normal.png    normal map (trama do tecido, costuras)
  bottoms/<id>/thumb.webp    miniatura renderizada no manequim
  shoes/shoes_base.glb       Tenis
  shoes/<id>/...             idem

Como nas camisas, cada malha sai do próprio corpo do manequim (mesmos pesos de
skinning), recortada por planos exatos, suavizada e afastada do corpo. A UV é
automática (Smart UV Project) e a textura é pintada a partir da posição 3D de
cada pixel na pose de repouso: bolsos, listras, costuras, cadarço e sola ficam no
lugar certo do corpo, independentemente de como as ilhas da UV foram arrumadas.
As regras de cobertura (BOTTOM_END, WAIST_Z, SHOE_TOP) são as mesmas usadas pelo
shader do corpo para esconder a pele (ClothingMaterial.ts).
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src_blend, out_root = os.path.abspath(args[0]), os.path.abspath(args[1])
make_thumbs = '--sem-miniaturas' not in args
t_start = time.time()
bpy.ops.wm.open_mainfile(filepath=src_blend)
body = bpy.data.objects['Corpo']
rig = bpy.data.objects['Esqueleto']
rig.data.pose_position = 'REST'

# ------------------------------------------------------------------ medidas e regras
WAIST_Z = 0.93                      # cós (fica sob a barra da camisa, 0,845)
BOTTOM_END = {'Bermuda_Curta': 0.60, 'Bermuda_Longa': 0.53, 'Calca': 0.10}
SHOE_TOP = 0.135                    # boca do tênis
ARM_RE = ('Shoulder', 'Arm', 'ForeArm', 'Hand')
arm_groups = {g.index for g in body.vertex_groups if any(g.name.startswith(s) and g.name[len(s):].startswith(ARM_RE) for s in ('Left', 'Right'))}
BODY_V = [v.co.copy() for v in body.data.vertices]


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def vert_armw(v, dl):
    return sum(w for gi, w in v[dl].items() if gi in arm_groups)


# Centro de cada perna por altura (seção do corpo), para o ângulo em volta da perna.
LEG_Z = np.arange(0.0, 0.80, 0.01)
LEG_CX, LEG_CY = [], []
for z in LEG_Z:
    pts = [p for p in BODY_V if abs(p.z - z) < 0.008 and 0.02 < p.x < 0.26]
    if len(pts) < 4:
        LEG_CX.append(LEG_CX[-1] if LEG_CX else 0.12)
        LEG_CY.append(LEG_CY[-1] if LEG_CY else 0.0)
        continue
    LEG_CX.append((min(p.x for p in pts) + max(p.x for p in pts)) / 2)
    LEG_CY.append((min(p.y for p in pts) + max(p.y for p in pts)) / 2)
LEG_CX, LEG_CY = np.array(LEG_CX), np.array(LEG_CY)
HIP_Z = np.arange(0.6, 1.0, 0.01)
HIP_CY = np.array([np.mean([p.y for p in BODY_V if abs(p.z - z) < 0.008 and abs(p.x) < 0.2] or [0.0]) for z in HIP_Z])


def leg_angle(x, y, z):
    """Ângulo em volta da perna (0 = lado de fora, +π/2 = frente, ±π = entreperna).
    Acima da virilha passa a ser em volta do quadril, com transição suave."""
    side = np.where(x >= 0, 1.0, -1.0)
    cx = np.interp(z, LEG_Z, LEG_CX)
    cy_leg = np.interp(z, LEG_Z, LEG_CY)
    cy_hip = np.interp(z, HIP_Z, HIP_CY)
    k = smoothstep(0.66, 0.78, z)
    cxx = cx * (1 - k)
    cyy = cy_leg * (1 - k) + cy_hip * k
    return np.arctan2(-(y - cyy), np.abs(x) - cxx), side


# ------------------------------------------------------------------ construção da malha
def build_shell(name, keep_face, cuts, offset_fn, smooth_iters, flatten_floor=False, reshape=None):
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.collection.objects.link(obj)
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            obj.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.active
    kill = [f for f in bm.faces if not keep_face(f.calc_center_median(), sum(vert_armw(v, dl) for v in f.verts) / len(f.verts))]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for co, no in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no, clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # Só a maior ilha (descarta pedaços soltos de mão/dedo que sobrarem).
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
    keep_islands = 2 if name == 'Tenis' else 1     # tênis: um pé de cada lado
    bmesh.ops.delete(bm, geom=[f for isl in islands[keep_islands:] for f in isl], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    verts = list(bm.verts)
    boundary = [v.is_boundary for v in verts]
    nbrs = [[e.other_vert(v).index for e in v.link_edges] for v in verts]
    P = np.array([v.co[:] for v in verts])
    for _ in range(smooth_iters):
        for lam in (0.55, -0.58):
            avg = np.array([P[n].mean(axis=0) if (not b and n) else P[i] for i, (b, n) in enumerate(zip(boundary, nbrs))])
            P = P + lam * (avg - P)
    for v, p in zip(verts, P):
        v.co = p
    bm.normal_update()
    NRM = np.array([v.normal[:] for v in verts])
    for _ in range(6):
        NRM = np.array([(NRM[n].sum(axis=0) + NRM[i]) for i, n in enumerate(nbrs)])
        NRM /= np.linalg.norm(NRM, axis=1, keepdims=True) + 1e-9
    for v, n in zip(verts, NRM):
        v.co += Vector(n) * offset_fn(v.co)
    if reshape:
        for v in verts:
            v.co = reshape(v.co)
    if flatten_floor:
        # Sola reta: os vértices de baixo vão para um plano logo abaixo do chão.
        for v in verts:
            if v.co.z < 0.012:
                v.co.z = -0.008
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    common.select_only(obj)
    sol = obj.modifiers.new('Espessura', 'SOLIDIFY')
    sol.thickness = 0.004
    sol.offset = -1.0
    sol.use_rim = True
    sol.use_rim_only = True
    bpy.ops.object.modifier_move_to_index(modifier=sol.name, index=0)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    # UV automática.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'[roupas] {name}: {len(obj.data.vertices)} vértices, {tris} triângulos')
    return obj


def bottoms_keep(end):
    return lambda c, armw: armw < 0.5 and end - 0.05 < c.z < WAIST_Z + 0.05


def bottoms_offset(end):
    long = end < 0.3

    def f(co):
        flare = float(smoothstep(end + (0.25 if long else 0.12), end, co.z))   # mais solta perto da barra
        waist = float(smoothstep(WAIST_Z - 0.06, WAIST_Z, co.z))               # cós justo
        knee_down = float(smoothstep(0.62, 0.45, co.z)) if long else 0.0       # calça cai reta abaixo do joelho
        return 0.013 + 0.010 * flare + 0.008 * knee_down - 0.005 * waist
    return f


meshes = {}
for name, end in BOTTOM_END.items():
    meshes[name] = build_shell(
        name,
        bottoms_keep(end),
        [((0, 0, WAIST_Z), (0, 0, 1)), ((0, 0, end), (0, 0, -1))],
        bottoms_offset(end),
        smooth_iters=12,
    )
FOOT_HX, FOOT_TX = 0.145, 0.178
HEEL_Y, TOE_Y = 0.082, -0.159
_fx, _fy = FOOT_TX - FOOT_HX, TOE_Y - HEEL_Y
_fl = math.hypot(_fx, _fy)
FOOT_F = (_fx / _fl, _fy / _fl)            # para a frente (espaço espelhado |x|)
FOOT_L = (-FOOT_F[1], FOOT_F[0])          # para fora


def shoe_last(co):
    """Fôrma do tênis na frente do pé: a seção (largura × altura) de cada ponto vira uma
    superelipse com bico arredondado, peito do pé inclinado e sola reta. O calcanhar e o
    tornozelo ficam com a forma do corpo (mistura suave entre as duas)."""
    side = 1.0 if co.x >= 0 else -1.0
    dx, dy = abs(co.x) - FOOT_HX, co.y - HEEL_Y
    a = dx * FOOT_F[0] + dy * FOOT_F[1]
    l = dx * FOOT_L[0] + dy * FOOT_L[1]
    blend = float(smoothstep(0.01, 0.07, a)) * float(smoothstep(0.125, 0.09, co.z))
    if blend <= 0:
        return co
    tip = 0.272
    half_w = 0.052 * math.sqrt(max(0.0, 1 - (max(0.0, a - 0.11) / (tip - 0.11)) ** 2.2)) + 0.004
    # Peito do pé desce até 0,061 m em a = 0,19 e depois afina até o bico.
    top = 0.118 - 0.38 * max(0.0, a - 0.04) if a < 0.19 else 0.061 - 0.30 * (a - 0.19)
    top = max(top, 0.03)
    bottom = -0.008
    zc, hh = (top + bottom) / 2, (top - bottom) / 2
    lc = 0.004                            # leve deslocamento para fora (pé é mais largo por fora)
    u, w = (l - lc) / half_w, (co.z - zc) / hh
    n = 2.6
    s = (abs(u) ** n + abs(w) ** n) ** (1 / n) or 1.0
    nl, nz = lc + (l - lc) / s, zc + (co.z - zc) / s
    if a > tip - 0.004:                   # não passa da ponta
        a = tip - 0.004
    ndx = a * FOOT_F[0] + nl * FOOT_L[0]
    ndy = a * FOOT_F[1] + nl * FOOT_L[1]
    target = Vector((side * (FOOT_HX + ndx), HEEL_Y + ndy, nz))
    return co.lerp(target, blend)


meshes['Tenis'] = build_shell(
    'Tenis',
    lambda c, armw: armw < 0.5 and c.z < SHOE_TOP + 0.04,
    [((0, 0, SHOE_TOP), (0, 0, 1))],
    lambda co: 0.009 + 0.002 * float(smoothstep(0.03, 0.0, co.z)),
    smooth_iters=55,
    flatten_floor=True,
    reshape=shoe_last,
)

# ------------------------------------------------------------------ pintura no espaço 3D
RES = 1024


def rasterize(obj, res=RES):
    """Para cada pixel da textura: posição e normal de repouso do ponto da malha que o cobre."""
    me = obj.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    pos = np.zeros((res, res, 3), np.float32)
    nrm = np.zeros((res, res, 3), np.float32)
    cov = np.zeros((res, res), bool)
    vco = np.array([v.co[:] for v in me.vertices], np.float32)
    vno = np.array([v.normal[:] for v in me.vertices], np.float32)
    for tri in me.loop_triangles:
        uv = np.array([uvl[li].uv[:] for li in tri.loops], np.float32) * res
        x0, y0 = np.floor(uv.min(axis=0)).astype(int)
        x1, y1 = np.ceil(uv.max(axis=0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, res - 1), min(y1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = uv
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any():
            continue
        vi = list(tri.vertices)
        P = w0[..., None] * vco[vi[0]] + w1[..., None] * vco[vi[1]] + w2[..., None] * vco[vi[2]]
        Nn = w0[..., None] * vno[vi[0]] + w1[..., None] * vno[vi[1]] + w2[..., None] * vno[vi[2]]
        sub = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sub][inside] = P[inside]
        nrm[sub][inside] = Nn[inside]
        cov[sub] |= inside
    return pos, nrm, cov


def dilate(img, cov, passes=8):
    img = img.copy()
    cov = cov.copy()
    for _ in range(passes):
        acc = np.zeros_like(img)
        cnt = np.zeros(cov.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(img, dy, 0), dx, 1)
            sc = np.roll(np.roll(cov, dy, 0), dx, 1)
            acc[sc] += sh[sc]
            cnt[sc] += 1
        new = (~cov) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        cov = cov | new
    return img


def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


def save_rgb(arr, path, fmt, quality=90, colorspace='sRGB'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
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


def normal_from_height(h, strength=2.0):
    gy, gx = np.gradient(h)
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


UU, VV = np.meshgrid((np.arange(RES) + 0.5) / RES, (np.arange(RES) + 0.5) / RES)


def weave(kind):
    """Trama em espaço de textura: sarja (jeans) ou malha (tecido esportivo)."""
    if kind == 'denim':
        return 0.5 + 0.5 * np.sin((UU + VV) * RES * 2 * math.pi / 5)
    if kind == 'canvas':
        return 0.5 + 0.25 * (np.sin(UU * RES * 2 * math.pi / 4) + np.sin(VV * RES * 2 * math.pi / 4))
    return 0.5 + 0.5 * np.sin(UU * RES * 2 * math.pi / 6) * np.sin(VV * RES * 2 * math.pi / 6)


def ang_near(a, target, width):
    return np.abs((a - target + math.pi) % (2 * math.pi) - math.pi) < width


# ----- desenho das partes de baixo (x, y, z de repouso; θ em volta da perna)
def paint_bottom(spec, pos, nrm, cov):
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    th, side = leg_angle(x, y, z)
    end = BOTTOM_END[spec['mesh']]
    col = np.empty(pos.shape, np.float32)
    col[:] = hexc(spec['color'])
    seam = np.zeros(z.shape, bool)            # costuras (viram sulco no normal map)
    base = hexc(spec['color'])
    if spec.get('fade'):
        # Jeans gasto: mais claro na frente da coxa.
        k = smoothstep(0.25, 1.2, np.cos(th - 1.2)) * smoothstep(0.45, 0.62, z) * smoothstep(0.80, 0.66, z)
        col = col * (1 - k[..., None]) + np.minimum(base * 1.35, 1)[None, None] * k[..., None]
    if spec.get('fabric') == 'denim':
        n = 0.5 + 0.5 * np.sin((x * 900 + z * 1300)) * np.sin(y * 700 - z * 500)
        col *= (0.9 + 0.1 * n)[..., None]
    # Cós e passadores.
    band = z > WAIST_Z - 0.035
    col[band] = np.minimum(base * spec.get('band_k', 0.82), 1)
    seam |= np.abs(z - (WAIST_Z - 0.035)) < 0.0018
    if spec.get('loops'):
        for a in (-1.5, -0.6, 0.15, 1.0):
            lp = band & ang_near(th, a, 0.06)
            col[lp] = np.minimum(base * 0.7, 1)
            seam |= lp & (np.abs(np.abs(th - a) - 0.055) < 0.012)
    if spec.get('drawstring'):
        ds = band & (np.abs(x) < 0.03) & (y < 0) & (z < WAIST_Z - 0.008) & (z > WAIST_Z - 0.03)
        col[ds & (np.abs(np.abs(x) - 0.015) < 0.004)] = hexc('#f2f2f2')
    # Barra / punho.
    hem = z < end + spec.get('hem', 0.02)
    col[hem] = np.minimum(base * spec.get('hem_k', 0.9), 1)
    seam |= np.abs(z - (end + spec.get('hem', 0.02))) < 0.0018
    if spec.get('rib'):
        rib = hem & (np.sin(th * 60) > 0)
        col[rib] *= 0.92
    # Listra lateral.
    if spec.get('stripe'):
        sw = spec.get('stripe_w', 0.11)
        st = ang_near(th, 0.0, sw) & (z < WAIST_Z - 0.035) & ~hem
        col[st] = hexc(spec['stripe'])
        if spec.get('stripe_double'):
            col[ang_near(th, 0.0, sw * 0.35) & st] = hexc(spec['color'])
    # Costuras laterais e entreperna (abaixo da virilha).
    below = z < 0.70
    seam |= below & ang_near(th, math.pi, 0.012)
    seam |= ang_near(th, 0.0, 0.012) & ~hem & (z < WAIST_Z - 0.035) & (not spec.get('stripe'))
    # Braguilha (frente, centro).
    if spec.get('fly'):
        fl = (y < 0) & (z > 0.76) & (z < WAIST_Z - 0.035)
        seam |= fl & (np.abs(x - 0.022 * (z < 0.79)) < 0.0018) & (x > -0.005)
        seam |= fl & (np.abs(x - 0.025) < 0.0018) & (z > 0.785)
    # Bolsos da frente (abertura curva) e de trás (remendo).
    if spec.get('pockets'):
        fr = (z > 0.80) & (z < WAIST_Z - 0.035) & (th > 0.15) & (th < 1.05)
        curve = np.abs((z - 0.80) - 0.09 * ((th - 0.15) / 0.9) ** 0.5) < 0.0022
        seam |= fr & curve
        bk = (z > 0.74) & (z < 0.86) & (th < -0.55) & (th > -1.35)
        col[bk] *= 0.94
        edge = bk & ((np.abs(z - 0.74) < 0.004) | (np.abs(th + 0.55) < 0.02) | (np.abs(th + 1.35) < 0.02) | (np.abs(z - 0.86) < 0.004))
        seam |= edge
    # Bolsos cargo na lateral da coxa (com lapela).
    if spec.get('cargo'):
        cg = (z > 0.52) & (z < 0.66) & ang_near(th, 0.25, 0.42)
        col[cg] = np.minimum(base * 0.86, 1)
        flap = cg & (z > 0.63)
        col[flap] = np.minimum(base * 0.7, 1)
        col[cg & (z < 0.53)] = np.minimum(base * 0.7, 1)
        seam |= cg & ((np.abs(z - 0.52) < 0.003) | (np.abs(z - 0.63) < 0.003) | ang_near(th, 0.25 - 0.41, 0.02) | ang_near(th, 0.25 + 0.41, 0.02))
        seam |= (z < 0.70) & (np.abs(z - 0.46) < 0.0018)     # costura do joelho
    col[seam] *= 0.78
    h = weave(spec.get('fabric', 'knit')) * 0.3
    h[seam] -= 0.6
    return col, h


# ----- desenho dos tênis (coordenadas do pé: a = do calcanhar à ponta, l = para fora)
HEEL_Y, TOE_Y = 0.082, -0.159


def foot_coords(x, y, z):
    side = np.where(x >= 0, 1.0, -1.0)
    hx, tx = 0.145, 0.178
    fx, fy = (tx - hx), (TOE_Y - HEEL_Y)
    ln = math.hypot(fx, fy)
    fx, fy = fx / ln, fy / ln
    dx, dy = np.abs(x) - hx, y - HEEL_Y
    a = dx * fx + dy * fy                 # para a frente
    l = dx * (-fy) + dy * fx              # para fora (lado de fora do pé), no espaço espelhado |x|
    return a, l, side


def paint_shoe(spec, pos, nrm, cov):
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    a, l, side = foot_coords(x, y, z)
    up = nrm[..., 2]
    col = np.empty(pos.shape, np.float32)
    col[:] = hexc(spec['upper'])
    seam = np.zeros(z.shape, bool)
    # Sola e entressola.
    sole = z < 0.024
    col[sole] = hexc(spec['sole'])
    mid = (z >= 0.024) & (z < 0.036)
    col[mid] = hexc(spec.get('midsole', spec['sole']))
    seam |= np.abs(z - 0.036) < 0.0015
    # Biqueira.
    toe = (a > 0.19) & (z < 0.07) & ~sole & ~mid
    col[toe] = hexc(spec.get('toe', spec['upper']))
    seam |= (np.abs(a - 0.19) < 0.002) & (z < 0.07) & (z > 0.036)
    # Contraforte do calcanhar.
    heel = (a < -0.015) & (z > 0.036) & (z < 0.10)
    col[heel] = hexc(spec.get('heel', spec['upper']))
    # Faixa lateral (desenho próprio, genérico): sobe da sola para trás.
    band = (z > 0.04 + 0.25 * np.clip(a - 0.02, 0, 1)) & (z < 0.06 + 0.25 * np.clip(a - 0.02, 0, 1)) & (a > 0.0) & (a < 0.15) & (np.abs(l) > 0.025)
    col[band] = hexc(spec['accent'])
    # Cadarço: no peito do pé, voltado para cima.
    lace_area = (a > 0.07) & (a < 0.19) & (np.abs(l) < 0.022) & (up > 0.35) & (z > 0.05)
    col[lace_area] = np.minimum(hexc(spec['upper']) * 0.85, 1)
    bars = lace_area & ((((a - 0.07) / 0.013) % 1.0) < 0.45)
    col[bars] = hexc(spec.get('laces', '#f4f4f4'))
    seam |= lace_area & (np.abs(np.abs(l) - 0.022) < 0.0015)
    # Gola acolchoada.
    collar = z > SHOE_TOP - 0.018
    col[collar] = np.minimum(hexc(spec.get('collar', spec['upper'])) * 0.9, 1)
    if spec.get('studs'):
        st = sole & (z < 0.006) & ((((a / 0.035) % 1.0) < 0.35))
        col[st] = hexc(spec['accent'])
    col[seam] *= 0.8
    h = weave('canvas' if spec.get('suede') else 'knit') * 0.25
    h[seam] -= 0.5
    h[bars] += 0.4
    return col, h


BOTTOMS = [
    ('bermuda_esportiva', {'mesh': 'Bermuda_Curta', 'color': '#1f47b8', 'stripe': '#f4f4f0', 'stripe_double': True, 'drawstring': True, 'hem': 0.02, 'fabric': 'knit'}),
    ('bermuda_jeans', {'mesh': 'Bermuda_Longa', 'color': '#4a6fa8', 'fabric': 'denim', 'loops': True, 'fly': True, 'pockets': True, 'hem': 0.035, 'hem_k': 1.15, 'fade': True}),
    ('calca_cargo', {'mesh': 'Calca', 'color': '#6b6a45', 'fabric': 'canvas', 'loops': True, 'fly': True, 'pockets': True, 'cargo': True, 'hem': 0.015}),
    ('calca_jogger', {'mesh': 'Calca', 'color': '#3a3d45', 'stripe': '#f4f4f0', 'stripe_w': 0.07, 'drawstring': True, 'hem': 0.06, 'hem_k': 0.85, 'rib': True, 'fabric': 'knit'}),
    ('calca_jeans', {'mesh': 'Calca', 'color': '#3d5f94', 'fabric': 'denim', 'loops': True, 'fly': True, 'pockets': True, 'hem': 0.015, 'fade': True}),
]
SHOES = [
    ('tenis_branco', {'upper': '#f4f4f2', 'sole': '#f7f7f7', 'midsole': '#1aa05a', 'accent': '#1aa05a', 'heel': '#1aa05a', 'laces': '#ffffff'}),
    ('tenis_preto', {'upper': '#1c1d22', 'sole': '#f2f2f2', 'accent': '#e8322b', 'heel': '#2a2b31', 'laces': '#1c1d22', 'toe': '#26272d'}),
    ('tenis_casual', {'upper': '#c9b48c', 'sole': '#f2ede2', 'accent': '#a8936b', 'heel': '#7a5a3a', 'laces': '#7a5a3a', 'suede': True}),
    ('chuteira', {'upper': '#15161a', 'sole': '#d8ff2a', 'midsole': '#15161a', 'accent': '#d8ff2a', 'laces': '#15161a', 'studs': True}),
]

raster = {}
albedo_images = {}
normal_images = {}
for jid, spec in BOTTOMS:
    mesh_name = spec['mesh']
    if mesh_name not in raster:
        raster[mesh_name] = rasterize(meshes[mesh_name])
    pos, nrm, cov = raster[mesh_name]
    col, h = paint_bottom(spec, pos, nrm, cov)
    d = os.path.join(out_root, 'bottoms', jid)
    albedo_images[jid] = save_rgb(dilate(col, cov), os.path.join(d, 'albedo.webp'), 'WEBP', 90)
    normal_images[jid] = save_rgb(dilate(normal_from_height(h), cov), os.path.join(d, 'normal.png'), 'PNG', colorspace='Non-Color')
    print(f'[roupas] texturas de {jid}')
raster['Tenis'] = rasterize(meshes['Tenis'], 512)
UU, VV = np.meshgrid((np.arange(512) + 0.5) / 512, (np.arange(512) + 0.5) / 512)
for jid, spec in SHOES:
    pos, nrm, cov = raster['Tenis']
    col, h = paint_shoe(spec, pos, nrm, cov)
    d = os.path.join(out_root, 'shoes', jid)
    albedo_images[jid] = save_rgb(dilate(col, cov), os.path.join(d, 'albedo.webp'), 'WEBP', 90)
    normal_images[jid] = save_rgb(dilate(normal_from_height(h, 1.6), cov), os.path.join(d, 'normal.png'), 'PNG', colorspace='Non-Color')
    print(f'[roupas] texturas de {jid}')

# ------------------------------------------------------------------ materiais e export
mat = bpy.data.materials.new('Roupa')
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Roughness'].default_value = 0.9
tex = nt.nodes.new('ShaderNodeTexImage')
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
ntex = nt.nodes.new('ShaderNodeTexImage')
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
for o in meshes.values():
    o.data.materials.clear()
    o.data.materials.append(mat)


def export(names, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    rig.select_set(True)
    for n in names:
        meshes[n].select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_materials='PLACEHOLDER', export_skins=True, export_all_influences=False, export_def_bones=False,
        export_rest_position_armature=True, export_animations=False, export_morph=False,
    )
    print(f'[roupas] exportado {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


export(list(BOTTOM_END), os.path.join(out_root, 'bottoms', 'bottoms_base.glb'))
export(['Tenis'], os.path.join(out_root, 'shoes', 'shoes_base.glb'))

# ------------------------------------------------------------------ miniaturas
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
    world = bpy.data.worlds.new('Fundo')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.67, 0.74, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('Cam', cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    for nm, energy, rot in (('Chave', 3.2, (0.9, 0.2, -0.5)), ('Recorte', 1.6, (1.2, 0.0, 2.6))):
        ld = bpy.data.lights.new(nm, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(nm, ld)
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)

    def covered_body(lo, hi):
        """Cópia do corpo sem a pele entre as alturas lo e hi (fora dos braços)."""
        ob = body.copy()
        ob.data = body.data.copy()
        bpy.context.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        dl = bm.verts.layers.deform.active
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if lo < f.calc_center_median().z < hi and sum(vert_armw(v, dl) for v in f.verts) / len(f.verts) < 0.5], context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
        ob.hide_render = True
        return ob

    thumb_bodies = {n: covered_body(BOTTOM_END[n] + 0.02, WAIST_Z - 0.015) for n in BOTTOM_END}
    thumb_bodies['Tenis'] = covered_body(-1, 0.115)
    body.hide_render = True

    def render(path, items, cam_z, scale):
        for n, o in meshes.items():
            o.hide_render = n not in items
        for n, o in thumb_bodies.items():
            o.hide_render = n != items[0]
        cam.location = (0.35, -3.0, cam_z)
        cam.rotation_euler = (math.pi / 2, 0, math.atan2(0.35, 3.0))
        cam_data.ortho_scale = scale
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    # Cada peça com uma combinação neutra para o resto (tênis branco / bermuda esportiva).
    # O material é único na cena, então as peças são renderizadas uma de cada vez.
    for jid, spec in BOTTOMS:
        tex.image = albedo_images[jid]
        ntex.image = normal_images[jid]
        meshes['Tenis'].hide_render = True
        render(os.path.join(out_root, 'bottoms', jid, 'thumb.webp'), [spec['mesh']], 0.62, 1.05)
        print(f'[roupas] miniatura {jid}')
    for jid, _ in SHOES:
        tex.image = albedo_images[jid]
        ntex.image = normal_images[jid]
        render(os.path.join(out_root, 'shoes', jid, 'thumb.webp'), ['Tenis'], 0.08, 0.42)
        print(f'[roupas] miniatura {jid}')
    for o in thumb_bodies.values():
        bpy.data.objects.remove(o, do_unlink=True)
    body.hide_render = False

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(src_blend), 'roupas.blend'))
print(f'[roupas] concluído em {time.time() - t_start:.1f}s')
