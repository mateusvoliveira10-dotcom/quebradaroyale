import { Color3, Material, Mesh, ShadowGenerator, StandardMaterial, VertexBuffer } from '@babylonjs/core';
import type { MaterialMeta } from './Materials';

/**
 * Junta variações de cor de um mesmo material (mesma textura, cores diferentes) num
 * material-base branco: no lote estático cada peça leva a própria cor nos vértices.
 * Doze tintas de reboco eram doze lotes por bloco; agora são um.
 */
export function shareTint(mats: StandardMaterial[], name: string): void {
  if (!mats.length) return;
  const base = mats[0].clone(name);
  base.diffuseColor = Color3.White();
  base.metadata = { ...(mats[0].metadata as MaterialMeta) };
  for (const m of mats) {
    const meta = (m.metadata ?? { castShadow: true }) as MaterialMeta;
    meta.tintBase = base;
    meta.tint = m.diffuseColor.clone();
    m.metadata = meta;
  }
  // O brilho próprio fraco (5% da cor) vira um piso de luz neutro equivalente.
  base.emissiveColor = new Color3(0.035, 0.035, 0.035);
}

/** Pinta os vértices de uma malha com uma cor (para o material-base de shareTint). */
function paintVertices(mesh: Mesh, c: Color3): void {
  const n = mesh.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
}

/**
 * Tamanho (m) do bloco de agrupamento: cada bloco é desenhado só se estiver na tela. Era 48:
 * com ~100 materiais o mapa tinha ~3.800 lotes e só escolher o que desenhar levava 7 ms
 * por quadro; com 64 são quase metade, e o custo de triângulos a mais é pequeno.
 */
const CHUNK = 64;
/** Distância (m) da câmera ao centro do lote em que as árvores trocam para a versão leve. */
const LOD_DISTANCE = 72;

/**
 * Detalhes pequenos e cheios de triângulos que somem de longe (por bloco de 48 m): do alto
 * do morro da estátua a câmera via a cidade inteira e desenhava ~5,6 milhões de triângulos,
 * 1,9 milhão só de esquadrias de alumínio. A essa distância eles já não aparecem (e a
 * névoa cobre); de perto nada muda. Ordem: o primeiro padrão que casar com o material vale.
 */
const DETAIL_CULL: ReadonlyArray<[RegExp, number]> = [
  // Distâncias até o centro do bloco (64 m): +11 m em relação aos blocos antigos de 48 m.
  [/^hq_aluminio/, 86],
  [/^hq_(metal|borracha|plastico)/, 91],
  [/^(rebar|pvc|trashBag|bagBlue|bagWhite|cardboard|bottle|sack|plasticBlue|plasticRed|plasticYellow|gasRed|rust)$/, 86],
  [/^rubberBurnt$/, 106],
  [/^hq_(madeira|portao)/, 106],
  [/^(metal|metalDark|rubber|cloth_\d+|product_\d+)$/, 106],
  [/^hq_caixa/, 131],
  [/_body$|^veiculo_/, 141],
];

export interface BatchOptions {
  /** Nível de detalhe: 0 = perto, 1 = longe (troca em LOD_DISTANCE). */
  lod?: 0 | 1;
  /** Posição usada para escolher o bloco (padrão: centro da malha). */
  x?: number;
  z?: number;
  /** Tamanho do bloco (m) no lugar do padrão: cenário de fundo usa blocos bem maiores. */
  cell?: number;
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
    let mat = mesh.material;
    if (!mat) throw new Error(`Malha ${mesh.name} sem material não pode ser agrupada`);
    const tinted = mat.metadata as MaterialMeta | undefined;
    if (tinted?.tintBase && tinted.tint) {
      if (mesh.geometry && mesh.geometry.meshes.length > 1) mesh.makeGeometryUnique();
      paintVertices(mesh, tinted.tint);
      mat = tinted.tintBase;
      mesh.material = mat;
    }
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    // Peças grandes (chão, muros, morros do fundo) ficam num grupo próprio por material.
    const big = bb.extendSizeWorld.x > CHUNK * 0.75 || bb.extendSizeWorld.z > CHUNK * 0.75;
    const cx = o.x ?? bb.centerWorld.x;
    const cz = o.z ?? bb.centerWorld.z;
    const size = o.cell ?? CHUNK;
    const place = big ? 'big' : `${o.cell ? `c${size}:` : ''}${Math.floor(cx / size)},${Math.floor(cz / size)}`;
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
      // O MergeMeshes extrai a primeira malha sem copiar e emenda as outras no array de
      // índices dela: se ela divide a geometria com a malha-base do modelo (cópia de
      // b.model), a base crescia a cada lote (índices repetidos centenas de vezes, triângulos
      // esticados ligando árvores e muita memória). Geometria própria antes de juntar.
      if (list[0].geometry && list[0].geometry.meshes.length > 1) list[0].makeGeometryUnique();
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `static_${mat.name}`;
      merged.material = mat;
      merged.isPickable = false;
      merged.receiveShadows = true;

      const meta = mat.metadata as MaterialMeta | undefined;
      // Detalhes miúdos (lixo, garrafas, fios, esquadrias...) não projetam sombra: o mapa de
      // sombra desenhava ~3.000 lotes e custava 14 ms por quadro; a sombra deles nem aparecia.
      const tiny = DETAIL_CULL.some(([re, dist]) => dist <= 106 && re.test(mat.name));
      if (meta?.castShadow !== false && !tiny && !key.startsWith('lod1|')) shadows?.addShadowCaster(merged, false);

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
