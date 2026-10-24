export type Quality = 'alta' | 'media' | 'baixa';

export interface Settings {
  /** Multiplicador da sensibilidade do mouse. */
  sensitivity: number;
  /** Sensibilidade ao mirar (botão direito), fração da normal. */
  aimSensitivity: number;
  /** Sensibilidade na luneta do rifle de precisão, fração da normal. */
  scopeSensitivity: number;
  invertY: boolean;
  /** Campo de visão em graus. */
  fov: number;
  /** Volume geral 0..1. */
  volume: number;
  quality: Quality;
  playerName: string;
}

const KEY = 'quebrada-royale.settings.v1';

export function defaultSettings(): Settings {
  return { sensitivity: 1, aimSensitivity: 0.65, scopeSensitivity: 0.65, invertY: false, fov: 53, volume: 0.8, quality: 'alta', playerName: 'Cria da Quebrada' };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<Settings>;
    const num = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : fb);
    return {
      sensitivity: num(o.sensitivity, 0.2, 3, d.sensitivity),
      aimSensitivity: num(o.aimSensitivity, 0.1, 1.5, d.aimSensitivity),
      scopeSensitivity: num(o.scopeSensitivity, 0.1, 1.5, d.scopeSensitivity),
      invertY: typeof o.invertY === 'boolean' ? o.invertY : d.invertY,
      fov: num(o.fov, 40, 75, d.fov),
      volume: num(o.volume, 0, 1, d.volume),
      quality: o.quality === 'alta' || o.quality === 'media' || o.quality === 'baixa' ? o.quality : d.quality,
      playerName: typeof o.playerName === 'string' && o.playerName.trim() ? o.playerName.trim().slice(0, 18) : d.playerName,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Sem armazenamento: segue com os valores em memória.
  }
}
