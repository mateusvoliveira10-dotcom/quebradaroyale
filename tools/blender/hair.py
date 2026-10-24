"""Cabelos 3D do personagem-base: malhas moldadas no couro cabeludo, texturas, miniaturas e export.

blender -b --python tools/blender/hair.py -- <personagem-base.blend> <pasta public/assets/customization/hair> [--sem-miniaturas]

Saída:
  hair_base.glb          Cabelo_Degrade, Cabelo_Americano, Cabelo_Risquinho e Cabelo_Cacheado
                         (skinning no osso da cabeça do esqueleto do personagem)
  <id>/albedo.webp       cor de cada estilo (fios, mechas, reflexos)
  <shape>_normal.png     relevo dos fios de cada malha (compartilhado pelas cores)
  <id>/thumb.webp        miniatura no manequim

Como as roupas, cada cabelo sai do próprio corpo do manequim: as faces do couro cabeludo
acima da linha do volume viram uma casca, afastada da pele por uma espessura que varia
com o corte (lateral baixa no degradê, volume em cima, topete na frente). Sobre a
espessura vai um relevo de verdade na geometria: mechas alongadas no sentido do penteado
ou, no cacheado, cachos (células de Worley). Os fios finos ficam na textura e no normal map.
A parte raspada do degradê continua pintada no corpo (ClothingMaterial.ts); a casca começa
acima de onde a pintura já é cabelo cheio, então as duas se emendam sem degrau.
Coordenadas do Blender: z para cima, frente em −Y, esquerda do personagem em +X.
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
src_blend, out_dir = os.path.abspath(args[0]), os.path.abspath(args[1])
make_thumbs = '--sem-miniaturas' not in args
t_start = time.time()
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=src_blend)
body = bpy.data.objects['Corpo']
rig = bpy.data.objects['Esqueleto']
rig.data.pose_position = 'REST'
BODY_CO = np.array([v.co[:] for v in body.data.vertices])
HEAD_TOP = BODY_CO[:, 2].max()
print(f'[cabelo] topo da cabeça em z={HEAD_TOP:.3f}')


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ ruído (numpy)
def _hash(ix, iy, iz, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19) * 43758.5453
    return h - np.floor(h)


def vnoise(p, seed=0):
    """Ruído de valor 3D suave (0..1)."""
    i = np.floor(p)
    f = p - i
    u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, octaves=3, seed=0):
    s, a, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + a * vnoise(p * (2 ** o), seed + o)
        tot += a
        a *= 0.5
    return s / tot


def worley(p, seed=0):
    """Distância ao ponto mais próximo (células de 1 unidade, um ponto por célula)."""
    i = np.floor(p)
    best = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + np.array([dx, dy, dz])
                j = np.stack([_hash(c[:, 0], c[:, 1], c[:, 2], seed + k) for k in range(3)], 1)
                best = np.minimum(best, np.linalg.norm(c + 0.15 + 0.7 * j - p, axis=1))
    return best


# ------------------------------------------------------------------ cortes
# R_SIDE/R_FRONT: altura onde a casca começa (lateral/nuca e testa). A pintura do corpo é
# cabelo cheio a partir de linha + degradê (1,645 no degradê; 1,71 no americano); a casca
# começa um pouco acima, com 1,5 mm de espessura, e cresce para cima.
# TOP: espessura no alto da cabeça. QUIFF: volume extra do topete na frente.
SHAPES = {
    'Cabelo_Degrade': dict(R_SIDE=1.648, R_FRONT=1.706, SIDE=0.0035, TOP=0.017, QUIFF=0.012, CURLY=False),
    'Cabelo_Americano': dict(R_SIDE=1.708, R_FRONT=1.708, SIDE=0.004, TOP=0.032, QUIFF=0.014, CURLY=False),
    'Cabelo_Risquinho': dict(R_SIDE=1.648, R_FRONT=1.706, SIDE=0.003, TOP=0.014, QUIFF=0.008, CURLY=False, PART=True),
    'Cabelo_Cacheado': dict(R_SIDE=1.645, R_FRONT=1.704, SIDE=0.010, TOP=0.026, QUIFF=0.004, CURLY=True),
}
TOP0 = HEAD_TOP - 0.075          # a partir daqui a espessura cresce até TOP


def front_of(co):
    return -co[..., 1]           # glTF z (frente positiva)


def start_height(co, s):
    return s['R_SIDE'] + (s['R_FRONT'] - s['R_SIDE']) * smoothstep(0.03, 0.085, front_of(co))


def part_line(co):
    """Risquinho: distância (m) até a linha raspada na lateral esquerda (+X), inclinada."""
    # linha de (y=+0,045, z=1,695) a (y=−0,045, z=1,712), na lateral esquerda da cabeça
    a = np.array([0.045, 1.695])
    b = np.array([-0.045, 1.712])
    q = np.stack([co[..., 1], co[..., 2]], -1)
    t = np.clip(((q - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
    d = np.linalg.norm(q - (a + t[..., None] * (b - a)), axis=-1)
    return np.where(co[..., 0] > 0.04, d, 1.0)


def thickness(co, s):
    """Espessura da casca (m) em cada ponto da pele (pose de repouso)."""
    z = co[..., 2]
    r = start_height(co, s)
    edge = smoothstep(r, r + 0.018, z)
    top = smoothstep(TOP0, HEAD_TOP - 0.01, z)
    front = smoothstep(0.02, 0.09, front_of(co)) * smoothstep(r, r + 0.03, z)
    t = 0.0015 + s['SIDE'] * edge + (s['TOP'] - s['SIDE']) * top * edge + s['QUIFF'] * front
    if s.get('PART'):
        t = np.where(part_line(co) < 0.0025, 0.0008, t)
    return t


def flow_coords(co):
    """Espaço do penteado: mechas alongadas de trás para a frente (y), finas na lateral."""
    return np.stack([co[:, 0] * 150, co[:, 1] * 32, co[:, 2] * 150], 1)


def relief(co, s):
    """Relevo da superfície (m, ao longo da normal): mechas ou cachos."""
    if s['CURLY']:
        d = worley(co * 85.0, 3)                         # cachos de ~1,2 cm
        bump = np.clip(1 - d / 0.62, 0, 1) ** 0.6
        return 0.0055 * bump + 0.0015 * fbm(co * 260, 2, 9)
    clumps = fbm(flow_coords(co), 3, 5)
    return 0.0028 * (clumps - 0.5) + 0.0009 * vnoise(co * 420, 7)


# ------------------------------------------------------------------ malha
def build(name, s):
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.collection.objects.link(obj)
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            obj.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    def keep(f):
        c = np.array(f.calc_center_median()[:])
        return c[2] > min(s['R_SIDE'], s['R_FRONT']) - 0.03
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f)], context='FACES')
    # Linha do cabelo por cortes exatos (sem dentes das faces do corpo): plano horizontal na
    # lateral/nuca e plano inclinado na testa — juntos, a linha de start_height().
    slope = (s['R_FRONT'] - s['R_SIDE']) / 0.055
    cuts = [((0, 0, s['R_SIDE']), (0, 0, -1))]
    if slope > 0:
        cuts.append(((0, 0, s['R_SIDE'] - slope * 0.03), (0, -slope, -1)))
    else:
        cuts = [((0, 0, s['R_FRONT']), (0, 0, -1))]
    for co, no in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no, clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # só a maior ilha (descarta pontas de orelha soltas)
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
    # densidade para o relevo: cachos precisam de mais faces que as mechas
    for _ in range(2 if s['CURLY'] else 1):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    verts = list(bm.verts)
    boundary = np.array([v.is_boundary for v in verts])
    nbrs = [[e.other_vert(v).index for e in v.link_edges] for v in verts]
    P = np.array([v.co[:] for v in verts])
    # suaviza a forma (sem encolher): a casca não copia as facetas do corpo
    for _ in range(6):
        for lam in (0.5, -0.53):
            avg = np.array([P[n].mean(0) if (not b and n) else P[i] for i, (b, n) in enumerate(zip(boundary, nbrs))])
            P = P + lam * (avg - P)
    bm.normal_update()
    N = np.array([v.normal[:] for v in verts])
    for _ in range(8):
        N = np.array([N[n].sum(0) + N[i] for i, n in enumerate(nbrs)])
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    base = P.copy()
    t = thickness(base, s)
    r = relief(base, s) * smoothstep(0.003, 0.009, t)    # relevo some na borda fina
    P = base + N * (t + r)[:, None]
    if not s['CURLY']:
        # topete: a frente sobe e avança um pouco (penteado para cima)
        fr = smoothstep(0.03, 0.095, front_of(base)) * smoothstep(TOP0 - 0.02, HEAD_TOP - 0.02, base[:, 2])
        P[:, 2] += fr * s['QUIFF'] * 0.5
        P[:, 1] -= fr * s['QUIFF'] * 0.25
    for v, p in zip(verts, P):
        v.co = p
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    # repouso de cada vértice, para pintar a textura (atributo descartado no export)
    rest = obj.data.attributes.new('repouso', 'FLOAT_VECTOR', 'POINT')
    rest.data.foreach_set('vector', base.ravel())
    # borda: aba para dentro (não se vê o vão entre a casca e a pele)
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
    # cabelo inteiro preso ao osso da cabeça
    obj.vertex_groups.clear()
    g = obj.vertex_groups.new(name='Head')
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'[cabelo] {name}: {len(obj.data.vertices)} vértices, {tris} triângulos, espessura máx {t.max() * 1000:.0f} mm')
    return obj


meshes = {name: build(name, s) for name, s in SHAPES.items()}

# ------------------------------------------------------------------ texturas
RES = 512


def rasterize(obj, res=RES):
    """Para cada pixel: posição de repouso (na pele) do ponto da malha que o cobre."""
    me = obj.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    rest = np.zeros(len(me.vertices) * 3, np.float32)
    me.attributes['repouso'].data.foreach_get('vector', rest)
    vco = rest.reshape(-1, 3)
    pos = np.zeros((res, res, 3), np.float32)
    cov = np.zeros((res, res), bool)
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
        Pp = w0[..., None] * vco[vi[0]] + w1[..., None] * vco[vi[1]] + w2[..., None] * vco[vi[2]]
        sub = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sub][inside] = Pp[inside]
        cov[sub] |= inside
    return pos, cov


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
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return c


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


def strands(p, s):
    """Fios (0..1) e mechas (0..1) em cada ponto (posição de repouso, N×3)."""
    if s['CURLY']:
        # cachos: espirais finas (ruído deformado) + sombra entre os cachos
        d = worley(p * 85.0, 3)
        warp = p * 600 + 2.5 * np.stack([vnoise(p * 300, 11), vnoise(p * 300, 12), vnoise(p * 300, 13)], 1)
        fine = vnoise(warp, 14)
        clump = np.clip(1 - d / 0.62, 0, 1)
        return fine, clump
    q = np.stack([p[:, 0] * 800, p[:, 1] * 60, p[:, 2] * 800], 1)
    fine = fbm(q, 2, 21)
    clump = fbm(flow_coords(p), 3, 5)
    return fine, clump


# id: (malha, base, escura, reflexo, quantidade de reflexo) — mesmas cores de Styles.ts
STYLES = {
    'degrade_baixo': ('Cabelo_Degrade', '#24160d', '#140b06', '#5a3a22', 0.25),
    'degrade_americano': ('Cabelo_Americano', '#1c120b', '#0e0805', '#4d3220', 0.25),
    'risquinho': ('Cabelo_Risquinho', '#1f140c', '#100905', '#4a3020', 0.25),
    'cacheado': ('Cabelo_Cacheado', '#22150c', '#120a05', '#5c3c22', 0.35),
    'platinado': ('Cabelo_Degrade', '#e9e2cf', '#b9ae94', '#ffffff', 0.8),
    'reflexo_dourado': ('Cabelo_Degrade', '#24160d', '#140b06', '#e8b867', 0.85),
    'reflexo_prateado': ('Cabelo_Degrade', '#1b1716', '#0d0a0a', '#d9dde3', 0.85),
}
SKIN_LINE = hexc('#8a5a40')

raster = {name: rasterize(o) for name, o in meshes.items()}
fields = {}
for name, (pos, cov) in raster.items():
    s = SHAPES[name]
    p = pos[cov]
    fine, clump = strands(p, s)
    # reflexos: mechas largas e longas, mais no alto da cabeça
    # (finas e longas no sentido do penteado; o cacheado tem as pontas dos cachos clareadas)
    if s['CURLY']:
        streak = smoothstep(0.45, 0.9, fine) * smoothstep(0.3, 0.9, clump)
    else:
        streak = smoothstep(0.56, 0.7, fbm(np.stack([p[:, 0] * 320, p[:, 1] * 16, p[:, 2] * 320], 1), 2, 31))
        streak = streak * (0.5 + 0.5 * smoothstep(0.3, 0.7, fine))
    streak = streak * smoothstep(HEAD_TOP - 0.09, HEAD_TOP - 0.03, p[:, 2])
    part = part_line(p) < 0.0025 if s.get('PART') else np.zeros(len(p), bool)
    fields[name] = (fine, clump, streak, part)
    # normal map: fios + mechas, como relevo
    h = np.zeros(cov.shape, np.float32)
    h[cov] = fine * 0.6 + clump * (1.2 if s['CURLY'] else 0.8)
    gy, gx = np.gradient(h)
    st = 2.2 if s['CURLY'] else 3.0
    n = np.stack([-gx * st, -gy * st, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    save_rgb(dilate(n * 0.5 + 0.5, cov), os.path.join(out_dir, f'{name.lower()}_normal.png'), 'PNG', colorspace='Non-Color')

for hid, (name, base, dark, hi, amount) in STYLES.items():
    pos, cov = raster[name]
    fine, clump, streak, part = fields[name]
    cb, cd, ch = hexc(base), hexc(dark), hexc(hi)
    col = cb[None] * (1 - fine[:, None] * 0.55) + cd[None] * (fine[:, None] * 0.55)
    # entre mechas/cachos fica mais escuro (oclusão); no alto das mechas, um pouco mais claro
    shade = 0.62 + 0.5 * clump
    col = col * shade[:, None]
    col = col + (ch[None] - col) * (amount * streak * (0.55 + 0.45 * fine))[:, None]
    col[part] = SKIN_LINE
    img = np.zeros((RES, RES, 3), np.float32)
    img[cov] = col
    save_rgb(dilate(img, cov), os.path.join(out_dir, hid, 'albedo.webp'), 'WEBP', 90)
    print(f'[cabelo] textura de {hid}')

# ------------------------------------------------------------------ export
mat = bpy.data.materials.new('Cabelo')
for o in meshes.values():
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.data.attributes.remove(o.data.attributes['repouso'])
for o in bpy.context.view_layer.objects:
    o.select_set(False)
rig.select_set(True)
for o in meshes.values():
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = os.path.join(out_dir, 'hair_base.glb')
bpy.ops.export_scene.gltf(
    filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True, export_normals=True,
    export_materials='PLACEHOLDER', export_skins=True, export_all_influences=False, export_def_bones=False,
    export_rest_position_armature=True, export_animations=False, export_morph=False, export_attributes=False,
)
print(f'[cabelo] exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

# ------------------------------------------------------------------ miniaturas e prévia
if make_thumbs:
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 88
    world = bpy.data.worlds.new('Fundo')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.67, 0.74, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    for nm, energy, rot in (('Chave', 3.0, (0.9, 0.2, -0.5)), ('Recorte', 1.8, (1.1, 0.0, 2.6))):
        ld = bpy.data.lights.new(nm, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(nm, ld)
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
    hmat = bpy.data.materials.new('CabeloPrevia')
    hmat.use_nodes = True
    nt = hmat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.5
    tex = nt.nodes.new('ShaderNodeTexImage')
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ntex = nt.nodes.new('ShaderNodeTexImage')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    for o in meshes.values():
        o.data.materials[0] = hmat
    for o in bpy.data.objects:
        if o.type == 'MESH' and o not in meshes.values() and o != body:
            o.hide_render = True

    def show(name):
        for n, o in meshes.items():
            o.hide_render = n != name

    def shoot(path, ang, z, sc, res):
        cam.location = (math.sin(ang) * 3, -math.cos(ang) * 3, z)
        cam.rotation_euler = (math.pi / 2, 0, ang)
        cam.data.ortho_scale = sc
        scene.render.resolution_x = scene.render.resolution_y = res
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    prev = os.path.join(os.path.dirname(src_blend), 'cabelo_previa')
    os.makedirs(prev, exist_ok=True)
    for hid, (name, *_r) in STYLES.items():
        show(name)
        tex.image = bpy.data.images.load(os.path.join(out_dir, hid, 'albedo.webp'))
        ntex.image = bpy.data.images.load(os.path.join(out_dir, f'{name.lower()}_normal.png'))
        ntex.image.colorspace_settings.name = 'Non-Color'
        shoot(os.path.join(out_dir, hid, 'thumb.webp'), math.radians(30), 1.66, 0.34, 256)
        for nm, ang in (('frente', 0.0), ('lado', math.radians(90)), ('tras', math.radians(160))):
            shoot(os.path.join(prev, f'{hid}_{nm}.webp'), ang, 1.66, 0.34, 384)
        print(f'[cabelo] miniatura {hid}')

print(f'[cabelo] concluído em {time.time() - t_start:.1f}s')
