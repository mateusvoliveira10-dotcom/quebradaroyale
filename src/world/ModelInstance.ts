import { AbstractMesh, Material, Mesh, TransformNode } from '@babylonjs/core';
import type { WorldModel } from './WorldAssets';

/**
 * Cópia "viva" de um modelo do Blender (fora do lote estático): uma malha por papel de
 * material, presa a `parent` (que dá posição, giro e escala). `mat` devolve o material de
 * cada papel; null = a peça não aparece. A geometria é compartilhada com a malha-base.
 */
export function instantiateModel(model: WorldModel, mat: (role: string) => Material | null, parent: TransformNode, name: string): Mesh[] {
  const out: Mesh[] = [];
  for (const [role, part] of model.parts) {
    const material = mat(role);
    if (!material) continue;
    const m = part.clone(`${name}_${role}`, null, true, false) as Mesh;
    m.setEnabled(true);
    m.parent = parent;
    m.material = material;
    m.isPickable = false;
    m.receiveShadows = true;
    out.push(m);
  }
  return out;
}

const sources = new Map<string, Mesh>();

/**
 * Como instantiateModel, mas com instâncias (InstancedMesh) de uma malha-fonte por peça e
 * material: criar custa quase nada e todas as cópias de uma peça são desenhadas numa
 * chamada só. Para objetos repetidos aos montes (baús, itens do loot). A fonte fica
 * invisível; só as instâncias aparecem.
 */
export function instanceModel(model: WorldModel, mat: (role: string) => Material | null, parent: TransformNode, name: string): AbstractMesh[] {
  const out: AbstractMesh[] = [];
  for (const [role, part] of model.parts) {
    const material = mat(role);
    if (!material) continue;
    const key = `${part.uniqueId}|${material.uniqueId}`;
    let src = sources.get(key);
    if (!src || src.isDisposed()) {
      src = part.clone(`${name}_${role}_fonte`, null, true, false) as Mesh;
      src.parent = null;
      src.material = material;
      src.setEnabled(true);
      src.isVisible = false;
      src.isPickable = false;
      src.receiveShadows = true;
      src.alwaysSelectAsActiveMesh = false;
      sources.set(key, src);
    }
    const inst = src.createInstance(`${name}_${role}`);
    inst.parent = parent;
    inst.isPickable = false;
    out.push(inst);
  }
  return out;
}

/** Instância de uma malha simples (disco, caixa…) com o material dado, fonte compartilhada. */
export function instanceOf(key: string, make: () => Mesh, material: Material, parent: TransformNode | null): AbstractMesh {
  const k = `${key}|${material.uniqueId}`;
  let src = sources.get(k);
  if (!src || src.isDisposed()) {
    src = make();
    src.material = material;
    src.isVisible = false;
    src.isPickable = false;
    sources.set(k, src);
  }
  const inst = src.createInstance(key);
  inst.parent = parent;
  inst.isPickable = false;
  return inst;
}
