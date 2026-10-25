"""Prop texturizado enviado (modelo do Tripo) → peça leve do mapa, com a textura original.

  blender -b --python tools/blender/textured_prop.py -- <id> <original.glb> <saída.glb> [prévia.png]

O original vem com milhões de faces e texturas 4K: a malha é reduzida (decimação que
preserva a UV) até ~TARGET faces, a escala é a da tabela abaixo (altura final em metros),
a base vai para z = 0 e as texturas (cor e normal) são reduzidas para TEX px e embutidas
em JPEG. Objeto de saída: Prop_<id>, com o material '<id>_body'.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

PROPS = {
    # Saco de lixo preto amarrado: ~0,72 m de altura.
    'saco_lixo': dict(height=0.72, target=5000, tex=1024),
    # Pilha de pneus velhos: ~1,05 m de altura.
    'pneus': dict(height=1.05, target=7000, tex=1024),
    # Tambor de 200 litros (0,88 m), com a pintura azul tomada pela ferrugem.
    'barril': dict(height=0.88, target=4000, tex=1024, rust=True),
    # Baú antigo (base e tampa separadas depois por chest.py): ~0,62 m de altura.
    'bau': dict(height=0.62, target=8000, tex=1024),
}

def rustify(img):
    """Ferrugem por cima da pintura: manchas grandes de óxido, pintura descascada em pontos,
    escorridos verticais e sujeira escura (ruído fractal em numpy, sem depender da UV)."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rng = np.random.default_rng(7)

    def noise(scale, octaves=4):
        out = np.zeros((h, w), np.float32)
        amp = 1.0
        for o in range(octaves):
            n = max(2, int(scale * 2 ** o))
            g = rng.random((n + 1, n + 1)).astype(np.float32)
            ys = np.linspace(0, n, h, endpoint=False)
            xs = np.linspace(0, n, w, endpoint=False)
            yi, xi = ys.astype(int), xs.astype(int)
            fy, fx = (ys - yi)[:, None], (xs - xi)[None, :]
            fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
            a = g[yi][:, xi] * (1 - fx) + g[yi][:, xi + 1] * fx
            b = g[yi + 1][:, xi] * (1 - fx) + g[yi + 1][:, xi + 1] * fx
            out += (a * (1 - fy) + b * fy) * amp
            amp *= 0.5
        return out / out.max()

    big = noise(6)
    fine = noise(40, 2)
    rust_mask = np.clip((big * 0.75 + fine * 0.35 - 0.48) * 4.0, 0, 1)
    chips = (fine > 0.82).astype(np.float32) * 0.8
    streak = np.clip(noise(3, 2)[:, :1] * 0 + np.repeat(noise(60, 1)[:1, :], h, 0) - 0.55, 0, 1) * 1.6
    m = np.clip(rust_mask + chips + streak * 0.5, 0, 1)[..., None]
    rust_a = np.array([0.42, 0.18, 0.07], np.float32)
    rust_b = np.array([0.66, 0.33, 0.12], np.float32)
    rust = rust_a + (rust_b - rust_a) * fine[..., None]
    rgb = px[..., :3] * (1 - m) + rust * m
    rgb *= (0.85 + 0.15 * big)[..., None]
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels = px.ravel()


def bake_rust(obj, mat, img_node, size):
    """Ferrugem contínua (sem emendas da UV): ruído em coordenadas do objeto mistura a
    pintura original com tons de óxido, mais forte em baixo e nos frisos; o resultado é
    "assado" (bake de cor difusa no Cycles) numa textura nova na mesma UV."""
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    n_big = nt.nodes.new('ShaderNodeTexNoise')
    n_big.inputs['Scale'].default_value = 4.0
    n_big.inputs['Detail'].default_value = 8.0
    n_fine = nt.nodes.new('ShaderNodeTexNoise')
    n_fine.inputs['Scale'].default_value = 28.0
    n_fine.inputs['Detail'].default_value = 4.0
    for n in (n_big, n_fine):
        nt.links.new(coord.outputs['Object'], n.inputs['Vector'])
    # Mais ferrugem perto do chão (água empoçada) e no topo.
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'], sep.inputs['Vector'])
    low = nt.nodes.new('ShaderNodeMapRange')
    low.inputs['From Min'].default_value = 0.0
    low.inputs['From Max'].default_value = 0.45
    low.inputs['To Min'].default_value = 0.28
    low.inputs['To Max'].default_value = 0.0
    nt.links.new(sep.outputs['Z'], low.inputs['Value'])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(n_big.outputs['Fac'], add.inputs[0])
    nt.links.new(low.outputs['Result'], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(add.outputs['Value'], ramp.inputs['Fac'])
    rust_col = nt.nodes.new('ShaderNodeValToRGB')
    rust_col.color_ramp.elements[0].color = (0.18, 0.06, 0.02, 1)
    rust_col.color_ramp.elements[1].color = (0.55, 0.22, 0.06, 1)
    nt.links.new(n_fine.outputs['Fac'], rust_col.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(ramp.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(img_node.outputs['Color'], mix.inputs[6])
    nt.links.new(rust_col.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    baked = bpy.data.images.new(img_node.image.name + '_ferrugem', size, size)
    target = nt.nodes.new('ShaderNodeTexImage')
    target.image = baked
    nt.nodes.active = target
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 8
    common.select_only(obj)
    bpy.ops.object.bake(type='DIFFUSE')
    # A textura assada vira a cor do material; os nós do procedimento saem.
    for n in (coord, n_big, n_fine, sep, low, add, ramp, rust_col, mix):
        nt.nodes.remove(n)
    img_node.image = baked
    nt.nodes.remove(target)
    nt.links.new(img_node.outputs['Color'], bsdf.inputs['Base Color'])
    baked.file_format = 'JPEG'
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'EEVEE_NEXT') or True else 'BLENDER_EEVEE'
    print(f'[ferrugem] assada em {size}px')


args = common.script_args()
pid, src, out = args[0], os.path.abspath(args[1]), os.path.abspath(args[2])
preview = os.path.abspath(args[3]) if len(args) > 3 else None
cfg = PROPS[pid]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
common.select_only(obj)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
faces = len(obj.data.polygons)
mod = obj.modifiers.new('reduz', 'DECIMATE')
mod.ratio = min(1.0, cfg['target'] / faces)
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
print(f'[{pid}] {faces} → {len(obj.data.polygons)} faces')

# Escala pela altura e base no chão, centrado em x/y.
lo, hi = common.world_bounds(obj)
k = cfg['height'] / (hi.z - lo.z)
obj.scale = (k, k, k)
bpy.ops.object.transform_apply(scale=True)
lo, hi = common.world_bounds(obj)
obj.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
bpy.ops.object.transform_apply(location=True)
lo, hi = common.world_bounds(obj)
print(f'[{pid}] tamanho final: {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m')
obj.name = f'Prop_{pid}'
mat = obj.data.materials[0]
mat.name = f'{pid}_body'
# Texturas menores (cor e normal); o mapa de rugosidade/metal sai (o jogo usa o próprio brilho).
for node in list(mat.node_tree.nodes):
    if node.type == 'TEX_IMAGE' and node.image:
        img = node.image
        if 'rm' in img.name.lower() or 'rough' in img.name.lower() or 'metal' in img.name.lower():
            mat.node_tree.nodes.remove(node)
            continue
        img.scale(cfg['tex'], cfg['tex'])
        img.file_format = 'JPEG'
        if cfg.get('rust') and 'normal' not in img.name.lower():
            bake_rust(obj, mat, node, cfg['tex'])
bsdf = mat.node_tree.nodes.get('Principled BSDF')
if bsdf:
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Metallic'].default_value = 0.0
common.select_only(obj)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=85,
                          export_animations=False)
print(f'[{pid}] exportado {out} ({os.path.getsize(out) / 1e6:.2f} MB)')

if preview:
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 600
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.75, 0.8, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.object.camera_add(location=(1.4, -1.6, 0.9))
    cam = bpy.context.active_object
    d = Vector((0, 0, 0.35)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)
