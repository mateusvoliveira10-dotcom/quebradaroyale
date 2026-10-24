/**
 * Catálogo central das camisas. Para adicionar uma camisa nova:
 *  1. desenhe a estampa em `tools/blender/jerseys.py` (lista JERSEYS) e rode o script,
 *     que gera `public/assets/customization/jerseys/<id>/` (albedo.webp, front.png,
 *     back.png, thumb.webp);
 *  2. acrescente a entrada aqui, com o mesmo id e o tipo de gola.
 * A malha é comum (`jersey_base.glb`, uma variante por gola) e o normal map de tecido
 * também (`fabric_normal.png`): cada camisa só traz a própria textura.
 *
 * Escudos são desenhos genéricos, sem logotipos oficiais, fabricantes ou patrocinadores.
 */
export type JerseyId =
  | 'jersey_atletico_mg'
  | 'jersey_cruzeiro'
  | 'jersey_sao_paulo'
  | 'jersey_santos'
  | 'jersey_palmeiras'
  | 'jersey_flamengo'
  | 'jersey_bahia'
  | 'jersey_gremio'
  | 'jersey_fluminense'
  | 'jersey_botafogo'
  | 'mike_tee_wave'
  | 'mike_tee_sport'
  | 'mike_long_tech'
  | 'mike_tank'
  | 'adimas_tee_classic'
  | 'adimas_tee_street'
  | 'adimas_long_track'
  | 'adimas_tank';

/**
 * Modelo de malha (variantes do jersey_base.glb), todos de gola redonda: manga curta,
 * manga longa e regata (sem manga).
 */
export type CollarType = 'crew' | 'long' | 'tank';

/** Nome do modelo na interface. */
export const COLLAR_LABEL: Record<CollarType, string> = {
  crew: 'Manga curta',
  long: 'Manga longa',
  tank: 'Regata',
};

export interface JerseyDef {
  id: JerseyId;
  /** Nome exibido (time de inspiração). */
  name: string;
  collar: CollarType;
  /** Cores principais, usadas em amostras da interface e em acessórios combinando (boné, mochila). */
  primary: string;
  secondary: string;
  trim: string;
}

export const JERSEY_CATALOG: readonly JerseyDef[] = [
  { id: 'jersey_atletico_mg', name: 'Atlético-MG', collar: 'crew', primary: '#161616', secondary: '#f3f3f1', trim: '#161616' },
  { id: 'jersey_cruzeiro', name: 'Cruzeiro', collar: 'crew', primary: '#1d3fc2', secondary: '#f3f3f1', trim: '#f3f3f1' },
  { id: 'jersey_sao_paulo', name: 'São Paulo', collar: 'crew', primary: '#f3f3f1', secondary: '#d01d24', trim: '#161616' },
  { id: 'jersey_santos', name: 'Santos', collar: 'crew', primary: '#f3f3f1', secondary: '#161616', trim: '#161616' },
  { id: 'jersey_palmeiras', name: 'Palmeiras', collar: 'crew', primary: '#0f5b38', secondary: '#f3f3f1', trim: '#f3f3f1' },
  { id: 'jersey_flamengo', name: 'Flamengo', collar: 'crew', primary: '#d0151c', secondary: '#161616', trim: '#161616' },
  { id: 'jersey_bahia', name: 'Bahia', collar: 'crew', primary: '#f3f3f1', secondary: '#1f4fd6', trim: '#d81e2a' },
  { id: 'jersey_gremio', name: 'Grêmio', collar: 'crew', primary: '#3a8fe6', secondary: '#161616', trim: '#f3f3f1' },
  { id: 'jersey_fluminense', name: 'Fluminense', collar: 'crew', primary: '#7d1a26', secondary: '#0f6b3d', trim: '#f3f3f1' },
  { id: 'jersey_botafogo', name: 'Botafogo', collar: 'crew', primary: '#161616', secondary: '#f3f3f1', trim: '#161616' },
  // Marcas fictícias "Mike" e "Adimas": logotipos e letreiros próprios (tools/blender/jerseys.py),
  // inspirados no streetwear esportivo, sem copiar símbolos reais.
  { id: 'mike_tee_wave', name: 'Mike Wave (preta)', collar: 'crew', primary: '#121214', secondary: '#f4f4f2', trim: '#ff4b3a' },
  { id: 'mike_tee_sport', name: 'Mike Sport (branca)', collar: 'crew', primary: '#f4f4f2', secondary: '#e3262f', trim: '#141416' },
  { id: 'mike_long_tech', name: 'Mike Tech manga longa', collar: 'long', primary: '#1a2238', secondary: '#33373f', trim: '#c8ff2e' },
  { id: 'mike_tank', name: 'Regata Mike 7', collar: 'tank', primary: '#d0121b', secondary: '#121214', trim: '#f4f4f2' },
  { id: 'adimas_tee_classic', name: 'Adimas Classic (branca)', collar: 'crew', primary: '#f4f4f2', secondary: '#141416', trim: '#141416' },
  { id: 'adimas_tee_street', name: 'Adimas Street (preta)', collar: 'crew', primary: '#121214', secondary: '#e1b54a', trim: '#e1b54a' },
  { id: 'adimas_long_track', name: 'Adimas Track manga longa', collar: 'long', primary: '#14204a', secondary: '#f4f4f2', trim: '#c8202a' },
  { id: 'adimas_tank', name: 'Regata Adimas 10', collar: 'tank', primary: '#f4f4f2', secondary: '#1f4fd6', trim: '#1f4fd6' },
];

export const DEFAULT_JERSEY: JerseyId = 'jersey_flamengo';

/** Ids da primeira versão das peças Mike/Adimas → peça nova equivalente (preserva a escolha salva). */
export const JERSEY_LEGACY: Record<string, JerseyId> = {
  cv_mike_retro: 'mike_long_tech',
  cv_mike_neon: 'mike_long_tech',
  cv_adimas_classico: 'adimas_long_track',
  cv_adimas_brasil: 'adimas_long_track',
  regata_mike: 'mike_tank',
  regata_adimas: 'adimas_tank',
  tee_mike: 'mike_tee_wave',
  tee_adimas: 'adimas_tee_classic',
};

const BASE = `${import.meta.env.BASE_URL}assets/customization/jerseys/`;

/** Arquivos comuns a todas as camisas. */
export const JERSEY_SHARED = {
  mesh: `${BASE}jersey_base.glb`,
  fabricNormal: `${BASE}fabric_normal.png`,
  /** Nome da malha de cada gola dentro de jersey_base.glb. */
  meshName: { crew: 'Camisa_GolaRedonda', long: 'Camisa_MangaLonga', tank: 'Regata' } as Record<CollarType, string>,
};

/** Arquivos de uma camisa (todos gerados por tools/blender/jerseys.py). */
export function jerseyFiles(id: JerseyId) {
  return {
    albedo: `${BASE}${id}/albedo.webp`,
    front: `${BASE}${id}/front.png`,
    back: `${BASE}${id}/back.png`,
    thumb: `${BASE}${id}/thumb.webp`,
  };
}

export function jerseyById(id: string): JerseyDef | undefined {
  return JERSEY_CATALOG.find((j) => j.id === id);
}
