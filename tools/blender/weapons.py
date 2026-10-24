"""Armas do jogo, modeladas por código com mais detalhe (sem marcas nem cópia de modelos reais).

  Arma_pistola  ferrolho com serrilhas, armação de polímero, guarda-mato, alça de mira
  Arma_smg      submetralhadora compacta: carregador reto, coronha retrátil, cano curto
  Arma_escopeta escopeta pump de madeira com tubo do carregador e soleira de borracha
  Arma_fuzil    fuzil genérico: trilho em cima com mira holográfica, guarda-mão ventilado,
                carregador curvo, quebra-chamas e coronha ajustável
  Arma_sniper   rifle de ferrolho de madeira com luneta (lentes), cano longo e bipé dobrado
Papéis de material: metal, polymer, wood, steel, accent (cor da raridade no jogo), lens, rubber.

As medidas seguem as armas antigas do jogo: origem no punho e cano para a frente. As contas
são feitas em coordenadas do jogo (x direita, y cima, z frente) e convertidas para o Blender
(frente em -Y), que o glTF/Babylon traz de volta para +Z.

  blender -b --python tools/blender/weapons.py -- public/assets/world/weapons.glb [preview.png]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import reset_scene, script_args  # noqa: E402
from meshkit import Builder, export  # noqa: E402

args = script_args()
out_glb = os.path.abspath(args[0] if args else 'public/assets/world/weapons.glb')
preview_png = os.path.abspath(args[1]) if len(args) > 1 else None
reset_scene()
objs = []


class Gun:
    """Atalhos em coordenadas do jogo (x, y, z frente)."""

    def __init__(self, name):
        self.b = Builder(name)

    @staticmethod
    def p(x, y, z):
        return (-x, -z, y)

    def box(self, c, s, role, bevel=0.003, rx=0.0):
        # rx = inclinação em torno do eixo x do jogo (positivo = topo para a frente).
        self.b.box(self.p(*c), (s[0], s[2], s[1]), role, bevel=bevel, rot=(-rx, 0, 0))

    def cyl(self, c, r, length, role, segs=14, r2=None):
        """Cilindro ao longo do cano (z do jogo)."""
        self.b.cyl(self.p(*c), r, length, role, axis='y', segs=segs, r2=r2)

    def ring(self, c, r, thick, role, segs=12, axis='x'):
        """Argola (guarda-mato, olhal): tubo fechado em volta de c, no plano y-z do jogo."""
        cx, cy, cz = c
        path = [self.p(cx, cy + r * math.sin(2 * math.pi * k / segs), cz + r * math.cos(2 * math.pi * k / segs)) for k in range(segs + 1)]
        self.b.tube(path, thick, role, segs=6, cap=False)

    def tube(self, pts, r, role):
        self.b.tube([self.p(*q) for q in pts], r, role, segs=8)

    def build(self):
        return self.b.build(objs, smooth_angle=35)


# ------------------------------------------------------------------ pistola
g = Gun('Arma_pistola')
g.box((0, 0.056, 0.065), (0.032, 0.036, 0.205), 'metal', bevel=0.004)          # ferrolho
for k in range(6):                                                              # serrilhas
    g.box((0, 0.056, -0.015 + k * 0.008), (0.0335, 0.03, 0.003), 'steel', bevel=0)
g.box((0, 0.028, 0.06), (0.03, 0.022, 0.17), 'polymer', bevel=0.004)          # armação
g.box((0, 0.0225, 0.13), (0.026, 0.008, 0.05), 'polymer', bevel=0.002)        # trilho
g.box((0, -0.035, -0.005), (0.031, 0.105, 0.048), 'polymer', bevel=0.006, rx=-0.22)  # punho
for k in range(4):
    g.box((0, -0.03 - k * 0.018, 0.015 - k * 0.004), (0.033, 0.006, 0.03), 'rubber', bevel=0, rx=-0.22)  # textura do punho
g.box((0, -0.088, -0.018), (0.028, 0.012, 0.045), 'steel', bevel=0.002, rx=-0.22)  # base do carregador
g.ring((0, 0.0, 0.05), 0.022, 0.0035, 'polymer')                                # guarda-mato
g.box((0, 0.005, 0.045), (0.006, 0.02, 0.006), 'steel', bevel=0, rx=0.3)       # gatilho
g.box((0, 0.078, 0.155), (0.006, 0.008, 0.008), 'steel', bevel=0)             # massa de mira
g.box((0, 0.078, -0.03), (0.02, 0.009, 0.008), 'steel', bevel=0)              # alça de mira
g.cyl((0, 0.056, 0.17), 0.009, 0.012, 'steel')                                 # boca do cano
g.box((0, 0.075, 0.07), (0.033, 0.004, 0.11), 'accent', bevel=0)             # faixa da raridade
g.build()

# ------------------------------------------------------------------ submetralhadora
g = Gun('Arma_smg')
g.box((0, 0.045, 0.08), (0.048, 0.06, 0.3), 'metal', bevel=0.006)             # corpo
g.box((0, 0.084, 0.08), (0.022, 0.014, 0.24), 'polymer', bevel=0.002)         # trilho
for k in range(8):
    g.box((0, 0.093, -0.02 + k * 0.03), (0.024, 0.006, 0.012), 'steel', bevel=0)
g.box((0, 0.045, 0.255), (0.05, 0.05, 0.06), 'polymer', bevel=0.006)          # ponta do corpo
g.cyl((0, 0.05, 0.33), 0.012, 0.13, 'steel')                                   # cano
g.cyl((0, 0.05, 0.385), 0.016, 0.025, 'metal')                                 # boca
g.box((0, -0.065, 0.13), (0.03, 0.15, 0.04), 'polymer', bevel=0.004, rx=-0.08)   # carregador reto
g.box((0, -0.14, 0.137), (0.034, 0.012, 0.046), 'steel', bevel=0.002)
g.box((0, -0.03, -0.01), (0.032, 0.1, 0.045), 'polymer', bevel=0.006, rx=-0.25)  # punho
g.ring((0, 0.0, 0.04), 0.024, 0.004, 'polymer')
g.box((0, 0.004, 0.04), (0.006, 0.02, 0.006), 'steel', bevel=0, rx=0.3)
g.box((0, 0.0, 0.16), (0.03, 0.035, 0.05), 'rubber', bevel=0.005)             # empunhadura frontal
for x in (-0.012, 0.012):                                                        # coronha retrátil (arames)
    g.tube([(x, 0.05, -0.07), (x, 0.03, -0.2)], 0.0045, 'steel')
g.box((0, 0.02, -0.215), (0.035, 0.075, 0.018), 'rubber', bevel=0.004)
g.box((0, 0.019, 0.08), (0.05, 0.008, 0.2), 'accent', bevel=0)
g.build()

# ------------------------------------------------------------------ escopeta
g = Gun('Arma_escopeta')
g.box((0, 0.045, 0.06), (0.05, 0.07, 0.24), 'metal', bevel=0.006)             # caixa da culatra
g.box((0, 0.045, 0.07), (0.052, 0.03, 0.09), 'steel', bevel=0.002)           # janela de ejeção
g.cyl((0, 0.068, 0.47), 0.017, 0.62, 'steel', segs=16)                         # cano
g.cyl((0, 0.068, 0.78), 0.019, 0.02, 'metal', segs=16)
g.cyl((0, 0.032, 0.43), 0.015, 0.52, 'metal', segs=14)                         # tubo do carregador
g.box((0, 0.088, 0.78), (0.006, 0.01, 0.008), 'steel', bevel=0)              # mira (conta)
g.box((0, 0.034, 0.38), (0.058, 0.055, 0.17), 'wood', bevel=0.012)            # telha do pump
for k in range(5):
    g.box((0, 0.034, 0.315 + k * 0.03), (0.06, 0.057, 0.006), 'polymer', bevel=0)  # sulcos do pump
g.ring((0, 0.0, 0.03), 0.026, 0.0045, 'metal')
g.box((0, 0.004, 0.03), (0.006, 0.022, 0.006), 'steel', bevel=0, rx=0.3)
g.box((0, -0.03, -0.03), (0.04, 0.1, 0.05), 'wood', bevel=0.01, rx=-0.3)      # pescoço da coronha
g.box((0, 0.0, -0.22), (0.045, 0.1, 0.3), 'wood', bevel=0.014, rx=-0.08)      # coronha
g.box((0, -0.01, -0.375), (0.047, 0.115, 0.02), 'rubber', bevel=0.006, rx=-0.08)  # soleira
g.box((0, 0.081, 0.06), (0.051, 0.008, 0.2), 'accent', bevel=0)
g.build()

# ------------------------------------------------------------------ fuzil
g = Gun('Arma_fuzil')
g.box((0, 0.05, 0.08), (0.05, 0.065, 0.3), 'metal', bevel=0.006)              # caixa superior
g.box((0, 0.012, 0.1), (0.046, 0.04, 0.22), 'metal', bevel=0.006)             # caixa inferior
g.box((0, 0.05, 0.08), (0.052, 0.024, 0.08), 'steel', bevel=0.002)           # janela de ejeção
g.box((0, 0.093, 0.2), (0.024, 0.012, 0.5), 'polymer', bevel=0.002)           # trilho
for k in range(16):
    g.box((0, 0.101, -0.03 + k * 0.03), (0.026, 0.006, 0.012), 'steel', bevel=0)
g.box((0, 0.05, 0.395), (0.06, 0.07, 0.33), 'polymer', bevel=0.012)           # guarda-mão (encosta no corpo)
for k in range(5):                                                               # ventilações
    for s in (-1, 1):
        g.box((s * 0.03, 0.05, 0.35 + k * 0.04), (0.004, 0.03, 0.02), 'metal', bevel=0)
g.cyl((0, 0.05, 0.63), 0.011, 0.18, 'steel')                                   # cano
g.cyl((0, 0.05, 0.75), 0.016, 0.06, 'metal', segs=10)                          # quebra-chamas
for k in range(3):
    g.box((0, 0.05, 0.735 + k * 0.016), (0.034, 0.006, 0.006), 'steel', bevel=0)
g.box((0, 0.11, 0.08), (0.032, 0.03, 0.06), 'polymer', bevel=0.004)           # mira holográfica
g.box((0, 0.13, 0.08), (0.034, 0.012, 0.064), 'polymer', bevel=0.003)
g.box((0, 0.125, 0.112), (0.026, 0.026, 0.004), 'lens', bevel=0)
for k in range(5):                                                               # carregador curvo (gomos sobrepostos)
    g.box((0, -0.02 - k * 0.032, 0.165 + k * 0.011 + k * k * 0.002), (0.03, 0.05, 0.056), 'polymer', bevel=0.004, rx=-0.1 - k * 0.06)
g.box((0, -0.035, -0.01), (0.034, 0.1, 0.045), 'polymer', bevel=0.007, rx=-0.28)  # punho
g.ring((0, -0.005, 0.04), 0.024, 0.0045, 'metal')
g.box((0, 0.0, 0.04), (0.006, 0.02, 0.006), 'steel', bevel=0, rx=0.3)
g.cyl((0, 0.04, -0.12), 0.014, 0.14, 'metal')                                  # tubo da coronha
g.box((0, 0.025, -0.25), (0.042, 0.075, 0.2), 'polymer', bevel=0.01, rx=-0.05)  # coronha
g.box((0, 0.02, -0.355), (0.044, 0.09, 0.016), 'rubber', bevel=0.004)
g.box((0, 0.0, 0.43), (0.062, 0.012, 0.22), 'accent', bevel=0)
g.box((0, 0.066, -0.25), (0.044, 0.008, 0.14), 'accent', bevel=0)
g.build()

# ------------------------------------------------------------------ rifle de precisão
g = Gun('Arma_sniper')
g.cyl((0, 0.05, 0.06), 0.022, 0.3, 'metal', segs=16)                           # culatra redonda
g.tube([(0.0, 0.05, -0.02), (-0.045, 0.045, -0.02), (-0.06, 0.03, -0.025)], 0.006, 'steel')  # alavanca do ferrolho
g.b.blob(Gun.p(-0.062, 0.028, -0.025), (0.011, 0.011, 0.011), 'steel', sub=1, amp=0)
g.cyl((0, 0.05, 0.56), 0.013, 0.7, 'steel', segs=14, r2=0.011)                 # cano longo (afinando)
g.cyl((0, 0.05, 0.9), 0.02, 0.05, 'metal', segs=12)                            # freio de boca
g.cyl((0, 0.135, 0.08), 0.024, 0.26, 'polymer', segs=18)                       # luneta
g.cyl((0, 0.135, 0.245), 0.033, 0.08, 'polymer', segs=18, r2=0.035)
g.cyl((0, 0.135, -0.09), 0.03, 0.07, 'polymer', segs=18)
g.cyl((0, 0.135, 0.288), 0.031, 0.004, 'lens', segs=18)
g.cyl((0, 0.135, -0.127), 0.027, 0.004, 'lens', segs=18)
g.cyl((0, 0.162, 0.08), 0.012, 0.03, 'metal', segs=10)
for z in (0.0, 0.16):
    g.box((0, 0.1, z), (0.018, 0.04, 0.025), 'metal', bevel=0.003)            # anéis da luneta
g.box((0, 0.025, 0.25), (0.05, 0.05, 0.38), 'wood', bevel=0.014)              # telha de madeira
g.box((0, -0.035, -0.02), (0.038, 0.1, 0.05), 'wood', bevel=0.012, rx=-0.3)   # punho
g.ring((0, 0.0, 0.04), 0.025, 0.0045, 'metal')
g.box((0, 0.004, 0.04), (0.006, 0.02, 0.006), 'steel', bevel=0, rx=0.3)
g.box((0, 0.0, -0.24), (0.046, 0.1, 0.34), 'wood', bevel=0.016, rx=-0.06)     # coronha
g.box((0, 0.06, -0.2), (0.03, 0.025, 0.16), 'wood', bevel=0.008)              # apoio de rosto
g.box((0, -0.005, -0.415), (0.048, 0.11, 0.02), 'rubber', bevel=0.006, rx=-0.06)
for s in (-1, 1):                                                                # bipé dobrado
    g.tube([(s * 0.018, 0.02, 0.4), (s * 0.02, 0.012, 0.6)], 0.004, 'metal')
g.box((0, -0.0, 0.25), (0.052, 0.012, 0.3), 'accent', bevel=0)
g.build()

COLORS = {
    'metal': ((0.09, 0.095, 0.11), 0.7, 0.4),
    'polymer': ((0.035, 0.037, 0.045), 0.0, 0.6),
    'wood': ((0.38, 0.2, 0.09), 0.0, 0.55),
    'steel': ((0.55, 0.57, 0.6), 1.0, 0.25),
    'accent': ((0.9, 0.7, 0.1), 0.0, 0.4),
    'lens': ((0.15, 0.4, 0.55), 0.0, 0.05),
    'rubber': ((0.02, 0.02, 0.02), 0.0, 0.9),
}
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
export(objs, out_glb, COLORS)
print(f'[armas] exportado {out_glb} ({os.path.getsize(out_glb) / 1e3:.0f} KB)')

if preview_png:
    for i, o in enumerate(objs):
        o.location = (0, 0, 1.6 - i * 0.38)
        o.rotation_euler = (0, 0, math.pi / 2)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1000
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.78, 0.82, 1)
    scene.world = world
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(40), math.radians(10), math.radians(20)))
    bpy.context.active_object.data.energy = 4
    bpy.ops.object.camera_add(location=(0.2, -3.2, 0.85))
    cam = bpy.context.active_object
    cam.data.lens = 50
    d = Vector((0.2, 0, 0.85)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = preview_png
    bpy.ops.render.render(write_still=True)
