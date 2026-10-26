import { AbstractMesh, Scene, Vector3 } from '@babylonjs/core';

/**
 * Seleção de malhas por octree. O cenário estático (lotes do StaticBatcher, relevo, placas:
 * tudo com a matriz congelada) passa a ser escolhido por blocos do espaço, em vez de o
 * Babylon testar uma por uma as ~3 mil malhas do mapa a cada quadro (13 ms por quadro só
 * nisso). O resto (personagens, armas, loot, efeitos, tudo que nasce depois) fica na lista
 * dinâmica, testada normalmente.
 */
export function enableSelectionOctree(scene: Scene): void {
  const statics: AbstractMesh[] = [];
  const dynamic: AbstractMesh[] = [];
  for (const m of scene.meshes) (m.isWorldMatrixFrozen && !m.skeleton ? statics : dynamic).push(m);
  if (statics.length < 100) return;
  const octree = scene.createOrUpdateSelectionOctree(32, 4);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of statics) {
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimumWorld);
    max.maximizeInPlace(b.maximumWorld);
  }
  octree.update(min, max, statics);
  // Lista dinâmica com índice para remover rápido (milhares de itens de loot nascem e somem).
  // Malhas desligadas (moldes, paraquedas guardados, armas fora da mão) saem da lista e
  // voltam quando são ligadas de novo.
  const list: AbstractMesh[] = [];
  const index = new Map<AbstractMesh, number>();
  const add = (m: AbstractMesh) => {
    if (index.has(m)) return;
    index.set(m, list.length);
    list.push(m);
  };
  const remove = (m: AbstractMesh) => {
    const i = index.get(m);
    if (i === undefined) return;
    const last = list.pop()!;
    if (last !== m) {
      list[i] = last;
      index.set(last, i);
    }
    index.delete(m);
  };
  const track = (m: AbstractMesh) => {
    m.onEnabledStateChangedObservable.add((on) => (on ? add(m) : remove(m)));
    if (m.isEnabled(false)) add(m);
  };
  dynamic.forEach(track);
  octree.dynamicContent = list;
  const staticSet = new Set(statics);
  scene.onNewMeshAddedObservable.add((m) => {
    if (!staticSet.has(m)) track(m);
  });
  scene.onMeshRemovedObservable.add((m) => {
    if (staticSet.delete(m)) {
      // Estático removido: some dos blocos também.
      const drop = (blocks: Array<{ entries: AbstractMesh[]; blocks?: unknown[] }> | undefined) => {
        for (const block of blocks ?? []) {
          const i = block.entries.indexOf(m);
          if (i >= 0) block.entries.splice(i, 1);
          drop(block.blocks as typeof blocks);
        }
      };
      drop(octree.blocks as unknown as Array<{ entries: AbstractMesh[]; blocks?: unknown[] }>);
      return;
    }
    remove(m);
  });
}
