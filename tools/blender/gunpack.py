"""Armas do pacote enviado pelo usuário (folha com 8 armas do Tripo) → modelos leves do jogo.

A folha vem como UMA malha (942 mil triângulos, texturas 4K) com as armas lado a lado no
plano X-Z (cano para ±X). Para cada arma usada: recorta pelo retângulo dela, põe a origem no
punho (onde a mão segura), gira o cano para a frente do jogo (-Y no Blender = +Z no glTF),
reduz para ~6 mil triângulos e exporta tudo num GLB só, com as texturas em 1024 compartilhadas
(um material para todas).

  blender -b --python tools/blender/gunpack.py -- "<gun 3d model.glb>" public/assets/world/gunpack.glb

Retângulos e punhos medidos na folha (metros, x e z): ver GUNS.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, out = os.path.abspath(args[0]), os.path.abspath(args[1])
SCALE = 1.05      # a folha já está em escala real; um pouco maior para ler melhor no jogo
TARGET_TRIS = 6000
TEX = 1024

# nome: (x0, x1, z0, z1, cano para +X?, punho x, punho z, altura do cano z)
GUNS = {
    'GP_pistola': (-0.40, -0.10, 0.84, 1.00, True, -0.34, 0.915, 0.967),
    'GP_smg_0': (0.11, 0.395, 0.335, 0.525, False, 0.275, 0.445, 0.47),     # tipo Uzi compacta
    'GP_smg_1': (-0.385, -0.05, 0.21, 0.485, False, -0.268, 0.44, 0.465),   # tipo MAC com coronha de arame
    'GP_smg_2': (0.10, 0.40, 0.545, 0.76, False, 0.35, 0.655, 0.717),       # cabo para trás
    'GP_smg_3': (-0.135, 0.22, 0.235, 0.395, True, -0.09, 0.33, 0.363),     # carregador de tambor
    'GP_smg_4': (-0.40, 0.05, 0.575, 0.805, True, -0.34, 0.715, 0.763),     # com silenciador
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sheet = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mw = sheet.matrix_world.copy()
sheet.parent = None
sheet.matrix_world = mw
bpy.context.view_layer.objects.active = sheet
sheet.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = sheet.data.materials[0]

# Texturas em 1024 (as 4K pesariam ~20 MB no jogo).
for img in bpy.data.images:
    if img.size[0] > TEX:
        img.scale(TEX, TEX)

made = []
for name, (x0, x1, z0, z1, plus_x, gx, gz, bz) in GUNS.items():
    obj = sheet.copy()
    obj.data = sheet.data.copy()
    obj.name = name
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Mantém só as faces cujo centro cai no retângulo da arma.
    kill = [f for f in bm.faces if not (x0 <= f.calc_center_median().x <= x1 and z0 <= f.calc_center_median().z <= z1)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # Origem no punho, cano para a frente (-Y), escala.
    rot = Matrix.Rotation(-math.pi / 2 if plus_x else math.pi / 2, 4, 'Z')
    m = Matrix.Scale(SCALE, 4) @ rot @ Matrix.Translation(Vector((-gx, 0.0, -gz)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if tris > TARGET_TRIS:
        dec = obj.modifiers.new('reduzir', 'DECIMATE')
        dec.ratio = TARGET_TRIS / tris
        bpy.ops.object.modifier_apply(modifier=dec.name)
    final = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    # Cano: distância do punho até a ponta, na frente; altura do cano acima do punho.
    ys = [v.co.y for v in obj.data.vertices]
    muzzle_z = -min(ys)
    print(f'[gunpack] {name}: {tris} -> {final} triângulos; cano z={muzzle_z:.3f} y={(bz - gz) * SCALE:.3f}')
    made.append(obj)

bpy.data.objects.remove(sheet)
for o in bpy.data.objects:
    o.select_set(o in made)
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True, export_normals=True,
                          export_materials='PLACEHOLDER', export_animations=False, export_morph=False)
print(f'[gunpack] exportado {out} ({os.path.getsize(out) / 1e6:.2f} MB)')
# Texturas também como JPG soltos (o jogo usa num material próprio: a textura embutida no GLB
# chegava preta ao StandardMaterial).
for img in bpy.data.images:
    kind = 'albedo' if 'basecolor' in img.name else 'normal' if 'normal' in img.name else None
    if not kind:
        continue
    path = os.path.join(os.path.dirname(out), f'gunpack_{kind}.jpg')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.color_mode = 'RGB'
    bpy.context.scene.render.image_settings.quality = 88
    img.save_render(path)
    print(f'[gunpack] textura {path} ({os.path.getsize(path) / 1e3:.0f} KB)')
