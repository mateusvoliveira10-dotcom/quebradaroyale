"""Veículo enviado (modelo 3D gerado no Tripo) → carro do mapa, com vidros de verdade.

blender -b --python tools/blender/vehicle.py -- <id> <original.glb> <pasta public/assets/world> [--sem-previa] [--debug <pasta>]

<id> é uma das entradas de VEHICLES abaixo (fusca, viatura, ...).

Saída:
  <id>.glb                carroceria texturizada + vidros (Car_<id>), versão de longe (Car_<id>_lod1)
                          e Col_<id>_* (caixas de colisão), com as texturas reduzidas embutidas (JPEG)
  art/build/<id>_texturas/  cópia das texturas reduzidas
  art/build/<id>_previa/    conferência (frente, lado, 3/4, para-brisa, traseira)

Os modelos do Tripo vêm sem vidro nenhum: o para-brisa e as janelas são só a moldura, e
olhando de fora se via o interior com as palhetas "flutuando". Aqui cada abertura é
encontrada por raios (de frente, de trás e dos dois lados): o raio que atravessa a
abertura bate em algo bem para dentro do casco externo do carro (banco, painel, outro
lado). As aberturas viram máscaras; a moldura em volta de cada uma dá os pontos de
apoio de uma superfície lisa (quadrática, como um vidro curvo de verdade), e o vidro é
uma malha nessa superfície, um pouco para dentro da moldura e por baixo das palhetas.

Coordenadas do original (Blender): z para cima, frente em −Y. Na saída a frente fica em
−X (mesma convenção dos carros de `cars.py`) e o chão em z = 0.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
VID = args[0]
src, out_dir = os.path.abspath(args[1]), os.path.abspath(args[2])
make_preview = '--sem-previa' not in args
# --debug <pasta>: salva as máscaras de abertura de cada vista (para conferir a detecção)
DEBUG_DIR = os.path.abspath(args[args.index('--debug') + 1]) if '--debug' in args else None
if DEBUG_DIR:
    os.makedirs(DEBUG_DIR, exist_ok=True)
os.makedirs(out_dir, exist_ok=True)

# Retângulo (y0, y1, z0, z1) no espaço do original, lado esquerdo (−X), frente em −Y.
Box = tuple

VEHICLES = {
    # Comprimento real do Fusca é ~4,07 m, mas o modelo (gerado) é mais alto e largo que o
    # carro de verdade: escala uniforme que deixa o teto em ~1,68 m e o comprimento em ~3,5 m
    # (ao lado de um personagem de 1,75 m fica com a proporção de um Fusca).
    'fusca': dict(scale=3.6, tex=1024),
    # Viatura (SUV genérica): ~3,7 m de comprimento e teto em ~1,8 m. O lado direito veio com
    # o letreiro embaralhado ("APIUQ" no lugar de POLÍCIA, 153 e SEGURANÇA ilegíveis) e a
    # segunda linha embaixo de SEGURANÇA é ilegível nos dois lados: o lado direito é
    # repintado a partir do esquerdo (ver fix_livery) e a linha ilegível é apagada.
    'viatura': dict(scale=3.8, tex=2048, livery=dict(
        # letreiros do lado esquerdo: copiados para o direito sem espelhar
        text=[(-0.175, 0.095, 0.183, 0.259),   # POLÍCIA
              (0.245, 0.375, 0.266, 0.320),    # ☎ 153
              (-0.342, -0.228, 0.230, 0.274)], # SEGURANÇA PÚBLICA (pintado abaixo)
        # No paralama dianteiro o original diz "SEGUIRANDA" e a linha de baixo é ilegível:
        # o retângulo é repintado (fundo azul + texto certo) antes da cópia.
        paint=[dict(box=(-0.342, -0.228, 0.230, 0.274), lines=['SEGURANÇA', 'PÚBLICA'])],
    )),
    # Ambulância (furgão tipo Sprinter): ~5,1 m de comprimento e teto em ~2,7 m. O lado
    # direito veio com o letreiro embaralhado ("IIIBMICIA UMLA"): repintado a partir do
    # esquerdo, que diz AMBULÂNCIA certo.
    'ambulancia': dict(scale=5.2, tex=2048, livery=dict(
        text=[(-0.080, 0.248, 0.228, 0.280)],  # AMBULÂNCIA
    )),
    # Kombi (modelo enviado): ~4,2 m de comprimento e teto em ~2,05 m. Substitui a "perua"
    # de cars.py nas ruas.
    'kombi': dict(scale=4.2, tex=2048),
}
CFG = VEHICLES[VID]
SCALE = CFG['scale']
TARGET_TRIS = 40000
TEX = CFG['tex']
STEP = 0.002            # passo da grade de raios (unidades do original ≈ 7 mm no jogo)
INSIDE = 0.022          # ponto mais para dentro do casco que isso = atravessou uma abertura
INSET = 0.0018          # vidro um pouco para dentro da moldura

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
car = next(o for o in bpy.data.objects if o.type == 'MESH')
common.select_only(car)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
car.name = VID
me = car.data
co = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
print(f'[{VID}] original: {len(me.polygons)} faces, {len(co)} vértices')
dg = bpy.context.evaluated_depsgraph_get()
BVH = BVHTree.FromObject(car, dg)

zmin, zmax = co[:, 2].min(), co[:, 2].max()
H = zmax - zmin
print(f'[{VID}] caixa: x {co[:,0].min():.3f}..{co[:,0].max():.3f}  y {co[:,1].min():.3f}..{co[:,1].max():.3f}  z {zmin:.3f}..{zmax:.3f}')
# Linha da cintura (base das janelas), em unidades do original.
BELT = zmin + H * 0.6


def convex_hull(points):
    sample = points[np.random.default_rng(1).choice(len(points), min(len(points), 60000), replace=False)]
    hb = bmesh.new()
    for p in sample:
        hb.verts.new(p)
    bmesh.ops.convex_hull(hb, input=hb.verts)
    for v in [v for v in hb.verts if not v.link_faces]:
        hb.verts.remove(v)
    return BVHTree.FromBMesh(hb)


# Casco do carro inteiro (para o vidro não sair da pele do carro) e casco só da cabine,
# acima da cintura (para achar as aberturas: o capô do Fusca afunda entre os paralamas e,
# medido contra o casco do carro inteiro, parecia "interior").
HULL = convex_hull(co)
CABIN = convex_hull(co[co[:, 2] > BELT])


def signed(tree, p):
    """Distância com sinal até o casco: > 0 fora, < 0 dentro."""
    loc, n, _i, d = tree.find_nearest(Vector(p))
    if loc is None:
        return 0.0
    return d if (Vector(p) - loc).dot(n) > 0 else -d


def inside_depth(p):
    """Quanto o ponto está para dentro da cabine (0 se estiver fora dela)."""
    return max(0.0, -signed(CABIN, p))


def hull_offset(p):
    return signed(HULL, p)


# ------------------------------------------------------------------ máscaras de abertura
def view(axis, sign):
    """Grade de raios ao longo de `axis` (0 = x, 1 = y), andando no sentido `sign`.
    Devolve (u, v, pontos, abertura) com a grade em (eixo lateral, z)."""
    lat = 1 - axis
    u = np.arange(co[:, lat].min() - STEP, co[:, lat].max() + STEP, STEP)
    v = np.arange(zmin + H * 0.45, zmax + STEP, STEP)
    start = (co[:, axis].min() - 0.2) if sign > 0 else (co[:, axis].max() + 0.2)
    d = Vector((0, 0, 0))
    d[axis] = sign
    pts = np.full((len(v), len(u), 3), np.nan, np.float32)
    opening = np.zeros((len(v), len(u)), bool)
    seen = np.zeros((len(v), len(u)), bool)
    for j, z in enumerate(v):
        for i, w in enumerate(u):
            o = Vector((0, 0, z))
            o[axis] = start
            o[lat] = w
            # Só conta como abertura o raio que entra no casco da cabine (acima da cintura).
            # O ar ao lado do capô ou abaixo da cintura nunca entra nele (era o vidro solto
            # que aparecia fora do Fusca).
            entry = CABIN.ray_cast(o, d, 2.0)[3]
            hit, nrm, _f, dist = BVH.ray_cast(o, d, 2.0)
            if hit is not None:
                seen[j, i] = True
                pts[j, i] = hit[:]
            if entry is None:
                continue
            # O trecho do raio dentro da cabine tem que passar embaixo do teto: o casco
            # convexo da cabine também cobre o ar na frente da coluna do para-brisa, em cima
            # do capô, e o raio lateral ali não bate em nada (virava um vidro triangular).
            # (teto em cima, ou carro dos dois lados do raio — portas/colunas —, que vale para
            # a parte de baixo do para-brisa: dali para cima se sai pelo próprio para-brisa).
            far = dist if hit is not None else entry + 0.5
            mid = o + d * ((entry + far) / 2)
            side = Vector((0, 0, 0))
            side[lat] = 1
            roof = BVH.ray_cast(mid, Vector((0, 0, 1)), H)[0] is not None
            walls = BVH.ray_cast(mid, side, 1.0)[0] is not None and BVH.ray_cast(mid, -side, 1.0)[0] is not None
            if not (roof or walls):
                continue
            if hit is None:
                # entrou na cabine e saiu sem bater em nada: atravessou duas aberturas
                # (para-brisa e janela de trás, janela de um lado e do outro)
                opening[j, i] = True
                continue
            # Depois de entrar na cabine o raio ainda andou bastante até bater (banco, painel,
            # outro lado) — medido AO LONGO do raio: a distância até a face mais próxima do
            # casco errava nos bancos encostados no teto —, ou bateu no lado de dentro da
            # lataria (face virada para longe de quem olha: teto por dentro, moldura da janela
            # de trás vista pelo para-brisa).
            opening[j, i] = dist - entry > INSIDE or nrm.dot(d) > 0.05
    # Janela começa embaixo, perto da cintura. Um trecho de "abertura" numa coluna que só
    # começa lá em cima é o vão entre o teto e o rack/giroflex: não é janela.
    low = BELT + 0.45 * (zmax - BELT)
    for i in range(len(u)):
        col = opening[:, i]
        j = 0
        while j < len(v):
            if not col[j]:
                j += 1
                continue
            k = j
            while k < len(v) and col[k]:
                k += 1
            if v[j] > low:
                col[j:k] = False
            j = k
    solid = seen & ~opening
    return u, v, pts, opening, lat, solid


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def erode(m, r):
    return ~dilate(~m, r)


def components(m):
    lab = np.zeros(m.shape, np.int32)
    n = 0
    for s in zip(*np.nonzero(m)):
        if lab[s]:
            continue
        n += 1
        stack = [s]
        lab[s] = n
        while stack:
            y, x = stack.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
    return lab, n


def fit_quadratic(uu, vv, dd):
    """Superfície do vidro: primeiro um plano robusto (o vidro do Fusca é quase plano), que
    descarta pontos que não são da moldura — teto atingido de raspão acima do para-brisa,
    palhetas, retrovisor —, depois uma curvatura leve só com os pontos que sobraram."""
    P = np.stack([np.ones_like(uu), uu, vv], 1)
    keep = np.ones(len(dd), bool)
    for _ in range(8):
        c3, *_ = np.linalg.lstsq(P[keep], dd[keep], rcond=None)
        res = np.abs(P @ c3 - dd)
        keep = res <= max(np.quantile(res[keep], 0.6), 0.002)
    inl = np.abs(P @ c3 - dd) < 0.006
    A = np.stack([np.ones_like(uu), uu, vv, uu * uu, vv * vv, uu * vv], 1)
    if inl.sum() > 60:
        coef, *_ = np.linalg.lstsq(A[inl], dd[inl], rcond=None)
        # curvatura demais (moldura irregular) → fica no plano
        if np.abs(A[inl] @ coef - dd[inl]).max() < 0.008 and np.abs(coef[3:]).max() < 3:
            return coef
    return np.concatenate([c3, np.zeros(3)])


def surface(coef, x, z):
    return coef @ np.array([1, x, z, x * x, z * z, x * z])


def glass_from_view(name, axis, sign, max_parts, close, keep=lambda p: True):
    u, v, pts, opening, lat, solid = view(axis, sign)
    # fecha buracos finos (palhetas, colunas finas das portas) e tira ruído
    mask = erode(dilate(opening, close), close)
    mask = dilate(erode(mask, 2), 2)
    lab, n = components(mask)
    if DEBUG_DIR:
        # vermelho = abertura bruta, verde = superfície sólida, azul = máscara final
        img = np.stack([opening, solid, mask], -1).astype(np.float32)
        h, w = img.shape[:2]
        im = bpy.data.images.new(f'dbg_{name}', w, h, alpha=False)
        rgba = np.ones((h, w, 4), np.float32)
        rgba[..., :3] = img
        im.pixels.foreach_set(rgba.ravel())
        im.filepath_raw = os.path.join(DEBUG_DIR, f'mascara_{name.replace(" ", "_")}.png')
        im.file_format = 'PNG'
        im.save()
    sizes = sorted(((int((lab == k).sum()), k) for k in range(1, n + 1)), reverse=True)
    min_px = int((0.03 / STEP) ** 2)      # janelas de pelo menos ~10 × 10 cm no jogo
    parts = [k for s, k in sizes[:max_parts] if s >= min_px]
    verts, faces = [], []
    fit = None
    for k in parts:
        comp = lab == k
        # apoio só na moldura de verdade (superfície do carro, não o interior)
        ring = dilate(comp, 3) & ~comp & solid
        jj, ii = np.nonzero(ring)
        rp = pts[jj, ii]
        # Teto atingido de raspão logo acima do para-brisa fica bem mais para trás que a
        # moldura: só vale apoio perto da profundidade mediana da moldura.
        rp = rp[np.abs(rp[:, axis] - np.median(rp[:, axis])) < 0.05]
        coef = fit_quadratic(rp[:, lat], rp[:, 2], rp[:, axis])
        fit = coef if fit is None else fit
        area = dilate(comp, 1)                # passa um pouco por baixo da moldura
        index = -np.ones(comp.shape, np.int64)
        for j, i in zip(*np.nonzero(area)):
            uu, zz = u[i], v[j]
            depth = coef @ np.array([1, uu, zz, uu * uu, zz * zz, uu * zz]) + sign * INSET
            p = [0.0, 0.0, zz]
            p[axis] = depth
            p[lat] = uu
            index[j, i] = len(verts)
            verts.append(p)
        # O vidro fica na pele do carro: vértice fora do casco (vidro solto no ar, ao lado do
        # capô) ou muito para dentro dele (painel, banco) não entra.
        # (o limite de dentro é a distância até a malha de verdade: num SUV de capô comprido o
        # casco convexo passa bem à frente do para-brisa)
        ok = {idx: hull_offset(verts[idx]) < 0.004 and BVH.find_nearest(Vector(verts[idx]))[3] < 0.08 and keep(verts[idx])
              for idx in index[index >= 0]}
        for j in range(comp.shape[0] - 1):
            for i in range(comp.shape[1] - 1):
                q = [index[j, i], index[j, i + 1], index[j + 1, i + 1], index[j + 1, i]]
                if min(q) >= 0 and all(ok[x] for x in q):
                    faces.append(q if sign > 0 else q[::-1])
        print(f'[{VID}] vidro {name}: {int(comp.sum())} px, apoio em {len(rp)} pontos da moldura')
    return verts, faces, fit


all_v, all_f = [], []
# Fechamento menor de frente/trás: a coluna do para-brisa (fina vista de frente) tem que
# separar o vidro da região ao lado dela. O para-brisa fica na metade da frente e o vidro
# de trás na de trás.
wv, wf, WIND = glass_from_view('para-brisa', 1, 1, 1, 2, keep=lambda p: p[1] < 0.0)
rv, rf, REAR = glass_from_view('traseiro', 1, -1, 1, 2, keep=lambda p: p[1] > 0.1)
for nm, cf in (('para-brisa', WIND), ('traseiro', REAR)):
    if cf is None:
        print(f'[{VID}]   {nm}: sem abertura (o modelo já tem vidro ali ou não tem janela)')
        continue
    print(f'[{VID}]   plano {nm}: y no centro = {surface(cf, 0, BELT + 0.03):.3f} (embaixo) .. {surface(cf, 0, zmax - 0.04):.3f} (em cima)')


def side_keep(p):
    # Janelas laterais: perto da lateral do carro e entre o para-brisa e o vidro de trás
    # (o ajuste lateral escapava para a frente do para-brisa e para o meio do capô).
    x, y, z = p
    front = surface(WIND, x, z) + 0.01 if WIND is not None else -1.0
    back = surface(REAR, x, z) - 0.01 if REAR is not None else 1.0
    return abs(x) > 0.12 and front < y < back


views = [('para-brisa', wv, wf), ('traseiro', rv, rf)]
for name, axis, sign in (('lado +x', 0, -1), ('lado -x', 0, 1)):
    vs, fs, _ = glass_from_view(name, axis, sign, 4, 4, keep=side_keep)
    views.append((name, vs, fs))
for name, vs, fs in views:
    if fs:
        used = np.array([vs[i] for f in fs for i in f])
        print(f'[{VID}]   {name}: x {used[:,0].min():.3f}..{used[:,0].max():.3f} y {used[:,1].min():.3f}..{used[:,1].max():.3f} z {used[:,2].min():.3f}..{used[:,2].max():.3f}')
    off = len(all_v)
    all_v += vs
    all_f += [[i + off for i in f] for f in fs]
gme = bpy.data.meshes.new('Vidros')
gme.from_pydata(all_v, [], all_f)
gme.update()
glass = bpy.data.objects.new('Vidros', gme)
bpy.context.collection.objects.link(glass)
# grade fina → poucas faces (o vidro é liso)
common.select_only(glass)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
dec = glass.modifiers.new('reducao', 'DECIMATE')
dec.ratio = 0.08
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in glass.data.polygons:
    p.use_smooth = True
print(f'[{VID}] vidros: {len(glass.data.polygons)} faces')

# ------------------------------------------------------------------ carroceria leve
common.select_only(car)
ratio = TARGET_TRIS / max(1, len(me.polygons))
dec = car.modifiers.new('reducao', 'DECIMATE')
dec.ratio = ratio
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in car.data.polygons:
    p.use_smooth = True
print(f'[{VID}] carroceria: {len(car.data.polygons)} faces')

# ------------------------------------------------------------------ letreiro
def text_mask(lines, aspect, h=120):
    """Máscara (0..1, linha 0 = embaixo) com o texto branco centralizado, renderizada numa
    cena à parte (objeto de texto do Blender, fonte em negrito do sistema se houver)."""
    w = max(8, int(h * aspect))
    sc = bpy.data.scenes.new('texto')
    cu = bpy.data.curves.new('texto', 'FONT')
    cu.body = '\n'.join(lines)
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.space_line = 0.95
    for f in ('C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf'):
        if os.path.exists(f):
            cu.font = bpy.data.fonts.load(f)
            break
    ob = bpy.data.objects.new('texto', cu)
    sc.collection.objects.link(ob)
    cam = bpy.data.objects.new('cam_texto', bpy.data.cameras.new('cam_texto'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.view_layers[0].update()
    dims = ob.dimensions
    cam.data.type = 'ORTHO'
    # margem: o retângulo encosta na borda do paralama
    cam.data.ortho_scale = max(dims.x * 1.3, dims.y * 1.3 * aspect)
    cam.location = (0, 0, 10)
    world = bpy.data.worlds.new('preto')
    world.color = (0, 0, 0)
    sc.world = world
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (1, 1, 1)
    sc.view_settings.view_transform = 'Standard'
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.image_settings.file_format = 'PNG'
    path = os.path.join(bpy.app.tempdir, f'texto_{abs(hash(cu.body))}.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    img = bpy.data.images.load(path)
    m = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[..., 0]
    bpy.data.images.remove(img)
    bpy.data.scenes.remove(sc)
    return np.clip(m, 0, 1)


def in_box(y, z, b):
    return (y >= b[0]) & (y <= b[1]) & (z >= b[2]) & (z <= b[3])


def fix_livery(obj, img, liv):
    """Repinta o lado direito (+X) a partir do esquerdo (−X), que veio correto.

    Para cada texel da textura acha o ponto 3D da carroceria que ele pinta (malha já
    reduzida, com a UV final). Texel do lado direito recebe a cor do ponto espelhado do lado
    esquerdo (−x, y, z). Dentro de um letreiro, a posição ao longo do carro também é
    espelhada dentro do retângulo do texto: sem isso a palavra sairia de trás para frente
    (vista do lado direito, a frente do carro fica do outro lado da imagem)."""
    R = img.size[0]
    src_px = np.array(img.pixels[:], np.float32).reshape(R, R, 4)
    me = obj.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    vco = np.array([v.co[:] for v in me.vertices], np.float32)
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    tuv = np.array([[uvl[li].uv[:] for li in t.loops] for t in me.loop_triangles], np.float32)
    tno = np.array([t.normal[:] for t in me.loop_triangles], np.float32)
    pos = np.full((R, R, 3), np.nan, np.float32)
    nrm = np.zeros((R, R, 3), np.float32)
    for k, t in enumerate(tris):
        uv = tuv[k] * R
        x0, y0 = np.floor(uv.min(0)).astype(int)
        x1, y1 = np.ceil(uv.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, R - 1), min(y1, R - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = uv
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.01) & (w1 >= -0.01) & (w2 >= -0.01)
        if not inside.any():
            continue
        P = w0[..., None] * vco[t[0]] + w1[..., None] * vco[t[1]] + w2[..., None] * vco[t[2]]
        sub = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sub][inside] = P[inside]
        nrm[sub][inside] = tno[k]
    have = ~np.isnan(pos[..., 0])
    X, Y, Z = pos[..., 0], pos[..., 1], pos[..., 2]
    px = src_px.copy()

    # 1) linha ilegível do lado esquerdo: cor do fundo (mediana dos texels azulados da caixa)
    left = have & (X < -0.02) & (nrm[..., 0] < -0.25)
    for b in liv.get('erase', []):
        m = left & in_box(Y, Z, b)
        cols = px[m][:, :3]
        bg = cols[cols[:, 2] > cols[:, 0] + 0.1]
        fill = np.median(bg if len(bg) > 10 else cols, 0)
        px[m, :3] = fill
        print(f'[{VID}] letreiro: apagados {int(m.sum())} texels (fundo {np.round(fill, 2)})')
    for spec in liv.get('paint', []):
        b = spec['box']
        m = left & in_box(Y, Z, b)
        cols = px[m][:, :3]
        bgc = cols[cols[:, 2] > cols[:, 0] + 0.1]
        bg = np.median(bgc if len(bgc) > 10 else cols, 0)
        aspect = (b[1] - b[0]) / (b[3] - b[2])
        mask = text_mask(spec['lines'], aspect)
        mh, mw = mask.shape
        # Visto do lado esquerdo a frente (−y) fica à direita: o texto corre de +y para −y.
        uu = (b[1] - Y[m]) / (b[1] - b[0])
        vv = (Z[m] - b[2]) / (b[3] - b[2])
        a = mask[np.clip((vv * mh).astype(int), 0, mh - 1), np.clip((uu * mw).astype(int), 0, mw - 1)][:, None]
        px[m, :3] = bg * (1 - a) + np.array([0.97, 0.97, 0.97]) * a
        print(f'[{VID}] letreiro: "{" ".join(spec["lines"])}" pintado em {int(m.sum())} texels')

    # 2) lado direito a partir do esquerdo (já limpo)
    bvh = BVHTree.FromPolygons(vco.tolist(), tris)
    right = have & (X > 0.02) & (nrm[..., 0] > 0.25)
    jj, ii = np.nonzero(right)
    qs = pos[jj, ii].copy()
    qs[:, 0] *= -1
    for b in liv.get('text', []):
        m = in_box(qs[:, 1], qs[:, 2], b)
        qs[m, 1] = b[0] + b[1] - qs[m, 1]

    def bilinear(u, v):
        x = np.clip(u * R - 0.5, 0, R - 1.001)
        y = np.clip(v * R - 0.5, 0, R - 1.001)
        x0 = x.astype(int)
        y0 = y.astype(int)
        fx = (x - x0)[:, None]
        fy = (y - y0)[:, None]
        a = px[y0, x0] * (1 - fx) + px[y0, x0 + 1] * fx
        c = px[y0 + 1, x0] * (1 - fx) + px[y0 + 1, x0 + 1] * fx
        return a * (1 - fy) + c * fy

    us = np.empty(len(qs), np.float32)
    vs = np.empty(len(qs), np.float32)
    ok = np.zeros(len(qs), bool)
    for n, q in enumerate(qs):
        loc, _nn, idx, _d = bvh.find_nearest(Vector(q))
        if loc is None:
            continue
        a, b2, c2 = (Vector(vco[i]) for i in tris[idx])
        # baricêntricas de loc no triângulo idx
        v0, v1, v2 = b2 - a, c2 - a, loc - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-14:
            continue
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        wa = 1 - wb - wc
        uv = wa * tuv[idx][0] + wb * tuv[idx][1] + wc * tuv[idx][2]
        us[n], vs[n] = uv
        ok[n] = True
    cols = bilinear(us[ok], vs[ok])
    out = px.copy()
    out[jj[ok], ii[ok]] = cols
    img.pixels.foreach_set(out.ravel())
    img.update()
    print(f'[{VID}] letreiro: lado direito repintado ({int(ok.sum())} texels)')


# ------------------------------------------------------------------ texturas e materiais
mat = car.data.materials[0]
mat.name = f'{VID}_body'
for node in mat.node_tree.nodes:
    if node.type == 'TEX_IMAGE' and node.image:
        img = node.image
        nm = img.name.lower()
        kind = 'normal' if 'normal' in nm else 'rm' if '_rm' in nm else 'basecolor'
        # só a cor ganha resolução maior (letreiros legíveis); relevo e rugosidade em 1024
        size = TEX if kind == 'basecolor' else min(TEX, 1024)
        img.scale(size, size)
        if kind == 'basecolor' and 'livery' in CFG:
            fix_livery(car, img, CFG['livery'])
        ext = 'png' if kind == 'normal' else 'jpg'
        # cópia para conferência (o jogo usa as texturas embutidas no GLB)
        tex_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', 'build', f'{VID}_texturas')
        os.makedirs(tex_dir, exist_ok=True)
        path = os.path.join(tex_dir, f'{VID}_{kind}.{ext}')
        img.filepath_raw = path
        img.file_format = 'PNG' if ext == 'png' else 'JPEG'
        img.save()
        # A imagem veio embutida no GLB original: o exportador reaproveitava esses bytes
        # (textura sem a correção do letreiro). Passa a ler o arquivo corrigido/reduzido.
        if img.packed_file:
            img.unpack(method='REMOVE')
        img.filepath = path
        img.reload()
        print(f'[{VID}] textura {kind}: {path}')
gmat = bpy.data.materials.new(f'{VID}_glass')
gmat.use_nodes = True
bsdf = next(n for n in gmat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (0.05, 0.07, 0.08, 1)
bsdf.inputs['Roughness'].default_value = 0.05
bsdf.inputs['Alpha'].default_value = 0.45
gmat.blend_method = 'BLEND'
glass.data.materials.append(gmat)

# ------------------------------------------------------------------ escala, frente em −X, chão em 0
# gira −90° em z: a frente (−Y) vai para −X
xf = Matrix.Scale(SCALE, 4) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation((-(co[:, 0].min() + co[:, 0].max()) / 2, -(co[:, 1].min() + co[:, 1].max()) / 2, -zmin))
for o in (car, glass):
    o.data.transform(xf)
    o.data.update()

# Colisores: corpo (até a cintura) e cabine (mais estreita), no espaço final.
bco = np.array([v.co[:] for v in car.data.vertices])
L0, L1 = bco[:, 0].min(), bco[:, 0].max()
W = bco[:, 1].max() - bco[:, 1].min()
top = bco[:, 2].max()
belt = top * 0.55
cab = bco[bco[:, 2] > belt + 0.1]
cols = [
    (f'Col_{VID}_1', ((L0 + L1) / 2, 0, belt / 2 + 0.05), (L1 - L0 - 0.1, W * 0.86, belt - 0.1)),
    (f'Col_{VID}_2', ((cab[:, 0].min() + cab[:, 0].max()) / 2, 0, (belt + top) / 2), (cab[:, 0].max() - cab[:, 0].min(), W * 0.7, top - belt)),
]
col_objs = []
for name, c, s in cols:
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    col_objs.append(o)
print(f'[{VID}] tamanho final: {L1 - L0:.2f} × {W:.2f} × {top:.2f} m')

# o vidro faz parte do carro (um objeto com dois materiais)
common.select_only(car)
glass.select_set(True)
bpy.context.view_layer.objects.active = car
bpy.ops.object.join()
car.name = f'Car_{VID}'

# Versão leve para longe (o jogo troca a partir de ~70 m): mesma textura, ~6 mil triângulos.
lod = car.copy()
lod.data = car.data.copy()
lod.name = f'Car_{VID}_lod1'
bpy.context.collection.objects.link(lod)
common.select_only(lod)
dec = lod.modifiers.new('reducao', 'DECIMATE')
dec.ratio = 6000 / max(1, len(lod.data.polygons))
bpy.ops.object.modifier_apply(modifier=dec.name)
print(f'[{VID}] versão de longe: {len(lod.data.polygons)} faces')

for o in bpy.context.view_layer.objects:
    o.select_set(o in [car, lod] + col_objs)
glb = os.path.join(out_dir, f'{VID}.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True,
                          export_image_format='JPEG', export_jpeg_quality=85, export_materials='EXPORT', export_apply=True)
print(f'[{VID}] exportado {glb} ({os.path.getsize(glb) / 1e6:.2f} MB)')

# ------------------------------------------------------------------ prévia
if make_preview:
    for o in col_objs:
        o.hide_render = True
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 800, 520
    scene.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
    scene.world = world
    sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (0.9, 0.2, 0.7)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    prev = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', 'build', f'{VID}_previa')
    os.makedirs(prev, exist_ok=True)
    c = Vector(((L0 + L1) / 2, 0, top / 2))
    for nm, d, lens in (('tres_quartos', Vector((-0.8, -0.6, 0.35)), 40), ('frente', Vector((-1, 0, 0.2)), 50),
                        ('lado', Vector((0, -1, 0.1)), 40), ('parabrisa', Vector((-0.75, -0.25, 0.45)), 85),
                        ('traseira', Vector((0.8, 0.5, 0.35)), 40)):
        cam.location = c + d.normalized() * 8.5
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.render.filepath = os.path.join(prev, f'{nm}.png')
        bpy.ops.render.render(write_still=True)
print(f'[{VID}] concluído')
