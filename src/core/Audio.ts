import { SoundKind } from '../weapons/WeaponDefs';

type LoopName = 'plane' | 'wind';

interface Loop {
  gain: GainNode;
  target: number;
}

/**
 * Áudio 100% sintetizado com Web Audio (sem arquivos): tiros, recarga, passos,
 * aterrissagem, coleta, marcador de acerto, motor do avião e vento da queda.
 * O contexto só é criado após um gesto do usuário (exigência dos navegadores).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly loops = new Map<LoopName, Loop>();
  /** Multiplicador temporário (sons distantes). */
  private mul = 1;
  private masterVolume = 0.55;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.masterVolume;
      master.connect(comp);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noise = buf;
      this.createLoops();
    } catch {
      this.ctx = null;
    }
  }

  // ------------------------------------------------------------ utilitários

  private noiseBurst(dur: number, vol: number, filterType: BiquadFilterType, freq: number, q = 1, delay = 0, decay = 0.9): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol * this.mul), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * decay + 0.01);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, endFreq?: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * this.mul), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ efeitos

  /** Volume geral (Configurações), 0..1. */
  setMasterVolume(v: number): void {
    this.masterVolume = 0.55 * v;
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  shot(kind: SoundKind, volume = 1): void {
    this.mul = volume;
    this.shotInner(kind);
    this.mul = 1;
  }

  private shotInner(kind: SoundKind): void {
    switch (kind) {
      case 'pistol':
        this.noiseBurst(0.22, 0.9, 'lowpass', 4200, 0.8);
        this.tone(180, 0.12, 0.5, 'triangle', 0, 60);
        break;
      case 'smg':
        this.noiseBurst(0.13, 0.65, 'lowpass', 5200, 0.8);
        this.tone(220, 0.07, 0.35, 'triangle', 0, 80);
        break;
      case 'shotgun':
        this.noiseBurst(0.55, 1.0, 'lowpass', 2600, 0.6);
        this.tone(90, 0.3, 0.8, 'sine', 0, 40);
        this.noiseBurst(0.2, 0.3, 'bandpass', 900, 2, 0.32);
        break;
      case 'rifle':
        this.noiseBurst(0.28, 0.85, 'lowpass', 3800, 0.7);
        this.tone(140, 0.14, 0.55, 'triangle', 0, 50);
        break;
      case 'sniper':
        this.noiseBurst(0.9, 1.0, 'lowpass', 3000, 0.6);
        this.tone(70, 0.5, 0.9, 'sine', 0, 30);
        this.noiseBurst(0.6, 0.25, 'bandpass', 600, 1, 0.15, 1);
        break;
    }
  }

  empty(): void {
    this.tone(1800, 0.03, 0.15, 'square');
  }

  reload(duration: number): void {
    this.noiseBurst(0.06, 0.35, 'bandpass', 2500, 4, 0.05);
    this.tone(900, 0.04, 0.12, 'square', 0.06);
    this.noiseBurst(0.08, 0.4, 'bandpass', 1800, 4, duration * 0.55);
    this.noiseBurst(0.1, 0.45, 'bandpass', 1400, 3, duration * 0.9);
    this.tone(600, 0.05, 0.12, 'square', duration * 0.9);
  }

  pickup(rarity = 0): void {
    const base = 660 + rarity * 60;
    this.tone(base, 0.12, 0.22, 'triangle');
    this.tone(base * 1.5, 0.18, 0.2, 'triangle', 0.07);
    if (rarity >= 3) this.tone(base * 2, 0.25, 0.15, 'sine', 0.15);
  }

  /** Dano recebido. */
  hurt(): void {
    this.noiseBurst(0.12, 0.35, 'lowpass', 700, 1);
    this.tone(160, 0.12, 0.25, 'sawtooth', 0, 90);
  }

  /** Eliminação confirmada. */
  eliminated(): void {
    this.tone(520, 0.12, 0.2, 'triangle');
    this.tone(780, 0.16, 0.2, 'triangle', 0.08);
    this.tone(1040, 0.22, 0.18, 'triangle', 0.16);
  }

  /** Alvo de treino derrubado. */
  targetDown(): void {
    this.tone(1300, 0.06, 0.18, 'square');
    this.noiseBurst(0.18, 0.25, 'bandpass', 900, 2, 0.04);
  }

  hitmarker(crit: boolean): void {
    this.tone(crit ? 1600 : 1200, 0.05, crit ? 0.3 : 0.2, 'square');
  }

  footstep(running: boolean): void {
    this.noiseBurst(0.07, running ? 0.22 : 0.13, 'lowpass', 900, 1);
  }

  land(strength: number): void {
    this.noiseBurst(0.18, 0.25 + strength * 0.4, 'lowpass', 500, 1);
    this.tone(80, 0.15, 0.2 + strength * 0.3, 'sine', 0, 40);
  }

  whoosh(): void {
    this.noiseBurst(0.35, 0.3, 'bandpass', 1200, 1.2, 0, 1);
  }

  parachute(): void {
    this.noiseBurst(0.5, 0.6, 'bandpass', 700, 0.8, 0, 1);
    this.tone(120, 0.3, 0.2, 'sine', 0.05, 70);
  }

  ui(): void {
    this.tone(880, 0.06, 0.12, 'triangle');
  }

  // ------------------------------------------------------------ loops

  private createLoops(): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;

    // Motor do avião: dente de serra grave + ruído filtrado.
    const planeGain = ctx.createGain();
    planeGain.gain.value = 0;
    planeGain.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(planeGain);
    for (const f of [52, 78, 104]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(lp);
      o.start();
    }
    const pn = ctx.createBufferSource();
    pn.buffer = noise;
    pn.loop = true;
    const png = ctx.createGain();
    png.gain.value = 0.25;
    pn.connect(png).connect(lp);
    pn.start();
    this.loops.set('plane', { gain: planeGain, target: 0 });

    // Vento da queda livre.
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windGain.connect(master);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.6;
    bp.connect(windGain);
    const wn = ctx.createBufferSource();
    wn.buffer = noise;
    wn.loop = true;
    wn.connect(bp);
    wn.start();
    this.loops.set('wind', { gain: windGain, target: 0 });
  }

  setLoop(name: LoopName, volume: number): void {
    const loop = this.loops.get(name);
    if (!loop || !this.ctx) return;
    if (Math.abs(loop.target - volume) < 0.01) return;
    loop.target = volume;
    loop.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.25);
  }
}
