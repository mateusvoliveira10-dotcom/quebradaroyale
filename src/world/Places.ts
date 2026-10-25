import { OUTER_POIS, TerrainPoi } from './Terrain';

/**
 * Áreas com nome da ilha (como os pontos de interesse do Fortnite): as da comunidade, no
 * meio, e as do anel externo (Terrain.OUTER_POIS). O nome aparece na tela ao entrar na área
 * e no minimapa.
 */
export const COMMUNITY_PLACES: TerrainPoi[] = [
  { name: 'QUEBRADA CENTRAL', x: 0, z: 0, r: 34 },
  { name: 'MORRO DA PAZ', x: -100, z: 98, r: 52 },
  { name: 'CAMPINHO', x: 43, z: -18, r: 16 },
  { name: 'MATA DA QUEBRADA', x: 104, z: -20, r: 30 },
  { name: 'BECO DO GRAFITE', x: 80, z: 80, r: 40 },
  { name: 'VILA DO ASFALTO', x: -80, z: -80, r: 40 },
  { name: 'LADEIRA DO SOL', x: 85, z: -95, r: 34 },
];

export const ALL_PLACES: TerrainPoi[] = [...COMMUNITY_PLACES, ...OUTER_POIS];

/** Nome da área em (x, z) (a mais próxima do centro, se duas se cruzam), ou null. */
export function placeAt(x: number, z: number): string | null {
  let best: TerrainPoi | null = null;
  let bestD = Infinity;
  for (const p of ALL_PLACES) {
    const d = Math.hypot(x - p.x, z - p.z) / p.r;
    if (d < 1 && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best?.name ?? null;
}
