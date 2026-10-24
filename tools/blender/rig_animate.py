"""Etapa 2: esqueleto humanoide, pesos, encaixes, animações e export GLB.

blender -b --python tools/blender/rig_animate.py -- <entrada.blend> <saida.glb> [saida.blend]

- Ossos com nomes do Mixamo (Hips, Spine, LeftArm...) para reaproveitar animações
  do Mixamo/mocap por retarget no futuro.
- Juntas posicionadas a partir das seções transversais da própria malha.
- Encaixes (socket_*) são ossos sem deformação: viram nós no glTF.
- Animações são keyframes simples, sem captura de movimento, feitas para testar o rig.
  Cada uma vira uma trilha NLA, exportada como uma animação do glTF com o mesmo nome.
"""
import math
import os
import sys
import time

import bpy
from mathutils import Euler, Quaternion, Vector

sys.path.append(os.path.dirname(__file__))
import common  # noqa: E402

args = common.script_args()
src_blend, out_glb = args[0], args[1]
out_blend = args[2] if len(args) > 2 else None
t0 = time.time()
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(src_blend))
body = bpy.data.objects['Corpo']
verts = [v.co.copy() for v in body.data.vertices]
V = Vector


def section(z, xmin, xmax, dz=0.012, ymin=-1.0, ymax=1.0):
    """Centro da caixa da seção transversal (mais estável que a média dos vértices)."""
    pts = [v for v in verts if abs(v.z - z) < dz and xmin <= v.x <= xmax and ymin <= v.y <= ymax]
    if len(pts) < 3:
        raise RuntimeError(f'seção vazia em z={z} x=[{xmin},{xmax}]')
    return V(((min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2, z))


def bbox(pts):
    return (V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


# ------------------------------------------------------------------ juntas (lado esquerdo = +X)
def spine_at(z):
    return V((0, section(z, -0.12, 0.12).y, z))


J = {}
J['hips'] = spine_at(0.93)
J['spine'] = spine_at(1.03)
J['spine1'] = spine_at(1.15)
J['spine2'] = spine_at(1.27)
J['neck'] = V((0, section(1.46, -0.06, 0.06).y, 1.46))
J['head'] = V((0, section(1.535, -0.09, 0.09).y, 1.535))
J['head_top'] = V((0, J['head'].y, 1.75))
J['clav'] = V((0.035, J['spine2'].y, 1.40))
J['shoulder'] = V((0.185, section(1.33, 0.15, 0.30).y, 1.33))
J['elbow'] = section(1.04, 0.18, 0.42)
J['wrist'] = section(0.80, 0.24, 0.42)
hand_pts = [v for v in verts if v.x > 0.275 and 0.64 < v.z < 0.705]
hand_lo, hand_hi = bbox(hand_pts)
# Só a região da mão: os pés também passam de x = 0,24.
tip_z = min(v.z for v in verts if v.x > 0.24 and 0.45 < v.z < 0.8)
print(f'[rig] ponta dos dedos em z={tip_z:.3f}')
hand_x = (hand_lo.x + hand_hi.x) / 2
knuckle_z = 0.715
J['knuckles'] = V((hand_x, (hand_lo.y + hand_hi.y) / 2, knuckle_z))
thumb_pts = [v for v in verts if 0.215 < v.x < 0.278 and 0.69 < v.z < 0.785]
th_lo, th_hi = bbox(thumb_pts)
J['thumb_root'] = V((J['wrist'].x - 0.012, (th_lo.y + th_hi.y) / 2, 0.785))
J['thumb_tip'] = V(((th_lo.x + th_hi.x) / 2, th_lo.y + 0.25 * (th_hi.y - th_lo.y), th_lo.z + 0.004))
J['hip'] = V((0.095, J['hips'].y, 0.90))
J['knee'] = section(0.49, 0.03, 0.25)
ankle = section(0.12, 0.05, 0.26)
J['ankle'] = V((ankle.x, ankle.y, 0.095))
foot_front = min(v.y for v in verts if v.z < 0.05 and v.x > 0)
J['ball'] = V((J['ankle'].x + 0.025, foot_front + 0.085, 0.03))
J['toe'] = V((J['ankle'].x + 0.03, foot_front + 0.005, 0.025))
for k, v in J.items():
    print(f'[rig] junta {k:10s} ({v.x:+.3f}, {v.y:+.3f}, {v.z:.3f})')

# ------------------------------------------------------------------ armadura
arm_data = bpy.data.armatures.new('Esqueleto')
rig = bpy.data.objects.new('Esqueleto', arm_data)
bpy.context.collection.objects.link(rig)
common.select_only(rig)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False, deform=True):
    b = eb.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    b.use_deform = deform
    return b


def mx(v, s):
    """Espelha para o lado direito (s = -1)."""
    return V((v.x * s, v.y, v.z))


bone('Hips', J['hips'], J['spine'])
bone('Spine', J['spine'], J['spine1'], 'Hips', True)
bone('Spine1', J['spine1'], J['spine2'], 'Spine', True)
bone('Spine2', J['spine2'], J['neck'], 'Spine1', True)
bone('Neck', J['neck'], J['head'], 'Spine2', True)
bone('Head', J['head'], J['head_top'], 'Neck', True)

FINGERS = ['Index', 'Middle', 'Ring', 'Pinky']
for side, s in (('Left', 1), ('Right', -1)):
    bone(f'{side}Shoulder', mx(J['clav'], s), mx(J['shoulder'], s), 'Spine2')
    bone(f'{side}Arm', mx(J['shoulder'], s), mx(J['elbow'], s), f'{side}Shoulder', True)
    bone(f'{side}ForeArm', mx(J['elbow'], s), mx(J['wrist'], s), f'{side}Arm', True)
    bone(f'{side}Hand', mx(J['wrist'], s), mx(J['knuckles'], s), f'{side}ForeArm', True)
    # Dedos: indicador na frente (-Y), mindinho atrás.
    span = hand_hi.y - hand_lo.y
    for i, f in enumerate(FINGERS):
        y = hand_lo.y + span * (0.16 + 0.68 * i / 3)
        base = V((hand_x, y, knuckle_z))
        tip = V((hand_x, y, tip_z + 0.006 + (0.012 if f == 'Pinky' else 0)))
        p1 = base.lerp(tip, 0.45)
        p2 = base.lerp(tip, 0.75)
        bone(f'{side}Hand{f}1', mx(base, s), mx(p1, s), f'{side}Hand')
        bone(f'{side}Hand{f}2', mx(p1, s), mx(p2, s), f'{side}Hand{f}1', True)
        bone(f'{side}Hand{f}3', mx(p2, s), mx(tip, s), f'{side}Hand{f}2', True)
    t0p, t3p = J['thumb_root'], J['thumb_tip']
    bone(f'{side}HandThumb1', mx(t0p, s), mx(t0p.lerp(t3p, 0.4), s), f'{side}Hand')
    bone(f'{side}HandThumb2', mx(t0p.lerp(t3p, 0.4), s), mx(t0p.lerp(t3p, 0.72), s), f'{side}HandThumb1', True)
    bone(f'{side}HandThumb3', mx(t0p.lerp(t3p, 0.72), s), mx(t3p, s), f'{side}HandThumb2', True)
    bone(f'{side}UpLeg', mx(J['hip'], s), mx(J['knee'], s), 'Hips')
    bone(f'{side}Leg', mx(J['knee'], s), mx(J['ankle'], s), f'{side}UpLeg', True)
    bone(f'{side}Foot', mx(J['ankle'], s), mx(J['ball'], s), f'{side}Leg', True)
    bone(f'{side}ToeBase', mx(J['ball'], s), mx(J['toe'], s), f'{side}Foot', True)

# ------------------------------------------------------------------ encaixes
palm = J['wrist'].lerp(J['knuckles'], 0.55)
eye_z = 1.645
face_front = min(v.y for v in verts if abs(v.z - eye_z) < 0.01 and abs(v.x) < 0.03)
back_y = max(v.y for v in verts if abs(v.z - 1.25) < 0.015 and abs(v.x) < 0.12)
chest_front = min(v.y for v in verts if abs(v.z - 1.38) < 0.015 and abs(v.x) < 0.05)
SOCKETS = [
    # nome, cabeça, cauda (direção = "frente" do encaixe), pai
    ('socket_weapon_R', mx(palm, -1) + V((0.012, 0, 0)), mx(palm, -1) + V((0.012, -0.1, 0)), 'RightHand'),
    ('socket_weapon_L', palm + V((-0.012, 0, 0)), palm + V((-0.012, -0.1, 0)), 'LeftHand'),
    ('socket_head_top', V((0, J['head'].y, 1.75)), V((0, J['head'].y - 0.1, 1.75)), 'Head'),
    ('socket_eyes', V((0, face_front, eye_z)), V((0, face_front - 0.1, eye_z)), 'Head'),
    ('socket_back', V((0, back_y, 1.25)), V((0, back_y + 0.1, 1.25)), 'Spine2'),
    ('socket_neck', V((0, chest_front + 0.01, 1.4)), V((0, chest_front - 0.09, 1.4)), 'Spine2'),
    ('socket_wrist_L', J['wrist'] + V((0, 0, 0.03)), J['wrist'] + V((0, -0.1, 0.03)), 'LeftForeArm'),
    ('socket_wrist_R', mx(J['wrist'], -1) + V((0, 0, 0.03)), mx(J['wrist'], -1) + V((0, -0.1, 0.03)), 'RightForeArm'),
    ('socket_hip_R', V((-0.19, J['hips'].y, 0.9)), V((-0.19, J['hips'].y - 0.1, 0.9)), 'Hips'),
]
for name, h, t, parent in SOCKETS:
    bone(name, h, t, parent, deform=False)
bpy.ops.object.mode_set(mode='OBJECT')
deform_bones = [b.name for b in arm_data.bones if b.use_deform]
print(f'[rig] {len(arm_data.bones)} ossos ({len(deform_bones)} deformam, {len(SOCKETS)} encaixes)')

# ------------------------------------------------------------------ pesos
common.select_only(body)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
common.select_only(body)


def edit_all(fn):
    """Operadores de grupo de vértices só rodam em modo de edição, sobre os vértices selecionados."""
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    fn()
    bpy.ops.object.mode_set(mode='OBJECT')


edit_all(lambda: bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=2))

ARM_PARTS = ('Shoulder', 'Arm', 'ForeArm', 'Hand')
LEG_TORSO = {'Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'}
groups = {g.index: g.name for g in body.vertex_groups}
by_name = {g.name: g for g in body.vertex_groups}


def is_arm(name):
    return any(name.startswith(side) and name[len(side):].startswith(ARM_PARTS) for side in ('Left', 'Right')) and 'UpLeg' not in name


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


cleaned = 0
filled = 0
for v in body.data.vertices:
    co = v.co
    names = [groups[g.group] for g in v.groups if g.weight > 0]
    remove = []
    # Mãos/antebraços ficam perto das coxas na pose A: sem influência de perna/quadril.
    if abs(co.x) > 0.235 and co.z < 1.0:
        remove = [n for n in names if n in LEG_TORSO]
    # Coxas e quadril: sem influência de braço/mão.
    elif abs(co.x) < 0.2 and co.z < 0.82:
        remove = [n for n in names if is_arm(n)]
    for n in remove:
        by_name[n].remove([v.index])
        cleaned += 1
    if not any(g.weight > 0 for g in v.groups):
        # Pesos automáticos falharam aqui: usa o osso mais próximo.
        best = min(deform_bones, key=lambda n: seg_dist(co, arm_data.bones[n].head_local, arm_data.bones[n].tail_local))
        by_name[best].add([v.index], 1.0, 'REPLACE')
        filled += 1
# Dedos: com a malha reduzida os pesos automáticos ficam só na 1ª falange.
# Redistribui o peso total de dedo de cada vértice para o dedo mais próximo (pela posição
# em Y) e para as falanges conforme a altura ao longo do dedo, com transição suave.
finger_y = {f: hand_lo.y + (hand_hi.y - hand_lo.y) * (0.16 + 0.68 * i / 3) for i, f in enumerate(FINGERS)}
BREAKS = (0.45, 0.75)
BLEND = 0.09


def segment_weights(t):
    w1 = max(0.0, min(1.0, (BREAKS[0] + BLEND / 2 - t) / BLEND))
    w3 = max(0.0, min(1.0, (t - (BREAKS[1] - BLEND / 2)) / BLEND))
    return (w1, max(0.0, 1.0 - w1 - w3), w3)


redistributed = 0
KNUCKLE_BLEND = 0.02
for v in body.data.vertices:
    if v.co.z > knuckle_z + KNUCKLE_BLEND:
        continue
    for side in ('Left', 'Right'):
        names = {f'{side}Hand{f}{i}' for f in FINGERS for i in (1, 2, 3)} | {f'{side}Hand'}
        weights = {groups[g.group]: g.weight for g in v.groups}
        thumb = sum(w for n, w in weights.items() if n.startswith(f'{side}HandThumb'))
        total = sum(w for n, w in weights.items() if n in names)
        if total <= 0 or thumb > 0.3:
            continue
        for n in names:
            if n in weights:
                by_name[n].remove([v.index])
        # Perto dos nós dos dedos ainda é palma; abaixo, só dedos.
        hand_share = max(0.0, min(1.0, (v.co.z - (knuckle_z - KNUCKLE_BLEND)) / (2 * KNUCKLE_BLEND)))
        if hand_share > 0.001:
            by_name[f'{side}Hand'].add([v.index], total * hand_share, 'REPLACE')
        f = min(FINGERS, key=lambda f: abs(v.co.y - finger_y[f]))
        t = max(0.0, min(1.0, (knuckle_z - v.co.z) / (knuckle_z - tip_z)))
        for i, w in enumerate(segment_weights(t), start=1):
            if w > 0.001:
                by_name[f'{side}Hand{f}{i}'].add([v.index], total * (1 - hand_share) * w, 'REPLACE')
        redistributed += 1
print(f'[rig] dedos: {redistributed} vértices redistribuídos entre as falanges')
edit_all(lambda: bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4))
edit_all(lambda: bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False))
used = {}
for v in body.data.vertices:
    for g in v.groups:
        if g.weight > 0.01:
            used[groups[g.group]] = used.get(groups[g.group], 0) + 1
empty_groups = [n for n in deform_bones if used.get(n, 0) == 0]
print(f'[rig] pesos: {cleaned} influências removidas, {filled} vértices preenchidos pelo osso mais próximo')
print(f'[rig] vértices por osso: ' + ', '.join(f'{n}={used.get(n, 0)}' for n in deform_bones))
print(f'[rig] ossos sem nenhum vértice: {empty_groups or "nenhum"}')

# ------------------------------------------------------------------ animações
scene = bpy.context.scene
scene.render.fps = 30
common.select_only(rig)
bpy.ops.object.mode_set(mode='POSE')
REST_Q = {b.name: b.matrix_local.to_quaternion() for b in arm_data.bones}
POSE_BONES = [pb for pb in rig.pose.bones if not pb.name.startswith('socket_')]
for pb in POSE_BONES:
    pb.rotation_mode = 'QUATERNION'


def bone_name(key):
    """'L:Arm' -> LeftArm (valores no lado esquerdo), 'R:Arm' -> RightArm (espelhado)."""
    if key.startswith('L:'):
        return 'Left' + key[2:], 1
    if key.startswith('R:'):
        return 'Right' + key[2:], -1
    return key, 1


def local_quat(name, x, y, z, s):
    """Rotação em graus nos eixos do esqueleto em repouso (X = esquerda, Y = trás, Z = cima)
    convertida para o espaço local do osso. No lado direito, Y e Z são espelhados."""
    r = Euler((math.radians(x), math.radians(y * s), math.radians(z * s)), 'XYZ').to_quaternion()
    b = REST_Q[name]
    return b.inverted() @ r @ b


def both(part, x=0.0, y=0.0, z=0.0):
    return {f'L:{part}': (x, y, z), f'R:{part}': (x, y, z)}


def curl(amount, thumb=None, index=None):
    """Dedos fechando em direção à palma (+Y no lado esquerdo)."""
    p = {}
    for side in ('L', 'R'):
        for f in FINGERS:
            a = index if (f == 'Index' and index is not None) else amount
            for seg, k in ((1, 0.8), (2, 1.0), (3, 0.7)):
                p[f'{side}:Hand{f}{seg}'] = (0, a * k, 0)
        t = amount * 0.5 if thumb is None else thumb
        p[f'{side}:HandThumb1'] = (-t * 0.3, t * 0.4, 0)
        p[f'{side}:HandThumb2'] = (0, t * 0.6, 0)
        p[f'{side}:HandThumb3'] = (0, t * 0.5, 0)
    return p


def merge(*poses):
    out = {}
    for p in poses:
        out.update(p)
    return out


def mirror(p):
    """Troca os lados de uma pose (para a segunda metade dos ciclos)."""
    out = {}
    for k, v in p.items():
        if k.startswith('L:'):
            out['R:' + k[2:]] = v
        elif k.startswith('R:'):
            out['L:' + k[2:]] = v
        elif k == '_hips':
            out[k] = (-v[0], v[1], v[2])
        else:
            out[k] = (v[0], -v[1], -v[2])
    return out


prev_q = {}


def key_pose(frame, pose):
    hips = pose.get('_hips', (0.0, 0.0, 0.0))
    rot = {}
    for k, v in pose.items():
        if k == '_hips':
            continue
        name, s = bone_name(k)
        rot[name] = local_quat(name, *v, s)
    for pb in POSE_BONES:
        q = rot.get(pb.name, Quaternion())
        # Mantém o hemisfério do quatérnio para a interpolação não dar volta.
        if pb.name in prev_q and prev_q[pb.name].dot(q) < 0:
            q = -q
        prev_q[pb.name] = q
        pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    hb = rig.pose.bones['Hips']
    hb.location = REST_Q['Hips'].inverted() @ V(hips)
    hb.keyframe_insert('location', frame=frame)
    for pb in POSE_BONES:
        if pb.name != 'Hips':
            pb.location = (0, 0, 0)


ANIMS = []


def animation(name, keys, loop=True):
    """keys: lista de (quadro, pose). Para ciclos, o último quadro repete o primeiro."""
    prev_q.clear()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for frame, pose in keys:
        key_pose(frame, pose)
    act.use_cyclic = loop
    rig.animation_data.action = None
    ANIMS.append((name, act, loop, keys[-1][0]))


# Pose base relaxada (o repouso é uma pose A com braços ~10° abertos).
RELAX = merge(both('Arm', 0, 5, 0), both('ForeArm', -12, 0, 0), curl(14))

# ----- idle (respiração + leve olhar)
idle_a = RELAX
idle_b = merge(RELAX, {'Spine1': (1.8, 0, 0), 'Spine2': (1.2, 0, 0), 'Head': (-1.5, 0, 2)}, both('Arm', 0, 3, 0))
idle_c = merge(RELAX, {'Spine1': (0.6, 0, 0), 'Head': (0, 0, -3)})
animation('idle', [(0, idle_a), (30, idle_b), (60, idle_c), (90, idle_a)])


def gait(period, lean, thigh_f, thigh_b, knee_contact, knee_swing, knee_trail, arm_f, arm_b, elbow, bob, foot_push, hip_yaw):
    """Ciclo de locomoção em 4 poses-chave (contato e passagem de cada perna)."""
    contact = merge(
        RELAX,
        {
            'Spine': (lean * 0.4, 0, -hip_yaw * 0.5),
            'Spine1': (lean * 0.3, 0, -hip_yaw * 0.5),
            'Spine2': (lean * 0.3, 0, -hip_yaw),
            'Head': (-lean * 0.5, 0, hip_yaw),
            'Hips': (0, 0, hip_yaw),
            'L:UpLeg': (-thigh_f, 0, 0),
            'L:Leg': (knee_contact, 0, 0),
            'L:Foot': (0, 0, 0),
            'R:UpLeg': (thigh_b, 0, 0),
            'R:Leg': (knee_trail, 0, 0),
            'R:Foot': (foot_push, 0, 0),
            'L:Arm': (arm_b, 6, 0),
            'L:ForeArm': (-elbow * 0.8, 0, 0),
            'R:Arm': (-arm_f, 6, 0),
            'R:ForeArm': (-elbow, 0, 0),
            '_hips': (0, 0, -bob),
        },
    )
    passing = merge(
        RELAX,
        {
            'Spine': (lean * 0.4, 0, 0),
            'Spine1': (lean * 0.3, 0, 0),
            'Spine2': (lean * 0.3, 0, 0),
            'Head': (-lean * 0.5, 0, 0),
            'L:UpLeg': (thigh_b * 0.2, 0, 0),
            'L:Leg': (knee_contact * 1.2, 0, 0),
            'L:Foot': (foot_push * 0.3, 0, 0),
            'R:UpLeg': (-thigh_f * 0.75, 0, 0),
            'R:Leg': (knee_swing, 0, 0),
            'R:Foot': (-12, 0, 0),
            'L:Arm': (arm_b * 0.1, 6, 0),
            'L:ForeArm': (-elbow * 0.9, 0, 0),
            'R:Arm': (-arm_f * 0.1, 6, 0),
            'R:ForeArm': (-elbow * 0.9, 0, 0),
            '_hips': (0, 0, bob),
        },
    )
    q = period // 4
    return [(0, contact), (q, passing), (2 * q, mirror(contact)), (3 * q, mirror(passing)), (4 * q, contact)]


animation('walk', gait(32, lean=3, thigh_f=26, thigh_b=18, knee_contact=4, knee_swing=55, knee_trail=14, arm_f=16, arm_b=16, elbow=18, bob=0.018, foot_push=18, hip_yaw=5))
animation('run', gait(20, lean=11, thigh_f=40, thigh_b=26, knee_contact=16, knee_swing=100, knee_trail=70, arm_f=38, arm_b=34, elbow=78, bob=0.035, foot_push=28, hip_yaw=8))
animation('sprint', gait(16, lean=20, thigh_f=52, thigh_b=34, knee_contact=22, knee_swing=120, knee_trail=85, arm_f=55, arm_b=48, elbow=92, bob=0.045, foot_push=35, hip_yaw=10))

# ----- pulo (sem loop): preparação, impulso, ar, queda, aterrissagem
squat = merge(RELAX, {'Spine': (14, 0, 0), 'Spine1': (8, 0, 0), 'Head': (-12, 0, 0), '_hips': (0, 0.06, -0.14)}, both('UpLeg', -48, 0, 0), both('Leg', 82, 0, 0), both('Foot', -34, 0, 0), both('Arm', 38, 4, 0), both('ForeArm', -20, 0, 0))
takeoff = merge(RELAX, {'Spine': (-4, 0, 0), '_hips': (0, 0, 0.05)}, both('UpLeg', 4, 0, 0), both('Leg', 4, 0, 0), both('Foot', 32, 0, 0), both('Arm', -125, -10, 0), both('ForeArm', -25, 0, 0))
apex = merge(RELAX, {'Spine': (6, 0, 0), '_hips': (0, 0, 0.1)}, both('UpLeg', -50, -4, 0), both('Leg', 72, 0, 0), both('Foot', 10, 0, 0), both('Arm', -70, -25, 0), both('ForeArm', -35, 0, 0))
fall = merge(RELAX, {'Spine': (2, 0, 0), '_hips': (0, 0, 0.04)}, both('UpLeg', -24, -3, 0), both('Leg', 22, 0, 0), both('Foot', -8, 0, 0), both('Arm', -35, -40, 0), both('ForeArm', -20, 0, 0))
land = merge(RELAX, {'Spine': (16, 0, 0), 'Spine1': (6, 0, 0), 'Head': (-10, 0, 0), '_hips': (0, 0.05, -0.12)}, both('UpLeg', -42, 0, 0), both('Leg', 72, 0, 0), both('Foot', -30, 0, 0), both('Arm', -20, -18, 0), both('ForeArm', -30, 0, 0))
animation('jump', [(0, RELAX), (7, squat), (11, takeoff), (19, apex), (27, fall), (31, land), (40, RELAX)], loop=False)

# ----- agachado (parado)
crouch = merge(
    RELAX,
    {'Spine': (14, 0, 0), 'Spine1': (8, 0, 0), 'Spine2': (4, 0, 0), 'Head': (-16, 0, 0), '_hips': (0, 0.17, -0.32)},
    both('UpLeg', -70, -6, 0),
    both('Leg', 100, 0, 0),
    both('Foot', -30, 0, 0),
    both('Arm', -18, 6, 0),
    both('ForeArm', -45, 0, 0),
)
crouch_b = merge(crouch, {'Spine1': (10, 0, 0), '_hips': (0, 0.17, -0.325)})
animation('crouch', [(0, crouch), (30, crouch_b), (60, crouch)])

# ----- escalada (ciclo alternando mãos e pés)
climb = merge(
    RELAX,
    {'Spine': (6, 0, 0), 'Head': (-14, 0, 0), '_hips': (0, -0.02, 0.0)},
    {'L:Arm': (-165, 8, 0), 'L:ForeArm': (-18, 0, 0), 'R:Arm': (-105, 12, 0), 'R:ForeArm': (-70, 0, 0)},
    {'L:UpLeg': (-22, 0, 0), 'L:Leg': (40, 0, 0), 'L:Foot': (-10, 0, 0), 'R:UpLeg': (-62, 0, 0), 'R:Leg': (95, 0, 0), 'R:Foot': (-25, 0, 0)},
    curl(55, thumb=30),
)
climb_mid = merge(climb, {'_hips': (0, -0.02, 0.045)})
animation('climb', [(0, climb), (12, climb_mid), (24, mirror(climb)), (36, mirror(climb_mid)), (48, climb)])

# ----- mira com fuzil (mão direita no gatilho, esquerda no guarda-mão)
AIM = merge(
    {'Spine1': (2, 0, 0), 'Spine2': (3, 0, -8), 'Neck': (0, 0, 4), 'Head': (6, 0, 4)},
    {'R:Arm': (-48, 22, 0), 'R:ForeArm': (-62, 0, 12), 'R:Hand': (8, 0, 0)},
    {'L:Arm': (-78, 32, 0), 'L:ForeArm': (-22, 0, 0), 'L:Hand': (0, 0, 10)},
    {'L:UpLeg': (-8, -4, 0), 'L:Leg': (10, 0, 0), 'R:UpLeg': (7, -4, 0), 'R:Leg': (8, 0, 0)},
    curl(52, thumb=35),
    {f'R:HandIndex{i}': (0, a, 0) for i, a in ((1, 14), (2, 22), (3, 12))},
)
aim_b = merge(AIM, {'Spine1': (2.8, 0, 0), 'Spine2': (3.6, 0, -8)})
animation('aim', [(0, AIM), (40, aim_b), (80, AIM)])

# ----- tiro (coice a partir da mira)
recoil = merge(AIM, {'Spine2': (-3, 0, -7), 'Head': (3, 0, 4), 'R:Arm': (-44, 22, 0), 'R:ForeArm': (-66, 0, 12), 'L:Arm': (-74, 32, 0)})
animation('shoot', [(0, AIM), (2, recoil), (9, AIM)], loop=False)

# ----- recarga (abaixa a arma, troca o pente, volta à mira)
low_gun = merge(AIM, {'Spine2': (8, 0, -4), 'Head': (18, 0, 0), 'R:Arm': (-28, 22, 0), 'R:ForeArm': (-66, 0, 18)})
pull_mag = merge(low_gun, {'L:Arm': (-30, 18, 0), 'L:ForeArm': (-62, 0, 0), 'L:Hand': (20, 0, 0)})
drop_hand = merge(low_gun, {'L:Arm': (8, 8, 0), 'L:ForeArm': (-38, 0, 0), 'L:Hand': (0, 0, 0)})
insert_mag = merge(low_gun, {'L:Arm': (-40, 22, 0), 'L:ForeArm': (-70, 0, 0), 'L:Hand': (25, 0, 0)})
slap = merge(insert_mag, {'L:Arm': (-36, 22, 0), 'L:ForeArm': (-78, 0, 0)})
animation('reload', [(0, AIM), (8, low_gun), (14, pull_mag), (22, drop_hand), (32, insert_mag), (37, slap), (42, low_gun), (52, AIM)], loop=False)

# ----- morte (cai de costas)
hit = merge(RELAX, {'Spine2': (-16, 0, 6), 'Head': (-22, 0, 8), '_hips': (0, 0.02, 0)}, both('Arm', 6, -32, 0), both('ForeArm', -30, 0, 0))
buckle = merge(RELAX, {'Spine': (18, 0, 6), 'Spine2': (6, 0, 0), 'Head': (14, 0, 6), '_hips': (0, 0.08, -0.28)}, both('UpLeg', -42, -4, 0), both('Leg', 74, 0, 0), both('Foot', -20, 0, 0), both('Arm', -10, -28, 0), both('ForeArm', -40, 0, 0))
falling = merge(RELAX, {'Hips': (-52, 0, 4), 'Spine2': (-8, 0, 0), 'Head': (-12, 0, 0), '_hips': (0, 0.25, -0.55)}, both('UpLeg', -30, -6, 0), both('Leg', 40, 0, 0), both('Arm', -40, -55, 0), both('ForeArm', -25, 0, 0))
ground = merge(
    RELAX,
    {'Hips': (-86, 0, 6), 'Spine': (-4, 0, 0), 'Spine2': (-2, 0, 0), 'Head': (-8, 0, 18), '_hips': (0, 0.45, -0.8)},
    {'L:UpLeg': (-12, -8, 0), 'L:Leg': (16, 0, 0), 'R:UpLeg': (-4, -4, 0), 'R:Leg': (6, 0, 0)},
    # Com o corpo deitado de costas, braço "para trás" (X+) encosta no chão.
    {'L:Arm': (12, -72, 0), 'L:ForeArm': (-10, 0, 0), 'R:Arm': (8, -58, 0), 'R:ForeArm': (-25, 0, 0)},
    curl(25),
)
animation('death', [(0, RELAX), (5, hit), (16, buckle), (28, falling), (38, ground), (46, ground)], loop=False)

bpy.ops.object.mode_set(mode='OBJECT')
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = (0, 0, 0)

# Uma trilha NLA por animação: o exportador gera uma animação glTF por trilha.
ad = rig.animation_data
for name, act, loop, end in ANIMS:
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    if hasattr(strip, 'action_slot') and getattr(act, 'slots', None):
        strip.action_slot = act.slots[0]
    strip.extrapolation = 'NOTHING'
    track.mute = True
print(f'[rig] {len(ANIMS)} animações: ' + ', '.join(f'{n} ({e / 30:.2f}s{" loop" if lp else ""})' for n, _, lp, e in ANIMS))

# ------------------------------------------------------------------ export
for t in ad.nla_tracks:
    t.mute = False
os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(out_glb),
    export_format='GLB',
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials='EXPORT',
    export_image_format='JPEG',
    export_jpeg_quality=92,
    export_skins=True,
    export_all_influences=False,
    export_def_bones=False,
    export_rest_position_armature=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_force_sampling=True,
    export_frame_step=1,
    export_optimize_animation_size=True,
    export_reset_pose_bones=True,
    export_morph=False,
    export_extras=False,
)
print(f'[rig] exportado {out_glb} ({os.path.getsize(out_glb) / 1e6:.2f} MB)')
if out_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_blend))
    print(f'[rig] salvo {out_blend}')
print(f'[rig] concluído em {time.time() - t0:.1f}s')
