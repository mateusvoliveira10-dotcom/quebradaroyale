"""Texturas PBR do mapa (tileáveis): cor, relevo (normal map) e rugosidade/metal.

blender -b --python tools/blender/textures.py -- <pasta public/assets/world/tex> [tamanho=1024]

Saída, para cada material (tijolo, reboco, concreto, telha, fibrocimento, asfalto, calcada,
metal, madeira, piso):
  <nome>_cor.jpg      cor (sRGB). O reboco sai claro e neutro: o jogo tinge com a cor da
                      parede (albedoColor), assim uma textura serve para todas as cores.
  <nome>_normal.jpg   normal map (espaço tangente, +Y para cima, convenção OpenGL)
  <nome>_orm.jpg      R = oclusão, G = rugosidade, B = metal (padrão glTF/Babylon)

Tudo gerado com numpy por ruído periódico (repete sem emenda): sem imagens de terceiros.
Cada textura cobre uma área real (comentada em MATS) — o jogo usa essa medida no UV.
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
out_dir = os.path.abspath(args[0])
N = int(args[1]) if len(args) > 1 and args[1].isdigit() else 1024
os.makedirs(out_dir, exist_ok=True)
RNG = np.random.default_rng(20261018)

# ------------------------------------------------------------------ ruído periódico
U, V = np.meshgrid((np.arange(N) + 0.5) / N, (np.arange(N) + 0.5) / N)


def vnoise(freq, seed=0):
    """Ruído de valor suave e periódico (repete em u e v), freq = células por lado."""
    r = np.random.default_rng(seed).random((freq, freq))
    x = U * freq
    y = V * freq
    i0 = np.floor(x).astype(int) % freq
    j0 = np.floor(y).astype(int) % freq
    i1 = (i0 + 1) % freq
    j1 = (j0 + 1) % freq
    fx = x - np.floor(x)
    fy = y - np.floor(y)
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = r[j0, i0] * (1 - fx) + r[j0, i1] * fx
    b = r[j1, i0] * (1 - fx) + r[j1, i1] * fx
    return a * (1 - fy) + b * fy


def vnoise2(fu, fv, seed=0):
    """Ruído de valor periódico anisotrópico (fu células em u, fv em v)."""
    r = np.random.default_rng(seed).random((fv, fu))
    x = U * fu
    y = V * fv
    i0 = np.floor(x).astype(int) % fu
    j0 = np.floor(y).astype(int) % fv
    i1 = (i0 + 1) % fu
    j1 = (j0 + 1) % fv
    fx = x - np.floor(x)
    fy = y - np.floor(y)
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = r[j0, i0] * (1 - fx) + r[j0, i1] * fx
    b = r[j1, i0] * (1 - fx) + r[j1, i1] * fx
    return a * (1 - fy) + b * fy


def fbm(freq, octaves=5, seed=0, gain=0.5):
    s, a, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + a * vnoise(freq * 2 ** o, seed + o * 17)
        tot += a
        a *= gain
    return s / tot


def worley(freq, seed=0):
    """Distância ao ponto mais próximo (células periódicas), normalizada ~0..1."""
    pts = np.random.default_rng(seed).random((freq, freq, 2))
    x = U * freq
    y = V * freq
    best = np.full(U.shape, 9.0)
    ci = np.floor(x).astype(int)
    cj = np.floor(y).astype(int)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ii = ci + di
            jj = cj + dj
            p = pts[jj % freq, ii % freq]
            dx = ii + p[..., 0] - x
            dy = jj + p[..., 1] - y
            best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
    return best


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


def normal_from_height(h, strength):
    """Normal map periódico a partir da altura (diferenças com vizinhos que dão a volta)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * N
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * N
    n = np.stack([-dx * strength / N, -dy * strength / N, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def ao_from_height(h, radius=6):
    blur = h.copy()
    for _ in range(3):
        acc = blur.copy()
        for s in (radius, -radius):
            acc += np.roll(blur, s, 0) + np.roll(blur, s, 1)
        blur = acc / 5
    return np.clip(1 - (blur - h) * 3.0, 0.35, 1)


def save(name, rgb, colorspace='sRGB'):
    img = bpy.data.images.new(name, N, N, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((N, N, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(out_dir, f'{name}.jpg')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(filepath=path, quality=88)
    bpy.data.images.remove(img)


def write(name, color, height, rough, metal=None, nstrength=6.0, ao=None):
    save(f'{name}_cor', color)
    save(f'{name}_normal', normal_from_height(height, nstrength), 'Non-Color')
    occ = ao if ao is not None else ao_from_height(height)
    rough = np.broadcast_to(np.asarray(rough, np.float32), height.shape)
    orm = np.stack([occ, np.clip(rough, 0.04, 1), np.zeros_like(rough) if metal is None else metal], -1)
    save(f'{name}_orm', orm, 'Non-Color')
    print(f'[texturas] {name}')


# ------------------------------------------------------------------ materiais
def brick():
    """Tijolo aparente (furado, laranja), 1,2 × 1,2 m: 6 tijolos de 19 cm por fiada,
    12 fiadas de 9 cm, argamassa de 1 cm recuada e borrada, fiadas alternadas."""
    rows, cols = 12, 6
    y = V * rows
    row = np.floor(y).astype(int)
    x = U * cols + 0.5 * (row % 2)
    col = np.floor(x).astype(int) % cols
    fx = x - np.floor(x)
    fy = y - np.floor(y)
    mortar_w = 0.055 * cols / 1.0, 0.11
    edge = np.minimum(np.minimum(fx, 1 - fx) / 0.055, np.minimum(fy, 1 - fy) / 0.11)
    m = smooth(0.5, 1.4, edge + (fbm(64, 3, 5) - 0.5) * 0.9)        # 0 = argamassa, 1 = tijolo
    pr = np.random.default_rng(3).random((rows, cols))
    tone = pr[row % rows, col]
    base = hexc('#b65a32') * (0.82 + 0.3 * tone[..., None])
    base = base + (hexc('#7e3a20') - base) * (fbm(48, 4, 9) * 0.6)[..., None]
    burnt = smooth(0.82, 0.95, tone)[..., None] * 0.35
    base = base * (1 - burnt)
    grit = (fbm(256, 3, 21) - 0.5) * 0.12
    mortar = hexc('#9c968a') * (0.85 + fbm(128, 3, 31)[..., None] * 0.3)
    col_rgb = mortar * (1 - m[..., None]) + (base + grit[..., None]) * m[..., None]
    # sujeira escorrida
    streak = vnoise(40, 77) ** 3 * smooth(0.4, 1.0, V)
    col_rgb *= (1 - 0.25 * streak)[..., None]
    h = m * 0.8 + fbm(128, 4, 41) * 0.25 + (1 - m) * fbm(256, 2, 51) * 0.1
    rough = 0.82 + (1 - m) * 0.1 + (fbm(64, 2, 61) - 0.5) * 0.1
    write('tijolo', col_rgb, h, rough, nstrength=7)


def plaster():
    """Reboco pintado (neutro, tingido no jogo), 2,5 × 3 m: textura de desempeno, trincas,
    manchas de umidade embaixo, escorridos e respingos de terra no rodapé."""
    trowel = fbm(24, 5, 101)
    fine = fbm(220, 3, 111)
    # trincas finas e raras (só onde a máscara grande deixa)
    crack = smooth(0.0, 0.005, np.abs(fbm(10, 5, 121) - 0.5))
    crack_m = (1 - crack) * smooth(0.72, 0.85, fbm(4, 3, 131)) * 0.8
    damp_ = smooth(0.32, 0.0, V + (fbm(10, 4, 141) - 0.5) * 0.25)              # umidade no pé da parede
    # escorridos verticais saindo da laje (faixas finas e longas, que somem descendo)
    streaks = smooth(0.62, 0.9, vnoise2(70, 3, 151) * 0.75 + vnoise2(160, 6, 153) * 0.25)
    drip = streaks * smooth(0.35, 1.0, V) * 0.9
    stain = smooth(0.6, 0.8, fbm(5, 4, 161)) * 0.18
    c = np.ones((N, N, 3), np.float32) * 0.93
    c *= (0.95 + 0.08 * (trowel - 0.5) + 0.04 * (fine - 0.5))[..., None]
    c *= (1 - 0.35 * damp_ - 0.22 * np.clip(drip, 0, 1) - stain)[..., None]
    c = c * (1 - 0.6 * crack_m[..., None])
    # musgo/terra amarelada no rodapé
    c = c + (np.array([0.55, 0.5, 0.36]) * 0.6 - c) * (damp_ * 0.45)[..., None]
    h = trowel * 0.4 + fine * 0.25 - crack_m * 0.6
    rough = 0.9 - 0.08 * damp_
    write('reboco', c, h, rough, nstrength=3)


def concrete():
    """Concreto aparente, 2 × 2 m: marcas de forma, poros, manchas."""
    base = fbm(16, 5, 201)
    pores = smooth(0.1, 0.0, worley(90, 211)) * smooth(0.5, 0.7, vnoise(30, 213))
    board = smooth(0.48, 0.5, np.abs(((V * 5) % 1) - 0.5)) * 0.06
    c = hexc('#9c9890') * (0.85 + 0.3 * (base - 0.5))[..., None]
    c *= (1 - 0.45 * pores - board)[..., None]
    c *= (1 - 0.18 * smooth(0.6, 0.8, fbm(4, 3, 221)))[..., None]
    h = base * 0.3 - pores * 0.5 - board * 2
    write('concreto', c, h, 0.88 + 0.06 * (base - 0.5), nstrength=4)


def roof_tile():
    """Telha colonial (capa e canal), 1,6 × 1,6 m: 10 fileiras de 16 cm, telhas de 40 cm
    sobrepostas, cor de barro variando por telha, limo nas bordas."""
    cols, rows = 10, 4
    x = U * cols
    y = V * rows
    ci = np.floor(x).astype(int)
    ri = np.floor(y).astype(int)
    fx = x - ci
    fy = y - ri
    wave = np.cos((fx - 0.5) * 2 * math.pi)          # capa (alto) e canal (baixo)
    lap = smooth(0.0, 0.12, fy) * smooth(1.0, 0.85, fy)
    h = wave * 0.5 + 0.5 + (1 - lap) * -0.4 + fy * 0.15
    tone = np.random.default_rng(301).random((rows, cols))[ri % rows, ci % cols]
    c = hexc('#a5482a') * (0.78 + 0.35 * tone)[..., None]
    c = c + (hexc('#6f2d18') - c) * (0.4 * (1 - (wave * 0.5 + 0.5)))[..., None]
    moss = smooth(0.55, 0.75, fbm(8, 4, 311)) * smooth(0.6, 1.0, fy) * 0.6
    c = c + (hexc('#4c5a2c') - c) * moss[..., None]
    c *= (0.9 + 0.2 * (fbm(128, 3, 321) - 0.5))[..., None]
    c *= (0.55 + 0.45 * lap)[..., None]
    write('telha', c, h, 0.78 - 0.1 * (wave * 0.5 + 0.5), nstrength=10)


def fibro():
    """Telha de fibrocimento ondulada, 1,1 × 1,1 m: 6 ondas, manchas escuras e liquens."""
    waves = 6
    s = np.sin(U * waves * 2 * math.pi)
    h = s * 0.5 + 0.5
    c = hexc('#a9a9a1') * (0.9 + 0.12 * s)[..., None]
    dirt = smooth(0.5, 0.8, fbm(6, 5, 401)) * 0.35 + smooth(0.4, 0.9, fbm(30, 3, 411)) * smooth(0.0, 0.6, V) * 0.2
    c *= (1 - dirt)[..., None]
    lichen = smooth(0.08, 0.0, worley(30, 421)) * smooth(0.6, 0.8, fbm(5, 3, 431))
    c = c + (hexc('#c9b878') - c) * (lichen * 0.7)[..., None]
    write('fibrocimento', c, h, 0.86, nstrength=8)


def asphalt():
    """Asfalto, 4 × 4 m: agregado, desgaste, remendos mais escuros e rachaduras."""
    agg = fbm(300, 2, 501)
    wear = fbm(6, 4, 511)
    c = hexc('#3b3c40') * (0.85 + 0.25 * (agg - 0.5) + 0.2 * (wear - 0.5))[..., None]
    patch = smooth(0.62, 0.64, vnoise(5, 521) * 0.7 + fbm(20, 3, 523) * 0.3)
    c *= (1 - 0.25 * patch)[..., None]
    crack = 1 - smooth(0.0, 0.006, np.abs(fbm(9, 5, 531) - 0.5))
    crack *= smooth(0.5, 0.65, fbm(4, 3, 541))
    c *= (1 - 0.55 * crack)[..., None]
    h = agg * 0.5 - crack * 0.8 + patch * 0.1
    write('asfalto', c, h, 0.92 - 0.1 * patch, nstrength=5)


def sidewalk():
    """Calçada de placas de concreto 50 × 50 cm (2 × 2 m), juntas, placas com tons e uma
    ou outra trincada."""
    n = 4
    x = U * n
    y = V * n
    fx = x - np.floor(x)
    fy = y - np.floor(y)
    joint = smooth(0.0, 0.025, np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)))
    tone = np.random.default_rng(601).random((n, n))[np.floor(y).astype(int) % n, np.floor(x).astype(int) % n]
    c = hexc('#b9b5ab') * (0.88 + 0.16 * tone + 0.1 * (fbm(64, 4, 611) - 0.5))[..., None]
    c *= (0.6 + 0.4 * joint)[..., None]
    crack = (1 - smooth(0.0, 0.008, np.abs(fbm(7, 5, 621) - 0.5))) * smooth(0.7, 0.8, vnoise(4, 631))
    c *= (1 - 0.5 * crack)[..., None]
    dirt = smooth(0.55, 0.8, fbm(5, 4, 641)) * 0.2
    c *= (1 - dirt)[..., None]
    h = joint * 0.6 + fbm(128, 3, 651) * 0.15 - crack * 0.4
    write('calcada', c, h, 0.86, nstrength=5)


def metal():
    """Chapa pintada com desgaste e ferrugem (portões, caixas), 1 × 1 m. Cor neutra (tingida)."""
    rust = smooth(0.55, 0.75, fbm(10, 5, 701) + (vnoise(60, 703) - 0.5) * 0.3)
    paint = np.ones((N, N, 3), np.float32) * 0.85
    c = paint * (1 - rust[..., None]) + hexc('#7a3e1d') * (0.7 + 0.5 * fbm(80, 3, 711))[..., None] * rust[..., None]
    scratches = smooth(0.985, 1.0, vnoise(400, 721)) * 0.3
    c = np.clip(c + scratches[..., None], 0, 1)
    h = rust * 0.4 + fbm(200, 2, 731) * 0.1
    metal_ = (1 - rust) * 0.35
    write('metal', c, h, 0.45 + 0.45 * rust, metal=metal_, nstrength=3)


def wood():
    """Madeira de porta (veios), 1 × 2 m."""
    warp = fbm(6, 4, 801) * 3
    grain = np.sin((U * 40 + warp) * math.pi) * 0.5 + 0.5
    c = hexc('#7a4a2a') * (0.75 + 0.35 * grain)[..., None]
    c *= (0.9 + 0.2 * (fbm(120, 3, 811) - 0.5))[..., None]
    write('madeira', c, grain * 0.3, 0.7, nstrength=3)


def floor_tile():
    """Piso cerâmico de laje/varanda (30 × 30 cm), 1,2 × 1,2 m."""
    n = 4
    fx = (U * n) % 1
    fy = (V * n) % 1
    joint = smooth(0.0, 0.03, np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)))
    tone = np.random.default_rng(901).random((n, n))[np.floor(V * n).astype(int) % n, np.floor(U * n).astype(int) % n]
    c = hexc('#a8553a') * (0.85 + 0.2 * tone + 0.08 * (fbm(90, 3, 911) - 0.5))[..., None]
    c = c * joint[..., None] + hexc('#8f8a80') * (1 - joint)[..., None]
    write('piso', c, joint * 0.5, 0.55 + 0.3 * (1 - joint), nstrength=4)


def worley2(freq, seed=0):
    """F1 e F2 (distâncias ao ponto mais próximo e ao segundo) e o id da célula do F1."""
    pts = np.random.default_rng(seed).random((freq, freq, 2))
    x = U * freq
    y = V * freq
    f1 = np.full(U.shape, 9.0)
    f2 = np.full(U.shape, 9.0)
    cid = np.zeros(U.shape, np.int64)
    ci = np.floor(x).astype(int)
    cj = np.floor(y).astype(int)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ii = ci + di
            jj = cj + dj
            p = pts[jj % freq, ii % freq]
            d = np.sqrt((ii + p[..., 0] - x) ** 2 + (jj + p[..., 1] - y) ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, (jj % freq) * freq + (ii % freq), cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def dirt():
    """Terra batida, 4 × 4 m: barro avermelhado com variação, pedrisco, marcas de chuva,
    tufos de mato ralo e manchas mais escuras de umidade."""
    base = fbm(8, 5, 1001)
    c = hexc('#8a5a3a') * (0.8 + 0.4 * (base - 0.5))[..., None]
    c = c + (hexc('#a9845c') - c) * smooth(0.5, 0.8, fbm(5, 4, 1003))[..., None] * 0.5
    f1, f2, cid = worley2(48, 1011)
    peb = smooth(0.16, 0.06, f1) * (np.random.default_rng(1013).random(48 * 48)[cid] > 0.7) * 0.8
    ptone = np.random.default_rng(1015).random(48 * 48)[cid]
    c = c * (1 - peb[..., None]) + (hexc('#7d746a') * (0.6 + 0.5 * ptone[..., None])) * peb[..., None]
    grass = smooth(0.62, 0.75, fbm(10, 4, 1021)) * smooth(0.45, 0.7, fbm(90, 2, 1023))
    c = c + (hexc('#5d6e33') * (0.8 + 0.4 * fbm(60, 2, 1025))[..., None] - c) * (grass * 0.85)[..., None]
    wet = smooth(0.6, 0.8, fbm(4, 3, 1031)) * 0.25
    c *= (1 - wet)[..., None]
    c *= (0.92 + 0.16 * (fbm(200, 2, 1041) - 0.5))[..., None]
    h = base * 0.4 + peb * 0.6 + grass * 0.3 + fbm(150, 3, 1051) * 0.2
    write('terra', c, h, 0.95 - 0.15 * wet, nstrength=5)


def stone():
    """Muro de arrimo de pedra argamassada, 2 × 2 m: pedras irregulares (células) com tons
    de granito, argamassa recuada, limo e escorridos."""
    f1, f2, cid = worley2(9, 1101)
    edge = f2 - f1
    m = smooth(0.04, 0.12, edge)                       # 0 = argamassa, 1 = pedra
    tone = np.random.default_rng(1103).random(81)[cid]
    c = hexc('#8b8782') * (0.7 + 0.45 * tone)[..., None]
    c = c + (hexc('#9c8a70') - c) * (np.random.default_rng(1105).random(81)[cid] > 0.7)[..., None] * 0.5
    c *= (0.85 + 0.3 * (fbm(60, 4, 1107) - 0.5))[..., None]
    mortar = hexc('#a49d90') * (0.8 + 0.3 * fbm(90, 3, 1109))[..., None]
    c = mortar * (1 - m[..., None]) + c * m[..., None]
    moss = smooth(0.55, 0.75, fbm(6, 4, 1111)) * (1 - m * 0.5) * smooth(0.6, 0.0, V)
    c = c + (hexc('#4d5a2c') - c) * (moss * 0.6)[..., None]
    streak = smooth(0.62, 0.9, vnoise2(40, 3, 1113)) * smooth(0.3, 1.0, V) * 0.25
    c *= (1 - streak)[..., None]
    bulge = np.sqrt(np.clip(edge * 4, 0, 1))
    h = m * (0.5 + 0.5 * bulge) + fbm(120, 3, 1121) * 0.15
    write('pedra', c, h, 0.9, nstrength=8)


ALL = (brick, plaster, concrete, roof_tile, fibro, asphalt, sidewalk, metal, wood, floor_tile, dirt, stone)
only = [a for a in args[1:] if not a.isdigit()]
for fn in ALL:
    if not only or fn.__name__ in only:
        fn()
print('[texturas] concluído')
