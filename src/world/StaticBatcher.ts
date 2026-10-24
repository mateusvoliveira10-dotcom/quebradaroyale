import { Material, Mesh, ShadowGenerator } from '@babylonjs/core';
import { MaterialMeta } from './Materials';

/** Tamanho (m) do bloco de agrupamento: cada bloco é desenhado só se estiver na tela. */
const CHUNK = 48;
/** Distância (m) da câmera ao centro do lote em que as árvores trocam para a versão leve. */
const LOD_DISTANCE = 72;

/**
 * Detalhes pequenos e cheios de triângulos que somem de longe (por bloco de 48 m): do alto
 * do morro da estátua a câmera via a cidade inteira e desenhava ~5,6 milhões de triângulos,
 * 1,9 milhão só de esquadrias de alumínio. A essa distância eles já não aparecem (e a
 * névoa cobre); de perto nada muda. Ordem: o primeiro padrão que casar com o material vale.
 */
const DETAIL_CULL: ReadonlyArray<[RegExp, number]> = [
  [/^hq_aluminio/, 75],
  [/^hq_(metal|borracha|plastico)/, 80],
  [/^(rebar|pvc|trashBag|bagBlue|bagWhite|cardboard|bottle|sack|plasticBlue|plasticRed|plasticYellow|gasRed|rust)$/, 75],
  [/^rubberBurnt$/, 95],
  [/^hq_(madeira|portao)/, 95],
  [/^(metal|metalDark|rubber|cloth_\d+|product_\d+)$/, 95],
  [/^hq_caixa/, 120],
  [/_body$|^veiculo_/, 130],
];

export interface BatchOptions {
  /** Nível de detalhe: 0 = perto, 1 = longe (troca em LOD_DISTANCE). */
  lod?: 0 | 1;
  /** Posição usada para escolher o bloco (padrão: centro da malha). */
  x?: number;
  z?: number;
}

/**
 * Junta toda a geometria estática que compartilha material em poucas malhas,
 * reduzindo centenas de draw calls para poucas dezenas. O agrupamento é por
 * material E por bloco de 48 m: num mapa de 300 m, uma malha única por material
 * seria desenhada inteira mesmo com quase tudo fora da tela.
 *
 * Peças com nível de detalhe (árvores) vão para lotes próprios: o lote de perto de
 * cada material/bloco ganha o lote de longe como LOD do Babylon, então só um dos
 * dois é desenhado por vez.
 *
 * Obs.: o contorno cartoon (renderOutline) fica só no personagem; em malhas
 * estáticas gigantes ele escurece lajes/chão e corta o FPS pela metade.
 */
export class StaticBatcher {
  private readonly groups = new Map<string, { mat: Material; list: Mesh[] }>();
  readonly merged: Mesh[] = [];

  add(mesh: Mesh, o: BatchOptions = {}): void {
    const mat = mesh.material;
    if (!mat) throw new Error(`Malha ${mesh.name} sem material não pode ser agrupada`);
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    // Peças grandes (chão, muros, morros do fundo) ficam num grupo próprio por material.
    const big = bb.extendSizeWorld.x > CHUNK * 0.75 || bb.extendSizeWorld.z > CHUNK * 0.75;
    const cx = o.x ?? bb.centerWorld.x;
    const cz = o.z ?? bb.centerWorld.z;
    const place = big ? 'big' : `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    const key = `${o.lod === undefined ? '' : `lod${o.lod}|`}${mat.uniqueId}:${place}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, list: [] };
      this.groups.set(key, g);
    }
    g.list.push(mesh);
  }

  build(shadows: ShadowGenerator | null): void {
    const byKey = new Map<string, Mesh>();
    for (const [key, { mat, list }] of this.groups) {
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `static_${mat.name}`;
      merged.material = mat;
      merged.isPickable = false;
      merged.receiveShadows = true;

      const meta = mat.metadata as MaterialMeta | undefined;
      if (meta?.castShadow !== false && !key.startsWith('lod1|')) shadows?.addShadowCaster(merged, false);

      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      this.merged.push(merged);
      byKey.set(key, merged);
    }
    // Liga perto → longe. Sem par de longe (material que a versão leve não usa), o lote
    // de perto simplesmente some além da distância.
    for (const [key, near] of byKey) {
      if (key.startsWith('lod0|')) {
        near.addLODLevel(LOD_DISTANCE, byKey.get(`lod1|${key.slice(5)}`) ?? null);
        continue;
      }
      // Detalhe pequeno: some além da distância (peças grandes, "big", ficam sempre).
      if (key.startsWith('lod1|') || key.endsWith(':big')) continue;
      const name = near.material?.name ?? '';
      const cull = DETAIL_CULL.find(([re]) => re.test(name));
      if (cull) near.addLODLevel(cull[1], null);
    }
    this.groups.clear();
  }
}
