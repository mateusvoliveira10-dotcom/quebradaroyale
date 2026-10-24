import { HoldStyle } from '../player/CharacterModel';

export type WeaponId = 'pistola' | 'smg' | 'escopeta' | 'fuzil' | 'sniper';
export type AmmoType = 'leve' | 'media' | 'cartucho' | 'pesada';
export type SoundKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  hold: Exclude<HoldStyle, null>;
  ammo: AmmoType;
  damage: number;
  /** Segundos entre disparos. */
  fireInterval: number;
  auto: boolean;
  magSize: number;
  reloadTime: number;
  /** Abertura do cone de dispersão (rad) sem mirar / mirando. */
  spread: number;
  aimSpread: number;
  pellets: number;
  range: number;
  recoilPitch: number;
  recoilYaw: number;
  shake: number;
  /** FOV ao mirar (luneta). */
  zoomFov?: number;
  /** Multiplicador de dano na cabeça (crítico). */
  headMult: number;
  /**
   * Precisão do primeiro tiro: parado, no chão e mirando, depois deste tempo sem
   * atirar (s), o próximo tiro vai exatamente no centro. 0 = arma sem esse bônus.
   */
  firstShot: number;
  /** Abertura extra (rad) somada a cada disparo (bloom) e o máximo acumulado. */
  bloomPerShot: number;
  bloomMax: number;
  /** Queda de dano com a distância: integral até `near` m, cai até `minMult` em `far` m. */
  falloff?: { near: number; far: number; minMult: number };
  /** Formato da mira na tela. */
  reticle: 'cross' | 'circle' | 'dot';
  sound: SoundKind;
  /** Peso para sorteio do loot. */
  lootWeight: number;
  minRarity: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistola: {
    id: 'pistola', name: 'Pistola 9mm', hold: 'pistol', ammo: 'leve', damage: 24, fireInterval: 0.17, auto: false,
    magSize: 15, reloadTime: 1.3, spread: 0.02, aimSpread: 0.006, pellets: 1, range: 90,
    recoilPitch: 0.014, recoilYaw: 0.006, shake: 0.03, sound: 'pistol', lootWeight: 30, minRarity: 0,
    headMult: 2, firstShot: 0.22, bloomPerShot: 0.006, bloomMax: 0.03, falloff: { near: 30, far: 70, minMult: 0.7 }, reticle: 'cross',
  },
  smg: {
    id: 'smg', name: 'Submetralhadora', hold: 'rifle', ammo: 'leve', damage: 15, fireInterval: 0.075, auto: true,
    magSize: 30, reloadTime: 1.9, spread: 0.042, aimSpread: 0.02, pellets: 1, range: 70,
    recoilPitch: 0.007, recoilYaw: 0.006, shake: 0.02, sound: 'smg', lootWeight: 22, minRarity: 0,
    headMult: 1.75, firstShot: 0, bloomPerShot: 0.003, bloomMax: 0.03, falloff: { near: 15, far: 45, minMult: 0.6 }, reticle: 'cross',
  },
  escopeta: {
    id: 'escopeta', name: 'Escopeta 12', hold: 'rifle', ammo: 'cartucho', damage: 11, fireInterval: 0.85, auto: false,
    magSize: 6, reloadTime: 2.4, spread: 0.085, aimSpread: 0.065, pellets: 9, range: 35,
    recoilPitch: 0.055, recoilYaw: 0.015, shake: 0.12, sound: 'shotgun', lootWeight: 20, minRarity: 0,
    headMult: 1.5, firstShot: 0, bloomPerShot: 0, bloomMax: 0, falloff: { near: 6, far: 25, minMult: 0.35 }, reticle: 'circle',
  },
  fuzil: {
    id: 'fuzil', name: 'Fuzil de Assalto', hold: 'rifle', ammo: 'media', damage: 30, fireInterval: 0.11, auto: true,
    magSize: 30, reloadTime: 2.2, spread: 0.028, aimSpread: 0.008, pellets: 1, range: 140,
    recoilPitch: 0.013, recoilYaw: 0.008, shake: 0.035, sound: 'rifle', lootWeight: 20, minRarity: 1,
    headMult: 2, firstShot: 0.32, bloomPerShot: 0.004, bloomMax: 0.035, falloff: { near: 50, far: 120, minMult: 0.75 }, reticle: 'cross',
  },
  sniper: {
    id: 'sniper', name: 'Rifle de Precisão', hold: 'rifle', ammo: 'pesada', damage: 95, fireInterval: 1.25, auto: false,
    magSize: 5, reloadTime: 2.8, spread: 0.07, aimSpread: 0.0, pellets: 1, range: 300,
    recoilPitch: 0.08, recoilYaw: 0.01, shake: 0.15, zoomFov: 0.3, sound: 'sniper', lootWeight: 8, minRarity: 2,
    headMult: 2.5, firstShot: 0, bloomPerShot: 0, bloomMax: 0, reticle: 'dot',
  },
};

export const RARITIES = [
  { name: 'Comum', color: '#c3cbd3' },
  { name: 'Incomum', color: '#3fd16b' },
  { name: 'Rara', color: '#3a9cff' },
  { name: 'Épica', color: '#b65cff' },
  { name: 'Lendária', color: '#ffb21f' },
] as const;

/** Bônus de dano por raridade. */
export function rarityDamage(rarity: number): number {
  return 1 + rarity * 0.08;
}

export const AMMO: Record<AmmoType, { name: string; color: string; pickup: number; max: number }> = {
  leve: { name: 'Munição leve', color: '#9fd8ff', pickup: 30, max: 240 },
  media: { name: 'Munição média', color: '#7dff9a', pickup: 30, max: 240 },
  cartucho: { name: 'Cartuchos', color: '#ffb35c', pickup: 8, max: 48 },
  pesada: { name: 'Munição pesada', color: '#ff7a7a', pickup: 6, max: 24 },
};
