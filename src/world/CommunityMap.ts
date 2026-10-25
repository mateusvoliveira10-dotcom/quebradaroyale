import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { WORLD } from '../core/config';
import { Rng } from '../utils/random';
import { buildHouse, HouseInfo, HouseSpec } from './builders/House';
import { buildMorro } from './builders/Morro';
import { buildMata } from './builders/Mata';
import { buildIsland } from './builders/Island';
import { OUTER_POIS, Terrain } from './Terrain';
import {
  addCar,
  addClouds,
  addDumpster,
  addFootballField,
  addVehicle,
  addPole,
  CarVariant,
  addSign,
  addTrashPile,
  addTree,
  addWall,
} from './builders/Props';
import { buildShop, ShopKind } from './builders/Shops';
import { scatterVegetation } from './builders/Vegetation';
import { WorldBuilder } from './WorldBuilder';

/** 0 = comum (rua/beco), 1 = bom (lajes), 2 = alto (lojas, morro, caixa d'água). */
export type LootTier = 0 | 1 | 2;

export interface LootSpot {
  pos: Vector3;
  tier: LootTier;
}

export type FeatureKind = 'house' | 'shop' | 'terrace' | 'field' | 'road' | 'sidewalk' | 'beco' | 'mata' | 'poi';

export interface MapFeature {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: FeatureKind;
  /** Nome da área (kind 'poi'). */
  name?: string;
}

export interface CommunityMapResult {
  spawn: Vector3;
  houses: HouseInfo[];
  lootSpots: LootSpot[];
  features: MapFeature[];
  half: number;
}

/** Metade da largura do asfalto e limite da calçada das duas ruas principais. */
const ROAD_HALF = 3.5;
const SIDEWALK_EDGE = 5.5;
/** Início dos lotes a partir do eixo das ruas. */
const LOT_START = 6;
/** Início do morro (canto noroeste). */
const MORRO_START = 38;

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const HOUSE_SIGNS: ReadonlyArray<{ text: string; bg: string; fg: string }> = [
  { text: 'AÇAÍ DA TIA', bg: '#5b1f7a', fg: '#ffffff' },
  { text: 'LAN HOUSE', bg: '#2457c5', fg: '#ffffff' },
  { text: 'SALGADOS', bg: '#ff8a1f', fg: '#1b1420' },
  { text: 'FRETES', bg: '#ffffff', fg: '#2457c5' },
  { text: 'SALÃO DA KEL', bg: '#f07ab0', fg: '#ffffff' },
  { text: 'DISK GÁS', bg: '#c4161c', fg: '#ffd21f' },
  { text: 'ASSISTÊNCIA CELULAR', bg: '#1b1420', fg: '#25c4ff' },
];

const SHOP_BY_QUADRANT: Record<string, ShopKind | undefined> = {
  '1,1': 'boteco',
  '-1,1': 'mercadinho',
  '-1,-1': 'oficina',
};

/**
 * Comunidade: duas ruas asfaltadas que se cruzam no centro, quatro quadras densas
 * cortadas por becos cimentados, comércio nas esquinas, campinho, morro com
 * escadarias, muro grafitado em volta e morros cheios de casas no horizonte.
 */
export function buildCommunityMap(b: WorldBuilder): CommunityMapResult {
  const rng = new Rng(WORLD.seed);
  const m = b.mats;
  const half = WORLD.half;
  const lotEnd = half - 2.4;
  const features: MapFeature[] = [];
  const lootSpots: LootSpot[] = [];
  const houses: HouseInfo[] = [];
  const streetHouses: HouseInfo[] = [];
  const loot = (pos: Vector3, tier: LootTier) => lootSpots.push({ pos, tier });

  // ----- Chão (terra batida) -----
  b.box({ w: half * 2 + 10, h: 1, d: half * 2 + 10, x: 0, z: 0, y: -1, mat: m.dirt, tile: 7, collide: true });
  // Relevo da ilha em volta da comunidade (morros, lagoa, praia) e o mar.
  const terrain = new Terrain();
  terrain.build(b.scene, m.terreno);

  buildRoads(b, rng, features);

  // Sem muro em volta: a comunidade se abre para o resto da ilha (relevo, áreas com nome).

  // ----- Áreas reservadas -----
  const fieldRect: Rect = { x0: 26, x1: half, z0: -32, z1: -LOT_START };
  const morroRect: Rect = { x0: -half, x1: -MORRO_START + 0.5, z0: MORRO_START - 10, z1: half };
  addFootballField(b, 43, -18, 26, 16);
  features.push({ x0: 30, z0: -26, x1: 56, z1: -10, kind: 'field' });
  for (let i = 0; i < 5; i++) addTree(b, rng, 30 + i * 6, 0, -30.5, rng.range(0.8, 1.05));
  loot(new Vector3(43, 0.1, -18), 1);
  loot(new Vector3(31, 0.1, -12), 0);
  loot(new Vector3(43, 0.55, -21.6), 0);

  const morro = buildMorro(b, rng, MORRO_START, half - 0.2);
  houses.push(...morro.houses);
  for (const p of morro.lootSpots) loot(p, 2);
  for (const h of morro.houses) for (const p of h.roofSpots) if (h.stairDir !== null) loot(p, 1);
  features.push({ x0: -half, z0: MORRO_START + 10, x1: -MORRO_START, z1: half, kind: 'terrace' });
  features.push({ x0: -half, z0: MORRO_START + 21, x1: -(MORRO_START + 14), z1: half, kind: 'terrace' });
  features.push({ ...morro.summit, kind: 'terrace' });

  // ----- Quadras de casas -----
  let signIndex = 0;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const toWorld = (lx: number, lz: number, w: number, d: number): Rect => {
        const x0 = sx > 0 ? lx : -(lx + w);
        const z0 = sz > 0 ? lz : -(lz + d);
        return { x0, x1: x0 + w, z0, z1: z0 + d };
      };
      const front: 1 | -1 = sz > 0 ? -1 : 1;
      const blocked = (r: Rect) => overlaps(r, fieldRect) || overlaps(r, morroRect);

      let localZ = LOT_START;
      let row = 0;
      while (true) {
        const rowDepth = rng.range(7.5, 10);
        if (localZ + rowDepth > lotEnd) break;

        let localX = LOT_START + rng.range(0, 0.8);
        let sinceGap = 0;
        let prev: HouseInfo | null = null;
        let first = true;
        while (true) {
          const shopKind = row === 0 && first ? SHOP_BY_QUADRANT[`${sx},${sz}`] : undefined;
          first = false;
          const w = shopKind ? 9.5 : rng.range(5, 9);
          if (localX + w > lotEnd) break;
          const d = shopKind ? rowDepth : rowDepth - rng.range(0, 1.5);
          const rect = toWorld(localX, localZ, w, d);

          let built: HouseInfo | null = null;
          if (!blocked(rect)) {
            if (shopKind) {
              const shop = buildShop(b, rng, { kind: shopKind, x0: rect.x0, z0: rect.z0, w, d, front });
              for (const p of shop.lootSpots) loot(p, 2);
              features.push({ ...rect, kind: 'shop' });
            } else {
              const facesStreet = row === 0;
              const sign = facesStreet && rng.chance(0.3) ? HOUSE_SIGNS[signIndex++ % HOUSE_SIGNS.length] : null;
              const spec: HouseSpec = {
                x0: rect.x0,
                z0: rect.z0,
                w,
                d,
                base: 0,
                floors: rng.chance(facesStreet ? 0.7 : 0.5) ? 2 : 1,
                front,
                stair: !sign && rng.chance(0.55),
                puxadinho: rng.chance(0.4),
              };
              built = buildHouse(b, rng, spec);
              houses.push(built);
              if (facesStreet) streetHouses.push(built);
              features.push({ ...rect, kind: 'house' });
              const reachable = built.stairDir !== null || spec.floors === 1;
              if (reachable && rng.chance(0.4)) for (const p of built.roofSpots) loot(p, 1);
              if (sign) {
                addSign(b, sign.text, {
                  x: rect.x0 + w / 2,
                  y: 2.62,
                  z: built.frontZ,
                  width: Math.min(w - 0.8, 4.2),
                  height: 0.75,
                  facing: front,
                  bg: sign.bg,
                  fg: sign.fg,
                  board: true,
                });
              }
            }
          }

          // Becos entre casas: às vezes geminadas, mas no máximo 3 seguidas.
          sinceGap++;
          let gap = 0;
          if (sinceGap >= 3 || rng.chance(0.4)) {
            gap = rng.range(1.7, 2.8);
            sinceGap = 0;
          }
          if (gap > 0 && !blocked(rect)) {
            const g = toWorld(localX + w, localZ, gap, rowDepth);
            if (!blocked(g)) decorateAlley(b, rng, g, row, built, loot, features);
          }
          // Fios "gato" passando de laje em laje sobre os becos.
          if (prev && built && gap === 0 && rng.chance(0.25)) {
            const a = new Vector3(prev.spec.x0 + prev.spec.w / 2, prev.roofY + 0.5, prev.frontZ - front * 1.5);
            const c = new Vector3(built.spec.x0 + built.spec.w / 2, built.roofY + 0.5, built.frontZ - front * 1.5);
            b.wire(a, c, 0.4, 0.015);
          }
          prev = built;
          localX += w + gap;
        }

        // Beco horizontal entre esta fileira e a próxima.
        const becoGap = rng.range(2.8, 3.5);
        const becoRect = toWorld(LOT_START, localZ + rowDepth, lotEnd - LOT_START, becoGap);
        if (localZ + rowDepth + becoGap + 7.5 <= lotEnd) {
          cementStrip(b, becoRect, 'x', [fieldRect, morroRect], features);
          if (!overlaps(becoRect, fieldRect) && !overlaps(becoRect, morroRect)) {
            const lx = rng.range(LOT_START + 4, lotEnd - 4);
            const p = toWorld(lx, localZ + rowDepth + becoGap / 2, 0, 0);
            if (rng.chance(0.6)) loot(new Vector3(p.x0, 0.1, p.z0), 0);
            if (rng.chance(0.35)) addTrashPile(b, rng, p.x0 + 3, 0, p.z0);
          }
        }
        localZ += rowDepth + becoGap;
        row++;
      }
    }
  }

  buildPolesAndWires(b, rng, streetHouses);
  buildStreetLife(b, rng, lootSpots);
  addClouds(b, rng, 22);
  // O anel externo da ilha (áreas com nome, árvores, mar) substitui os morros de fundo e o
  // bairro cenográfico de fora do muro.
  const island = buildIsland(b, terrain);
  houses.push(...island.houses);
  for (const l of island.loot) loot(l.pos, l.tier);
  for (const q of OUTER_POIS) features.push({ x0: q.x - q.r, x1: q.x + q.r, z0: q.z - q.r, z1: q.z + q.r, kind: 'poi', name: q.name });

  // Mata com trilhas no terreno vazio ao lado do campinho (gerador próprio).
  const mataRect = { x0: 60, x1: half - 2.5, z0: -31, z1: -9.5 };
  const mata = buildMata(b, mataRect);
  features.push({ ...mataRect, kind: 'mata' });
  for (const l of mata.loot) loot(l.pos, l.tier);

  // Por último (já com todos os colisores): árvores extras, bananeiras, mato, trepadeiras no
  // muro e mais caçambas. Gerador próprio dentro: o mapa sorteado acima não muda.
  scatterVegetation(b, {
    half,
    terraces: morro.terraces,
    blocked: [...features.filter((f) => f.kind !== 'terrace' && f.kind !== 'mata' && f.kind !== 'poi'), ...mata.clear, ...island.blocked],
    loot: lootSpots.map((l) => l.pos),
    becos: features.filter((f) => f.kind === 'beco' && f.x1 - f.x0 > f.z1 - f.z0),
  });

  return { spawn: new Vector3(0, 0.2, -1), houses, lootSpots, features, half: WORLD.radius };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/** Faixa de cimento com valeta no meio (piso de beco). */
function cementStrip(b: WorldBuilder, r: Rect, axis: 'x' | 'z', avoid: Rect[], features: MapFeature[]): void {
  if (avoid.some((a) => overlaps(r, a))) return;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  b.box({ w, h: 0.03, d, x: cx, z: cz, y: 0, mat: b.mats.cement, tile: 3 });
  if (axis === 'x') b.box({ w, h: 0.012, d: 0.25, x: cx, z: cz, y: 0.03, mat: b.mats.concreteDark, tile: 2 });
  else b.box({ w: 0.25, h: 0.012, d, x: cx, z: cz, y: 0.03, mat: b.mats.concreteDark, tile: 2 });
  features.push({ ...r, kind: 'beco' });
}

/** Beco vertical entre duas casas: piso, às vezes um muro para escalar, loot e lixo. */
function decorateAlley(
  b: WorldBuilder,
  rng: Rng,
  g: Rect,
  row: number,
  built: HouseInfo | null,
  loot: (p: Vector3, t: LootTier) => void,
  features: MapFeature[],
): void {
  cementStrip(b, g, 'z', [], features);
  const cx = (g.x0 + g.x1) / 2;
  const cz = (g.z0 + g.z1) / 2;
  if (row > 0 && rng.chance(0.35)) {
    // Muro atravessando o beco: baixo (vault) ou médio (escalada).
    const h = rng.pick([1.05, 1.2, 1.9, 2.2]);
    addWall(b, g.x0 - 0.05, cz, g.x1 + 0.05, cz, h, rng.pick(b.mats.paints));
    if (rng.chance(0.5)) loot(new Vector3(cx, 0.1, cz + (rng.chance(0.5) ? 1.6 : -1.6)), 1);
  } else if (rng.chance(0.25)) {
    loot(new Vector3(cx, 0.1, cz), 0);
  }
  if (built && rng.chance(0.3)) addTrashPile(b, rng, cx, 0, g.z0 + 0.8);
}

/** Asfalto, faixas, meio-fio, calçadas, faixas de pedestre e tampas de bueiro. */
function buildRoads(b: WorldBuilder, rng: Rng, features: MapFeature[]): void {
  const m = b.mats;
  const half = WORLD.half;
  const span = half * 2;
  const roadW = ROAD_HALF * 2;
  const sideW = SIDEWALK_EDGE - ROAD_HALF;

  // Alturas diferentes evitam z-fighting no cruzamento.
  b.box({ w: span, h: 0.04, d: roadW, x: 0, z: 0, y: 0, mat: m.asphalt, tile: 5 });
  b.box({ w: roadW, h: 0.05, d: span, x: 0, z: 0, y: 0, mat: m.asphalt, tile: 5 });
  features.push({ x0: -half, z0: -ROAD_HALF, x1: half, z1: ROAD_HALF, kind: 'road' });
  features.push({ x0: -ROAD_HALF, z0: -half, x1: ROAD_HALF, z1: half, kind: 'road' });

  const armLen = half - SIDEWALK_EDGE;
  const armMid = SIDEWALK_EDGE + armLen / 2;
  const sideMid = ROAD_HALF + sideW / 2;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      b.box({ w: armLen, h: 0.1, d: sideW, x: s * armMid, z: t * sideMid, y: 0, mat: m.sidewalk, collide: true });
      b.box({ w: sideW, h: 0.1, d: armLen, x: t * sideMid, z: s * armMid, y: 0, mat: m.sidewalk, collide: true });
      b.box({ w: sideW, h: 0.1, d: sideW, x: s * sideMid, z: t * sideMid, y: 0, mat: m.sidewalk, collide: true });
      // Meio-fio.
      b.box({ w: armLen + sideW, h: 0.15, d: 0.16, x: s * (armMid - sideW / 2), z: t * (ROAD_HALF + 0.08), y: 0, mat: m.curb });
      b.box({ w: 0.16, h: 0.15, d: armLen + sideW, x: t * (ROAD_HALF + 0.08), z: s * (armMid - sideW / 2), y: 0, mat: m.curb });
      features.push({ x0: Math.min(s * SIDEWALK_EDGE, s * half), z0: Math.min(t * ROAD_HALF, t * SIDEWALK_EDGE), x1: Math.max(s * SIDEWALK_EDGE, s * half), z1: Math.max(t * ROAD_HALF, t * SIDEWALK_EDGE), kind: 'sidewalk' });
      features.push({ x0: Math.min(t * ROAD_HALF, t * SIDEWALK_EDGE), z0: Math.min(s * SIDEWALK_EDGE, s * half), x1: Math.max(t * ROAD_HALF, t * SIDEWALK_EDGE), z1: Math.max(s * SIDEWALK_EDGE, s * half), kind: 'sidewalk' });
    }
    // Faixa central tracejada dupla.
    for (let p = SIDEWALK_EDGE + 4; p < half - 1; p += 4) {
      for (const o of [-0.12, 0.12]) {
        b.box({ w: 2, h: 0.015, d: 0.12, x: s * (p + 1), z: o, y: 0.04, mat: m.roadLine });
        b.box({ w: 0.12, h: 0.015, d: 2, x: o, z: s * (p + 1), y: 0.05, mat: m.roadLine });
      }
    }
    // Faixas de pedestre.
    for (let i = 0; i < 7; i++) {
      const o = -ROAD_HALF + 0.55 + i * 1.0;
      b.box({ w: 2.4, h: 0.012, d: 0.5, x: s * (SIDEWALK_EDGE + 1.6), z: o, y: 0.04, mat: m.roadWhite });
      b.box({ w: 0.5, h: 0.012, d: 2.4, x: o, z: s * (SIDEWALK_EDGE + 1.6), y: 0.05, mat: m.roadWhite });
    }
    // Tampas de bueiro.
    for (let k = 0; k < 3; k++) {
      const p = rng.range(12, half - 8);
      for (const [x, z, y] of [[s * p, rng.range(-2, 2), 0.04], [rng.range(-2, 2), s * p, 0.05]]) {
        const disc = MeshBuilder.CreateCylinder('manhole', { diameter: 0.8, height: 0.012, tessellation: 18 }, b.scene);
        disc.position.set(x, y + 0.006, z);
        b.addMesh(disc, m.metalDark);
      }
    }
  }
  buildDrains(b);
}

/** Bocas de lobo ao longo das duas ruas: grelha no asfalto junto ao meio-fio e a boca escura no espelho dele. */
function buildDrains(b: WorldBuilder): void {
  const m = b.mats;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const g = t * (ROAD_HALF - 0.22);
      const lip = t * (ROAD_HALF - 0.02);
      for (let p = SIDEWALK_EDGE + 7; p < WORLD.half - 3; p += 14) {
        const a = s * p;
        const c = s * (p + 3);
        b.box({ w: 0.9, h: 0.008, d: 0.36, x: a, z: g, y: 0.04, mat: m.metalDark });
        b.box({ w: 0.8, h: 0.07, d: 0.02, x: a, z: lip, y: 0.05, mat: m.rubber });
        b.box({ w: 0.36, h: 0.008, d: 0.9, x: g, z: c, y: 0.05, mat: m.metalDark });
        b.box({ w: 0.02, h: 0.07, d: 0.8, x: lip, z: c, y: 0.06, mat: m.rubber });
      }
    }
  }
}

/** Postes nas calçadas, fiação entre eles e os "gatos" puxados para as casas. */
function buildPolesAndWires(b: WorldBuilder, rng: Rng, streetHouses: HouseInfo[]): void {
  const offset = SIDEWALK_EDGE - 0.55;
  const spacing = 16;
  const lines: Array<{ along: 'x' | 'z'; side: number }> = [
    { along: 'x', side: 1 },
    { along: 'x', side: -1 },
    { along: 'z', side: 1 },
    { along: 'z', side: -1 },
  ];

  for (const { along, side } of lines) {
    for (const dirSign of [-1, 1]) {
      let prev: Vector3[] | null = null;
      for (let p = 10; p < WORLD.half - 2; p += spacing) {
        const pos = dirSign * p;
        const x = along === 'x' ? pos : side * offset;
        const z = along === 'x' ? side * offset : pos;
        const toward = along === 'x' ? new Vector3(x, 0, 0) : new Vector3(0, 0, z);
        const tips = addPole(b, x, z, along === 'z', toward);
        if (prev) {
          for (let i = 0; i < 3; i++) b.wire(prev[i], tips[i], 0.55 + rng.range(0, 0.4));
          b.wire(prev[1].add(new Vector3(0, -1.6, 0)), tips[1].add(new Vector3(0, -1.6, 0)), 0.4, 0.035);
        }
        prev = tips;
        if (rng.chance(0.3)) addTrashPile(b, rng, x + (along === 'x' ? 0.7 : 0), 0.1, z + (along === 'z' ? 0.7 : 0));

        if (along !== 'x') continue;
        const near = streetHouses.filter((h) => Math.sign(h.frontZ) === side && Math.abs(h.spec.x0 + h.spec.w / 2 - x) < 10).slice(0, 3);
        for (const h of near) {
          if (!rng.chance(0.75)) continue;
          const target = new Vector3(h.spec.x0 + rng.range(0.5, h.spec.w - 0.5), h.roofY - 0.4, h.frontZ);
          b.wire(tips[1].add(new Vector3(0, -0.3, 0)), target, rng.range(0.5, 1.4), 0.014);
        }
      }
    }
  }
}

/** Carros estacionados, caçambas e árvores de calçada. */
function buildStreetLife(b: WorldBuilder, rng: Rng, loot: LootSpot[]): void {
  const half = WORLD.half;
  const carSpots: Array<[number, number, number]> = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      carSpots.push([s * rng.range(12 + i * 18, 24 + i * 18), s * 2.45 * (rng.chance(0.5) ? 1 : -1), 0]);
      carSpots.push([2.45 * (rng.chance(0.5) ? 1 : -1), s * rng.range(12 + i * 18, 24 + i * 18), Math.PI / 2]);
    }
  }
  // Alguns táxis e uma viatura (genérica) entre os carros comuns.
  const variants: Record<number, CarVariant> = { 1: 'taxi', 4: 'policia', 8: 'taxi' };
  carSpots.forEach(([x, z, ry], i) => {
    if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) return;
    addCar(b, rng, x, z, ry + (rng.chance(0.5) ? Math.PI : 0), variants[i] ?? 'comum');
    if (rng.chance(0.3)) loot.push({ pos: new Vector3(x + (ry === 0 ? 0 : 1.6) * Math.sign(-x || 1), 0.1, z + (ry === 0 ? 1.6 : 0) * Math.sign(-z || 1)), tier: 0 });
  });
  // Fuscas (modelo 3D enviado) estacionados nos trechos das ruas principais longe do
  // centro, onde os outros carros não chegam. Gerador próprio: o resto do mapa não muda.
  const fr = new Rng(1959);
  const fuscaSpots: Array<[number, number, number]> = [
    [78, -2.45, 0], [-96, 2.45, 0], [118, 2.45, 0], [-132, -2.45, 0],
    [2.45, 84, Math.PI / 2], [-2.45, -104, Math.PI / 2], [-2.45, 126, Math.PI / 2], [2.45, -138, Math.PI / 2],
  ];
  // Viaturas (modelo enviado, letreiro corrigido) em dois pontos de rua, além da que entra no
  // lugar da viatura genérica entre os carros comuns (addCar com variante 'policia').
  // (entre 62 e 70 m: além dos carros comuns, que vão até 60 m, e antes dos Fuscas)
  for (const [x, z, ry] of [[-66, -2.45, 0], [2.45, 66, Math.PI / 2]] as const) {
    addVehicle(b, 'viatura', x, z, ry + (fr.chance(0.5) ? Math.PI : 0));
  }
  // Ambulâncias (modelo enviado, letreiro corrigido): duas, longe dos outros carros.
  for (const [x, z, ry] of [[100, -2.45, 0], [-2.45, -82, Math.PI / 2]] as const) {
    addVehicle(b, 'ambulancia', x, z, ry + (fr.chance(0.5) ? Math.PI : 0));
  }
  for (const [x, z, ry] of fuscaSpots) {
    if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) continue;
    if (!addVehicle(b, 'fusca', x, z, ry + (fr.chance(0.5) ? Math.PI : 0))) break;
    if (fr.chance(0.35)) loot.push({ pos: new Vector3(x + (ry === 0 ? 0 : 1.6) * Math.sign(-x || 1), 0.1, z + (ry === 0 ? 1.6 : 0) * Math.sign(-z || 1)), tier: 0 });
  }
  addDumpster(b, rng, 19, 2.4, 0);
  addDumpster(b, rng, -2.4, -27, Math.PI / 2);
  addDumpster(b, rng, -46, 33.5, 0);
  loot.push({ pos: new Vector3(19, 0.1, 0.4), tier: 0 });
  loot.push({ pos: new Vector3(-46, 0.1, 31.6), tier: 1 });
  loot.push({ pos: new Vector3(0, 0.1, -1.5), tier: 0 });

  // Árvores nos cantos das calçadas.
  for (const [x, z] of [[-8, 4.6], [8, -4.6], [4.6, 30], [-4.6, -40], [30, 4.6]]) {
    addTree(b, rng, x, 0.1, z, 0.85, 'calcada');
  }
}
