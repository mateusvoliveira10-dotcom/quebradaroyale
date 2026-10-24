import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { Rng } from '../utils/random';

interface Phase {
  wait: number;
  shrink: number;
  radius: number;
  damage: number;
}

/**
 * Fases: espera → fecha até o raio indicado. Dano por segundo fora da zona. Raios para o
 * mapa de 300 m com 30 participantes (a primeira zona ainda pega boa parte do mapa).
 */
const PHASES: Phase[] = [
  { wait: 90, shrink: 50, radius: 115, damage: 2 },
  { wait: 60, shrink: 40, radius: 70, damage: 3 },
  { wait: 45, shrink: 35, radius: 40, damage: 5 },
  { wait: 35, shrink: 30, radius: 20, damage: 8 },
  { wait: 25, shrink: 25, radius: 8, damage: 12 },
  { wait: 20, shrink: 20, radius: 0, damage: 16 },
];

/**
 * Zona segura que encolhe em fases (a "tempestade" fica do lado de fora).
 * Cada novo círculo fica dentro do anterior; fora dele o jogador toma dano.
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
  private readonly startCenter = new Vector3();
  private startRadius: number;
  private readonly wall: Mesh;
  private readonly wallMat: StandardMaterial;
  private readonly tex: DynamicTexture;

  constructor(
    scene: Scene,
    private readonly rng: Rng,
    private readonly mapHalf: number,
  ) {
    this.radius = mapHalf * 1.5;
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
    this.wall = MeshBuilder.CreateCylinder('zoneWall', { diameter: 2, height: 1, tessellation: 96, cap: 0 }, scene);
    this.wall.material = this.wallMat;
    this.wall.isPickable = false;
    this.wall.setEnabled(false);
  }

  get damagePerSecond(): number {
    return PHASES[Math.min(this.phaseIndex, PHASES.length - 1)].damage;
  }

  get finished(): boolean {
    return this.phaseIndex >= PHASES.length;
  }

  start(): void {
    this.center.set(this.rng.range(-25, 25), 0, this.rng.range(-25, 25));
    this.radius = this.mapHalf * 1.5;
    this.phaseIndex = 0;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.pickNext();
    this.wall.setEnabled(true);
    this.syncWall();
  }

  stop(): void {
    this.wall.setEnabled(false);
  }

  private pickNext(): void {
    const ph = PHASES[Math.min(this.phaseIndex, PHASES.length - 1)];
    this.startCenter.copyFrom(this.center);
    this.startRadius = this.radius;
    this.targetRadius = ph.radius;
    // O novo círculo cabe inteiro dentro do atual.
    const slack = Math.max(0, this.radius - ph.radius) * 0.6;
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(0, slack);
    this.targetCenter.set(this.center.x + Math.cos(a) * d, 0, this.center.z + Math.sin(a) * d);
    const lim = this.mapHalf - 6;
    this.targetCenter.x = Math.max(-lim, Math.min(lim, this.targetCenter.x));
    this.targetCenter.z = Math.max(-lim, Math.min(lim, this.targetCenter.z));
  }

  update(dt: number): void {
    if (this.finished) return;
    this.timer -= dt;
    const ph = PHASES[this.phaseIndex];
    if (this.state === 'shrink') {
      const t = 1 - Math.max(0, this.timer) / ph.shrink;
      this.radius = this.startRadius + (this.targetRadius - this.startRadius) * t;
      Vector3.LerpToRef(this.startCenter, this.targetCenter, t, this.center);
    }
    if (this.timer <= 0) {
      if (this.state === 'wait') {
        this.state = 'shrink';
        this.timer = ph.shrink;
      } else {
        this.phaseIndex++;
        if (!this.finished) {
          this.state = 'wait';
          this.timer = PHASES[this.phaseIndex].wait;
          this.pickNext();
        }
      }
    }
    this.syncWall();
  }

  private syncWall(): void {
    const r = Math.max(0.5, this.radius);
    this.wall.position.set(this.center.x, 60, this.center.z);
    this.wall.scaling.set(r, 160, r);
    this.tex.uScale = Math.max(4, Math.round(r / 3));
  }

  /** Está dentro da zona (com margem opcional)? */
  isSafe(p: Vector3, margin = 0): boolean {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) <= Math.max(0, this.radius - margin);
  }
}
