import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { WORLD } from '../core/config';
import { Rng } from '../utils/random';
import { waterAt } from '../world/Water';

interface Phase {
  /** Espera (zona parada) e fechamento (s). */
  wait: number;
  shrink: number;
  /** Raio final como fração do raio da ilha. */
  frac: number;
  /** Dano por segundo fora da zona nesta fase. */
  damage: number;
}

/**
 * Fases da tempestade, proporcionais ao tamanho da ilha (WORLD.radius): se o mapa crescer, as
 * zonas crescem junto. Partidas mais longas (≈ 16 min até a zona final) para dar tempo de
 * explorar, juntar equipamento e ter combates com estratégia; o dano sobe a cada fase.
 */
const PHASES: Phase[] = [
  { wait: 150, shrink: 90, frac: 0.62, damage: 1 },
  { wait: 120, shrink: 80, frac: 0.4, damage: 2 },
  { wait: 100, shrink: 65, frac: 0.25, damage: 4 },
  { wait: 80, shrink: 55, frac: 0.15, damage: 6 },
  { wait: 60, shrink: 45, frac: 0.08, damage: 9 },
  { wait: 45, shrink: 35, frac: 0.035, damage: 12 },
  { wait: 30, shrink: 30, frac: 0, damage: 16 },
];

/** Avisos antes de a zona começar a fechar (s). */
const WARN_AT = [30, 10];

export type ZoneEvent =
  | { kind: 'warn'; seconds: number; phase: number }
  | { kind: 'shrinking'; phase: number; seconds: number }
  | { kind: 'settled'; phase: number; next: number | null }
  | { kind: 'final' };

/**
 * Zona segura que encolhe em fases (a tempestade fica do lado de fora). Cada novo círculo fica
 * dentro do anterior e com o centro em terra firme; fora dele o personagem toma dano, que
 * aumenta com a fase e com o tempo seguido na tempestade.
 */
export class SafeZone {
  readonly center = new Vector3();
  radius: number;
  readonly targetCenter = new Vector3();
  targetRadius: number;
  phaseIndex = 0;
  /** 'wait' (parada) ou 'shrink' (fechando). */
  state: 'wait' | 'shrink' = 'wait';
  timer: number;
  /** Avisos e mudanças de fase (HUD e som). */
  onEvent: ((e: ZoneEvent) => void) | null = null;
  private readonly startCenter = new Vector3();
  private startRadius: number;
  private readonly wall: Mesh;
  private readonly wallMat: StandardMaterial;
  private readonly tex: DynamicTexture;
  private warned = new Set<number>();
  /** Raio da ilha no momento da partida (o mapa pode ter crescido). */
  private islandR: number;

  constructor(
    scene: Scene,
    private readonly rng: Rng,
    mapHalf: number,
  ) {
    this.islandR = Math.max(WORLD.radius, mapHalf);
    this.radius = this.islandR * 1.08;
    this.targetRadius = this.radius;
    this.startRadius = this.radius;
    this.timer = PHASES[0].wait;

    this.tex = new DynamicTexture('zoneTex', { width: 64, height: 256 }, scene, false);
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(160,90,255,0)');
    g.addColorStop(0.5, 'rgba(160,90,255,0.35)');
    g.addColorStop(1, 'rgba(120,60,240,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    ctx.strokeStyle = 'rgba(230,200,255,0.35)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 256; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y + 8);
      ctx.stroke();
    }
    this.tex.update();
    this.tex.hasAlpha = true;
    this.tex.wrapU = Texture.WRAP_ADDRESSMODE;
    this.tex.uScale = 40;

    this.wallMat = new StandardMaterial('zoneWall', scene);
    this.wallMat.emissiveTexture = this.tex;
    this.wallMat.opacityTexture = this.tex;
    this.wallMat.diffuseColor = Color3.Black();
    this.wallMat.specularColor = Color3.Black();
    this.wallMat.disableLighting = true;
    this.wallMat.backFaceCulling = false;
    this.wallMat.disableDepthWrite = true;
    this.wallMat.fogEnabled = false;
    this.wall = MeshBuilder.CreateCylinder('zoneWall', { diameter: 2, height: 1, tessellation: 128, cap: 0 }, scene);
    this.wall.material = this.wallMat;
    this.wall.isPickable = false;
    this.wall.setEnabled(false);
  }

  get phaseCount(): number {
    return PHASES.length;
  }

  get damagePerSecond(): number {
    return PHASES[Math.min(this.phaseIndex, PHASES.length - 1)].damage;
  }

  /**
   * Dano de um tique (1 s) para quem está há `secondsOutside` seguidos na tempestade: o da fase,
   * subindo até o dobro em 30 s (ficar na tempestade fica cada vez pior).
   */
  damageFor(secondsOutside: number): number {
    return this.damagePerSecond * (1 + Math.min(1, secondsOutside / 30));
  }

  get finished(): boolean {
    return this.phaseIndex >= PHASES.length;
  }

  /** Quantos metros `p` está para fora da zona (0 = dentro). */
  distanceOutside(p: Vector3): number {
    return Math.max(0, Math.hypot(p.x - this.center.x, p.z - this.center.z) - this.radius);
  }

  start(): void {
    this.islandR = WORLD.radius;
    const c = this.landPoint(0, 0, this.islandR * 0.3);
    this.center.copyFrom(c);
    // A primeira zona cobre a ilha inteira, de qualquer ponto (o centro não é o da ilha).
    this.radius = this.islandR * 1.05 + Math.hypot(c.x, c.z);
    this.phaseIndex = 0;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.warned.clear();
    this.pickNext();
    this.wall.setEnabled(true);
    this.syncWall();
  }

  stop(): void {
    this.wall.setEnabled(false);
  }

  /** Ponto sorteado num raio, preferindo terra firme (centro de zona no mar não tem graça). */
  private landPoint(cx: number, cz: number, r: number): Vector3 {
    let best = new Vector3(cx, 0, cz);
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * r;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      best.set(x, 0, z);
      if (!waterAt(x, z) && Math.hypot(x, z) < this.islandR - 20) return best;
    }
    best = new Vector3(cx, 0, cz);
    return best;
  }

  private pickNext(): void {
    const ph = PHASES[Math.min(this.phaseIndex, PHASES.length - 1)];
    this.startCenter.copyFrom(this.center);
    this.startRadius = this.radius;
    this.targetRadius = ph.frac * this.islandR;
    // O novo círculo cabe inteiro dentro do atual.
    const slack = Math.max(0, this.radius - this.targetRadius) * 0.6;
    this.targetCenter.copyFrom(this.landPoint(this.center.x, this.center.z, slack));
  }

  update(dt: number): void {
    if (this.finished) return;
    this.timer -= dt;
    const ph = PHASES[this.phaseIndex];
    if (this.state === 'wait') {
      for (const w of WARN_AT) {
        if (this.timer <= w && !this.warned.has(w) && ph.wait > w + 5) {
          this.warned.add(w);
          this.onEvent?.({ kind: 'warn', seconds: w, phase: this.phaseIndex });
        }
      }
    }
    if (this.state === 'shrink') {
      const t = 1 - Math.max(0, this.timer) / ph.shrink;
      this.radius = this.startRadius + (this.targetRadius - this.startRadius) * t;
      Vector3.LerpToRef(this.startCenter, this.targetCenter, t, this.center);
    }
    if (this.timer <= 0) {
      if (this.state === 'wait') {
        this.state = 'shrink';
        this.timer = ph.shrink;
        this.onEvent?.({ kind: 'shrinking', phase: this.phaseIndex, seconds: ph.shrink });
      } else {
        this.phaseIndex++;
        this.warned.clear();
        if (!this.finished) {
          this.state = 'wait';
          this.timer = PHASES[this.phaseIndex].wait;
          this.pickNext();
          this.onEvent?.({ kind: 'settled', phase: this.phaseIndex, next: this.timer });
        } else {
          this.onEvent?.({ kind: 'final' });
        }
      }
    }
    this.syncWall();
  }

  private syncWall(): void {
    const r = Math.max(0.5, this.radius);
    this.wall.position.set(this.center.x, 60, this.center.z);
    this.wall.scaling.set(r, 200, r);
    this.tex.uScale = Math.max(4, Math.round(r / 3));
  }

  /** Está dentro da zona (com margem opcional)? */
  isSafe(p: Vector3, margin = 0): boolean {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) <= Math.max(0, this.radius - margin);
  }
}
