import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { WORLD } from '../../core/config';
import { Rng } from '../../utils/random';
import { addKitTank, floorShell, hqReady, Opening, shellStyleFor } from './HouseHQ';
import { WorldBuilder } from '../WorldBuilder';
import { addBarrel, addCar, addCrates, addFruitCrate, addPlasticChair, addPlasticTable, addSign, addTireStack } from './Props';

export type ShopKind = 'boteco' | 'mercadinho' | 'oficina';

export interface ShopSpec {
  kind: ShopKind;
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** -1 = fachada em z0 olhando -Z; +1 = fachada em z0+d olhando +Z. */
  front: 1 | -1;
}

export interface ShopInfo {
  spec: ShopSpec;
  frontZ: number;
  lootSpots: Vector3[];
}

const FLOOR_H = WORLD.floorHeight;

const SIGNS: Record<ShopKind, { title: string; subtitle: string; bg: string; fg: string; awning: number; wall: number }> = {
  boteco: { title: 'BAR DO ZÉ', subtitle: 'CERVEJA GELADA • PORÇÕES • SINUCA', bg: '#ffd21f', fg: '#c4161c', awning: 0, wall: 2 },
  mercadinho: { title: 'MERCADINHO BOA VISTA', subtitle: 'HORTIFRUTI • BEBIDAS • GÁS', bg: '#1fa64a', fg: '#ffffff', awning: 1, wall: 6 },
  oficina: { title: 'OFICINA DO TIÃO', subtitle: 'MECÂNICA EM GERAL • FUNILARIA', bg: '#1f3fa6', fg: '#ffd21f', awning: 2, wall: 3 },
};

/**
 * Comércio de esquina: térreo aberto (dá para entrar), porta de aço enrolada,
 * toldo listrado, letreiro, interior mobiliado e moradia em cima.
 */
export function buildShop(b: WorldBuilder, rng: Rng, s: ShopSpec): ShopInfo {
  const m = b.mats;
  const { x0, z0, w, d, front, kind } = s;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const frontZ = front < 0 ? z0 : z0 + d;
  const backZ = front < 0 ? z0 + d : z0;
  const inward = (dist: number) => frontZ - front * dist;
  const info = SIGNS[kind];
  const wallMat = m.paints[info.wall];
  const t = 0.22;
  const pillar = kind === 'oficina' ? 0.45 : 0.75;
  const openH = 2.65;

  b.contactShadow(cx, cz, w, d, 0);

  // Piso.
  b.box({ w: w - 0.2, h: 0.04, d: d - 0.2, x: cx, z: cz, y: 0, mat: kind === 'oficina' ? m.concreteDark : kind === 'mercadinho' ? m.mercadoPiso : m.tile, tile: kind === 'oficina' ? 3 : kind === 'mercadinho' ? 1 : 1.2 });

  // Paredes do térreo (oco).
  const wallBox = (bw: number, bd: number, bx: number, bz: number, h = FLOOR_H, y = 0) =>
    b.box({ w: bw, h, d: bd, x: bx, z: bz, y, mat: wallMat, tile: 2.5, tileV: 3, collide: true });
  wallBox(w, t, cx, backZ + front * (t / 2));
  wallBox(t, d - t, x0 + t / 2, cz);
  wallBox(t, d - t, x0 + w - t / 2, cz);
  wallBox(pillar, t, x0 + pillar / 2, frontZ - front * (t / 2));
  wallBox(pillar, t, x0 + w - pillar / 2, frontZ - front * (t / 2));
  wallBox(w - pillar * 2, t, cx, frontZ - front * (t / 2), FLOOR_H - openH, openH);
  // Barrado.
  b.box({ w: w + 0.04, h: 0.5, d: t + 0.04, x: cx, z: backZ + front * (t / 2), y: 0, mat: m.barrado });

  // Moradia em cima.
  const roofY = FLOOR_H * 2 + 0.02;
  const upperMat = rng.chance(0.5) ? m.brick : wallMat;
  const hq = hqReady();
  if (hq) {
    // Moradia com paredes de verdade: janelas do kit na frente e uma nos fundos.
    const front2: Opening[] = [0.25, 0.75].map((k) => ({ kind: 'janela', u: x0 + w * k, y0: FLOOR_H + 1.0 }));
    const back2: Opening[] = [{ kind: 'basculante', u: cx, y0: FLOOR_H + 1.55 }];
    const st = shellStyleFor(b, upperMat, FLOOR_H, true, m.hq.interiores[0]);
    floorShell(b, x0, z0, w, d, FLOOR_H, FLOOR_H - 0.2, { zMin: front < 0 ? front2 : back2, zMax: front < 0 ? back2 : front2, xMin: [], xMax: [] }, st);
  } else b.box({ w, h: FLOOR_H, d, x: cx, z: cz, y: FLOOR_H, mat: upperMat, tile: 2.5, tileV: 3 });
  b.collider(w, roofY - FLOOR_H, d, cx, (FLOOR_H + roofY) / 2, cz);
  for (const y of [FLOOR_H, FLOOR_H * 2]) {
    b.box({ w: w + 0.16, h: 0.22, d: d + 0.16, x: cx, z: cz, y: y - 0.2, mat: m.concrete, tile: 2 });
  }
  if (!hq) {
    for (const k of [0.25, 0.75]) {
      const wx = x0 + w * k;
      b.box({ w: 1.18, h: 1.26, d: 0.06, x: wx, z: frontZ + front * 0.03, y: FLOOR_H + 1.0, mat: m.frames[0] });
      b.box({ w: 1.0, h: 1.1, d: 0.07, x: wx, z: frontZ + front * 0.035, y: FLOOR_H + 1.08, mat: m.glass });
    }
  }
  for (const [bx, bz, bw, bd] of [
    [cx, backZ + front * 0.075, w, 0.15],
    [x0 + 0.075, cz, 0.15, d],
    [x0 + w - 0.075, cz, 0.15, d],
  ]) {
    b.box({ w: bw, h: 0.6, d: bd, x: bx, z: bz, y: roofY, mat: wallMat, collide: true, tile: 2.5, tileV: 3 });
  }
  if (!hq || !addKitTank(b, x0 + 1, roofY, backZ + front * 1)) {
    b.cylinder({ diameter: 1.15, diameterTop: 1.25, h: 0.85, x: x0 + 1, y: roofY, z: backZ + front * 1, mat: m.tank, collide: true, tessellation: 18 });
  }

  // Porta de aço enrolada + trilhos.
  const openW = w - pillar * 2;
  const drum = MeshBuilder.CreateCylinder('drum', { diameter: 0.34, height: openW, tessellation: 14 }, b.scene);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(cx, openH + 0.12, frontZ - front * 0.2);
  b.addMesh(drum, m.steelDoor);
  b.box({ w: openW, h: 0.38, d: 0.03, x: cx, z: frontZ - front * 0.32, y: openH - 0.38, mat: m.steelDoor });
  for (const sx of [x0 + pillar, x0 + w - pillar]) {
    b.box({ w: 0.06, h: openH, d: 0.08, x: sx, z: frontZ - front * 0.3, y: 0, mat: m.metalDark });
  }

  // Toldo listrado.
  const awningMat = m.awnings[info.awning];
  const aw = w - 0.3;
  b.box({ w: aw, h: 0.04, d: 1.8, x: cx, z: frontZ + front * 0.88, y: openH + 0.22, mat: awningMat, rx: front * 0.28 });
  b.box({ w: aw, h: 0.28, d: 0.03, x: cx, z: frontZ + front * 1.74, y: openH - 0.28, mat: awningMat });
  for (const sx of [x0 + 0.3, x0 + w - 0.3]) {
    b.pipe(new Vector3(sx, openH + 0.3, frontZ + front * 0.05), new Vector3(sx, openH - 0.2, frontZ + front * 1.7), 0.02, m.metal);
  }

  // Letreiro.
  addSign(b, info.title, {
    x: cx,
    y: FLOOR_H + 0.45 + 2.0,
    z: frontZ,
    width: Math.min(w - 0.6, 6.5),
    height: 1.0,
    facing: front,
    bg: info.bg,
    fg: info.fg,
    subtitle: info.subtitle,
    board: true,
  });

  const lootSpots: Vector3[] = [];
  switch (kind) {
    case 'boteco':
      furnishBoteco(b, rng, s, inward, frontZ, backZ, lootSpots);
      break;
    case 'mercadinho':
      furnishMercadinho(b, rng, s, inward, frontZ, backZ, lootSpots);
      break;
    case 'oficina':
      furnishOficina(b, rng, s, inward, frontZ, backZ, lootSpots);
      break;
  }
  return { spec: s, frontZ, lootSpots };
}

type Inward = (dist: number) => number;

function furnishBoteco(b: WorldBuilder, rng: Rng, s: ShopSpec, inward: Inward, frontZ: number, backZ: number, loot: Vector3[]): void {
  const m = b.mats;
  const { x0, w, front } = s;
  const cx = x0 + w / 2;
  // Balcão.
  const counterZ = inward(3.0);
  const counterW = w - 3.2;
  const counterX = x0 + 1.0 + counterW / 2;
  b.box({ w: counterW, h: 1.02, d: 0.6, x: counterX, z: counterZ, y: 0, mat: m.tile, collide: true, tile: 1.2 });
  b.box({ w: counterW + 0.1, h: 0.06, d: 0.72, x: counterX, z: counterZ, y: 1.02, mat: m.wood });
  // Garrafas no balcão e prateleiras ao fundo.
  const shelfZ = backZ + front * 0.42;
  for (let level = 0; level < 3; level++) {
    const y = 1.1 + level * 0.45;
    b.box({ w: w - 1.2, h: 0.04, d: 0.3, x: cx, z: shelfZ, y, mat: m.wood });
    for (let i = 0; i < 12; i++) {
      if (rng.chance(0.2)) continue;
      b.cylinder({ diameter: 0.08, diameterTop: 0.05, h: rng.range(0.24, 0.32), x: x0 + 0.8 + i * ((w - 1.6) / 12), y: y + 0.04, z: shelfZ, mat: rng.pick([m.glass, ...m.productColors]), tessellation: 8 });
    }
  }
  // Geladeira com letreiro.
  const fx = x0 + w - 0.75;
  const fz = backZ + front * 1.4;
  b.box({ w: 0.85, h: 1.95, d: 0.75, x: fx, z: fz, y: 0, mat: m.white, collide: true });
  b.box({ w: 0.7, h: 1.2, d: 0.03, x: fx, z: fz - front * 0.38, y: 0.55, mat: m.glass });
  b.box({ w: 0.8, h: 0.3, d: 0.04, x: fx, z: fz - front * 0.39, y: 1.6, mat: m.plasticRed });
  // Banquinhos.
  for (let i = 0; i < 3; i++) {
    const bx = counterX - counterW / 2 + 0.6 + i * (counterW / 3);
    b.cylinder({ diameter: 0.05, h: 0.7, x: bx, y: 0, z: counterZ - front * 0.65, mat: m.metal, tessellation: 6 });
    b.cylinder({ diameter: 0.36, h: 0.06, x: bx, y: 0.7, z: counterZ - front * 0.65, mat: m.plasticRed, tessellation: 12 });
  }
  // TV passando futebol.
  b.box({ w: 1.1, h: 0.65, d: 0.08, x: x0 + 0.25, z: inward(1.6), y: 2.0, mat: m.metalDark, ry: Math.PI / 2 });
  b.box({ w: 1.0, h: 0.55, d: 0.02, x: x0 + 0.3, z: inward(1.6), y: 2.05, mat: m.foliage, ry: Math.PI / 2 });
  // Mesas de plástico na calçada.
  for (const tx of [x0 + 1.4, x0 + w - 1.6]) {
    const tz = frontZ + front * 1.25;
    addPlasticTable(b, tx, 0.06, tz, m.plasticYellow);
    for (const [ox, oz, ry] of [[-0.65, 0, Math.PI / 2], [0.65, 0, -Math.PI / 2], [0, -0.65, 0]] as const) {
      addPlasticChair(b, tx + ox, 0.06, tz + oz * front, front > 0 ? ry + Math.PI : ry, m.plasticYellow);
    }
  }
  addCrates(b, rng, x0 + w - 0.5, 0.04, inward(0.8), 4);
  addCrates(b, rng, x0 + w - 1.0, 0.04, inward(0.8), 3);
  loot.push(new Vector3(counterX, 0.1, inward(4.0)));
  loot.push(new Vector3(cx, 0.1, inward(1.6)));
}

/**
 * Mercadinho por dentro: gôndolas de metal com quatro prateleiras e etiqueta de preço,
 * produtos com embalagem impressa, geladeira de bebidas com porta de vidro, caixa com
 * esteira, lâmpadas fluorescentes e cartazes de oferta. Os sorteios (rng) são exatamente os
 * de antes, na mesma ordem: o mapa sorteado depois do mercadinho não muda.
 */
function furnishMercadinho(b: WorldBuilder, rng: Rng, s: ShopSpec, inward: Inward, frontZ: number, backZ: number, loot: Vector3[]): void {
  const m = b.mats;
  const { x0, w, front } = s;
  const cx = x0 + w / 2;
  const shelfYs = [0.23, 0.68, 1.13, 1.58];
  // Gôndolas: base, painel central, prateleiras dos dois lados e etiquetas amarelas.
  for (const gz of [inward(3.4), inward(5.2)]) {
    const gw = w - 3.0;
    const gx = x0 + 1.9 + gw / 2;
    b.collider(gw, 1.6, 0.5, gx, 0.8, gz);
    b.box({ w: gw, h: 0.12, d: 0.5, x: gx, z: gz, y: 0, mat: m.gondola });
    b.box({ w: gw, h: 1.6, d: 0.05, x: gx, z: gz, y: 0, mat: m.gondola });
    for (const y of shelfYs) {
      b.box({ w: gw, h: 0.02, d: 0.48, x: gx, z: gz, y, mat: m.gondola });
      for (const side of [-1, 1]) b.box({ w: gw, h: 0.035, d: 0.006, x: gx, z: gz + side * 0.243, y: y - 0.03, mat: m.plasticYellow });
    }
    for (const side of [-1, 1]) b.box({ w: 0.03, h: 1.62, d: 0.5, x: gx + side * (gw / 2), z: gz, y: 0, mat: m.gondola });
    for (let level = 0; level < 3; level++) {
      for (let i = 0; i < 9; i++) {
        if (rng.chance(0.15)) continue;
        for (const side of [-1, 1]) {
          const h = rng.range(0.2, 0.32);
          const mat = rng.pick(m.productColors);
          // tile = largura e tileV = altura: o rótulo inteiro aparece na frente da embalagem.
          b.box({ w: 0.24, h, d: 0.14, x: gx - gw / 2 + 0.2 + i * (gw / 9), z: gz + side * 0.2, y: 0.25 + level * 0.45, mat, tile: 0.24, tileV: h });
        }
      }
    }
  }
  // Caixa: balcão de madeira, esteira, registradora e expositor de balas.
  b.box({ w: 1.4, h: 0.95, d: 0.6, x: x0 + 0.9, z: inward(1.6), y: 0, mat: m.wood, collide: true });
  b.box({ w: 1.3, h: 0.02, d: 0.42, x: x0 + 0.9, z: inward(1.6), y: 0.95, mat: m.rubber });
  b.box({ w: 0.4, h: 0.25, d: 0.3, x: x0 + 0.6, z: inward(1.6), y: 0.97, mat: m.metalDark });
  b.box({ w: 0.3, h: 0.12, d: 0.02, x: x0 + 0.6, z: inward(1.6) + front * 0.16, y: 1.17, mat: m.lampOff });
  for (let k = 0; k < 4; k++) b.box({ w: 0.14, h: 0.1, d: 0.1, x: x0 + 1.0 + (k % 2) * 0.16, z: inward(1.6) - front * 0.12, y: 0.97 + Math.floor(k / 2) * 0.1, mat: m.productColors[(k * 3) % m.productColors.length], tile: 0.14, tileV: 0.1 });
  // Prateleira do fundo, com produtos em ordem (sem sorteio).
  const bz = backZ + front * 0.45;
  b.collider(w - 1.0, 1.9, 0.4, cx, 0.95, bz);
  b.box({ w: w - 1.0, h: 1.9, d: 0.05, x: cx, z: bz + front * 0.18, y: 0, mat: m.gondola });
  for (const y of shelfYs) {
    b.box({ w: w - 1.0, h: 0.02, d: 0.4, x: cx, z: bz, y, mat: m.gondola });
    const n = Math.floor((w - 1.2) / 0.3);
    for (let i = 0; i < n; i++) {
      if ((i * 7 + Math.round(y * 10)) % 5 === 0) continue;
      const ph = 0.22 + ((i * 13) % 4) * 0.025;
      b.box({ w: 0.24, h: ph, d: 0.14, x: cx - (w - 1.2) / 2 + 0.15 + i * 0.3, z: bz - front * 0.05, y: y + 0.02, mat: m.productColors[(i + Math.round(y * 3)) % m.productColors.length], tile: 0.24, tileV: ph });
    }
  }
  // Geladeira de bebidas no canto da frente (porta de vidro virada para o corredor).
  const fx = x0 + w - 0.6;
  const fz = inward(1.7);
  b.box({ w: 0.75, h: 2.0, d: 1.5, x: fx, z: fz, y: 0, mat: m.white, collide: true });
  b.box({ w: 0.02, h: 1.75, d: 1.36, x: fx - 0.385, z: fz, y: 0.12, mat: m.glass });
  b.box({ w: 0.02, h: 0.06, d: 1.36, x: fx - 0.39, z: fz, y: 1.92, mat: m.fluorescente });
  for (let level = 0; level < 4; level++) {
    for (let i = 0; i < 6; i++) {
      b.cylinder({ diameter: 0.08, h: 0.28, x: fx - 0.2, y: 0.2 + level * 0.42, z: fz - 0.6 + i * 0.24, mat: m.productColors[(i + level * 2) % m.productColors.length], tessellation: 8 });
    }
  }
  b.box({ w: 0.6, h: 0.22, d: 0.02, x: fx, z: fz - front * 0.76, y: 2.02, mat: m.cartazOferta, tile: 0.6, tileV: 0.22 });
  // Lâmpadas fluorescentes no teto e cartazes de oferta.
  for (const lz of [inward(2.6), inward(5.6)]) b.box({ w: 1.2, h: 0.05, d: 0.12, x: cx, z: lz, y: FLOOR_H - 0.25, mat: m.fluorescente });
  for (const ox of [-1.4, 0, 1.4]) b.box({ w: 0.8, h: 0.8, d: 0.02, x: cx + ox, z: bz + front * 0.215, y: 2.0, mat: m.cartazOferta, tile: 0.8 });
  for (const side of [-1, 1]) {
    const px = side < 0 ? x0 + 0.37 : x0 + w - 0.37;
    b.box({ w: 0.6, h: 0.6, d: 0.02, x: px, z: frontZ + front * 0.02, y: 1.3, mat: m.cartazOferta, tile: 0.6 });
  }
  // Banca de frutas na calçada.
  const standZ = frontZ + front * 1.0;
  b.box({ w: 3.2, h: 0.75, d: 0.9, x: cx, z: standZ, y: 0.06, mat: m.wood, collide: true });
  for (let i = 0; i < 5; i++) addFruitCrate(b, rng, cx - 1.3 + i * 0.65, 0.81, standZ);
  // Botijões de gás.
  for (let i = 0; i < 3; i++) {
    b.cylinder({ diameter: 0.36, h: 0.5, x: x0 + w - 0.5, y: 0.06 + i * 0.0, z: frontZ + front * (0.6 + i * 0.4), mat: m.gasRed, tessellation: 12 });
  }
  loot.push(new Vector3(cx, 0.1, inward(4.3)));
  loot.push(new Vector3(x0 + w - 1.2, 0.1, inward(2.2)));
}

function furnishOficina(b: WorldBuilder, rng: Rng, s: ShopSpec, inward: Inward, frontZ: number, backZ: number, loot: Vector3[]): void {
  const m = b.mats;
  const { x0, w, front } = s;
  // Carro sendo consertado.
  addCar(b, rng, x0 + w / 2 + 0.6, inward(3.6), 0);
  // Bancada com ferramentas.
  const bx = x0 + 0.55;
  b.box({ w: 0.7, h: 0.9, d: 3.2, x: bx, z: inward(4.2), y: 0, mat: m.wood, collide: true });
  for (let i = 0; i < 6; i++) {
    b.box({ w: 0.25, h: 0.08, d: 0.12, x: bx + rng.range(-0.15, 0.15), z: inward(3.0 + i * 0.45), y: 0.9, mat: rng.pick([m.plasticRed, m.metal, m.metalDark]), ry: rng.range(0, 1) });
  }
  // Painel de ferramentas.
  b.box({ w: 0.05, h: 1.0, d: 2.4, x: x0 + 0.24, z: inward(4.2), y: 1.3, mat: m.wood });
  // Compressor.
  const comp = MeshBuilder.CreateCylinder('compressor', { diameter: 0.5, height: 1.0, tessellation: 14 }, b.scene);
  comp.rotation.x = Math.PI / 2;
  comp.position.set(x0 + w - 0.7, 0.4, backZ + front * 0.9);
  b.addMesh(comp, m.plasticRed);
  b.collider(0.6, 0.8, 1.1, x0 + w - 0.7, 0.4, backZ + front * 0.9);
  // Pneus e tambores na calçada.
  addTireStack(b, x0 + 0.6, 0.06, frontZ + front * 0.7, 4);
  addTireStack(b, x0 + 1.4, 0.06, frontZ + front * 0.9, 3);
  addBarrel(b, x0 + w - 0.6, 0.06, frontZ + front * 0.7, m.plasticBlue);
  addBarrel(b, x0 + w - 1.3, 0.06, frontZ + front * 0.8, m.rust);
  // Manchas de óleo.
  for (let i = 0; i < 4; i++) {
    const g = MeshBuilder.CreateDisc('oil', { radius: rng.range(0.3, 0.7), tessellation: 14 }, b.scene);
    g.rotation.x = Math.PI / 2;
    g.position.set(x0 + rng.range(1.5, w - 1.5), 0.045, inward(rng.range(1.5, 5)));
    b.addMesh(g, m.contactShadow);
  }
  loot.push(new Vector3(x0 + 1.5, 0.1, inward(2.0)));
  loot.push(new Vector3(x0 + w - 1.4, 0.1, inward(5.5)));
}

