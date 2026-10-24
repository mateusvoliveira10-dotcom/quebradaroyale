"""Etapa 1: escala para 1,75 m, reduz a malha e refaz o normal map a partir do original.

blender -b --python tools/blender/optimize.py -- <entrada.glb> <saida.blend> [triangulos] [tam_textura]

- A malha de alta (original) vira a fonte do bake; a de baixa herda as UVs originais.
- O normal map novo (espaço tangente, convenção OpenGL = glTF) captura a geometria da alta
  e também o normal map original dela, então os detalhes finos sobrevivem.
- Cor base e rugosidade/metal originais continuam valendo (mesmas UVs), só reduzidas.
"""
import os
import sys
import time

import bpy

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src, out_blend = args[0], args[1]
target_tris = int(args[2]) if len(args) > 2 else 26000
tex_size = int(args[3]) if len(args) > 3 else 2048
out_dir = os.path.dirname(os.path.abspath(out_blend))
os.makedirs(out_dir, exist_ok=True)

t0 = time.time()
common.reset_scene()
high, imported = common.import_glb(src)
for o in imported:
    if o is not high and o.type != 'MESH':
        o.select_set(False)
k = common.normalize_height(high)
high.name = 'CorpoAlta'
src_tris = sum(len(p.vertices) - 2 for p in high.data.polygons)
print(f'[otimizar] importado {len(high.data.vertices)} vértices, {src_tris} triângulos, escala {k:.4f} ({time.time() - t0:.1f}s)')

# ---------------------------------------------------------------- redução
low = high.copy()
low.data = high.data.copy()
low.name = 'Corpo'
low.data.name = 'Corpo'
bpy.context.collection.objects.link(low)
common.select_only(low)
# Solda vértices duplicados por segurança antes de reduzir.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.00005)
bpy.ops.object.mode_set(mode='OBJECT')
mod = low.modifiers.new('Reduzir', 'DECIMATE')
mod.decimate_type = 'COLLAPSE'
mod.ratio = target_tris / src_tris
mod.use_collapse_triangulate = True
mod.use_symmetry = True
mod.symmetry_axis = 'X'
bpy.ops.object.modifier_apply(modifier=mod.name)
low_tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
print(f'[otimizar] reduzido para {len(low.data.vertices)} vértices, {low_tris} triângulos ({time.time() - t0:.1f}s)')
for p in low.data.polygons:
    p.use_smooth = True

# ---------------------------------------------------------------- materiais
src_mat = high.active_material
nodes = src_mat.node_tree.nodes


def find_image(socket_name):
    """Imagem ligada (direta ou via Normal Map/Separate) a uma entrada do Principled."""
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    stack = [bsdf.inputs[socket_name]]
    while stack:
        s = stack.pop()
        for link in s.links:
            n = link.from_node
            if n.type == 'TEX_IMAGE':
                return n.image
            stack.extend(i for i in n.inputs if i.is_linked)
    return None


base_img = find_image('Base Color')
rough_img = find_image('Roughness')
print(f'[otimizar] texturas originais: base={base_img and base_img.name} rm={rough_img and rough_img.name}')


def resized_copy(img, name, size, colorspace):
    c = img.copy()
    c.name = name
    c.scale(size, size)
    c.colorspace_settings.name = colorspace
    c.filepath_raw = os.path.join(out_dir, f'{name}.png')
    c.file_format = 'PNG'
    c.save()
    return c


base_low = resized_copy(base_img, 'personagem_base_cor', tex_size, 'sRGB')
rm_low = resized_copy(rough_img, 'personagem_base_rm', tex_size, 'Non-Color')
normal_low = bpy.data.images.new('personagem_base_normal', tex_size, tex_size, alpha=False, float_buffer=False)
normal_low.colorspace_settings.name = 'Non-Color'
normal_low.generated_color = (0.5, 0.5, 1.0, 1.0)

mat = bpy.data.materials.new('PersonagemBase')
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
outp = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
nt.links.new(bsdf.outputs['BSDF'], outp.inputs['Surface'])
tb = nt.nodes.new('ShaderNodeTexImage')
tb.image = base_low
nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
trm = nt.nodes.new('ShaderNodeTexImage')
trm.image = rm_low
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(trm.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
tn = nt.nodes.new('ShaderNodeTexImage')
tn.image = normal_low
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(tn.outputs['Color'], nmap.inputs['Color'])
low.data.materials.clear()
low.data.materials.append(mat)

# ---------------------------------------------------------------- bake do normal map
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
prefs = bpy.context.preferences.addons['cycles'].preferences
device = 'CPU'
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            device = kind
            break
    except TypeError:
        continue
scene.cycles.device = 'GPU' if device != 'CPU' else 'CPU'
print(f'[otimizar] bake usando {device}')

# O nó de imagem ativo do material da baixa recebe o bake; desliga a normal até o bake terminar.
nt.links.remove(nmap.outputs['Normal'].links[0]) if nmap.outputs['Normal'].links else None
nt.nodes.active = tn
for o in bpy.context.view_layer.objects:
    o.select_set(False)
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bake = scene.render.bake
bake.use_selected_to_active = True
bake.use_cage = False
bake.cage_extrusion = 0.012
bake.max_ray_distance = 0.04
bake.margin = 12
bake.normal_space = 'TANGENT'
t1 = time.time()
bpy.ops.object.bake(type='NORMAL')
print(f'[otimizar] bake do normal map em {time.time() - t1:.1f}s')
normal_low.filepath_raw = os.path.join(out_dir, 'personagem_base_normal.png')
normal_low.file_format = 'PNG'
normal_low.save()
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

# Remove a alta e o que mais veio do importador.
for o in list(bpy.data.objects):
    if o is not low:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.outliner.orphans_purge(do_recursive=True)
for img in (base_low, rm_low, normal_low):
    img.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_blend))
print(f'[otimizar] salvo {out_blend} ({time.time() - t0:.1f}s no total)')
