import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { allDoors, Door, nearestDoor } from '../world/Doors';
import { damp } from '../utils/random';

/** Distância (m) para abrir uma porta com E. */
const REACH = 2.1;
/** Bots abrem a porta sozinhos ao chegar perto dela andando. */
const BOT_REACH = 1.3;
/** Tempo (s) de abrir/fechar. */
const SWING_SHARPNESS = 7;

/**
 * Portas que abrem (as que o mapa registrou em world/Doors): E abre e fecha, bots empurram ao
 * passar, o colisor gira junto com a folha e bloqueia movimento e tiros.
 */
export class DoorSystem {
  /** Texto de interação da porta mais perto do jogador (ou null). */
  prompt: string | null = null;
  onSound: ((open: boolean, at: Vector3) => void) | null = null;

  /** Colisores das portas perto de (x, z) — entram na colisão de movimento junto com o cenário. */
  static collidersAround(x: number, z: number, r: number): AbstractMesh[] {
    const out: AbstractMesh[] = [];
    for (const d of allDoors()) {
      const dx = d.center.x - x;
      const dz = d.center.z - z;
      if (dx * dx + dz * dz < (r + d.width) * (r + d.width)) out.push(d.collider);
    }
    return out;
  }

  /** Todas as folhas (para os tiros pararem nelas). */
  static colliders(): AbstractMesh[] {
    return allDoors().map((d) => d.collider);
  }

  update(dt: number, player: { position: Vector3; alive: boolean } | null, usePressed: boolean, blockedByOther: boolean, bots: ReadonlyArray<{ position: Vector3; moving: boolean }>): void {
    this.prompt = null;
    if (player?.alive && !blockedByOther) {
      const d = nearestDoor(player.position.add(new Vector3(0, 1, 0)), REACH);
      if (d) {
        this.prompt = d.target > 0.5 ? '[E] Fechar porta' : '[E] Abrir porta';
        if (usePressed) this.toggle(d, player.position);
      }
    }
    for (const b of bots) {
      if (!b.moving) continue;
      const d = nearestDoor(b.position.add(new Vector3(0, 1, 0)), BOT_REACH);
      if (d && d.target < 0.5) this.toggle(d, b.position);
    }
    const k = damp(SWING_SHARPNESS, dt);
    for (const d of allDoors()) {
      if (Math.abs(d.target - d.open) < 1e-3) continue;
      d.open += (d.target - d.open) * k;
      if (Math.abs(d.target - d.open) < 1e-3) d.open = d.target;
      d.pivot.rotation.y = d.openAngle * d.open;
      d.pivot.computeWorldMatrix(true);
      d.collider.computeWorldMatrix(true);
    }
  }

  /**
   * Abre para o lado oposto de quem empurra (se a porta permitir os dois lados, `openAngle`
   * ganha o sinal certo); fecha de volta.
   */
  private toggle(d: Door, from: Vector3): void {
    if (d.target > 0.5) {
      d.target = 0;
      this.onSound?.(false, d.center);
      return;
    }
    d.target = 1;
    this.onSound?.(true, d.center);
    void from;
  }
}
