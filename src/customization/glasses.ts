/**
 * Óculos: um único modelo 3D (o enviado, estilo Juliet), gerado por
 * `tools/blender/glasses.py` a partir de `art/source/oculos-original.glb` e já encaixado no
 * rosto do manequim. As variações mudam só cores e acabamento:
 * armação (cor e quanto é metálica), detalhes (ponte, dobradiças, hastes) e lente (cor e
 * quanto é espelhada). O formato é sempre o mesmo.
 */
export type GlassesVariantId =
  | 'lupa_grafite'
  | 'lupa_rosa'
  | 'lupa_dourada'
  | 'lupa_titanio'
  | 'lupa_verde'
  | 'lupa_azul'
  | 'lupa_ciano'
  | 'lupa_vermelha'
  | 'lupa_roxa'
  | 'lupa_ambar';

/** Ids da versão anterior do catálogo → variação equivalente (preserva a escolha salva). */
export const GLASSES_LEGACY: Record<string, GlassesVariantId> = {
  grafite_escura: 'lupa_grafite',
  preto_verde: 'lupa_verde',
  preto_azul: 'lupa_azul',
  preto_laranja: 'lupa_vermelha',
  preto_rosa: 'lupa_rosa',
  prata_dourada: 'lupa_dourada',
  prata_ciano: 'lupa_ciano',
  dourado_escura: 'lupa_titanio',
  grafite_roxa: 'lupa_roxa',
  prata_ambar: 'lupa_ambar',
};

export interface GlassesDef {
  id: GlassesVariantId;
  name: string;
  frame: string;
  /** 0 = fosco (plástico), 1 = metal polido. */
  frameMetal: number;
  accent: string;
  lens: string;
  /** 0 = lente lisa, 1 = espelhada. */
  mirror: number;
}

// As 10 variações das referências (estilo "lupa"/Juliet, sem logotipo de marca).
// Mesmas cores das miniaturas (VARIANTS em tools/blender/glasses.py).
// frame = aro das lentes; accent = ponte, dobradiças e hastes; lens = tom da lente.
export const GLASSES_CATALOG: readonly GlassesDef[] = [
  { id: 'lupa_grafite', name: 'Lupa preto grafite', frame: '#1e1f23', frameMetal: 0.55, accent: '#2a2c31', lens: '#15171b', mirror: 0.3 },
  { id: 'lupa_rosa', name: 'Lupa rosa espelhada', frame: '#26272c', frameMetal: 0.7, accent: '#ff2d95', lens: '#ff3fd0', mirror: 0.95 },
  { id: 'lupa_dourada', name: 'Lupa dourada', frame: '#c9cdd2', frameMetal: 1, accent: '#d9a520', lens: '#f0b91e', mirror: 0.95 },
  { id: 'lupa_titanio', name: 'Lupa titânio · lente escura', frame: '#c4c7cb', frameMetal: 1, accent: '#a8895a', lens: '#1c1d21', mirror: 0.35 },
  { id: 'lupa_verde', name: 'Lupa verde espelhada', frame: '#44474d', frameMetal: 0.9, accent: '#44474d', lens: '#2fd64a', mirror: 0.95 },
  { id: 'lupa_azul', name: 'Lupa azul espelhada', frame: '#5a5e66', frameMetal: 0.95, accent: '#5a5e66', lens: '#1f6bff', mirror: 0.95 },
  { id: 'lupa_ciano', name: 'Lupa azul-ciano', frame: '#dfe2e6', frameMetal: 1, accent: '#dfe2e6', lens: '#39c6ff', mirror: 0.95 },
  { id: 'lupa_vermelha', name: 'Lupa vermelha espelhada', frame: '#b3121b', frameMetal: 0.9, accent: '#b3121b', lens: '#ff3a14', mirror: 0.95 },
  { id: 'lupa_roxa', name: 'Lupa roxa espelhada', frame: '#26272c', frameMetal: 0.7, accent: '#7b2fd6', lens: '#6a2cff', mirror: 0.95 },
  { id: 'lupa_ambar', name: 'Lupa âmbar espelhada', frame: '#c4c7cb', frameMetal: 1, accent: '#c4c7cb', lens: '#ff7a12', mirror: 0.95 },
];

const BASE = `${import.meta.env.BASE_URL}assets/customization/glasses/`;

/** Malhas do modelo, no espaço do personagem com origem no centro dos olhos (1,615 m). */
export const GLASSES_URL = `${BASE}glasses_base.glb`;
export const GLASSES_MESHES = { frame: 'Oculos_Armacao', accent: 'Oculos_Detalhe', lens: 'Oculos_Lente' } as const;

export function glassesById(id: string): GlassesDef | undefined {
  return GLASSES_CATALOG.find((g) => g.id === id);
}

export function glassesThumb(id: GlassesVariantId): string {
  return `${BASE}${id}/thumb.webp`;
}
