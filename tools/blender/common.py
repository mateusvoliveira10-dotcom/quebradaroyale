"""Funções compartilhadas pelos scripts de Blender do personagem-base.

Uso geral (modo sem interface):
  blender -b --python tools/blender/<script>.py -- <argumentos>
"""
import sys

import bpy
from mathutils import Vector

# Altura final do personagem em metros.
TARGET_HEIGHT = 1.75


def script_args():
    """Argumentos depois de '--' na linha de comando do Blender."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    """Importa um GLB e devolve a malha principal (a de mais vértices)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    return max(meshes, key=lambda o: len(o.data.vertices)), new


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def normalize_height(obj, height=TARGET_HEIGHT):
    """Aplica transformações, escala para a altura alvo e põe os pés em z=0, centrado em x/y."""
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    # Solta de pais vazios do importador mantendo a transformação.
    if obj.parent:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo, hi = world_bounds(obj)
    k = height / (hi.z - lo.z)
    obj.scale = (k, k, k)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lo, hi = world_bounds(obj)
    center = (lo + hi) / 2
    obj.location = (-center.x, -center.y, -lo.z)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return k


def select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
