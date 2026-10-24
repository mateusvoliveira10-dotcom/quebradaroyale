import { Material, StandardMaterial, Vector3 } from '@babylonjs/core';
import { WORLD } from '../../core/config';
import { clamp, Rng } from '../../utils/random';
import { HQ_TILE } from '../MaterialsHQ';
import { WorldAssets } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';
import { addKitTank, addRoof, Face, floorShell, hqReady, kitMat, Opening, openingSize, placeKit, ShellStyle } from './HouseHQ';
import { addAcUnit, addClothesline, addGasCylinder, addGraffitiTag, addPlasticChair, addPotPlant, addSatelliteDish, spotRng } from './Props';
import { buildStairs } from './Stairs';
import { placeTrepadeira } from './Vegetation';

export interface HouseSpec {
  /** Canto mínimo do terreno em X e Z. */
  x0: number;
  z0: number;
  /** Largura (X) e profundidade (Z). */
  w: number;
  d: number;
  /** Altura do terreno. */
  base: number;
  /** Pavimentos completos (1 ou 2). */
  floors: number;
  /** Lado da fachada: -1 = fachada em z0 olhando -Z; +1 = fachada em z0+d olhando +Z. */
  front: 1 | -1;
  /** Escada externa até a laje. */
  stair: boolean;
  /** Cômodo extra construído em cima da laje. */
  puxadinho: boolean;
}

export interface HouseInfo {
  spec: HouseSpec;
  /** Topo da laje principal (y). */
  roofY: number;
  /** Z da fachada. */
  frontZ: number;
  /** Sentido em X em que a escada sobe (null = sem escada). */
  stairDir: 1 | -1 | null;
  /** Pontos livres na laje (para loot). */
  roofSpots: Vector3[];
}

const FLOOR_H = WORLD.floorHeight;
/** A laje fica 2 cm acima da parede para cobrir a emenda. */
const SLAB_TOP = 0.02;
/** Escala da textura de reboco: 2,5 m de largura x 1 pavimento de altura. */
const WALL_TILE = 2.5;

/**
 * Casa de comunidade com acabamento: pavimentos empilhados (reboco pintado com
 * sujeira ou tijolo baiano com estrutura de concreto aparente), barrado, laje,
 * janelas com peitoril/grade/basculante, portas com marquise, platibanda, caixa
 * d'água, ferros de espera, puxadinho (laje ou telha), escada externa com
 * corrimão e objetos do dia a dia (varal, parabólica, vasos, ar-condicionado...).
 */
export function buildHouse(b: WorldBuilder, rng: Rng, s: HouseSpec): HouseInfo {
  const m = b.mats;
  const { x0, z0, w, d, base, floors, front } = s;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const frontZ = front < 0 ? z0 : z0 + d;
  const backZ = front < 0 ? z0 + d : z0;
  const roofY = base + floors * FLOOR_H + SLAB_TOP;

  const groundPainted = rng.chance(0.72);
  const groundMat: Material = groundPainted ? rng.pick(m.paints) : m.brick;
  const upperMat: Material = rng.chance(0.5) ? m.brick : rng.chance(0.6) ? groundMat : rng.pick(m.paints);
  const frameMat = rng.pick(m.frames);
  const doorMat = rng.pick(m.doors);

  // Casas reconstruídas (Fases 4 e 5): mesmas decisões e os mesmos sorteios do gerador (o resto do
  // mapa não muda), mas paredes com vãos e as peças do kit em vez das caixas.
  const hq = hqReady();
  const sr = spotRng(x0, z0, 40);
  const interior = sr.pick(m.hq.interiores);
  const hqStyle = (mat: Material, fy: number, upper: boolean): ShellStyle => {
    if (mat === m.brick) return { mat: m.hq.tijolo, brick: true, interior, uv: { tile: HQ_TILE.tijolo } };
    const paint = m.hq.paint(m.paints.indexOf(mat as StandardMaterial));
    // Reboco: um pavimento por repetição. Nos de cima, só a parte de cima da textura (sem a
    // umidade de rodapé, que só faz sentido junto do chão).
    const uv = upper ? { tile: HQ_TILE.rebocoU, tileV: FLOOR_H / 0.67, y0: fy, v0: 0.33 } : { tile: HQ_TILE.rebocoU, tileV: FLOOR_H, y0: fy };
    return { mat: paint, brick: false, interior, uv };
  };

  // Colisor único do bloco da casa.
  b.collider(w, roofY - base, d, cx, (base + roofY) / 2, cz);
  b.contactShadow(cx, cz, w, d, base);

  for (let i = 0; i < floors; i++) {
    const fy = base + i * FLOOR_H;
    const mat = i === 0 ? groundMat : upperMat;
    const isBrick = mat === m.brick;
    const st = hq ? hqStyle(mat, fy, i > 0) : null;
    if (!st) {
      b.box({ w, h: FLOOR_H, d, x: cx, z: cz, y: fy, mat, tile: isBrick ? 1 : WALL_TILE, tileV: isBrick ? 1 : FLOOR_H });
      // Borda da laje aparente.
      b.box({ w: w + 0.16, h: 0.22, d: d + 0.16, x: cx, z: cz, y: fy + FLOOR_H - 0.2, mat: m.concrete, tile: 2 });
    } else {
      b.box({ w: w + 0.16, h: 0.22, d: d + 0.16, x: cx, z: cz, y: fy + FLOOR_H - 0.2, mat: m.hq.concreto, worldUV: { tile: HQ_TILE.concreto } });
    }

    if (isBrick && !st) {
      // Estrutura de concreto (pilares) típica de obra de autoconstrução.
      const cols: number[] = [x0, x0 + w];
      if (w > 6.5) cols.push(cx);
      for (const px of cols) {
        for (const pz of [z0, z0 + d]) {
          b.box({ w: 0.26, h: FLOOR_H - 0.2, d: 0.26, x: px, z: pz, y: fy, mat: m.concrete, tile: 2 });
        }
      }
    } else if (i === 0 && !st) {
      // Barrado escuro na base da parede pintada.
      b.box({ w: w + 0.04, h: 0.55, d: d + 0.04, x: cx, z: cz, y: fy, mat: m.barrado, tile: 2 });
    }

    const ops = { zMin: [] as Opening[], zMax: [] as Opening[], xMin: [] as Opening[], xMax: [] as Opening[] };
    const frontOps = front < 0 ? ops.zMin : ops.zMax;
    const backOps = front < 0 ? ops.zMax : ops.zMin;
    const frontFace: Face = { axis: 'z', coord: frontZ, facing: front, a0: x0, a1: x0 + w };
    const fr = spotRng(x0, z0, 41 + i);
    let gate = false;

    // Fachada: janelas e, no térreo, a porta.
    const slots = Math.max(1, Math.floor((w - 0.6) / 2.3));
    const spacing = w / slots;
    const doorSlot = i === 0 ? rng.int(0, slots - 1) : -1;
    for (let k = 0; k < slots; k++) {
      const sx = x0 + spacing * (k + 0.5);
      if (k === doorSlot) {
        if (st) addDoorHQ(b, rng, sx, fy, frontFace, frontOps);
        else addDoor(b, rng, sx, fy, frontZ, front, frameMat, doorMat);
      } else {
        const o = { grade: i === 0 && rng.chance(0.55), shutter: rng.chance(0.2) };
        if (!st) addWindow(b, sx, fy + 1.1, frontZ, 'z', front, frameMat, o);
        else if (i === 0 && !gate && spacing >= 3.1 && fr.chance(0.45)) {
          // Garagem/portão de chapa no lugar de uma janela do térreo.
          frontOps.push({ kind: 'portao', u: sx, y0: fy, tint: fr.pick(m.hq.portoes) });
          gate = true;
        } else frontOps.push({ kind: 'janela', u: sx, y0: fy + 1.0, grade: o.grade });
      }
    }
    // Laterais e fundos.
    if (rng.chance(0.5)) {
      const zz = cz + rng.range(-d / 4, d / 4);
      const grade = i === 0 && rng.chance(0.5);
      if (st) ops.xMin.push({ kind: 'janela', u: zz, y0: fy + 1.0, grade });
      else addWindow(b, x0, fy + 1.1, zz, 'x', -1, frameMat, { grade });
    }
    if (rng.chance(0.5)) {
      const zz = cz + rng.range(-d / 4, d / 4);
      const grade = i === 0 && rng.chance(0.5);
      if (st) ops.xMax.push({ kind: 'janela', u: zz, y0: fy + 1.0, grade });
      else addWindow(b, x0 + w, fy + 1.1, zz, 'x', 1, frameMat, { grade });
    }
    if (rng.chance(0.4)) {
      const xx = cx + rng.range(-w / 4, w / 4);
      // Nos fundos, às vezes o basculante do banheiro (alto e pequeno).
      if (st) backOps.push(fr.chance(0.5) ? { kind: 'basculante', u: xx, y0: fy + 1.55 } : { kind: 'janela', u: xx, y0: fy + 1.0 });
      else addWindow(b, xx, fy + 1.1, backZ, 'z', -front as 1 | -1, frameMat, {});
    }

    // Ar-condicionado em andares de cima.
    if (i > 0 && rng.chance(0.35)) {
      const side = rng.chance(0.5) ? -1 : 1;
      const zz = cz + rng.range(-d / 4, d / 4);
      if (st) placeKit(b, 'Kit_ArCondicionado', { axis: 'x', coord: side < 0 ? x0 : x0 + w, facing: side as 1 | -1, a0: z0, a1: z0 + d }, zz, fy + 2.45, kitMat(b));
      else addAcUnit(b, side < 0 ? x0 : x0 + w, fy + 2.0, zz, 'x', side as 1 | -1);
    }

    if (st) {
      floorShell(b, x0, z0, w, d, fy, FLOOR_H - 0.2, ops, st);
      if (st.brick) {
        // Pilares de concreto nas quinas (e no meio, se não cair num vão).
        const cols: number[] = [x0, x0 + w];
        const free = (list: Opening[]) => list.every((o) => Math.abs(o.u - cx) > openingSize(o.kind).w / 2 + 0.25);
        for (const px of cols) {
          for (const pz of [z0, z0 + d]) b.box({ w: 0.3, h: FLOOR_H - 0.2, d: 0.3, x: px, z: pz, y: fy, mat: m.hq.concreto, worldUV: { tile: HQ_TILE.concreto } });
        }
        if (w > 6.5) {
          if (free(ops.zMin)) b.box({ w: 0.3, h: FLOOR_H - 0.2, d: 0.3, x: cx, z: z0, y: fy, mat: m.hq.concreto, worldUV: { tile: HQ_TILE.concreto } });
          if (free(ops.zMax)) b.box({ w: 0.3, h: FLOOR_H - 0.2, d: 0.3, x: cx, z: z0 + d, y: fy, mat: m.hq.concreto, worldUV: { tile: HQ_TILE.concreto } });
        }
      }
      // Padrão de energia (medidor) ao lado da porta.
      const door = frontOps.find((o) => o.kind === 'porta');
      if (door && fr.chance(0.7)) {
        const u = door.u + 0.8 < x0 + w - 0.4 ? door.u + 0.8 : door.u - 0.8;
        placeKit(b, 'Kit_Medidor', frontFace, u, fy + 1.45, kitMat(b));
      }
    }
  }

  // Calha/cano descendo do telhado.
  if (rng.chance(0.55)) {
    const px = rng.chance(0.5) ? x0 + 0.18 : x0 + w - 0.18;
    b.cylinder({ diameter: 0.09, h: roofY - base, x: px, y: base, z: frontZ + front * 0.1, mat: m.pvc, tessellation: 8 });
  }

  // Telhado inclinado (só nas casas novas, sem escada nem puxadinho): a laje some
  // debaixo do telhado, então tudo o que iria nela é construído "no vazio" (mesmos sorteios).
  const pr = spotRng(x0, z0, 31);
  const pitched = hq && !s.stair && !s.puxadinho && pr.chance(0.5);
  const rb = pitched ? b.sink() : b;
  const roofStyle = hq ? hqStyle(upperMat, roofY, true) : null;
  if (pitched && roofStyle) {
    const telha = pr.chance(0.6);
    addRoof(b, {
      x0,
      z0,
      w,
      d,
      y: roofY,
      kind: telha ? 'duas' : 'meia',
      drain: (-front) as 1 | -1,
      telha: telha ? m.hq.telha : m.hq.fibrocimento,
      tile: telha ? HQ_TILE.telha : HQ_TILE.fibrocimento,
      pitch: telha ? 0.4 : 0.16,
      gable: roofStyle.mat,
    });
  }

  // Platibanda nos fundos e laterais (a fachada fica aberta para a escada chegar).
  const t = 0.15;
  const ph = 0.6;
  // Nas casas novas, o topo da textura de reboco (os escorridos saem da platibanda).
  const pMat = roofStyle?.mat ?? upperMat;
  const pUV = roofStyle ? (roofStyle.brick ? roofStyle.uv : { tile: HQ_TILE.rebocoU, tileV: 3, y0: roofY, v0: 0.8 }) : undefined;
  const pTile = { tile: WALL_TILE, tileV: 3, worldUV: pUV };
  rb.box({ w, h: ph, d: t, x: cx, z: backZ + front * (t / 2), y: roofY, mat: pMat, collide: true, ...pTile });
  rb.box({ w: t, h: ph, d, x: x0 + t / 2, z: cz, y: roofY, mat: pMat, collide: true, ...pTile });
  rb.box({ w: t, h: ph, d, x: x0 + w - t / 2, z: cz, y: roofY, mat: pMat, collide: true, ...pTile });
  for (const [bx, bz, bw, bd] of [
    [cx, backZ + front * (t / 2), w + 0.04, t + 0.06],
    [x0 + t / 2, cz, t + 0.06, d + 0.04],
    [x0 + w - t / 2, cz, t + 0.06, d + 0.04],
  ]) {
    rb.box({ w: bw, h: 0.05, d: bd, x: bx, z: bz, y: roofY + ph, mat: hq ? m.hq.concreto : m.concrete, worldUV: hq ? { tile: HQ_TILE.concreto } : undefined });
  }
  // Piso cerâmico em parte das lajes.
  if (hq && !pitched && pr.chance(0.2)) {
    b.box({ w: w - 0.3, h: 0.012, d: d - 0.3, x: cx, z: cz, y: roofY, mat: m.hq.piso, worldUV: { tile: HQ_TILE.piso } });
  }

  // Área livre na laje (frente) para objetos e loot.
  const roofSpots: Vector3[] = [];
  let usableDepth = d - 0.6;
  let tankPlaced = false;

  if (s.puxadinho && w > 3.4 && d > 5.2) {
    const w2 = clamp(w * rng.range(0.45, 0.75), 2.6, w - 0.6);
    const d2 = clamp(d * rng.range(0.35, 0.5), 2.4, d - 2.6);
    const px = x0 + rng.range(0.2, w - w2 - 0.2) + w2 / 2;
    const pz = backZ + front * (0.15 + d2 / 2);
    const pH = 2.6;
    b.collider(w2, pH + 0.02, d2, px, roofY + (pH + 0.02) / 2, pz);
    if (!hq) {
      b.box({ w: w2, h: pH, d: d2, x: px, z: pz, y: roofY, mat: m.brick });
      addWindow(b, px, roofY + 1.0, pz + (front * d2) / 2, 'z', front, frameMat, {});
    } else {
      // Puxadinho de tijolo aparente com a janela de verdade virada para a frente.
      const win: Opening = { kind: 'janela', u: px, y0: roofY + 0.9 };
      floorShell(b, px - w2 / 2, pz - d2 / 2, w2, d2, roofY, pH, { zMin: front < 0 ? [win] : [], zMax: front > 0 ? [win] : [], xMin: [], xMax: [] }, hqStyle(m.brick, roofY, true));
    }
    if (rng.chance(0.5)) {
      // Telhado de fibrocimento inclinado.
      if (!hq) b.box({ w: w2 + 0.4, h: 0.05, d: d2 + 0.5, x: px, z: pz + front * 0.1, y: roofY + pH + 0.02, mat: m.corrugated, rx: front * 0.09, tile: 1.2 });
      else {
        addRoof(b, {
          x0: px - w2 / 2,
          z0: pz - d2 / 2,
          w: w2,
          d: d2,
          y: roofY + pH,
          kind: 'meia',
          drain: (-front) as 1 | -1,
          telha: m.hq.fibrocimento,
          tile: HQ_TILE.fibrocimento,
          pitch: 0.16,
          gable: m.hq.tijolo,
        });
      }
    } else {
      if (!hq) b.box({ w: w2 + 0.12, h: 0.18, d: d2 + 0.12, x: px, z: pz, y: roofY + pH - 0.16, mat: m.concrete, tile: 2 });
      else b.box({ w: w2 + 0.12, h: 0.18, d: d2 + 0.12, x: px, z: pz, y: roofY + pH - 0.16, mat: m.hq.concreto, worldUV: { tile: HQ_TILE.concreto } });
      if (rng.chance(0.85)) {
        addWaterTank(b, px + rng.range(-w2 / 4, w2 / 4), roofY + pH + 0.02, pz, hq);
        tankPlaced = true;
      }
    }
    usableDepth = d - d2 - 0.6;
  } else if (rng.chance(0.55)) {
    // Ferros de espera para a próxima laje.
    for (const [ex, ez] of [
      [x0 + 0.25, z0 + 0.25],
      [x0 + w - 0.25, z0 + 0.25],
      [x0 + 0.25, z0 + d - 0.25],
      [x0 + w - 0.25, z0 + d - 0.25],
    ]) {
      for (let r = 0; r < 4; r++) {
        rb.cylinder({ diameter: 0.035, h: rng.range(0.7, 1.1), x: ex + ((r % 2) - 0.5) * 0.1, y: roofY, z: ez + (Math.floor(r / 2) - 0.5) * 0.1, mat: m.rebar, tessellation: 5 });
      }
    }
  }

  if (!tankPlaced && rng.chance(0.75)) {
    const side = rng.chance(0.5) ? 1 : -1;
    addWaterTank(rb, cx + side * (w / 2 - 0.9), roofY, backZ + front * 0.95, hq);
  }

  // Vida na laje.
  const roofFrontZ = frontZ - front * 0.8;
  if (usableDepth > 2.2) {
    if (rng.chance(0.4) && w > 4) {
      addClothesline(rb, rng, cx, roofY, roofFrontZ - front * (usableDepth * 0.5), Math.min(w - 1.2, 4.5), 'x');
    } else if (rng.chance(0.25)) {
      const n = rng.int(2, 3);
      const chairMat = rng.pick([m.plasticRed, m.white, m.plasticBlue]);
      for (let i = 0; i < n; i++) addPlasticChair(rb, cx - 1 + i * 0.8, roofY, roofFrontZ - front * 1.0, front > 0 ? 0 : Math.PI, chairMat);
    }
    const spot = new Vector3(cx + rng.range(-w / 4, w / 4), roofY + 0.05, roofFrontZ - front * Math.min(1.6, usableDepth * 0.4));
    if (!pitched) roofSpots.push(spot);
  }
  if (rng.chance(0.3)) addSatelliteDish(rb, x0 + 0.5, roofY, backZ + front * 0.5, front > 0 ? 0 : Math.PI);
  if (rng.chance(0.4)) {
    for (let i = 0; i < rng.int(1, 3); i++) addPotPlant(rb, rng, x0 + 0.4 + i * 0.5, roofY, frontZ - front * 0.35);
  }

  // Antena de TV numa quina dos fundos da laje.
  if (hq && !pitched && pr.chance(0.4)) {
    const ant = WorldAssets.current?.kit.get('Kit_Antena');
    if (ant) b.model(ant, rng2x(x0, w, pr), roofY, backZ + front * 0.35, pr.range(0, Math.PI), kitMat(b), { collide: false });
  }

  const stairDir = s.stair ? addHouseStair(b, rng, s, frontZ, roofY, hq ? m.hq.concreto : m.concrete) : null;
  addHouseGraffiti(b, s, frontZ);

  return { spec: s, roofY, frontZ, stairDir, roofSpots };
}

interface WindowOpts {
  grade?: boolean;
  shutter?: boolean;
}

function addWindow(b: WorldBuilder, x: number, y: number, faceCoord: number, axis: 'x' | 'z', facing: 1 | -1, frameMat: Material, o: WindowOpts): void {
  const m = b.mats;
  // Tudo construído no eixo Z e "girado" trocando largura/profundidade.
  const put = (w: number, h: number, depth: number, along: number, out: number, yy: number, mat: Material) => {
    if (axis === 'z') b.box({ w, h, d: depth, x: x + along, z: faceCoord + facing * out, y: yy, mat });
    else b.box({ w: depth, h, d: w, x: x + facing * out, z: faceCoord + along, y: yy, mat });
  };
  put(1.18, 1.26, 0.06, 0, 0.03, y - 0.08, frameMat);
  put(1.0, 1.1, 0.07, 0, 0.035, y, m.glass);
  // Basculante: travessa e montante.
  put(0.04, 1.1, 0.09, 0, 0.045, y, frameMat);
  put(1.0, 0.04, 0.09, 0, 0.045, y + 0.62, frameMat);
  // Peitoril de concreto.
  put(1.32, 0.06, 0.16, 0, 0.08, y - 0.14, m.concrete);
  if (o.shutter) {
    put(0.5, 1.14, 0.04, -0.82, 0.04, y - 0.02, frameMat);
    put(0.5, 1.14, 0.04, 0.82, 0.04, y - 0.02, frameMat);
  }
  if (o.grade) {
    for (let i = 0; i < 6; i++) put(0.025, 1.18, 0.025, -0.5 + i * 0.2, 0.12, y - 0.04, m.metalDark);
    put(1.12, 0.03, 0.03, 0, 0.12, y + 0.05, m.metalDark);
    put(1.12, 0.03, 0.03, 0, 0.12, y + 1.0, m.metalDark);
  }
}

function addDoor(b: WorldBuilder, rng: Rng, x: number, y: number, faceZ: number, facing: 1 | -1, frameMat: Material, doorMat: Material): void {
  const m = b.mats;
  b.box({ w: 1.12, h: 2.27, d: 0.06, x, z: faceZ + facing * 0.03, y, mat: frameMat });
  b.box({ w: 0.92, h: 2.12, d: 0.09, x, z: faceZ + facing * 0.045, y, mat: doorMat });
  // Almofadas da porta e maçaneta.
  b.box({ w: 0.62, h: 0.7, d: 0.1, x, z: faceZ + facing * 0.05, y: y + 1.2, mat: doorMat });
  b.box({ w: 0.62, h: 0.7, d: 0.1, x, z: faceZ + facing * 0.05, y: y + 0.3, mat: doorMat });
  b.box({ w: 0.08, h: 0.04, d: 0.06, x: x + 0.33, z: faceZ + facing * 0.12, y: y + 1.0, mat: m.metal });
  // Degrau.
  b.box({ w: 1.3, h: 0.1, d: 0.4, x, z: faceZ + facing * 0.2, y, mat: m.concrete });
  if (rng.chance(0.45)) {
    // Marquise.
    b.box({ w: 1.6, h: 0.08, d: 0.7, x, z: faceZ + facing * 0.35, y: y + 2.45, mat: m.concrete });
  }
  if (rng.chance(0.2)) addGasCylinder(b, x + 0.85, y, faceZ + facing * 0.3);
}

function addWaterTank(b: WorldBuilder, x: number, y: number, z: number, hq = false): void {
  const m = b.mats;
  const r = spotRng(x, z, 3);
  if (hq && !r.chance(0.22) && addKitTank(b, x, y, z, r.range(0, Math.PI))) return;
  if (r.chance(0.22)) {
    // Caixa velha de fibrocimento, sem tampa de rosca e com uma tábua por cima.
    b.cylinder({ diameter: 1.1, diameterTop: 1.3, h: 0.8, x, y, z, mat: m.tankOld, collide: true, tessellation: 16 });
    b.box({ w: 1.4, h: 0.04, d: 0.25, x, z, y: y + 0.8, mat: m.wood, ry: r.range(0, Math.PI) });
    return;
  }
  b.cylinder({ diameter: 1.15, diameterTop: 1.25, h: 0.85, x, y, z, mat: m.tank, collide: true, tessellation: 18 });
  b.cylinder({ diameter: 1.32, h: 0.1, x, y: y + 0.85, z, mat: m.tankLid, tessellation: 18 });
  b.cylinder({ diameter: 0.5, h: 0.06, x, y: y + 0.95, z, mat: m.tankLid, tessellation: 12 });
  // Boia/cano de entrada e o "ladrão" saindo de lado.
  b.pipe(new Vector3(x + 0.55, y + 0.7, z), new Vector3(x + 0.85, y + 0.7, z), 0.025, m.pvc);
  b.pipe(new Vector3(x + 0.85, y + 0.7, z), new Vector3(x + 0.85, y - 0.4, z), 0.025, m.pvc);
}

/** Pichações nas paredes de algumas casas (sorteio pela posição: não muda o resto do mapa). */
function addHouseGraffiti(b: WorldBuilder, s: HouseSpec, frontZ: number): void {
  const r = spotRng(s.x0, s.z0, 11);
  const { x0, w, d, base, front } = s;
  // Lateral (empena) voltada para um beco.
  if (r.chance(0.35)) {
    const side = r.chance(0.5) ? -1 : 1;
    const gw = r.range(1.6, Math.min(3.2, d - 1));
    addGraffitiTag(b, r, side < 0 ? x0 : x0 + w, base + r.range(1.2, 2.2), s.z0 + d / 2 + r.range(-d / 5, d / 5), 'x', side as 1 | -1, gw);
  }
  // Trepadeira subindo por uma lateral.
  const tr = spotRng(s.x0, s.z0, 13);
  if (tr.chance(0.14) && d > 3.5) {
    const side = tr.chance(0.5) ? -1 : 1;
    placeTrepadeira(b, side < 0 ? x0 - 0.01 : x0 + w + 0.01, base, s.z0 + tr.range(1.4, d - 1.4), side, 0, tr.range(0.9, 1.3));
  }
  // Pichação alta na fachada, perto da laje.
  if (r.chance(0.18)) {
    addGraffitiTag(b, r, x0 + w / 2 + r.range(-w / 5, w / 5), base + s.floors * FLOOR_H - 0.55, frontZ, 'z', front, Math.min(2.4, w - 1));
  }
}

/** Escada externa encostada na fachada, terminando num patamar de onde se entra na laje. */
function addHouseStair(b: WorldBuilder, rng: Rng, s: HouseSpec, frontZ: number, roofY: number, mat: Material): 1 | -1 | null {
  const { x0, w, base, front } = s;
  const rise = roofY - base;
  const landing = 1.2;
  const maxRun = w - 0.3 - landing;
  const run = Math.min(rise / Math.tan(0.7), maxRun);
  if (run <= 0 || rise / run > Math.tan(1.0)) return null; // íngreme demais para essa casa

  const dir = rng.chance(0.5) ? 1 : -1;
  const xL = dir > 0 ? x0 + 0.15 : x0 + w - 0.15;
  const xH = xL + dir * run;
  const sd = 1.1;
  const zc = frontZ + front * (0.06 + sd / 2);
  const m = b.mats;

  buildStairs(b, { x: xL, z: zc, base, axis: 'x', dir, run, rise, width: sd, mat, stepHeight: 0.23, rails: dir * front > 0 ? { left: true, right: false } : { left: false, right: true } });

  // Patamar (maciço até o chão) com guarda-corpo.
  b.box({ w: landing, h: rise, d: sd, x: xH + (dir * landing) / 2, z: zc, y: base, mat, collide: true, tile: 2 });
  const outer = zc + front * (sd / 2 - 0.05);
  b.pipe(new Vector3(xH, roofY + 0.95, outer), new Vector3(xH + dir * landing, roofY + 0.95, outer), 0.025, m.metal);
  b.pipe(new Vector3(xH + dir * landing, roofY, outer), new Vector3(xH + dir * landing, roofY + 0.95, outer), 0.02, m.metal);
  b.contactShadow(xL + (dir * (run + landing)) / 2, zc, run + landing, sd, base, 0.45);
  return dir;
}

/** X de uma das quinas (sorteio do gerador do lugar). */
function rng2x(x0: number, w: number, r: Rng): number {
  return r.chance(0.5) ? x0 + 0.35 : x0 + w - 0.35;
}

/** Porta de madeira do kit no vão (mesmos sorteios da porta antiga: marquise e botijão). */
function addDoorHQ(b: WorldBuilder, rng: Rng, x: number, y: number, f: Face, ops: Opening[]): void {
  const m = b.mats;
  ops.push({ kind: 'porta', u: x, y0: y });
  if (rng.chance(0.45)) {
    // Marquise de concreto sobre a porta.
    b.box({ w: 1.6, h: 0.08, d: 0.7, x, z: f.coord + f.facing * 0.35, y: y + 2.42, mat: m.hq.concreto, tile: HQ_TILE.concreto });
  }
  if (rng.chance(0.2)) addGasCylinder(b, x + 0.85, y, f.coord + f.facing * 0.3);
}