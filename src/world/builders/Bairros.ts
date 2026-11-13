import { Color3, Material, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { LAKES, OUTER_POIS, POOLS, Pool, Terrain } from '../Terrain';
import { addWater, boxWater } from '../Water';
import { WorldBuilder } from '../WorldBuilder';
import { addHipRoof, buildCasa, CasaResult, CasaSpec, CasaStyle, Lado, rebocoLimpo } from './Casa';
import { addRoof } from './HouseHQ';
import { natureReady, NatGroup, placeNatureFrom } from './Natureza';
import { makeDoor } from './Portas';
import { addCar, addPlasticChair, addPlasticTable, addSign } from './Props';
import { buildStairs } from './Stairs';
import { placeTextured, placeTree } from './Vegetation';

/**
 * Regiões novas do anel de fora: o bairro Jardim Primavera (ruas, calçadas, lotes murados
 * com casas de cômodos), o Condomínio Bela Vista (mansões com piscina, quadra de tênis,
 * lago com ponte de madeira e chorões), a Fazenda Santa Luzia (sede, celeiro, silo, curral)
 * e os pontos de interesse da Serra Grande, da Mata Fechada e da Lagoa da Serra.
 */

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface RegioesResult {
  loot: Array<{ pos: Vector3; tier: 0 | 1 | 2 }>;
  /** Onde a vegetação espalhada não nasce. */
  blocked: Rect[];
  used: Array<[number, number, number]>;
  /** Contagens (relatório de construção). */
  houses: number;
  doors: number;
  pools: number;
}

interface Ctx {
  b: WorldBuilder;
  rng: Rng;
  t: Terrain;
  out: RegioesResult;
  /** Madeira de construção (não some de longe como a dos móveis) e a tábua vermelha do celeiro. */
  tabua: StandardMaterial;
  tabuaVermelha: StandardMaterial;
  agua: StandardMaterial;
}

const poi = (name: string) => OUTER_POIS.find((p) => p.name === name)!;

export function buildRegioes(b: WorldBuilder, t: Terrain): RegioesResult {
  const hq = b.mats.hq;
  const tabua = hq.madeira.clone('tabua_construcao');
  const tabuaVermelha = hq.madeira.clone('tabua_celeiro');
  tabuaVermelha.diffuseColor = Color3.FromHexString('#b0553c');
  const agua = new StandardMaterial('piscina_agua', b.scene);
  agua.diffuseColor = Color3.FromHexString('#58c8e8');
  agua.emissiveColor = Color3.FromHexString('#12506a');
  agua.specularColor = new Color3(1, 1, 1);
  agua.specularPower = 120;
  agua.alpha = 0.62;
  agua.backFaceCulling = false;
  agua.metadata = { castShadow: false };
  const c: Ctx = { b, rng: new Rng(424242), t, out: { loot: [], blocked: [], used: [], houses: 0, doors: 0, pools: 0 }, tabua, tabuaVermelha, agua };
  buildJardim(c);
  buildCondominio(c);
  buildFazenda(c);
  buildSerra(c);
  buildMata(c);
  return c.out;
}

// ------------------------------------------------------------------ peças comuns

function loot(c: Ctx, x: number, y: number, z: number, tier: 0 | 1 | 2): void {
  c.out.loot.push({ pos: new Vector3(x, y + 0.1, z), tier });
}

function casa(c: Ctx, s: CasaSpec): CasaResult {
  const r = buildCasa(c.b, c.rng, s);
  c.out.loot.push(...r.loot);
  c.out.doors += r.doors;
  c.out.houses++;
  return r;
}

/**
 * Rua reta (asfalto de 7 m, calçadas dos dois lados, faixa tracejada). `axis` = eixo em que
 * ela corre; `cuts` = trechos (ao longo dela) sem calçada, onde outra rua cruza.
 */
function rua(c: Ctx, axis: 'x' | 'z', a0: number, a1: number, coord: number, y: number, cuts: Array<[number, number]> = [], h = 0.05, calcada = true): void {
  const { b } = c;
  const m = b.mats;
  const len = a1 - a0;
  const mid = (a0 + a1) / 2;
  if (axis === 'x') b.box({ w: len, h, d: 7, x: mid, z: coord, y, mat: m.hq.asfalto, tile: 4 });
  else b.box({ w: 7, h, d: len, x: coord, z: mid, y, mat: m.hq.asfalto, tile: 4 });
  for (let a = a0 + 3; a < a1 - 3; a += 6) {
    if (cuts.some(([l, r]) => a + 1 > l - 3.5 && a - 1 < r + 3.5)) continue;
    if (axis === 'x') b.box({ w: 2, h: 0.012, d: 0.14, x: a, z: coord, y: y + h, mat: m.roadLine });
    else b.box({ w: 0.14, h: 0.012, d: 2, x: coord, z: a, y: y + h, mat: m.roadLine });
  }
  if (!calcada) return;
  const pieces: Array<[number, number]> = [];
  let cur = a0;
  for (const [l, r] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (l > cur) pieces.push([cur, l]);
    cur = Math.max(cur, r);
  }
  if (cur < a1) pieces.push([cur, a1]);
  for (const side of [-1, 1]) {
    for (const [l, r] of pieces) {
      const o = coord + side * 4.4;
      if (axis === 'x') b.box({ w: r - l, h: 0.13, d: 1.8, x: (l + r) / 2, z: o, y, mat: m.hq.calcada, tile: 2, collide: true });
      else b.box({ w: 1.8, h: 0.13, d: r - l, x: o, z: (l + r) / 2, y, mat: m.hq.calcada, tile: 2, collide: true });
    }
  }
}

/** Muro reto (em x ou em z) de reboco limpo com pingadeira de concreto. */
function addWall(b: WorldBuilder, x0: number, z0: number, x1: number, z1: number, h: number, mat: Material, base = 0): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  b.box({ w: alongX ? len : 0.2, h, d: alongX ? 0.2 : len, x: cx, z: cz, y: base, mat, tile: 1.4, collide: true, worldUV: rebocoLimpo(mat, base) });
  b.box({ w: alongX ? len + 0.06 : 0.28, h: 0.07, d: alongX ? 0.28 : len + 0.06, x: cx, z: cz, y: base + h, mat: b.mats.hq.concreto, tile: 2 });
}

/** Poste de luz simples (haste, braço e luminária). */
function poste(c: Ctx, x: number, y: number, z: number, dx: number, dz: number): void {
  const m = c.b.mats;
  c.b.cylinder({ diameter: 0.16, diameterTop: 0.1, h: 5.6, x, y, z, mat: m.metalDark, tessellation: 8, collide: true });
  c.b.box({ w: dx ? 1.4 : 0.08, h: 0.08, d: dz ? 1.4 : 0.08, x: x + dx * 0.7, z: z + dz * 0.7, y: y + 5.5, mat: m.metalDark });
  c.b.box({ w: dx ? 0.5 : 0.22, h: 0.1, d: dz ? 0.5 : 0.22, x: x + dx * 1.3, z: z + dz * 1.3, y: y + 5.4, mat: m.headlight });
}

/** Banco de praça (assento e encosto de madeira, pés de ferro). */
function banco(c: Ctx, x: number, y: number, z: number, alongX: boolean): void {
  const { b } = c;
  const w = alongX ? 1.8 : 0.5;
  const d = alongX ? 0.5 : 1.8;
  b.box({ w, h: 0.06, d, x, z, y: y + 0.42, mat: c.tabua, tile: 1, collide: false });
  b.box({ w: alongX ? 1.8 : 0.06, h: 0.45, d: alongX ? 0.06 : 1.8, x: x - (alongX ? 0 : 0.24), z: z - (alongX ? 0.24 : 0), y: y + 0.48, mat: c.tabua, tile: 1 });
  b.collider(w, 0.5, d, x, y + 0.25, z);
  for (const s of [-0.75, 0.75]) b.box({ w: alongX ? 0.06 : 0.44, h: 0.42, d: alongX ? 0.44 : 0.06, x: x + (alongX ? s : 0), z: z + (alongX ? 0 : s), y, mat: b.mats.metalDark });
}

/** Cerca viva aparada (com colisão). */
function sebe(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, h = 1.2): void {
  const w = Math.max(0.8, Math.abs(x1 - x0));
  const d = Math.max(0.8, Math.abs(z1 - z0));
  c.b.box({ w, h, d, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y, mat: c.b.mats.foliageDark, tile: 1.5, collide: true });
}

/** Cerca de madeira (mourões e duas réguas) com colisão baixa: dá para pular. */
function cerca(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const { b } = c;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2.5));
  for (let i = 0; i <= n; i++) b.box({ w: 0.14, h: 1.25, d: 0.14, x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, y, mat: c.tabua, tile: 0.6 });
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (const ry of [0.45, 0.95]) b.box({ w: alongX ? len : 0.06, h: 0.1, d: alongX ? 0.06 : len, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: y + ry, mat: c.tabua, tile: 1.5 });
  b.collider(alongX ? len : 0.12, 1.15, alongX ? 0.12 : len, (x0 + x1) / 2, y + 0.58, (z0 + z1) / 2);
}

/** Árvore do kit (ou a antiga, sem o kit) num jardim. */
function arvore(c: Ctx, group: NatGroup, x: number, y: number, z: number, scale: number): void {
  if (natureReady()) placeNatureFrom(c.b, c.rng, group, x, y - 0.1, z, scale);
  else placeTree(c.b, 'calcada', x, y, z, c.rng.range(0, 6), scale);
}

/** Chorão: tronco, copa achatada e ramos pendentes até perto do chão. */
function chorao(c: Ctx, x: number, y: number, z: number, s: number): void {
  const { b, rng } = c;
  const m = b.mats;
  b.cylinder({ diameter: 0.55 * s, diameterTop: 0.32 * s, h: 3.4 * s, x, y: y - 0.2, z, mat: m.bark, tessellation: 8, collide: true });
  const crown = MeshBuilder.CreateSphere('chorao', { diameter: 4.2 * s, segments: 6 }, b.scene);
  crown.scaling.y = 0.5;
  crown.position.set(x, y + 3.9 * s, z);
  b.addMesh(crown, m.foliage);
  // Ramos finos em três anéis (os de fora mais compridos), levemente abertos para fora.
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * Math.PI * 2 * 3 + rng.range(-0.15, 0.15);
    const ring = i % 3;
    const r = (0.9 + ring * 0.65 + rng.range(-0.15, 0.15)) * s;
    const len = (rng.range(1.6, 2.3) + ring * 0.55) * s;
    const top = y + (4.3 - ring * 0.3) * s;
    b.box({ w: rng.range(0.16, 0.32) * s, h: len, d: 0.03, x: x + Math.cos(a) * (r + 0.12 * len), z: z + Math.sin(a) * (r + 0.12 * len), cy: top - len / 2, mat: i % 4 === 0 ? m.foliageDark : m.foliage, ry: -a + Math.PI / 2, rx: 0.12, tile: 0.6 });
  }
}

/** Estilo sorteado das casas do bairro (reboco em tons claros, telha de barro ou grafite). */
function estiloBairro(c: Ctx): CasaStyle {
  const { rng } = c;
  const hq = c.b.mats.hq;
  const paredes = [hq.branco, hq.bege, hq.cinzaClaro, hq.paint(2), hq.paint(3), hq.paint(6), hq.paint(5), hq.paint(1), hq.paint(10), hq.tijolo];
  const parede = rng.pick(paredes);
  const r = rng.next();
  return {
    parede,
    parede2: rng.chance(0.3) ? rng.pick([hq.branco, hq.bege]) : parede,
    interno: rng.pick([hq.branco, hq.bege, hq.branco]),
    telha: rng.pick([hq.telha, hq.telha, hq.telhaGrafite]),
    telhado: r < 0.6 ? 'duas' : r < 0.85 ? 'quatro' : 'laje',
    piso: rng.pick([hq.porcelanato, hq.piso, hq.madeira]),
    pisoQuarto: rng.pick([hq.madeira, hq.madeiraEscura]),
    porta: rng.pick([hq.madeiraEscura, hq.madeira, hq.branco]),
    rico: false,
  };
}

// ------------------------------------------------------------------ Jardim Primavera

function buildJardim(c: Ctx): void {
  const { b, rng } = c;
  const m = b.mats;
  const hq = m.hq;
  const p = poi('JARDIM PRIMAVERA');
  const y = c.t.height(p.x, p.z);
  c.out.blocked.push({ x0: 332, x1: 452, z0: -14, z1: 128 });

  // Ruas: avenida (z = 30), rua de cima (z = 88) e a transversal (x = 385).
  rua(c, 'x', 340, 450, 30, y, [[379.7, 390.3]]);
  rua(c, 'x', 334, 440, 88, y, [[379.7, 390.3]]);
  rua(c, 'z', -12, 126, 385, y, [[24.7, 35.3], [82.7, 93.3]], 0.056);
  for (const [px, pz, dx, dz] of [[352, 35, 0, -1], [372, 25, 0, 1], [402, 35, 0, -1], [424, 25, 0, 1], [444, 35, 0, -1], [348, 93, 0, -1], [370, 83, 0, 1], [404, 93, 0, -1], [428, 83, 0, 1], [380, 4, 1, 0], [390, 58, -1, 0], [380, 110, 1, 0]] as const) poste(c, px, y, pz, dx, dz);
  // Carros estacionados junto ao meio-fio.
  for (const [cx, cz, ry] of [[358, 27.4, 0], [411, 32.6, Math.PI], [436, 27.4, 0], [362, 90.6, Math.PI], [418, 85.4, 0], [387.6, 12, Math.PI / 2], [382.4, 64, -Math.PI / 2], [387.6, 108, Math.PI / 2]] as const) addCar(b, rng, cx, cz, ry, 'comum', y + 0.04);
  loot(c, 385, y, 30, 1);
  loot(c, 385, y, 88, 0);
  loot(c, 360, y, 30, 0);
  loot(c, 425, y, 88, 0);

  /** Fileira de lotes ao longo de uma rua em x; `front` = lado do lote que dá para a rua. */
  const fileira = (xs: number[], lz0: number, lz1: number, front: 'z0' | 'z1', backWall: boolean) => {
    for (let i = 0; i < xs.length - 1; i++) lote(xs[i], xs[i + 1], lz0, lz1, front, i === 0, backWall);
  };
  const lote = (lx0: number, lx1: number, lz0: number, lz1: number, front: 'z0' | 'z1', firstWall: boolean, backWall: boolean) => {
    const lw = lx1 - lx0;
    const roll = rng.next();
    let tipo: 'terrea' | 'sobrado';
    let w: number;
    let garagem = false;
    if (lw >= 13.9) {
      if (roll < 0.4) [tipo, w, garagem] = ['sobrado', rng.range(11.2, 11.8), true];
      else if (roll < 0.8) [tipo, w, garagem] = ['terrea', rng.range(10.6, 11.6), true];
      else [tipo, w] = ['sobrado', rng.range(8.6, 9.6)];
    } else if (lw >= 12.4) {
      if (roll < 0.35) [tipo, w, garagem] = ['terrea', rng.range(9.8, 10.2), true];
      else if (roll < 0.7) [tipo, w] = ['sobrado', rng.range(8.2, 9.4)];
      else [tipo, w] = ['terrea', rng.range(8, 9.6)];
    } else if (roll < 0.5) [tipo, w] = ['sobrado', rng.range(8, 8.8)];
    else [tipo, w] = ['terrea', rng.range(7.2, 8.6)];
    const d = tipo === 'sobrado' ? rng.range(10, 11.2) : rng.range(8.6, 10.4);
    const x0 = lx0 + (lw - w) * rng.range(0.35, 0.65);
    const setback = rng.range(3.6, 4.6);
    const z0 = front === 'z0' ? lz0 + setback : lz1 - setback - d;
    const style = estiloBairro(c);
    const r = casa(c, { x0, z0, w, d, y, front, tipo, garagem, style, lootChance: 0.55 });
    // Muros do lote: laterais e fundo altos; frente baixa com vão no portão e na garagem.
    const muro = rng.pick([hq.muro, hq.branco, hq.bege, style.parede]);
    if (firstWall) addWall(b, lx0, lz0, lx0, lz1, 1.9, muro, y);
    addWall(b, lx1, lz0, lx1, lz1, 1.9, muro, y);
    const zf = front === 'z0' ? lz0 : lz1;
    const zb = front === 'z0' ? lz1 : lz0;
    if (backWall) addWall(b, lx0, zb, lx1, zb, 1.9, muro, y);
    const gaps: Array<[number, number]> = [[r.entry.x - 0.9, r.entry.x + 0.9]];
    if (r.garage) gaps.push([r.garage.x - 1.7, r.garage.x + 1.7]);
    gaps.sort((a, q) => a[0] - q[0]);
    let cur = lx0;
    for (const [l, rr] of gaps) {
      if (l - cur > 0.4) addWall(b, cur, zf, l, zf, 0.9, muro, y);
      cur = Math.max(cur, rr);
    }
    if (lx1 - cur > 0.4) addWall(b, cur, zf, lx1, zf, 0.9, muro, y);
    // Caminho da porta e entrada da garagem até a calçada.
    const zs = front === 'z0' ? lz0 - 0.4 : lz1 + 0.4;
    const path = (px: number, pw: number, zh: number) => b.box({ w: pw, h: 0.05, d: Math.abs(zh - zs), x: px, z: (zh + zs) / 2, y, mat: hq.concreto, tile: 2 });
    path(r.entry.x, 1.2, r.entry.z);
    if (r.garage) path(r.garage.x, 3, r.garage.z);
    // Quintal: árvore, mesa, varal de loot.
    const yb0 = front === 'z0' ? z0 + d + 1.5 : lz0 + 1.5;
    const yb1 = front === 'z0' ? lz1 - 1.5 : z0 - 1.5;
    if (yb1 - yb0 > 3) {
      const tx = rng.range(lx0 + 2.5, lx1 - 2.5);
      const tz = rng.range(yb0 + 1, yb1 - 1);
      arvore(c, rng.pick(['comum', 'ipe', 'comum'] as const), tx, y, tz, rng.range(0.5, 0.7));
      if (rng.chance(0.5)) {
        const mx = tx > (lx0 + lx1) / 2 ? lx0 + 2.4 : lx1 - 2.4;
        const mz = (yb0 + yb1) / 2;
        addPlasticTable(b, mx, y, mz, m.white);
        addPlasticChair(b, mx - 0.8, y, mz, Math.PI / 2, m.white);
        addPlasticChair(b, mx + 0.8, y, mz, -Math.PI / 2, m.white);
      }
      if (rng.chance(0.4)) loot(c, tx > (lx0 + lx1) / 2 ? lx0 + 1.6 : lx1 - 1.6, y, yb0 + 0.8, 0);
    }
    // Jardim da frente: moitas ao lado do caminho.
    if (natureReady() && rng.chance(0.7)) {
      const fz = front === 'z0' ? lz0 + 1.6 : lz1 - 1.6;
      const fx = r.entry.x + (r.entry.x > (lx0 + lx1) / 2 ? -2.2 : 2.2);
      if (!r.garage || Math.abs(fx - r.garage.x) > 2.4) placeNatureFrom(b, rng, rng.chance(0.5) ? 'moita' : 'flor', fx, y - 0.03, fz, rng.range(0.6, 0.9));
    }
  };
  // Norte da avenida (frente para a avenida) e sul da rua de cima, de fundos uma para a outra.
  fileira([342, 355, 368, 379.5], 35.6, 59, 'z0', true);
  fileira([390.5, 404.5, 418.5, 432.5], 35.6, 59, 'z0', true);
  fileira([342, 355, 368, 379.5], 59, 82.4, 'z1', false);
  fileira([390.5, 404.5, 418.5, 432.5], 59, 82.4, 'z1', false);
  // Sul da avenida e norte da rua de cima.
  fileira([343, 355.5, 368, 379.5], 0, 24.4, 'z1', true);
  fileira([390.5, 404, 417.5, 430], 0, 24.4, 'z1', true);
  fileira([343, 355.5, 368, 379.5], 93.6, 114, 'z0', true);
  fileira([390.5, 403, 415.5, 428], 93.6, 114, 'z0', true);

  // Praça no fim da avenida: piso, bancos, canteiro com árvores e um coreto.
  const q = { x0: 433.5, x1: 447, z0: 36, z1: 58 };
  b.box({ w: q.x1 - q.x0, h: 0.06, d: q.z1 - q.z0, x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, y, mat: hq.calcada, tile: 2 });
  const cx = (q.x0 + q.x1) / 2;
  const cz = (q.z0 + q.z1) / 2;
  b.cylinder({ diameter: 5, h: 0.35, x: cx, y, z: cz, mat: hq.concreto, tessellation: 20, collide: true });
  for (const [ox, oz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) b.box({ w: 0.16, h: 2.5, d: 0.16, x: cx + ox, z: cz + oz, y: y + 0.35, mat: hq.branco, collide: true });
  addHipRoof(b, cx - 2.1, cz - 2.1, 4.2, 4.2, y + 2.85, 0.5, hq.telha, 0.5);
  loot(c, cx, y + 0.35, cz, 2);
  banco(c, cx - 4.5, y, cz - 6, false);
  banco(c, cx + 4.5, y, cz + 6, false);
  banco(c, cx, y, q.z0 + 1.2, true);
  for (const [ox, oz] of [[-4.6, 7.5], [4.6, -7.5], [-4.4, -9], [4.4, 9]]) arvore(c, 'ipe', cx + ox, y, cz + oz, 0.6);
  addSign(b, 'PRAÇA DA PRIMAVERA', { x: cx, y: y + 1.5, z: q.z0 - 0.2, width: 4.2, height: 0.8, facing: -1, bg: '#2f7d4a', fg: '#ffffff', board: true });
  loot(c, cx + 4, y, cz - 3, 0);
}

// ------------------------------------------------------------------ Condomínio Bela Vista

/** Piscina: tanque de azulejo cavado no relevo (Terrain.POOLS), deck em volta, escada e a água registrada. */
function piscina(c: Ctx, p: Pool, y: number, deckMat: Material): void {
  const { b } = c;
  const hq = b.mats.hq;
  const w = p.x1 - p.x0;
  const d = p.z1 - p.z0;
  const cx = (p.x0 + p.x1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const top = y + 0.07;
  // Fundo (colisor: é onde se pisa ao afundar) e as quatro paredes.
  b.box({ w: w + 0.6, h: 0.3, d: d + 0.6, x: cx, z: cz, y: p.floor - 0.3, mat: hq.azulejo, tile: 1.2, collide: true });
  const wh = top - p.floor;
  for (const s of [-1, 1]) {
    b.box({ w: w + 0.6, h: wh, d: 0.3, x: cx, z: cz + s * (d / 2 + 0.15), y: p.floor, mat: hq.azulejo, tile: 1.2, collide: true });
    b.box({ w: 0.3, h: wh, d, x: cx + s * (w / 2 + 0.15), z: cz, y: p.floor, mat: hq.azulejo, tile: 1.2, collide: true });
  }
  // Deck em volta (cobre a rampa da cava do relevo).
  const D = 2.7;
  for (const s of [-1, 1]) {
    b.box({ w: w + 0.6 + 2 * D, h: 0.3, d: D, x: cx, z: cz + s * (d / 2 + 0.3 + D / 2), y: top - 0.3, mat: deckMat, tile: 2, collide: true });
    b.box({ w: D, h: 0.3, d: d + 0.6, x: cx + s * (w / 2 + 0.3 + D / 2), z: cz, y: top - 0.3, mat: deckMat, tile: 2, collide: true });
  }
  // Escada de alvenaria dentro da piscina, num canto (para sair andando).
  const alongX = w >= d;
  const rise = top - p.floor - 0.02;
  if (alongX) buildStairs(b, { x: p.x0 + 2.6, z: p.z0 + 0.8, base: p.floor, axis: 'x', dir: -1, run: 2.6, rise, width: 1.5, mat: hq.azulejo, stepHeight: 0.25 });
  else buildStairs(b, { x: p.x0 + 0.8, z: p.z0 + 2.6, base: p.floor, axis: 'z', dir: -1, run: 2.6, rise, width: 1.5, mat: hq.azulejo, stepHeight: 0.25 });
  // Superfície (sem colisão) e o registro para nadar.
  const surf = MeshBuilder.CreateGround(`agua_${p.name}`, { width: w, height: d }, b.scene);
  surf.position.set(cx, p.level, cz);
  b.addMesh(surf, c.agua);
  addWater(boxWater(p.name, p.x0, p.z0, p.x1, p.z1, p.level, p.floor));
  c.out.pools++;
  // Espreguiçadeiras e guarda-sol num dos lados do deck.
  const side = alongX ? cz + d / 2 + 1.7 : cz;
  for (let i = 0; i < 3; i++) {
    const lx = alongX ? p.x0 + 1.5 + i * 2.6 : p.x1 + 1.7;
    const lz = alongX ? side : p.z0 + 1.5 + i * 2.6;
    b.box({ w: alongX ? 0.7 : 1.9, h: 0.3, d: alongX ? 1.9 : 0.7, x: lx, z: lz, y: top, mat: hq.branco, collide: true });
    b.box({ w: alongX ? 0.66 : 1.8, h: 0.06, d: alongX ? 1.8 : 0.66, x: lx, z: lz, y: top + 0.3, mat: hq.tecidos[i % hq.tecidos.length] });
  }
  const ux = alongX ? p.x1 - 1 : p.x1 + 1.7;
  const uz = alongX ? side : p.z1 - 1;
  b.cylinder({ diameter: 0.07, h: 2.3, x: ux, y: top, z: uz, mat: b.mats.metal, tessellation: 6 });
  b.cylinder({ diameter: 2.6, diameterTop: 0.2, h: 0.5, x: ux, y: top + 2.0, z: uz, mat: hq.tecidos[5], tessellation: 10 });
}

/** Garagem aberta (laje sobre quatro pilares) com carros. */
function garagemAberta(c: Ctx, x0: number, z0: number, w: number, d: number, y: number, carRy: number, cars: number): void {
  const { b, rng } = c;
  const hq = b.mats.hq;
  b.box({ w, h: 0.06, d, x: x0 + w / 2, z: z0 + d / 2, y, mat: hq.concreto, tile: 2 });
  for (const [ox, oz] of [[0.2, 0.2], [w - 0.2, 0.2], [0.2, d - 0.2], [w - 0.2, d - 0.2]]) b.box({ w: 0.3, h: 2.7, d: 0.3, x: x0 + ox, z: z0 + oz, y, mat: hq.branco, collide: true });
  b.box({ w: w + 0.8, h: 0.2, d: d + 0.8, x: x0 + w / 2, z: z0 + d / 2, y: y + 2.7, mat: hq.branco, tile: 2.5, collide: true });
  const alongX = Math.abs(Math.cos(carRy)) > 0.5;
  for (let i = 0; i < cars; i++) {
    const k = cars === 1 ? 0 : i === 0 ? -1 : 1;
    addCar(b, rng, x0 + w / 2 + (alongX ? 0 : k * 1.6), z0 + d / 2 + (alongX ? k * 1.5 : 0), carRy, 'comum', y + 0.05);
  }
  loot(c, x0 + w / 2, y, z0 + d / 2 + (alongX ? 0 : 2.4), 1);
}

/** Pórtico de colunas com laje na frente da entrada da mansão. */
function portico(c: Ctx, entry: Vector3, front: Lado, y: number): void {
  const { b } = c;
  const hq = b.mats.hq;
  const zAxis = front === 'z0' || front === 'z1';
  const out = front === 'z0' || front === 'x0' ? -1 : 1;
  // `entry` fica 1,6 m à frente da fachada.
  const cx = zAxis ? entry.x : entry.x + out * 0.3;
  const cz = zAxis ? entry.z + out * 0.3 : entry.z;
  const w = zAxis ? 6.4 : 3.6;
  const d = zAxis ? 3.6 : 6.4;
  b.box({ w, h: 0.1, d, x: cx, z: cz, y, mat: hq.marmore, collide: true });
  for (const k of [-2.9, -1.2, 1.2, 2.9]) {
    const px = zAxis ? cx + k : cx + out * 1.5;
    const pz = zAxis ? cz + out * 1.5 : cz + k;
    b.cylinder({ diameter: 0.42, h: 3.0, x: px, y: y + 0.1, z: pz, mat: hq.branco, tessellation: 12, collide: true });
  }
  b.box({ w: w + 0.4, h: 0.25, d: d + 0.4, x: cx, z: cz, y: y + 3.1, mat: hq.branco, tile: 2.5, collide: true });
}

function buildCondominio(c: Ctx): void {
  const { b, rng } = c;
  const m = b.mats;
  const hq = m.hq;
  const p = poi('CONDOMÍNIO BELA VISTA');
  const y = c.t.height(p.x, p.z);
  const W = { x0: -408, x1: -272, z0: -314, z1: -186 };
  c.out.blocked.push({ x0: W.x0 - 2, x1: W.x1 + 2, z0: W.z0 - 2, z1: W.z1 + 2 });

  // Muro em volta (com o portão na avenida, ao norte) e a portaria.
  const mh = 2.9;
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 34);
    for (let i = 0; i < n; i++) addWall(b, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n, z0 + ((z1 - z0) * (i + 1)) / n, mh + 0.4, hq.branco, y - 0.4);
  };
  wall(W.x0, W.z0, W.x1, W.z0);
  wall(W.x0, W.z0, W.x0, W.z1);
  wall(W.x1, W.z0, W.x1, W.z1);
  wall(W.x0, W.z1, -332, W.z1);
  wall(-320, W.z1, W.x1, W.z1);
  for (const gx of [-332, -320]) b.box({ w: 0.9, h: 3.6, d: 0.9, x: gx, z: W.z1, y, mat: hq.pedra, tile: 2, collide: true });
  b.box({ w: 13.4, h: 0.5, d: 1.1, x: -326, z: W.z1, y: y + 3.6, mat: hq.branco, tile: 2.5 });
  addSign(b, 'CONDOMÍNIO BELA VISTA', { x: -326, y: y + 3.85, z: W.z1 + 0.6, width: 9, height: 0.42, facing: 1, bg: '#f4f0e6', fg: '#2f5a3a', board: false });
  // Guarita: cabine com porta de verdade, janela e cancela levantada.
  {
    const gx0 = -337.5;
    const gz0 = -193;
    const gw = 3.4;
    const gd = 3.2;
    b.box({ w: gw, h: 0.1, d: gd, x: gx0 + gw / 2, z: gz0 + gd / 2, y, mat: hq.piso, tile: 1.2, collide: true });
    b.box({ w: gw, h: 2.6, d: 0.14, x: gx0 + gw / 2, z: gz0, y, mat: hq.branco, tile: 2.5, collide: true });
    b.box({ w: 0.14, h: 2.6, d: gd, x: gx0, z: gz0 + gd / 2, y, mat: hq.branco, tile: 2.5, collide: true });
    b.box({ w: 0.14, h: 1.0, d: gd, x: gx0 + gw, z: gz0 + gd / 2, y, mat: hq.branco, tile: 2.5, collide: true });
    b.box({ w: 0.04, h: 1.3, d: gd - 0.3, x: gx0 + gw, z: gz0 + gd / 2, y: y + 1.0, mat: hq.vidro });
    b.box({ w: 0.14, h: 0.3, d: gd, x: gx0 + gw, z: gz0 + gd / 2, y: y + 2.3, mat: hq.branco, tile: 2.5 });
    b.collider(0.14, 1.6, gd, gx0 + gw, y + 1.8, gz0 + gd / 2);
    // Parede norte com a porta.
    b.box({ w: gw - 1.3, h: 2.6, d: 0.14, x: gx0 + (gw - 1.3) / 2, z: gz0 + gd, y, mat: hq.branco, tile: 2.5, collide: true });
    b.box({ w: 1.3, h: 0.42, d: 0.14, x: gx0 + gw - 0.65, z: gz0 + gd, y: y + 2.18, mat: hq.branco, tile: 2.5, collide: true });
    c.out.doors += makeDoor(b, { x: gx0 + gw - 0.7, y: y + 0.1, z: gz0 + gd, axis: 'x', width: 0.9, height: 2.0, leaf: hq.madeiraEscura, wallT: 0.14 }).length;
    b.box({ w: gw + 0.8, h: 0.16, d: gd + 0.8, x: gx0 + gw / 2, z: gz0 + gd / 2, y: y + 2.6, mat: hq.telhaVerde, tile: 1.6, collide: true });
    b.box({ w: 1.2, h: 0.75, d: 0.5, x: gx0 + 1.0, z: gz0 + 0.5, y: y + 0.1, mat: hq.madeiraEscura, collide: true });
    loot(c, gx0 + 1.6, y + 0.1, gz0 + 1.9, 1);
    b.box({ w: 0.25, h: 1.1, d: 0.25, x: -331, z: -190, y, mat: m.metalDark, collide: true });
    b.box({ w: 0.1, h: 0.1, d: 4.6, x: -331, z: -190 + 0.3, cy: y + 3.0, mat: m.roadLine, rx: -1.2 });
  }

  // Ruas internas: avenida do portão para o sul e a transversal.
  rua(c, 'z', -250, W.z1 - 0.5, -326, y, [[-255.3, -244.7]], 0.056);
  rua(c, 'x', -400, -280, -250, y, [[-331.3, -320.7]]);
  for (const [px, pz, dx, dz] of [[-331.5, -205, 1, 0], [-320.5, -228, -1, 0], [-352, -244.5, 0, -1], [-380, -255.5, 0, 1], [-300, -244.5, 0, -1]] as const) poste(c, px, y, pz, dx, dz);
  loot(c, -326, y, -250, 1);

  // Sebes ao longo das ruas (com vãos nas entradas de cada casa).
  sebe(c, -333, -244.2, -333, -192, y);
  sebe(c, -400, -244.2, -384, -244.2, y);
  sebe(c, -376, -244.2, -333, -244.2, y);
  sebe(c, -319, -244.2, -319, -222, y);
  sebe(c, -319, -214, -319, -196, y);
  sebe(c, -319, -244.2, -280, -244.2, y);
  sebe(c, -319, -255.8, -305.5, -255.8, y);
  sebe(c, -297.5, -255.8, -280, -255.8, y);
  sebe(c, -319, -255.8, -319, -308, y);

  const mansao = (x0: number, z0: number, w: number, d: number, front: Lado, style: CasaStyle) => {
    const r = casa(c, { x0, z0, w, d, y, front, tipo: 'mansao', style, lootChance: 0.85 });
    portico(c, r.entry, front, y);
    return r;
  };
  const base = { interno: hq.branco, piso: hq.porcelanato, pisoQuarto: hq.madeiraEscura, rico: true } as const;

  // --- Vila Branca (noroeste): branca de telhado verde de quatro águas, piscina e quadra de tênis.
  const a = mansao(-392, -236, 24, 14, 'z0', { ...base, parede: hq.branco, telha: hq.telhaVerde, telhado: 'quatro', porta: hq.madeiraEscura });
  b.box({ w: 2.2, h: 0.05, d: Math.abs(a.entry.z + 244.2), x: a.entry.x, z: (a.entry.z - 244.2) / 2, y, mat: hq.pedra, tile: 2 });
  piscina(c, POOLS[0], y, hq.pedra);
  garagemAberta(c, -363.5, -235, 7, 6.2, y, Math.PI / 2, 2);
  b.box({ w: 3.4, h: 0.05, d: 9.4, x: -360, z: -239.6, y, mat: hq.concreto, tile: 2 });
  // Quadra de tênis de saibro com rede e alambrado.
  {
    const tx = -348;
    const tz = -205;
    b.box({ w: 17, h: 0.05, d: 31, x: tx, z: tz, y, mat: hq.saibro, tile: 4 });
    const line = (lw: number, ld: number, ox: number, oz: number) => b.box({ w: lw, h: 0.012, d: ld, x: tx + ox, z: tz + oz, y: y + 0.05, mat: m.roadWhite });
    for (const s of [-1, 1]) {
      line(0.08, 23.8, s * 5.48, 0);
      line(0.08, 23.8, s * 4.11, 0);
      line(10.97, 0.08, 0, s * 11.88);
      line(8.23, 0.08, 0, s * 6.4);
    }
    line(0.08, 12.8, 0, 0);
    b.box({ w: 12.4, h: 0.95, d: 0.04, x: tx, z: tz, y: y + 0.05, mat: m.fence, tile: 1, collide: true });
    for (const s of [-1, 1]) b.cylinder({ diameter: 0.1, h: 1.1, x: tx + s * 6.3, y, z: tz, mat: m.metalDark, tessellation: 6 });
    for (const s of [-1, 1]) {
      b.box({ w: 17, h: 3.2, d: 0.05, x: tx, z: tz + s * 15.5, y, mat: m.fence, tile: 1.5, collide: true });
      if (s > 0) b.box({ w: 0.05, h: 3.2, d: 31, x: tx + s * 8.5, z: tz, y, mat: m.fence, tile: 1.5, collide: true });
      else {
        b.box({ w: 0.05, h: 3.2, d: 13.5, x: tx - 8.5, z: tz - 8.75, y, mat: m.fence, tile: 1.5, collide: true });
        b.box({ w: 0.05, h: 3.2, d: 13.5, x: tx - 8.5, z: tz + 8.75, y, mat: m.fence, tile: 1.5, collide: true });
      }
    }
    banco(c, tx - 7.4, y, tz + 5, false);
    loot(c, tx + 3, y, tz + 8, 1);
    loot(c, tx - 3, y, tz - 9, 0);
  }
  for (const [ox, oz, g, s] of [[-400, -238, 'ipe', 0.8], [-402, -200, 'comum', 0.9], [-372, -194, 'ipe', 0.75], [-366, -208, 'comum', 0.8], [-398, -222, 'comum', 0.8]] as const) arvore(c, g, ox, y, oz, s);
  loot(c, -384, y, -216.5, 1);

  // --- Casa bege (nordeste): telha de barro, piscina ao lado, frente para a avenida.
  const bb = mansao(-312, -228, 13, 20, 'x0', { ...base, parede: hq.bege, parede2: hq.branco, telha: hq.telha, telhado: 'quatro', porta: hq.madeira, pisoQuarto: hq.madeira });
  b.box({ w: Math.abs(bb.entry.x + 319), h: 0.05, d: 2.2, x: (bb.entry.x - 319) / 2, z: bb.entry.z, y, mat: hq.pedra, tile: 2 });
  piscina(c, POOLS[1], y, hq.calcada);
  garagemAberta(c, -309.5, -201, 7, 6.2, y, 0, 2);
  b.box({ w: 10, h: 0.05, d: 3.4, x: -314.5, z: -205, y, mat: hq.concreto, tile: 2 });
  for (const [ox, oz, g, s] of [[-278, -192, 'ipe', 0.8], [-280, -238, 'comum', 0.8], [-296, -236, 'comum', 0.8], [-316, -192, 'comum', 0.7]] as const) arvore(c, g, ox, y, oz, s);
  loot(c, -290, y, -206, 1);

  // --- Casa moderna (sudeste): cinza de laje, panos de vidro, piscina nos fundos.
  const cc = mansao(-312, -281, 21, 13, 'z1', { ...base, parede: hq.cinzaClaro, parede2: hq.branco, telha: hq.telhaGrafite, telhado: 'laje', porta: hq.branco, piso: hq.madeira });
  b.box({ w: 2.2, h: 0.05, d: Math.abs(cc.entry.z + 255.8), x: cc.entry.x, z: (cc.entry.z - 255.8) / 2, y, mat: hq.pedra, tile: 2 });
  piscina(c, POOLS[2], y, c.tabua);
  garagemAberta(c, -285.5, -275.5, 7, 6.2, y, Math.PI / 2, 2);
  for (const [ox, oz, g, s] of [[-278, -306, 'comum', 0.9], [-314, -306, 'ipe', 0.8], [-280, -262, 'comum', 0.8], [-316, -262, 'ipe', 0.7]] as const) arvore(c, g, ox, y, oz, s);
  loot(c, -302, y, -290, 1);

  // --- Parque do lago (sudoeste): ponte de madeira em arco, chorões, coreto e bancos.
  const lake = LAKES.find((l) => l.name === 'LAGO DO CONDOMÍNIO')!;
  {
    const bz = lake.z + 13;
    const half = Math.sqrt(lake.r * lake.r - 13 * 13) + 3;
    const n = 8;
    const x0 = lake.x - half;
    const span = 2 * half;
    const arc = (u: number) => y + 0.05 + 1.3 * Math.sin(Math.PI * u);
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const dx = span / n;
      const dy = arc(u1) - arc(u0);
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const mx = x0 + span * (u0 + u1) / 2;
      const my = (arc(u0) + arc(u1)) / 2;
      b.box({ w: len + 0.05, h: 0.16, d: 2.4, x: mx, z: bz, cy: my - 0.08, mat: c.tabua, tile: 1.2, rz: ang, collide: true });
      for (const s of [-1, 1]) {
        b.box({ w: len + 0.05, h: 0.08, d: 0.08, x: mx, z: bz + s * 1.14, cy: my + 0.95, mat: c.tabua, tile: 1, rz: ang });
        b.box({ w: 0.1, h: 1.0, d: 0.1, x: x0 + span * u0, z: bz + s * 1.14, y: arc(u0) - 0.05, mat: c.tabua, tile: 0.6 });
        b.collider(len, 1.0, 0.1, mx, my + 0.5, bz + s * 1.14, 0, 0, ang);
      }
    }
    for (const s of [-1, 1]) b.box({ w: 0.1, h: 1.0, d: 0.1, x: x0 + span, z: bz + s * 1.14, y: y, mat: c.tabua, tile: 0.6 });
    // Pilares na água.
    for (const u of [0.3, 0.5, 0.7]) for (const s of [-1, 1]) b.cylinder({ diameter: 0.22, h: arc(u) - lake.level + 2.2, x: x0 + span * u, y: lake.level - 2.3, z: bz + s * 0.9, mat: m.bark, tessellation: 7 });
    loot(c, lake.x, arc(0.5), bz, 2);
    // Chorões na margem (do lado de dentro do muro).
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.35;
      const wx = lake.x + Math.cos(ang) * (lake.r + 3.5);
      const wz = lake.z + Math.sin(ang) * (lake.r + 3.5);
      if (wx < W.x0 + 4 || wz < W.z0 + 4 || Math.abs(wz - bz) < 3.5) continue;
      chorao(c, wx, y, wz, rng.range(0.9, 1.15));
    }
    // Coreto de telhado verde e bancos de frente para o lago.
    const gx = -340;
    const gz = -300;
    b.cylinder({ diameter: 6.4, h: 0.3, x: gx, y, z: gz, mat: hq.pedra, tessellation: 8, collide: true });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      b.cylinder({ diameter: 0.24, h: 2.7, x: gx + Math.cos(ang) * 2.7, y: y + 0.3, z: gz + Math.sin(ang) * 2.7, mat: hq.branco, tessellation: 8, collide: true });
    }
    addHipRoof(b, gx - 3, gz - 3, 6, 6, y + 3.0, 0.5, hq.telhaVerde, 0.5);
    loot(c, gx, y + 0.3, gz, 2);
    banco(c, lake.x + lake.r + 5, y, lake.z - 4, false);
    banco(c, lake.x - 6, y, lake.z + lake.r + 9, true);
    b.box({ w: 2, h: 0.05, d: 36, x: -348, z: -273, y, mat: hq.pedra, tile: 2 });
    for (const [ox, oz, g, s] of [[-400, -262, 'comum', 0.9], [-386, -260, 'ipe', 0.8], [-402, -306, 'comum', 0.8], [-332, -282, 'ipe', 0.7], [-336, -264, 'comum', 0.8]] as const) arvore(c, g, ox, y, oz, s);
    if (natureReady()) for (let i = 0; i < 14; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = lake.r + rng.range(1.5, 6);
      const fx = lake.x + Math.cos(ang) * r;
      const fz = lake.z + Math.sin(ang) * r;
      if (fx < W.x0 + 2 || fz < W.z0 + 2 || Math.abs(fz - bz) < 2.5) continue;
      placeNatureFrom(b, rng, rng.chance(0.5) ? 'flor' : 'planta', fx, c.t.height(fx, fz) - 0.03, fz, rng.range(0.6, 1));
    }
  }
}

// ------------------------------------------------------------------ Fazenda Santa Luzia

function buildFazenda(c: Ctx): void {
  const { b, rng } = c;
  const m = b.mats;
  const hq = m.hq;
  const p = poi('FAZENDA SANTA LUZIA');
  const y = c.t.height(p.x, p.z);
  const H = (x: number, z: number) => c.t.height(x, z);
  const block = (x0: number, z0: number, x1: number, z1: number) => c.out.blocked.push({ x0, x1, z0, z1 });

  // Sede: casa térrea branca de janelas azuis, telhado de duas águas e varanda na frente.
  const sede = casa(c, {
    x0: -324, z0: 284, w: 11, d: 17, y, front: 'x1', tipo: 'terrea', garagem: false, lootChance: 0.8,
    style: { parede: hq.branco, interno: hq.bege, telha: hq.telha, telhado: 'quatro', piso: hq.madeira, pisoQuarto: hq.madeira, porta: hq.paint(3), rico: false },
  });
  block(-327, 281, -306, 304);
  // Varanda: piso, esteios de madeira e meia-água de telha.
  b.box({ w: 3, h: 0.1, d: 17.6, x: -311.5, z: 292.5, y, mat: hq.piso, tile: 1.2, collide: true });
  for (let i = 0; i <= 4; i++) b.box({ w: 0.16, h: 2.6, d: 0.16, x: -310.2, z: 284 + i * 4.25, y: y + 0.1, mat: c.tabua, tile: 0.6, collide: true });
  b.box({ w: 3.6, h: 0.08, d: 18, x: -311.4, z: 292.5, cy: y + 2.95, mat: hq.telha, tile: 1.6, rz: -0.14 });
  banco(c, -312.3, y + 0.1, 289, false);
  loot(c, -311, y + 0.1, 298, 0);
  void sede;

  // Celeiro vermelho: portão duplo de verdade, baias, fardos de feno e um mezanino com escada.
  {
    const x0 = -294;
    const x1 = -282;
    const z0 = 312;
    const z1 = 330;
    const cx = (x0 + x1) / 2;
    const wh = 4.6;
    const wallM = c.tabuaVermelha;
    block(x0 - 2, z0 - 4, x1 + 2, z1 + 2);
    b.box({ w: x1 - x0, h: 0.08, d: z1 - z0, x: cx, z: (z0 + z1) / 2, y, mat: hq.terra, tile: 4, collide: true });
    for (const x of [x0, x1]) b.box({ w: 0.2, h: wh, d: z1 - z0, x, z: (z0 + z1) / 2, y, mat: wallM, tile: 1.4, collide: true });
    b.box({ w: x1 - x0, h: wh, d: 0.2, x: cx, z: z1, y, mat: wallM, tile: 1.4, collide: true });
    for (const s of [-1, 1]) b.box({ w: (x1 - x0 - 3.3) / 2, h: wh, d: 0.2, x: cx + s * ((x1 - x0 - 3.3) / 4 + 1.65), z: z0, y, mat: wallM, tile: 1.4, collide: true });
    b.box({ w: 3.3, h: wh - 3.1, d: 0.2, x: cx, z: z0, y: y + 3.1, mat: wallM, tile: 1.4, collide: true });
    c.out.doors += makeDoor(b, { x: cx, y: y + 0.08, z: z0, axis: 'x', width: 3.1, height: 3.0, leaf: hq.branco, frame: hq.branco, double: true, swing: -1, wallT: 0.2 }).length;
    addRoof(b, { x0, z0, w: x1 - x0, d: z1 - z0, y: y + wh, kind: 'duas', drain: 1, telha: hq.telhaGrafite, tile: 1.6, pitch: 0.5, gable: wallM });
    // Baias.
    for (let i = 0; i < 3; i++) {
      const bz = z0 + 4 + i * 3.4;
      b.box({ w: 3.6, h: 1.3, d: 0.12, x: x0 + 1.9, z: bz, y, mat: c.tabua, tile: 1, collide: true });
    }
    // Fardos de feno.
    for (const [ox, oz, n] of [[4, 14, 3], [-4.2, 15.6, 2], [3.6, 3, 2]] as const) for (let k = 0; k < n; k++) b.box({ w: 1.3, h: 0.7, d: 0.8, x: cx + ox + (k % 2) * 0.2, z: z0 + oz, y: y + 0.08 + k * 0.7, mat: m.sack, tile: 1, collide: true });
    // Mezanino no fundo, com escada encostada na parede leste.
    b.box({ w: x1 - x0 - 0.4, h: 0.16, d: 5, x: cx, z: z1 - 2.6, y: y + 2.6, mat: c.tabua, tile: 1.2, collide: true });
    buildStairs(b, { x: x1 - 0.8, z: z1 - 5.1 - 3.8, base: y + 0.08, axis: 'z', dir: 1, run: 3.8, rise: 2.68, width: 1.1, mat: c.tabua });
    loot(c, cx - 2, y + 2.76, z1 - 2.5, 2);
    loot(c, cx + 1, y + 0.08, z0 + 8, 1);
    loot(c, x0 + 1.8, y + 0.08, z0 + 5.6, 0);
  }

  // Silo de chapa com cobertura cônica e escada de mão.
  {
    const sx = -274;
    const sz = 318;
    b.cylinder({ diameter: 5.2, h: 10, x: sx, y, z: sz, mat: hq.cinzaClaro, tessellation: 18, collide: true });
    b.cylinder({ diameter: 5.6, diameterTop: 0.5, h: 2.2, x: sx, y: y + 10, z: sz, mat: hq.telhaGrafite, tessellation: 18 });
    for (let k = 0; k < 4; k++) b.cylinder({ diameter: 5.3, h: 0.12, x: sx, y: y + 2 + k * 2.4, z: sz, mat: hq.calha, tessellation: 18 });
    for (const s of [-1, 1]) b.box({ w: 0.05, h: 10, d: 0.05, x: sx + s * 0.25, z: sz - 2.66, y, mat: m.metalDark });
    for (let k = 1; k < 25; k++) b.box({ w: 0.5, h: 0.04, d: 0.04, x: sx, z: sz - 2.66, y: y + k * 0.4, mat: m.metalDark });
    block(sx - 4, sz - 4, sx + 4, sz + 4);
    loot(c, sx, y, sz - 4.2, 1);
  }

  // Curral cercado, com cocho e bebedouro; galinheiro; horta em canteiros.
  {
    const x0 = -302;
    const x1 = -276;
    const z0 = 338;
    const z1 = 358;
    const yc = (x: number, z: number) => Math.min(H(x, z), y + 0.6);
    for (let x = x0; x < x1; x += 6.5) {
      const xe = Math.min(x1, x + 6.5);
      if (!(x <= -290 && xe > -290)) cerca(c, x, z0, xe, z0, yc((x + xe) / 2, z0));
      cerca(c, x, z1, xe, z1, yc((x + xe) / 2, z1));
    }
    for (let z = z0; z < z1; z += 5) {
      cerca(c, x0, z, x0, z + 5, yc(x0, z + 2.5));
      cerca(c, x1, z, x1, z + 5, yc(x1, z + 2.5));
    }
    b.box({ w: 3.2, h: 0.5, d: 0.7, x: -284, z: 352, y: yc(-284, 352), mat: c.tabua, tile: 1, collide: true });
    b.box({ w: 2, h: 0.55, d: 1, x: -296, z: 354, y: yc(-296, 354), mat: hq.concreto, tile: 2, collide: true });
    block(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    loot(c, -288, yc(-288, 348), 348, 0);
  }
  {
    // Galinheiro: casinha de tábua com tela.
    const gx = -306;
    const gz = 318;
    b.box({ w: 3, h: 1.9, d: 2.4, x: gx, z: gz, y, mat: c.tabua, tile: 1.2, collide: true });
    b.box({ w: 3.6, h: 0.08, d: 3, x: gx, z: gz, cy: y + 2.1, mat: hq.fibrocimento, tile: 1.1, rz: 0.15 });
    for (const s of [-1, 1]) b.box({ w: 4, h: 1.6, d: 0.04, x: gx, z: gz + 1.2 + (s > 0 ? 3 : 0), y, mat: m.fence, tile: 1, collide: s > 0 });
    for (const s of [-1, 1]) b.box({ w: 0.04, h: 1.6, d: 3, x: gx + s * 2, z: gz + 2.7, y, mat: m.fence, tile: 1, collide: true });
    block(gx - 3, gz - 2, gx + 3, gz + 5);
  }
  for (let i = 0; i < 7; i++) b.box({ w: 14, h: 0.2, d: 0.9, x: -318, z: 310 + i * 1.7, y: H(-318, 310 + i * 1.7) - 0.02, mat: m.chaoMata, tile: 3 });
  block(-326, 308, -310, 322);
  if (natureReady()) for (let i = 0; i < 40; i++) placeNatureFrom(b, rng, 'planta', -324.5 + (i % 10) * 1.45, y + 0.12, 310 + Math.floor(i / 10) * 3.4, rng.range(0.4, 0.6));

  // Porteira na chegada da estrada, cerca da frente, caminhonete e o trator (picape) no pátio.
  for (const s of [-1, 1]) b.box({ w: 0.3, h: 3.4, d: 0.3, x: -279 + s * 0, z: 283 + s * 3.4, y: H(-279, 283 + s * 3.4) - 0.2, mat: c.tabua, tile: 0.6, collide: true });
  b.box({ w: 0.3, h: 0.3, d: 7.1, x: -279, z: 283, y: y + 3.1, mat: c.tabua, tile: 1 });
  addSign(b, 'FAZENDA SANTA LUZIA', { x: -278.8, y: y + 2.6, z: 283, width: 5.6, height: 0.6, facing: 1, bg: '#6b4a2a', fg: '#fff3d6', board: false });
  addCar(b, rng, -300, 302, 0.3, 'comum', y);
  for (const [ox, oz] of [[-298, 308], [-297.2, 308.5], [-286, 309]]) placeTextured(b, 'barril', ox, y, oz, rng.range(0, 6), 1, [0.6, 0.88]);
  block(-304, 298, -296, 306);
  loot(c, -296, y, 296, 1);
  loot(c, -330, y, 318, 0);
  // Píer do açude.
  const pond = LAKES.find((l) => l.name === 'AÇUDE DA FAZENDA');
  if (pond) {
    const px = pond.x + pond.r - 6;
    b.box({ w: 10, h: 0.14, d: 1.8, x: px + 2, z: pond.z, y: pond.level + 0.3, mat: c.tabua, tile: 1.2, collide: true });
    for (let k = 0; k <= 8; k += 4) for (const s of [-1, 1]) b.cylinder({ diameter: 0.16, h: 2.6, x: px - 2 + k, y: pond.level - 2.1, z: pond.z + s * 0.8, mat: m.bark, tessellation: 7 });
    loot(c, px - 2, pond.level + 0.44, pond.z, 1);
  }
}

// ------------------------------------------------------------------ Serra Grande, Lagoa da Serra e Mata Fechada

/** Barraca de acampamento (prisma de lona). */
function barraca(c: Ctx, x: number, y: number, z: number, ry: number, mat: Material): void {
  c.b.extrude([[-1.2, 0], [1.2, 0], [0, 1.45]], 2.6, mat, x, y, z, ry);
  c.b.collider(2.0, 1.1, 2.4, x, y + 0.55, z, 0, ry, 0);
}

/** Fogueira apagada: pedras em roda e toras. */
function fogueira(c: Ctx, x: number, y: number, z: number): void {
  const { b } = c;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box({ w: 0.34, h: 0.22, d: 0.28, x: x + Math.cos(a) * 0.7, z: z + Math.sin(a) * 0.7, y: y - 0.04, mat: b.mats.hq.pedra, ry: a, tile: 1 });
  }
  for (const a of [0.3, 1.5, 2.6]) b.box({ w: 1.0, h: 0.14, d: 0.14, x, z, y: y + 0.02, mat: b.mats.barkLog, ry: a });
  for (const [ox, oz, ry] of [[2, 0.4, 1.4], [-1.6, 1.4, 0.4]] as const) {
    b.box({ w: 1.8, h: 0.4, d: 0.42, x: x + ox, z: z + oz, y, mat: b.mats.barkLog, ry, collide: true });
  }
}

/** Torre de observação de madeira: plataforma coberta a `h` m, com escada. */
function torre(c: Ctx, x: number, z: number, h: number, dir: 1 | -1): number {
  const { b } = c;
  const H = (px: number, pz: number) => c.t.height(px, pz);
  const y = Math.min(H(x - 1.6, z - 1.6), H(x + 1.6, z - 1.6), H(x - 1.6, z + 1.6), H(x + 1.6, z + 1.6));
  const top = Math.max(H(x, z), y) + h;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box({ w: 0.24, h: top + 2.3 - y + 1, d: 0.24, x: x + sx * 1.6, z: z + sz * 1.6, y: y - 1, mat: c.tabua, tile: 0.6, collide: true });
  b.box({ w: 3.8, h: 0.16, d: 3.8, x, z, y: top - 0.16, mat: c.tabua, tile: 1.2, collide: true });
  // Guarda-corpo (aberto no lado da escada).
  for (const sz of [-1, 1]) {
    b.box({ w: 3.6, h: 0.08, d: 0.08, x, z: z + sz * 1.75, y: top + 0.95, mat: c.tabua, tile: 1 });
    b.collider(3.6, 1.0, 0.1, x, top + 0.5, z + sz * 1.75);
  }
  b.box({ w: 0.08, h: 0.08, d: 3.6, x: x - dir * 1.75, z, y: top + 0.95, mat: c.tabua, tile: 1 });
  b.collider(0.1, 1.0, 3.6, x - dir * 1.75, top + 0.5, z);
  addHipRoof(b, x - 1.9, z - 1.9, 3.8, 3.8, top + 2.3, 0.45, c.tabua, 0.4);
  // Escada reta chegando na beirada da plataforma.
  const run = h * 1.25;
  const bx = x + dir * (1.9 + run);
  const by = H(bx, z);
  buildStairs(b, { x: bx, z, base: by - 0.1, axis: 'x', dir: -dir as 1 | -1, run, rise: top - by + 0.1, width: 1.2, mat: c.tabua, rails: { left: true, right: true } });
  return top;
}

/** Degraus de pedra da porta até o chão quando a casa fica acima do terreno. */
function acesso(c: Ctx, entry: Vector3, front: Lado, yFloor: number): void {
  const zAxis = front === 'z0' || front === 'z1';
  const out = front === 'z0' || front === 'x0' ? -1 : 1;
  const run = 2.2;
  // `entry` fica 1,6 m à frente da fachada; a soleira tem 0,9 m.
  const sx = zAxis ? entry.x : entry.x - out * 0.7 + out * run;
  const sz = zAxis ? entry.z - out * 0.7 + out * run : entry.z;
  const ground = c.t.height(sx, sz);
  const rise = yFloor - ground;
  if (rise < 0.2) return;
  buildStairs(c.b, { x: sx, z: sz, base: ground - 0.05, axis: zAxis ? 'z' : 'x', dir: -out as 1 | -1, run, rise: rise + 0.05, width: 1.6, mat: c.b.mats.hq.pedra });
}

function buildSerra(c: Ctx): void {
  const { b, rng } = c;
  const hq = b.mats.hq;
  const H = (x: number, z: number) => c.t.height(x, z);
  const p = poi('SERRA GRANDE');
  // Refúgio de montanha no cume: casa de pedra com alicerce, de frente para o norte (a ilha).
  {
    const x0 = p.x - 4.5;
    const z0 = p.z - 6;
    const w = 9;
    const d = 9.5;
    let y = -Infinity;
    for (const [ox, oz] of [[0, 0], [w, 0], [0, d], [w, d], [w / 2, d / 2]]) y = Math.max(y, H(x0 + ox, z0 + oz));
    const r = casa(c, {
      x0, z0, w, d, y: y + 0.05, front: 'z1', tipo: 'terrea', fundacao: 3, lootChance: 1,
      style: { parede: hq.pedra, interno: hq.bege, telha: hq.telhaGrafite, telhado: 'duas', piso: hq.madeira, pisoQuarto: hq.madeira, porta: hq.madeiraEscura, rico: false },
    });
    acesso(c, r.entry, 'z1', y + 0.05);
    c.out.used.push([p.x, p.z, 10]);
    c.out.blocked.push({ x0: x0 - 2, x1: x0 + w + 2, z0: z0 - 2, z1: z0 + d + 4 });
    addSign(b, 'REFÚGIO DA SERRA', { x: p.x, y: y + 2.75, z: z0 + d + 0.25, width: 3.6, height: 0.5, facing: 1, bg: '#4a3b2a', fg: '#fff3d6', board: false });
  }
  // Torre de observação e acampamento ao lado.
  {
    const tx = p.x + 16;
    const tz = p.z + 6;
    const top = torre(c, tx, tz, 6, 1);
    loot(c, tx, top, tz, 2);
    c.out.used.push([tx + 4, tz, 9]);
    c.out.blocked.push({ x0: tx - 3, x1: tx + 12, z0: tz - 3, z1: tz + 3 });
    const cx = p.x - 14;
    const cz = p.z + 10;
    fogueira(c, cx, H(cx, cz), cz);
    barraca(c, cx - 4, H(cx - 4, cz + 1), cz + 1, 0.3, hq.tecidos[5]);
    barraca(c, cx + 1, H(cx + 1, cz - 4.5), cz - 4.5, 1.7, hq.tecidos[2]);
    loot(c, cx + 1.5, H(cx + 1.5, cz + 1.5), cz + 1.5, 1);
    loot(c, cx - 4, H(cx - 4, cz + 3.4), cz + 3.4, 0);
    c.out.used.push([cx, cz, 8]);
    c.out.blocked.push({ x0: cx - 7, x1: cx + 4, z0: cz - 7, z1: cz + 4 });
  }
  // Mirante de pedra na encosta norte, com banco e luneta.
  {
    const mx = p.x - 6;
    const mz = p.z + 30;
    const y = Math.max(H(mx - 3, mz - 3), H(mx + 3, mz - 3), H(mx - 3, mz + 3), H(mx + 3, mz + 3)) + 0.1;
    b.box({ w: 7, h: 4, d: 7, x: mx, z: mz, y: y - 4, mat: hq.pedra, tile: 2, collide: true });
    for (const s of [-1, 1]) b.box({ w: 0.2, h: 0.9, d: 7, x: mx + s * 3.4, z: mz, y, mat: hq.pedra, tile: 2, collide: true });
    b.box({ w: 7, h: 0.9, d: 0.2, x: mx, z: mz + 3.4, y, mat: hq.pedra, tile: 2, collide: true });
    banco(c, mx, y, mz - 1.5, true);
    b.cylinder({ diameter: 0.1, h: 1.3, x: mx + 2, y, z: mz + 2.4, mat: b.mats.metalDark, tessellation: 6 });
    b.box({ w: 0.16, h: 0.16, d: 0.6, x: mx + 2, z: mz + 2.4, y: y + 1.3, mat: b.mats.metalDark, rx: 0.2 });
    loot(c, mx - 1.5, y, mz + 1.5, 1);
    c.out.used.push([mx, mz, 6]);
    c.out.blocked.push({ x0: mx - 4, x1: mx + 4, z0: mz - 4, z1: mz + 4 });
  }
  // Lagoa da Serra: rancho de pesca (cabana pequena) e píer.
  {
    const l = LAKES.find((q) => q.name === 'LAGOA DA SERRA')!;
    const px = l.x - l.r + 5;
    b.box({ w: 12, h: 0.14, d: 2, x: px, z: l.z, y: l.level + 0.3, mat: c.tabua, tile: 1.2, collide: true });
    for (let k = -4; k <= 4; k += 4) for (const s of [-1, 1]) b.cylinder({ diameter: 0.16, h: 3, x: px + k, y: l.level - 2.5, z: l.z + s * 0.9, mat: b.mats.bark, tessellation: 7 });
    loot(c, px + 4.5, l.level + 0.44, l.z, 2);
    const hx = l.x - l.r - 14;
    const hz = l.z + 6;
    let y = -Infinity;
    for (const [ox, oz] of [[0, 0], [6.4, 0], [0, 7.5], [6.4, 7.5]]) y = Math.max(y, H(hx + ox, hz + oz));
    const r = casa(c, {
      x0: hx, z0: hz, w: 6.4, d: 7.5, y: y + 0.05, front: 'x1', tipo: 'terrea', fundacao: 2.5, lootChance: 1,
      style: { parede: c.tabua, interno: c.tabua, telha: hq.telha, telhado: 'duas', piso: hq.madeira, pisoQuarto: hq.madeira, porta: hq.madeiraEscura, rico: false },
    });
    acesso(c, r.entry, 'x1', y + 0.05);
    c.out.used.push([hx + 3, hz + 4, 8]);
    c.out.blocked.push({ x0: hx - 2, x1: hx + 10, z0: hz - 2, z1: hz + 9.5 });
    void rng;
  }
}

function buildMata(c: Ctx): void {
  const { b } = c;
  const hq = b.mats.hq;
  const H = (x: number, z: number) => c.t.height(x, z);
  // Cabana do caçador no fim da trilha.
  {
    const x0 = 274;
    const z0 = 372;
    const w = 7.6;
    const d = 9;
    let y = -Infinity;
    for (const [ox, oz] of [[0, 0], [w, 0], [0, d], [w, d], [w / 2, d / 2]]) y = Math.max(y, H(x0 + ox, z0 + oz));
    const r = casa(c, {
      x0, z0, w, d, y: y + 0.05, front: 'x0', tipo: 'terrea', fundacao: 3, lootChance: 1,
      style: { parede: c.tabua, interno: c.tabua, telha: hq.telhaGrafite, telhado: 'duas', piso: hq.madeira, pisoQuarto: hq.madeira, porta: hq.madeiraEscura, rico: false },
    });
    acesso(c, r.entry, 'x0', y + 0.05);
    c.out.used.push([x0 + w / 2, z0 + d / 2, 9]);
    c.out.blocked.push({ x0: x0 - 5, x1: x0 + w + 2, z0: z0 - 2, z1: z0 + d + 2 });
  }
  // Acampamento numa clareira ao lado da trilha.
  {
    const cx = 238;
    const cz = 300;
    fogueira(c, cx, H(cx, cz), cz);
    barraca(c, cx - 4.5, H(cx - 4.5, cz + 1), cz + 1, 0.2, hq.tecidos[2]);
    barraca(c, cx + 0.5, H(cx + 0.5, cz + 5), cz + 5, 1.5, hq.tecidos[0]);
    barraca(c, cx + 4.5, H(cx + 4.5, cz - 2), cz - 2, 2.8, hq.tecidos[5]);
    for (const [ox, oz] of [[-2, -4], [-1.2, -4.4], [3, 3]]) placeTextured(b, 'barril', cx + ox, H(cx + ox, cz + oz), cz + oz, 1, 1, [0.6, 0.88]);
    loot(c, cx + 1.6, H(cx + 1.6, cz - 1.4), cz - 1.4, 1);
    loot(c, cx - 4.5, H(cx - 4.5, cz + 3.4), cz + 3.4, 1);
    loot(c, cx + 5.5, H(cx + 5.5, cz + 1.2), cz + 1.2, 0);
    c.out.used.push([cx, cz, 10]);
    c.out.blocked.push({ x0: cx - 8, x1: cx + 8, z0: cz - 7, z1: cz + 8 });
  }
  // Torre de observação no alto do morro da mata.
  {
    const tx = 250;
    const tz = 336;
    const top = torre(c, tx, tz, 7, -1);
    loot(c, tx, top, tz, 2);
    c.out.used.push([tx - 5, tz, 10]);
    c.out.blocked.push({ x0: tx - 13, x1: tx + 3, z0: tz - 3, z1: tz + 3 });
  }
  // Ruína de pedra coberta de mato (paredes quebradas) mais ao fundo.
  {
    const rx = 212;
    const rz = 356;
    const y = Math.min(H(rx - 4, rz - 3), H(rx + 4, rz - 3), H(rx - 4, rz + 3), H(rx + 4, rz + 3)) - 0.6;
    const top = Math.max(H(rx - 4, rz - 3), H(rx + 4, rz - 3), H(rx - 4, rz + 3), H(rx + 4, rz + 3));
    const hs = [2.8, 1.6, 2.2, 0.9, 3.1, 1.2];
    let k = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) b.box({ w: 2.6, h: top - y + hs[k++ % 6], d: 0.5, x: rx - 2.7 + i * 2.7, z: rz + s * 3, y, mat: hq.pedra, tile: 2, collide: true });
      b.box({ w: 0.5, h: top - y + hs[k++ % 6], d: s > 0 ? 6 : 2.4, x: rx + s * 4.2, z: rz + (s > 0 ? 0 : -1.8), y, mat: hq.pedra, tile: 2, collide: true });
    }
    loot(c, rx, H(rx, rz), rz, 2);
    loot(c, rx + 6, H(rx + 6, rz + 5), rz + 5, 0);
    c.out.used.push([rx, rz, 7]);
    c.out.blocked.push({ x0: rx - 5, x1: rx + 5, z0: rz - 4, z1: rz + 4 });
  }
}
