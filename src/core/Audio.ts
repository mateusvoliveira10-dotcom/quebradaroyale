import { SoundKind } from '../weapons/WeaponDefs';

type LoopName = 'plane' | 'wind' | 'chest';

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
  /** Entrada do eco de rua (reverb curto gerado): só os tiros mandam som para ele. */
  private reverb: GainNode | null = null;

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
      // Eco de rua: resposta de ~1,4 s com reflexões nas paredes (ruído com decaimento e
      // alguns "tapas" nos primeiros 120 ms), estéreo.
      const len = Math.floor(ctx.sampleRate * 1.4);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.6;
        for (const ms of [18, 41, 67, 95, 118]) {
          const at = Math.floor((ms + ch * 7) * ctx.sampleRate / 1000);
          for (let k = 0; k < 90; k++) d[at + k] += (Math.random() * 2 - 1) * 0.9 * (1 - k / 90);
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      conv.connect(wet).connect(master);
      const send = ctx.createGain();
      send.connect(conv);
      this.reverb = send;
      this.createLoops();
    } catch {
      this.ctx = null;
    }
  }

  // ------------------------------------------------------------ utilitários

  private noiseBurst(dur: number, vol: number, filterType: BiquadFilterType, freq: number, q = 1, delay = 0, decay = 0.9, send = 0, sweep = 0.25): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol * this.mul), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * decay + 0.01);
    src.connect(f).connect(g).connect(master);
    if (send > 0 && this.reverb) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, endFreq?: number, send = 0): void {
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
    if (send > 0 && this.reverb) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
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

  /**
   * Tiro em camadas: estalo (ruído agudo de poucos ms), corpo (ruído filtrado com o "timbre"
   * da arma), soco grave (seno com queda de afinação), mecânica e o eco de rua (reverb).
   * Pequena variação de afinação a cada disparo para não soar repetido.
   */
  private gunshot(o: {
    crack: number;
    body: [freq: number, q: number, dur: number, vol: number];
    body2?: [freq: number, q: number, dur: number, vol: number];
    thump: [f0: number, f1: number, dur: number, vol: number];
    tail: number;
  }): void {
    const v = 0.9 + Math.random() * 0.2;
    this.noiseBurst(0.035, o.crack, 'highpass', 3200 * v, 0.7, 0, 0.6, o.tail * 0.6, 0.6);
    const [bf, bq, bd, bv] = o.body;
    this.noiseBurst(bd, bv, 'bandpass', bf * v, bq, 0, 0.85, o.tail);
    this.noiseBurst(bd * 0.6, bv * 0.7, 'lowpass', bf * 2.4 * v, 0.6, 0.004, 0.7, o.tail * 0.5);
    if (o.body2) {
      const [f2, q2, d2, v2] = o.body2;
      this.noiseBurst(d2, v2, 'bandpass', f2 * v, q2, 0.01, 0.9, o.tail);
    }
    const [t0, t1, td, tv] = o.thump;
    this.tone(t0 * v, td, tv, 'sine', 0, t1, o.tail * 0.4);
    this.tone(t0 * 1.9 * v, td * 0.5, tv * 0.35, 'triangle', 0, t1 * 1.5);
  }

  /** Clique metálico (mecanismo, ferrolho, pump). */
  private clack(delay: number, vol: number, freq = 2600): void {
    // Tiro distante (bot longe): o mecanismo nem chega a ser ouvido.
    if (this.mul < 0.2) return;
    this.noiseBurst(0.045, vol, 'bandpass', freq, 6, delay, 0.5, 0, 0.8);
    this.tone(freq * 0.55, 0.03, vol * 0.4, 'square', delay + 0.005, freq * 0.4);
  }

  private shotInner(kind: SoundKind): void {
    switch (kind) {
      case 'pistol':
        this.gunshot({ crack: 0.55, body: [1500, 0.9, 0.2, 0.75], thump: [160, 55, 0.13, 0.55], tail: 0.35 });
        this.clack(0.05, 0.12, 3200);
        break;
      case 'smg':
        this.gunshot({ crack: 0.42, body: [1900, 1.0, 0.11, 0.55], thump: [190, 70, 0.07, 0.38], tail: 0.22 });
        this.clack(0.03, 0.06, 3600);
        break;
      case 'shotgun':
        this.gunshot({ crack: 0.75, body: [900, 0.6, 0.5, 0.95], body2: [420, 0.8, 0.4, 0.5], thump: [95, 32, 0.36, 0.95], tail: 0.6 });
        // Pump: vai e volta.
        this.clack(0.42, 0.22, 1800);
        this.clack(0.58, 0.25, 2200);
        break;
      case 'rifle':
        this.gunshot({ crack: 0.62, body: [1150, 0.85, 0.25, 0.8], thump: [125, 45, 0.16, 0.65], tail: 0.45 });
        this.clack(0.04, 0.07, 3000);
        break;
      case 'sniper':
        this.gunshot({ crack: 1.0, body: [800, 0.6, 0.85, 1.0], body2: [300, 0.7, 0.6, 0.5], thump: [72, 26, 0.55, 1.0], tail: 0.9 });
        // Ferrolho: abre e fecha.
        this.clack(0.65, 0.2, 2000);
        this.clack(0.82, 0.24, 2600);
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

  /** Baú abrindo: rangido da tampa e o "brilho" do loot (mais rico no épico). */
  chestOpen(epic: boolean): void {
    // Trinco e madeira rangendo, a tampa abrindo num "whoosh", e o brilho subindo em
    // arpejo com eco até o acorde final (na linha do baú do Fortnite).
    this.noiseBurst(0.05, 0.5, 'highpass', 2600, 1, 0, 0.6);
    this.noiseBurst(0.06, 0.35, 'bandpass', 1400, 3, 0.07, 0.6);
    this.tone(230, 0.32, 0.07, 'sawtooth', 0.1, 150);
    this.noiseBurst(0.42, 0.3, 'bandpass', 2400, 0.8, 0.14, 0.9, 0.3, 0.2);
    this.noiseBurst(0.5, 0.22, 'bandpass', 600, 0.7, 0.18, 0.9, 0.2, 3.5);
    const root = epic ? 587.33 : 523.25;
    const steps = [1, 1.122, 1.26, 1.498, 1.682, 2, 2.245, 2.52];
    steps.forEach((k, i) => this.tone(root * k, 0.3, 0.11, 'triangle', 0.24 + i * 0.045, undefined, 0.5));
    for (const k of [2, 2.52, 3]) this.tone(root * k, 1.1, 0.07, 'sine', 0.62, undefined, 0.7);
    this.noiseBurst(0.9, 0.08, 'highpass', 7000, 0.5, 0.6, 0.9, 0.6, 1);
    if (epic) {
      this.tone(110, 0.6, 0.22, 'sine', 0.2, 70);
      for (const k of [4, 5.04]) this.tone(root * k, 0.9, 0.05, 'sine', 0.8, undefined, 0.8);
    }
  }

  /** Kit médico: velcro abrindo, bandagem e o "plim" de cura. */
  medkit(): void {
    for (let i = 0; i < 5; i++) this.noiseBurst(0.06, 0.28, 'highpass', 1800 + i * 300, 1, i * 0.05, 0.7);
    this.noiseBurst(0.35, 0.15, 'bandpass', 900, 0.8, 0.35, 0.9);
    this.tone(660, 0.25, 0.1, 'sine', 0.8, undefined, 0.4);
    this.tone(990, 0.4, 0.1, 'sine', 0.9, undefined, 0.5);
  }

  /** Goles do energético. */
  drink(): void {
    for (let i = 0; i < 3; i++) this.noiseBurst(0.08, 0.3, 'lowpass', 500, 1, i * 0.22);
    this.tone(520, 0.4, 0.12, 'sine', 0.7, 900);
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

    // Baú por perto: acorde etéreo com tremolo e um brilho agudo cintilando.
    const chestGain = ctx.createGain();
    chestGain.gain.value = 0;
    chestGain.connect(master);
    if (this.reverb) {
      const s = ctx.createGain();
      s.gain.value = 0.6;
      chestGain.connect(s).connect(this.reverb);
    }
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    trem.connect(chestGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.3;
    lfo.connect(lfoAmt).connect(trem.gain);
    lfo.start();
    for (const [f, v] of [[440, 0.05], [554.37, 0.04], [659.25, 0.04], [880, 0.03], [1318.5, 0.015]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = v;
      o.connect(g).connect(trem);
      o.start();
    }
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = noise;
    shimmer.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 7500;
    hp.Q.value = 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.05;
    shimmer.connect(hp).connect(sg).connect(trem);
    shimmer.start();
    this.loops.set('chest', { gain: chestGain, target: 0 });
  }

  setLoop(name: LoopName, volume: number): void {
    const loop = this.loops.get(name);
    if (!loop || !this.ctx) return;
    if (Math.abs(loop.target - volume) < 0.01) return;
    loop.target = volume;
    loop.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.25);
  }
}
