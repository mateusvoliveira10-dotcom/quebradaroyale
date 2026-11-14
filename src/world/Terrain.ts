import { Color3, Mesh, Scene, StandardMaterial, Vector3, VertexData } from '@babylonjs/core';
import { WORLD } from '../core/config';
import { Rng } from '../utils/random';

/**
 * Relevo da ilha: a comunidade (quadrado de 300 m) fica plana no meio; em volta, morros,
 * vales, o Pico do Mirante, a bacia da Lagoa Azul e a cava da Pedreira; mais para fora, as
 * regiões novas (o bairro Jardim Primavera, o Condomínio Bela Vista das mansões, a Mata
 * Fechada, a Serra Grande com a lagoa e o córrego, a Fazenda Santa Luzia), o Rio Azul que
 * nasce na lagoa e desce até o mar, e a praia na borda do círculo. A altura vem de uma grade
 * de 2 m (ruído fractal + relevos esculpidos) e é a mesma para o desenho, a colisão de
 * movimento, o piso dos bots, as balas e o pouso do paraquedas.
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

/** Lagoa ou lago: disco com a superfície em `level`. */
export interface Lake {
  name: string;
  x: number;
  z: number;
  r: number;
  level: number;
}

/** Rio: faixa de largura `width` ao longo de uma polilinha, com o nível descendo ponto a ponto. */
export interface River {
  name: string;
  path: Array<[number, number]>;
  width: number;
  levels: number[];
}

const STEP = 2;
const EXTENT = WORLD.extent;
const N = Math.round((EXTENT * 2) / STEP) + 1;
/** Nível do mar. */
export const SEA_LEVEL = 0;

export const LAKES: Lake[] = [
  { name: 'LAGOA AZUL', x: 185, z: 178, r: 34, level: 1.2 },
  // No alto da serra: o Córrego da Serra nasce nela.
  { name: 'LAGOA DA SERRA', x: 200, z: -330, r: 28, level: 7 },
  // Lago ornamental do condomínio das mansões (com a ponte de madeira).
  { name: 'LAGO DO CONDOMÍNIO', x: -372, z: -292, r: 18, level: 3.0 },
  // Açude da fazenda.
  { name: 'AÇUDE DA FAZENDA', x: -332, z: 338, r: 15, level: 1.3 },
];
/** A lagoa original (o anel antigo da ilha ainda a usa pelo nome). */
export const LAKE = LAKES[0];

export const RIVERS: River[] = [
  // Nasce na Lagoa Azul, contorna a Pedreira e o Jardim Primavera e desagua no sudeste.
  {
    name: 'RIO AZUL',
    width: 13,
    path: [[222, 176], [262, 150], [292, 100], [300, 40], [295, -30], [310, -110], [345, -190], [390, -260], [445, -325]],
    levels: [1.2, 1.1, 1.0, 0.9, 0.75, 0.6, 0.4, 0.2, 0],
  },
  // Desce da Lagoa da Serra até a praia sul.
  { name: 'CÓRREGO DA SERRA', width: 6, path: [[200, -330], [215, -380], [238, -430], [268, -492]], levels: [7, 4.5, 1.5, 0] },
];

/**
 * Piscinas (mansões do condomínio): retângulo em coordenadas pares (a grade do relevo tem 2 m),
 * superfície em `level` e fundo em `floor`. O relevo é cavado no retângulo (a rampa da cava
 * fica por fora, debaixo do deck); a casa da piscina constrói o tanque e registra a água.
 */
export interface Pool {
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
  floor: number;
}

export const POOLS: Pool[] = [
  { name: 'piscina da vila branca', x0: -390, z0: -212, x1: -378, z1: -206, level: 3.45, floor: 1.9 },
  { name: 'piscina da casa bege', x0: -294, z0: -224, x1: -286, z1: -212, level: 3.45, floor: 1.9 },
  { name: 'piscina da casa moderna', x0: -308, z0: -302, x1: -296, z1: -296, level: 3.45, floor: 1.8 },
];

/** Áreas com nome do anel externo (as da comunidade ficam em CommunityMap). */
export const OUTER_POIS: TerrainPoi[] = [
  { name: 'VILA DOS PESCADORES', x: 40, z: 455, r: 32 },
  { name: 'LAGOA AZUL', x: LAKE.x, z: LAKE.z, r: 44 },
  { name: 'PEDREIRA', x: 245, z: -20, r: 36 },
  { name: 'FERRO-VELHO', x: 182, z: -190, r: 34 },
  { name: 'PICO DO MIRANTE', x: -10, z: -248, r: 36 },
  { name: 'SÍTIO DO SEU ZÉ', x: -188, z: -182, r: 36 },
  { name: 'MATA DO SABIÁ', x: -246, z: 10, r: 42 },
  { name: 'CAMPO DE VÁRZEA', x: -180, z: 190, r: 32 },
  // Regiões novas (anel de fora).
  { name: 'JARDIM PRIMAVERA', x: 385, z: 55, r: 75 },
  { name: 'CONDOMÍNIO BELA VISTA', x: -340, z: -250, r: 95 },
  { name: 'MATA FECHADA', x: 250, z: 330, r: 100 },
  { name: 'SERRA GRANDE', x: 80, z: -390, r: 85 },
  { name: 'LAGOA DA SERRA', x: 200, z: -330, r: 40 },
  { name: 'FAZENDA SANTA LUZIA', x: -300, z: 300, r: 85 },
];

/** Áreas aplainadas (construções): nível do platô. */
const FLATS: Array<{ x: number; z: number; r: number; level: number }> = [
  { x: 40, z: 455, r: 32, level: -0.06 }, // vila
  { x: 182, z: -190, r: 34, level: -0.06 }, // ferro-velho
  { x: -188, z: -182, r: 36, level: -0.06 }, // sítio
  { x: -180, z: 190, r: 32, level: -0.06 }, // campo de várzea
  { x: 385, z: 55, r: 75, level: 1.4 }, // Jardim Primavera
  { x: -340, z: -250, r: 95, level: 3.6 }, // Condomínio Bela Vista
  { x: -300, z: 300, r: 85, level: 1.8 }, // Fazenda Santa Luzia
];

const SCULPTS: Sculpt[] = [
  // Pico do Mirante (o ponto mais alto do anel antigo), com platô para a torre.
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
  { x: 265, z: -110, r: 30, h: 11 },
  // Serra Grande: o ponto mais alto da ilha (44 m), com cume plano, e a cordilheira em volta.
  { x: 80, z: -390, r: 80, h: 44, flat: 0.72 },
  { x: 150, z: -410, r: 50, h: 18 },
  { x: 0, z: -420, r: 48, h: 20 },
  { x: -70, z: -360, r: 45, h: 14 },
  // Platô da Lagoa da Serra (a lagoa fica cavada nele).
  { x: 200, z: -330, r: 70, h: 11, flat: 0.6 },
  // Morros da Mata Fechada (floresta em encostas).
  { x: 250, z: 330, r: 70, h: 20, flat: 0.5 },
  { x: 320, z: 270, r: 45, h: 14 },
  { x: 180, z: 390, r: 50, h: 16 },
  // Serra atrás do condomínio (fundo de cena das mansões) e ao norte da fazenda.
  { x: -430, z: -120, r: 55, h: 18 },
  { x: -250, z: -400, r: 55, h: 16 },
  { x: -200, z: 420, r: 55, h: 14 },
  { x: -420, z: 220, r: 50, h: 12 },
  // Morro entre o bairro e a Mata Fechada.
  { x: 400, z: 200, r: 45, h: 14 },
];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Distância (m) até o eixo do rio mais próximo e o nível da água ali. */
export function riverAt(x: number, z: number): { d: number; level: number; river: River; hw: number } | null {
  let best: { d: number; level: number; river: River; hw: number } | null = null;
  for (const r of RIVERS) {
    const p = r.path;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (!best || d < best.d) best = { d, level: r.levels[i] + (r.levels[i + 1] - r.levels[i]) * t, river: r, hw: r.width / 2 };
    }
  }
  return best;
}

/** Distância (m) até a margem da água mais próxima (negativa dentro da água). Para a vegetação não nascer no rio. */
export function waterEdgeDistance(x: number, z: number): number {
  let d = Infinity;
  const rv = riverAt(x, z);
  if (rv) d = rv.d - rv.hw;
  for (const l of LAKES) d = Math.min(d, Math.hypot(x - l.x, z - l.z) - l.r);
  return d;
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
      if (d2 > 6) continue;
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
    // Áreas planas para as construções (vila, ferro-velho, sítio, campo, bairro, condomínio, fazenda).
    for (const p of FLATS) {
      const k = 1 - smoothstep(p.r * 0.95, p.r * 1.45, Math.hypot(x - p.x, z - p.z));
      if (k <= 0) continue;
      // Um pouco abaixo do nível: pisos e quadras assentados nele não brigam com o chão.
      h = h * (1 - k) + p.level * k;
    }
    // Piscinas: cava reta (os nós da grade dentro do retângulo descem abaixo do fundo).
    for (const p of POOLS) if (x >= p.x0 - 0.01 && x <= p.x1 + 0.01 && z >= p.z0 - 0.01 && z <= p.z1 + 0.01) h = p.floor - 0.6;
    // Lagoas e lagos: bacia abaixo do nível da água e margem suave em volta.
    for (const l of LAKES) {
      const dl = Math.hypot(x - l.x, z - l.z);
      if (dl < l.r) h = Math.min(h, l.level - 2.2 * (1 - smoothstep(l.r * 0.5, l.r, dl)) + 0.2);
      else if (dl < l.r + 12) h = Math.min(h, l.level + 0.5 + (dl - l.r) * 0.3);
    }
    // Rios: calha abaixo do nível, margens subindo devagar e um vale raso em volta.
    const rv = riverAt(x, z);
    if (rv && rv.d < rv.hw + 34) {
      const { d, level, hw } = rv;
      if (d < hw) {
        const u = d / hw;
        h = Math.min(h, level - 0.45 - 1.5 * (1 - u * u));
      } else {
        const t = smoothstep(hw, hw + 9, d);
        const bank = Math.max(h, level + 0.35);
        h = Math.min(bank, (level - 0.45) * (1 - t) + bank * t);
        h = Math.min(h, level + 1.6 + (d - hw) * 0.38);
      }
    }
    h *= out;
    // Dentro e na borda da comunidade o relevo fica abaixo do chão dela (y = 0): os dois no
    // mesmo plano piscavam (z-fighting) na faixa da borda.
    if (edge < WORLD.half + 6) h = Math.min(h, -0.08);
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
   * pedra nas encostas, areia na beira d'água, mata mais escura, pasto mais claro) e malhas
   * grossas de colisão de movimento (blocos de 32 m).
   */
  build(scene: Scene, mat: StandardMaterial): void {
    const BLOCK = 32; // células por bloco visual (64 m)
    const cells = N - 1;
    const sand = Color3.FromHexString('#f2d98e');
    const grass = Color3.FromHexString('#66b43a');
    const grassDark = Color3.FromHexString('#4fa22e');
    const forest = Color3.FromHexString('#3f8a2a');
    const pasture = Color3.FromHexString('#9ccb4e');
    const dirt = Color3.FromHexString('#b8784a');
    const rock = Color3.FromHexString('#b8a58c');
    const wet = Color3.FromHexString('#cdb279');
    const mud = Color3.FromHexString('#8a6a46');
    const mata = OUTER_POIS.find((p) => p.name === 'MATA FECHADA')!;
    const fazenda = OUTER_POIS.find((p) => p.name === 'FAZENDA SANTA LUZIA')!;
    const vila = OUTER_POIS[0];
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
        // Bloco todo em mar fundo (longe da praia): só o mar aparece ali.
        if (Math.min(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1)) > WORLD.radius + 40) continue;
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
            // Mata fechada mais escura; pasto da fazenda mais claro.
            c = Color3.Lerp(c, forest, 1 - smoothstep(mata.r * 0.8, mata.r * 1.2, Math.hypot(x - mata.x, z - mata.z)));
            c = Color3.Lerp(c, pasture, 0.7 * (1 - smoothstep(fazenda.r * 0.9, fazenda.r * 1.2, Math.hypot(x - fazenda.x, z - fazenda.z))));
            // Pedra nas encostas íngremes e no alto da serra, areia na praia e na beira d'água.
            c = Color3.Lerp(c, rock, smoothstep(0.86, 0.7, ny));
            c = Color3.Lerp(c, rock, smoothstep(30, 40, y) * 0.6);
            c = Color3.Lerp(c, sand, smoothstep(WORLD.radius - 26, WORLD.radius - 14, r));
            c = Color3.Lerp(c, sand, 0.9 * (1 - smoothstep(vila.r * 0.8, vila.r * 1.1, Math.hypot(x - vila.x, z - vila.z))));
            c = Color3.Lerp(c, wet, smoothstep(WORLD.radius + 2, WORLD.radius + 10, r));
            const we = waterEdgeDistance(x, z);
            if (we < 6) c = Color3.Lerp(c, we < 0 ? mud : sand, we < 0 ? 0.9 : 0.8 * (1 - smoothstep(1.5, 6, we)));
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
        if (Math.min(Math.hypot(x, z), Math.hypot(x + C, z), Math.hypot(x, z + C), Math.hypot(x + C, z + C)) > WORLD.radius + 40) continue;
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
