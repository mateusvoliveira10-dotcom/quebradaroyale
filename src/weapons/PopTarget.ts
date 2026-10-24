import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { Actor } from '../combat/Actor';
import { Shootable } from '../combat/CombatManager';
import { targetMaterial } from './Targets';

type State = 'hidden' | 'rising' | 'up' | 'falling';

export interface PopTargetConfig {
  size: number;
  /** Tempo exposto (s) — Infinity = até ser acertado. */
  exposure: number;
  /** Amplitude e velocidade do movimento lateral (0 = parado). */
  moveAmp: number;
  moveSpeed: number;
  points: number;
}

/**
 * Alvo basculante de estande: sobe, fica exposto (parado ou se movendo),
 * tomba para trás ao ser acertado (ou quando o tempo expira) e some.
 * Funciona com o sistema real de tiro (é um Shootable).
 */
export class PopTarget implements Shootable {
  private readonly pivot: TransformNode;
  private readonly board: Mesh;
  private readonly post: Mesh;
  private readonly base: Mesh;
  private state: State = 'hidden';
  private t = 0;
  private exposed = 0;
  private wobble = 0;
  private readonly basePos = new Vector3();
  private cfg: PopTargetConfig = { size: 1, exposure: Infinity, moveAmp: 0, moveSpeed: 0, points: 100 };
  private phase = Math.random() * 6;

  onHit: ((points: number, crit: boolean, point: Vector3) => void) | null = null;
  onExpired: (() => void) | null = null;

  constructor(scene: Scene) {
    const metal = new StandardMaterial('popMetal', scene);
    metal.diffuseColor = Color3.FromHexString('#3a3d42');
    metal.specularColor = new Color3(0.4, 0.4, 0.4);
    this.pivot = new TransformNode('popPivot', scene);
    this.base = MeshBuilder.CreateBox('popBase', { width: 0.6, height: 0.12, depth: 0.4 }, scene);
    this.base.material = metal;
    this.post = MeshBuilder.CreateCylinder('popPost', { diameter: 0.06, height: 1.2, tessellation: 8 }, scene);
    this.post.material = metal;
    this.post.parent = this.pivot;
    this.post.position.y = 0.6;
    this.board = MeshBuilder.CreateCylinder('popBoard', { diameter: 1, height: 0.05, tessellation: 40 }, scene);
    this.board.material = targetMaterial(scene);
    this.board.parent = this.pivot;
    this.board.rotation.x = Math.PI / 2;
    this.board.rotation.y = Math.PI;
    this.board.position.y = 1.45;
    this.board.metadata = { shootable: this };
    this.board.isPickable = true;
    for (const m of [this.base, this.post, this.board]) m.receiveShadows = true;
    this.setVisible(false);
  }

  get meshes(): Mesh[] {
    return [this.base, this.post, this.board];
  }

  get isActive(): boolean {
    return this.state === 'rising' || this.state === 'up';
  }

  get busy(): boolean {
    return this.state !== 'hidden';
  }

  get position(): Vector3 {
    return this.basePos;
  }

  private setVisible(v: boolean): void {
    this.pivot.setEnabled(v);
    this.base.setEnabled(v);
  }

  /** Ergue o alvo num ponto, de frente para +Z. */
  pop(pos: Vector3, cfg: PopTargetConfig): void {
    this.cfg = cfg;
    this.basePos.copyFrom(pos);
    this.base.position.copyFrom(pos).addInPlace(new Vector3(0, 0.06, 0));
    this.pivot.position.copyFrom(pos);
    this.board.scaling.set(cfg.size, 1, cfg.size);
    this.board.position.y = 1.0 + cfg.size * 0.45;
    this.post.scaling.y = (1.0 + cfg.size * 0.45) / 1.45;
    this.post.position.y = this.board.position.y / 2;
    this.state = 'rising';
    this.t = 0;
    this.exposed = 0;
    this.pivot.rotation.x = -Math.PI / 2;
    this.setVisible(true);
  }

  hide(): void {
    this.state = 'hidden';
    this.setVisible(false);
  }

  onShot(point: Vector3, damage: number, shooter: Actor | null): { damage: number; crit: boolean } {
    void damage;
    void shooter;
    if (!this.isActive) return { damage: 0, crit: false };
    const center = this.board.getAbsolutePosition();
    const crit = Vector3.Distance(point, center) < this.cfg.size * 0.14;
    const pts = Math.round(this.cfg.points * (crit ? 1.5 : 1));
    this.state = 'falling';
    this.t = 0;
    this.wobble = 1;
    this.onHit?.(pts, crit, point.clone());
    return { damage: pts, crit };
  }

  update(dt: number): void {
    if (this.state === 'hidden') return;
    this.t += dt;
    this.phase += dt;
    if (this.cfg.moveAmp > 0 && this.state !== 'falling') {
      const x = this.basePos.x + Math.sin(this.phase * this.cfg.moveSpeed) * this.cfg.moveAmp;
      this.pivot.position.x = x;
      this.base.position.x = x;
    }
    switch (this.state) {
      case 'rising': {
        const k = Math.min(1, this.t / 0.22);
        this.pivot.rotation.x = -Math.PI / 2 * (1 - k * k);
        if (k >= 1) {
          this.state = 'up';
          this.t = 0;
        }
        break;
      }
      case 'up':
        this.exposed += dt;
        this.pivot.rotation.x = Math.sin(this.t * 3) * 0.015;
        if (this.exposed >= this.cfg.exposure) {
          this.state = 'falling';
          this.t = 0;
          this.onExpired?.();
        }
        break;
      case 'falling': {
        // Tomba para trás com um quique.
        const k = Math.min(1, this.t / 0.35);
        this.pivot.rotation.x = -(Math.PI / 2) * k * k + Math.sin(this.t * 30) * 0.05 * this.wobble * (1 - k);
        if (this.t > 0.6) this.hide();
        break;
      }
    }
  }
}
