"""Óculos do personagem: modelo 3D enviado (Tripo) → malha leve, encaixada no rosto do manequim.

blender -b --python tools/blender/glasses.py -- <personagem-base.blend> <oculos-original.glb> <pasta de saída>

Saída (em public/assets/customization/glasses/):
  glasses_base.glb     três malhas no espaço do personagem, com origem no centro dos olhos
                       (1,615 m): Oculos_Armacao, Oculos_Detalhe e Oculos_Lente
  <id>/thumb.webp      miniatura de cada variação de cor, no rosto do manequim

Etapas: redução da malha (1,96 mi → ~16 mil triângulos), separação das peças pela cor da
textura original e pela posição (lente = roxo saturado dentro dos aros; detalhe = roxo da
ponte, dobradiças e hastes; o resto é armação), escala pela largura do rosto, ponte apoiada
no nariz, lentes alinhadas aos olhos, hastes dobradas para acompanhar a lateral da cabeça
(e passar por fora das orelhas) e verificação de distância mínima à pele.
Coordenadas do Blender: z para cima, frente em −Y, esquerda do personagem em +X.
"""
import colorsys
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
src_blend, src_glb, out_dir = (os.path.abspath(a) for a in args[:3])
make_thumbs = '--sem-miniaturas' not in args
t_start = time.time()
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=src_blend)
body = bpy.data.objects['Corpo']
rig = bpy.data.objects['Esqueleto']
rig.data.pose_position = 'REST'
dg = bpy.context.evaluated_depsgraph_get()
BODY_BVH = BVHTree.FromObject(body, dg)
body_co = np.array([v.co[:] for v in body.data.vertices])

# Medidas do rosto (repouso). Altura dos olhos e ponte do nariz medidas na malha do jogo.
EYE_Z = 1.615
EYE_HALF = 0.050           # meia distância entre os olhos
# Largura total da frente (dobradiça a dobradiça). A cabeça cartoon do manequim é maior
# que a de uma pessoa real (~19 cm nas têmporas): com a medida "real" (15 cm) os óculos
# pareciam pequenos demais.
FRAME_WIDTH = 0.186
NOSE_GAP = 0.0025          # ponte a ~2,5 mm do nariz
TEMPLE_GAP = 0.003         # hastes a 3 mm da pele / orelha
MIN_GAP = 0.0015           # nenhum ponto mais perto que isso da pele
TEMPLE_END = 0.088         # ponta das hastes (y), ~2 cm atrás da orelha
HOOK_Y = 0.058             # a partir daqui (atrás da orelha) a haste desce
HOOK_DROP = 0.024          # quanto a ponta desce

# ------------------------------------------------------------------ importação e redução
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=src_glb)
glasses = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
glasses.name = 'OculosOriginal'
common.select_only(glasses)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tris0 = sum(len(p.vertices) - 2 for p in glasses.data.polygons)
for ratio in (0.05, 0.16):
    dec = glasses.modifiers.new('reducao', 'DECIMATE')
    dec.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=dec.name)
tris1 = sum(len(p.vertices) - 2 for p in glasses.data.polygons)
print(f'[oculos] malha reduzida de {tris0} para {tris1} triângulos')
# limpeza: vértices duplicados e normais consistentes para fora (a redução deixa faces invertidas)
_bm = bmesh.new()
_bm.from_mesh(glasses.data)
bmesh.ops.remove_doubles(_bm, verts=_bm.verts, dist=0.0004)
bmesh.ops.recalc_face_normals(_bm, faces=_bm.faces)
_bm.to_mesh(glasses.data)
_bm.free()


def taubin(obj, iters, lam=0.5, mu=-0.53):
    """Suavização que não encolhe (bordas fixas): tira o ruído da redução da malha."""
    b = bmesh.new()
    b.from_mesh(obj.data)
    b.verts.ensure_lookup_table()
    vs = list(b.verts)
    nbr = [[e.other_vert(v).index for e in v.link_edges] for v in vs]
    fixed = [v.is_boundary for v in vs]
    P = np.array([v.co[:] for v in vs])
    for _ in range(iters):
        for k in (lam, mu):
            avg = np.array([P[n].mean(0) if (n and not f) else P[i] for i, (n, f) in enumerate(zip(nbr, fixed))])
            P = P + k * (avg - P)
    for v, p in zip(vs, P):
        v.co = p
    b.to_mesh(obj.data)
    b.free()

# ------------------------------------------------------------------ separação por cor + posição
# textura de cor do próprio material dos óculos (o .blend do personagem tem outras imagens)
mat0 = glasses.data.materials[0]
bsdf0 = next(n for n in mat0.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
img = next(l.from_node.image for l in mat0.node_tree.links if l.to_socket == bsdf0.inputs['Base Color'] and l.from_node.type == 'TEX_IMAGE')
img.scale(1024, 1024)
px = np.array(img.pixels[:], np.float32).reshape(1024, 1024, 4)[..., :3]
me = glasses.data
uvl = me.uv_layers.active.data
co = np.array([v.co[:] for v in me.vertices])
front_y = co[:, 1].min()
LENS, FRAME, ACCENT = 0, 1, 2
labels = []
for p in me.polygons:
    uvs = np.array([uvl[li].uv[:] for li in p.loop_indices]).mean(0)
    x = int(np.clip(uvs[0], 0, 0.999) * 1024)
    y = int(np.clip(uvs[1], 0, 0.999) * 1024)
    r, g, b = px[y, x]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    c = p.center
    purple = s > 0.28 and (h > 0.55 and h < 0.97)
    in_lens = 0.09 < abs(c.x) < 0.43 and 0.015 < c.z < 0.235 and c.y < front_y + 0.16
    if purple and in_lens:
        labels.append(LENS)
    elif purple:
        labels.append(ACCENT)
    else:
        labels.append(FRAME)
labels = np.array(labels)
# limpeza: maioria entre vizinhos (tira ruído de retalhos da textura)
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
nb = [[g.index for e in f.edges for g in e.link_faces if g.index != f.index] for f in bm.faces]
for _ in range(12):
    new = labels.copy()
    for i, ns in enumerate(nb):
        if ns:
            vals, counts = np.unique(labels[ns], return_counts=True)
            if counts.max() > len(ns) / 2:
                new[i] = vals[counts.argmax()]
    labels = new
# Ilhas pequenas de armação/detalhe (retalhos da textura original, que deixavam as peças
# pintalgadas com as cores novas) passam para a cor da vizinhança.
for _ in range(3):
    seen = np.zeros(len(labels), bool)
    for start in range(len(labels)):
        if seen[start] or labels[start] == LENS:
            continue
        comp, stack = [], [start]
        seen[start] = True
        while stack:
            f = stack.pop()
            comp.append(f)
            for g in nb[f]:
                if not seen[g] and labels[g] == labels[start]:
                    seen[g] = True
                    stack.append(g)
        if len(comp) >= 60:
            continue
        border = [labels[g] for f in comp for g in nb[f] if labels[g] != labels[start] and labels[g] != LENS]
        if border:
            vals, counts = np.unique(border, return_counts=True)
            labels[comp] = vals[counts.argmax()]
bm.free()
print(f'[oculos] faces: lente {int((labels == LENS).sum())}, armação {int((labels == FRAME).sum())}, detalhe {int((labels == ACCENT).sum())}')

# ------------------------------------------------------------------ escala e posição no rosto
front_mask = co[:, 1] < front_y + 0.18
fw = co[front_mask, 0].max() - co[front_mask, 0].min()
scale = FRAME_WIDTH / fw
lens_faces = [p for p, lb in zip(me.polygons, labels) if lb == LENS]
lens_c = np.array([p.center[:] for p in lens_faces])
lens_cz = lens_c[:, 2].mean()
lens_cx = np.abs(lens_c[:, 0]).mean()
print(f'[oculos] frente {fw:.3f} un → escala {scale:.4f}; lentes em ±{lens_cx * scale:.3f} m (olhos em ±{EYE_HALF})')
co = co * scale
co[:, 2] += EYE_Z - lens_cz * scale
# Profundidade: a frente dos óculos encosta no rosto. Para cada ponto da frente, um raio
# vindo da frente acha a pele na mesma (x, z); os óculos vão para trás até o ponto mais
# apertado ficar a NOSE_GAP da pele. (Antes a ponte encostava na frente do nariz medida
# numa faixa de 4 cm de altura, que pegava a descida do nariz: lentes ~2 cm longe dos olhos.)
lens_vids = {i for p, lb in zip(me.polygons, labels) if lb == LENS for i in p.vertices}
hinge_y = co[list(lens_vids), 1].max() + 0.004
need, worst = -1.0, None
for c in co[co[:, 1] < hinge_y]:
    hit = BODY_BVH.ray_cast(Vector((c[0], -0.4, c[2])), Vector((0, 1, 0)))[0]
    if hit is not None and c[1] - (hit.y - NOSE_GAP) > need:
        need, worst = c[1] - (hit.y - NOSE_GAP), (c, hit)
print(f'[oculos] ponto mais apertado {np.round(worst[0], 3)} pele {np.round(worst[1][:], 3)}')
co[:, 1] -= need
hinge_y -= need
print(f'[oculos] frente encostada no rosto (deslocamento {-need * 1000:+.1f} mm em y)')
# ------------------------------------------------------------------ comprimento das hastes
# As hastes do modelo original são curtas: no manequim terminavam antes da orelha e os
# óculos pareciam soltos. Cada haste é esticada a partir da dobradiça até passar da orelha
# (a orelha vai de y≈0,02 a 0,065 m).
for side in (1, -1):
    idx = np.where((co[:, 1] > hinge_y) & (np.sign(co[:, 0]) == side))[0]
    end = co[idx, 1].max()
    s = (TEMPLE_END - hinge_y) / (end - hinge_y)
    co[idx, 1] = hinge_y + (co[idx, 1] - hinge_y) * s
    print(f'[oculos] haste {"esquerda" if side > 0 else "direita"}: terminava em y={end:.3f}, esticada ×{s:.2f}')
for v, c in zip(me.vertices, co):
    v.co = Vector(c)
me.update()

# ------------------------------------------------------------------ hastes acompanhando a cabeça
# Perfil lateral da cabeça (inclui orelhas) por profundidade, na altura das hastes.
temple =co[:, 1] > co[:, 1].min() + 0.028          # atrás da frente da armação (~2,8 cm)
tz = np.median(co[temple, 2])
band = body_co[np.abs(body_co[:, 2] - tz) < 0.012]


def head_half(y):
    s = band[np.abs(band[:, 1] - y) < 0.006]
    return np.abs(s[:, 0]).max() if len(s) else 0.0


ys = co[temple, 1]
y0, y1 = ys.min(), ys.max()
bins = np.linspace(y0, y1, 40)
for side in (1, -1):
    sel = temple & (np.sign(co[:, 0]) == side)
    idx = np.where(sel)[0]
    # centro atual da haste e alvo (lateral da cabeça + folga) por fatia de profundidade
    for a, b in zip(bins[:-1], bins[1:]):
        sl = idx[(co[idx, 1] >= a) & (co[idx, 1] < b + 1e-9)]
        if not len(sl):
            continue
        yc = (a + b) / 2
        xc = co[sl, 0].mean()
        half_w = np.abs(co[sl, 0] - xc).max()
        target = side * (head_half(yc) + TEMPLE_GAP + half_w)
        k = min(1.0, (yc - y0) / 0.015)              # transição suave a partir da dobradiça
        k = k * k * (3 - 2 * k)
        # só aproxima (nunca abre mais do que a haste original junto à dobradiça)
        new_c = xc + (target - xc) * k
        co[sl, 0] += new_c - xc
# Ponteira: atrás da orelha a haste desce, abraçando a orelha como num óculos de verdade.
tip = co[:, 1] > HOOK_Y
t = (co[tip, 1] - HOOK_Y) / (TEMPLE_END - HOOK_Y)
co[tip, 2] -= HOOK_DROP * t * t
for v, c in zip(me.vertices, co):
    v.co = Vector(c)
me.update()

# ------------------------------------------------------------------ distância mínima à pele
pushed = 0
inside = 0
gaps = []
for v in me.vertices:
    loc, nrm, _, dist = BODY_BVH.find_nearest(v.co)
    if loc is None:
        continue
    d = (v.co - loc).dot(nrm)
    if d < 0:
        inside += 1
    if d < MIN_GAP:
        v.co = loc + nrm * MIN_GAP
        pushed += 1
        d = MIN_GAP
    gaps.append(d)
me.update()
print(f'[oculos] {inside} vértices estavam dentro da pele, {pushed} ajustados; folga mínima {min(gaps) * 1000:.1f} mm')

def fit_lens(obj):
    """Cada lente vira uma superfície curva lisa: ajusta y = f(x, z) (quadrática) por mínimos
    quadrados aos próprios vértices e projeta os vértices nela, mantendo x e z."""
    vs = obj.data.vertices
    P = np.array([v.co[:] for v in vs])
    for side in (1, -1):
        sel = np.sign(P[:, 0]) == side
        if sel.sum() < 10:
            continue
        x, y, z = P[sel, 0], P[sel, 1], P[sel, 2]
        A = np.stack([np.ones_like(x), x, z, x * x, z * z, x * z], 1)
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        P[sel, 1] = A @ coef
        print(f'[oculos] lente {"esquerda" if side > 0 else "direita"}: desvio médio corrigido '
              f'{np.abs(A @ coef - y).mean() * 1000:.2f} mm')
    for v, p in zip(vs, P):
        v.co = Vector(p)
    obj.data.update()


# ------------------------------------------------------------------ separação em três malhas
parts = {}
for lb, name in ((FRAME, 'Oculos_Armacao'), (ACCENT, 'Oculos_Detalhe'), (LENS, 'Oculos_Lente')):
    o = glasses.copy()
    o.data = glasses.data.copy()
    o.name = o.data.name = name
    bpy.context.collection.objects.link(o)
    b2 = bmesh.new()
    b2.from_mesh(o.data)
    b2.faces.ensure_lookup_table()
    kill = [f for f, l in zip(b2.faces, labels) if l != lb]
    bmesh.ops.delete(b2, geom=kill, context='FACES')
    b2.to_mesh(o.data)
    b2.free()
    # lente: superfície lisa de verdade (o espelho mostra qualquer ondulação); armação e
    # detalhes: suavização leve, para manter os relevos
    if lb == LENS:
        fit_lens(o)
    else:
        taubin(o, 3)
    # a suavização mexe um pouco nos vértices: confere de novo a distância mínima à pele
    for v in o.data.vertices:
        loc, nrm, _, _ = BODY_BVH.find_nearest(v.co)
        if loc is not None and (v.co - loc).dot(nrm) < MIN_GAP:
            v.co = loc + nrm * MIN_GAP
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.clear()
    m = bpy.data.materials.new(name)
    o.data.materials.append(m)
    # origem no centro dos olhos (o jogo prende num nó nesse ponto)
    o.data.transform(__import__('mathutils').Matrix.Translation((0, 0, -EYE_Z)))
    o.location = (0, 0, EYE_Z)
    parts[name] = o
bpy.data.objects.remove(glasses, do_unlink=True)

for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in parts.values():
    o.location = (0, 0, 0)
    o.select_set(True)
glb = os.path.join(out_dir, 'glasses_base.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True,
                          export_texcoords=False, export_normals=True, export_materials='PLACEHOLDER',
                          export_animations=False, export_morph=False, export_skins=False)
print(f'[oculos] exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

# ------------------------------------------------------------------ variações e miniaturas
# id: (armação, metal da armação, detalhe, lente, espelhado)
# As 10 variações das referências (mesmas cores de src/customization/glasses.ts).
VARIANTS = {
    'lupa_grafite': ('#1e1f23', 0.55, '#2a2c31', '#15171b', 0.3),
    'lupa_rosa': ('#26272c', 0.7, '#ff2d95', '#ff3fd0', 0.95),
    'lupa_dourada': ('#c9cdd2', 1.0, '#d9a520', '#f0b91e', 0.95),
    'lupa_titanio': ('#c4c7cb', 1.0, '#a8895a', '#1c1d21', 0.35),
    'lupa_verde': ('#44474d', 0.9, '#44474d', '#2fd64a', 0.95),
    'lupa_azul': ('#5a5e66', 0.95, '#5a5e66', '#1f6bff', 0.95),
    'lupa_ciano': ('#dfe2e6', 1.0, '#dfe2e6', '#39c6ff', 0.95),
    'lupa_vermelha': ('#b3121b', 0.9, '#b3121b', '#ff3a14', 0.95),
    'lupa_roxa': ('#26272c', 0.7, '#7b2fd6', '#6a2cff', 0.95),
    'lupa_ambar': ('#c4c7cb', 1.0, '#c4c7cb', '#ff7a12', 0.95),
}


def hexc(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


def set_mat(o, col, metal, rough, emit=None):
    m = o.data.materials[0]
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = hexc(col)
    bsdf.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough


if make_thumbs:
    for o in parts.values():
        o.location = (0, 0, EYE_Z)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 88
    # Fundo neutro para a câmera, mas um "estúdio" (céu claro, horizonte, chão escuro) nos
    # reflexos: é o que dá o degradê das lentes espelhadas, como no jogo (GlassesMaterial.ts).
    world = bpy.data.worlds.new('Fundo')
    world.use_nodes = True
    wn = world.node_tree.nodes
    wl = world.node_tree.links
    bg_cam = wn['Background']
    bg_cam.inputs['Color'].default_value = (0.62, 0.67, 0.74, 1)
    bg_ref = wn.new('ShaderNodeBackground')
    coord = wn.new('ShaderNodeTexCoord')
    sep = wn.new('ShaderNodeSeparateXYZ')
    ramp = wn.new('ShaderNodeValToRGB')
    to01 = wn.new('ShaderNodeMath')            # z da direção (−1..1) → 0..1
    to01.operation = 'MULTIPLY_ADD'
    to01.inputs[1].default_value = 0.5
    to01.inputs[2].default_value = 0.5
    wl.new(coord.outputs['Generated'], sep.inputs['Vector'])
    wl.new(sep.outputs['Z'], to01.inputs[0])
    wl.new(to01.outputs['Value'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.40, (0.05, 0.05, 0.055, 1)
    els[1].position, els[1].color = 0.62, (0.85, 0.9, 1.0, 1)
    mid = els.new(0.51)
    mid.color = (1.6, 1.6, 1.6, 1)
    wl.new(ramp.outputs['Color'], bg_ref.inputs['Color'])
    light_path = wn.new('ShaderNodeLightPath')
    mix = wn.new('ShaderNodeMixShader')
    out = wn['World Output']
    wl.new(light_path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    wl.new(bg_ref.outputs['Background'], mix.inputs[1])
    wl.new(bg_cam.outputs['Background'], mix.inputs[2])
    wl.new(mix.outputs['Shader'], out.inputs['Surface'])
    scene.world = world
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 0.24
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    for name, energy, rot in (('Chave', 3.0, (0.9, 0.2, -0.5)), ('Recorte', 1.8, (1.1, 0.0, 2.6))):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o not in parts.values() and o != body:
            o.hide_render = True
    ang = math.radians(28)
    cam.location = (math.sin(ang) * 3, -math.cos(ang) * 3, 1.63)
    cam.rotation_euler = (math.pi / 2, 0, ang)
    for vid, (fc, fm, ac, lc, mirror) in VARIANTS.items():
        set_mat(parts['Oculos_Armacao'], fc, fm, 0.3 if fm > 0.5 else 0.45)
        set_mat(parts['Oculos_Detalhe'], ac, fm, 0.35)
        set_mat(parts['Oculos_Lente'], lc, mirror, 0.08)
        d = os.path.join(out_dir, vid)
        os.makedirs(d, exist_ok=True)
        scene.render.filepath = os.path.join(d, 'thumb.webp')
        bpy.ops.render.render(write_still=True)
        print(f'[oculos] miniatura {vid}')
    # conferência (fora da pasta pública): frente, lado e topo
    prev = os.path.join(os.path.dirname(src_blend), 'oculos_previa')
    os.makedirs(prev, exist_ok=True)
    for nm, loc, rot, sc in (('frente', (0, -3, 1.63), (math.pi / 2, 0, 0), 0.26),
                             ('lado', (3, 0, 1.63), (math.pi / 2, 0, math.pi / 2), 0.3),
                             ('topo', (0, 0.0, 4), (0, 0, 0), 0.3)):
        cam.location, cam.rotation_euler, cam.data.ortho_scale = loc, rot, sc
        scene.render.resolution_x = scene.render.resolution_y = 512
        scene.render.filepath = os.path.join(prev, f'{nm}.webp')
        bpy.ops.render.render(write_still=True)

print(f'[oculos] concluído em {time.time() - t_start:.1f}s')
