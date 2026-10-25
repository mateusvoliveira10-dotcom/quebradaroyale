import { Color3, Mesh, Scene, StandardMaterial, Vector3, VertexData } from '@babylonjs/core';
import { WORLD } from '../core/config';
import { Rng } from '../utils/random';

/**
 * Relevo da ilha: a comunidade (quadrado de 300 m) fica plana no meio; em volta, morros,
 * vales, o Pico do Mirante, a bacia da Lagoa Azul e a cava da Pedreira, até a praia e o mar
 * na borda do círculo. A altura vem de uma grade de 2 m (ruído fractal + relevos
 * esculpidos) e é a mesma para o desenho, a colisão de movimento, o piso dos bots, as balas
 * e o pouso do paraquedas.
 */

/** Relevo esculpido: deslocamento gaussiano (positivo = morro, negativo = buraco). */
interface Sculpt {
  x: number;
  z: number;
  r: number;
  h: number;
  /** Platô: achata o topo/fundo acima de uma fração (0 = gaussiana pura). */
  flat?: number;
}

export interface TerrainPoi {
  name: string;
  x: number;
  z: number;
  /** Raio (m) da área com nome. */
  r: number;
}

const STEP = 2;
const EXTENT = WORLD.extent;
const N = Math.round((EXTENT * 2) / STEP) + 1;
/** Nível do mar e da lagoa. */
export const SEA_LEVEL = 0;
export const LAKE = { x: 185, z: 178, r: 34, level: 1.2 };

/** Áreas com nome do anel externo (as da comunidade ficam em CommunityMap). */
export const OUTER_POIS: TerrainPoi[] = [
  { name: 'VILA DOS PESCADORES', x: 30, z: 262, r: 32 },
  { name: 'LAGOA AZUL', x: LAKE.x, z: LAKE.z, r: 44 },
  { name: 'PEDREIRA', x: 245, z: -20, r: 36 },
  { name: 'FERRO-VELHO', x: 182, z: -190, r: 34 },
  { name: 'PICO DO MIRANTE', x: -10, z: -248, r: 36 },
  { name: 'SÍTIO DO SEU ZÉ', x: -188, z: -182, r: 36 },
  { name: 'MATA DO SABIÁ', x: -246, z: 10, r: 42 },
  { name: 'CAMPO DE VÁRZEA', x: -180, z: 190, r: 32 },
];

const SCULPTS: Sculpt[] = [
  // Pico do Mirante (o ponto mais alto da ilha), com platô para a torre.
  { x: -10, z: -248, r: 46, h: 34, flat: 0.82 },
  { x: -60, z: -225, r: 40, h: 16 },
  { x: 50, z: -230, r: 36, h: 14 },
  // Serra da Mata do Sabiá.
  { x: -250, z: 70, r: 50, h: 18 },
  { x: -240, z: -60, r: 45, h: 14 },
  // Bacia da lagoa (o fundo fica abaixo do nível da água).
  { x: LAKE.x, z: LAKE.z, r: 46, h: -9, flat: 0.55 },
  // Morros entre as áreas.
  { x: 240, z: 110, r: 40, h: 16 },
  { x: 110, z: -250, r: 34, h: 10 },
  { x: -120, z: 250, r: 38, h: 12 },
  { x: -270, z: -130, r: 30, h: 10 },
  { x: 265, z: -110, r: 30, h: 11 },
];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Terrain {
  static current: Terrain | null = null;

  /** Alturas da grade (N × N, passo de 2 m, de -EXTENT a +EXTENT). */
  private readonly h = new Float32Array(N * N);
  readonly meshes: Mesh[] = [];
  /** Blocos de colisão de movimento (malha grossa), por bloco de 32 m. */
  private readonly collision = new Map<string, Mesh>();

  constructor() {
    const rng = new Rng(WORLD.seed ^ 0x51f15);
    // Ruído de valor em grade (4 oitavas), repetível pela semente.
    const G = 64;
    const lattice = new Float32Array(G * G).map(() => rng.next());
    const value = (x: number, z: number) => {
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      const fx = x - xi;
      const fz = z - zi;
      const at = (i: number, k: number) => lattice[(((i % G) + G) % G) * G + (((k % G) + G) % G)];
      const u = fx * fx * (3 - 2 * fx);
      const v = fz * fz * (3 - 2 * fz);
      const a = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * u;
      const b = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * u;
      return a + (b - a) * v;
    };
    const fbm = (x: number, z: number) => {
      let s = 0;
      let amp = 1;
      let f = 1 / 90;
      for (let o = 0; o < 4; o++) {
        s += (value(x * f, z * f) - 0.5) * amp;
        amp *= 0.5;
        f *= 2.1;
      }
      return s;
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -EXTENT + i * STEP;
        const z = -EXTENT + j * STEP;
        this.h[j * N + i] = this.shape(x, z, fbm);
      }
    }
    Terrain.current = this;
  }

  /** Altura "de projeto" num ponto (antes da grade). */
  private shape(x: number, z: number, fbm: (x: number, z: number) => number): number {
    const r = Math.hypot(x, z);
    // Fora da comunidade (com transição) o relevo aparece.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const out = smoothstep(WORLD.half + 2, WORLD.half + 30, edge);
    let h = 2.2 + fbm(x, z) * 16 + Math.max(0, fbm(x + 400, z - 300)) * 10;
    for (const s of SCULPTS) {
      const d2 = ((x - s.x) ** 2 + (z - s.z) ** 2) / (s.r * s.r);
      let g = Math.exp(-d2 * 2.2);
      if (s.flat) g = Math.min(1, g / s.flat);
      h += s.h * g;
    }
    // Pedreira: cava de paredes íngremes (degraus de 3 m).
    const dq = Math.hypot(x - 245, z + 20);
    if (dq < 30) {
      const depth = (1 - smoothstep(14, 30, dq)) * 10;
      h = Math.min(h, h - Math.round(depth / 3) * 3 + 1);
    }
    h = Math.max(h, 0.8);
    // Áreas planas no nível 0 para as construções (vila, ferro-velho, sítio, campo).
    for (const p of [OUTER_POIS[0], OUTER_POIS[3], OUTER_POIS[5], OUTER_POIS[7]]) {
      const k = 1 - smoothstep(p.r * 0.95, p.r * 1.45, Math.hypot(x - p.x, z - p.z));
      h = h * (1 - k);
    }
    // Bacia da lagoa abaixo do nível da água.
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r) h = Math.min(h, LAKE.level - 2.2 * (1 - smoothstep(LAKE.r * 0.5, LAKE.r, dl)) + 0.2);
    h *= out;
    // Prédio do lobby (além do muro norte, perto de x = -8): chão plano.
    const dLobby = Math.hypot(x + 8, z - (WORLD.half + 13));
    h *= smoothstep(14, 26, dLobby);
    // Praia e mar na borda do círculo.
    const shore = WORLD.radius;
    const beach = smoothstep(shore - 30, shore - 8, r);
    h = h * (1 - beach) + 0.5 * beach;
    h -= smoothstep(shore + 2, shore + 26, r) * 5;
    return h;
  }

  /** Altura do terreno em (x, z), interpolada na grade. */
  height(x: number, z: number): number {
    const fx = (x + EXTENT) / STEP;
    const fz = (z + EXTENT) / STEP;
    const i = Math.min(N - 2, Math.max(0, Math.floor(fx)));
    const k = Math.min(N - 2, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - k));
    const h = this.h;
    // Mesma triangulação da malha (diagonal i,k → i+1,k+1).
    const a = h[k * N + i];
    const b = h[k * N + i + 1];
    const c = h[(k + 1) * N + i];
    const d = h[(k + 1) * N + i + 1];
    return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
  }

  /** Componente vertical da normal (1 = plano). */
  slopeNy(x: number, z: number): number {
    const dx = (this.height(x + 0.5, z) - this.height(x - 0.5, z)) / 1;
    const dz = (this.height(x, z + 0.5) - this.height(x, z - 0.5)) / 1;
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Raio contra o terreno (marcha de 0,5 m + refino), até `len`; null se não bate. */
  raycast(o: Vector3, d: Vector3, len: number): number | null {
    // Só vale a pena fora da comunidade plana ou abaixo de 0 (o chão de lá é o colisor).
    let prev = 0;
    let prevAbove = o.y - this.height(o.x, o.z);
    if (prevAbove < 0) return null;
    const step = 0.5;
    for (let t = step; t <= len; t += step) {
      const y = o.y + d.y * t;
      const above = y - this.height(o.x + d.x * t, o.z + d.z * t);
      if (above < 0) {
        // Interpolação linear entre as duas amostras.
        return prev + (t - prev) * (prevAbove / (prevAbove - above));
      }
      if (above > 60 && d.y >= 0) return null;
      prev = t;
      prevAbove = above;
    }
    return null;
  }

  /**
   * Malha visual (blocos de 64 m, grade de 2 m) com cor por vértice (praia, capim, terra,
   * pedra nas encostas) e malhas grossas de colisão de movimento (blocos de 32 m).
   */
  build(scene: Scene, mat: StandardMaterial): void {
    const BLOCK = 32; // células por bloco visual (64 m)
    const cells = N - 1;
    const sand = Color3.FromHexString('#f2d98e');
    const grass = Color3.FromHexString('#66b43a');
    const grassDark = Color3.FromHexString('#4fa22e');
    const dirt = Color3.FromHexString('#b8784a');
    const rock = Color3.FromHexString('#b8a58c');
    const wet = Color3.FromHexString('#cdb279');
    for (let bj = 0; bj < cells; bj += BLOCK) {
      for (let bi = 0; bi < cells; bi += BLOCK) {
        const ni = Math.min(BLOCK, cells - bi);
        const nj = Math.min(BLOCK, cells - bj);
        // Bloco todo dentro da comunidade plana (coberto pelo chão do mapa): pula.
        const x0 = -EXTENT + bi * STEP;
        const z0 = -EXTENT + bj * STEP;
        const x1 = x0 + ni * STEP;
        const z1 = z0 + nj * STEP;
        if (x0 > -WORLD.half + 1 && x1 < WORLD.half - 1 && z0 > -WORLD.half + 1 && z1 < WORLD.half - 1) continue;
        const pos: number[] = [];
        const col: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        for (let j = 0; j <= nj; j++) {
          for (let i = 0; i <= ni; i++) {
            const gi = bi + i;
            const gj = bj + j;
            const x = -EXTENT + gi * STEP;
            const z = -EXTENT + gj * STEP;
            const y = this.h[gj * N + gi];
            pos.push(x, y, z);
            uv.push(x / 6, z / 6);
            const ny = this.slopeNy(x, z);
            const r = Math.hypot(x, z);
            let c = grass.clone();
            // Capim em manchas mais escuras e terra batida aqui e ali.
            const n = Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06 + Math.sin(x * 0.04));
            c = Color3.Lerp(c, grassDark, Math.max(0, n) * 0.8);
            c = Color3.Lerp(c, dirt, Math.max(0, -n - 0.55) * 1.6);
            // Pedra nas encostas íngremes, areia na praia e na beira da lagoa.
            c = Color3.Lerp(c, rock, smoothstep(0.86, 0.7, ny));
            c = Color3.Lerp(c, sand, smoothstep(WORLD.radius - 26, WORLD.radius - 14, r));
            c = Color3.Lerp(c, wet, smoothstep(WORLD.radius + 2, WORLD.radius + 10, r));
            const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
            c = Color3.Lerp(c, sand, smoothstep(LAKE.r + 6, LAKE.r - 2, dl) * 0.8);
            col.push(c.r, c.g, c.b, 1);
          }
        }
        const w = ni + 1;
        for (let j = 0; j < nj; j++) {
          for (let i = 0; i < ni; i++) {
            const a = j * w + i;
            idx.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
          }
        }
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.colors = col;
        vd.uvs = uv;
        const normals: number[] = [];
        VertexData.ComputeNormals(pos, idx, normals);
        vd.normals = normals;
        const m = new Mesh(`terreno_${bi}_${bj}`, scene);
        vd.applyToMesh(m);
        m.material = mat;
        m.receiveShadows = true;
        m.isPickable = false;
        m.freezeWorldMatrix();
        this.meshes.push(m);
      }
    }
    // Colisão de movimento: blocos de 32 m na mesma grade de 2 m (e mesma diagonal) do
    // desenho e de height(). Com grade de 4 m o chão de colisão ficava abaixo do desenho nas
    // encostas e os bots afundavam no morro.
    const C = 32;
    for (let z = -EXTENT; z < EXTENT; z += C) {
      for (let x = -EXTENT; x < EXTENT; x += C) {
        if (x >= -WORLD.half && x + C <= WORLD.half && z >= -WORLD.half && z + C <= WORLD.half) continue;
        const pos: number[] = [];
        const idx: number[] = [];
        const n = C / STEP;
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(x + i * STEP, this.height(x + i * STEP, z + j * STEP), z + j * STEP);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i;
            idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
          }
        }
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        const m = new Mesh(`terrenoCol_${x}_${z}`, scene);
        vd.applyToMesh(m);
        m.isVisible = false;
        m.isPickable = false;
        m.checkCollisions = true;
        m.freezeWorldMatrix();
        this.collision.set(`${Math.floor(x / C)},${Math.floor(z / C)}`, m);
      }
    }
  }

  /** Blocos de colisão perto de (x, z) (para o moveWithCollisions). */
  collisionAround(x: number, z: number, r: number, out: Mesh[]): void {
    const C = 32;
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
      for (let k = Math.floor((z - r) / C); k <= Math.floor((z + r) / C); k++) {
        const m = this.collision.get(`${i},${k}`);
        if (m) out.push(m);
      }
    }
  }
}
