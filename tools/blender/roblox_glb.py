"""Deixa os GLB do exportador do mapa (exportar-roblox/) leves para o Roblox: texturas no
máximo 512 px, JPEG quando não têm transparência (PNG só para as recortadas: folhas, grade,
grafite), e reexporta mantendo nomes, marcas e posições.

blender -b --python tools/blender/roblox_glb.py -- <pasta de entrada> <pasta de saída> [tamanho]
"""
import glob
import os
import sys

import bpy

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src_dir = os.path.abspath(args[0])
out_dir = os.path.abspath(args[1])
MAX = int(args[2]) if len(args) > 2 else 512
os.makedirs(out_dir, exist_ok=True)
tmp = os.path.join(out_dir, '_tex')
os.makedirs(tmp, exist_ok=True)


def has_alpha(img):
    if img.channels < 4:
        return False
    px = img.pixels[:]
    # amostra (imagens grandes): basta achar algum pixel não opaco
    step = max(4, (len(px) // 4 // 20000) * 4)
    return any(px[i + 3] < 0.98 for i in range(0, len(px), step))


files = sorted(glob.glob(os.path.join(src_dir, 'mapa_*.glb')) + glob.glob(os.path.join(src_dir, 'modelos.glb')))
total_in = total_out = 0
for path in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for k, img in enumerate(list(bpy.data.images)):
        if img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) > MAX:
            f = MAX / max(w, h)
            img.scale(max(1, int(w * f)), max(1, int(h * f)))
        alpha = has_alpha(img)
        ext = 'png' if alpha else 'jpg'
        out = os.path.join(tmp, f'{os.path.basename(path)}_{k}.{ext}')
        img.file_format = 'PNG' if alpha else 'JPEG'
        img.filepath_raw = out
        img.save(filepath=out, quality=85) if not alpha else img.save(filepath=out)
        img.filepath = out
        img.reload()
    for o in bpy.context.scene.objects:
        o.select_set(True)
    dst = os.path.join(out_dir, os.path.basename(path))
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True,
                              export_materials='EXPORT', export_image_format='AUTO', export_jpeg_quality=85)
    a, b = os.path.getsize(path), os.path.getsize(dst)
    total_in += a
    total_out += b
    print(f'[roblox] {os.path.basename(path)}: {a / 1e6:.1f} MB -> {b / 1e6:.1f} MB')

print(f'[roblox] total {total_in / 1e6:.0f} MB -> {total_out / 1e6:.0f} MB')
