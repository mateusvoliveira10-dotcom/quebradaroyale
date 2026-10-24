import { Vector3 } from '@babylonjs/core';
import { Rng } from '../utils/random';
import { ColliderIndex } from './ColliderIndex';

const WALK = 1;
const RAMP = 2;
/** Célula de chão colada numa parede: não se anda por ela, mas dá para cair nela de cima. */
const LANDING = 4;
/** Queda máxima (m) que um caminho pode usar para descer (laje sem escada, muro). */
const MAX_DROP = 7;

/**
 * Grade de navegação 2,5D (células de 0,5 m) amostrada dos colisores reais:
 * cada célula guarda a altura do piso mais alto e se dá para pisar. Ligações
 * respeitam degrau máximo (rampas/escadas permitem mais). Células coladas em
 * paredes ficam bloqueadas (folga para o corpo). Busca de caminho A* com
 * suavização por linha de visão na grade.
 */
export class NavGrid {
  readonly cell = 0.5;
  readonly n: number;
  private readonly min: number;
  private readonly heights: Float32Array;
  private readonly flags: Uint8Array;
  // Buffers reaproveitados pelo A*.
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 1;
  /** Buscas restantes neste frame (orçamento global). */
  private budget = 2;

  constructor(
    private readonly index: ColliderIndex,
    half: number,
  ) {
    this.min = -half;
    this.n = Math.ceil((half * 2) / this.cell);
    const total = this.n * this.n;
    this.heights = new Float32Array(total);
    this.flags = new Uint8Array(total);
    this.g = new Float32Array(total);
    this.f = new Float32Array(total);
    this.from = new Int32Array(total);
    this.stamp = new Uint32Array(total);
    this.closed = new Uint32Array(total);
    this.comp = new Int32Array(total).fill(-1);
    this.build();
    this.buildComponents();
  }

  /** Região de cada célula (células ligadas por passos de ida e volta). */
  private readonly comp: Int32Array;
  /** Quedas entre regiões (região → regiões alcançáveis caindo/saindo dela). */
  private readonly compOut: Array<Set<number>> = [];
  private readonly reachCache = new Map<number, boolean>();

  /**
   * Regiões para recusar na hora caminhos impossíveis (laje sem escada, área murada):
   * uma busca A* que falha percorre milhares de células, e com 29 bots isso causava
   * travadas de 30–90 ms. Regiões = células ligadas por passos nos dois sentidos;
   * quedas (só de cima para baixo) viram ligações de mão única entre regiões.
   */
  private buildComponents(): void {
    const n = this.n;
    const total = n * n;
    const queue = new Int32Array(total);
    let count = 0;
    for (let s = 0; s < total; s++) {
      if (this.comp[s] !== -1 || !this.enterable(s)) continue;
      const id = count++;
      this.comp[s] = id;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      while (head < tail) {
        const k = queue[head++];
        const i = k % n;
        const j = (k - i) / n;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if ((di === 0 && dj === 0) || i + di < 0 || j + dj < 0 || i + di >= n || j + dj >= n) continue;
            const nk = k + dj * n + di;
            if (this.comp[nk] !== -1 || !this.enterable(nk)) continue;
            if (this.canStep(k, nk) && this.canStep(nk, k)) {
              this.comp[nk] = id;
              queue[tail++] = nk;
            }
          }
        }
      }
    }
    for (let c = 0; c < count; c++) this.compOut.push(new Set());
    for (let k = 0; k < total; k++) {
      const a = this.comp[k];
      if (a < 0) continue;
      const i = k % n;
      const j = (k - i) / n;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if ((di === 0 && dj === 0) || i + di < 0 || j + dj < 0 || i + di >= n || j + dj >= n) continue;
          const nk = k + dj * n + di;
          const b = this.comp[nk];
          if (b >= 0 && b !== a && this.canStep(k, nk)) this.compOut[a].add(b);
        }
      }
    }
  }

  /** A região b é alcançável a partir da região a? (busca no grafo de regiões, com cache) */
  private reachable(a: number, b: number): boolean {
    if (a === b) return true;
    const key = a * 1_000_003 + b;
    const hit = this.reachCache.get(key);
    if (hit !== undefined) return hit;
    const seen = new Set<number>([a]);
    const stack = [a];
    let found = false;
    while (stack.length > 0 && !found) {
      for (const c of this.compOut[stack.pop()!]) {
        if (c === b) {
          found = true;
          break;
        }
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
      }
    }
    if (this.reachCache.size > 50_000) this.reachCache.clear();
    this.reachCache.set(key, found);
    return found;
  }

  private build(): void {
    const n = this.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = this.min + (i + 0.5) * this.cell;
        const z = this.min + (j + 0.5) * this.cell;
        const hit = this.index.surfaceBelow(x, z, 60);
        if (!hit || hit.ny < 0.6 || hit.y > 50) {
          this.heights[k] = -999;
          continue;
        }
        this.heights[k] = hit.y;
        // Precisa caber em pé: nada sólido logo acima do piso.
        if (this.index.isInsideSolid(new Vector3(x, hit.y + 1.0, z)) || this.index.isInsideSolid(new Vector3(x, hit.y + 1.7, z))) continue;
        this.flags[k] = WALK | (hit.ny < 0.985 ? RAMP : 0);
      }
    }
    // Folga: célula vizinha de parede/obstáculo alto não é usada.
    const blocked: number[] = [];
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if (!(this.flags[k] & WALK)) continue;
        const h = this.heights[k];
        const ramp = this.flags[k] & RAMP;
        let wall = false;
        for (let dj = -1; dj <= 1 && !wall; dj++) {
          for (let di = -1; di <= 1; di++) {
            const kk = k + dj * n + di;
            const hh = this.heights[kk];
            const limit = ramp || this.flags[kk] & RAMP ? 0.75 : 0.45;
            if (hh > h + limit || (!(this.flags[kk] & WALK) && hh > h + 0.3)) {
              wall = true;
              break;
            }
          }
        }
        if (wall) blocked.push(k);
      }
    }
    for (const k of blocked) this.flags[k] = LANDING;
  }

  // ------------------------------------------------------------------ consultas

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.min) / this.cell);
    const j = Math.floor((z - this.min) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  private center(k: number): Vector3 {
    const i = k % this.n;
    const j = Math.floor(k / this.n);
    return new Vector3(this.min + (i + 0.5) * this.cell, this.heights[k], this.min + (j + 0.5) * this.cell);
  }

  isWalkable(p: Vector3): boolean {
    const k = this.cellOf(p.x, p.z);
    return k >= 0 && (this.flags[k] & WALK) !== 0 && Math.abs(this.heights[k] - p.y) < 1.2;
  }

  /** Célula andável mais próxima (busca em anéis), preferindo a mesma altura. */
  nearestWalkable(p: Vector3, maxRadius = 12): Vector3 | null {
    const k0 = this.cellOf(p.x, p.z);
    if (k0 >= 0 && this.flags[k0] & WALK && Math.abs(this.heights[k0] - p.y) < 1.5) return this.center(k0);
    const i0 = Math.floor((p.x - this.min) / this.cell);
    const j0 = Math.floor((p.z - this.min) / this.cell);
    const rmax = Math.ceil(maxRadius / this.cell);
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    for (let r = 1; r <= rmax; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
          const k = j * this.n + i;
          if (!(this.flags[k] & WALK)) continue;
          const score = Math.hypot(di, dj) * this.cell + Math.abs(this.heights[k] - p.y) * 2;
          if (score < bestScore) {
            bestScore = score;
            best = this.center(k);
          }
        }
      }
      if (best && r * this.cell > bestScore * 0.6) break;
    }
    return best;
  }

  /** Ponto andável aleatório perto de `p` (dentro de `radius`). */
  randomNear(p: Vector3, radius: number, rng: Rng, minRadius = 0): Vector3 | null {
    for (let tries = 0; tries < 40; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(minRadius, radius);
      const k = this.cellOf(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
      if (k >= 0 && this.flags[k] & WALK) return this.center(k);
    }
    return null;
  }

  /** Passo de a para b: degrau/rampa (nos dois sentidos) ou queda para baixo de até MAX_DROP. */
  private canStep(a: number, b: number): boolean {
    const dh = this.heights[b] - this.heights[a];
    const ramp = this.flags[a] & RAMP || this.flags[b] & RAMP;
    if (Math.abs(dh) <= (ramp ? 0.62 : 0.36)) return (this.flags[b] & WALK) !== 0;
    return dh < -1 && dh >= -MAX_DROP;
  }

  /** Dá para entrar na célula (andando ou caindo nela)? */
  private enterable(k: number): boolean {
    return (this.flags[k] & (WALK | LANDING)) !== 0;
  }

  /** Renova o orçamento de buscas (chamar uma vez por frame). */
  newFrame(): void {
    this.budget = 2;
  }

  /** Reserva uma busca do orçamento deste frame. */
  tryBudget(): boolean {
    if (this.budget <= 0) return false;
    this.budget--;
    return true;
  }

  /** Caminho A* ponderado (lista de pontos já suavizada) ou null se não houver. */
  findPath(start: Vector3, goal: Vector3, maxExpand = 30000): Vector3[] | null {
    const s0 = this.nearestWalkable(start, 4);
    const g0 = this.nearestWalkable(goal, 8);
    if (!s0 || !g0) return null;
    const s = this.cellOf(s0.x, s0.z);
    const t = this.cellOf(g0.x, g0.z);
    if (s < 0 || t < 0) return null;
    if (s === t) return [g0];
    if (!this.reachable(this.comp[s], this.comp[t])) return null;

    const n = this.n;
    const id = ++this.search;
    const heap = new MinHeap(this.f);
    const ti = t % n;
    const tj = Math.floor(t / n);
    const h = (k: number) => {
      const dx = Math.abs((k % n) - ti);
      const dz = Math.abs(Math.floor(k / n) - tj);
      return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * this.cell * 1.6;
    };
    this.stamp[s] = id;
    this.g[s] = 0;
    this.f[s] = h(s);
    this.from[s] = -1;
    heap.push(s);
    let expanded = 0;
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
    ];
    while (heap.size > 0) {
      const k = heap.pop();
      if (k === t) return this.smooth(this.reconstruct(t), g0);
      if (this.closed[k] === id) continue;
      this.closed[k] = id;
      if (++expanded > maxExpand) return null;
      const i = k % n;
      const j = Math.floor(k / n);
      for (const [di, dj, cost] of dirs) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (!this.enterable(nk) || this.closed[nk] === id) continue;
        if (!this.canStep(k, nk)) continue;
        if (di !== 0 && dj !== 0) {
          // Não corta quina.
          const a = j * n + ni;
          const b = nj * n + i;
          if (!this.enterable(a) || !this.enterable(b)) continue;
        }
        const ng = this.g[k] + cost * this.cell + Math.abs(this.heights[nk] - this.heights[k]) * 0.5;
        if (this.stamp[nk] !== id || ng < this.g[nk]) {
          this.stamp[nk] = id;
          this.g[nk] = ng;
          this.f[nk] = ng + h(nk);
          this.from[nk] = k;
          heap.push(nk);
        }
      }
    }
    return null;
  }

  private reconstruct(t: number): number[] {
    const out: number[] = [];
    let k = t;
    while (k !== -1) {
      out.push(k);
      k = this.from[k];
    }
    return out.reverse();
  }

  /** Remove pontos intermediários quando há linha reta andável. */
  private smooth(cells: number[], goal: Vector3): Vector3[] {
    const pts: Vector3[] = [];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = anchor + 1;
      for (let k = cells.length - 1; k > anchor + 1; k--) {
        if (this.straight(cells[anchor], cells[k])) {
          next = k;
          break;
        }
      }
      pts.push(this.center(cells[next]));
      anchor = next;
    }
    if (pts.length > 0) pts[pts.length - 1] = goal;
    return pts;
  }

  private straight(a: number, b: number): boolean {
    const pa = this.center(a);
    const pb = this.center(b);
    const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const steps = Math.ceil(dist / (this.cell * 0.5));
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const k = this.cellOf(pa.x + (pb.x - pa.x) * t, pa.z + (pb.z - pa.z) * t);
      if (k < 0 || !(this.flags[k] & WALK)) return false;
      if (k !== prev && !this.canStep(prev, k)) return false;
      prev = k;
    }
    return true;
  }
}

/** Heap binário de índices ordenado por f[]. */
class MinHeap {
  private readonly items: number[] = [];
  constructor(private readonly f: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(k: number): void {
    const a = this.items;
    a.push(k);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
