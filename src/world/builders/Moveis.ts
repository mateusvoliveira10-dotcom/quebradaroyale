import { Material, Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { WorldBuilder } from '../WorldBuilder';
import { addCar } from './Props';

/**
 * Móveis dos interiores (casas do bairro, mansões, sede da fazenda): cada cômodo recebe o
 * conjunto do seu tipo, encostado nas paredes que não têm porta. Cada móvel é feito de
 * poucas caixas (lote estático) e tem UM colisor do tamanho dele.
 */
export type RoomKind =
  | 'sala' | 'jantar' | 'cozinha' | 'quarto' | 'suite' | 'banheiro' | 'lavabo' | 'corredor' | 'hall'
  | 'escritorio' | 'garagem' | 'lavanderia' | 'despensa' | 'closet' | 'tv';

export interface RoomBox {
  kind: RoomKind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Piso (y). */
  y: number;
  /** Portas e passagens do cômodo (ponto no meio do vão e largura). */
  doors: Array<{ x: number; z: number; w: number }>;
  /** Área que precisa ficar livre (ex.: pé da escada). */
  keep?: Array<{ x0: number; x1: number; z0: number; z1: number }>;
}

type Side = 'x0' | 'x1' | 'z0' | 'z1';
const SIDES: Side[] = ['x0', 'x1', 'z0', 'z1'];

/** Coloca caixas num referencial local do móvel: `a` ao longo da parede, `p` saindo dela. */
type Put = (a: number, p: number, la: number, lp: number, h: number, y0: number, mat: Material) => void;

class Furnisher {
  private readonly taken: Array<{ x0: number; x1: number; z0: number; z1: number }> = [];
  readonly loot: Vector3[] = [];

  constructor(
    readonly b: WorldBuilder,
    readonly rng: Rng,
    readonly r: RoomBox,
  ) {
    // Faixa de passagem na frente de cada porta.
    for (const d of r.doors) this.taken.push({ x0: d.x - d.w / 2 - 0.35, x1: d.x + d.w / 2 + 0.35, z0: d.z - d.w / 2 - 0.35, z1: d.z + d.w / 2 + 0.35 });
    for (const k of r.keep ?? []) this.taken.push(k);
  }

  get w(): number {
    return this.r.x1 - this.r.x0;
  }

  get d(): number {
    return this.r.z1 - this.r.z0;
  }

  len(side: Side): number {
    return side === 'x0' || side === 'x1' ? this.d : this.w;
  }

  private free(x0: number, x1: number, z0: number, z1: number): boolean {
    const r = this.r;
    if (x0 < r.x0 - 0.01 || x1 > r.x1 + 0.01 || z0 < r.z0 - 0.01 || z1 > r.z1 + 0.01) return false;
    return !this.taken.some((t) => x0 < t.x1 && x1 > t.x0 && z0 < t.z1 && z1 > t.z0);
  }

  /**
   * Reserva um móvel de comprimento L e profundidade D encostado na parede `side`, centrado
   * na fração `u` do comprimento dela. Devolve o colocador de caixas ou null se não coube.
   */
  against(side: Side, u: number, L: number, D: number, H: number, solid = true, gap = 0.06): Put | null {
    const r = this.r;
    const n = this.len(side);
    if (L > n - 0.2) return null;
    const c = 0.1 + L / 2 + (n - 0.2 - L) * u;
    let x0: number, x1: number, z0: number, z1: number;
    if (side === 'z0' || side === 'z1') {
      x0 = r.x0 + c - L / 2;
      x1 = x0 + L;
      z0 = side === 'z0' ? r.z0 + gap : r.z1 - gap - D;
      z1 = z0 + D;
    } else {
      z0 = r.z0 + c - L / 2;
      z1 = z0 + L;
      x0 = side === 'x0' ? r.x0 + gap : r.x1 - gap - D;
      x1 = x0 + D;
    }
    if (!this.free(x0, x1, z0, z1)) return null;
    this.taken.push({ x0, x1, z0, z1 });
    if (solid) this.b.collider(x1 - x0, H, z1 - z0, (x0 + x1) / 2, r.y + H / 2, (z0 + z1) / 2);
    const b = this.b;
    const y = r.y;
    return (a, p, la, lp, h, y0, mat) => {
      // a: 0..L ao longo; p: 0..D a partir da parede.
      if (side === 'z0') b.box({ w: la, h, d: lp, x: x0 + a + la / 2, z: z0 + p + lp / 2, y: y + y0, mat });
      else if (side === 'z1') b.box({ w: la, h, d: lp, x: x0 + a + la / 2, z: z1 - p - lp / 2, y: y + y0, mat });
      else if (side === 'x0') b.box({ w: lp, h, d: la, x: x0 + p + lp / 2, z: z0 + a + la / 2, y: y + y0, mat });
      else b.box({ w: lp, h, d: la, x: x1 - p - lp / 2, z: z0 + a + la / 2, y: y + y0, mat });
    };
  }

  /** Tenta as paredes (das mais compridas para as mais curtas, ou na ordem dada) e algumas posições. */
  place(L: number, D: number, H: number, build: (put: Put) => void, o: { sides?: Side[]; solid?: boolean; us?: number[] } = {}): Side | null {
    const sides = o.sides ?? [...SIDES].sort((s, t) => this.len(t) - this.len(s));
    for (const side of sides) {
      for (const u of o.us ?? [0.5, 0.15, 0.85, 0, 1]) {
        const put = this.against(side, u, L, D, H, o.solid ?? true);
        if (put) {
          build(put);
          return side;
        }
      }
    }
    return null;
  }

  /** Móvel solto no meio do cômodo (mesa, tapete): retângulo centrado em (cx, cz). */
  island(cx: number, cz: number, w: number, d: number, H: number, solid = true): boolean {
    if (!this.free(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2)) return false;
    this.taken.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
    if (solid) this.b.collider(w, H, d, cx, this.r.y + H / 2, cz);
    return true;
  }

  /** Ponto livre para loot (perto do centro). */
  lootSpot(): void {
    const r = this.r;
    for (let i = 0; i < 12; i++) {
      const x = r.x0 + this.w * this.rng.range(0.25, 0.75);
      const z = r.z0 + this.d * this.rng.range(0.25, 0.75);
      if (this.free(x - 0.5, x + 0.5, z - 0.5, z + 0.5)) {
        this.loot.push(new Vector3(x, r.y + 0.08, z));
        this.taken.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
        return;
      }
    }
  }

  get cx(): number {
    return (this.r.x0 + this.r.x1) / 2;
  }

  get cz(): number {
    return (this.r.z0 + this.r.z1) / 2;
  }
}

/** Mobília o cômodo e devolve pontos de loot dentro dele. `rich` = acabamento de mansão. */
export function furnishRoom(b: WorldBuilder, rng: Rng, room: RoomBox, rich: boolean): Vector3[] {
  const f = new Furnisher(b, rng, room);
  const m = b.mats;
  const hq = m.hq;
  const wood = rich ? hq.madeiraEscura : hq.madeira;
  const cloth = rng.pick(hq.tecidos);
  const cloth2 = rng.pick(hq.tecidos);
  const y = room.y;

  const sofa = (L: number) =>
    f.place(L, 0.9, 0.8, (put) => {
      put(0, 0, L, 0.9, 0.38, 0.04, cloth);
      put(0, 0, L, 0.24, 0.5, 0.42, cloth);
      put(0, 0.2, 0.2, 0.7, 0.22, 0.42, cloth);
      put(L - 0.2, 0.2, 0.2, 0.7, 0.22, 0.42, cloth);
      const n = Math.max(2, Math.round((L - 0.4) / 0.7));
      for (let i = 0; i < n; i++) put(0.22 + (i * (L - 0.44)) / n, 0.26, (L - 0.44) / n - 0.04, 0.6, 0.12, 0.42, cloth2);
    });
  const rackTv = (sides?: Side[]) =>
    f.place(1.8, 0.42, 1.5, (put) => {
      put(0, 0, 1.8, 0.42, 0.45, 0.05, wood);
      put(0.25, 0.14, 1.3, 0.05, 0.75, 0.62, m.metalDark);
      put(0.3, 0.19, 1.2, 0.01, 0.65, 0.67, hq.vidro);
      put(0.8, 0.12, 0.2, 0.16, 0.12, 0.5, m.metalDark);
    }, { sides });
  const shelf = (L: number, books = true) =>
    f.place(L, 0.34, 2.0, (put) => {
      put(0, 0, 0.04, 0.34, 2.0, 0, wood);
      put(L - 0.04, 0, 0.04, 0.34, 2.0, 0, wood);
      put(0, 0, L, 0.03, 2.0, 0, wood);
      for (let k = 0; k < 5; k++) {
        put(0.04, 0, L - 0.08, 0.34, 0.03, 0.05 + k * 0.47, wood);
        if (!books || k === 4) continue;
        let a = 0.08;
        while (a < L - 0.3) {
          const bw = rng.range(0.08, 0.3);
          if (rng.chance(0.8)) put(a, 0.06, bw, 0.22, rng.range(0.2, 0.36), 0.08 + k * 0.47, rng.pick(m.productColors));
          a += bw + 0.02;
        }
      }
    });
  const plant = () =>
    f.place(0.45, 0.45, 1.1, (put) => {
      put(0.05, 0.05, 0.35, 0.35, 0.4, 0, hq.branco);
      put(0.1, 0.1, 0.25, 0.25, 0.5, 0.4, m.foliageDark);
      put(0.0, 0.0, 0.45, 0.45, 0.3, 0.7, m.foliage);
    }, { us: [0, 1], solid: false });
  const rug = (w: number, d: number) => {
    if (f.w > w + 1 && f.d > d + 1) b.box({ w, h: 0.012, d, x: f.cx, z: f.cz, y: y + 0.004, mat: cloth2 });
  };
  const table = (w: number, d: number, h: number, top: Material, cx = f.cx, cz = f.cz): boolean => {
    if (!f.island(cx, cz, w, d, h)) return false;
    b.box({ w, h: 0.05, d, x: cx, z: cz, y: y + h - 0.05, mat: top });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box({ w: 0.06, h: h - 0.05, d: 0.06, x: cx + sx * (w / 2 - 0.08), z: cz + sz * (d / 2 - 0.08), y, mat: wood });
    return true;
  };
  const chair = (x: number, z: number, dx: number, dz: number, mat: Material) => {
    // (dx, dz): para onde a cadeira olha.
    b.box({ w: 0.42, h: 0.05, d: 0.42, x, z, y: y + 0.43, mat });
    b.box({ w: dx ? 0.05 : 0.42, h: 0.5, d: dz ? 0.05 : 0.42, x: x - dx * 0.19, z: z - dz * 0.19, y: y + 0.48, mat });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box({ w: 0.04, h: 0.43, d: 0.04, x: x + sx * 0.18, z: z + sz * 0.18, y, mat: wood });
  };
  const bed = (bw: number) =>
    f.place(bw, 2.05, 0.6, (put) => {
      put(0, 0, bw, 0.08, 1.1, 0, wood);
      put(0, 0.08, bw, 1.95, 0.3, 0.02, wood);
      put(0.03, 0.1, bw - 0.06, 1.9, 0.2, 0.32, m.white);
      put(0.03, 0.75, bw - 0.06, 1.26, 0.06, 0.5, cloth);
      const n = bw > 1.2 ? 2 : 1;
      for (let i = 0; i < n; i++) put(0.12 + (i * (bw - 0.2)) / n, 0.16, (bw - 0.24) / n - 0.06, 0.4, 0.12, 0.52, m.white);
    }, { us: [0.5, 0.2, 0.8] });
  const nightstand = (side: Side | null) => {
    if (!side) return;
    f.place(0.45, 0.4, 0.55, (put) => {
      put(0, 0, 0.45, 0.4, 0.5, 0, wood);
      put(0.15, 0.12, 0.14, 0.14, 0.22, 0.5, hq.branco);
      put(0.1, 0.07, 0.24, 0.24, 0.16, 0.72, cloth2);
    }, { sides: [side], us: [0.05, 0.95, 0.25, 0.75] });
  };
  const wardrobe = (L: number) =>
    f.place(L, 0.58, 2.1, (put) => {
      put(0, 0, L, 0.58, 2.1, 0, wood);
      const n = Math.round(L / 0.55);
      for (let i = 1; i < n; i++) put((i * L) / n - 0.006, 0.58, 0.012, 0.004, 2.0, 0.05, m.metalDark);
      for (let i = 0; i < n; i++) put((i * L) / n + L / n / 2 - 0.02, 0.58, 0.04, 0.03, 0.14, 1.0, m.metal);
    });
  const desk = () =>
    f.place(1.4, 0.65, 0.76, (put) => {
      put(0, 0, 1.4, 0.65, 0.05, 0.71, wood);
      put(0, 0, 0.05, 0.65, 0.71, 0, wood);
      put(1.35, 0, 0.05, 0.65, 0.71, 0, wood);
      put(0.95, 0.05, 0.4, 0.55, 0.5, 0.2, wood);
      put(0.45, 0.1, 0.55, 0.04, 0.34, 0.86, m.metalDark);
      put(0.68, 0.1, 0.08, 0.14, 0.1, 0.76, m.metalDark);
      put(0.4, 0.38, 0.45, 0.14, 0.02, 0.76, m.metalDark);
    });
  const toilet = () =>
    f.place(0.42, 0.68, 0.8, (put) => {
      put(0.02, 0, 0.38, 0.2, 0.42, 0.38, m.white);
      put(0.04, 0.2, 0.34, 0.46, 0.4, 0, m.white);
      put(0.02, 0.18, 0.38, 0.5, 0.04, 0.4, m.white);
    }, { us: [0.9, 0.1, 0.5] });
  const sink = (L: number) =>
    f.place(L, 0.5, 0.88, (put) => {
      put(0, 0, L, 0.5, 0.8, 0, rich ? hq.madeiraEscura : hq.branco);
      put(-0.0, 0, L, 0.52, 0.05, 0.8, hq.marmore);
      put(L / 2 - 0.22, 0.1, 0.44, 0.32, 0.02, 0.855, hq.inox);
      put(L / 2 - 0.02, 0.02, 0.04, 0.06, 0.22, 0.85, hq.inox);
      put(0.05, 0, L - 0.1, 0.02, 0.8, 1.15, hq.vidro);
    }, { us: [0.1, 0.5, 0.9] });
  const shower = () =>
    f.place(1.0, 1.0, 0.1, (put) => {
      put(0, 0, 1.0, 1.0, 0.06, 0, hq.azulejo);
      put(0, 0.97, 1.0, 0.02, 1.95, 0.06, hq.vidro);
      put(0.45, 0.02, 0.1, 0.1, 0.04, 2.0, hq.inox);
      put(0.48, 0.02, 0.04, 0.04, 1.0, 1.0, hq.inox);
    }, { us: [0, 1], solid: false });

  switch (room.kind) {
    case 'sala':
    case 'tv': {
      const L = Math.min(2.6, Math.max(1.8, Math.min(f.w, f.d) - 1.6));
      const s = sofa(L);
      const opp: Record<Side, Side> = { x0: 'x1', x1: 'x0', z0: 'z1', z1: 'z0' };
      rackTv(s ? [opp[s]] : undefined);
      rug(Math.min(2.6, f.w - 1.6), Math.min(1.8, f.d - 1.6));
      if (f.island(f.cx, f.cz, 1.0, 0.6, 0.4)) {
        b.box({ w: 1.0, h: 0.05, d: 0.6, x: f.cx, z: f.cz, y: y + 0.35, mat: rich ? hq.vidro : wood });
        b.box({ w: 0.8, h: 0.35, d: 0.4, x: f.cx, z: f.cz, y, mat: wood });
      }
      if (room.kind === 'sala') shelf(rng.range(1.0, 1.6));
      if (rich) sofa(1.6);
      plant();
      f.lootSpot();
      break;
    }
    case 'jantar': {
      const tw = Math.min(2.2, f.w - 2);
      const td = Math.min(1.0, f.d - 2);
      if (tw > 1.1 && td > 0.7 && table(tw, td, 0.76, wood)) {
        const n = Math.max(1, Math.floor(tw / 0.65));
        for (let i = 0; i < n; i++) {
          const cx = f.cx - tw / 2 + (tw / n) * (i + 0.5);
          chair(cx, f.cz - td / 2 - 0.32, 0, 1, cloth);
          chair(cx, f.cz + td / 2 + 0.32, 0, -1, cloth);
        }
      }
      f.place(1.6, 0.45, 0.85, (put) => {
        put(0, 0, 1.6, 0.45, 0.85, 0, wood);
        put(0.3, 0.1, 0.2, 0.2, 0.3, 0.85, hq.branco);
        put(1.0, 0.1, 0.3, 0.2, 0.18, 0.85, m.metal);
      });
      plant();
      f.lootSpot();
      break;
    }
    case 'cozinha': {
      const sides = [...SIDES].sort((s, t) => f.len(t) - f.len(s));
      let done = false;
      for (const side of sides) {
        const L = Math.min(3.8, f.len(side) - 1.2);
        if (L < 1.8 || done) continue;
        for (const u of [0, 1, 0.5]) {
          const put = f.against(side, u, L, 0.62, 0.92);
          if (!put) continue;
          const body = rich ? hq.madeiraEscura : hq.branco;
          put(0, 0, L, 0.6, 0.86, 0, body);
          put(0, 0, L, 0.63, 0.05, 0.86, hq.marmore);
          put(0.3, 0.12, 0.7, 0.4, 0.015, 0.912, hq.inox);
          put(0.62, 0.04, 0.04, 0.08, 0.26, 0.91, hq.inox);
          put(L - 0.75, 0.04, 0.6, 0.54, 0.02, 0.912, m.metalDark);
          for (const [oa, op] of [[0.12, 0.12], [0.38, 0.12], [0.12, 0.36], [0.38, 0.36]]) put(L - 0.75 + oa, 0.04 + op, 0.12, 0.12, 0.015, 0.932, hq.inox);
          put(0, 0, L, 0.34, 0.65, 1.5, body);
          put(L - 0.8, 0.0, 0.7, 0.4, 0.1, 1.38, hq.inox);
          done = true;
          break;
        }
      }
      f.place(0.72, 0.7, 1.8, (put) => {
        put(0, 0, 0.72, 0.7, 1.8, 0, hq.inox);
        put(0.02, 0.7, 0.68, 0.005, 0.02, 1.2, m.metalDark);
        put(0.62, 0.7, 0.03, 0.03, 0.5, 0.6, m.metalDark);
      }, { us: [0, 1] });
      if (f.w > 3.4 && f.d > 3.4 && table(0.9, 0.9, 0.76, hq.marmore)) {
        chair(f.cx - 0.75, f.cz, 1, 0, cloth);
        chair(f.cx + 0.75, f.cz, -1, 0, cloth);
      }
      f.lootSpot();
      break;
    }
    case 'quarto': {
      const side = bed(f.w > 3.4 && f.d > 3.4 && rng.chance(0.6) ? 1.4 : 0.95);
      nightstand(side);
      wardrobe(Math.min(1.8, Math.max(1.1, Math.max(f.w, f.d) - 2.2)));
      if (rng.chance(0.6)) desk();
      rug(1.4, 1.0);
      f.lootSpot();
      break;
    }
    case 'suite': {
      const side = bed(1.8);
      nightstand(side);
      nightstand(side);
      wardrobe(Math.min(2.4, Math.max(1.4, Math.max(f.w, f.d) - 2.4)));
      rackTv();
      f.place(0.8, 0.8, 0.8, (put) => {
        put(0, 0, 0.8, 0.8, 0.4, 0.04, cloth2);
        put(0, 0, 0.8, 0.2, 0.45, 0.42, cloth2);
      }, { us: [0, 1] });
      rug(2.0, 1.4);
      plant();
      f.lootSpot();
      break;
    }
    case 'banheiro': {
      shower();
      toilet();
      sink(rich ? 1.4 : 0.9);
      break;
    }
    case 'lavabo': {
      toilet();
      sink(0.7);
      break;
    }
    case 'escritorio': {
      desk();
      shelf(1.4);
      shelf(1.0);
      f.place(0.8, 0.8, 0.8, (put) => {
        put(0, 0, 0.8, 0.8, 0.4, 0.04, cloth);
        put(0, 0, 0.8, 0.2, 0.45, 0.42, cloth);
      }, { us: [0, 1] });
      rug(1.6, 1.2);
      f.lootSpot();
      break;
    }
    case 'garagem': {
      // Carro estacionado (colide) se couber; bancada e prateleira de ferramentas.
      if (f.w >= 2.8 && f.d >= 4.6 && rng.chance(0.7) && f.island(f.cx, f.cz, 1.9, 4.2, 0.1, false)) addCar(b, rng, f.cx, f.cz, Math.PI / 2 + (rng.chance(0.5) ? Math.PI : 0));
      else if (f.d >= 2.8 && f.w >= 4.6 && rng.chance(0.7) && f.island(f.cx, f.cz, 4.2, 1.9, 0.1, false)) addCar(b, rng, f.cx, f.cz, rng.chance(0.5) ? Math.PI : 0);
      f.place(1.4, 0.5, 0.9, (put) => {
        put(0, 0, 1.4, 0.5, 0.05, 0.85, hq.madeira);
        put(0.02, 0.02, 0.06, 0.46, 0.85, 0, m.metalDark);
        put(1.32, 0.02, 0.06, 0.46, 0.85, 0, m.metalDark);
        put(0.2, 0.1, 0.3, 0.2, 0.18, 0.9, m.plasticRed);
        put(0.8, 0.12, 0.4, 0.25, 0.12, 0.9, m.metal);
      });
      f.lootSpot();
      break;
    }
    case 'lavanderia': {
      f.place(0.62, 0.6, 0.88, (put) => {
        put(0, 0, 0.62, 0.6, 0.88, 0, m.white);
        put(0.12, 0.6, 0.38, 0.01, 0.38, 0.3, hq.vidro);
      });
      f.place(0.7, 0.55, 0.85, (put) => {
        put(0, 0, 0.7, 0.55, 0.3, 0.55, hq.concreto);
        put(0.05, 0.05, 0.06, 0.06, 0.55, 0, hq.concreto);
        put(0.59, 0.05, 0.06, 0.06, 0.55, 0, hq.concreto);
      });
      shelf(1.0, false);
      f.lootSpot();
      break;
    }
    case 'despensa': {
      shelf(Math.min(1.6, f.len('x0') - 0.4));
      shelf(1.0);
      f.lootSpot();
      break;
    }
    case 'closet': {
      wardrobe(Math.min(2.2, Math.max(f.w, f.d) - 0.4));
      wardrobe(1.2);
      break;
    }
    case 'hall':
    case 'corredor': {
      f.place(1.2, 0.35, 0.85, (put) => {
        put(0, 0, 1.2, 0.35, 0.05, 0.8, wood);
        put(0.03, 0.03, 0.05, 0.29, 0.8, 0, wood);
        put(1.12, 0.03, 0.05, 0.29, 0.8, 0, wood);
        put(0.45, 0.08, 0.2, 0.2, 0.3, 0.85, hq.branco);
        put(0.1, 0, 1.0, 0.02, 0.7, 1.2, hq.vidro);
      });
      if (room.kind === 'hall') {
        plant();
        f.lootSpot();
      }
      break;
    }
  }
  return f.loot;
}
