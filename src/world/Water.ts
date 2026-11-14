import { WORLD } from '../core/config';
import { LAKES, RIVERS, SEA_LEVEL, Terrain } from './Terrain';

/**
 * Registro das áreas de água onde dá para nadar (contrato entre o mapa e a jogabilidade).
 *
 * O mapa registra cada corpo d'água (mar, lagoas, rios, piscinas) com `addWater`; o
 * personagem, os bots e a câmera só consultam `waterAt`. Assim um rio ou piscina novo vira
 * água de verdade só de ser registrado, sem mexer no código do personagem.
 */
export interface WaterBody {
  name: string;
  /** Altura da superfície (y). */
  level: number;
  /** Caixa envolvente (para descartar rápido). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** O ponto (x, z) está dentro desta água? */
  contains(x: number, z: number): boolean;
  /** Superfície no ponto, se variar (rio descendo); sem isso vale . */
  levelAt?(x: number, z: number): number;
  /** Fundo (y) no ponto; sem isso usa o relevo (Terrain). */
  floorAt?(x: number, z: number): number;
}

export interface WaterSample {
  body: WaterBody;
  level: number;
  /** Fundo no ponto (y). */
  floor: number;
  /** Profundidade (level − floor), ≥ 0. */
  depth: number;
}

const bodies: WaterBody[] = [];

export function addWater(body: WaterBody): void {
  bodies.push(body);
}

export function clearWater(): void {
  bodies.length = 0;
}

export function waterBodies(): readonly WaterBody[] {
  return bodies;
}

/** Água no ponto (a mais alta, se houver mais de uma), ou null. */
export function waterAt(x: number, z: number): WaterSample | null {
  let best: WaterSample | null = null;
  for (const b of bodies) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !b.contains(x, z)) continue;
    const level = b.levelAt ? b.levelAt(x, z) : b.level;
    if (best && best.level >= level) continue;
    const floor = b.floorAt ? b.floorAt(x, z) : (Terrain.current?.height(x, z) ?? level - 10);
    best = { body: b, level, floor, depth: Math.max(0, level - floor) };
  }
  return best;
}

/** Água circular (lagoa, poça grande). */
export function circleWater(name: string, cx: number, cz: number, r: number, level: number): WaterBody {
  return { name, level, x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, contains: (x, z) => (x - cx) ** 2 + (z - cz) ** 2 < r * r };
}

/** Água retangular (piscina): fundo plano em `floor`. */
export function boxWater(name: string, x0: number, z0: number, x1: number, z1: number, level: number, floor: number): WaterBody {
  return { name, level, x0, x1, z0, z1, contains: () => true, floorAt: () => floor };
}

/**
 * Rio: faixa de largura `width` ao longo de uma polilinha (x, z). O nível pode descer ao
 * longo do rio (`levels`, um por ponto); o fundo vem do relevo.
 */
export function riverWater(name: string, path: Array<[number, number]>, width: number, levels: number[]): WaterBody {
  const xs = path.map((p) => p[0]);
  const zs = path.map((p) => p[1]);
  const hw = width / 2;
  const nearest = (x: number, z: number): { d2: number; level: number } => {
    let best = { d2: Infinity, level: levels[0] };
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best.d2) best = { d2, level: levels[i] + (levels[i + 1] - levels[i]) * t };
    }
    return best;
  };
  return {
    name,
    level: Math.max(...levels),
    x0: Math.min(...xs) - hw,
    x1: Math.max(...xs) + hw,
    z0: Math.min(...zs) - hw,
    z1: Math.max(...zs) + hw,
    contains: (x, z) => nearest(x, z).d2 < hw * hw,
    levelAt: (x, z) => nearest(x, z).level,
  };
}

/**
 * Mar em volta da ilha, as lagoas e lagos (Terrain.LAKES) e os rios (Terrain.RIVERS).
 * Chamado pelo mapa ao montar a ilha; as piscinas são registradas por cada mansão.
 */
export function registerDefaultWater(): void {
  addWater({
    name: 'mar',
    level: SEA_LEVEL,
    x0: -WORLD.extent * 2,
    x1: WORLD.extent * 2,
    z0: -WORLD.extent * 2,
    z1: WORLD.extent * 2,
    contains: (x, z) => Math.hypot(x, z) > WORLD.radius - 12,
  });
  for (const l of LAKES) addWater(circleWater(l.name.toLowerCase(), l.x, l.z, l.r, l.level));
  for (const r of RIVERS) addWater(riverWater(r.name.toLowerCase(), r.path, r.width, r.levels));
}
