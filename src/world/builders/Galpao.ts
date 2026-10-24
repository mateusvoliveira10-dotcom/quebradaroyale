import { Color3, StandardMaterial, Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { MaterialMeta } from '../Materials';
import { WorldBuilder } from '../WorldBuilder';
import { addBarrel, addSign, addTireStack } from './Props';

export interface GalpaoInfo {
  /** Ponto de nascimento (pés) e direção. */
  spawn: Vector3;
  spawnYaw: number;
  /** Posições das bancadas de armas (centro de cada arma em exibição). */
  weaponSlots: Vector3[];
  /** Área onde os alvos aparecem. */
  targetArea: { x0: number; x1: number; z0: number; z1: number };
  /** Linha de tiro (balcão). */
  counterZ: number;
  center: Vector3;
}

/**
 * Galpão industrial de treino: paredes de tijolo e concreto, telhado metálico
 * com claraboias (a luz do sol entra e projeta manchas no piso), janelas altas
 * gradeadas, portões de ferro, piso industrial com faixas, balcão de tiro,
 * bancadas de armas, pneus, caixotes e grafites.
 */
export function buildGalpao(b: WorldBuilder, rng: Rng, cx: number, cz: number): GalpaoInfo {
  const m = b.mats;
  const W = 30;
  const D = 46;
  const H = 7;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const z0 = cz - D / 2;
  const z1 = cz + D / 2;
  const t = 0.4;

  // Material translúcido das claraboias (não projeta sombra: a luz passa).
  const skylight = new StandardMaterial('skylight', b.scene);
  skylight.diffuseColor = Color3.FromHexString('#dff2ff');
  skylight.emissiveColor = Color3.FromHexString('#bfe3ff').scale(0.6);
  skylight.alpha = 0.35;
  skylight.specularColor = Color3.Black();
  skylight.backFaceCulling = false;
  skylight.metadata = { castShadow: false } satisfies MaterialMeta;

  // Piso e terreno em volta.
  b.box({ w: W + 60, h: 1, d: D + 60, x: cx, z: cz, y: -1, mat: m.dirt, tile: 7, collide: true });
  b.box({ w: W, h: 0.03, d: D, x: cx, z: cz, y: 0, mat: m.concreteDark, tile: 3 });
  for (const lx of [x0 + 1, x1 - 1]) b.box({ w: 0.15, h: 0.01, d: D - 2, x: lx, z: cz, y: 0.03, mat: m.roadLine });
  // Faixas de distância.
  const counterZ = z1 - 7;
  for (const dist of [10, 20, 30]) {
    const z = counterZ - dist;
    b.box({ w: W - 3, h: 0.01, d: 0.12, x: cx, z, y: 0.03, mat: m.roadWhite });
    addSign(b, `${dist} M`, { x: x0, y: 2.4, z, width: 1.6, height: 0.7, facing: 1, bg: '#1b1420', fg: '#ffd21f', axis: 'x' });
  }

  // Paredes: tijolo embaixo, concreto em cima com janelas gradeadas.
  const wall = (len: number, along: 'x' | 'z', pos: number, mid: number, openings: Array<[number, number]>) => {
    const lowH = 3.2;
    const box = (a: number, bLen: number, y: number, h: number, mat: typeof m.brick, tile: number, tileV?: number) => {
      if (along === 'x') b.box({ w: bLen, h, d: t, x: a, z: pos, y, mat, collide: true, tile, tileV });
      else b.box({ w: t, h, d: bLen, x: pos, z: a, y, mat, collide: true, tile, tileV });
    };
    box(mid, len, 0, lowH, m.brick, 1);
    // Faixa superior: segmentos com vãos de janela.
    let cursor = mid - len / 2;
    const end = mid + len / 2;
    const sorted = [...openings].sort((a, c) => a[0] - c[0]);
    for (const [oa, ob] of sorted) {
      if (oa > cursor) box((cursor + oa) / 2, oa - cursor, lowH, H - lowH, m.concrete, 2.5, 3);
      // Grade da janela e verga.
      if (along === 'x') {
        b.box({ w: ob - oa, h: 2.2, d: 0.05, x: (oa + ob) / 2, z: pos, y: lowH + 0.9, mat: m.fence, tile: 1 });
        b.box({ w: ob - oa, h: 0.9, d: t, x: (oa + ob) / 2, z: pos, y: lowH, mat: m.concrete, collide: true, tile: 2 });
        b.box({ w: ob - oa, h: H - lowH - 3.1, d: t, x: (oa + ob) / 2, z: pos, y: lowH + 3.1, mat: m.concrete, collide: true, tile: 2 });
      } else {
        b.box({ w: 0.05, h: 2.2, d: ob - oa, x: pos, z: (oa + ob) / 2, y: lowH + 0.9, mat: m.fence, tile: 1 });
        b.box({ w: t, h: 0.9, d: ob - oa, x: pos, z: (oa + ob) / 2, y: lowH, mat: m.concrete, collide: true, tile: 2 });
        b.box({ w: t, h: H - lowH - 3.1, d: ob - oa, x: pos, z: (oa + ob) / 2, y: lowH + 3.1, mat: m.concrete, collide: true, tile: 2 });
      }
      cursor = ob;
    }
    if (cursor < end) box((cursor + end) / 2, end - cursor, lowH, H - lowH, m.concrete, 2.5, 3);
  };
  const sideWindows: Array<[number, number]> = [];
  for (let z = z0 + 4; z + 3 < z1 - 2; z += 6) sideWindows.push([z, z + 3]);
  wall(D + t * 2, 'z', x0 - t / 2, cz, sideWindows);
  wall(D + t * 2, 'z', x1 + t / 2, cz, sideWindows);
  wall(W, 'x', z0 - t / 2, cx, [[cx - 9, cx - 5], [cx + 5, cx + 9]]);
  wall(W, 'x', z1 + t / 2, cx, [[cx - 9, cx - 5], [cx + 5, cx + 9]]);

  // Portões de ferro (fundos da área de tiro, fechados).
  for (const s of [-1, 1]) {
    b.box({ w: 3.4, h: 4.6, d: 0.12, x: cx + s * 1.75, z: z0 + 0.08, y: 0, mat: m.steelDoor, tile: 1.6 });
  }
  b.box({ w: 7.4, h: 0.3, d: 0.3, x: cx, z: z0 + 0.1, y: 4.6, mat: m.metalDark });

  // Telhado em duas águas com claraboias.
  const ridge = 10.2;
  const slope = Math.atan2(ridge - H, W / 2);
  const panelLen = Math.hypot(W / 2, ridge - H) + 0.6;
  for (const s of [-1, 1]) {
    const px = cx + s * (W / 4);
    let z = z0 - 0.5;
    let k = 0;
    while (z < z1 + 0.5) {
      const seg = k % 3 === 2 ? 2 : 5;
      const isSky = k % 3 === 2;
      b.box({ w: panelLen, h: 0.08, d: seg, x: px, z: z + seg / 2, cy: (H + ridge) / 2 + 0.1, mat: isSky ? skylight : m.corrugated, rz: -s * slope, tile: 1.4 });
      z += seg;
      k++;
    }
  }
  // Tesouras metálicas.
  for (let z = z0 + 2; z < z1; z += 5) {
    b.box({ w: W, h: 0.22, d: 0.22, x: cx, z, y: H - 0.2, mat: m.metalDark });
    for (const s of [-1, 1]) {
      b.box({ w: panelLen - 0.4, h: 0.2, d: 0.2, x: cx + s * (W / 4), z, cy: (H + ridge) / 2 - 0.15, mat: m.metalDark, rz: -s * slope });
    }
    b.box({ w: 0.18, h: ridge - H, d: 0.18, x: cx, z, y: H, mat: m.metalDark });
  }
  // Colisor do teto (a câmera não sai do galpão).
  b.collider(W + 1, 0.3, D + 1, cx, H + 0.4, cz);

  // Balcão de tiro com vão no meio.
  for (const s of [-1, 1]) {
    const len = W / 2 - 1.5;
    const bx = cx + s * (1.5 + len / 2);
    b.box({ w: len, h: 1.05, d: 0.6, x: bx, z: counterZ, y: 0, mat: m.concrete, collide: true, tile: 2 });
    b.box({ w: len + 0.1, h: 0.06, d: 0.75, x: bx, z: counterZ, y: 1.05, mat: m.wood });
  }
  b.box({ w: 3, h: 0.5, d: 0.6, x: cx, z: counterZ, y: 0, mat: m.roadLine, collide: true });

  // Bancadas de armas (área do jogador).
  const benchZ = z1 - 2.2;
  const weaponSlots: Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const bx = cx - 10 + i * 5;
    b.box({ w: 2.2, h: 0.9, d: 0.9, x: bx, z: benchZ, y: 0, mat: m.wood, collide: true });
    b.box({ w: 2.3, h: 0.06, d: 1.0, x: bx, z: benchZ, y: 0.9, mat: m.metal });
    weaponSlots.push(new Vector3(bx, 1.0, benchZ));
  }

  // Pneus, caixotes, tambores e paletes nas laterais.
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = z0 + 4 + i * 7;
    addTireStack(b, cx + side * (W / 2 - 1.2), 0, z, rng.int(3, 5));
    addBarrel(b, cx + side * (W / 2 - 1.1), 0, z + 2, rng.chance(0.5) ? m.plasticBlue : m.rust);
    const crates = rng.int(2, 3);
    for (let c = 0; c < crates; c++) {
      b.box({ w: 1.1, h: 1.1, d: 1.1, x: cx + side * (W / 2 - 2.6), z: z + 3.5, y: c * 1.1, mat: m.wood, collide: true, ry: rng.range(-0.15, 0.15) });
    }
  }
  b.box({ w: 2.4, h: 0.15, d: 1.6, x: cx - 11, z: z1 - 5, y: 0, mat: m.wood });

  // Grafites.
  addSign(b, 'GALPÃO DA QUEBRADA', { x: cx, y: 2.0, z: z0, width: 14, height: 2.6, facing: 1, bg: '#cfc8b6', fg: '#ffd21f', graffiti: true });
  addSign(b, 'TREINO É TREINO', { x: x1, y: 1.8, z: cz - 6, width: 9, height: 2.2, facing: -1, bg: '#cfc8b6', fg: '#25c4ff', graffiti: true, axis: 'x' });
  addSign(b, 'MIRA NA CABEÇA', { x: x0, y: 1.8, z: cz + 4, width: 9, height: 2.2, facing: 1, bg: '#cfc8b6', fg: '#ff4fa3', graffiti: true, axis: 'x' });
  addSign(b, 'ESTANDE DE TIRO', { x: cx, y: 5.6, z: z1, width: 6, height: 1.2, facing: -1, bg: '#1b1420', fg: '#ffd21f', subtitle: 'SÓ ALVO • RESPEITA A FAIXA', board: true });

  return {
    spawn: new Vector3(cx, 0.1, z1 - 4.5),
    spawnYaw: Math.PI,
    weaponSlots,
    targetArea: { x0: x0 + 2, x1: x1 - 2, z0: z0 + 3, z1: counterZ - 8 },
    counterZ,
    center: new Vector3(cx, 0, cz),
  };
}
