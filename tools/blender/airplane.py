"""Avião do Battle Royale ("QUEBRADA AIR"): cargueiro quadrimotor turboélice estilizado.

blender -b --python tools/blender/airplane.py -- <pasta public/assets/world> [--sem-previa]

Saída:
  airplane.glb   Aviao (fuselagem, asas, naceles, empenagem, carenagens do trem de pouso,
                 letreiro em relevo), Helice_0..3 (hélices, origem no cubo, giram em Z do
                 glTF) e Rampa (rampa de carga traseira, origem na dobradiça, abre girando
                 em X). Frente em −Y no Blender (+Z no glTF/jogo).
  art/build/aviao_previa/  conferência

Geometria toda por loft de seções (fuselagem em superelipse com nariz arredondado e cauda
levantada, asas e empenagem com perfil aerodinâmico, afilamento e diedro, naceles), nada de
caixas ou cilindros soltos. Cores por região (barriga cinza, faixa verde e amarela, pontas
das asas verdes, leme verde e amarelo), materiais PBR (pintura, metal, vidro, borracha).
Medidas: 26 m de comprimento, 30 m de envergadura, fuselagem de 3,8 m.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
out_dir = os.path.abspath(args[0])
make_preview = '--sem-previa' not in args
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------------ materiais
def pbr(name, hex_, metal=0.0, rough=0.4, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


MAT = {
    'branco': pbr('aviao_branco', '#f1f0ea', 0.15, 0.32),
    'cinza': pbr('aviao_cinza', '#8d939b', 0.3, 0.45),
    'verde': pbr('aviao_verde', '#0f9a49', 0.15, 0.35),
    'amarelo': pbr('aviao_amarelo', '#ffd21f', 0.15, 0.35),
    'azul': pbr('aviao_azul', '#1f4fc4', 0.15, 0.35),
    'metal': pbr('aviao_metal', '#c3c8ce', 0.9, 0.28),
    'escuro': pbr('aviao_escuro', '#24272d', 0.4, 0.45),
    'vidro': pbr('aviao_vidro', '#0d1620', 0.6, 0.08),
    'borracha': pbr('aviao_borracha', '#16171a', 0.0, 0.8),
}
MAT_LIST = list(MAT)


def new_obj(name, verts, faces, mats):
    """Objeto a partir de vértices, faces e o papel de material de cada face."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    for k in MAT_LIST:
        me.materials.append(MAT[k])
    me.polygons.foreach_set('material_index', [MAT_LIST.index(m) for m in mats])
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def loft(rings, closed=True, cap_start=True, cap_end=True):
    """Faces ligando anéis com o mesmo número de pontos. Devolve (verts, faces)."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    m = n if closed else n - 1
    for i in range(len(rings) - 1):
        for j in range(m):
            a = i * n + j
            b = i * n + (j + 1) % n
            faces.append([a, b, b + n, a + n])
    if cap_start:
        faces.append(list(range(n))[::-1])
    if cap_end:
        k = (len(rings) - 1) * n
        faces.append(list(range(k, k + n)))
    return verts, faces


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ fuselagem
L = 26.0
Y_NOSE, Y_TAIL = -L / 2, L / 2
A0, B0 = 1.9, 1.95          # meia largura e meia altura da seção principal
N_RING = 40
SUPER = 2.4                 # superelipse (cargueiro: um pouco quadrado)


def section(t):
    """t = 0 no nariz, 1 na cauda: (meia largura, meia altura, centro z)."""
    if t < 0.2:
        k = t / 0.2
        f = math.sqrt(max(0.0, 1 - (1 - k) ** 2.2))
        a, b = A0 * (0.06 + 0.94 * f), B0 * (0.06 + 0.94 * f)
        c = -0.35 * (1 - f)                     # nariz levemente abaixado
        return a, b, c
    if t < 0.62:
        return A0, B0, 0.0
    k = (t - 0.62) / 0.38
    # cauda: a parte de baixo sobe (rampa), a de cima continua quase reta
    top = B0 - 0.25 * k
    bottom = -B0 + 2.9 * k ** 1.3
    a = A0 * (1 - 0.82 * k ** 1.4)
    return a, (top - bottom) / 2, (top + bottom) / 2


def ring(t):
    a, b, c = section(t)
    y = Y_NOSE + t * L
    pts = []
    for j in range(N_RING):
        th = 2 * math.pi * j / N_RING
        cs, sn = math.cos(th), math.sin(th)
        x = a * math.copysign(abs(cs) ** (2 / SUPER), cs)
        z = c + b * math.copysign(abs(sn) ** (2 / SUPER), sn)
        pts.append((x, y, z))
    return pts


ts = [0.0005] + [((i / 70) ** 1.0) for i in range(1, 71)]
rings = [ring(t) for t in ts]
fv, ff = loft(rings)
fmats = []
WIN_T = [0.27 + 0.034 * i for i in range(5)] + [0.62 + 0.034 * i for i in range(3)]
for f in ff:
    pts = np.array([fv[i] for i in f])
    cx, cy, cz = pts.mean(0)
    t = (cy - Y_NOSE) / L
    a, b, c = section(min(1, max(0, t)))
    rel = (cz - c) / max(b, 1e-3)
    role = 'branco'
    if rel < -0.45:
        role = 'cinza'                                   # barriga
    elif -0.12 < rel < 0.12 and 0.18 < t < 0.9:
        role = 'verde'                                   # faixa principal
    elif 0.12 <= rel < 0.2 and 0.18 < t < 0.9:
        role = 'amarelo'                                 # filete
    # janelas da cabine (no alto do nariz)
    if 0.075 < t < 0.15 and 0.22 < rel < 0.8 and abs(cx) < a * 0.92 and abs(cx) > a * 0.05:
        role = 'vidro'
    # janelinhas da cabine de carga, logo acima da faixa
    if 0.2 < rel < 0.42 and any(abs(t - w) < 0.008 for w in WIN_T) and abs(cx) > a * 0.6:
        role = 'vidro'
    fmats.append(role)
fus = new_obj('Fuselagem', fv, ff, fmats)

# ------------------------------------------------------------------ superfícies aerodinâmicas
def airfoil(n=18, thick=0.13, camber=0.02):
    """Perfil (x de 0 = bordo de ataque a 1 = bordo de fuga, z) fechado, sentido único."""
    xs = [(1 - math.cos(math.pi * i / n)) / 2 for i in range(n + 1)]
    upper, lower = [], []
    for x in xs:
        yt = 5 * thick * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yc = camber * 4 * x * (1 - x)
        upper.append((x, yc + yt))
        lower.append((x, yc - yt))
    return upper[::-1] + lower[1:-1]        # do bordo de fuga por cima até o ataque e volta por baixo


AF = airfoil()


def surface(name, stations, role_fn, vertical=False):
    """stations: lista de (posição do bordo de ataque (x,y,z), corda, espessura relativa).
    Horizontal: corda ao longo de +Y (para trás), espessura em Z. Vertical: espessura em X."""
    rings = []
    for (le, chord, th) in stations:
        r = []
        for (u, v) in AF:
            v = v * th / 0.13
            if vertical:
                r.append((le[0] + v * chord, le[1] + u * chord, le[2]))
            else:
                r.append((le[0], le[1] + u * chord, le[2] + v * chord))
        rings.append(r)
    verts, faces = loft(rings)
    roles = []
    for f in faces:
        cpt = np.array([verts[i] for i in f]).mean(0)
        roles.append(role_fn(cpt))
    return new_obj(name, verts, faces, roles)


# Asa alta, um pouco acima do teto, com diedro e afilamento; pontas verdes.
WING_Z = B0 * 0.92
WING_Y = -2.6          # bordo de ataque na raiz
SPAN = 15.0
wing_st = []
for i in range(-14, 15):
    s = i / 14 * SPAN
    k = abs(s) / SPAN
    chord = 4.0 - 1.9 * k
    le = (s, WING_Y + 0.9 * k, WING_Z + 0.06 * abs(s) + (0.0 if abs(s) > 1.6 else 0.05))
    wing_st.append((le, chord, 0.15 - 0.04 * k))
wing = surface('Asa', wing_st, lambda p: 'verde' if abs(p[0]) > SPAN - 1.7 else ('cinza' if p[2] < WING_Z + 0.06 * abs(p[0]) - 0.02 and abs(p[0]) > 2 else 'branco'))

# Empenagem: deriva (vertical) e profundores.
TAIL_Y = Y_TAIL - 4.6
fin_st = []
for i in range(9):
    k = i / 8
    chord = 4.4 - 2.0 * k
    fin_st.append(((0, TAIL_Y + 2.2 * k, B0 - 0.2 + 0.1 + 5.2 * k), chord, 0.13))
fin = surface('Deriva', fin_st, lambda p: 'amarelo' if p[2] > B0 + 3.2 else ('verde' if p[2] > B0 + 1.4 else 'branco'), vertical=True)
stab_st = []
for i in range(-8, 9):
    s = i / 8 * 5.6
    k = abs(s) / 5.6
    stab_st.append(((s, TAIL_Y + 0.6 + 0.9 * k, B0 * 0.55 + 0.05 * abs(s)), 3.0 - 1.3 * k, 0.12))
stab = surface('Profundor', stab_st, lambda p: 'verde' if abs(p[0]) > 4.6 else 'branco')

# ------------------------------------------------------------------ naceles, cubos e hélices
ENG_X = [-8.6, -4.6, 4.6, 8.6]
props = []
nacelles = []
for idx, ex in enumerate(ENG_X):
    k = abs(ex) / SPAN
    wz = WING_Z + 0.06 * abs(ex)
    wle = WING_Y + 0.9 * k
    y0, y1 = wle - 2.7, wle + 3.6
    nr = []
    for i in range(24):
        u = i / 23
        y = y0 + u * (y1 - y0)
        # perfil: frente arredondada (entrada de ar), corpo, cauda afinando
        r = 0.62 * (math.sqrt(max(0.0, 1 - (1 - min(1, u / 0.18)) ** 2)) if u < 0.18 else 1.0) * (1 - 0.75 * smoothstep(0.62, 1.0, u))
        r = max(r, 0.04)
        zc = wz - 0.5 - 0.1 * smoothstep(0.0, 0.3, u)
        nr.append([(ex + r * math.cos(2 * math.pi * j / 20), y, zc + r * 1.08 * math.sin(2 * math.pi * j / 20)) for j in range(20)])
    v, f = loft(nr)
    roles = ['metal' if (np.array([v[i] for i in fc]).mean(0)[1] < y0 + 0.5) else 'cinza' for fc in f]
    nacelles.append(new_obj(f'Nacele_{idx}', v, f, roles))
    # cubo (spinner) cônico
    hub = Vector((ex, y0 - 0.02, wz - 0.5))
    sp = []
    for i in range(10):
        u = i / 9
        r = 0.34 * math.sqrt(max(0.0, 1 - u ** 1.6))
        y = hub.y - 0.95 * u
        sp.append([(ex + max(r, 0.01) * math.cos(2 * math.pi * j / 16), y, hub.z + max(r, 0.01) * math.sin(2 * math.pi * j / 16)) for j in range(16)])
    v, f = loft(sp)
    spinner = new_obj(f'Cubo_{idx}', v, f, ['amarelo'] * len(f))
    # hélice: 4 pás torcidas e afiladas, origem no cubo
    pv, pf, pm = [], [], []
    for blade in range(4):
        ang = blade * math.pi / 2 + idx * 0.4
        rings_b = []
        for i in range(9):
            u = i / 8
            rad = 0.3 + u * 2.1
            chord = 0.42 - 0.22 * u
            twist = 0.9 - 0.65 * u
            sec = []
            for (a, b) in [(-0.5, 0.0), (0.0, 0.05), (0.5, 0.0), (0.0, -0.05)]:
                cx, cz = a * chord, b * chord
                # torção: gira o perfil em volta do eixo da pá
                lx = cx * math.cos(twist)
                ly = cx * math.sin(twist) + cz
                px = rad * math.cos(ang) - lx * math.sin(ang)
                pz = rad * math.sin(ang) + lx * math.cos(ang)
                sec.append((px, -ly - 0.05, pz))
            rings_b.append(sec)
        v, f = loft(rings_b)
        base = len(pv)
        pv += v
        pf += [[i + base for i in fc] for fc in f]
        pm += ['escuro' if i < len(f) - 6 else 'amarelo' for i in range(len(f))]
    prop = new_obj(f'Helice_{idx}', pv, pf, pm)
    prop.location = hub
    props.append(prop)

# ------------------------------------------------------------------ carenagens do trem de pouso e rampa
fair = []
for side in (-1, 1):
    fr = []
    for i in range(16):
        u = i / 15
        y = -2.8 + u * 7.5
        r = 0.75 * math.sin(math.pi * min(1.0, u * 1.0)) ** 0.6 + 0.05
        fr.append([(side * (A0 * 0.82) + side * r * 0.9 * max(0.0, math.cos(2 * math.pi * j / 16)), y, -B0 * 0.62 + r * 0.8 * math.sin(2 * math.pi * j / 16)) for j in range(16)])
    v, f = loft(fr)
    fair.append(new_obj(f'Carenagem_{"E" if side > 0 else "D"}', v, f, ['cinza'] * len(f)))

# Rampa traseira: placa curva que acompanha a barriga da cauda, dobradiça embaixo na frente.
t0, t1 = 0.7, 0.9
rr = []
for t in np.linspace(t0, t1, 10):
    a, b, c = section(t)
    y = Y_NOSE + t * L
    row = []
    for j in range(11):
        th = math.pi + math.pi * (0.15 + 0.7 * j / 10)
        cs, sn = math.cos(th), math.sin(th)
        row.append((a * 0.99 * math.copysign(abs(cs) ** (2 / SUPER), cs), y, c + b * 1.01 * math.copysign(abs(sn) ** (2 / SUPER), sn)))
    rr.append(row)
v, f = loft(rr, closed=False, cap_start=False, cap_end=False)
ramp = new_obj('Rampa', v, f, ['cinza'] * len(f))
hinge_t = t0
ha, hb, hc = section(hinge_t)
hinge = Vector((0, Y_NOSE + hinge_t * L, hc - hb))
ramp.data.transform(Matrix.Translation(-hinge))
ramp.location = hinge

# ------------------------------------------------------------------ letreiro em relevo
def text_mesh(body, size, loc, rot, role, depth=0.04):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = depth
    for fpath in ('C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(fpath):
            cu.font = bpy.data.fonts.load(fpath)
            break
    o = bpy.data.objects.new('txt', cu)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    common.select_only(o)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.data.materials.clear()
    for k in MAT_LIST:
        o.data.materials.append(MAT[k])
    for p in o.data.polygons:
        p.material_index = MAT_LIST.index(role)
    return o


labels = []
for side in (-1, 1):
    # na lateral, acima da faixa verde, lido da frente para trás de cada lado
    x = side * (A0 + 0.02)
    rot = (math.pi / 2, 0, side * math.pi / 2)
    labels.append(text_mesh('QUEBRADA AIR', 1.15, (x, 5.6, 0.95), rot, 'verde'))
    labels.append(text_mesh('BR', 1.6, (side * 0.24, TAIL_Y + 2.2, B0 + 2.6), (math.pi / 2, 0, side * math.pi / 2), 'azul'))

# ------------------------------------------------------------------ junta, origem, export
body_parts = [fus, wing, fin, stab] + nacelles + fair + labels + [o for o in bpy.data.objects if o.name.startswith('Cubo_')]
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in body_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = fus
bpy.ops.object.join()
fus.name = 'Aviao'
common.select_only(fus)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mod = fus.modifiers.new('suave', 'WEIGHTED_NORMAL')
mod.keep_sharp = True
bpy.ops.object.modifier_apply(modifier=mod.name)
tris = sum(len(p.vertices) - 2 for p in fus.data.polygons)
print(f'[aviao] corpo: {tris} triângulos; hélices: {sum(len(p.data.polygons) for p in props)} faces')

for o in bpy.context.view_layer.objects:
    o.select_set(o in [fus, ramp] + props)
glb = os.path.join(out_dir, 'airplane.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True,
                          export_materials='EXPORT', export_apply=True)
print(f'[aviao] exportado {glb} ({os.path.getsize(glb) / 1e3:.0f} KB)')

if make_preview:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.7, 0.9, 1)
    scene.world = world
    sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (0.8, 0.2, 0.6)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    prev = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', 'build', 'aviao_previa')
    os.makedirs(prev, exist_ok=True)
    c = Vector((0, 0, 1))
    for nm, d in (('tres_quartos', Vector((-0.75, -0.65, 0.35))), ('lado', Vector((-1, 0, 0.05))), ('traseira', Vector((0.5, 0.8, 0.3))), ('cima', Vector((0.05, 0.1, 1)))):
        cam.location = c + d.normalized() * 48
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 50
        scene.render.filepath = os.path.join(prev, f'{nm}.png')
        bpy.ops.render.render(write_still=True)
print('[aviao] concluído')
