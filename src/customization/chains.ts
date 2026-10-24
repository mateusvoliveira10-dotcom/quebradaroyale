/**
 * Correntes de MC em 3D, geradas por `tools/blender/chains.py`: elos modelados um a um ao
 * longo de uma volta em torno do pescoço, assentada sobre o peito e por cima de qualquer
 * camisa, com skinning no tronco/pescoço (acompanham as animações). Cada corrente tem a
 * malha de ouro e, quando cravejada, a das pedras.
 */
export type ChainId = 'corrente_foco_fe_forca' | 'corrente_coroa_7' | 'corrente_cifrao' | 'corrente_grumet';

export interface ChainDef {
  id: ChainId;
  name: string;
  /** Malhas dentro de chains_base.glb. */
  gold: string;
  stones?: string;
}

export const CHAIN_CATALOG: readonly ChainDef[] = [
  { id: 'corrente_foco_fe_forca', name: 'Bismarck · medalha Foco Fé Força', gold: 'Corrente_Foco_Ouro' },
  { id: 'corrente_coroa_7', name: 'Laço · placa 7 com coroa', gold: 'Corrente_Coroa7_Ouro', stones: 'Corrente_Coroa7_Pedras' },
  { id: 'corrente_cifrao', name: 'Grumet fina · cifrão cravejado', gold: 'Corrente_Cifrao_Ouro', stones: 'Corrente_Cifrao_Pedras' },
  { id: 'corrente_grumet', name: 'Grumet grossa', gold: 'Corrente_Grumet_Ouro' },
];

/** Ids antigos (argola simples) → corrente equivalente, para não perder a escolha salva. */
export const CHAIN_LEGACY: Record<string, ChainId> = {
  corrente_ouro: 'corrente_grumet',
  corrente_prata: 'corrente_grumet',
};

const BASE = `${import.meta.env.BASE_URL}assets/customization/chains/`;
export const CHAINS_URL = `${BASE}chains_base.glb`;

export function chainById(id: string): ChainDef | undefined {
  return CHAIN_CATALOG.find((c) => c.id === id);
}

export function chainThumb(id: ChainId): string {
  return `${BASE}${id}/thumb.webp`;
}
