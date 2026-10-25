import { Material, Matrix, Mesh, Quaternion, Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import type { Materials } from '../Materials';
import { WorldAssets, WorldModel } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';

/**
 * Vegetação e caçambas a partir dos modelos de `tools/blender/vegetation.py`: árvores
 * (com versão leve de longe), bananeiras, trepadeiras, caçambas de entulho e o mato,
 * que é um único tufo repetido por thin instances (1 draw call para o mapa inteiro).
 */

export type TreeSpecies = 'mangueira' | 'amendoeira' | 'coqueiro' | 'calcada';
const SPECIES: ReadonlyArray<[TreeSpecies, number]> = [
  ['mangueira', 0.3],
  ['amendoeira', 0.25],
  ['calcada', 0.25],
  ['coqueiro', 0.2],
];
/** Raio aproximado da copa (m, escala 1): usado para não enfiar a copa nas casas. */
const CANOPY: Record<TreeSpecies, number> = { mangueira: 3.6, amendoeira: 3.4, calcada: 2.1, coqueiro: 2.2 };
const HEIGHT: Record<TreeSpecies, number> = { mangueira: 7.5, amendoeira: 8, calcada: 5.5, coqueiro: 9.5 };

export function pickSpecies(rng: Rng): TreeSpecies {
  let r = rng.next();
  for (const [s, w] of SPECIES) if ((r -= w) <= 0) return s;
  return 'mangueira';
}

/** Papel de material do Blender → material da biblioteca do mapa. */
function roleMaterial(m: Materials): (role: string) => Material {
  const map: Record<string, Material> = {
    bark: m.bark,
    bark_log: m.barkLog,
    wood_end: m.woodEnd,
    cal: m.white,
    leaf: m.foliage,
    leaf_dark: m.foliageDark,
    leaf_red: m.leafRed,
    palm: m.palmLeaf,
    coco: m.foliageDark,
    grass: m.grass,
    yellow: m.cacamba,
    yellow_in: m.cacambaInner,
    rust: m.rust,
    metal: m.metalDark,
    debris_brick: m.brick,
    debris_conc: m.concrete,
    wood: m.wood,
    refl_r: m.plasticRed,
    refl_w: m.white,
    // favela.glb
    bag_black: m.trashBag,
    bag_blue: m.bagBlue,
    bag_white: m.bagWhite,
    cardboard: m.cardboard,
    bottle: m.bottle,
    rubber: m.rubber,
    rubber_burnt: m.rubberBurnt,
    concrete: m.concrete,
    sack: m.sack,
  };
  return (role) => map[role] ?? m.foliage;
}

export function prop(name: string): WorldModel | null {
  return WorldAssets.current?.props.get(name) ?? null;
}

/** Árvore 3D (perto: modelo cheio com colisor no tronco; longe: versão leve). false = sem modelos. */
export function placeTree(b: WorldBuilder, species: TreeSpecies, x: number, y: number, z: number, ry: number, scale: number): boolean {
  const near = prop(`Arv_${species}`);
  const far = prop(`Arv_${species}_lod1`);
  if (!near || !far) return false;
  const mat = roleMaterial(b.mats);
  b.model(near, x, y, z, ry, mat, { scale, lod: 0 });
  b.model(far, x, y, z, ry, mat, { scale, lod: 1, collide: false });
  return true;
}

export function placeCacamba(b: WorldBuilder, x: number, z: number, ry: number): boolean {
  const model = prop('Cacamba');
  if (!model) return false;
  b.model(model, x, 0, z, ry, roleMaterial(b.mats));
  const along = Math.abs(Math.cos(ry)) > 0.5;
  b.contactShadow(x, z, along ? 3.1 : 1.7, along ? 1.7 : 3.1, 0, 0.5);
  return true;
}

/** Prop de favela.glb (lixo, pneus, barricadas) girado em ry. false = modelo não carregado. */
export function placeProp(b: WorldBuilder, name: string, x: number, y: number, z: number, ry: number, scale = 1): boolean {
  const model = prop(name);
  if (!model) return false;
  b.model(model, x, y, z, ry, roleMaterial(b.mats), { scale });
  return true;
}

/** Trepadeira encostada numa parede cuja normal (para fora) é (nx, nz). */
export function placeTrepadeira(b: WorldBuilder, x: number, y: number, z: number, nx: number, nz: number, scale: number): void {
  const model = prop('Trepadeira');
  if (!model) return;
  b.model(model, x, y, z, Math.atan2(nx, nz), roleMaterial(b.mats), { scale, collide: false });
}

// ------------------------------------------------------------------ espalhamento

export interface Terrace {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

const CELL = 8;

/** Índice simples dos colisores (caixas alinhadas) para testar espaço livre. */
class Obstacles {
  private readonly grid = new Map<string, Box[]>();

  constructor(b: WorldBuilder) {
    for (const c of b.colliders) {
      const bb = c.getBoundingInfo().boundingBox;
      const box: Box = { x0: bb.minimumWorld.x, x1: bb.maximumWorld.x, y0: bb.minimumWorld.y, y1: bb.maximumWorld.y, z0: bb.minimumWorld.z, z1: bb.maximumWorld.z };
      // Chão e platôs (caixas enormes) não contam como obstáculo: o teste de altura cuida deles.
      if (box.x1 - box.x0 > 40 && box.z1 - box.z0 > 40) continue;
      for (let i = Math.floor(box.x0 / CELL); i <= Math.floor(box.x1 / CELL); i++) {
        for (let k = Math.floor(box.z0 / CELL); k <= Math.floor(box.z1 / CELL); k++) {
          const key = `${i},${k}`;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(box);
        }
      }
    }
  }

  /** Marca um retângulo como ocupado (para o mato não nascer dentro do que acabou de ser posto). */
  reserve(x: number, z: number, rx: number, rz: number, y0: number, y1: number): void {
    const box: Box = { x0: x - rx, x1: x + rx, y0, y1, z0: z - rz, z1: z + rz };
    for (let i = Math.floor(box.x0 / CELL); i <= Math.floor(box.x1 / CELL); i++) {
      for (let k = Math.floor(box.z0 / CELL); k <= Math.floor(box.z1 / CELL); k++) {
        const key = `${i},${k}`;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(box);
      }
    }
  }

  /** Retângulo [x±rx, z±rz] livre entre as alturas y0 e y1? */
  free(x: number, z: number, rx: number, rz: number, y0: number, y1: number): boolean {
    for (let i = Math.floor((x - rx) / CELL); i <= Math.floor((x + rx) / CELL); i++) {
      for (let k = Math.floor((z - rz) / CELL); k <= Math.floor((z + rz) / CELL); k++) {
        for (const o of this.grid.get(`${i},${k}`) ?? []) {
          if (o.x0 < x + rx && o.x1 > x - rx && o.z0 < z + rz && o.z1 > z - rz && o.y1 > y0 && o.y0 < y1) return false;
        }
      }
    }
    return true;
  }
}

export interface ScatterOptions {
  half: number;
  terraces: Terrace[];
  /** Retângulos onde não nasce nada (rua, calçada, beco, campinho). */
  blocked: Array<{ x0: number; x1: number; z0: number; z1: number }>;
  /** Pontos de loot: árvores e bananeiras ficam longe deles. */
  loot: Vector3[];
  /** Becos horizontais (para caçambas). */
  becos: Array<{ x0: number; x1: number; z0: number; z1: number }>;
}

/**
 * Espalha árvores, bananeiras, mato, trepadeiras no muro e mais caçambas pelo mapa já
 * montado. Testa cada ponto contra os colisores e as áreas bloqueadas, então nada nasce
 * dentro de casa, em cima de carro, na rua ou no loot. Usa gerador próprio: o resto do
 * mapa não muda.
 */
export function scatterVegetation(b: WorldBuilder, o: ScatterOptions): void {
  if (!WorldAssets.current) return;
  const rng = new Rng(77031);
  const obstacles = new Obstacles(b);
  const mat = roleMaterial(b.mats);
  const lim = o.half - 1.5;
  const ground = (x: number, z: number) => {
    let y = 0;
    for (const t of o.terraces) if (x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1) y = Math.max(y, t.top);
    return y;
  };
  // Longe da borda de platô (o tufo não fica pendurado no muro de arrimo).
  const nearEdge = (x: number, z: number, m: number) =>
    o.terraces.some((t) => x > t.x0 - m && x < t.x1 + m && z > t.z0 - m && z < t.z1 + m && (Math.abs(x - t.x0) < m || Math.abs(x - t.x1) < m || Math.abs(z - t.z0) < m || Math.abs(z - t.z1) < m));
  const blocked = (x: number, z: number, m: number) => o.blocked.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
  const nearLoot = (x: number, z: number, d: number) => o.loot.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d);

  // Árvores extras (terrenos baldios, platôs, beira do muro).
  let trees = 0;
  for (let tries = 0; tries < 2500 && trees < 30; tries++) {
    const x = rng.range(-lim, lim);
    const z = rng.range(-lim, lim);
    const species = pickSpecies(rng);
    const scale = rng.range(0.8, 1.05);
    const r = CANOPY[species] * scale * 0.75;
    const gy = ground(x, z);
    if (blocked(x, z, 1) || nearEdge(x, z, 1.5) || nearLoot(x, z, 2.5)) continue;
    if (!obstacles.free(x, z, 0.8, 0.8, gy + 0.05, gy + 3)) continue;
    if (!obstacles.free(x, z, r, r, gy + 2.2, gy + HEIGHT[species] * scale)) continue;
    placeTree(b, species, x, gy, z, rng.range(0, Math.PI * 2), scale);
    trees++;
  }

  // Bananeiras em touceiras nos cantos de terreno.
  const banana = prop('Bananeira');
  let bananas = 0;
  for (let tries = 0; tries < 2000 && banana && bananas < 24; tries++) {
    const x = rng.range(-lim, lim);
    const z = rng.range(-lim, lim);
    const gy = ground(x, z);
    if (blocked(x, z, 0.8) || nearEdge(x, z, 1.2) || nearLoot(x, z, 2)) continue;
    if (!obstacles.free(x, z, 1.3, 1.3, gy + 0.05, gy + 3.2)) continue;
    b.model(banana, x, gy, z, rng.range(0, Math.PI * 2), mat, { scale: rng.range(0.85, 1.15) });
    bananas++;
  }

  // Trepadeiras subindo pelo lado de dentro do muro.
  for (let i = 0; i < 40; i++) {
    const side = rng.int(0, 3);
    const p = rng.range(-lim + 2, lim - 2);
    const [x, z, nx, nz] = side === 0 ? [p, o.half - 0.03, 0, -1] : side === 1 ? [p, -o.half + 0.03, 0, 1] : side === 2 ? [o.half - 0.03, p, -1, 0] : [-o.half + 0.03, p, 1, 0];
    const gy = ground(x + nx * 0.6, z + nz * 0.6);
    if (!obstacles.free(x + nx * 0.7, z + nz * 0.7, 0.3, 0.3, gy + 0.2, gy + 2)) continue;
    placeTrepadeira(b, x, gy, z, nx, nz, rng.range(0.9, 1.4));
  }

  // Caçambas a mais nos becos largos.
  let cacambas = 0;
  for (let tries = 0; tries < 60 && cacambas < 5; tries++) {
    const beco = rng.pick(o.becos);
    if (!beco || beco.z1 - beco.z0 < 2.6) continue;
    const x = rng.range(beco.x0 + 3, beco.x1 - 3);
    const z = (beco.z0 + beco.z1) / 2;
    if (Math.abs(x) > lim - 4 || nearLoot(x, z, 3) || !obstacles.free(x, z, 1.9, 1.0, 0.05, 1.5)) continue;
    placeCacamba(b, x, z, 0);
    cacambas++;
  }

  // Cara de favela: pneus soltos e empilhados, barricadas de pneu e de paletes, montes de
  // lixo. Só em terreno livre (terrenos baldios, platôs, beira do muro), nunca em rua,
  // calçada, beco ou em cima do loot; cada um reserva o espaço que ocupa.
  const favela: Array<[string, number, number, number]> = [
    // nome, quantidade, meia-largura do espaço livre, altura
    ['BarricadaPneus', 10, 1.7, 1.0],
    ['BarricadaMadeira', 8, 1.6, 1.3],
    ['PilhaPneus', 16, 0.5, 0.9],
    ['Pneu', 28, 0.4, 0.3],
    ['Lixo_a', 10, 0.8, 0.8],
    ['Lixo_b', 10, 0.8, 0.8],
    ['Lixo_c', 10, 0.9, 0.8],
  ];
  for (const [name, count, half, height] of favela) {
    if (!prop(name)) continue;
    let placed = 0;
    for (let tries = 0; tries < count * 120 && placed < count; tries++) {
      const x = rng.range(-lim, lim);
      const z = rng.range(-lim, lim);
      const gy = ground(x, z);
      if (blocked(x, z, half * 0.6) || nearEdge(x, z, half + 0.5) || nearLoot(x, z, half + 1.2)) continue;
      // Gente consegue passar em volta: exige uma folga de 1,2 m além do próprio objeto.
      if (!obstacles.free(x, z, half + 1.2, half + 1.2, gy + 0.05, gy + 2.2)) continue;
      const ry = rng.range(0, Math.PI * 2);
      placeProp(b, name, x, gy, z, ry, rng.range(0.92, 1.08));
      obstacles.reserve(x, z, half, half, gy, gy + height);
      placed++;
    }
  }

  // Mato e capim: um tufo repetido por thin instances.
  const spots: Array<{ x: number; y: number; z: number; dry: boolean }> = [];
  for (let tries = 0; tries < 20000 && spots.length < 2800; tries++) {
    const x = rng.range(-lim, lim);
    const z = rng.range(-lim, lim);
    if (blocked(x, z, 0.2) || nearEdge(x, z, 0.4)) continue;
    const gy = ground(x, z);
    if (!obstacles.free(x, z, 0.25, 0.25, gy + 0.05, gy + 0.8)) continue;
    // Em touceira: cada ponto aceito puxa uns vizinhos.
    const n = rng.int(2, 6);
    const dry = rng.chance(0.25);
    for (let k = 0; k < n; k++) {
      const px = x + rng.range(-0.8, 0.8);
      const pz = z + rng.range(-0.8, 0.8);
      if (obstacles.free(px, pz, 0.2, 0.2, gy + 0.05, gy + 0.8) && !blocked(px, pz, 0.1)) spots.push({ x: px, y: gy, z: pz, dry });
    }
  }
  thinInstances('Mato', b.mats.grass, spots.filter((s) => !s.dry), rng);
  thinInstances('Capim', b.mats.grassDry, spots.filter((s) => s.dry), rng);
}

/** Mato e capim extras (ex.: dentro da mata), pelos mesmos tufos de thin instances. */
export function addUnderbrush(b: WorldBuilder, spots: Array<{ x: number; y: number; z: number; dry: boolean }>, rng: Rng): void {
  thinInstances('Mato', b.mats.grass, spots.filter((s) => !s.dry), rng);
  thinInstances('Capim', b.mats.grassDry, spots.filter((s) => s.dry), rng);
}

/** Bloco (m) das malhas de mato: cada bloco é cortado fora da tela e some de longe. */
const GRASS_CHUNK = 48;
/** Além disso (m, até o centro do bloco) o mato não é desenhado: a névoa e a distância já o escondem. */
const GRASS_DISTANCE = 85;

/**
 * Um tufo, várias cópias (thin instances), uma malha por bloco de 48 m: sem sombra
 * própria, não é clicável nem colide.
 */
function thinInstances(name: string, material: Material, spots: Array<{ x: number; y: number; z: number }>, rng: Rng): void {
  const base = prop(name)?.parts.get('grass');
  if (!base || spots.length === 0) return;
  const chunks = new Map<string, typeof spots>();
  for (const p of spots) {
    const key = `${Math.floor(p.x / GRASS_CHUNK)},${Math.floor(p.z / GRASS_CHUNK)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(p);
  }
  const m = new Matrix();
  const q = new Quaternion();
  const s = new Vector3();
  const t = new Vector3();
  for (const [key, list] of chunks) {
    const mesh = base.clone(`veg_${name}_${key}`, null, true) as Mesh;
    // O buffer das thin instances fica na geometria: cada bloco precisa da sua (o tufo é pequeno).
    mesh.makeGeometryUnique();
    mesh.setEnabled(true);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    const buf = new Float32Array(list.length * 16);
    list.forEach((p, i) => {
      const k = rng.range(0.7, 1.45);
      s.set(k, k * rng.range(0.8, 1.25), k);
      Quaternion.RotationYawPitchRollToRef(rng.range(0, Math.PI * 2), 0, 0, q);
      t.set(p.x, p.y, p.z);
      Matrix.ComposeToRef(s, q, t, m);
      m.copyToArray(buf, i * 16);
    });
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.addLODLevel(GRASS_DISTANCE, null);
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
  }
}
