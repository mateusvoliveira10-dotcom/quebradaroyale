import { loadSettings } from './Settings';

/** Volume da música em relação ao volume geral (fica abaixo dos efeitos). */
const MUSIC_GAIN = 0.6;
const FADE_IN = 1.5;
const FADE_OUT = 1.2;

/**
 * Música tema ("Quebrada Royale", `public/assets/audio/quebrada-royale.mp3`): toca em loop
 * desde a tela de carregamento, segue no lobby e na escolha do modo e some com fade quando
 * a partida começa. Volta ao voltar para o lobby, do ponto em que parou.
 *
 * Os navegadores bloqueiam som antes do primeiro gesto do usuário; se o play inicial for
 * recusado, ela começa no primeiro clique, toque ou tecla.
 */
class ThemeMusic {
  private readonly el: HTMLAudioElement;
  private volume = loadSettings().volume;
  /** Deve estar tocando (abertura e lobby) ou não (partida). */
  private wanted = false;
  private level = 0;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeStart = 0;
  private fadeDur = 0;
  private raf = 0;
  private waitingGesture = false;

  constructor() {
    this.el = new Audio(`${import.meta.env.BASE_URL}assets/audio/quebrada-royale.mp3`);
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.volume = 0;
  }

  /** Abertura e lobby: começa (ou volta) com fade-in. */
  play(): void {
    this.wanted = true;
    this.fade(1, FADE_IN);
    this.el.play().catch(() => this.waitForGesture());
  }

  /** Partida: fade-out e pausa (guarda a posição). */
  stop(): void {
    this.wanted = false;
    this.fade(0, FADE_OUT);
  }

  /** Volume geral das Configurações (0..1). */
  setVolume(v: number): void {
    this.volume = v;
    this.apply();
  }

  private waitForGesture(): void {
    if (this.waitingGesture) return;
    this.waitingGesture = true;
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const go = () => {
      for (const e of events) window.removeEventListener(e, go, true);
      this.waitingGesture = false;
      if (this.wanted) {
        this.el.play().catch(() => this.waitForGesture());
        this.fade(1, FADE_IN);
      }
    };
    for (const e of events) window.addEventListener(e, go, true);
  }

  private fade(to: number, seconds: number): void {
    this.fadeFrom = this.level;
    this.fadeTo = to;
    this.fadeStart = performance.now();
    this.fadeDur = seconds * 1000;
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  private readonly step = (): void => {
    const t = Math.min(1, (performance.now() - this.fadeStart) / this.fadeDur);
    this.level = this.fadeFrom + (this.fadeTo - this.fadeFrom) * t;
    this.apply();
    if (t < 1) {
      this.raf = requestAnimationFrame(this.step);
      return;
    }
    this.raf = 0;
    if (!this.wanted) this.el.pause();
  };

  private apply(): void {
    this.el.volume = Math.max(0, Math.min(1, this.level * this.volume * MUSIC_GAIN));
  }
}

export const music = new ThemeMusic();
