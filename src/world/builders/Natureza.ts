import { Material } from '@babylonjs/core';
import { WORLD } from '../../core/config';
import { Rng } from '../../utils/random';
import { OUTER_POIS, Terrain, waterEdgeDistance } from '../Terrain';
import { WorldAssets } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';
import { roadAt } from './Roads';
import { addUnderbrush, placeTree } from './Vegetation';

/**
 * Natureza do kit Quaternius (nature.glb): árvores, moitas, capim, flores, cogumelos e
 * pedras. Cada peça entra no lote estático com a versão de perto (lod 0) e a de longe
 * (lod 1, trocada pelo StaticBatcher a 72 m); só troncos e pedras têm colisão. Peças
 * pequenas (capim, flores, cogumelos) não têm versão de longe: somem além dos 72 m.
 */

/** Grupos de modelos por papel no mapa. */
export const NAT = {
  comum: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'],
  clara: ['Birch_1', 'Birch_3', 'Birch_5'],
  pinheiro: ['Pine_1', 'Pine_3'],
  araucaria: ['GiantPine_1', 'GiantPine_2'],
  alta: ['TallThick_1', 'TallThick_2', 'TallThick_3'],
  retorcida: ['TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3'],
  seca: ['DeadTree_1', 'DeadTree_3'],
  ipe: ['CherryBlossom_1', 'CherryBlossom_3'],
  moita: ['Bush_Common', 'Bush_Common_Flowers', 'Bush_Large', 'Bush_Large_Flowers', 'Bush_Long_1'],
  moitaGrande: ['Bush_Large', 'Bush_Large_Flowers'],
  samambaia: ['Fern_1', 'Fern_2'],
  planta: ['Plant_1_Big', 'Plant_2', 'Plant_3', 'Plant_5', 'Plant_7_Big', 'Clover_1'],
  flor: ['Flower_1_Group', 'Flower_2_Group', 'Flower_3_Group', 'Flower_4_Group', 'Flower_7_Group', 'Flower_6'],
  capim: ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wide_Tall', 'Grass_Wispy_Tall'],
  trigo: ['Grass_Wheat'],
  cogumelo: ['Mushroom_Common', 'Mushroom_RedCap', 'Mushroom_Oyster'],
  pedraGrande: ['Rock_Big_1', 'Rock_Big_2'],
  pedra: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Rock_Medium_4'],
  seixo: ['Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_1', 'Pebble_Square_4'],
  laje: ['RockPath_Round_Small_1', 'RockPath_Square_Wide'],
} as const;

export type NatGroup = keyof typeof NAT;

/** Raio da copa (m, escala 1) por grupo de árvore: espaçamento e distância das casas. */
const CANOPY: Partial<Record<NatGroup, number>> = { comum: 2.2, clara: 3.4, pinheiro: 2.4, araucaria: 5.5, alta: 4.3, retorcida: 5.5, seca: 3.1, ipe: 5.5 };
export const TREE_GROUPS: NatGroup[] = ['comum', 'clara', 'pinheiro', 'araucaria', 'alta', 'retorcida', 'seca', 'ipe'];

export function natureReady(): boolean {
  return (WorldAssets.current?.nature.size ?? 0) > 0;
}

function natMat(): (role: string) => Material | null {
  const mats = WorldAssets.current?.natureMaterials;
  return (role) => mats?.get(role) ?? null;
}

export interface NatureOptions {
  /** Sem colisão mesmo que o modelo tenha (ex.: pedra decorativa em jardim). */
  collide?: boolean;
  /** Sem a versão de longe (a peça some a 72 m). Padrão: só capim, flores, cogumelos e seixos. */
  noFar?: boolean;
}

/** Uma peça do kit em (x, y, z), girada em ry e na escala dada. false = modelo não carregado. */
export function placeNature(b: WorldBuilder, id: string, x: number, y: number, z: number, ry: number, scale = 1, o: NatureOptions = {}): boolean {
  const assets = WorldAssets.current;
  const near = assets?.nature.get(`Nat_${id}`);
  if (!near) return false;
  const far = assets?.nature.get(`Nat_${id}_lod1`);
  const mat = natMat();
  const small = o.noFar ?? /^(Grass|Flower|Mushroom|Pebble|Clover|Plant_7|Fern)/.test(id);
  if (small || !far) {
    b.model(near, x, y, z, ry, mat, { scale, lod: 0, collide: o.collide });
    return true;
  }
  b.model(near, x, y, z, ry, mat, { scale, lod: 0, collide: o.collide });
  b.model(far, x, y, z, ry, mat, { scale, lod: 1, collide: false });
  return true;
}

/** Peça sorteada de um grupo. */
export function placeNatureFrom(b: WorldBuilder, rng: Rng, group: NatGroup, x: number, y: number, z: number, scale = 1, o: NatureOptions = {}): boolean {
  return placeNature(b, rng.pick(NAT[group]), x, y, z, rng.range(0, Math.PI * 2), scale, o);
}

export interface ScatterContext {
  terrain: Terrain;
  /** Retângulos onde não nasce nada (lotes, quadras, pátios). */
  blocked: Array<{ x0: number; x1: number; z0: number; z1: number }>;
  /** Já ocupado (x, z, raio). */
  used: Array<[number, number, number]>;
  /** Loot: árvores longe dele. */
  loot: Array<{ x: number; z: number }>;
}

/**
 * Espalha a natureza pelo anel de fora inteiro, com densidade e espécies por região:
 * Mata Fechada e Mata do Sabiá densas (árvores altas e retorcidas, samambaias, cogumelos),
 * Serra Grande com araucárias e pedras, beira de rio e lagoas com figueiras e plantas,
 * fazenda com ipês e trigais, morros abertos com bosques em manchas, praia com coqueiros.
 * Nada nasce em estrada, água, encosta íngreme, lote ou em cima do loot.
 */
export function scatterNature(b: WorldBuilder, ctx: ScatterContext): void {
  const rng = new Rng(5150);
  const t = ctx.terrain;
  const H = (x: number, z: number) => t.height(x, z);
  const poi = (name: string) => OUTER_POIS.find((p) => p.name === name)!;
  const mata = poi('MATA FECHADA');
  const sabia = poi('MATA DO SABIÁ');
  const serra = poi('SERRA GRANDE');
  const fazenda = poi('FAZENDA SANTA LUZIA');
  const lagoaSerra = poi('LAGOA DA SERRA');
  const noBuild = ['VILA DOS PESCADORES', 'FERRO-VELHO', 'SÍTIO DO SEU ZÉ', 'CAMPO DE VÁRZEA', 'JARDIM PRIMAVERA', 'CONDOMÍNIO BELA VISTA', 'PEDREIRA', 'PICO DO MIRANTE'].map(poi);
  const dist = (p: { x: number; z: number }, x: number, z: number) => Math.hypot(x - p.x, z - p.z);
  const inBuilt = (x: number, z: number, margin = 0) => noBuild.some((p) => dist(p, x, z) < p.r + margin);
  const blocked = (x: number, z: number, m: number) => ctx.blocked.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
  const free = (x: number, z: number, r: number) => !ctx.used.some(([ux, uz, ur]) => (ux - x) ** 2 + (uz - z) ** 2 < (ur + r) ** 2);
  const reserve = (x: number, z: number, r: number) => ctx.used.push([x, z, r]);
  const nearLoot = (x: number, z: number, d: number) => ctx.loot.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d);
  const inCommunity = (x: number, z: number, m = 6) => Math.abs(x) < WORLD.half + m && Math.abs(z) < WORLD.half + m;
  const nearLobby = (x: number, z: number) => Math.hypot(x + 8, z - (WORLD.half + 13)) < 26;
  const onRoad = (x: number, z: number, m: number) => {
    const r = roadAt(x, z);
    return r.d < r.hw + m;
  };
  const ok = (x: number, z: number, r: number, slope: number, waterMargin: number) =>
    !inCommunity(x, z) && !nearLobby(x, z) && !inBuilt(x, z, 2) && !blocked(x, z, 1) && !onRoad(x, z, r + 1) && waterEdgeDistance(x, z) > waterMargin && t.slopeNy(x, z) >= slope && free(x, z, r) && Math.hypot(x, z) < WORLD.radius - 14;
  const ready = natureReady();

  // Densidade de árvores (0..1) por ponto, pela região e por manchas de bosque.
  const density = (x: number, z: number): number => {
    const patch = Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2) + Math.cos(z * 0.019 - Math.sin(x * 0.013));
    let d = 0.16 + Math.max(0, patch) * 0.2;
    d = Math.max(d, 0.95 * (1 - smooth(mata.r * 0.85, mata.r * 1.15, dist(mata, x, z))));
    d = Math.max(d, 0.85 * (1 - smooth(sabia.r * 1.2, sabia.r * 1.7, dist(sabia, x, z))));
    d = Math.max(d, 0.5 * (1 - smooth(serra.r * 0.7, serra.r * 1.3, dist(serra, x, z))));
    // Beira de rio e lagoas: mata ciliar.
    const we = waterEdgeDistance(x, z);
    if (we > 1.5 && we < 14) d = Math.max(d, 0.6);
    // Fazenda: pasto aberto com árvores isoladas.
    d *= 1 - 0.85 * (1 - smooth(fazenda.r * 0.9, fazenda.r * 1.2, dist(fazenda, x, z)));
    // Praia: poucas (coqueiros à parte).
    d *= 1 - smooth(WORLD.radius - 40, WORLD.radius - 22, Math.hypot(x, z));
    return d;
  };
  /** Grupo de árvore por lugar. */
  const pickGroup = (x: number, z: number, y: number): NatGroup => {
    const we = waterEdgeDistance(x, z);
    if (dist(serra, x, z) < serra.r * 1.2 || dist(lagoaSerra, x, z) < lagoaSerra.r * 1.1) {
      if (y > 36) return rng.chance(0.6) ? 'seca' : 'pinheiro';
      return rng.chance(0.55) ? 'araucaria' : rng.chance(0.6) ? 'pinheiro' : 'comum';
    }
    if (we < 14) return rng.chance(0.5) ? 'retorcida' : rng.chance(0.4) ? 'seca' : 'comum';
    if (dist(mata, x, z) < mata.r * 1.1) return rng.chance(0.45) ? 'alta' : rng.chance(0.4) ? 'retorcida' : rng.chance(0.5) ? 'comum' : 'clara';
    if (dist(sabia, x, z) < sabia.r * 1.6) return rng.chance(0.4) ? 'alta' : rng.chance(0.5) ? 'comum' : 'clara';
    if (dist(fazenda, x, z) < fazenda.r * 1.2) return rng.chance(0.5) ? 'ipe' : 'comum';
    const r = rng.next();
    return r < 0.45 ? 'comum' : r < 0.65 ? 'clara' : r < 0.78 ? 'ipe' : r < 0.9 ? 'alta' : 'pinheiro';
  };

  // ---- Árvores: amostragem por tentativa no anel inteiro.
  let trees = 0;
  const ringR0 = WORLD.half * 0.9;
  const ringR1 = WORLD.radius - 16;
  const budget = ready ? 1600 : 700;
  for (let tries = 0; tries < 60000 && trees < budget; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(ringR0 * ringR0, ringR1 * ringR1));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!rng.chance(density(x, z))) continue;
    const y = H(x, z);
    if (y < 0.6) continue;
    if (!ready) {
      // Sem o kit: as árvores antigas (como antes da expansão).
      if (!ok(x, z, 3, 0.8, 2) || nearLoot(x, z, 3)) continue;
      placeTree(b, rng.chance(0.5) ? 'mangueira' : 'copa', x, y - 0.1, z, rng.range(0, 6.28), rng.range(0.9, 1.4));
      reserve(x, z, 3);
      trees++;
      continue;
    }
    const group = pickGroup(x, z, y);
    const scale = rng.range(0.85, 1.25) * (group === 'comum' ? 1.15 : 1);
    const canopy = (CANOPY[group] ?? 3) * scale;
    const spacing = dist(mata, x, z) < mata.r || dist(sabia, x, z) < sabia.r * 1.4 ? canopy * 0.55 : canopy * 0.8;
    if (!ok(x, z, spacing, 0.74, 2.5) || nearLoot(x, z, 3)) continue;
    if (!placeNatureFrom(b, rng, group, x, y - 0.12, z, scale)) break;
    reserve(x, z, spacing);
    trees++;
    // Sub-bosque em volta: samambaias, moitas, cogumelos na mata; flores no campo.
    const dense = density(x, z) > 0.6;
    const n = dense ? rng.int(1, 2) : rng.int(0, 1);
    for (let k = 0; k < n; k++) {
      const ba = rng.range(0, Math.PI * 2);
      const bd = rng.range(2, 5);
      const bx = x + Math.cos(ba) * bd;
      const bz = z + Math.sin(ba) * bd;
      if (!ok(bx, bz, 0.6, 0.7, 1) || nearLoot(bx, bz, 1.5)) continue;
      const g: NatGroup = dense ? (rng.chance(0.4) ? 'samambaia' : rng.chance(0.5) ? 'moita' : rng.chance(0.5) ? 'cogumelo' : 'planta') : rng.chance(0.5) ? 'moita' : 'flor';
      const s = g === 'cogumelo' ? rng.range(0.35, 0.7) : g === 'flor' ? rng.range(0.45, 0.7) : rng.range(0.7, 1.2);
      placeNatureFrom(b, rng, g, bx, H(bx, bz) - 0.04, bz, s);
    }
  }

  // ---- Coqueiros na praia (as palmeiras antigas, que são brasileiras) e pedras na linha d'água.
  for (let i = 0; i < 160; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(WORLD.radius - 34, WORLD.radius - 14);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inBuilt(x, z, 4) || onRoad(x, z, 3) || !free(x, z, 2.5) || H(x, z) < 0.3) continue;
    placeTree(b, 'coqueiro', x, H(x, z) - 0.1, z, rng.range(0, 6.28), rng.range(0.9, 1.3));
    reserve(x, z, 2.5);
  }
  if (!ready) return;

  // ---- Moitas, flores e capim do kit soltos pelos campos (fora da mata, onde já há sub-bosque).
  for (let i = 0; i < 1400; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(ringR0 * ringR0, ringR1 * ringR1));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!ok(x, z, 0.8, 0.72, 0.8) || nearLoot(x, z, 1.5)) continue;
    const farm = dist(fazenda, x, z) < fazenda.r;
    const g: NatGroup = farm ? (rng.chance(0.5) ? 'trigo' : 'flor') : rng.chance(0.45) ? 'moita' : rng.chance(0.5) ? 'capim' : rng.chance(0.6) ? 'flor' : 'planta';
    const s = g === 'flor' ? rng.range(0.45, 0.7) : g === 'capim' || g === 'trigo' ? rng.range(0.5, 0.8) : rng.range(0.8, 1.25);
    placeNatureFrom(b, rng, g, x, H(x, z) - 0.04, z, s);
    reserve(x, z, 0.8);
  }

  // ---- Pedras: encostas, serra, beira de rio e pedreira em volta.
  for (let i = 0; i < 420; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(ringR0 * ringR0, ringR1 * ringR1));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = H(x, z);
    const slope = t.slopeNy(x, z);
    const we = waterEdgeDistance(x, z);
    const hill = dist(serra, x, z) < serra.r * 1.3 || slope < 0.9 || y > 20;
    if (!hill && we > 10 && !rng.chance(0.15)) continue;
    const big = rng.chance(hill ? 0.3 : 0.1);
    const rr = big ? 3 : 1.8;
    if (inCommunity(x, z) || nearLobby(x, z) || inBuilt(x, z, 2) || blocked(x, z, 1) || onRoad(x, z, rr + 1) || we < -0.5 || !free(x, z, rr) || nearLoot(x, z, rr + 1)) continue;
    const s = rng.range(0.7, 1.3);
    // Pedra afundada um pouco no chão (encosta): não fica flutuando.
    placeNatureFrom(b, rng, big ? 'pedraGrande' : 'pedra', x, y - 0.35 * s - (1 - slope) * 2, z, s);
    reserve(x, z, rr);
    if (rng.chance(0.5)) for (let k = 0; k < 3; k++) placeNatureFrom(b, rng, 'seixo', x + rng.range(-2.5, 2.5), H(x + 1, z + 1) + 0.02, z + rng.range(-2.5, 2.5), rng.range(0.8, 1.6));
  }

  // ---- Chão das matas: capim de thin instances (como no resto da ilha) mais denso.
  const grass: Array<{ x: number; y: number; z: number; dry: boolean }> = [];
  for (let tries = 0; tries < 30000 && grass.length < 7000; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(ringR0 * ringR0, ringR1 * ringR1));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (density(x, z) < 0.5 || inCommunity(x, z) || inBuilt(x, z) || blocked(x, z, 0.5) || onRoad(x, z, 0.5) || waterEdgeDistance(x, z) < 0.8 || t.slopeNy(x, z) < 0.78) continue;
    const n = rng.int(3, 6);
    for (let k = 0; k < n; k++) {
      const px = x + rng.range(-1.2, 1.2);
      const pz = z + rng.range(-1.2, 1.2);
      grass.push({ x: px, y: H(px, pz) - 0.05, z: pz, dry: false });
    }
  }
  addUnderbrush(b, grass, rng);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
