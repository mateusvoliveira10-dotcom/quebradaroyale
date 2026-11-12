"""Bonés do personagem (substituem os de formas simples): copa de 6 gomos com costuras
fundas, botão, ilhoses bordados, carneira (faixa de suor), abertura traseira com fecho
snapback e aba com espessura, pespontos e a curva certa de cada modelo.

blender -b --python tools/blender/cap.py -- <pasta public/assets/world>

Saída: bone_curvo.glb (Prop_bone_curvo, "dad cap": copa mais baixa e aba curvada) e
bone_reto.glb (Prop_bone_reto, snapback: copa alta e estruturada, aba reta). Materiais por
papel (o jogo pinta com as cores da camisa): copa, aba, aba_baixo, costura, botao, faixa,
fecho, emblema (com UV 0..1 para o bordado).

Espaço: origem no centro da base da copa (é o mesmo encaixe do boné antigo, em cima do
`socket_head_top`); no Blender a frente é −Y e o alto é +Z (no jogo: +Z frente, +Y alto).
Medidas em metros, na escala do personagem.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
out_dir = os.path.abspath(args[0])
os.makedirs(out_dir, exist_ok=True)

ROLES = ['copa', 'aba', 'aba_baixo', 'costura', 'botao', 'faixa', 'fecho', 'emblema']
COLORS = {
    'copa': '#2d3340', 'aba': '#2d3340', 'aba_baixo': '#2b3a2c', 'costura': '#ffd21f',
    'botao': '#2d3340', 'faixa': '#202227', 'fecho': '#141416', 'emblema': '#ffffff',
}

# Copa: elipse da cabeça (largura e profundidade) e quanto ela sobe.
RX, RY = 0.1455, 0.157
N_AZ = 96          # divisões em volta
N_EL = 22          # divisões da base ao topo
SEAMS = [k * math.pi / 3 for k in range(6)]   # 0 = costura do meio da frente


def make_mat(role):
    m = bpy.data.materials.new(role)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    h = COLORS[role]
    c = tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    b.inputs['Roughness'].default_value = 0.85 if role not in ('fecho', 'botao') else 0.5
    return m


def front_dir(a):
    """Azimute a (0 = frente, cresce para a esquerda) → direção no plano (Blender: frente −Y)."""
    return Vector((math.sin(a), -math.cos(a), 0))


def seam_depth(a):
    """Costuras: um vinco estreito em cada encontro de gomos."""
    d = min(abs(((a - s + math.pi) % (2 * math.pi)) - math.pi) for s in SEAMS)
    return 0.0022 * math.exp(-(d / 0.022) ** 2)


def build_cap(name, height, structured, brim_len, brim_curve, brim_tilt):
    bm = bmesh.new()
    layers = bm.loops.layers.uv.new('UVMap')
    mats = {r: i for i, r in enumerate(ROLES)}

    def crown_point(a, t):
        """t = 0 na base, 1 no topo. A frente estruturada sobe mais reta (snapback)."""
        frontness = max(0.0, math.cos(a))
        e = t * math.pi / 2
        # Perfil: base mais vertical, topo arredondado; frente estruturada mais "quadrada".
        p = 1.0 + (0.6 if structured else 0.25) * frontness
        rad = math.cos(e) ** (1.0 / p)
        h = height * math.sin(e) ** (0.9 if structured else 1.0)
        h *= 1.0 + (0.06 if structured else 0.02) * frontness
        d = front_dir(a)
        r = Vector((d.x * RX, d.y * RY, 0)) * rad
        # Vinco das costuras (para dentro, na normal aproximada).
        r -= Vector((d.x, d.y, 0)) * seam_depth(a) * (1 - t * 0.6)
        return Vector((r.x, r.y, h))

    # Abertura traseira (snapback): arco na base dos gomos de trás.
    def in_back_opening(a, t):
        da = abs(((a - math.pi + math.pi) % (2 * math.pi)) - math.pi)
        return da < 0.36 and t < 0.24 * math.cos(da / 0.36 * math.pi / 2) ** 0.5

    grid = []
    for j in range(N_EL + 1):
        t = j / N_EL
        row = []
        for i in range(N_AZ):
            a = i / N_AZ * 2 * math.pi
            row.append(bm.verts.new(crown_point(a, min(t, 0.999))))
        grid.append(row)
    top = bm.verts.new(Vector((0, 0, height * (1.04 if structured else 1.0))))
    for j in range(N_EL):
        for i in range(N_AZ):
            a = (i + 0.5) / N_AZ * 2 * math.pi
            if in_back_opening(a, (j + 0.5) / N_EL):
                continue
            i2 = (i + 1) % N_AZ
            f = bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
            f.material_index = mats['copa']
            for loop, (u, v) in zip(f.loops, ((i / N_AZ, j / N_EL), ((i + 1) / N_AZ, j / N_EL), ((i + 1) / N_AZ, (j + 1) / N_EL), (i / N_AZ, (j + 1) / N_EL))):
                loop[layers].uv = (u, v)
    for i in range(N_AZ):
        f = bm.faces.new((grid[N_EL][i], grid[N_EL][(i + 1) % N_AZ], top))
        f.material_index = mats['copa']
        for loop in f.loops:
            loop[layers].uv = (i / N_AZ, 1.0)

    # Espessura da copa (lado de dentro escuro): o mesmo casco um pouco menor, virado para dentro.
    inner = bmesh.ops.duplicate(bm, geom=[f for f in bm.faces])
    inner_faces = [g for g in inner['geom'] if isinstance(g, bmesh.types.BMFace)]
    inner_verts = [g for g in inner['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in inner_verts:
        v.co = Vector((v.co.x * 0.965, v.co.y * 0.965, v.co.z * 0.97 - 0.001))
    bmesh.ops.reverse_faces(bm, faces=inner_faces)
    for f in inner_faces:
        f.material_index = mats['faixa']

    def add_box(center, size, role, rot_z=0.0):
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r['verts']
        bmesh.ops.scale(bm, vec=Vector(size), verts=vs)
        if rot_z:
            from mathutils import Matrix
            bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(rot_z, 3, 'Z'), verts=vs)
        bmesh.ops.translate(bm, vec=Vector(center), verts=vs)
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mats[role]

    def add_cyl(center, radius, depth, role, axis=None, segs=12):
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=depth)
        vs = r['verts']
        if axis is not None:
            q = Vector((0, 0, 1)).rotation_difference(axis)
            bmesh.ops.rotate(bm, cent=Vector(), matrix=q.to_matrix(), verts=vs)
        bmesh.ops.translate(bm, vec=Vector(center), verts=vs)
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mats[role]

    # Botão no topo e ilhoses bordados (um por gomo, perto do alto).
    add_cyl((0, 0, height * (1.04 if structured else 1.0) + 0.002), 0.0105, 0.007, 'botao', segs=16)
    for k in range(6):
        a = SEAMS[k] + math.pi / 6
        p = crown_point(a, 0.72)
        n = (p - Vector((0, 0, height * 0.3))).normalized()
        add_cyl(p + n * 0.0008, 0.0042, 0.0016, 'costura', axis=n, segs=10)

    # Carneira: faixa de suor por dentro da base.
    for i in range(N_AZ):
        a0 = i / N_AZ * 2 * math.pi
        a1 = (i + 1) / N_AZ * 2 * math.pi
        if in_back_opening((a0 + a1) / 2, 0.01):
            continue
        p0 = crown_point(a0, 0) * 0.955
        p1 = crown_point(a1, 0) * 0.955
        vs = [bm.verts.new(p0), bm.verts.new(p1), bm.verts.new(p1 + Vector((0, 0, 0.022))), bm.verts.new(p0 + Vector((0, 0, 0.022)))]
        f = bm.faces.new(vs)
        f.material_index = mats['faixa']
        f2 = bm.faces.new(list(reversed(vs)) and [bm.verts.new(v.co.copy()) for v in reversed(vs)])
        f2.material_index = mats['faixa']

    # Fecho snapback: tira atravessando a abertura com os pinos.
    back = front_dir(math.pi)
    strap_c = Vector((back.x * RX * 1.005, back.y * RY * 1.005, 0.016))
    add_box(strap_c, (0.105, 0.006, 0.016), 'fecho')
    for k in range(-3, 4):
        add_cyl(strap_c + Vector((k * 0.013, 0.004, 0)), 0.0028, 0.004, 'fecho', axis=Vector((0, 1, 0)), segs=8)

    # Emblema bordado no gomo da frente (retalho curvo com UV próprio).
    elems = []
    E_N = 10
    for j in range(E_N + 1):
        row = []
        for i in range(E_N + 1):
            u = i / E_N
            v = j / E_N
            a = (u - 0.5) * 0.62
            t = 0.2 + v * 0.38
            p = crown_point(a, t)
            n = Vector((p.x, p.y, (p.z - height * 0.2) * 0.4)).normalized()
            row.append((bm.verts.new(p + n * 0.0012), (u, v)))
        elems.append(row)
    for j in range(E_N):
        for i in range(E_N):
            q = (elems[j][i], elems[j][i + 1], elems[j + 1][i + 1], elems[j + 1][i])
            f = bm.faces.new([x[0] for x in q])
            f.material_index = mats['emblema']
            for loop, x in zip(f.loops, q):
                loop[layers].uv = x[1]

    # Aba: da base da copa (frente) para fora; curva para baixo nas laterais no "dad cap".
    span = 1.05
    NB = 28
    NR = 6
    top_rows = []
    for r in range(NR + 1):
        k = r / NR
        row = []
        for i in range(NB + 1):
            phi = -span + 2 * span * i / NB
            length = brim_len * max(0.02, math.cos(phi * 1.3)) ** 0.7 * k
            d = front_dir(phi)
            base = Vector((d.x * (RX - 0.002), d.y * (RY - 0.002), 0))
            out = Vector((d.x, d.y, 0)) * length
            z = -brim_curve * (math.sin(phi) ** 2) * k - brim_tilt * k
            row.append(base + out + Vector((0, 0, z)))
        top_rows.append(row)
    TH = 0.0055

    def grid_faces(rows, dz, role, flip):
        vs = [[bm.verts.new(p + Vector((0, 0, dz))) for p in row] for row in rows]
        for r in range(len(rows) - 1):
            for i in range(len(rows[0]) - 1):
                quad = (vs[r][i], vs[r][i + 1], vs[r + 1][i + 1], vs[r + 1][i])
                f = bm.faces.new(tuple(reversed(quad)) if flip else quad)
                f.material_index = mats[role]
                for loop, (u, v) in zip(f.loops, ((i / NB, r / NR), ((i + 1) / NB, r / NR), ((i + 1) / NB, (r + 1) / NR), (i / NB, (r + 1) / NR))):
                    loop[layers].uv = (u, v)
        return vs

    up = grid_faces(top_rows, 0, 'aba', False)
    dn = grid_faces(top_rows, -TH, 'aba_baixo', True)
    # Borda da aba (fecha a espessura).
    last = NR
    for i in range(NB):
        f = bm.faces.new((up[last][i], dn[last][i], dn[last][i + 1], up[last][i + 1]))
        f.material_index = mats['aba']
    for side in (0, NB):
        for r in range(NR):
            q = (up[r][side], up[r + 1][side], dn[r + 1][side], dn[r][side])
            f = bm.faces.new(q if side == 0 else tuple(reversed(q)))
            f.material_index = mats['aba']
    # Pespontos da aba: 4 linhas acompanhando a borda.
    for s in range(4):
        k = 0.42 + s * 0.15
        pts = []
        for i in range(NB + 1):
            a = top_rows[int(k * NR)][i]
            b = top_rows[min(NR, int(k * NR) + 1)][i]
            f = k * NR - int(k * NR)
            pts.append(a.lerp(b, f) + Vector((0, 0, 0.0007)))
        for i in range(2, NB - 1, 1):
            seg = pts[i + 1] - pts[i]
            mid = (pts[i] + pts[i + 1]) / 2
            ang = math.atan2(seg.y, seg.x)
            add_box(mid, (seg.length * 0.7, 0.0011, 0.0008), 'costura', rot_z=ang)

    # Orientação explícita: casca e detalhes para fora, carneira/forro para dentro, aba de
    # cima para cima e de baixo para baixo (o recálculo automático erra em malha aberta).
    mid = Vector((0, 0, height * 0.3))
    for f in bm.faces:
        n = f.normal
        c = f.calc_center_median()
        role = ROLES[f.material_index]
        if role == 'aba':
            want = n.z >= 0 or abs(n.z) < 0.3
        elif role == 'aba_baixo':
            want = n.z <= 0
        elif role == 'faixa':
            want = n.dot(c - mid) <= 0
        else:
            want = n.dot(c - mid) >= 0
        if not want:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for r in ROLES:
        me.materials.append(MAT[r])
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(50))
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def export(obj, path):
    common.select_only(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_materials='EXPORT', export_apply=True)
    print(f'[bone] {os.path.basename(path)} ({os.path.getsize(path) / 1e3:.0f} KB, {len(obj.data.polygons)} faces)')


bpy.ops.wm.read_factory_settings(use_empty=True)
MAT = {r: make_mat(r) for r in ROLES}
curvo = build_cap('Prop_bone_curvo', height=0.128, structured=False, brim_len=0.088, brim_curve=0.038, brim_tilt=0.012)
export(curvo, os.path.join(out_dir, 'bone_curvo.glb'))
curvo.hide_set(True)
reto = build_cap('Prop_bone_reto', height=0.142, structured=True, brim_len=0.094, brim_curve=0.0, brim_tilt=0.004)
export(reto, os.path.join(out_dir, 'bone_reto.glb'))
