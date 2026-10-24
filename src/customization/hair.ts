import type { HairId } from '../appearance/Appearance';

/**
 * Cabelos 3D: malhas moldadas no couro cabeludo do personagem-base, com skinning no osso da
 * cabeça, geradas por `tools/blender/hair.py`. Cada corte é uma malha; as cores (castanho,
 * platinado, reflexos) são texturas sobre a mesma malha. O degradê raspado continua pintado
 * no corpo (ClothingMaterial.ts) e a malha começa onde a pintura já é cabelo cheio.
 */
const BASE = `${import.meta.env.BASE_URL}assets/customization/hair/`;

export const HAIR_URL = `${BASE}hair_base.glb`;

export const HAIR_MESH: Record<HairId, string> = {
  degrade_baixo: 'Cabelo_Degrade',
  degrade_americano: 'Cabelo_Americano',
  risquinho: 'Cabelo_Risquinho',
  cacheado: 'Cabelo_Cacheado',
  platinado: 'Cabelo_Degrade',
  reflexo_dourado: 'Cabelo_Degrade',
  reflexo_prateado: 'Cabelo_Degrade',
};

export function hairFiles(id: HairId) {
  return {
    albedo: `${BASE}${id}/albedo.webp`,
    normal: `${BASE}${HAIR_MESH[id].toLowerCase()}_normal.png`,
    thumb: `${BASE}${id}/thumb.webp`,
  };
}
