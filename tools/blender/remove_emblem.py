"""Apaga um emblema de marca da textura de um veículo já processado (ex.: o "VW" da Kombi).

  blender -b --python tools/blender/remove_emblem.py -- <veiculo.glb> <x> <y> <z> <raio_m> [prévia.png]

(x, y, z) em coordenadas do Blender: y é o lado do carro (0 = meio) e z a altura do emblema.

Lança um raio de fora do carro (pela frente, eixo −X, onde fica a frente nos veículos de
vehicle.py) até o ponto (x, y, z) da lataria, descobre a UV ali e mede quantos pixels da
textura cabem em um metro em volta. Pinta um disco do raio pedido com a cor mediana do anel
em volta (a própria lataria), com bordas suaves, e grava o GLB de novo.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
path = os.path.abspath(args[0])
px, py, pz, radius = (float(v) for v in args[1:5])
preview = os.path.abspath(args[5]) if len(args) > 5 and args[5] != '-' else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
body = max((o for o in bpy.data.objects if o.type == 'MESH' and 'lod' not in o.name.lower() and not o.name.startswith('Col_')),
           key=lambda o: len(o.data.polygons))
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(body, dg)
me = body.data
uvl = me.uv_layers.active


def uv_at(p):
    """UV do ponto da lataria atingido por um raio vindo da frente (−X) em direção a p."""
    origin = Vector((p[0] - 5, p[1], p[2]))
    loc, n, idx, d = bvh.ray_cast(origin, Vector((1, 0, 0)), 20)
    if loc is None:
        return None
    poly = me.polygons[idx]
    # Baricêntrico no triângulo (o corpo já vem triangulado).
    vs = [me.vertices[i].co for i in poly.vertices[:3]]
    uvs = [uvl.data[li].uv for li in poly.loop_indices[:3]]
    a, b, c = vs
    v0, v1, v2 = b - a, c - a, loc - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-9
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    w0 = 1 - w1 - w2
    return uvs[0] * w0 + uvs[1] * w1 + uvs[2] * w2


# Coordenadas do Blender (Z para cima; y = lado do carro, z = altura).
mat = body.data.materials[0]
img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'normal' not in n.image.name.lower())
w, h = img.size
pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
yy, xx = np.mgrid[0:h, 0:w]


def px_at(p):
    uv = uv_at(p)
    return None if uv is None else (uv.x * w, uv.y * h)


# Cor da lataria: logo abaixo do emblema (fora dele).
# 'lado' (6º argumento): a cor vem do lado do emblema (ex.: grade preta do Gol).
ref = px_at((px, py + radius * 1.9, pz)) if len(args) > 6 and args[6] == 'lado' else px_at((px, py, pz - radius * 1.7))
if ref is None:
    raise SystemExit('raio não atingiu a lataria')
rx, ry = int(ref[0]), int(ref[1])
fill = np.median(pix[max(0, ry - 4):ry + 5, max(0, rx - 4):rx + 5, :3].reshape(-1, 3), axis=0)
# Grade de pontos cobrindo o disco do emblema: cada ponto pinta um disquinho na ilha da UV
# em que cair (o emblema pode estar dividido entre várias).
step = radius / 5
painted = 0
for gy in np.arange(-radius, radius + 1e-6, step):
    for gz in np.arange(-radius, radius + 1e-6, step):
        if gy * gy + gz * gz > radius * radius:
            continue
        p = (px, py + gy, pz + gz)
        c0 = px_at(p)
        c1 = px_at((px, py + gy + 0.01, pz + gz))
        if c0 is None:
            continue
        per = np.hypot(c1[0] - c0[0], c1[1] - c0[1]) / 0.01 if c1 else 300
        r = min(60, max(4, step * 0.9 * per))
        d = np.hypot(xx - c0[0], yy - c0[1])
        k = np.clip((r - d) / (r * 0.4), 0, 1)[..., None]
        pix[..., :3] = pix[..., :3] * (1 - k) + fill * k
        painted += 1
print(f'[emblema] {painted} pontos pintados com a cor {fill.round(3)}')
img.pixels = pix.ravel()
img.update()
img.file_format = 'JPEG'
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88,
                          export_animations=False)
print(f'[emblema] gravado {path} ({os.path.getsize(path) / 1e6:.2f} MB)')
if preview:
    img.filepath_raw = preview
    img.file_format = 'PNG'
    img.save()
