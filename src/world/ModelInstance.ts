import { Material, Mesh, TransformNode } from '@babylonjs/core';
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
