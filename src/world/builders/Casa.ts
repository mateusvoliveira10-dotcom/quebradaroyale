import { Material, Mesh, Vector3, VertexData } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { WorldBuilder } from '../WorldBuilder';
import { addRoof, placeKit } from './HouseHQ';
import { furnishRoom, RoomKind } from './Moveis';
import { makeArch, makeDoor } from './Portas';
import { buildStairs } from './Stairs';

/**
 * Casas com cômodos de verdade (bairro, mansões, sede da fazenda): a planta é sorteada num
 * referencial local (u ao longo da fachada, v para o fundo, frente em v = 0) como uma lista
 * de cômodos retangulares e de vãos (portas, arcos, janelas). As paredes saem das arestas
 * dos cômodos: aresta com cômodo dos dois lados = parede interna; de um lado só = parede de
 * fora (com janelas do kit). Portas são as de `Portas.ts` (registradas, abrem com E), a
 * escada sobe por um vão na laje, e cada cômodo recebe os móveis do seu tipo (`Moveis.ts`).
 */

type Kind = RoomKind | 'escada' | 'varanda';
type OpenKind = 'porta' | 'portaDupla' | 'portao' | 'arco' | 'aberto' | 'guarda' | 'janela' | 'basculante' | 'vidro';

interface Room {
  kind: Kind;
  f: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

interface Open {
  f: number;
  /** 'u': parede no plano u = c (corre em v); 'v': plano v = c (corre em u). */
  line: 'u' | 'v';
  c: number;
  /** Centro e largura do vão ao longo da parede. */
  at: number;
  w: number;
  kind: OpenKind;
}

interface Plan {
  L: number;
  D: number;
  floors: number;
  rooms: Room[];
  opens: Open[];
}

export type Lado = 'x0' | 'x1' | 'z0' | 'z1';
export type CasaTipo = 'terrea' | 'sobrado' | 'mansao';

export interface CasaStyle {
  /** Parede de fora (térreo e de cima). */
  parede: Material;
  parede2?: Material;
  /** Paredes de dentro. */
  interno: Material;
  telha: Material;
  telhado: 'duas' | 'quatro' | 'laje';
  /** Piso das áreas sociais e dos quartos. */
  piso: Material;
  pisoQuarto: Material;
  porta: Material;
  /** Acabamento de mansão (móveis, vidros grandes na sala). */
  rico: boolean;
}

export interface CasaSpec {
  /** Retângulo da casa no mundo e o nível do chão. */
  x0: number;
  z0: number;
  w: number;
  d: number;
  y: number;
  /** Lado da fachada (porta de entrada). */
  front: Lado;
  tipo: CasaTipo;
  garagem?: boolean;
  style: CasaStyle;
  /** Fração dos cômodos com loot (1 = todos). */
  lootChance?: number;
  /** Alicerce de pedra abaixo do piso (m), para terreno inclinado. */
  fundacao?: number;
}

export interface CasaResult {
  loot: Array<{ pos: Vector3; tier: 0 | 1 | 2 }>;
  doors: number;
  rooms: number;
  /** Ponto na calçada em frente à porta de entrada. */
  entry: Vector3;
  /** Ponto em frente ao portão da garagem (se houver). */
  garage: Vector3 | null;
}

/** Pé-direito, laje e espessuras. */
const FLOOR = 3.0;
const WALL_H = 2.8;
const TE = 0.16;
const TI = 0.12;
const DOOR_H = 2.1;
/** Piso do térreo acima do chão. */
const LIFT = 0.08;

// ------------------------------------------------------------------ plantas

function room(p: Plan, kind: Kind, f: number, u0: number, u1: number, v0: number, v1: number): Room {
  const r = { kind, f, u0, u1, v0, v1 };
  p.rooms.push(r);
  return r;
}

function open(p: Plan, f: number, line: 'u' | 'v', c: number, at: number, w: number, kind: OpenKind): void {
  p.opens.push({ f, line, c, at, w, kind });
}

/** Porta no meio da aresta comum entre dois trechos (clampada para caber). */
function doorAt(lo: number, hi: number, w: number, t = 0.5): number {
  return Math.min(hi - w / 2 - 0.25, Math.max(lo + w / 2 + 0.25, lo + (hi - lo) * t));
}

/** Casa térrea: sala (e cozinha) na frente, corredor no meio com quartos e banheiro dos lados. */
function planTerrea(L: number, D: number, rng: Rng, garagem: boolean): Plan {
  const p: Plan = { L, D, floors: 1, rooms: [], opens: [] };
  let Lh = L;
  if (garagem && L >= 9.6) {
    Lh = L - 3.5;
    const gd = D - 6 >= 2.4 ? 6 : D;
    room(p, 'garagem', 0, Lh, L, 0, gd);
    open(p, 0, 'v', 0, Lh + 1.75, 2.7, 'portao');
    if (gd < D) {
      room(p, 'lavanderia', 0, Lh, L, gd, D);
      open(p, 0, 'v', gd, Lh + 1.2, 0.85, 'porta');
    }
  }
  const vf = Math.min(5.6, Math.max(3.8, D * rng.range(0.4, 0.48)));
  const B = D - vf;
  if (Lh < 7 || B < 3) {
    // Casa pequena: sala/cozinha na frente, quarto e banheiro atrás, portas para a sala.
    const us = Lh * rng.range(0.55, 0.65);
    if (Lh >= 6) {
      room(p, 'sala', 0, 0, us, 0, vf);
      room(p, 'cozinha', 0, us, Lh, 0, vf);
      open(p, 0, 'u', us, vf * 0.5, 1.3, 'arco');
    } else room(p, 'sala', 0, 0, Lh, 0, vf);
    const ub = Lh - Math.max(1.9, Math.min(2.4, Lh * 0.32));
    room(p, 'quarto', 0, 0, ub, vf, D);
    room(p, Lh >= 6 ? 'banheiro' : 'banheiro', 0, ub, Lh, vf, D);
    open(p, 0, 'v', vf, doorAt(0, Math.min(ub, us), 0.85, 0.6), 0.85, 'porta');
    open(p, 0, 'v', vf, doorAt(ub, Lh, 0.75), 0.75, 'porta');
    open(p, 0, 'v', 0, doorAt(0, Lh >= 6 ? us : Lh, 0.95, rng.range(0.3, 0.7)), 0.95, 'porta');
    if (garagem && Lh < L) open(p, 0, 'u', Lh, vf * 0.5, 0.85, 'porta');
    return p;
  }
  // Corredor: o lado direito dele alinha com a divisa sala | cozinha.
  const uc = Math.min(Lh - 1.2 - 2.9, Math.max(2.9, Lh * rng.range(0.38, 0.52) - 0.6));
  const us = uc + 1.2;
  room(p, 'sala', 0, 0, us, 0, vf);
  room(p, 'cozinha', 0, us, Lh, 0, vf);
  open(p, 0, 'u', us, vf * rng.range(0.4, 0.6), 1.4, 'arco');
  room(p, 'corredor', 0, uc, us, vf, D);
  open(p, 0, 'v', vf, uc + 0.6, 0.95, 'arco');
  const back: Room[] = [];
  for (const [a, b, wallU] of [[0, uc, uc], [us, Lh, us]] as const) {
    if (B >= 5.8) {
      const vs = vf + B * rng.range(0.42, 0.58);
      back.push(room(p, 'quarto', 0, a, b, vf, vs), room(p, 'quarto', 0, a, b, vs, D));
      open(p, 0, 'u', wallU, doorAt(vf, vs, 0.85), 0.85, 'porta');
      open(p, 0, 'u', wallU, doorAt(vs, D, 0.85), 0.85, 'porta');
    } else {
      back.push(room(p, 'quarto', 0, a, b, vf, D));
      open(p, 0, 'u', wallU, doorAt(vf, D, 0.85), 0.85, 'porta');
    }
  }
  nameBack(back, rng);
  open(p, 0, 'v', 0, doorAt(0, us, 0.95, rng.range(0.25, 0.6)), 0.95, 'porta');
  if (rng.chance(0.7)) open(p, 0, 'v', D, uc + 0.6, 0.85, 'porta');
  if (Lh < L) open(p, 0, 'u', Lh, vf * 0.5, 0.85, 'porta');
  return p;
}

/** Dá nome aos cômodos do fundo: o menor vira banheiro, o maior suíte, um pode ser escritório. */
function nameBack(rooms: Room[], rng: Rng): void {
  const area = (r: Room) => (r.u1 - r.u0) * (r.v1 - r.v0);
  const sorted = [...rooms].sort((a, b) => area(a) - area(b));
  sorted[0].kind = 'banheiro';
  if (sorted.length >= 2 && area(sorted[sorted.length - 1]) >= 11) sorted[sorted.length - 1].kind = 'suite';
  if (sorted.length >= 4 && rng.chance(0.6)) sorted[1].kind = rng.chance(0.5) ? 'escritorio' : 'tv';
}

/**
 * Sobrado: escada encostada na lateral (sobe a partir da sala), corredor ao lado e os
 * cômodos do outro lado; em cima, suíte na frente e quartos atrás.
 */
function planSobrado(L: number, D: number, rng: Rng, garagem: boolean): Plan {
  const p: Plan = { L, D, floors: 2, rooms: [], opens: [] };
  let Lh = L;
  if (garagem && L >= 10) {
    Lh = L - 3.5;
    room(p, 'garagem', 0, Lh, L, 0, Math.min(D, 6.2));
    open(p, 0, 'v', 0, Lh + 1.75, 2.7, 'portao');
  }
  const SB = 1.15;
  const UC = SB + 1.25;
  const vf = Math.min(D - 5.5, Math.max(3.8, D * rng.range(0.38, 0.46)));
  const vt = vf + 4.4;
  const B = D - vf;
  for (const f of [0, 1]) {
    room(p, 'escada', f, 0, SB, vf, vt);
    room(p, 'corredor', f, SB, UC, vf, D);
  }
  // Térreo.
  const split = Lh >= 8;
  const us = split ? Math.max(UC + 1.2, Lh * rng.range(0.52, 0.62)) : Lh;
  room(p, 'sala', 0, 0, us, 0, vf);
  if (split) {
    room(p, 'cozinha', 0, us, Lh, 0, vf);
    open(p, 0, 'u', us, vf * rng.range(0.4, 0.6), 1.4, 'arco');
  }
  open(p, 0, 'v', vf, SB / 2, SB - 0.1, 'aberto');
  open(p, 0, 'v', vf, SB + 0.62, 0.95, 'arco');
  room(p, 'despensa', 0, 0, SB, vt, D);
  open(p, 0, 'u', SB, doorAt(vt, D, 0.7), 0.7, 'porta');
  const vs = vf + B * rng.range(0.42, 0.58);
  const g0 = room(p, split ? 'jantar' : 'cozinha', 0, UC, Lh, vf, vs);
  const g1 = room(p, 'lavabo', 0, UC, Lh, vs, D);
  if (Lh - UC >= 3.4) {
    // Fundo largo: lavabo num canto e escritório/quarto no resto.
    g1.u1 = UC + 1.9;
    room(p, rng.chance(0.5) ? 'escritorio' : 'quarto', 0, UC + 1.9, Lh, vs, D);
    open(p, 0, 'v', vs, doorAt(UC + 1.9, Lh, 0.85), 0.85, 'porta');
  }
  open(p, 0, 'u', UC, doorAt(vf, vs, 0.9), g0.kind === 'jantar' ? 1.2 : 0.9, g0.kind === 'jantar' ? 'arco' : 'porta');
  open(p, 0, 'u', UC, doorAt(vs, D, 0.75), 0.75, 'porta');
  open(p, 0, 'v', 0, doorAt(0, us, 0.95, rng.range(0.3, 0.7)), 0.95, 'porta');
  open(p, 0, 'v', D, SB + 0.62, 0.85, 'porta');
  if (Lh < L) open(p, 0, 'u', Lh, Math.min(vf, 6.2) * 0.5, 0.85, 'porta');
  // Em cima.
  open(p, 1, 'u', SB, (vf + vt) / 2, vt - vf, 'guarda');
  open(p, 1, 'v', vt, SB / 2, SB - 0.1, 'aberto');
  room(p, 'corredor', 1, 0, SB, vt, D);
  open(p, 1, 'u', SB, (vt + D) / 2, D - vt - 0.1, 'aberto');
  if (Lh >= 8.2) {
    const ub = Lh - 2.3;
    room(p, 'suite', 1, 0, ub, 0, vf);
    room(p, 'banheiro', 1, ub, Lh, 0, vf);
    open(p, 1, 'u', ub, doorAt(0, vf, 0.75), 0.75, 'porta');
  } else room(p, 'suite', 1, 0, Lh, 0, vf);
  open(p, 1, 'v', vf, SB + 0.62, 0.85, 'porta');
  if (B >= 7.4) {
    const a = vf + (B - 2.1) / 2;
    room(p, 'quarto', 1, UC, Lh, vf, a);
    room(p, 'banheiro', 1, UC, Lh, a, a + 2.1);
    room(p, 'quarto', 1, UC, Lh, a + 2.1, D);
    open(p, 1, 'u', UC, doorAt(vf, a, 0.85), 0.85, 'porta');
    open(p, 1, 'u', UC, a + 1.05, 0.75, 'porta');
    open(p, 1, 'u', UC, doorAt(a + 2.1, D, 0.85), 0.85, 'porta');
  } else {
    const a = vf + B - 2.2;
    room(p, 'quarto', 1, UC, Lh, vf, a);
    room(p, Lh >= 8.2 ? 'escritorio' : 'banheiro', 1, UC, Lh, a, D);
    open(p, 1, 'u', UC, doorAt(vf, a, 0.85), 0.85, 'porta');
    open(p, 1, 'u', UC, doorAt(a, D, 0.75), 0.75, 'porta');
  }
  return p;
}

/**
 * Mansão: hall central com porta dupla e escada, sala e sala de jantar nas alas, cozinha,
 * despensa, lavanderia, escritório e sala de TV atrás; em cima, galeria, estar e suítes com
 * closet e banheiro.
 */
function planMansao(L: number, D: number, rng: Rng): Plan {
  const p: Plan = { L, D, floors: 2, rooms: [], opens: [] };
  const HW = rng.range(4.6, 5.4);
  const h0 = (L - HW) / 2 + rng.range(-0.8, 0.8);
  const h1 = h0 + HW;
  const SB = 1.35;
  const vf = Math.min(D - 6.4, rng.range(5.6, 6.6));
  const vt = vf + 4.4;
  // Térreo.
  room(p, 'hall', 0, h0, h1, 0, vf);
  open(p, 0, 'v', 0, (h0 + h1) / 2, 1.8, 'portaDupla');
  room(p, 'sala', 0, 0, h0, 0, vf);
  open(p, 0, 'u', h0, vf * 0.5, 2.4, 'arco');
  room(p, 'jantar', 0, h1, L, 0, vf);
  open(p, 0, 'u', h1, vf * 0.5, 2.0, 'arco');
  for (const f of [0, 1]) room(p, 'escada', f, h0, h0 + SB, vf, vt);
  open(p, 0, 'v', vf, h0 + SB / 2, SB - 0.1, 'aberto');
  room(p, 'corredor', 0, h0 + SB, h1, vf, D);
  open(p, 0, 'v', vf, (h0 + SB + h1) / 2, h1 - h0 - SB - 0.5, 'aberto');
  room(p, 'lavabo', 0, h0, h0 + SB, vt, D);
  open(p, 0, 'u', h0 + SB, doorAt(vt, D, 0.7), 0.7, 'porta');
  open(p, 0, 'v', D, (h0 + SB + h1) / 2, 1.6, 'portaDupla');
  // Ala esquerda atrás: escritório e sala de TV, com portas para a sala.
  const ue = h0 * rng.range(0.42, 0.55);
  room(p, 'escritorio', 0, 0, ue, vf, D);
  room(p, 'tv', 0, ue, h0, vf, D);
  open(p, 0, 'v', vf, doorAt(0, ue, 0.9), 0.9, 'porta');
  open(p, 0, 'v', vf, doorAt(ue, h0, 1.4), 1.4, 'arco');
  // Ala direita atrás: cozinha grande, despensa e lavanderia.
  const uk = L - 2.6;
  const vm = vf + (D - vf) * 0.45;
  room(p, 'cozinha', 0, h1, uk, vf, D);
  open(p, 0, 'v', vf, doorAt(h1, uk, 1.4), 1.4, 'arco');
  open(p, 0, 'u', h1, doorAt(vf, D, 0.9, 0.7), 0.9, 'porta');
  room(p, 'despensa', 0, uk, L, vf, vm);
  room(p, 'lavanderia', 0, uk, L, vm, D);
  open(p, 0, 'u', uk, doorAt(vf, vm, 0.75), 0.75, 'porta');
  open(p, 0, 'u', uk, doorAt(vm, D, 0.75), 0.75, 'porta');
  // Em cima: estar sobre o hall, galeria, suíte principal à esquerda, suíte e quarto à direita.
  room(p, 'tv', 1, h0, h1, 0, vf);
  open(p, 1, 'v', vf, h0 + SB / 2, SB, 'guarda');
  open(p, 1, 'v', vf, (h0 + SB + h1) / 2, h1 - h0 - SB - 0.5, 'aberto');
  room(p, 'corredor', 1, h0 + SB, h1, vf, D);
  open(p, 1, 'u', h0 + SB, (vf + vt) / 2, vt - vf, 'guarda');
  open(p, 1, 'v', vt, h0 + SB / 2, SB - 0.1, 'aberto');
  room(p, 'corredor', 1, h0, h0 + SB, vt, D);
  open(p, 1, 'u', h0 + SB, (vt + D) / 2, D - vt - 0.1, 'aberto');
  room(p, 'suite', 1, 0, h0, 0, vf);
  open(p, 1, 'u', h0, doorAt(0, vf, 0.9, 0.6), 0.9, 'porta');
  room(p, 'closet', 1, 0, ue, vf, D);
  room(p, 'banheiro', 1, ue, h0, vf, D);
  open(p, 1, 'v', vf, doorAt(0, ue, 0.8), 0.8, 'porta');
  open(p, 1, 'v', vf, doorAt(ue, h0, 0.8), 0.8, 'porta');
  room(p, 'suite', 1, h1, L, 0, vf);
  open(p, 1, 'u', h1, doorAt(0, vf, 0.9, 0.6), 0.9, 'porta');
  const um = L - 2.6;
  room(p, 'quarto', 1, h1, um, vf, D);
  open(p, 1, 'u', h1, doorAt(vf, D, 0.9, 0.7), 0.9, 'porta');
  room(p, 'banheiro', 1, um, L, vf, vm);
  open(p, 1, 'v', vf, doorAt(um, L, 0.75), 0.75, 'porta');
  room(p, 'closet', 1, um, L, vm, D);
  open(p, 1, 'u', um, doorAt(vm, D, 0.75), 0.75, 'porta');
  return p;
}

// ------------------------------------------------------------------ paredes a partir dos cômodos

interface Wall {
  line: 'u' | 'v';
  c: number;
  a0: number;
  a1: number;
  /** 0 = interna; ±1 = de fora, com o cômodo do lado + ou −. */
  side: number;
}

function wallsOf(rooms: Room[]): Wall[] {
  const lines = new Map<string, { line: 'u' | 'v'; c: number; edges: Array<{ a0: number; a1: number; side: number }> }>();
  const add = (line: 'u' | 'v', c: number, a0: number, a1: number, side: number) => {
    const key = `${line}${c.toFixed(2)}`;
    let l = lines.get(key);
    if (!l) lines.set(key, (l = { line, c, edges: [] }));
    l.edges.push({ a0, a1, side });
  };
  for (const r of rooms) {
    if (r.kind === 'varanda') continue;
    add('u', r.u0, r.v0, r.v1, 1);
    add('u', r.u1, r.v0, r.v1, -1);
    add('v', r.v0, r.u0, r.u1, 1);
    add('v', r.v1, r.u0, r.u1, -1);
  }
  const out: Wall[] = [];
  for (const l of lines.values()) {
    const pts = [...new Set(l.edges.flatMap((e) => [e.a0, e.a1]).map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    let cur: Wall | null = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = (pts[i] + pts[i + 1]) / 2;
      const pos = l.edges.some((e) => e.side > 0 && e.a0 < mid && e.a1 > mid);
      const neg = l.edges.some((e) => e.side < 0 && e.a0 < mid && e.a1 > mid);
      if (!pos && !neg) {
        cur = null;
        continue;
      }
      const side = pos && neg ? 0 : pos ? 1 : -1;
      if (cur && cur.side === side && Math.abs(cur.a1 - pts[i]) < 0.011) cur.a1 = pts[i + 1];
      else out.push((cur = { line: l.line, c: l.c, a0: pts[i], a1: pts[i + 1], side }));
    }
  }
  return out;
}

function windowKind(kind: Kind, rico: boolean): { kind: OpenKind; w: number } | null {
  switch (kind) {
    case 'banheiro':
    case 'lavabo':
    case 'lavanderia':
      return { kind: 'basculante', w: 0.67 };
    case 'garagem':
    case 'despensa':
    case 'closet':
    case 'escada':
    case 'varanda':
      return null;
    case 'sala':
    case 'jantar':
      return rico ? { kind: 'vidro', w: 2.2 } : { kind: 'janela', w: 1.29 };
    default:
      return { kind: 'janela', w: 1.29 };
  }
}

// ------------------------------------------------------------------ construção

/** Monta a casa no mundo. */
export function buildCasa(b: WorldBuilder, rng: Rng, s: CasaSpec): CasaResult {
  const m = b.mats;
  const hq = m.hq;
  const st = s.style;
  const zFront = s.front === 'z0' || s.front === 'z1';
  const L = zFront ? s.w : s.d;
  const D = zFront ? s.d : s.w;
  const plan = s.tipo === 'mansao' ? planMansao(L, D, rng) : s.tipo === 'sobrado' ? planSobrado(L, D, rng, !!s.garagem) : planTerrea(L, D, rng, !!s.garagem);

  // Referencial local → mundo: u no eixo A (ao longo da fachada), v no eixo B (para o fundo).
  const mirror = rng.chance(0.5);
  const su = mirror ? -1 : 1;
  const sv = s.front === 'z0' || s.front === 'x0' ? 1 : -1;
  const aMin = zFront ? s.x0 : s.z0;
  const bMin = zFront ? s.z0 : s.x0;
  const U = (u: number) => (su > 0 ? aMin + u : aMin + L - u);
  const V = (v: number) => (sv > 0 ? bMin + v : bMin + D - v);
  /** Ponto do mundo a partir de (coordenada no eixo A, coordenada no eixo B). */
  const xz = (a: number, bb: number): [number, number] => (zFront ? [a, bb] : [bb, a]);
  const pt = (u: number, v: number) => xz(U(u), V(v));
  const rect = (u0: number, u1: number, v0: number, v1: number) => {
    const [xa, za] = pt(u0, v0);
    const [xb, zb] = pt(u1, v1);
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
  };
  /** Eixo do mundo em que corre uma parede da linha dada, e o eixo do plano dela. */
  const runAxis = (line: 'u' | 'v'): 'x' | 'z' => ((line === 'u') === zFront ? 'z' : 'x');
  const y0 = s.y + LIFT;
  const fy = (f: number) => y0 + f * FLOOR;
  const out: CasaResult = { loot: [], doors: 0, rooms: plan.rooms.length, entry: new Vector3(0, s.y, 0), garage: null };

  /** Caixa de parede: plano em `p` (eixo perpendicular), de r0 a r1 ao longo de `run`. */
  const seg = (run: 'x' | 'z', p: number, r0: number, r1: number, yb: number, h: number, t: number, mat: Material, collide: boolean) => {
    const len = Math.abs(r1 - r0);
    if (len < 0.02 || h < 0.02) return;
    const c = (r0 + r1) / 2;
    const worldUV = rebocoLimpo(mat, Math.floor((yb - y0 + 0.05) / FLOOR) * FLOOR + y0);
    if (run === 'x') b.box({ w: len, h, d: t, x: c, z: p, y: yb, mat, tile: 1.4, collide, worldUV });
    else b.box({ w: t, h, d: len, x: p, z: c, y: yb, mat, tile: 1.4, collide, worldUV });
  };
  const colSeg = (run: 'x' | 'z', p: number, r0: number, r1: number, yb: number, h: number, t: number) => {
    const len = Math.abs(r1 - r0);
    if (len < 0.02) return;
    if (run === 'x') b.collider(len, h, t, (r0 + r1) / 2, yb + h / 2, p);
    else b.collider(t, h, len, p, yb + h / 2, (r0 + r1) / 2);
  };

  for (let f = 0; f < plan.floors; f++) {
    const rooms = plan.rooms.filter((r) => r.f === f);
    const walls = wallsOf(rooms);
    const opens = plan.opens.filter((o) => o.f === f);
    const base = fy(f);
    const extMat = f === 0 ? st.parede : (st.parede2 ?? st.parede);

    // Janelas automáticas: cada cômodo ganha janela nas paredes de fora, longe dos vãos dados.
    for (const w of walls) {
      if (w.side === 0) continue;
      for (const r of rooms) {
        const onLine = w.line === 'u' ? Math.abs((w.side > 0 ? r.u0 : r.u1) - w.c) < 0.011 : Math.abs((w.side > 0 ? r.v0 : r.v1) - w.c) < 0.011;
        if (!onLine) continue;
        const a = Math.max(w.a0, w.line === 'u' ? r.v0 : r.u0);
        const bb = Math.min(w.a1, w.line === 'u' ? r.v1 : r.u1);
        const len = bb - a;
        const wk = windowKind(r.kind, st.rico);
        if (!wk || len < wk.w + 0.9) continue;
        const n = wk.kind === 'basculante' ? 1 : wk.kind === 'vidro' ? (len >= 7 ? 2 : 1) : len >= 7.5 ? 3 : len >= 4.4 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const at = a + (len * (i + 0.5)) / n;
          const clash = opens.some((o) => o.line === w.line && Math.abs(o.c - w.c) < 0.011 && Math.abs(o.at - at) < o.w / 2 + wk.w / 2 + 0.35);
          if (!clash) opens.push({ f, line: w.line, c: w.c, at, w: wk.w, kind: wk.kind });
        }
      }
    }

    for (const w of walls) {
      const run = runAxis(w.line);
      const ext = w.side !== 0;
      const t = ext ? TE : TI;
      // Sinal do eixo perpendicular no mundo e lado de dentro da parede de fora.
      const ps = w.line === 'u' ? su : sv;
      const wi = w.side * ps;
      const plane = w.line === 'u' ? U(w.c) : V(w.c);
      const p = ext ? plane + (wi * t) / 2 : plane;
      const mat = ext ? extMat : st.interno;
      const R = (a: number) => (w.line === 'u' ? V(a) : U(a));
      // Paredes internas param um pouco antes das pontas (não atravessam a parede de fora).
      const a0 = ext ? w.a0 : w.a0 + 0.02;
      const a1 = ext ? w.a1 : w.a1 - 0.02;
      const list = opens.filter((o) => o.line === w.line && Math.abs(o.c - w.c) < 0.011 && o.at > w.a0 && o.at < w.a1).sort((x, z) => x.at - z.at);
      let cur = a0;
      for (const o of list) {
        const l = Math.max(a0, o.at - o.w / 2);
        const r = Math.min(a1, o.at + o.w / 2);
        if (r - l < 0.3) continue;
        seg(run, p, R(cur), R(l), base, WALL_H, t, mat, true);
        cur = r;
        const mid = (l + r) / 2;
        const ow = r - l;
        const [cx, cz] = run === 'x' ? [R(mid), p] : [p, R(mid)];
        switch (o.kind) {
          case 'aberto':
            break;
          case 'guarda': {
            seg(run, p, R(l), R(r), base, 0.92, 0.07, st.rico ? hq.vidro : hq.madeiraEscura, false);
            seg(run, p, R(l), R(r), base + 0.92, 0.05, 0.09, hq.madeiraEscura, false);
            colSeg(run, p, R(l), R(r), base, 1.0, 0.1);
            break;
          }
          case 'arco': {
            const ah = 2.25;
            seg(run, p, R(l), R(r), base + ah, WALL_H - ah, t, mat, true);
            makeArch(b, { x: cx, y: base, z: cz, axis: run, width: ow, height: ah, wallT: t, frame: st.rico ? hq.branco : hq.madeira });
            break;
          }
          case 'porta':
          case 'portaDupla':
          case 'portao': {
            const dh = o.kind === 'portao' ? 2.3 : DOOR_H;
            seg(run, p, R(l), R(r), base + dh + 0.08, WALL_H - dh - 0.08, t, mat, true);
            const leaf = o.kind === 'portao' ? rng.pick(hq.portoes) : ext ? st.porta : st.rico ? hq.branco : hq.madeira;
            // Porta de fora abre para dentro; as de dentro, para um lado sorteado.
            const swing = (ext ? (wi > 0 ? 1 : -1) : rng.chance(0.5) ? 1 : -1) as 1 | -1;
            const made = makeDoor(b, {
              x: cx,
              y: base,
              z: cz,
              axis: run,
              width: ow - 0.16,
              height: dh,
              hinge: (rng.chance(0.5) ? 1 : -1) as 1 | -1,
              swing,
              leaf,
              frame: o.kind === 'portao' ? m.metalDark : st.rico ? hq.branco : hq.madeiraEscura,
              double: o.kind !== 'porta',
              wallT: t,
            });
            out.doors += made.length;
            if (ext && f === 0) {
              // Soleira em rampa do lado de fora (o piso fica 8 cm acima do chão).
              const o2 = plane - wi * 0.45;
              if (run === 'x') b.box({ w: ow + 0.3, h: LIFT, d: 0.9, x: R(mid), z: o2, y: s.y, mat: hq.concreto, tile: 2, collide: true });
              else b.box({ w: 0.9, h: LIFT, d: ow + 0.3, x: o2, z: R(mid), y: s.y, mat: hq.concreto, tile: 2, collide: true });
              if (o.kind === 'portao') out.garage = run === 'x' ? new Vector3(R(mid), s.y, plane - wi * 1.6) : new Vector3(plane - wi * 1.6, s.y, R(mid));
              if (o.kind !== 'portao' && Math.abs(w.c) < 0.011 && w.line === 'v') {
                const e = run === 'x' ? [R(mid), plane - wi * 1.6] : [plane - wi * 1.6, R(mid)];
                out.entry.set(e[0], s.y, e[1]);
                // Marquise sobre a entrada.
                if (run === 'x') b.box({ w: ow + 1.2, h: 0.1, d: 1.1, x: R(mid), z: plane - wi * 0.55, y: base + dh + 0.25, mat: hq.branco, tile: 2 });
                else b.box({ w: 1.1, h: 0.1, d: ow + 1.2, x: plane - wi * 0.55, z: R(mid), y: base + dh + 0.25, mat: hq.branco, tile: 2 });
              }
            }
            break;
          }
          case 'janela':
          case 'basculante': {
            const hw = o.kind === 'janela' ? 1.09 : 0.67;
            const sill = o.kind === 'janela' ? 0.95 : 1.6;
            seg(run, p, R(l), R(r), base, sill, t, mat, false);
            seg(run, p, R(l), R(r), base + sill + hw, WALL_H - sill - hw, t, mat, false);
            colSeg(run, p, R(l), R(r), base, WALL_H, t);
            const face = { axis: (run === 'x' ? 'z' : 'x') as 'x' | 'z', coord: plane, facing: (wi > 0 ? -1 : 1) as 1 | -1, a0: 0, a1: 0 };
            placeKit(b, o.kind === 'janela' ? 'Kit_Janela' : 'Kit_Basculante', face, R(mid), base + sill + hw / 2, (role) => hq.kitRole(role));
            break;
          }
          case 'vidro': {
            // Pano de vidro fixo do piso à verga, com montantes de alumínio.
            const gh = 2.3;
            seg(run, p, R(l), R(r), base + gh, WALL_H - gh, t, mat, false);
            seg(run, p, R(l), R(r), base + 0.06, gh - 0.06, 0.03, hq.vidro, false);
            seg(run, p, R(l), R(r), base, 0.06, t, hq.aluminio, false);
            for (const e of [l + 0.03, mid, r - 0.03]) seg(run, p, R(e - 0.03), R(e + 0.03), base, gh, 0.07, hq.aluminio, false);
            colSeg(run, p, R(l), R(r), base, WALL_H, t);
            break;
          }
        }
      }
      seg(run, p, R(cur), R(a1), base, WALL_H, t, mat, true);
    }

    // Pisos, lajes e móveis de cada cômodo.
    const holes = plan.rooms.filter((r) => r.f === f + 1 && r.kind === 'escada');
    for (const r of rooms) {
      const q = rect(r.u0, r.u1, r.v0, r.v1);
      const floorMat =
        r.kind === 'garagem' ? hq.concreto : r.kind === 'banheiro' || r.kind === 'lavabo' || r.kind === 'cozinha' || r.kind === 'lavanderia' || r.kind === 'despensa' ? hq.porcelanato : r.kind === 'quarto' || r.kind === 'suite' || r.kind === 'closet' ? st.pisoQuarto : st.piso;
      if (f === 0) b.box({ w: q.x1 - q.x0, h: 0.4, d: q.z1 - q.z0, x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, y: base - 0.4, mat: floorMat, tile: 1.2, collide: true });
      else if (r.kind !== 'escada') b.box({ w: q.x1 - q.x0 - 0.1, h: 0.015, d: q.z1 - q.z0 - 0.1, x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, y: base, mat: floorMat, tile: 1.2 });
      if (r.kind === 'varanda') continue;
      // Laje de cima do cômodo, menos o vão da escada.
      let pieces = [q];
      for (const h of holes) {
        const hr = rect(h.u0, h.u1, h.v0, h.v1);
        pieces = pieces.flatMap((c) => subtract(c, hr));
      }
      for (const c of pieces) b.box({ w: c.x1 - c.x0, h: FLOOR - WALL_H, d: c.z1 - c.z0, x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2, y: base + WALL_H, mat: hq.branco, tile: 2.5, collide: true });

      if (r.kind === 'escada') {
        if (f !== 0) continue;
        const sw = r.u1 - r.u0 - 0.25;
        const [bx, bz] = pt((r.u0 + r.u1) / 2, r.v0 + 0.2);
        buildStairs(b, { x: bx, z: bz, base, axis: zFront ? 'z' : 'x', dir: sv as 1 | -1, run: r.v1 - r.v0 - 0.2, rise: FLOOR, width: sw, mat: st.rico ? hq.marmore : hq.madeiraEscura, stepHeight: 0.19 });
        continue;
      }
      // Portas e passagens do cômodo (para os móveis deixarem o caminho livre).
      const doors: Array<{ x: number; z: number; w: number }> = [];
      for (const o of opens) {
        if (o.kind === 'janela' || o.kind === 'basculante' || o.kind === 'vidro' || o.kind === 'guarda') continue;
        const touches = o.line === 'u' ? (Math.abs(o.c - r.u0) < 0.011 || Math.abs(o.c - r.u1) < 0.011) && o.at > r.v0 && o.at < r.v1 : (Math.abs(o.c - r.v0) < 0.011 || Math.abs(o.c - r.v1) < 0.011) && o.at > r.u0 && o.at < r.u1;
        if (!touches) continue;
        const [dx, dz] = o.line === 'u' ? pt(o.c, o.at) : pt(o.at, o.c);
        doors.push({ x: dx, z: dz, w: Math.min(o.w, 2.4) + 0.5 });
      }
      // Corredor estreito fica livre (um aparador ali fecharia a passagem).
      if (r.kind === 'corredor' && Math.min(r.u1 - r.u0, r.v1 - r.v0) < 2.2) continue;
      const inset = 0.18;
      const spots = furnishRoom(b, rng, { kind: r.kind as RoomKind, x0: q.x0 + inset, x1: q.x1 - inset, z0: q.z0 + inset, z1: q.z1 - inset, y: base, doors }, st.rico);
      for (const pos of spots) {
        if (!rng.chance(s.lootChance ?? 1)) continue;
        const tier = st.rico ? (r.kind === 'suite' || r.kind === 'escritorio' ? 2 : 1) : r.kind === 'suite' || r.kind === 'escritorio' || r.kind === 'garagem' ? 1 : 0;
        out.loot.push({ pos, tier: tier as 0 | 1 | 2 });
      }
    }
  }

  if (s.fundacao) b.box({ w: s.w + 0.1, h: s.fundacao, d: s.d + 0.1, x: s.x0 + s.w / 2, z: s.z0 + s.d / 2, y: y0 - 0.38 - s.fundacao, mat: hq.pedra, tile: 2, collide: true });

  // Telhado sobre o pavimento de cima (o que sobra do térreo fica com laje e platibanda).
  const top = plan.rooms.filter((r) => r.f === plan.floors - 1 && r.kind !== 'varanda');
  const tb = rect(Math.min(...top.map((r) => r.u0)), Math.max(...top.map((r) => r.u1)), Math.min(...top.map((r) => r.v0)), Math.max(...top.map((r) => r.v1)));
  const ry = fy(plan.floors);
  const wallTop = plan.floors > 1 ? (st.parede2 ?? st.parede) : st.parede;
  if (st.telhado === 'duas') addRoof(b, { x0: tb.x0, z0: tb.z0, w: tb.x1 - tb.x0, d: tb.z1 - tb.z0, y: ry, kind: 'duas', drain: 1, telha: st.telha, tile: 1.6, pitch: 0.36, gable: wallTop });
  else if (st.telhado === 'quatro') addHipRoof(b, tb.x0, tb.z0, tb.x1 - tb.x0, tb.z1 - tb.z0, ry, 0.42, st.telha);
  else parapet(b, tb, ry, 0.55, wallTop);
  if (plan.floors > 1) {
    for (const r of plan.rooms.filter((q) => q.f === 0 && q.kind !== 'varanda')) {
      const covered = top.some((t) => t.u0 < r.u1 - 0.05 && t.u1 > r.u0 + 0.05 && t.v0 < r.v1 - 0.05 && t.v1 > r.v0 + 0.05);
      if (!covered) parapet(b, rect(r.u0, r.u1, r.v0, r.v1), fy(1), 0.4, st.parede);
    }
  }
  return out;
}

/**
 * Reboco das casas de bairro: só a faixa limpa da textura (sem a umidade do pé nem os
 * escorridos do alto, que são da favela), contínua pela posição no mundo. Outros materiais
 * (tijolo, pedra, tábua) seguem com a repetição normal.
 */
export function rebocoLimpo(mat: Material, yBase: number): { tile: number; tileV: number; y0: number; v0: number } | undefined {
  return /^hq_(reboco|branco|bege|cinza|muro)/.test(mat.name) ? { tile: 2.5, tileV: 20, y0: yBase, v0: 0.4 } : undefined;
}

interface R4 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** c − h em até quatro retângulos. */
function subtract(c: R4, h: R4): R4[] {
  if (h.x0 >= c.x1 - 0.01 || h.x1 <= c.x0 + 0.01 || h.z0 >= c.z1 - 0.01 || h.z1 <= c.z0 + 0.01) return [c];
  const out: R4[] = [];
  if (h.z0 > c.z0 + 0.01) out.push({ x0: c.x0, x1: c.x1, z0: c.z0, z1: h.z0 });
  if (h.z1 < c.z1 - 0.01) out.push({ x0: c.x0, x1: c.x1, z0: h.z1, z1: c.z1 });
  const z0 = Math.max(c.z0, h.z0);
  const z1 = Math.min(c.z1, h.z1);
  if (h.x0 > c.x0 + 0.01) out.push({ x0: c.x0, x1: h.x0, z0, z1 });
  if (h.x1 < c.x1 - 0.01) out.push({ x0: h.x1, x1: c.x1, z0, z1 });
  return out;
}

/** Platibanda baixa em volta de uma laje. */
function parapet(b: WorldBuilder, q: R4, y: number, h: number, mat: Material): void {
  const w = q.x1 - q.x0;
  const d = q.z1 - q.z0;
  const worldUV = rebocoLimpo(mat, y);
  for (const z of [q.z0 + 0.08, q.z1 - 0.08]) b.box({ w, h, d: 0.16, x: (q.x0 + q.x1) / 2, z, y, mat, tile: 1.4, collide: true, worldUV });
  for (const x of [q.x0 + 0.08, q.x1 - 0.08]) b.box({ w: 0.16, h, d: d - 0.32, x, z: (q.z0 + q.z1) / 2, y, mat, tile: 1.4, collide: true, worldUV });
}

/**
 * Telhado de quatro águas com beiral (as vilas de telha verde do condomínio): duas águas
 * em trapézio e duas em triângulo, forro por baixo do beiral e colisão em degraus.
 */
export function addHipRoof(b: WorldBuilder, x0: number, z0: number, w: number, d: number, y: number, pitch: number, mat: Material, eave = 0.6): void {
  const X0 = x0 - eave;
  const X1 = x0 + w + eave;
  const Z0 = z0 - eave;
  const Z1 = z0 + d + eave;
  const W = X1 - X0;
  const Dp = Z1 - Z0;
  const half = Math.min(W, Dp) / 2;
  const rise = half * Math.tan(pitch);
  const alongX = W >= Dp;
  const ra = alongX ? new Vector3(X0 + half, y + rise, (Z0 + Z1) / 2) : new Vector3((X0 + X1) / 2, y + rise, Z0 + half);
  const rb = alongX ? new Vector3(X1 - half, y + rise, (Z0 + Z1) / 2) : new Vector3((X0 + X1) / 2, y + rise, Z1 - half);
  const c = [new Vector3(X0, y, Z0), new Vector3(X1, y, Z0), new Vector3(X1, y, Z1), new Vector3(X0, y, Z1)];
  // Águas: (beiral a, beiral b, cumeeira do lado b, cumeeira do lado a).
  const faces: Vector3[][] = alongX
    ? [[c[0], c[1], rb, ra], [c[2], c[3], ra, rb], [c[3], c[0], ra], [c[1], c[2], rb]]
    : [[c[3], c[0], ra, rb], [c[1], c[2], rb, ra], [c[0], c[1], ra], [c[2], c[3], rb]];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tile = 1.6;
  for (const f of faces) {
    const e = f[1].subtract(f[0]);
    const elen = e.length();
    const eu = e.scale(1 / elen);
    let n = Vector3.Cross(e, f[2].subtract(f[0])).normalize();
    if (n.y < 0) n = n.scale(-1);
    for (const flip of [1, -1]) {
      const start = pos.length / 3;
      for (const p of f) {
        pos.push(p.x, p.y, p.z);
        nrm.push(n.x * flip, n.y * flip, n.z * flip);
        const rel = p.subtract(f[0]);
        const u = Vector3.Dot(rel, eu);
        const v = rel.subtract(eu.scale(u)).length();
        uv.push(u / tile, v / tile);
      }
      const tris = f.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
      for (let i = 0; i < tris.length; i += 3) idx.push(start + tris[i], start + tris[i + (flip > 0 ? 1 : 2)], start + tris[i + (flip > 0 ? 2 : 1)]);
    }
  }
  const mesh = new Mesh('telhado4', b.scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  vd.applyToMesh(mesh);
  b.addMesh(mesh, mat);
  // Forro do beiral e colisão em três degraus.
  b.box({ w: W, h: 0.1, d: Dp, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, y: y - 0.1, mat: b.mats.hq.branco, tile: 2.5 });
  for (let k = 0; k < 3; k++) {
    const inset = (half * (k + 0.5)) / 3;
    b.collider(W - 2 * inset, rise / 3, Dp - 2 * inset, (X0 + X1) / 2, y + (rise * (k + 0.5)) / 3, (Z0 + Z1) / 2);
  }
}
