"""Variação de cor de um prop texturizado (GLB de textured_prop.py): troca a cor só das
partes escolhidas da textura, mantendo luz, sombra e detalhes.

  blender -b --python tools/blender/recolor.py -- <entrada.glb> <saída.glb> <modo> <params...>

Modos:
  hue  <h0> <h1> <sat_min> <novo_h> <mult_sat> <mult_val>
       pixels com matiz entre h0 e h1 (0..1) e saturação >= sat_min ganham o matiz novo
       (ex.: o mostrador verde do relógio vira azul; a lona marrom da mochila vira vermelha)
  tint <sat_max> <val_min> <r> <g> <b>
       pixels quase sem cor (branco/cinza claro) são tingidos com a cor dada, mantendo o
       claro e escuro (ex.: o fone branco vira preto, vermelho, azul)
  gray <r> <g> <b> <ganho>
       todos os pixels viram tons da cor dada pela luminância (ex.: o dread colorido vira
       preto, castanho ou loiro, mantendo os fios e as sombras)
"""
import os
import sys

import bpy
import numpy as np

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src, out, mode = os.path.abspath(args[0]), os.path.abspath(args[1]), args[2]
p = [float(v) for v in args[3:]]


def rgb_to_hsv(rgb):
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    mx = rgb.max(1)
    mn = rgb.min(1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = (b - r)[gg] / d[gg] + 2
    h[bb] = (r - g)[bb] / d[bb] + 4
    h = h / 6
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return np.stack([h, s, mx], 1)


def hsv_to_rgb(hsv):
    h, s, v = hsv[:, 0] * 6, hsv[:, 1], hsv[:, 2]
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    pp, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    out = np.zeros((len(h), 3), np.float32)
    for k, (a, b2, c) in enumerate(((v, t, pp), (q, v, pp), (pp, v, t), (pp, q, v), (t, pp, v), (v, pp, q))):
        sel = i == k
        out[sel] = np.stack([a[sel], b2[sel], c[sel]], 1)
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for img in bpy.data.images:
    if 'normal' in img.name.lower():
        continue
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    hsv = rgb_to_hsv(px[:, :3])
    if mode == 'hue':
        h0, h1, smin, nh, ms, mv = p
        sel = (hsv[:, 0] >= h0) & (hsv[:, 0] <= h1) & (hsv[:, 1] >= smin)
        hsv[sel, 0] = nh
        hsv[sel, 1] = np.clip(hsv[sel, 1] * ms, 0, 1)
        hsv[sel, 2] = np.clip(hsv[sel, 2] * mv, 0, 1)
        px[sel, :3] = hsv_to_rgb(hsv[sel])
    elif mode == 'gray':
        r, g, b, gain = p
        lum = (px[:, 0] * 0.3 + px[:, 1] * 0.59 + px[:, 2] * 0.11)[:, None]
        sel = np.ones(len(px), bool)
        px[:, :3] = np.clip(lum * np.array([r, g, b], np.float32) * gain, 0, 1)
    else:
        smax, vmin, r, g, b = p
        sel = (hsv[:, 1] <= smax) & (hsv[:, 2] >= vmin)
        col = np.array([r, g, b], np.float32)
        px[sel, :3] = np.clip(hsv[sel, 2:3] * col * 1.15, 0, 1)
    print(f'[recolor] {img.name}: {int(sel.sum())} pixels')
    img.pixels = px.ravel()
    img.update()
    img.file_format = 'JPEG'
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=86,
                          export_animations=False)
print(f'[recolor] {out} ({os.path.getsize(out) / 1e6:.2f} MB)')
