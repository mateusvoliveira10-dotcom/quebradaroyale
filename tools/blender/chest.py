"""Baú do loot (modelo enviado) → base e tampa separadas, versão comum e versão épica azul.

  blender -b --python tools/blender/chest.py -- <baú reduzido.glb> <pasta public/assets/world>

Entrada: o baú já reduzido por textured_prop.py (Prop_bau, base em z = 0, frente em −Y,
onde fica o fecho). A malha é cortada num plano horizontal logo acima da faixa de metal do
fecho (CUT da altura): o que fica acima vira a tampa (Bau_tampa), o resto a base (Bau_base).
A tampa gira em volta da aresta de trás (+Y) no jogo.

A versão épica (bau_epico.glb) tem a mesma malha e a textura com a madeira trocada para azul
(matiz dos tons quentes e saturados → azul), mantendo o metal como está.

Saída: bau.glb e bau_epico.glb (objetos Bau_base e Bau_tampa; material bau_body /
bau_epico_body).
"""
import colorsys
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src, out_dir = os.path.abspath(args[0]), os.path.abspath(args[1])
CUT = 0.79  # fração da altura onde a tampa começa


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    return next(o for o in bpy.data.objects if o.type == 'MESH')


def split(obj):
    lo, hi = common.world_bounds(obj)
    zc = lo.z + (hi.z - lo.z) * CUT
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, zc), plane_no=(0, 0, 1))
    bm.faces.index_update()
    ids = {f.index for f in bm.faces if f.calc_center_median().z > zc}
    bm.to_mesh(obj.data)
    bm.free()
    # Separa as faces de cima num objeto próprio.
    common.select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in obj.data.polygons:
        p.select = p.index in ids
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.data.objects if o.type == 'MESH']
    lid = max(parts, key=lambda o: common.world_bounds(o)[0].z)
    base = next(o for o in parts if o is not lid)
    base.name = 'Bau_base'
    lid.name = 'Bau_tampa'
    hollow(base, zc, down=True)
    hollow(lid, zc, down=False)
    print(f'[bau] corte em z = {zc:.3f} m; base {len(base.data.polygons)} faces, tampa {len(lid.data.polygons)} faces')
    return base, lid


def interior_material():
    m = bpy.data.materials.get('interior') or bpy.data.materials.new('interior')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.07, 0.04, 1)
    return m


def hollow(obj, zc, down):
    """Fecha o corte sem mexer na malha original (reduzida, não fecha bem): na base, uma
    caixa interna aberta de madeira escura (fundo e paredes, 30 cm de fundo); na tampa, o
    forro plano por baixo. Material 'interior' (o jogo desenha dos dois lados)."""
    me = obj.data
    if 'interior' not in [m.name for m in me.materials if m]:
        me.materials.append(interior_material())
    mi = [m.name for m in me.materials].index('interior')
    lo, hi = common.world_bounds(obj)
    x0, x1 = lo.x + 0.055, hi.x - 0.055
    y0, y1 = lo.y + 0.055, hi.y - 0.055
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()

    def quad(pts):
        vs = [bm.verts.new(p) for p in pts]
        f = bm.faces.new(vs)
        f.material_index = mi
        for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = (u, v)

    if down:
        zt, zb = zc - 0.005, zc - 0.31
        quad([(x0, y0, zb), (x1, y0, zb), (x1, y1, zb), (x0, y1, zb)])
        quad([(x0, y0, zb), (x0, y0, zt), (x1, y0, zt), (x1, y0, zb)])
        quad([(x0, y1, zb), (x1, y1, zb), (x1, y1, zt), (x0, y1, zt)])
        quad([(x0, y0, zb), (x0, y1, zb), (x0, y1, zt), (x0, y0, zt)])
        quad([(x1, y0, zb), (x1, y0, zt), (x1, y1, zt), (x1, y1, zb)])
        # Borda de cima (espessura da parede do baú).
        for a, b2 in (((lo.x, lo.y), (hi.x, y0)), ((lo.x, y1), (hi.x, hi.y)), ((lo.x, y0), (x0, y1)), ((x1, y0), (hi.x, y1))):
            quad([(a[0], a[1], zt), (b2[0], a[1], zt), (b2[0], b2[1], zt), (a[0], b2[1], zt)])
    else:
        z = zc + 0.004
        quad([(lo.x + 0.01, lo.y + 0.01, z), (lo.x + 0.01, hi.y - 0.01, z), (hi.x - 0.01, hi.y - 0.01, z), (hi.x - 0.01, lo.y + 0.01, z)])
    bm.to_mesh(me)
    bm.free()


def recolor_blue(img):
    """Madeira (tons quentes e saturados) → azul; metal e sombras ficam."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx = rgb.max(1)
    mn = rgb.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    warm = (r > b + 0.04) & (sat > 0.22)
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in rgb[warm]], dtype=np.float32) if warm.any() else np.zeros((0, 3))
    if len(hsv):
        hsv[:, 0] = 0.6 + (hsv[:, 0] - 0.05) * 0.3
        hsv[:, 1] = np.minimum(1, hsv[:, 1] * 1.15)
        hsv[:, 2] = np.minimum(1, hsv[:, 2] * 1.12)
        rgb[warm] = np.array([colorsys.hsv_to_rgb(*c) for c in hsv], dtype=np.float32)
    px[:, :3] = rgb
    img.pixels = px.ravel()
    img.update()


def export(objs, path):
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88,
                              export_animations=False)
    print(f'[bau] exportado {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


for variant in ('bau', 'bau_epico'):
    obj = load()
    base, lid = split(obj)
    mat = base.data.materials[0]
    mat.name = f'{variant}_body'

    if variant == 'bau_epico':
        img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
        recolor_blue(img)
    export([base, lid], os.path.join(out_dir, f'{variant}.glb'))
