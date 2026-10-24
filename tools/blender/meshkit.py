"""Construtor de malhas por código para os scripts de props e armas.

Acumula vértices e faces com um "papel" de material por face (o jogo troca cada papel por
um material da biblioteca dele) e vira um objeto do Blender no fim. Formas: caixa (com
chanfro), cilindro em qualquer eixo, sólido de revolução, tubo por caminho e "bolha"
(icosfera deformada por ruído).
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

_ICO = {}
MATERIALS = {}


def unit_ico(sub):
    if sub not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        bm.verts.ensure_lookup_table()
        _ICO[sub] = ([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces])
        bm.free()
    return _ICO[sub]


def material(role, color=(0.5, 0.5, 0.5), metal=0.0, rough=0.6):
    if role not in MATERIALS:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        MATERIALS[role] = m
    return MATERIALS[role]


class Builder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.roles = [], [], []
        # Transformação aplicada aos pontos novos (empilhável com push/pop).
        self.stack = [Matrix.Identity(4)]

    # ----------------------------------------------------------- transformações
    def push(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Scale(scale, 4)
        self.stack.append(self.stack[-1] @ m)

    def pop(self):
        self.stack.pop()

    def v(self, p):
        self.verts.append(self.stack[-1] @ Vector(p))
        return len(self.verts) - 1

    def f(self, idx, role):
        self.faces.append(tuple(idx))
        self.roles.append(role)

    # ----------------------------------------------------------- formas
    def box(self, c, s, role, bevel=0.0, rot=(0, 0, 0)):
        """Caixa centrada em c (tamanho s); bevel chanfra as quinas."""
        self.push(c, rot)
        sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        b = min(bevel, sx * 0.45, sy * 0.45, sz * 0.45)
        if b <= 0:
            p = [self.v((x * sx, y * sy, z * sz)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
            for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
                self.f([p[i] for i in q], role)
        else:
            def ring(z, inset):
                ex, ey = sx - inset, sy - inset
                pts = [(ex, ey - b), (ex - b, ey), (-ex + b, ey), (-ex, ey - b), (-ex, -ey + b), (-ex + b, -ey), (ex - b, -ey), (ex, -ey + b)]
                return [self.v((x, y, z)) for x, y in pts]
            rings = [ring(-sz, b * 0.7), ring(-sz + b, 0), ring(sz - b, 0), ring(sz, b * 0.7)]
            for ra, rb in zip(rings, rings[1:]):
                for i in range(8):
                    j = (i + 1) % 8
                    self.f([ra[i], ra[j], rb[j], rb[i]], role)
            self.f(list(reversed(rings[0])), role)
            self.f(rings[-1], role)
        self.pop()

    def lathe(self, profile, segs, role_of, center=(0, 0, 0), rot=(0, 0, 0), radial=None):
        """Revolução em torno do eixo Z local: profile = [(raio, z)]; radial(k, i) modula o raio."""
        self.push(center, rot)
        rings = []
        for i, (r, z) in enumerate(profile):
            if r < 1e-6:
                c = self.v((0, 0, z))
                rings.append([c] * segs)
                continue
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs
                rr = r * (radial(k, i) if radial else 1)
                ring.append(self.v((rr * math.cos(a), rr * math.sin(a), z)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            ra, rb = rings[i], rings[i + 1]
            for k in range(segs):
                j = (k + 1) % segs
                q = [ra[k], ra[j], rb[j], rb[k]]
                q = [x for n, x in enumerate(q) if x not in q[:n]]
                if len(q) >= 3:
                    self.f(q, role_of(i) if callable(role_of) else role_of)
        self.pop()

    def cyl(self, c, radius, length, role, axis='z', segs=12, cap=True, r2=None):
        """Cilindro (ou cone com r2) centrado em c ao longo de 'x', 'y' ou 'z'."""
        rot = {'x': (0, math.pi / 2, 0), 'y': (math.pi / 2, 0, 0), 'z': (0, 0, 0)}[axis]
        r2 = radius if r2 is None else r2
        prof = [(0.0, -length / 2), (radius, -length / 2), (r2, length / 2), (0.0, length / 2)] if cap else [(radius, -length / 2), (r2, length / 2)]
        self.lathe(prof, segs, role, c, rot)

    def tube(self, path, radius, role, segs=8, cap=True):
        rings = []
        n = len(path)
        for i, p in enumerate(path):
            p = Vector(p)
            a, b = Vector(path[max(0, i - 1)]), Vector(path[min(n - 1, i + 1)])
            t = (b - a).normalized()
            u = t.cross(Vector((0, 0, 1)))
            if u.length < 1e-3:
                u = t.cross(Vector((1, 0, 0)))
            u.normalize()
            w = t.cross(u).normalized()
            r = radius(i / max(1, n - 1)) if callable(radius) else radius
            rings.append([self.v(p + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        for ra, rb in zip(rings, rings[1:]):
            for k in range(segs):
                j = (k + 1) % segs
                self.f([ra[k], ra[j], rb[j], rb[k]], role)
        if cap:
            self.f(list(reversed(rings[0])), role)
            self.f(rings[-1], role)

    def blob(self, c, r, role, sub=2, amp=0.2, freq=1.8, seed=0.0, shape=None):
        """Icosfera deformada; shape(p_unit) -> Vector permite esculpir (ex.: saco amarrado)."""
        verts, faces = unit_ico(sub)
        off = Vector((seed * 7.1, seed * 3.3, seed * 5.7))
        base = len(self.verts)
        for p in verts:
            q = shape(p.copy()) if shape else p.copy()
            d = 1 + amp * noise.noise(p * freq + off)
            self.verts.append(self.stack[-1] @ (Vector(c) + Vector((q.x * r[0], q.y * r[1], q.z * r[2])) * d))
        for f in faces:
            self.f([base + i for i in f], role)

    # ----------------------------------------------------------- saída
    def build(self, objs, recalc=True, smooth_angle=40):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        used = []
        for r in self.roles:
            if r not in used:
                used.append(r)
        for r in used:
            me.materials.append(material(r))
        for poly, r in zip(me.polygons, self.roles):
            poly.material_index = used.index(r)
        me.validate()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(obj)
        me.shade_smooth()
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle), keep_sharp_edges=True)
        except Exception:
            pass
        objs.append(obj)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f'[{self.name}] {tris} triângulos')
        return obj


def collider(objs, name, c, s):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = s
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    objs.append(o)
    return o


def export(objs, path, colors=None):
    if colors:
        for role, (col, metal, rough) in colors.items():
            if role in MATERIALS:
                bsdf = MATERIALS[role].node_tree.nodes['Principled BSDF']
                bsdf.inputs['Base Color'].default_value = (*col, 1)
                bsdf.inputs['Metallic'].default_value = metal
                bsdf.inputs['Roughness'].default_value = rough
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=False,
                              export_normals=True, export_materials='EXPORT', export_animations=False, export_morph=False, export_skins=False)
