import { Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { WorldAssets } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';
import { buildHouse, HouseInfo } from './House';
import { addSign, addTree, addWall } from './Props';
import { buildStairs } from './Stairs';

export interface MorroResult {
  houses: HouseInfo[];
  lootSpots: Vector3[];
  /** Cume (platô 3) com a estátua. */
  summit: Rect;
  /** Os três platôs com a altura do topo (para a vegetação achar o chão). */
  terraces: Array<Rect & { top: number }>;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * "Morro" no canto noroeste: dois platôs com muro de arrimo de pedra,
 * escadarias públicas com corrimão, casas nos platôs, árvores e uma
 * caixa d'água comunitária alta que serve de ponto de referência.
 *
 * Coordenadas no mundo: x de -(limit) a -(start), z de start a limit.
 */
export function buildMorro(b: WorldBuilder, rng: Rng, start: number, limit: number): MorroResult {
  const m = b.mats;
  const houses: HouseInfo[] = [];
  const lootSpots: Vector3[] = [];
  const h1 = 3;
  const h2 = 6;

  // Platô 1 e platô 2 (retângulos no mundo).
  const t1: Rect = { x0: -limit, x1: -start, z0: start + 10, z1: limit };
  const t2: Rect = { x0: -limit, x1: -(start + 14), z0: start + 21, z1: limit };

  terrace(b, t1, 0, h1);
  terrace(b, t2, h1, h2);

  // Escadaria 1: do chão até o platô 1 (sobe em +Z).
  const s1x = -(start + 4.5);
  buildStairs(b, { x: s1x, z: t1.z0 - 9.5, base: 0, axis: 'z', dir: 1, run: 9.5, rise: h1, width: 2.6, mat: m.concrete, rails: { left: true, right: true }, nosing: m.roadLine, stepHeight: 0.17 });
  b.contactShadow(s1x, t1.z0 - 4.75, 2.6, 9.5, 0, 0.5);
  // Escadaria 2: do platô 1 ao platô 2.
  const s2x = -(start + 20);
  buildStairs(b, { x: s2x, z: t2.z0 - 9.5, base: h1, axis: 'z', dir: 1, run: 9.5, rise: h2 - h1, width: 2.4, mat: m.concrete, rails: { left: true, right: true }, nosing: m.roadLine, stepHeight: 0.17 });

  // Mureta na borda do platô 1 (com vão na escadaria) — boa para o parkour.
  addWall(b, t1.x1, t1.z0 + 0.12, s1x + 1.4, t1.z0 + 0.12, 0.9, m.muro, h1);
  addWall(b, s1x - 1.4, t1.z0 + 0.12, t1.x0 + 0.2, t1.z0 + 0.12, 0.9, m.muro, h1);
  addWall(b, t2.x1, t2.z0 + 0.12, s2x + 1.3, t2.z0 + 0.12, 0.9, m.muro, h2);
  addWall(b, s2x - 1.3, t2.z0 + 0.12, t2.x0 + 0.2, t2.z0 + 0.12, 0.9, m.muro, h2);

  addSign(b, 'ESCADARIA DA PAZ', { x: s1x + 3.2, y: 1.6, z: t1.z0, width: 3.6, height: 0.9, facing: -1, bg: '#ffffff', fg: '#1f3fa6', graffiti: false });
  addSign(b, 'MORRO VIVE', { x: s1x - 8, y: 1.5, z: t1.z0, width: 8, height: 2.2, facing: -1, bg: '#cfc8b6', fg: '#ff4fa3', graffiti: true });

  // Casas no platô 1 (entre a borda e o platô 2), fachada para -Z.
  const row1Z0 = t1.z0 + 2.6;
  const row1Depth = t2.z0 - row1Z0 - 2.6;
  fillRow(b, rng, houses, { x0: t1.x0 + 0.6, x1: t1.x1 - 0.4, z0: row1Z0, z1: row1Z0 + row1Depth }, h1, [[s2x - 1.8, s2x + 1.8]]);
  // Casas no platô 2.
  const row2Z0 = t2.z0 + 2.6;
  fillRow(b, rng, houses, { x0: t2.x0 + 0.6, x1: t2.x1 - 7, z0: row2Z0, z1: Math.min(row2Z0 + 8, t2.z1 - 0.6) }, h2, []);

  // Caixa d'água comunitária (marco visual).
  const tx = t2.x1 - 3.5;
  const tz = t2.z1 - 5;
  for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
    b.box({ w: 0.4, h: 9, d: 0.4, x: tx + ox, z: tz + oz, y: h2, mat: m.concrete, collide: true, tile: 2 });
  }
  for (const y of [h2 + 3, h2 + 6]) {
    b.box({ w: 3.1, h: 0.25, d: 0.25, x: tx, z: tz - 1.3, y, mat: m.concrete });
    b.box({ w: 3.1, h: 0.25, d: 0.25, x: tx, z: tz + 1.3, y, mat: m.concrete });
  }
  b.box({ w: 3.6, h: 0.3, d: 3.6, x: tx, z: tz, y: h2 + 9, mat: m.concrete, collide: true });
  b.cylinder({ diameter: 3.6, diameterTop: 3.8, h: 3.2, x: tx, y: h2 + 9.3, z: tz, mat: m.tank, collide: true, tessellation: 24 });
  b.cylinder({ diameter: 4.0, h: 0.3, x: tx, y: h2 + 12.5, z: tz, mat: m.tankLid, tessellation: 24 });
  addSign(b, 'ÁGUA DA COMUNIDADE', { x: tx, y: h2 + 10.9, z: tz - 1.85, width: 3.0, height: 0.6, facing: -1, bg: '#2f7fe0', fg: '#ffffff' });
  lootSpots.push(new Vector3(tx, h2 + 9.35, tz - 1.4));

  // Cume com a estátua de braços abertos (marco visível de quase todo o mapa).
  // Gerador próprio: não altera a sequência do resto do mapa.
  const summit = buildSummit(b, new Rng(4242), t2, h2);
  for (const p of summit.lootSpots) lootSpots.push(p);
  // Favela subindo o morro até a estátua (gerador próprio: o resto do mapa não muda).
  buildFavelaDoMorro(b, new Rng(6161), t2, h2, summit.rect, houses, lootSpots);

  // Árvores e loot nos platôs.
  // Na beira do platô 1 as casas ficam perto: só espécies de copa estreita.
  for (let i = 0; i < 4; i++) addTree(b, rng, t1.x1 - 2 - i * 5.5, h1, t1.z0 + 1.1 + rng.range(0, 0.4), rng.range(0.7, 0.95), i % 2 === 0 ? 'coqueiro' : 'calcada');
  addTree(b, rng, t2.x1 - 2.2, h2, t2.z0 + 1.6, 0.9, 'coqueiro');
  lootSpots.push(new Vector3(s1x, h1 + 0.05, t1.z0 + 0.9));
  lootSpots.push(new Vector3(s2x + 4, h2 + 0.05, t2.z0 + 1.0));
  lootSpots.push(new Vector3(t1.x1 - 3, h1 + 0.05, t2.z0 - 1.2));

  const terraces = [{ ...t1, top: h1 }, { ...t2, top: h2 }, { ...summit.rect, top: SUMMIT_TOP }];
  return { houses, lootSpots, summit: summit.rect, terraces };
}

/** Altura do cume (topo do platô 3). */
const SUMMIT_TOP = 10.5;

/**
 * Platô 3 no alto do morro: muro de arrimo, escadaria vindo do platô 2, mureta, árvores e
 * a estátua de braços abertos (`tools/blender/statue.py`) virada para o centro da
 * comunidade. A estátua é genérica de propósito: lembra os monumentos dos morros
 * brasileiros sem copiar nenhum (veja o cabeçalho do script).
 */
function buildSummit(b: WorldBuilder, rng: Rng, t2: Rect, base: number): { rect: Rect; lootSpots: Vector3[] } {
  const m = b.mats;
  const cx = (t2.x0 + t2.x1) / 2;
  const t3: Rect = { x0: cx - 23, x1: cx + 23, z0: t2.z0 + 43, z1: t2.z1 - 8 };
  terrace(b, t3, base, SUMMIT_TOP);
  const lootSpots: Vector3[] = [];

  // Escadaria larga do platô 2 até o cume, com corrimão dos dois lados.
  const run = 10;
  buildStairs(b, { x: cx, z: t3.z0 - run, base, axis: 'z', dir: 1, run, rise: SUMMIT_TOP - base, width: 3.2, mat: m.concrete, rails: { left: true, right: true }, nosing: m.roadLine, stepHeight: 0.17 });
  b.contactShadow(cx, t3.z0 - run / 2, 3.2, run, base, 0.5);
  // Mureta na borda do cume, com o vão da escadaria.
  addWall(b, t3.x1, t3.z0 + 0.12, cx + 1.8, t3.z0 + 0.12, 0.9, m.muro, SUMMIT_TOP);
  addWall(b, cx - 1.8, t3.z0 + 0.12, t3.x0 + 0.2, t3.z0 + 0.12, 0.9, m.muro, SUMMIT_TOP);
  addSign(b, 'MIRANTE DA PAZ', { x: cx + 5, y: base + 1.6, z: t3.z0, width: 4.2, height: 0.9, facing: -1, bg: '#ffffff', fg: '#1f3fa6' });
  addSign(b, 'DEUS É FIEL', { x: cx - 9, y: base + 2.0, z: t3.z0, width: 7, height: 2.2, facing: -1, bg: '#cfc8b6', fg: '#25c4ff', graffiti: true });

  // Estátua no meio do cume, de frente para o cruzamento central (0, 0).
  const sx = cx;
  const sz = (t3.z0 + t3.z1) / 2 + 2;
  const assets = WorldAssets.current;
  const cristo = assets?.texturedProps.get('cristo');
  if (cristo) {
    // Cristo (modelo enviado), de braços abertos para o cruzamento central, em pedra.
    const ry = Math.atan2(-sx, -sz);
    b.model(cristo.model, sx, SUMMIT_TOP, sz, ry, () => m.statue, { collide: false });
    b.collider(3.6, 5, 3.6, sx, SUMMIT_TOP + 2.5, sz);
    b.contactShadow(sx, sz, 9, 9, SUMMIT_TOP, 0.9);
    lootSpots.push(new Vector3(sx + Math.sin(ry) * 6.5, SUMMIT_TOP + 0.05, sz + Math.cos(ry) * 6.5));
  } else if (assets?.statue) {
    const ry = Math.atan2(-sx, -sz);
    b.model(assets.statue, sx, SUMMIT_TOP, sz, ry, (role) => (role === 'pedestal' ? m.statuePedestal : m.statue));
    b.contactShadow(sx, sz, 14.8, 14.8, SUMMIT_TOP, 0.9);
    // Loot bom ao pé do pedestal, do lado da frente.
    lootSpots.push(new Vector3(sx + Math.sin(ry) * 8.6, SUMMIT_TOP + 0.05, sz + Math.cos(ry) * 8.6));
  }

  // Árvores nos cantos e loot espalhado.
  for (const [ox, oz] of [[-19, 4], [19, 5], [-17, 30], [18, 29], [-8, 33]]) addTree(b, rng, cx + ox, SUMMIT_TOP, t3.z0 + oz, rng.range(0.85, 1.1));
  lootSpots.push(new Vector3(cx + 14, SUMMIT_TOP + 0.05, t3.z0 + 3));
  lootSpots.push(new Vector3(cx - 14, SUMMIT_TOP + 0.05, t3.z1 - 4));
  return { rect: t3, lootSpots };
}

/**
 * Casas no platô 2 em volta do cume: duas fileiras entre as casas de baixo e a escadaria do
 * cume, e blocos a oeste e a leste do cume, com becos entre as fileiras. Ficam livres o
 * corredor da escadaria do cume, o caminho da escadaria do platô 1 (lado leste) e a caixa
 * d'água comunitária.
 */
function buildFavelaDoMorro(b: WorldBuilder, rng: Rng, t2: Rect, base: number, t3: Rect, out: HouseInfo[], loot: Vector3[]): void {
  const cx = (t3.x0 + t3.x1) / 2;
  const stair: [number, number] = [cx - 3, cx + 3];
  const east = t2.x1 - 11; // até aqui; daí para o leste fica o caminho de quem sobe do platô 1
  // Faixa de baixo (duas fileiras), antes da escadaria do cume.
  for (const [z0, depth] of [[t2.z0 + 14.5, 7.2], [t2.z0 + 25, 6.4]] as const) {
    fillRow(b, rng, out, { x0: t2.x0 + 0.8, x1: east, z0, z1: z0 + depth }, base, [stair]);
    loot.push(new Vector3(rng.range(t2.x0 + 10, east - 6), base + 0.05, z0 - 1.6));
  }
  // Blocos dos lados do cume, fileira por fileira, com becos de ~4 m.
  for (let z0 = t3.z0 - 6; z0 + 7 < t2.z1 - 1; z0 += 11) {
    fillRow(b, rng, out, { x0: t2.x0 + 0.8, x1: t3.x0 - 2.2, z0, z1: z0 + 7 }, base, []);
    // A leste para antes da caixa d'água comunitária.
    if (z0 + 7 < t2.z1 - 10) fillRow(b, rng, out, { x0: t3.x1 + 2.2, x1: east, z0, z1: z0 + 7 }, base, []);
    if (rng.chance(0.6)) loot.push(new Vector3(rng.range(t2.x0 + 4, t3.x0 - 6), base + 0.05, z0 - 2));
  }
}

/** Platô: maciço com muro de arrimo de pedra e topo de terra/cimento. */
function terrace(b: WorldBuilder, r: Rect, base: number, top: number): void {
  const m = b.mats;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  b.box({ w, h: top - base + 0.5, d, x: cx, z: cz, y: base - 0.5, mat: m.stone, tile: 2.2, collide: true });
  b.box({ w: w - 0.1, h: 0.04, d: d - 0.1, x: cx, z: cz, y: top, mat: m.dirt, tile: 6 });
  b.box({ w: w + 0.06, h: 0.12, d: 0.4, x: cx, z: r.z0 + 0.2, y: top - 0.08, mat: m.concrete });
  b.contactShadow(cx, cz, w, d, base);
}

/** Preenche uma faixa com casas lado a lado (fachada para -Z), pulando faixas proibidas em X. */
function fillRow(b: WorldBuilder, rng: Rng, out: HouseInfo[], area: Rect, base: number, skip: Array<[number, number]>): void {
  let x = area.x0;
  let sinceGap = 0;
  while (true) {
    const w = rng.range(5, 7.5);
    if (x + w > area.x1) break;
    const blocked = skip.some(([a, c]) => x < c && x + w > a);
    if (blocked) {
      x = Math.max(...skip.map(([, c]) => c)) + 0.2;
      continue;
    }
    const d = area.z1 - area.z0 - rng.range(0, 1);
    out.push(
      buildHouse(b, rng, {
        x0: x,
        z0: area.z0,
        w,
        d,
        base,
        floors: rng.chance(0.6) ? 1 : 2,
        front: -1,
        stair: rng.chance(0.6),
        puxadinho: rng.chance(0.4),
      }),
    );
    sinceGap++;
    let gap = 0;
    if (sinceGap >= 2 || rng.chance(0.4)) {
      gap = rng.range(1.5, 2.3);
      sinceGap = 0;
    }
    x += w + gap;
  }
}
