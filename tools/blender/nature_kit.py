"""Importa o "Stylized Nature MegaKit" (Quaternius, CC0) num único GLB compacto para o mapa.

Cada modelo escolhido vira um objeto Nat_<nome> (versão de perto, decimada) e Nat_<nome>_lod1
(versão leve de longe), mais caixas de colisão Col_Nat_<nome>_<n> (só tronco de árvore e
pedras; moitas, capim e flores não colidem). Os materiais são unificados pelo nome
(Bark_Pine, Leaves_NormalTree, Rocks...): no jogo cada nome vira um material só, e o lote
estático junta tudo por material e bloco. Texturas reduzidas (casca 512, folhas 512 com
recorte, pedras 512) e exportadas em JPEG quando não precisam de transparência; os mapas de
normal saem (o estilo é chapado e eles pesavam 5 MB cada).

Eixos (Blender): Z para cima, base em z = 0 (o kit já vem assim). O kit é tratado como dado:
este script só lê os .gltf/.bin/.png dele.

Uso:
  blender -b --python tools/blender/nature_kit.py -- "<pasta glTF do kit>" public/assets/world/nature.glb
"""
import json
import random
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402

args = script_args()
kit = os.path.abspath(args[0])
out_glb = os.path.abspath(args[1] if len(args) > 1 else 'public/assets/world/nature.glb')

# (nome no kit, triângulos alvo de perto, de longe, tipo de colisor)
#   'tronco': caixa no tronco (árvores); 'pedra': caixa da pedra; None: sem colisão.
TREE_NEAR = 1300
TREE_FAR = 300
MODELS = [
    # Árvores de copa larga (a "árvore comum" do mapa).
    ('CommonTree_1', TREE_NEAR, TREE_FAR, 'tronco'), ('CommonTree_2', TREE_NEAR, TREE_FAR, 'tronco'), ('CommonTree_3', TREE_NEAR, TREE_FAR, 'tronco'),
    ('CommonTree_4', TREE_NEAR, TREE_FAR, 'tronco'), ('CommonTree_5', TREE_NEAR, TREE_FAR, 'tronco'),
    # Casca clara (embaúba / pau-de-leite).
    ('Birch_1', TREE_NEAR, TREE_FAR, 'tronco'), ('Birch_3', TREE_NEAR, TREE_FAR, 'tronco'), ('Birch_5', TREE_NEAR, TREE_FAR, 'tronco'),
    # Pinheiros (araucárias da serra).
    ('Pine_1', TREE_NEAR, TREE_FAR, 'tronco'), ('Pine_3', TREE_NEAR, TREE_FAR, 'tronco'), ('GiantPine_1', TREE_NEAR, TREE_FAR, 'tronco'), ('GiantPine_2', TREE_NEAR, TREE_FAR, 'tronco'),
    # Árvores altas e grossas da mata fechada.
    ('TallThick_1', TREE_NEAR, TREE_FAR, 'tronco'), ('TallThick_2', TREE_NEAR, TREE_FAR, 'tronco'), ('TallThick_3', TREE_NEAR, TREE_FAR, 'tronco'),
    # Retorcidas (figueiras da beira do rio).
    ('TwistedTree_1', TREE_NEAR, TREE_FAR, 'tronco'), ('TwistedTree_2', TREE_NEAR, TREE_FAR, 'tronco'), ('TwistedTree_3', TREE_NEAR, TREE_FAR, 'tronco'),
    # Secas (brejo e pedreira).
    ('DeadTree_1', 1000, 300, 'tronco'), ('DeadTree_3', 1000, 300, 'tronco'),
    # Floridas (ipê-rosa).
    ('CherryBlossom_1', TREE_NEAR, TREE_FAR, 'tronco'), ('CherryBlossom_3', TREE_NEAR, TREE_FAR, 'tronco'),
    # Moitas e plantas (sem colisão).
    ('Bush_Common', 450, 180, None), ('Bush_Common_Flowers', 500, 200, None), ('Bush_Large', 450, 180, None),
    ('Bush_Large_Flowers', 500, 200, None), ('Bush_Long_1', 400, 160, None),
    ('Fern_1', 288, 120, None), ('Fern_2', 180, 100, None),
    ('Plant_1_Big', 360, 150, None), ('Plant_2', 446, 150, None), ('Plant_3', 560, 180, None), ('Plant_5', 550, 180, None), ('Plant_7_Big', 112, 60, None),
    ('Clover_1', 379, 150, None),
    ('Flower_1_Group', 450, 200, None), ('Flower_2_Group', 400, 200, None), ('Flower_3_Group', 400, 200, None),
    ('Flower_4_Group', 450, 200, None), ('Flower_7_Group', 400, 200, None), ('Flower_6', 93, 60, None),
    ('Grass_Common_Short', 155, 80, None), ('Grass_Common_Tall', 326, 120, None), ('Grass_Wide_Tall', 506, 150, None),
    ('Grass_Wispy_Tall', 622, 180, None), ('Grass_Wheat', 700, 250, None),
    ('Mushroom_Common', 600, 200, None), ('Mushroom_RedCap', 500, 200, None), ('Mushroom_Oyster', 800, 250, None),
    # Pedras (com colisão).
    ('Rock_Big_1', 900, 200, 'pedra'), ('Rock_Big_2', 900, 200, 'pedra'),
    ('Rock_Medium_1', 342, 120, 'pedra'), ('Rock_Medium_2', 244, 100, 'pedra'), ('Rock_Medium_3', 400, 120, 'pedra'), ('Rock_Medium_4', 400, 120, 'pedra'),
    ('Pebble_Round_1', 136, 60, None), ('Pebble_Round_3', 128, 60, None), ('Pebble_Square_1', 104, 50, None), ('Pebble_Square_4', 48, 30, None),
    ('RockPath_Round_Small_1', 500, 150, None), ('RockPath_Square_Wide', 900, 250, None),
]

# Tamanho das texturas por papel (as de folhas precisam de alfa: ficam PNG).
TEX_SIZE = {'Bark': 512, 'Leaves': 512, 'Leaf': 512, 'Flowers': 512, 'Grass': 256, 'Mushrooms': 512, 'Rocks': 512, 'PathRocks': 512}

reset_scene()
MATS = {}
IMAGES = {}
OBJS = []


def base_name(name):
    """'Bark_Pine.003' → 'Bark_Pine'."""
    stem = name.split('.')[0]
    return stem


def unify_material(mat):
    """Um material por nome: imagens reduzidas, sem mapa de normal, recorte nas folhas."""
    name = base_name(mat.name)
    if name in MATS:
        return MATS[name]
    mat.name = name
    MATS[name] = mat
    tree = mat.node_tree
    bsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return mat
    # A textura de cor (a que entra no Mix com a cor de vértice ou direto na cor-base).
    color_tex = None
    for n in tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and not n.image.name.split('.')[0].endswith('_Normal'):
            color_tex = n
    # Tudo que não é a saída, o BSDF e a textura de cor sai: mapa de normal, cor de vértice
    # (o jogo não usa e pesava 2,4 MB no arquivo), e a cadeia de recorte é refeita abaixo.
    for n in list(tree.nodes):
        if n not in (bsdf, color_tex) and n.type != 'OUTPUT_MATERIAL':
            tree.nodes.remove(n)
    leafy = name.startswith(('Leaves', 'Leaf', 'Flowers'))
    if color_tex is not None:
        tree.links.new(color_tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Alpha'].default_value = 1.0
    if leafy and color_tex is not None:
        # Recorte do jeito que o exportador glTF reconhece como alphaMode MASK:
        # alfa = 1 − (alfa_textura < limiar).
        less = tree.nodes.new('ShaderNodeMath')
        less.operation = 'LESS_THAN'
        less.inputs[1].default_value = 0.35
        sub = tree.nodes.new('ShaderNodeMath')
        sub.operation = 'SUBTRACT'
        sub.inputs[0].default_value = 1.0
        tree.links.new(color_tex.outputs['Alpha'], less.inputs[0])
        tree.links.new(less.outputs['Value'], sub.inputs[1])
        tree.links.new(sub.outputs['Value'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        mat.alpha_threshold = 0.35
        if hasattr(mat, 'surface_render_method'):
            mat.surface_render_method = 'DITHERED'
    else:
        mat.blend_method = 'OPAQUE'
        if hasattr(mat, 'surface_render_method'):
            mat.surface_render_method = 'DITHERED'
    mat.use_backface_culling = False
    bsdf.inputs['Roughness'].default_value = 0.9
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.1
    # Imagens: uma cópia reduzida por arquivo.
    for n in tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image:
            continue
        key = base_name(n.image.name)
        if key not in IMAGES:
            img = n.image
            img.name = key
            role = key.split('_')[0]
            size = TEX_SIZE.get(role, 512)
            if img.size[0] > size:
                img.scale(size, size)
            recolor(img, key)
            img.pack()
            IMAGES[key] = img
        n.image = IMAGES[key]
        n.interpolation = 'Linear'
    return mat


# As texturas de copa do kit (Leaves_*_C) vêm em cores de código (azul, vermelho) para o
# shader próprio dele; aqui viram folhagem de verdade: a luminosidade escolhe entre um tom
# escuro e um claro da espécie. O alfa (recorte) fica como está.
PALETTE = {
    'Leaves_NormalTree_C': ((0.10, 0.30, 0.07), (0.42, 0.72, 0.20)),
    'Leaves_Birch_C': ((0.22, 0.38, 0.06), (0.66, 0.80, 0.24)),
    'Leaf_Pine_C': ((0.05, 0.22, 0.10), (0.25, 0.52, 0.22)),
    'Leaves_GiantPine_C': ((0.05, 0.24, 0.10), (0.24, 0.56, 0.24)),
    'Leaves_TallThick_C': ((0.06, 0.28, 0.08), (0.30, 0.66, 0.20)),
    'Leaves_TwistedTree_C': ((0.12, 0.28, 0.05), (0.46, 0.66, 0.16)),
    'Leaves_CherryBlossom_C': ((0.72, 0.25, 0.45), (1.0, 0.72, 0.86)),
}


def recolor(img, key):
    pal = PALETTE.get(key)
    if not pal:
        return
    import numpy as np
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = px[:, :3].max(axis=1)
    vis = px[:, 3] > 0.05
    lo = lum[vis].min() if vis.any() else 0.0
    hi = lum[vis].max() if vis.any() else 1.0
    t = np.clip((lum - lo) / max(1e-4, hi - lo), 0, 1)[:, None]
    dark = np.array(pal[0], dtype=np.float32)[None, :]
    light = np.array(pal[1], dtype=np.float32)[None, :]
    px[:, :3] = dark * (1 - t) + light * t
    img.pixels.foreach_set(px.ravel())
    img.update()


def import_model(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(kit, f'{name}.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for slot in obj.material_slots:
        slot.material = unify_material(slot.material)
    # Cores de vértice fora (não são usadas no jogo).
    while obj.data.color_attributes:
        obj.data.color_attributes.remove(obj.data.color_attributes[0])
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def thin_leaves(obj, keep):
    """
    Versão de longe das copas: o Decimate não reduz cartões de folha soltos (cada um é um
    polígono isolado), então sorteia uma fração `keep` dos polígonos de folha, apaga o resto e
    aumenta os que ficam (em volta do próprio centro) para a copa continuar cheia de longe.
    """
    me = obj.data
    leafy = {i for i, m in enumerate(me.materials) if m and base_name(m.name).startswith(('Leaves', 'Leaf', 'Flowers'))}
    if not leafy:
        return
    rnd = random.Random(len(me.polygons))
    grow = 1 / (keep ** 0.5)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    doomed = []
    # Galhos: a casca do kit são centenas de tubos soltos (gravetos) que o Decimate não
    # consegue juntar; de longe ficam só os maiores pedaços (tronco e galhos principais).
    seen = set()
    comps = []
    for f in bm.faces:
        if f.material_index in leafy or f.index in seen:
            continue
        stack = [f]
        seen.add(f.index)
        comp = []
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen and h.material_index not in leafy:
                        seen.add(h.index)
                        stack.append(h)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    for comp in comps[6:]:
        doomed.extend(comp)
    for f in bm.faces:
        if f.material_index not in leafy:
            continue
        if rnd.random() > keep:
            doomed.append(f)
            continue
        c = f.calc_center_median()
        for v in f.verts:
            v.co = c + (v.co - c) * grow
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(me)
    bm.free()


def decimate(obj, target):
    n = tri_count(obj)
    if n <= target:
        return
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max(0.02, target / n)
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def lo_hi(obj, verts):
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def collider(name, c, s):
    """Caixa invisível no espaço do modelo (o jogo lê a caixa envolvente)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.scale = s
    o.location = c
    bpy.context.collection.objects.link(o)
    OBJS.append(o)


def add_colliders(obj, name, kind):
    me = obj.data
    verts = [v.co for v in me.vertices]
    lo, hi = lo_hi(obj, verts)
    if kind == 'pedra':
        c = (lo + hi) / 2
        s = (hi - lo) * 0.82
        collider(f'Col_{name}_0', (c.x, c.y, lo.z + s.z / 2), (s.x, s.y, s.z))
        return
    # Tronco: vértices da casca até 1/3 da altura; a caixa sobe até 2/3 (os galhos não barram).
    h = hi.z - lo.z
    bark_idx = {i for i, m in enumerate(me.materials) if m and base_name(m.name).startswith('Bark')}
    trunk = set()
    for p in me.polygons:
        if p.material_index in bark_idx:
            for vi in p.vertices:
                v = me.vertices[vi].co
                if v.z < lo.z + h * 0.28:
                    trunk.add(vi)
    pts = [me.vertices[i].co for i in trunk] or verts
    tlo, thi = lo_hi(obj, pts)
    cx = (tlo.x + thi.x) / 2
    cy = (tlo.y + thi.y) / 2
    d = max(0.35, min(thi.x - tlo.x, thi.y - tlo.y) * 0.8, (thi.x - tlo.x + thi.y - tlo.y) * 0.3)
    d = min(d, 2.2)
    ch = h * 0.66
    collider(f'Col_{name}_0', (cx, cy, lo.z + ch / 2), (d, d, ch))


for kit_name, near, far, kind in MODELS:
    name = f'Nat_{kit_name}'
    obj = import_model(kit_name)
    obj.name = name
    obj.data.name = name
    lod = obj.copy()
    lod.data = obj.data.copy()
    lod.name = f'{name}_lod1'
    lod.data.name = lod.name
    bpy.context.collection.objects.link(lod)
    decimate(obj, near)
    # Longe: um terço dos cartões de folha (maiores) e o tronco bem simplificado.
    if kind == 'tronco':
        thin_leaves(lod, 0.3)
    decimate(lod, far)
    OBJS += [obj, lod]
    if kind:
        add_colliders(obj, name, kind)
    print(f'[natureza] {name}: {tri_count(obj)} tris (perto) / {tri_count(lod)} (longe)')

for o in bpy.context.view_layer.objects:
    o.select_set(o in OBJS)
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_image_quality=80,
                          export_animations=False, export_morph=False, export_skins=False, export_apply=True)
print(f'[natureza] exportado {out_glb} ({os.path.getsize(out_glb) / 1e6:.2f} MB)')

# Confere o que saiu: materiais (modo de alfa) e imagens.
with open(out_glb, 'rb') as f:
    f.read(12)
    ln, _ = struct.unpack('<II', f.read(8))
    g = json.loads(f.read(ln))
print('[natureza] materiais:', [(m['name'], m.get('alphaMode', 'OPAQUE')) for m in g['materials']])
print('[natureza] imagens:', [(i.get('name'), i.get('mimeType')) for i in g['images']])
print('[natureza] objetos:', len(g['nodes']))
