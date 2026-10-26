import { Terrain } from '../world/Terrain';
import { AbstractMesh, Mesh, MeshBuilder, Ray, Scene, Vector3 } from '@babylonjs/core';
import { DROP, PLAYER, TRAVERSAL, WORLD } from '../core/config';
import { ColliderIndex } from '../nav/ColliderIndex';
import { clamp, damp, lerpAngle } from '../utils/random';
import { AnimMode, CharacterModel, HoldStyle } from './CharacterModel';
import { findLedge, LedgeInfo, traversalPosition } from './Traversal';

export type CharacterMode = 'plane' | 'freefall' | 'parachute' | 'normal' | 'climb' | 'vault' | 'dead';
export type MoveState =
  | 'parado'
  | 'andando'
  | 'correndo'
  | 'agachado'
  | 'no ar'
  | 'escalando'
  | 'queda livre'
  | 'paraquedas'
  | 'no avião'
  | 'eliminado';

/**
 * Intenção de controle de um frame. O jogador gera isso a partir do teclado e
 * da câmera; os bots, a partir da IA. A física é exatamente a mesma.
 */
export interface ControlInput {
  /** Direção desejada no plano XZ (normalizada) ou zero. */
  move: Vector3;
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  crouchToggle: boolean;
  /** Para onde o corpo olha quando armado/mirando (rad). null = direção do movimento. */
  faceYaw: number | null;
  /** Inclinação da mira (rad, positivo = para cima). */
  aimPitch: number;
  /** 0..1 mergulho na queda livre. */
  dive: number;
}

export function emptyControl(): ControlInput {
  return { move: Vector3.Zero(), sprint: false, jumpPressed: false, jumpHeld: false, crouchToggle: false, faceYaw: null, aimPitch: 0, dive: 0 };
}

/** Estado de combate que influencia movimento e animação. */
export interface CombatPose {
  hold: HoldStyle;
  aiming: boolean;
  reloadT: number;
  /** Atirou há pouco: não dá para correr (sprint) atirando. */
  firing: boolean;
}

/** Limite da ilha: um pouco além da linha da praia (dá para molhar os pés, não para nadar). */
export const MAP_FENCE: Fence = { cx: 0, cz: 0, half: WORLD.extent, r: WORLD.radius + 8 };

/** Cerca invisível: quadrada (half) ou circular (r, quando definido). */
export interface Fence {
  cx: number;
  cz: number;
  half: number;
  r?: number;
}

const PROBE_LIFT = 0.6;
/** Gravidade da queda livre (m/s²). */
const G_AIR = 9.8;
/** Maior desnível que o personagem "acompanha" andando (meio-fio, rampa) sem cair. */
const SNAP_DOWN = 0.32;
const PROBE_OFFSETS: ReadonlyArray<[number, number]> = [
  [0, 0],
  [0.25, 0],
  [-0.25, 0],
  [0, 0.25],
  [0, -0.25],
];

/**
 * Controlador de personagem cinemático compartilhado por jogador e bots:
 * velocidade própria, gravidade, colisão por elipsoide (moveWithCollisions),
 * agachar, escalada/vault, queda livre e paraquedas. Os pés ficam na origem.
 */
export class CharacterController {
  readonly root: Mesh;
  readonly model: CharacterModel;
  readonly velocity = new Vector3();

  mode: CharacterMode = 'normal';
  grounded = false;
  crouching = false;
  sprinting = false;
  state: MoveState = 'parado';
  combat: CombatPose = { hold: null, aiming: false, reloadT: -1, firing: false };
  /** Fator de velocidade (ex.: bots um pouco mais lentos). */
  speedScale = 1;
  /** Tempo restante do deslize (agachar durante o sprint) e direção dele. */
  private slideTimer = 0;
  private readonly slideDir = new Vector3();
  /** Velocidade angular do giro do corpo (rad/s), para a inclinação nas curvas. */
  private turnRate = 0;

  get sliding(): boolean {
    return this.slideTimer > 0;
  }

  /** Para onde o corpo está virado (rad, 0 = +Z). */
  get facingYaw(): number {
    return this.facing;
  }
  /** Área válida do modo atual (centro e meia-largura). Fora dela = posição inválida. */
  bounds = { cx: 0, cz: 0, half: WORLD.extent };
  /**
   * Cerca invisível (lado de dentro do muro da comunidade): o personagem nunca passa dela,
   * nem por cima do muro (a partir de um telhado) nem planando no paraquedas. null = sem cerca
   * (galpão de treino, que tem paredes próprias).
   */
  fence: Fence | null = MAP_FENCE;

  /** Ao tocar o chão vindo do ar (velocidade de queda em m/s). */
  onLand: ((fallSpeed: number) => void) | null = null;
  /** Ao aterrissar da queda livre/paraquedas. */
  onDropLanded: (() => void) | null = null;
  onTraversal: ((kind: 'climb' | 'vault') => void) | null = null;
  /** Recuperação de emergência (posição inválida). Nunca é usada no movimento normal. */
  onRecovered: ((reason: string) => void) | null = null;

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private sinceJump = 99;
  private facing = 0;
  private ledge: LedgeInfo | null = null;
  private traversalTime = 0;
  private ledgeCheckTimer = 0;
  private readonly lastSafe = new Vector3();
  private safeTimer = 0;
  private dive = 0;
  private aimPitch = 0;
  private stuckTimer = 0;

  constructor(
    private readonly scene: Scene,
    readonly name: string,
    private readonly colliders: ColliderIndex | null,
  ) {
    this.root = MeshBuilder.CreateBox(`collider_${name}`, { size: 0.1 }, scene);
    this.root.isVisible = false;
    this.root.isPickable = false;
    this.root.checkCollisions = false;
    this.setColliderHeight(PLAYER.height);
    this.model = new CharacterModel(scene, this.root);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get yaw(): number {
    return this.facing;
  }

  get traversalProgress(): number {
    return this.ledge ? clamp(this.traversalTime / this.ledge.duration, 0, 1) : 0;
  }

  // ------------------------------------------------------------ estados especiais

  enterPlane(): void {
    this.mode = 'plane';
    this.model.root.setEnabled(false);
    this.velocity.setAll(0);
  }

  startFreefall(position: Vector3, velocity: Vector3): void {
    this.mode = 'freefall';
    this.model.root.setEnabled(true);
    this.root.position.copyFrom(position);
    this.velocity.copyFrom(velocity);
    this.grounded = false;
    this.crouching = false;
    this.setColliderHeight(PLAYER.height);
    this.ledge = null;
    // Posição segura passa a ser o centro do mapa até o primeiro pouso desta partida.
    this.lastSafe.set(0, 0.2, -1);
    this.root.computeWorldMatrix(true);
  }

  openParachute(): boolean {
    if (this.mode !== 'freefall') return false;
    this.mode = 'parachute';
    return true;
  }

  /** Coloca o personagem num ponto válido (spawn de modo de jogo). */
  spawnAt(position: Vector3, yaw = 0): void {
    this.mode = 'normal';
    this.model.root.setEnabled(true);
    this.root.position.copyFrom(position);
    this.velocity.setAll(0);
    this.facing = yaw;
    this.grounded = false;
    this.crouching = false;
    this.setColliderHeight(PLAYER.height);
    this.ledge = null;
    this.lastSafe.copyFrom(position);
    this.root.computeWorldMatrix(true);
  }

  setDead(dead: boolean): void {
    if (dead) {
      this.mode = 'dead';
      this.velocity.setAll(0);
      this.ledge = null;
    } else if (this.mode === 'dead') {
      this.mode = 'normal';
    }
  }

  /** Distância até o chão logo abaixo (até 400 m). */
  heightAboveGround(): number {
    if (this.colliders) {
      const p = this.root.position;
      const s = this.colliders.surfaceBelow(p.x, p.z, p.y + 0.2);
      return s ? p.y - s.y : 400;
    }
    const hit = this.scene.pickWithRay(
      new Ray(this.root.position.add(new Vector3(0, 0.2, 0)), new Vector3(0, -1, 0), 400),
      (m) => m.checkCollisions && m !== this.root,
    );
    return hit?.hit ? hit.distance - 0.2 : 400;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, ctrl: ControlInput): void {
    if (this.mode === 'plane') {
      this.state = 'no avião';
      return;
    }
    if (this.mode === 'dead') {
      this.state = 'eliminado';
      this.animate(dt);
      return;
    }
    this.aimPitch = ctrl.aimPitch;
    this.checkValidPosition(dt);

    switch (this.mode) {
      case 'freefall':
      case 'parachute':
        this.updateAirDrop(dt, ctrl);
        break;
      case 'climb':
      case 'vault':
        this.updateTraversal(dt);
        break;
      default:
        this.updateNormal(dt, ctrl);
    }
    this.animate(dt);
  }

  /**
   * Rede de segurança: só age se a posição ficar realmente inválida (abaixo do
   * mundo, fora dos limites ou presa dentro de um colisor). Sempre avisa.
   */
  private checkValidPosition(dt: number): void {
    const p = this.root.position;
    let reason: string | null = null;
    if (p.y < PLAYER.killY) reason = 'caiu abaixo do mundo';
    else if (Math.abs(p.x - this.bounds.cx) > this.bounds.half || Math.abs(p.z - this.bounds.cz) > this.bounds.half) {
      if (this.mode === 'normal') reason = 'saiu dos limites do mapa';
    } else if (this.colliders && this.mode === 'normal') {
      const inside = this.colliders.isInsideSolid(new Vector3(p.x, p.y + 0.9, p.z), -0.05);
      this.stuckTimer = inside ? this.stuckTimer + dt : 0;
      if (this.stuckTimer > 0.4) reason = 'ficou preso dentro de um objeto';
    }
    if (!reason) return;
    console.warn(`[QUEBRADA] Recuperação de posição (${this.name}): ${reason}`, p.asArray(), '→', this.lastSafe.asArray());
    this.stuckTimer = 0;
    this.spawnAt(this.lastSafe.clone(), this.facing);
    this.onRecovered?.(reason);
  }

  private updateNormal(dt: number, ctrl: ControlInput): void {
    const wasGrounded = this.grounded;
    const wish = ctrl.move.clone();
    wish.y = 0;
    const hasInput = wish.lengthSquared() > 0.0001;
    if (hasInput) wish.normalize();
    this.sinceJump += dt;

    // ----- Agachar / deslizar -----
    // Agachar no meio do sprint vira um deslize: arranque e perda de velocidade em ~0,85 s,
    // na direção em que já se corria (o controle só corrige um pouco).
    if (ctrl.crouchToggle) {
      if (this.crouching) {
        this.slideTimer = 0;
        this.tryStand();
      } else {
        // No ar também agacha (cai já agachado, como no Fortnite); o deslize é só no chão.
        const hs = Math.hypot(this.velocity.x, this.velocity.z);
        this.setCrouch(true);
        if (wasGrounded && this.sprinting && hs > PLAYER.walkSpeed) {
          this.slideTimer = PLAYER.slideTime;
          this.slideDir.set(this.velocity.x / hs, 0, this.velocity.z / hs);
        }
      }
    }
    if (this.slideTimer > 0 && (!wasGrounded || !this.crouching)) this.slideTimer = 0;
    const sliding = this.slideTimer > 0;

    // Sprint para só ao mirar (ou deslizando). A arma na mão, qualquer que seja, e o tiro não
    // mudam a velocidade: antes, a arma automática disparando cancelava o sprint e, mirando,
    // o passo caía para 60% — a sensação era de "arma pesada" deixando o personagem lento.
    this.sprinting = ctrl.sprint && hasInput && !this.combat.aiming && !sliding;
    if (this.sprinting && this.crouching) this.tryStand();

    let targetSpeed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.runSpeed : PLAYER.walkSpeed;
    targetSpeed *= this.speedScale;
    let accel = wasGrounded ? (hasInput ? PLAYER.groundAccel : PLAYER.groundDecel) : PLAYER.airAccel;
    if (sliding) {
      this.slideTimer -= dt;
      const k = Math.max(0, this.slideTimer) / PLAYER.slideTime;
      // direção do deslize, levemente puxada pelo controle
      if (hasInput) {
        this.slideDir.addInPlace(wish.scale(dt * 2.5));
        this.slideDir.normalize();
      }
      wish.copyFrom(this.slideDir);
      targetSpeed = PLAYER.crouchSpeed + (PLAYER.slideSpeed - PLAYER.crouchSpeed) * k * k;
      accel = 60;
    }

    const dvx = (hasInput || sliding ? wish.x : 0) * targetSpeed - this.velocity.x;
    const dvz = (hasInput || sliding ? wish.z : 0) * targetSpeed - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDelta = accel * dt;
    const scale = dvLen > maxDelta ? maxDelta / dvLen : 1;
    this.velocity.x += dvx * scale;
    this.velocity.z += dvz * scale;

    // ----- Pulo / escalada -----
    this.coyoteTimer = wasGrounded ? PLAYER.coyoteTime : this.coyoteTimer - dt;
    this.jumpBufferTimer = ctrl.jumpPressed ? PLAYER.jumpBuffer : this.jumpBufferTimer - dt;
    const ledgeDir = hasInput ? wish : this.facingVector();
    // Destino da escalada: corpo livre e do lado de dentro da cerca (nada de subir no muro externo).
    const isFree = this.colliders ? (p: Vector3) => this.colliders!.isBodyFree(p) && this.insideFence(p) : undefined;

    let jumped = false;
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      const ledge = findLedge(this.scene, this.root.position, ledgeDir, TRAVERSAL.maxLedgeGrounded, this.root, isFree, this.colliders);
      if (ledge && (ledge.height > 0.75 || ledge.kind === 'vault')) {
        this.beginTraversal(ledge);
        return;
      }
      if (this.crouching && !this.tryStand()) {
        this.jumpBufferTimer = 0;
      } else {
        this.velocity.y = PLAYER.jumpVelocity;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.sinceJump = 0;
        jumped = true;
      }
    } else if (wasGrounded) {
      this.velocity.y = 0;
    } else {
      const g = PLAYER.gravity * (this.velocity.y < 0 ? PLAYER.fallGravityMultiplier : 1);
      this.velocity.y = Math.max(this.velocity.y - g * dt, -PLAYER.maxFallSpeed);
    }

    // Agarrar borda no ar: só como continuação intencional de um pulo
    // (pulo recente ou Espaço segurado), nunca durante uma queda comum.
    const intentional = this.sinceJump < 0.9 || ctrl.jumpHeld;
    if (!wasGrounded && !jumped && hasInput && intentional && this.velocity.y < 3.5 && this.velocity.y > -7) {
      this.ledgeCheckTimer -= dt;
      if (this.ledgeCheckTimer <= 0) {
        this.ledgeCheckTimer = 0.05;
        const ledge = findLedge(this.scene, this.root.position, wish, TRAVERSAL.maxLedgeAirborne, this.root, isFree, this.colliders);
        if (ledge && ledge.kind === 'climb' && ledge.height > 0.6) {
          this.beginTraversal(ledge);
          return;
        }
      }
    }

    // ----- Movimento com colisão -----
    const fallSpeed = -this.velocity.y;
    const displacement = this.velocity.scale(dt);
    const before = this.root.position.clone();
    this.move(displacement);
    this.applyFence();
    const terrain = Terrain.current;
    if (terrain) {
      const th = terrain.height(this.root.position.x, this.root.position.z);
      if (this.root.position.y < th - 0.02) {
        this.root.position.y = th;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.root.computeWorldMatrix(true);
      }
    }
    const actual = this.root.position.subtract(before);

    if (this.velocity.y > 0 && actual.y < displacement.y * 0.5) this.velocity.y = 0;

    const blockedDown = displacement.y < -0.001 && actual.y > displacement.y * 0.7;
    const groundDist = this.probeGround();
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    if (!jumped && this.velocity.y <= 0) {
      // Grudar no chão ao descer só vale para meio-fio e rampas (até ~0,3 m); de beiradas
      // maiores o personagem cai com a gravidade, sem "sumir" para baixo de uma vez.
      const nearGround = groundDist !== null && (groundDist <= 0.05 || (wasGrounded && groundDist <= SNAP_DOWN));
      this.grounded = nearGround || blockedDown;
      if (this.grounded && wasGrounded && groundDist !== null && groundDist > 0.12 && hSpeed > 0.5) {
        this.move(new Vector3(0, -groundDist, 0));
      }
      if (this.grounded) {
        if (!wasGrounded) this.landed(fallSpeed);
        this.velocity.y = 0;
      }
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      this.safeTimer -= dt;
      if (this.safeTimer <= 0) {
        this.safeTimer = 0.5;
        if (!this.colliders || this.colliders.isBodyFree(this.root.position)) this.lastSafe.copyFrom(this.root.position);
      }
    }

    // ----- Orientação -----
    const prevFacing = this.facing;
    if (ctrl.faceYaw !== null) {
      this.facing = lerpAngle(this.facing, ctrl.faceYaw, damp(22, dt));
    } else if (hasInput && !sliding) {
      this.facing = lerpAngle(this.facing, Math.atan2(wish.x, wish.z), damp(PLAYER.turnSharpness, dt));
    }
    // giro do corpo por segundo (suavizado), para a inclinação nas curvas
    const dYaw = Math.atan2(Math.sin(this.facing - prevFacing), Math.cos(this.facing - prevFacing));
    this.turnRate += (dYaw / Math.max(dt, 1e-4) - this.turnRate) * damp(10, dt);

    this.state = !this.grounded
      ? 'no ar'
      : this.crouching
        ? 'agachado'
        : hSpeed < 0.3
          ? 'parado'
          : this.sprinting
            ? 'correndo'
            : 'andando';
  }

  private insideFence(p: Vector3): boolean {
    const f = this.fence;
    if (f?.r !== undefined) return Math.hypot(p.x - f.cx, p.z - f.cz) <= f.r;
    return !f || (Math.abs(p.x - f.cx) <= f.half && Math.abs(p.z - f.cz) <= f.half);
  }

  /** Cerca invisível: segura o personagem do lado de dentro e zera a velocidade para fora. */
  private applyFence(): void {
    const f = this.fence;
    if (!f) return;
    const p = this.root.position;
    let changed = false;
    const lx = p.x - f.cx;
    const lz = p.z - f.cz;
    if (f.r !== undefined) {
      const d = Math.hypot(lx, lz);
      if (d > f.r) {
        const nx = lx / d;
        const nz = lz / d;
        p.x = f.cx + nx * f.r;
        p.z = f.cz + nz * f.r;
        const vOut = this.velocity.x * nx + this.velocity.z * nz;
        if (vOut > 0) {
          this.velocity.x -= nx * vOut;
          this.velocity.z -= nz * vOut;
        }
        this.root.computeWorldMatrix(true);
      }
      return;
    }
    if (Math.abs(lx) > f.half) {
      p.x = f.cx + Math.sign(lx) * f.half;
      if (this.velocity.x * lx > 0) this.velocity.x = 0;
      changed = true;
    }
    if (Math.abs(lz) > f.half) {
      p.z = f.cz + Math.sign(lz) * f.half;
      if (this.velocity.z * lz > 0) this.velocity.z = 0;
      changed = true;
    }
    if (changed) this.root.computeWorldMatrix(true);
  }

  private landed(fallSpeed: number): void {
    if (fallSpeed > 3) {
      this.model.land(fallSpeed);
      this.onLand?.(fallSpeed);
    }
  }

  private beginTraversal(ledge: LedgeInfo): void {
    if (this.crouching) this.setCrouch(false);
    this.ledge = ledge;
    this.traversalTime = 0;
    this.mode = ledge.kind;
    this.velocity.setAll(0);
    this.jumpBufferTimer = 0;
    this.facing = Math.atan2(ledge.forward.x, ledge.forward.z);
    this.onTraversal?.(ledge.kind);
  }

  private updateTraversal(dt: number): void {
    const l = this.ledge;
    if (!l) {
      this.mode = 'normal';
      return;
    }
    this.traversalTime += dt;
    const t = clamp(this.traversalTime / l.duration, 0, 1);
    traversalPosition(l, t, this.root.position);
    this.applyFence();
    this.root.computeWorldMatrix(true);
    this.state = 'escalando';
    if (t >= 1) {
      this.mode = 'normal';
      this.ledge = null;
      if (l.kind === 'vault') {
        this.velocity.copyFrom(l.forward.scale(4.5));
        this.grounded = false;
      } else {
        this.grounded = true;
        this.velocity.setAll(0);
      }
      this.coyoteTimer = 0;
      this.sinceJump = 99;
    }
  }

  private updateAirDrop(dt: number, ctrl: ControlInput): void {
    const wish = ctrl.move.clone();
    wish.y = 0;
    if (wish.lengthSquared() > 0.0001) wish.normalize();
    const parachute = this.mode === 'parachute';
    this.dive = parachute ? 0 : clamp(ctrl.dive, 0, 1);

    const steer = parachute ? DROP.parachuteSteer : DROP.freefallSteer + this.dive * 6;
    const targetVy = parachute ? -DROP.parachuteFallSpeed : -(DROP.freefallTerminal + (DROP.freefallDiveTerminal - DROP.freefallTerminal) * this.dive);
    // Horizontal: o ar vai tirando a velocidade herdada do avião e o controle assume.
    const hk = damp(parachute ? 1.6 : 0.9, dt);
    const drift = parachute ? this.facingVector().scale(1.5) : Vector3.Zero();
    // Perto da borda do mapa, um "vento" leva de volta para dentro (sem pousar fora do muro).
    const inward = new Vector3();
    const f = this.fence;
    if (f?.r !== undefined) {
      const p = this.root.position;
      const lx = p.x - f.cx;
      const lz = p.z - f.cz;
      const d = Math.hypot(lx, lz) || 1;
      const over = clamp((d - (f.r - 30)) / 24, 0, 1);
      inward.x = -(lx / d) * over * (steer + 4);
      inward.z = -(lz / d) * over * (steer + 4);
    } else if (f) {
      const p = this.root.position;
      for (const axis of ['x', 'z'] as const) {
        const l = p[axis] - (axis === 'x' ? f.cx : f.cz);
        const over = clamp((Math.abs(l) - (f.half - 8)) / 8, 0, 1);
        inward[axis] = -Math.sign(l) * over * (steer + 4);
      }
    }
    this.velocity.x += (wish.x * steer + drift.x + inward.x - this.velocity.x) * hk;
    this.velocity.z += (wish.z * steer + drift.z + inward.z - this.velocity.z) * hk;
    if (parachute) {
      // Paraquedas: a velocidade de queda cai aos poucos (~1,5 s) até a de descida.
      this.velocity.y += (targetVy - this.velocity.y) * damp(1.8, dt);
    } else {
      // Queda livre: gravidade com resistência do ar proporcional ao quadrado da velocidade,
      // que tende à velocidade terminal (mergulhando, a terminal é maior). Saindo do avião
      // o personagem acelera de verdade em vez de já estar a 32 m/s.
      const vy = this.velocity.y;
      const vt = -targetVy;
      const drag = (vy * Math.abs(vy)) / (vt * vt);
      this.velocity.y += -G_AIR * (1 + drag) * dt;
    }

    const fall = -this.velocity.y;
    const displacement = this.velocity.scale(dt);
    const before = this.root.position.clone();
    this.move(displacement);
    this.applyFence();
    const actual = this.root.position.subtract(before);
    const blockedDown = displacement.y < -0.001 && actual.y > displacement.y * 0.6;
    const groundDist = this.probeGround();

    if (blockedDown || (groundDist !== null && groundDist <= 0.08)) {
      // Pouso exatamente onde a queda levou o personagem.
      this.mode = 'normal';
      this.grounded = true;
      this.velocity.set(this.velocity.x * 0.3, 0, this.velocity.z * 0.3);
      this.landed(Math.min(fall, 12));
      this.lastSafe.copyFrom(this.root.position);
      this.onDropLanded?.();
    }

    if (wish.lengthSquared() > 0) {
      this.facing = lerpAngle(this.facing, Math.atan2(wish.x, wish.z), damp(3, dt));
    }
    this.state = parachute ? 'paraquedas' : 'queda livre';
  }

  private animate(dt: number): void {
    this.model.root.rotation.y = this.facing;
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const right = new Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing));
    const localVelX = Vector3.Dot(this.velocity, right);
    const localVelZ = Vector3.Dot(this.velocity, this.facingVector());
    const mode: AnimMode = this.mode;
    this.model.animate(dt, {
      speed: hSpeed,
      runSpeed: PLAYER.runSpeed,
      grounded: this.grounded,
      verticalSpeed: this.velocity.y,
      crouching: this.crouching,
      sprinting: this.sprinting,
      mode,
      traversalT: this.traversalProgress,
      hold: this.combat.hold,
      aiming: this.combat.aiming,
      aimPitch: this.aimPitch,
      reloadT: this.combat.reloadT,
      localVelX,
      localVelZ,
      turnRate: this.mode === 'normal' && this.grounded ? this.turnRate : 0,
      sliding: this.sliding,
      dive: this.dive,
    });
  }

  private facingVector(): Vector3 {
    return new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  // ------------------------------------------------------------------ agachar

  private setColliderHeight(h: number): void {
    this.root.ellipsoid = new Vector3(PLAYER.radius, h / 2, PLAYER.radius);
    this.root.ellipsoidOffset = new Vector3(0, h / 2, 0);
  }

  private setCrouch(on: boolean): void {
    this.crouching = on;
    this.setColliderHeight(on ? PLAYER.crouchHeight : PLAYER.height);
  }

  /** Levanta se houver espaço acima da cabeça. */
  private tryStand(): boolean {
    if (!this.crouching) return true;
    if (this.colliders) {
      const head = this.colliders.raycast(this.root.position.add(new Vector3(0, 0.4, 0)), new Vector3(0, 1, 0), PLAYER.height - 0.35);
      if (head !== null) return false;
      this.setCrouch(false);
      return true;
    }
    const hit = this.scene.pickWithRay(
      new Ray(this.root.position.add(new Vector3(0, 0.4, 0)), new Vector3(0, 1, 0), PLAYER.height - 0.35),
      (m) => m.checkCollisions && m !== this.root,
    );
    if (hit?.hit) return false;
    this.setCrouch(false);
    return true;
  }

  // ---------------------------------------------------------------- colisão

  /**
   * moveWithCollisions parte da posição absoluta em cache, que o Babylon só
   * recalcula uma vez por frame; força o recálculo para movimentos encadeados.
   */
  private move(displacement: Vector3): void {
    this.root.computeWorldMatrix(true);
    if (this.colliders) {
      // Só os colisores perto do trajeto (ver ColliderIndex.meshesAround).
      const p = this.root.position;
      const r = Math.hypot(displacement.x, displacement.z) * 0.5 + PLAYER.radius + 1.5;
      this.root.surroundingMeshes = this.colliders.meshesAround(p.x + displacement.x * 0.5, p.z + displacement.z * 0.5, r);
    }
    this.root.moveWithCollisions(displacement);
    this.root.computeWorldMatrix(true);
  }

  /** Distância dos pés até o chão logo abaixo (pode ser levemente negativa), ou null. */
  private probeGround(): number | null {
    const pos = this.root.position;
    if (this.colliders) {
      // Consulta direta ao índice espacial (bem mais barato que picking na cena inteira).
      let best: number | null = null;
      for (const [ox, oz] of PROBE_OFFSETS) {
        const s = this.colliders.surfaceBelow(pos.x + ox, pos.z + oz, pos.y + PROBE_LIFT);
        if (!s) continue;
        const d = pos.y - s.y;
        if (d > 0.6) continue;
        if (best === null || d < best) best = d;
      }
      return best;
    }
    const down = new Vector3(0, -1, 0);
    const predicate = (m: AbstractMesh) => m.checkCollisions && m !== this.root;
    let best: number | null = null;
    for (const [ox, oz] of PROBE_OFFSETS) {
      const origin = new Vector3(pos.x + ox, pos.y + PROBE_LIFT, pos.z + oz);
      const hit = this.scene.pickWithRay(new Ray(origin, down, PROBE_LIFT + 0.6), predicate);
      if (hit?.hit) {
        const d = hit.distance - PROBE_LIFT;
        if (best === null || d < best) best = d;
      }
    }
    return best;
  }
}
