import { Material, StandardMaterial, Vector3 } from '@babylonjs/core';
import { WorldAssets, WorldModel } from '../WorldAssets';
import { BoxOptions, WorldBuilder } from '../WorldBuilder';
import { HQ_TILE, OLD_MAP } from '../MaterialsHQ';

/**
 * Casas reconstruídas (Fase 4 num setor, Fase 5 no mapa todo): paredes com vãos de verdade
 * (as janelas e portas do kit ficam recuadas dentro da espessura da parede), telhados
 * inclinados com beiral e calha, e os objetos do kit (caixa d'água, medidor, ar, antena).
 */

/** Casas novas valem com o kit carregado (e sem `?mapaAntigo`, que remonta o mapa antigo). */
export function hqReady(): boolean {
  return !OLD_MAP && (WorldAssets.current?.kit.size ?? 0) > 0;
}

/** Espessura do "reboco + bloco" das paredes de fora. */
export const WALL_T = 0.16;

/**
 * Face de parede: plano `axis` = coord (axis 'z': plano z = coord, correndo em x de a0 a a1),
 * com a face de fora virada para `facing`.
 */
export interface Face {
  axis: 'x' | 'z';
  coord: number;
  facing: 1 | -1;
  a0: number;
  a1: number;
}

export type OpeningKind = 'janela' | 'basculante' | 'porta' | 'portao';

export interface Opening {
  kind: OpeningKind;
  /** Centro ao longo da face. */
  u: number;
  /** Base do vão (y absoluto). */
  y0: number;
  grade?: boolean;
  /** Cor da chapa (portão). */
  tint?: StandardMaterial;
}

/** Peça do kit e o vão que ela ocupa (tamanho nominal + batente dos dois lados). */
const KIT: Record<OpeningKind, { name: string; w: number; h: number }> = {
  janela: { name: 'Kit_Janela', w: 1.2 + 0.09, h: 1.0 + 0.09 },
  basculante: { name: 'Kit_Basculante', w: 0.6 + 0.07, h: 0.6 + 0.07 },
  porta: { name: 'Kit_Porta', w: 0.9 + 0.12, h: 2.1 + 0.12 },
  portao: { name: 'Kit_Portao', w: 2.6 + 0.12, h: 2.2 + 0.12 },
};

export function openingSize(kind: OpeningKind): { w: number; h: number } {
  return KIT[kind];
}

export type UV = NonNullable<BoxOptions['worldUV']>;

/** Giro (em y) que leva o +Z do kit para fora da face. */
function faceYaw(f: Face): number {
  if (f.axis === 'z') return f.facing > 0 ? 0 : Math.PI;
  return f.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/** Ponto na face: `u` ao longo dela, `out` para fora (negativo = para dentro da parede). */
function facePoint(f: Face, u: number, y: number, out: number): Vector3 {
  return f.axis === 'z' ? new Vector3(u, y, f.coord + f.facing * out) : new Vector3(f.coord + f.facing * out, y, u);
}

/** Caixa na face: de p0 a p1 ao longo, de ya a yb na altura, `depth` para dentro a partir de `out`. */
function faceBox(b: WorldBuilder, f: Face, p0: number, p1: number, ya: number, yb: number, depth: number, out: number, mat: Material, uv?: UV): void {
  const len = p1 - p0;
  const h = yb - ya;
  if (len < 0.005 || h < 0.005) return;
  const c = facePoint(f, (p0 + p1) / 2, ya, out - depth / 2);
  if (f.axis === 'z') b.box({ w: len, h, d: depth, x: c.x, z: c.z, y: ya, mat, worldUV: uv });
  else b.box({ w: depth, h, d: len, x: c.x, z: c.z, y: ya, mat, worldUV: uv });
}

/** Coloca uma peça do kit (sem colisor) na face. */
export function placeKit(b: WorldBuilder, name: string, f: Face, u: number, y: number, mat: (role: string) => Material | null, out = 0): void {
  const model = WorldAssets.current?.kit.get(name);
  if (!model) return;
  const p = facePoint(f, u, y, out);
  b.model(model, p.x, p.y, p.z, faceYaw(f), mat, { collide: false });
}

export interface ShellStyle {
  mat: Material;
  uv: UV;
  /** Tijolo aparente: vergas de concreto sobre os vãos. */
  brick: boolean;
  /** Fundo dos vãos de janela (cômodo na penumbra). */
  interior: Material;
}

/**
 * Parede de fora com vãos: montantes, peitoris e vergas em volta de cada abertura (com a
 * espessura WALL_T), as peças do kit dentro dos vãos e o fundo escuro atrás do vidro.
 */
export function wallWithOpenings(b: WorldBuilder, f: Face, y0: number, H: number, openings: Opening[], st: ShellStyle): void {
  const hq = b.mats.hq;
  const list = [...openings].sort((a, c) => a.u - c.u);
  let cursor = f.a0;
  const top = y0 + H;
  for (const o of list) {
    const k = KIT[o.kind];
    const l = o.u - k.w / 2;
    const r = o.u + k.w / 2;
    const oy1 = Math.min(o.y0 + k.h, top);
    faceBox(b, f, cursor, l, y0, top, WALL_T, 0, st.mat, st.uv);
    faceBox(b, f, l, r, y0, o.y0, WALL_T, 0, st.mat, st.uv);
    faceBox(b, f, l, r, oy1, top, WALL_T, 0, st.mat, st.uv);
    cursor = r;
    if (st.brick && oy1 + 0.14 < top) faceBox(b, f, l - 0.12, r + 0.12, oy1, oy1 + 0.14, WALL_T + 0.01, 0.01, hq.concreto, { tile: HQ_TILE.concreto });
    if (o.kind === 'janela' || o.kind === 'basculante') faceBox(b, f, l, r, o.y0, oy1, 0.02, -(WALL_T - 0.02), st.interior);
    const tint = o.tint;
    const role = (name: string) => hq.kitRole(name, tint);
    placeKit(b, k.name, f, o.u, o.y0 + k.h / 2, role);
    if (o.grade && o.kind === 'janela') placeKit(b, 'Kit_Grade', f, o.u, o.y0 + k.h / 2, role);
  }
  faceBox(b, f, cursor, f.a1, y0, top, WALL_T, 0, st.mat, st.uv);
}

/**
 * Caixa de pavimento: as quatro faces com vãos (WALL_T) e o miolo maciço por dentro.
 * `faces` na ordem: frente/fundos (eixo z) e laterais (eixo x) — as laterais ficam entre as
 * outras duas para as quinas não se sobreporem.
 */
export function floorShell(
  b: WorldBuilder,
  x0: number,
  z0: number,
  w: number,
  d: number,
  y0: number,
  H: number,
  openings: { zMin: Opening[]; zMax: Opening[]; xMin: Opening[]; xMax: Opening[] },
  st: ShellStyle,
): void {
  const t = WALL_T;
  b.box({ w: w - 2 * t, h: H, d: d - 2 * t, x: x0 + w / 2, z: z0 + d / 2, y: y0, mat: st.interior });
  wallWithOpenings(b, { axis: 'z', coord: z0, facing: -1, a0: x0, a1: x0 + w }, y0, H, openings.zMin, st);
  wallWithOpenings(b, { axis: 'z', coord: z0 + d, facing: 1, a0: x0, a1: x0 + w }, y0, H, openings.zMax, st);
  wallWithOpenings(b, { axis: 'x', coord: x0, facing: -1, a0: z0 + t, a1: z0 + d - t }, y0, H, openings.xMin, st);
  wallWithOpenings(b, { axis: 'x', coord: x0 + w, facing: 1, a0: z0 + t, a1: z0 + d - t }, y0, H, openings.xMax, st);
}

export interface RoofSpec {
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** Topo da laje/parede onde o telhado apoia. */
  y: number;
  /** 'duas': cumeeira no meio, ao longo de x; 'meia': uma água só, escorrendo para `drain` (z). */
  kind: 'duas' | 'meia';
  drain: 1 | -1;
  telha: Material;
  tile: number;
  /** Inclinação (rad). */
  pitch: number;
  /** Material do oitão (o triângulo de parede da empena). */
  gable: Material;
}

const EAVE = 0.45;
const SIDE = 0.3;

/**
 * Telhado de telha (ou fibrocimento) com beiral, cumeeira, oitões de parede, calha e cano.
 * Colisores acompanham as águas (dá para andar no telhado).
 */
export function addRoof(b: WorldBuilder, r: RoofSpec): void {
  const hq = b.mats.hq;
  const cx = r.x0 + r.w / 2;
  const tan = Math.tan(r.pitch);
  const thick = 0.05;
  const panel = (zHigh: number, zLow: number, yHigh: number) => {
    // água descendo de zHigh (y = yHigh) para zLow, passando do beiral
    const dir = Math.sign(zLow - zHigh);
    const run = Math.abs(zLow - zHigh) + EAVE;
    const len = run / Math.cos(r.pitch);
    const zc = zHigh + (dir * run) / 2;
    const yc = yHigh - (run / 2) * tan;
    // rotation.x positivo abaixa o lado +z
    const rx = dir * r.pitch;
    b.box({ w: r.w + 2 * SIDE, h: thick, d: len, x: cx, cy: yc + thick / 2, z: zc, mat: r.telha, tile: r.tile, rx, topUV: true });
    b.collider(r.w + 2 * SIDE, 0.3, len, cx, yc - 0.15 / Math.cos(r.pitch) + thick, zc, rx, 0, 0);
    // calha na beirada de baixo
    const zEave = zHigh + dir * run;
    const yEave = yHigh - run * tan;
    b.box({ w: r.w + 2 * SIDE, h: 0.1, d: 0.12, x: cx, z: zEave + dir * 0.04, y: yEave - 0.1, mat: hq.calha });
    return { zEave, yEave };
  };
  let eaves: Array<{ zEave: number; yEave: number }>;
  const gable = (profile: Array<[number, number]>) => {
    // oitões nas duas laterais (perfil no plano z × y, extrudado em x)
    for (const x of [r.x0 + WALL_T / 2, r.x0 + r.w - WALL_T / 2]) b.extrude(profile, WALL_T, r.gable, x, r.y, r.z0 + r.d / 2, Math.PI / 2);
  };
  if (r.kind === 'duas') {
    const zm = r.z0 + r.d / 2;
    const rise = (r.d / 2) * tan;
    const yr = r.y + rise;
    eaves = [panel(zm, r.z0 + r.d, yr), panel(zm, r.z0, yr)];
    b.box({ w: r.w + 2 * SIDE, h: 0.1, d: 0.26, x: cx, z: zm, cy: yr + 0.07, mat: r.telha, tile: r.tile });
    gable([
      [-r.d / 2, 0],
      [r.d / 2, 0],
      [0, rise],
    ]);
  } else {
    const zHigh = r.drain > 0 ? r.z0 : r.z0 + r.d;
    const zLow = r.drain > 0 ? r.z0 + r.d : r.z0;
    const rise = r.d * tan;
    eaves = [panel(zHigh - r.drain * 0.15, zLow, r.y + rise + 0.15 * tan)];
    // a parede alta (frente do caimento) sobe até a telha
    const hi = r.drain > 0 ? r.d / 2 : -r.d / 2;
    gable([
      [-r.d / 2, 0],
      [r.d / 2, 0],
      [hi, rise],
    ]);
  }
  // cano descendo de uma ponta da calha
  const e = eaves[0];
  const px = r.x0 - SIDE + 0.15;
  b.cylinder({ diameter: 0.09, h: Math.max(0.2, e.yEave - 0.1), x: px, y: 0, z: e.zEave, mat: b.mats.pvc, tessellation: 8 });
}

/** Material por papel para peças soltas do kit. */
export function kitMat(b: WorldBuilder): (role: string) => Material | null {
  return (role) => b.mats.hq.kitRole(role);
}

/** Caixa d'água de 1000 L do kit, com colisor. */
export function addKitTank(b: WorldBuilder, x: number, y: number, z: number, ry = 0): boolean {
  const model: WorldModel | undefined = WorldAssets.current?.kit.get('Kit_Caixa');
  if (!model) return false;
  b.model(model, x, y, z, ry, kitMat(b), { collide: false });
  b.collider(1.35, 1.02, 1.35, x, y + 0.51, z);
  return true;
}

/**
 * Estilo de parede nova a partir de um material antigo (tijolo ou uma das tintas): tijolo em
 * escala real, ou reboco pintado com a umidade só no pavimento térreo.
 */
export function shellStyleFor(b: WorldBuilder, mat: Material, fy: number, upper: boolean, interior: Material): ShellStyle {
  const m = b.mats;
  if (mat === m.brick) return { mat: m.hq.tijolo, brick: true, interior, uv: { tile: HQ_TILE.tijolo } };
  const paint = m.hq.paint(m.paints.indexOf(mat as StandardMaterial));
  const uv = upper ? { tile: HQ_TILE.rebocoU, tileV: 3 / 0.67, y0: fy, v0: 0.33 } : { tile: HQ_TILE.rebocoU, tileV: 3, y0: fy };
  return { mat: paint, brick: false, interior, uv };
}