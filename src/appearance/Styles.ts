import { HairId } from './Appearance';

// Camisas, partes de baixo e calçados são roupas 3D, com catálogo em src/customization/.

export interface HairStyle {
  shape: 'fade' | 'high' | 'line' | 'curly';
  base: string;
  dark: string;
  highlight: string;
  /** 0..1 quantidade de luzes/reflexos. */
  amount: number;
}

export const HAIRS: Record<HairId, HairStyle> = {
  degrade_baixo: { shape: 'fade', base: '#24160d', dark: '#140b06', highlight: '#5a3a22', amount: 0.25 },
  degrade_americano: { shape: 'high', base: '#1c120b', dark: '#0e0805', highlight: '#4d3220', amount: 0.25 },
  risquinho: { shape: 'line', base: '#1f140c', dark: '#100905', highlight: '#4a3020', amount: 0.25 },
  cacheado: { shape: 'curly', base: '#22150c', dark: '#120a05', highlight: '#5c3c22', amount: 0.35 },
  platinado: { shape: 'fade', base: '#e9e2cf', dark: '#c9bfa6', highlight: '#ffffff', amount: 0.8 },
  reflexo_dourado: { shape: 'fade', base: '#24160d', dark: '#140b06', highlight: '#e8b867', amount: 0.85 },
  reflexo_prateado: { shape: 'fade', base: '#1b1716', dark: '#0d0a0a', highlight: '#d9dde3', amount: 0.85 },
};

// Óculos: modelo 3D único com variações de cor, catálogo em src/customization/glasses.ts.
