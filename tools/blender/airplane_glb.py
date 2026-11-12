"""Avião do Battle Royale enviado pelo usuário (modelo do Tripo, ~1,5 milhão de triângulos e
três texturas 4K) preparado para o jogo: tira o trem de pouso (está em voo), reduz a malha,
gira com o nariz para a frente do jogo, põe em escala real e salva as texturas em JPEG
menores.

blender -b --python tools/blender/airplane_glb.py -- <origem.glb> <saída airplane.glb> [triângulos]

Saída: objeto "Aviao" (o jogo procura Helice_* e Rampa, que este modelo não tem — o voo
funciona sem eles). Origem no eixo da fuselagem, frente −Y (Blender) = +Z no jogo.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src, dst = args[0], args[1]
target_tris = int(args[2]) if len(args) > 2 else 70000

LENGTH = 38.0          # comprimento real (m) de um jato de corredor único
FUSELAGE_Z = 0.118     # altura do eixo da fuselagem no modelo original (0..0,33)
TEX = {'basecolor': 2048, 'normal': 2048, 'rm': 1024}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
common.select_only(obj)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Trem de pouso: tudo abaixo da barriga da fuselagem perto do centro (as turbinas, mais para
# fora, ficam).
bm = bmesh.new()
bm.from_mesh(obj.data)
gear = [v for v in bm.verts if v.co.z < 0.06 and abs(v.co.y) < 0.16]
bmesh.ops.delete(bm, geom=gear, context='VERTS')
bm.to_mesh(obj.data)
bm.free()
print(f'[aviao] trem de pouso removido ({len(gear)} vértices)')

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
mod = obj.modifiers.new('dec', 'DECIMATE')
mod.ratio = min(1.0, target_tris / max(1, tris))
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='dec')
tris2 = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f'[aviao] {tris} -> {tris2} triângulos')

# Nariz em +X → −Y; escala real; eixo da fuselagem na origem.
k = LENGTH / max(obj.dimensions.x, 1e-6)
obj.data.transform(Matrix.Translation((0, 0, -FUSELAGE_Z)))
obj.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
obj.data.transform(Matrix.Scale(k, 4))
obj.name = 'Aviao'
obj.data.name = 'Aviao'
for p in obj.data.polygons:
    p.use_smooth = True

# Texturas menores em JPEG (o exportador usa os arquivos salvos).
tmp = os.path.join(os.path.dirname(os.path.abspath(dst)), '_aviao_tex')
os.makedirs(tmp, exist_ok=True)
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    kind = next((key for key in TEX if key in im.name), None)
    size = TEX.get(kind, 1024)
    if im.packed_file:
        im.unpack(method='USE_ORIGINAL')
    im.scale(size, size)
    path = os.path.join(tmp, f'aviao_{kind or im.name}.jpg')
    im.file_format = 'JPEG'
    im.filepath_raw = path
    bpy.context.scene.render.image_settings.quality = 86
    im.save_render(path) if False else im.save(filepath=path, quality=86)
    im.filepath = path
    im.reload()
    print(f'[aviao] textura {im.name} -> {size}px')

common.select_only(obj)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_materials='EXPORT', export_apply=True, export_image_format='JPEG', export_jpeg_quality=86)
print(f'[aviao] exportado {dst} ({os.path.getsize(dst) / 1e6:.2f} MB), dimensões {tuple(round(d, 1) for d in obj.dimensions)}')
