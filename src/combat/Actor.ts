import { Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { CharacterController } from '../player/CharacterController';

export const TEAM_COLORS: Record<number, string> = {
  0: '#3a9cff',
  1: '#ff4b3a',
};

/**
 * Participante de uma partida (jogador ou bot): vida, equipe, placar e as
 * hitboxes usadas pelo sistema de tiro (corpo e cabeça).
 */
export class Actor {
  health = 100;
  readonly maxHealth = 100;
  /** Escudo: absorve o dano antes da vida (estilo Fortnite). */
  shield = 0;
  readonly maxShield = 100;
  alive = true;
  kills = 0;
  deaths = 0;
  /** Invulnerável até este instante (proteção ao renascer). */
  protectedUntil = 0;
  lastDamageAt = -99;
  readonly hitboxes: Mesh[];
  private readonly body: Mesh;
  private readonly headBox: Mesh;

  constructor(
    scene: Scene,
    readonly id: number,
    public name: string,
    public team: number,
    readonly isPlayer: boolean,
    readonly ctrl: CharacterController,
  ) {
    this.body = MeshBuilder.CreateBox(`hitbox_body_${id}`, { width: 0.62, height: 1.36, depth: 0.46 }, scene);
    this.headBox = MeshBuilder.CreateBox(`hitbox_head_${id}`, { width: 0.3, height: 0.32, depth: 0.32 }, scene);
    for (const m of [this.body, this.headBox]) {
      m.parent = ctrl.root;
      m.isVisible = false;
      m.isPickable = true;
      m.checkCollisions = false;
    }
    this.body.metadata = { actor: this, head: false };
    this.headBox.metadata = { actor: this, head: true };
    this.hitboxes = [this.body, this.headBox];
    this.updateHitboxes();
  }

  get position() {
    return this.ctrl.position;
  }

  /** Ajusta as hitboxes à postura (em pé / agachado / caído). */
  updateHitboxes(): void {
    const c = this.ctrl;
    const enabled = this.alive && c.mode !== 'plane';
    for (const m of this.hitboxes) m.setEnabled(enabled);
    if (!enabled) return;
    if (c.crouching) {
      this.body.scaling.y = 0.68;
      this.body.position.y = 0.48;
      this.headBox.position.y = 1.14;
    } else {
      this.body.scaling.y = 1;
      this.body.position.y = 0.7;
      this.headBox.position.y = 1.62;
    }
  }

  /** Cura vida até o máximo e o excedente vira escudo (sifão). */
  siphon(amount: number): void {
    const toHealth = Math.min(amount, this.maxHealth - this.health);
    this.health += toHealth;
    this.shield = Math.min(this.maxShield, this.shield + amount - toHealth);
  }

  isProtected(now: number): boolean {
    return now < this.protectedUntil;
  }

  reset(health = 100, shield = 0): void {
    this.health = health;
    this.shield = shield;
    this.alive = true;
    this.ctrl.setDead(false);
    this.updateHitboxes();
  }
}
