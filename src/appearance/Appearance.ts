import { CHAIN_CATALOG, CHAIN_LEGACY, ChainId } from '../customization/chains';
import { GLASSES_CATALOG, GLASSES_LEGACY, GlassesVariantId } from '../customization/glasses';
import { DEFAULT_JERSEY, JERSEY_CATALOG, JERSEY_LEGACY, JerseyId } from '../customization/jerseys';
import { Rng } from '../utils/random';

export type HairId = 'degrade_baixo' | 'degrade_americano' | 'risquinho' | 'cacheado' | 'platinado' | 'reflexo_dourado' | 'reflexo_prateado';
/** Variação do modelo único de óculos, ou 'nenhum'. */
export type GlassesId = 'nenhum' | GlassesVariantId;
/** Camisa do catálogo, ou 'none' (sem camisa). */
export type JerseyChoice = JerseyId | 'none';
export type AccessoryId = ChainId | 'bone_tras' | 'bone_frente' | 'bone_aba_reta' | 'pulseiras' | 'relogio' | 'mochila';
export type BottomId = 'bermuda_esportiva' | 'bermuda_jeans' | 'calca_cargo' | 'calca_jogger' | 'calca_jeans'
  | 'bermuda_tactel_degrade' | 'bermuda_tactel_preta' | 'bermuda_tactel_vermelha' | 'bermuda_camuflada' | 'bermuda_moletom' | 'calca_tactel' | 'calca_moletom';
export type ShoesId = 'tenis_branco' | 'tenis_preto' | 'tenis_casual' | 'chuteira'
  | 'tenis_mola' | 'tenis_mola_preto' | 'tenis_bolha' | 'tenis_curva_preto' | 'tenis_quadra';

export interface Appearance {
  hair: HairId;
  glasses: GlassesId;
  jersey: JerseyChoice;
  accessories: AccessoryId[];
  bottom: BottomId;
  shoes: ShoesId;
}

export interface Option<T extends string> {
  id: T;
  name: string;
}

export const HAIR_OPTIONS: Option<HairId>[] = [
  { id: 'degrade_baixo', name: 'Degradê baixo' },
  { id: 'degrade_americano', name: 'Degradê americano' },
  { id: 'risquinho', name: 'Com risquinho' },
  { id: 'cacheado', name: 'Cacheado curto' },
  { id: 'platinado', name: 'Platinado' },
  { id: 'reflexo_dourado', name: 'Reflexos dourados' },
  { id: 'reflexo_prateado', name: 'Reflexos prateados' },
];

export const GLASSES_OPTIONS: Option<GlassesId>[] = [{ id: 'nenhum', name: 'Sem óculos' }, ...GLASSES_CATALOG.map((g) => ({ id: g.id, name: g.name }))];

/** Opções de camisa: as do catálogo + "sem camisa". */
export const JERSEY_OPTIONS: Option<JerseyChoice>[] = [...JERSEY_CATALOG.map((j) => ({ id: j.id, name: j.name })), { id: 'none', name: 'Sem camisa' }];

export const ACCESSORY_OPTIONS: Option<AccessoryId>[] = [
  ...CHAIN_CATALOG.map((c) => ({ id: c.id, name: c.name })),
  { id: 'bone_frente', name: 'Boné aba curva (frente)' },
  { id: 'bone_aba_reta', name: 'Boné aba reta (frente)' },
  { id: 'bone_tras', name: 'Boné aba reta (para trás)' },
  { id: 'pulseiras', name: 'Pulseiras' },
  { id: 'relogio', name: 'Relógio' },
  { id: 'mochila', name: 'Mochila' },
];

export const BOTTOM_OPTIONS: Option<BottomId>[] = [
  { id: 'bermuda_esportiva', name: 'Bermuda esportiva' },
  { id: 'bermuda_jeans', name: 'Bermuda jeans' },
  { id: 'calca_cargo', name: 'Calça cargo' },
  { id: 'calca_jogger', name: 'Calça jogger' },
  { id: 'calca_jeans', name: 'Calça jeans' },
  { id: 'bermuda_tactel_degrade', name: 'Bermuda tactel degradê' },
  { id: 'bermuda_tactel_preta', name: 'Bermuda tactel preta neon' },
  { id: 'bermuda_tactel_vermelha', name: 'Bermuda tactel vermelha' },
  { id: 'bermuda_camuflada', name: 'Bermuda cargo camuflada' },
  { id: 'bermuda_moletom', name: 'Bermuda moletom mescla' },
  { id: 'calca_tactel', name: 'Calça tactel com vivo' },
  { id: 'calca_moletom', name: 'Calça moletom mescla' },
];

export const SHOES_OPTIONS: Option<ShoesId>[] = [
  { id: 'tenis_branco', name: 'Tênis esportivo branco' },
  { id: 'tenis_preto', name: 'Tênis preto' },
  { id: 'tenis_casual', name: 'Tênis casual' },
  { id: 'chuteira', name: 'Chuteira' },
  { id: 'tenis_mola', name: 'Tênis de mola branco/azul' },
  { id: 'tenis_mola_preto', name: 'Tênis de mola preto/laranja' },
  { id: 'tenis_bolha', name: 'Tênis bolha branco/vermelho' },
  { id: 'tenis_curva_preto', name: 'Tênis faixa curva preto' },
  { id: 'tenis_quadra', name: 'Tênis de quadra couro branco' },
];

/** Acessórios que não podem ser usados juntos. */
const EXCLUSIVE: AccessoryId[][] = [
  ['bone_tras', 'bone_frente', 'bone_aba_reta'],
  CHAIN_CATALOG.map((c) => c.id),
];

export function defaultAppearance(): Appearance {
  return {
    hair: 'reflexo_dourado',
    glasses: 'nenhum',
    jersey: DEFAULT_JERSEY,
    accessories: ['corrente_grumet', 'relogio'],
    bottom: 'bermuda_esportiva',
    shoes: 'tenis_branco',
  };
}

/** Liga/desliga um acessório respeitando exclusividades. */
export function toggleAccessory(app: Appearance, id: AccessoryId): Appearance {
  const has = app.accessories.includes(id);
  let list = app.accessories.filter((a) => a !== id);
  if (!has) {
    const group = EXCLUSIVE.find((g) => g.includes(id));
    if (group) list = list.filter((a) => !group.includes(a));
    list.push(id);
  }
  return { ...app, accessories: list };
}

const KEY = 'quebrada-royale.appearance.v1';

function valid<T extends string>(options: Option<T>[], value: unknown, fallback: T): T {
  return options.some((o) => o.id === value) ? (value as T) : fallback;
}

/** Carrega a aparência salva no navegador (com validação de cada campo). */
export function loadAppearance(): Appearance {
  const d = defaultAppearance();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<Appearance>;
    // Correntes antigas (argola simples) viram a corrente equivalente.
    const acc = Array.isArray(o.accessories)
      ? o.accessories.map((a) => CHAIN_LEGACY[a as string] ?? a).filter((a) => ACCESSORY_OPTIONS.some((x) => x.id === a))
      : d.accessories;
    return {
      hair: valid(HAIR_OPTIONS, o.hair, d.hair),
      // Óculos do catálogo anterior viram a variação equivalente.
      glasses: valid(GLASSES_OPTIONS, GLASSES_LEGACY[o.glasses as string] ?? o.glasses, d.glasses),
      // Camisas do catálogo antigo (ex.: 'brasil') não existem mais: voltam para a padrão.
      jersey: valid(JERSEY_OPTIONS, JERSEY_LEGACY[o.jersey as string] ?? o.jersey, d.jersey),
      accessories: acc as AccessoryId[],
      bottom: valid(BOTTOM_OPTIONS, o.bottom, d.bottom),
      shoes: valid(SHOES_OPTIONS, o.shoes, d.shoes),
    };
  } catch {
    return d;
  }
}

export function saveAppearance(app: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(app));
  } catch {
    // Armazenamento indisponível (aba anônima, cota): segue sem salvar.
  }
}

/** Visual aleatório para os bots. */
export function randomAppearance(rng: Rng, jersey?: JerseyId): Appearance {
  const acc: AccessoryId[] = [];
  if (rng.chance(0.5)) acc.push(rng.pick(CHAIN_CATALOG).id);
  if (rng.chance(0.4)) acc.push(rng.pick(['bone_tras', 'bone_frente', 'bone_aba_reta'] as const));
  if (rng.chance(0.3)) acc.push('pulseiras');
  if (rng.chance(0.3)) acc.push('relogio');
  if (rng.chance(0.25)) acc.push('mochila');
  return {
    hair: rng.pick(HAIR_OPTIONS).id,
    glasses: rng.chance(0.45) ? rng.pick(GLASSES_OPTIONS).id : 'nenhum',
    jersey: jersey ?? rng.pick(JERSEY_CATALOG).id,
    accessories: acc,
    bottom: rng.pick(BOTTOM_OPTIONS).id,
    shoes: rng.pick(SHOES_OPTIONS).id,
  };
}
