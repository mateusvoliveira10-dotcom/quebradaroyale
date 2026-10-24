"""Carros populares brasileiros genéricos (sem marca, logotipo nem cópia de carroceria).

Gera cinco modelos com a "cara" dos carros de rua de uma comunidade brasileira:
  hatch   - hatch compacto quadradinho dos anos 90
  seda    - sedã antigo de três volumes, capô comprido
  perua   - van/perua de frente chata, teto alto, pintura de duas cores
  picape  - picape pequena de cabine simples com caçamba aberta
  besouro - carrinho arredondado de para-lamas saltados

Cada carro é UM objeto (Car_<id>) com materiais nomeados pelo papel da peça; o jogo
troca cada material por um StandardMaterial próprio (pintura sorteada, vidro, borracha...).
Os colisores saem como caixas invisíveis Col_<id>_<n>.

A carroceria é um "loft": anéis de 14 pontos (seção transversal) ao longo do comprimento.
A topologia do anel é fixa, então faixas do anel têm papel fixo (fundo, saia, porta,
janela, coluna, teto) e as estações em X caem exatamente nas bordas de para-brisa, colunas
e caixas de roda. Isso dá vidros e colunas com borda limpa sem textura nenhuma.

Eixos (Blender): X = comprimento (frente em +X), Y = largura, Z = altura, chão em z = 0.
No jogo (Babylon) a frente fica em -X.

Uso:
  blender -b --python tools/blender/cars.py -- public/assets/world/cars.glb [preview.png]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args, select_only  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/cars.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None

MATS = ['paint', 'paint2', 'glass', 'trim', 'chrome', 'rubber', 'rim', 'light_f', 'light_r', 'plate', 'blue', 'under']
PREVIEW_COLORS = {
    'paint': (0.62, 0.08, 0.06), 'paint2': (0.9, 0.9, 0.86), 'glass': (0.05, 0.08, 0.12), 'trim': (0.04, 0.04, 0.045),
    'chrome': (0.7, 0.72, 0.75), 'rubber': (0.02, 0.02, 0.02), 'rim': (0.55, 0.56, 0.58), 'light_f': (1.0, 0.95, 0.8),
    'light_r': (0.7, 0.04, 0.03), 'plate': (0.95, 0.95, 0.95), 'blue': (0.05, 0.2, 0.6), 'under': (0.03, 0.03, 0.03),
}


def make_materials():
    out = {}
    for name in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        c = PREVIEW_COLORS[name]
        bsdf.inputs['Base Color'].default_value = (*c, 1)
        bsdf.inputs['Roughness'].default_value = 0.35 if name in ('paint', 'paint2', 'glass', 'chrome') else 0.7
        bsdf.inputs['Metallic'].default_value = 1.0 if name in ('chrome', 'rim') else 0.0
        out[name] = m
    return out


# ------------------------------------------------------------------ curvas

def curve(points):
    """Interpolação cúbica monótona (Fritsch–Carlson) por pontos (x, y) — sem 'barriga' entre os pontos."""
    pts = sorted(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(pts)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9:
            t = 3 / math.sqrt(s)
            m[i], m[i + 1] = t * a * d[i], t * b * d[i]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = max(k for k in range(n - 1) if xs[k] <= x)
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]

    return f


def clamp(v, a, b):
    return max(a, min(b, v))


# ------------------------------------------------------------------ geometria básica

class Builder:
    """Acumula vértices/faces com índice de material e vira um objeto no final."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.mats = []

    def v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def f(self, idx, mat):
        self.faces.append(tuple(idx))
        self.mats.append(MATS.index(mat))

    def box(self, c, s, mat, bevel=0.0):
        """Caixa centrada em c com tamanho s; bevel chanfra as quinas verticais e de cima."""
        cx, cy, cz = c
        sx, sy, sz = (s[0] / 2, s[1] / 2, s[2] / 2)
        if bevel <= 0:
            p = [self.v((cx + x * sx, cy + y * sy, cz + z * sz)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
            # 0:(-,-,-) 1:(+,-,-) 2:(-,+,-) 3:(+,+,-) 4..7 iguais em +z
            for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
                self.f([p[i] for i in q], mat)
            return
        b = min(bevel, sx * 0.9, sy * 0.9, sz * 0.9)
        # Octógono em planta, extrudado com chanfro no topo e no fundo.
        def ring(z, inset):
            ex, ey = sx - inset, sy - inset
            pts = [(ex, ey - b), (ex - b, ey), (-ex + b, ey), (-ex, ey - b), (-ex, -ey + b), (-ex + b, -ey), (ex - b, -ey), (ex, -ey + b)]
            return [self.v((cx + x, cy + y, cz + z)) for x, y in pts]
        r0 = ring(-sz, b * 0.6)
        r1 = ring(-sz + b, 0)
        r2 = ring(sz - b, 0)
        r3 = ring(sz, b * 0.6)
        for ra, rb in ((r0, r1), (r1, r2), (r2, r3)):
            for i in range(8):
                j = (i + 1) % 8
                self.f([ra[i], ra[j], rb[j], rb[i]], mat)
        self.f(list(reversed(r0)), mat)
        self.f(r3, mat)

    def lathe(self, profile, segs, center, mat_of, axis='y'):
        """Sólido de revolução em torno do eixo Y (rodas): profile = [(raio, deslocamento)], mat_of(i) por faixa."""
        cx, cy, cz = center
        rings = []
        for r, a in profile:
            ring = []
            for k in range(segs):
                t = 2 * math.pi * k / segs
                if r < 1e-6:
                    ring = [self.v((cx, cy + a, cz))] * segs
                    break
                ring.append(self.v((cx + r * math.cos(t), cy + a, cz + r * math.sin(t))))
            rings.append(ring)
        for i in range(len(rings) - 1):
            ra, rb = rings[i], rings[i + 1]
            for k in range(segs):
                j = (k + 1) % segs
                q = [ra[k], ra[j], rb[j], rb[k]]
                q = [x for n, x in enumerate(q) if x not in q[:n]]
                if len(q) >= 3:
                    self.f(q, mat_of(i))

    def cyl_x(self, c, radius, depth, mat, segs=14):
        """Cilindro deitado no eixo X (farol redondo, lanterna)."""
        cx, cy, cz = c
        a = [self.v((cx - depth / 2, cy + radius * math.cos(2 * math.pi * k / segs), cz + radius * math.sin(2 * math.pi * k / segs))) for k in range(segs)]
        b = [self.v((cx + depth / 2, cy + radius * math.cos(2 * math.pi * k / segs), cz + radius * math.sin(2 * math.pi * k / segs))) for k in range(segs)]
        for k in range(segs):
            j = (k + 1) % segs
            self.f([a[k], a[j], b[j], b[k]], mat)
        self.f(list(reversed(a)), mat)
        self.f(b, mat)

    def build(self, mats):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        for name in MATS:
            me.materials.append(mats[name])
        for poly, mi in zip(me.polygons, self.mats):
            poly.material_index = mi
        me.validate()
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(obj)
        return obj


# ------------------------------------------------------------------ carroceria

def loft_body(bd, spec):
    """Carroceria a partir das curvas do spec. Devolve funções úteis para posicionar detalhes."""
    xf, xr = spec['front'], spec['rear']
    roof = curve(spec['roof'])
    belt = curve(spec['belt'])
    hw = curve(spec['hw'])
    crown = spec.get('crown', 0.03)
    wr = spec['wheel_r']
    arch_r = wr + 0.07
    wheels = spec['wheels']
    ws0, ws1, rg1, rg0 = spec['cabin']  # base/topo do para-brisa, topo/base do vidro traseiro
    side_glass = spec['side_glass']  # faixas de X com janela lateral
    pillars = spec.get('pillars', [])  # faixas de X de colunas pretas dentro da janela
    zb0 = spec.get('clearance', 0.24)
    tumble = spec.get('tumble', 0.16)
    two_tone_upper = spec.get('two_tone_upper', False)
    doors = spec.get('doors', (xr + 0.9, xf - 1.0))

    def zb(x):
        z = zb0
        for wx in wheels:
            dx = x - wx
            if abs(dx) < arch_r:
                z = max(z, wr + math.sqrt(arch_r * arch_r - dx * dx) * 0.92)
        # Bico e traseira sobem um pouco (ângulo de ataque/saída).
        z = max(z, zb0 + 0.12 * clamp((x - (xf - 0.35)) / 0.35, 0, 1) ** 2)
        z = max(z, zb0 + 0.10 * clamp(((xr + 0.3) - x) / 0.3, 0, 1) ** 2)
        return z

    def ring(x):
        w = hw(x)
        zbl = belt(x)
        zr = max(roof(x), zbl + 0.06)
        z0 = zb(x)
        z2 = z0 + 0.07
        z3 = clamp(max(spec.get('z_mid', 0.55), z0 + 0.12), z2 + 0.02, zbl - 0.04)
        z5 = max(zbl + 0.03, zr - 0.06)
        lift = clamp((z5 - zbl) / 0.45, 0, 1)
        y5 = w - 0.03 - tumble * lift
        y6 = y5 - 0.06 - 0.08 * lift
        bulge = spec.get('bulge', 0.02)
        half = [
            (w - 0.07, z0),            # 1 fundo/saia
            (w - 0.01, z2),            # 2 saia
            (w + bulge, z3),           # 3 meio da porta (mais largo)
            (w, zbl),                  # 4 linha de cintura
            (y5, z5),                  # 5 topo da janela / borda do capô
            (y6, zr),                  # 6 calha do teto
        ]
        pts = [(0.0, z0)] + half + [(0.0, zr + crown * (1 if zr > zbl + 0.2 else 0.5))] + [(-y, z) for y, z in reversed(half)]
        return [(x, y, z) for y, z in pts]

    # Estações: bordas importantes (vidros, colunas, portas, pontas) têm prioridade; as
    # uniformes e as das caixas de roda só entram longe delas.
    keys = {round(v, 4) for v in (xf, xr, ws0, ws1, rg1, rg0, *[a for r in side_glass for a in r], *[a for r in pillars for a in r], *doors)}
    keys = {k for k in keys if xr <= k <= xf}
    fill = set()
    n = int((xf - xr) / 0.11)
    for i in range(n + 1):
        fill.add(xr + (xf - xr) * i / n)
    for wx in wheels:
        for k in range(-6, 7):
            fill.add(wx + arch_r * k / 6)
    for k in range(1, 4):
        fill.add(xf - 0.03 * k * k)
        fill.add(xr + 0.03 * k * k)
    stations = sorted(keys)
    for s in sorted(fill):
        if xr < s < xf and all(abs(s - t) > 0.025 for t in stations):
            stations.append(s)
            stations.sort()

    rings = [[bd.v(p) for p in ring(x)] for x in stations]
    N = len(rings[0])  # 14

    def between(x, a, b):
        return min(a, b) <= x <= max(a, b)

    def in_ranges(x, ranges):
        return any(between(x, a, b) for a, b in ranges)

    for si in range(len(rings) - 1):
        ra, rb = rings[si], rings[si + 1]
        xm = (stations[si] + stations[si + 1]) / 2
        for k in range(N):
            j = (k + 1) % N
            # Faixa do anel (o lado -Y espelha o +Y): 0 fundo, 1 saia, 2 porta-baixo,
            # 3 porta-cima, 4 janela, 5 coluna/calha, 6 teto/capô.
            band = k if k <= 6 else N - 1 - k
            if band == 0:
                mat = 'under'
            elif band in (1, 2, 3):
                # paint2 nas portas: igual à pintura nos carros comuns, outra cor na viatura.
                mat = 'paint2' if band in (2, 3) and not two_tone_upper and between(xm, *doors) else 'paint'
            elif band == 4:
                glass = in_ranges(xm, side_glass) and not in_ranges(xm, pillars)
                if glass:
                    mat = 'glass'
                elif in_ranges(xm, pillars):
                    mat = 'trim'
                else:
                    mat = 'paint2' if two_tone_upper else 'paint'
            elif band == 5:
                mat = 'paint2' if two_tone_upper else 'paint'
            else:
                if between(xm, ws0, ws1) or between(xm, rg1, rg0):
                    mat = 'glass'
                else:
                    mat = 'paint2' if two_tone_upper else 'paint'
            bd.f([ra[k], rb[k], rb[j], ra[j]], mat)
    # Tampas (frente e traseira).
    bd.f(list(reversed(rings[-1])), 'paint')
    bd.f(rings[0], 'paint')

    return {'zb': zb, 'hw': hw, 'belt': belt, 'roof': roof}


def wheel(bd, x, y, side, r, hub='rim'):
    """Pneu com flanco arredondado, aro e calota. side = +1/-1 (lado de fora em +Y/-Y)."""
    w = 0.19
    s = side
    tire = [(0.2, -w / 2), (r - 0.035, -w / 2), (r - 0.005, -w / 2 + 0.03), (r, 0), (r - 0.005, w / 2 - 0.03), (r - 0.035, w / 2), (0.2, w / 2)]
    tire = [(rr, a * s) for rr, a in tire]
    bd.lathe(tire, 20, (x, y, r), lambda i: 'rubber')
    rim = [(0.2, (w / 2) * s), (0.19, (w / 2 - 0.02) * s), (0.08, (w / 2 - 0.035) * s), (0.06, (w / 2 - 0.01) * s), (0.0, (w / 2 - 0.008) * s)]
    bd.lathe(rim, 16, (x, y, r), lambda i: hub if i < 3 else 'chrome')
    # Miolo escuro do lado de dentro.
    bd.lathe([(0.2, (-w / 2) * s), (0.0, (-w / 2 + 0.02) * s)], 12, (x, y, r), lambda i: 'under')


def common_details(bd, spec, f, bumper_mat='trim', lights='rect', grille=True):
    xf, xr = spec['front'], spec['rear']
    zb, hw, belt = f['zb'], f['hw'], f['belt']
    wfront = hw(xf)
    wrear = hw(xr)
    # Para-choques.
    zbf = zb(xf) + 0.1
    bd.box((xf + 0.02, 0, zbf), (0.16, wfront * 2 + 0.06, 0.17), bumper_mat, bevel=0.04)
    zbr = zb(xr) + 0.1
    bd.box((xr - 0.02, 0, zbr), (0.16, wrear * 2 + 0.06, 0.17), bumper_mat, bevel=0.04)
    # Faróis e grade.
    zl = spec.get('light_z', belt(xf) - 0.12)
    ly = wfront - spec.get('light_inset', 0.22)
    if lights == 'rect':
        for s in (-1, 1):
            bd.box((xf + 0.005, s * ly, zl), (0.04, 0.3, 0.13), 'light_f', bevel=0.015)
            # Pisca (seta) laranja-avermelhado ao lado do farol.
            bd.box((xf + 0.012, s * (ly + 0.19), zl), (0.03, 0.07, 0.1), 'light_r', bevel=0.01)
    else:
        for s in (-1, 1):
            bd.cyl_x((xf - 0.01, s * ly, zl), 0.085, 0.06, 'chrome', 16)
            bd.cyl_x((xf + 0.02, s * ly, zl), 0.07, 0.02, 'light_f', 16)
    if grille:
        gw = max(0.2, ly * 2 - 0.42)
        bd.box((xf + 0.004, 0, zl), (0.03, gw, 0.12), 'trim', bevel=0.01)
        for k in range(3):
            bd.box((xf + 0.012, 0, zl - 0.035 + k * 0.035), (0.02, gw - 0.04, 0.012), 'chrome' if bumper_mat == 'chrome' else 'trim')
    # Lanternas.
    zt = spec.get('tail_z', belt(xr) - 0.1)
    ty = wrear - 0.14
    for s in (-1, 1):
        bd.box((xr - 0.004, s * ty, zt), (0.04, spec.get('tail_w', 0.22), spec.get('tail_h', 0.14)), 'light_r', bevel=0.01)
    # Placas (padrão Mercosul genérico: branca com faixa azul, sem letras).
    for x, sgn in ((xf + 0.105, 1), (xr - 0.105, -1)):
        z = zbf if sgn > 0 else zbr + 0.17
        bd.box((x, 0, z), (0.02, 0.4, 0.13), 'plate')
        bd.box((x + sgn * 0.004, 0, z + 0.05), (0.02, 0.4, 0.03), 'blue')
    # Retrovisores na base da coluna A.
    ws0 = spec['cabin'][0]
    for s in (-1, 1):
        y = hw(ws0) + 0.06
        bd.box((ws0 - 0.08, s * y, belt(ws0) + 0.06), (0.1, 0.12, 0.09), 'trim', bevel=0.02)
        bd.box((ws0 - 0.02, s * (y - 0.06), belt(ws0) + 0.03), (0.06, 0.06, 0.03), 'trim')
    # Maçanetas.
    for dx in spec.get('handles', []):
        for s in (-1, 1):
            bd.box((dx, s * (hw(dx) + 0.025), belt(dx) - 0.07), (0.12, 0.03, 0.025), 'trim')
    # Rodas.
    for wx in spec['wheels']:
        for s in (-1, 1):
            wheel(bd, wx, s * (hw(wx) - 0.12), s, spec['wheel_r'], spec.get('hub', 'rim'))


# ------------------------------------------------------------------ modelos

SPECS = {
    # Hatch compacto anos 90: quadradinho, capô curto, para-brisa em pé, traseira reta.
    'hatch': {
        'front': 1.82, 'rear': -1.84, 'wheels': (1.18, -1.2), 'wheel_r': 0.28,
        'roof': [(-1.84, 0.9), (-1.8, 1.02), (-1.62, 1.3), (-1.36, 1.41), (0.35, 1.43), (0.62, 1.38), (1.15, 0.91), (1.5, 0.86), (1.82, 0.8)],
        'belt': [(-1.84, 0.84), (-1.0, 0.86), (0.6, 0.86), (1.82, 0.78)],
        'hw': [(-1.84, 0.68), (-1.7, 0.77), (-1.2, 0.79), (1.2, 0.79), (1.65, 0.77), (1.82, 0.7)],
        'cabin': (1.12, 0.66, -1.4, -1.78), 'side_glass': [(-1.36, 1.06)], 'pillars': [(-0.08, 0.0), (-1.0, -0.92)],
        'doors': (-0.5, 1.0), 'handles': [0.0], 'tumble': 0.16, 'z_mid': 0.6,
    },
    # Sedã antigo de três volumes: capô e porta-malas compridos, para-choque cromado.
    'seda': {
        'front': 2.3, 'rear': -2.3, 'wheels': (1.42, -1.38), 'wheel_r': 0.3,
        'roof': [(-2.3, 0.82), (-2.0, 0.9), (-1.35, 0.92), (-1.05, 1.32), (-0.65, 1.38), (0.45, 1.38), (0.75, 1.32), (1.25, 0.94), (2.0, 0.88), (2.3, 0.8)],
        'belt': [(-2.3, 0.82), (-1.3, 0.86), (1.2, 0.86), (2.3, 0.78)],
        'hw': [(-2.3, 0.74), (-2.1, 0.84), (-1.4, 0.86), (1.4, 0.86), (2.1, 0.84), (2.3, 0.76)],
        'cabin': (1.2, 0.78, -0.68, -1.25), 'side_glass': [(-1.0, 1.15)], 'pillars': [(0.02, 0.1)],
        'doors': (-0.9, 1.1), 'handles': [0.1, -0.85], 'tumble': 0.18, 'z_mid': 0.6, 'crown': 0.025,
        'bumper': 'chrome', 'tail_w': 0.32, 'tail_h': 0.12, 'light_inset': 0.2,
    },
    # Perua/van: frente chata, sem capô, teto alto, saia/teto de duas cores.
    'perua': {
        'front': 2.1, 'rear': -2.1, 'wheels': (1.38, -1.25), 'wheel_r': 0.3, 'clearance': 0.26,
        'roof': [(-2.1, 1.72), (-2.02, 1.9), (-1.8, 1.95), (1.75, 1.95), (1.98, 1.86), (2.1, 1.22)],
        'belt': [(-2.1, 1.08), (2.1, 1.08)],
        'hw': [(-2.1, 0.78), (-1.95, 0.85), (1.9, 0.85), (2.1, 0.8)],
        'cabin': (2.08, 1.94, -1.9, -2.06), 'side_glass': [(-1.85, 1.95)], 'pillars': [(1.2, 1.28), (0.25, 0.33), (-0.75, -0.67)],
        'doors': (-0.7, 1.9), 'handles': [1.25, 0.2], 'tumble': 0.06, 'z_mid': 0.7, 'crown': 0.04,
        'two_tone_upper': True, 'bumper': 'chrome', 'light_z': 0.78, 'lights': 'round', 'light_inset': 0.2,
        'tail_z': 0.85, 'tail_w': 0.1, 'tail_h': 0.2, 'grille': False, 'hub': 'chrome',
    },
    # Picape pequena: cabine simples e caçamba (aberta por booleano).
    'picape': {
        'front': 2.15, 'rear': -2.15, 'wheels': (1.4, -1.32), 'wheel_r': 0.3, 'clearance': 0.28,
        'roof': [(-2.15, 1.0), (-0.5, 1.02), (-0.42, 1.44), (0.4, 1.48), (0.7, 1.4), (1.25, 1.0), (1.9, 0.94), (2.15, 0.85)],
        'belt': [(-2.15, 0.96), (-0.4, 0.94), (1.2, 0.92), (2.15, 0.84)],
        'hw': [(-2.15, 0.76), (-2.0, 0.8), (1.5, 0.8), (2.0, 0.78), (2.15, 0.72)],
        'cabin': (1.18, 0.72, -0.42, -0.5), 'side_glass': [(-0.36, 1.1)], 'pillars': [],
        'doors': (-0.4, 1.1), 'handles': [-0.1], 'tumble': 0.15, 'z_mid': 0.62,
        'bed': (-2.07, -0.56), 'tail_z': 0.75,
    },
    # Carrinho arredondado: teto em arco, capô caído, para-lamas saltados, faróis redondos.
    'besouro': {
        'front': 1.95, 'rear': -1.95, 'wheels': (1.2, -1.2), 'wheel_r': 0.3, 'clearance': 0.26,
        'roof': [(-1.95, 0.7), (-1.8, 0.92), (-1.45, 1.2), (-0.9, 1.42), (-0.3, 1.5), (0.25, 1.47), (0.6, 1.3), (0.9, 0.98), (1.4, 0.86), (1.95, 0.62)],
        'belt': [(-1.95, 0.7), (-1.3, 0.82), (0.9, 0.84), (1.95, 0.62)],
        'hw': [(-1.95, 0.5), (-1.7, 0.7), (-1.2, 0.8), (-0.75, 0.73), (0.75, 0.73), (1.2, 0.8), (1.7, 0.7), (1.95, 0.5)],
        'cabin': (0.92, 0.55, -0.85, -1.35), 'side_glass': [(-1.05, 0.82)], 'pillars': [(-0.2, -0.13)],
        'doors': (-0.2, 0.9), 'handles': [-0.15], 'tumble': 0.3, 'z_mid': 0.58, 'crown': 0.06, 'bulge': 0.03,
        'bumper': 'chrome', 'lights': 'round', 'light_z': 0.66, 'light_inset': 0.24, 'tail_z': 0.72, 'tail_w': 0.1, 'tail_h': 0.16,
        'grille': False, 'hub': 'chrome',
    },
}


def build_car(key, spec, mats):
    bd = Builder(f'Car_{key}')
    f = loft_body(bd, spec)
    common_details(bd, spec, f, bumper_mat=spec.get('bumper', 'trim'), lights=spec.get('lights', 'rect'), grille=spec.get('grille', True))
    obj = bd.build(mats)

    if 'bed' in spec:
        # Caçamba: recorta a parte de cima da traseira por booleano, deixando paredes de 5 cm.
        x0, x1 = spec['bed']
        w = spec['hw'][2][1]
        cut = Builder('bed_cut')
        cut.box(((x0 + x1) / 2, 0, 0.62 + 1.0), (x1 - x0, (w - 0.05) * 2, 2.0), 'paint')
        cut_obj = cut.build(mats)
        mod = obj.modifiers.new('cacamba', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = cut_obj
        select_only(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cut_obj)
        # Fundo da caçamba (forro preto) e protetor de cabine.
        extra = Builder('bed_extra')
        extra.box(((x0 + x1) / 2, 0, 0.63), (x1 - x0, (w - 0.05) * 2, 0.02), 'trim')
        extra.box((x1 + 0.03, 0, 1.12), (0.04, (w - 0.1) * 2, 0.32), 'trim')
        for k in range(4):
            extra.box((x1 + 0.03, 0, 1.0 + k * 0.08), (0.06, (w - 0.1) * 2, 0.02), 'chrome')
        eo = extra.build(mats)
        select_only(obj)
        eo.select_set(True)
        bpy.ops.object.join()

    # Luz de teto da perua/van e frisos não entram: o jogo acrescenta acessórios (táxi, polícia).
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38), keep_sharp_edges=True)
    except Exception:  # Blender < 4.1
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(38)
    return obj


def colliders(key, spec):
    """Caixas de colisão: corpo até a cintura + cabine até o teto (dá para escalar por cima)."""
    out = []
    xf, xr = spec['front'], spec['rear']
    hw = max(v for _, v in spec['hw'])
    belt = max(v for _, v in spec['belt'])
    roof_pts = spec['roof']
    top = max(v for _, v in roof_pts)
    ws0, _, _, rg0 = spec['cabin']

    def add(n, x0, x1, z0, z1, w):
        bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, 0, (z0 + z1) / 2))
        o = bpy.context.active_object
        o.name = f'Col_{key}_{n}'
        o.scale = (x1 - x0, w * 2, z1 - z0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        out.append(o)

    add(0, xr - 0.08, xf + 0.08, 0.0, belt, hw)
    if top > belt + 0.15:
        add(1, max(xr, rg0 - 0.05), min(xf, ws0 + 0.05), belt, top, hw - 0.1)
    return out


# ------------------------------------------------------------------ main

reset_scene()
mats = make_materials()
cars = []
cols = []
for i, (key, spec) in enumerate(SPECS.items()):
    car = build_car(key, spec, mats)
    cars.append(car)
    cols += colliders(key, spec)
    tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
    print(f'[carros] {key}: {len(car.data.vertices)} vértices, {tris} triângulos')

# Organiza lado a lado só para a prévia; no GLB cada carro vai na origem.
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
for o in bpy.context.view_layer.objects:
    o.select_set(o in cars or o in cols)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=False,
                          export_normals=True, export_materials='EXPORT', export_animations=False, export_morph=False, export_skins=False,
                          export_extras=False)
print(f'[carros] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for c in cols:
        c.hide_render = True
    for i, c in enumerate(cars):
        c.location = ((i % 3) * 5.2 - 5.2, (i // 3) * 3.2, 0)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.mesh.primitive_plane_add(size=60)
    bpy.ops.object.camera_add(location=(9, -11, 6.5))
    cam = bpy.context.active_object
    cam.data.lens = 40
    d = Vector((0, 1.4, 0.6)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
    print(f'[carros] prévia {preview_png}')
