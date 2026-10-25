"""Deixa as texturas de foto das casas (public/assets/world/tex/*_cor.jpg) com cara de pintura,
no mesmo estilo cartoon do resto do jogo (tipo Fortnite): tira o granulado de foto, junta as
cores em manchas, aumenta saturação e contraste e clareia um pouco.

Os originais ficam em art/build/tex_originais (copiados na primeira vez); rodar de novo
sempre parte deles.

  blender -b --python tools/blender/stylize_textures.py -- public/assets/world/tex art/build/tex_originais
"""
import os
import shutil
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
tex_dir, orig_dir = os.path.abspath(args[0]), os.path.abspath(args[1])
os.makedirs(orig_dir, exist_ok=True)


def box_blur(a, r):
    """Desfoque de caixa separável (somas acumuladas), com borda repetida (textura repetível)."""
    for axis in (0, 1):
        pad = np.concatenate([a.take(range(-r, 0), axis=axis), a, a.take(range(0, r), axis=axis)], axis=axis)
        cs = np.cumsum(pad, axis=axis, dtype=np.float64)
        zero = np.zeros_like(cs.take([0], axis=axis))
        cs = np.concatenate([zero, cs], axis=axis)
        n = a.shape[axis]
        a = (cs.take(range(2 * r + 1, n + 2 * r + 1), axis=axis) - cs.take(range(0, n), axis=axis)) / (2 * r + 1)
    return a.astype(np.float32)


for name in sorted(os.listdir(tex_dir)):
    if not name.endswith('_cor.jpg'):
        continue
    src = os.path.join(orig_dir, name)
    if not os.path.exists(src):
        shutil.copy2(os.path.join(tex_dir, name), src)
    img = bpy.data.images.load(src)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rgb = px[..., :3]
    # Manchas de cor: mistura forte do desfocado (some o ruído de foto, ficam as formas).
    soft = box_blur(box_blur(rgb, 3), 2)
    rgb = soft * 0.7 + rgb * 0.3
    # Saturação e contraste de desenho, um pouco mais claro.
    lum = (rgb * np.array([0.299, 0.587, 0.114], np.float32)).sum(-1, keepdims=True)
    rgb = lum + (rgb - lum) * 1.4
    mean = rgb.mean(axis=(0, 1), keepdims=True)
    rgb = mean + (rgb - mean) * 1.12
    rgb = rgb * 1.06 + 0.02
    # Leve posterização (tons em degraus, como pintura).
    rgb = np.round(rgb * 28) / 28
    px[..., :3] = np.clip(rgb, 0, 1)
    out = bpy.data.images.new(name + '_out', w, h)
    out.pixels = px.ravel()
    out.filepath_raw = os.path.join(tex_dir, name)
    out.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 90
    out.save()
    print(f'[estilo] {name} {w}x{h}')
print('[estilo] concluído')
