import { HAIR_OPTIONS, type BottomId, type ShoesId } from '../appearance/Appearance';
import { CHAIN_CATALOG, CHAINS_URL } from './chains';
import { HAIR_MESH, HAIR_URL, hairFiles } from './hair';
import { JERSEY_CATALOG, JERSEY_SHARED, jerseyFiles } from './jerseys';

/**
 * Catálogo das roupas 3D (malhas com skinning no esqueleto do personagem-base).
 * Camisas ficam em jerseys.ts; aqui estão partes de baixo e calçados, e a lista
 * de tudo o que o carregador (GarmentAsset) precisa: arquivos de malha e materiais.
 *
 * Malhas e texturas são geradas por `tools/blender/garments.py` (partes de baixo e
 * tênis) e `tools/blender/jerseys.py` (camisas). Para adicionar uma peça: desenhe-a
 * no script, rode-o e acrescente a entrada aqui com o mesmo id.
 */
export type GarmentSlot = 'top' | 'bottom' | 'feet';

export interface GarmentDef<T extends string = string> {
  id: T;
  name: string;
  /** Nome da malha dentro do GLB da categoria. */
  mesh: string;
  /** Altura (m) onde a peça termina embaixo — usada para esconder a pele coberta. */
  end?: number;
}

const BASE = `${import.meta.env.BASE_URL}assets/customization/`;

export const BOTTOM_CATALOG: readonly GarmentDef<BottomId>[] = [
  { id: 'bermuda_esportiva', name: 'Bermuda esportiva', mesh: 'Bermuda_Curta', end: 0.6 },
  { id: 'bermuda_jeans', name: 'Bermuda jeans', mesh: 'Bermuda_Longa', end: 0.53 },
  { id: 'calca_cargo', name: 'Calça cargo', mesh: 'Calca', end: 0.1 },
  { id: 'calca_jogger', name: 'Calça jogger', mesh: 'Calca', end: 0.1 },
  { id: 'calca_jeans', name: 'Calça jeans', mesh: 'Calca', end: 0.1 },
];

export const SHOE_CATALOG: readonly GarmentDef<ShoesId>[] = [
  { id: 'tenis_branco', name: 'Tênis esportivo branco', mesh: 'Tenis' },
  { id: 'tenis_preto', name: 'Tênis preto', mesh: 'Tenis' },
  { id: 'tenis_casual', name: 'Tênis casual', mesh: 'Tenis' },
  { id: 'chuteira', name: 'Chuteira', mesh: 'Tenis' },
];

export function bottomById(id: string): GarmentDef<BottomId> | undefined {
  return BOTTOM_CATALOG.find((b) => b.id === id);
}

export function shoeById(id: string): GarmentDef<ShoesId> | undefined {
  return SHOE_CATALOG.find((s) => s.id === id);
}

export function garmentFiles(slot: 'bottom' | 'feet', id: string) {
  const dir = `${BASE}${slot === 'bottom' ? 'bottoms' : 'shoes'}/${id}/`;
  return { albedo: `${dir}albedo.webp`, normal: `${dir}normal.png`, thumb: `${dir}thumb.webp` };
}

/** Tudo o que o carregador precisa: GLBs com as malhas e um material por peça. */
export const GARMENT_SOURCES = {
  meshes: [
    { url: JERSEY_SHARED.mesh, names: Object.values(JERSEY_SHARED.meshName) },
    { url: `${BASE}bottoms/bottoms_base.glb`, names: ['Bermuda_Curta', 'Bermuda_Longa', 'Calca'] },
    { url: `${BASE}shoes/shoes_base.glb`, names: ['Tenis'] },
    { url: CHAINS_URL, names: CHAIN_CATALOG.flatMap((c) => (c.stones ? [c.gold, c.stones] : [c.gold])) },
    { url: HAIR_URL, names: [...new Set(Object.values(HAIR_MESH))] },
  ],
  materials: [
    ...HAIR_OPTIONS.map((h) => ({ id: `cabelo_${h.id}`, ...pick(hairFiles(h.id)), roughness: 0.68 })),
    ...JERSEY_CATALOG.map((j) => ({ id: j.id, albedo: jerseyFiles(j.id).albedo, normal: JERSEY_SHARED.fabricNormal, roughness: 0.82 })),
    ...BOTTOM_CATALOG.map((b) => ({ id: b.id, ...pick(garmentFiles('bottom', b.id)), roughness: 0.9 })),
    ...SHOE_CATALOG.map((s) => ({ id: s.id, ...pick(garmentFiles('feet', s.id)), roughness: 0.7 })),
  ],
};

function pick(f: { albedo: string; normal: string }) {
  return { albedo: f.albedo, normal: f.normal };
}
