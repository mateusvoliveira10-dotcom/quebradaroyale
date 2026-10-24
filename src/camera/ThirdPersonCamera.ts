import { AbstractMesh, ArcRotateCamera, Ray, Scene, Vector3 } from '@babylonjs/core';
import { CAMERA } from '../core/config';
import { Input } from '../core/Input';
import type { ColliderIndex } from '../nav/ColliderIndex';
import { clamp, damp } from '../utils/random';

export interface FollowOptions {
  /** Altura do foco acima dos pés. */
  height: number;
  aiming: boolean;
  sprinting: boolean;
  /** Distância forçada (ex.: avião, queda livre, lobby). */
  distanceOverride?: number;
  /** Sem deslocamento de ombro (ex.: avião, lobby). */
  centered?: boolean;
  /** FOV ao mirar (ex.: luneta). */
  aimFov?: number;
  /** FOV fixo (ex.: lobby). */
  fovOverride?: number;
  /** Ignora colisão da câmera (ex.: lobby, avião). */
  noCollision?: boolean;
}

/** Ajustes do jogador (Configurações). */
export interface CameraPrefs {
  sensitivity: number;
  invertY: boolean;
  fov: number;
}

/**
 * Câmera em terceira pessoa "por cima do ombro" controlada pelo mouse.
 *
 * Colisão: a posição desejada (ombro + distância) é testada a partir da cabeça
 * do personagem; se houver obstáculo, a câmera é colocada sobre essa mesma
 * linha livre (ombro e distância encolhem juntos). Assim ela nunca entra em
 * paredes de becos estreitos e a rotação continua sempre respondendo ao mouse.
 */
export class ThirdPersonCamera {
  readonly camera: ArcRotateCamera;
  prefs: CameraPrefs = { sensitivity: 1, invertY: false, fov: CAMERA.fov };
  /** Malhas que a câmera deve ignorar (ex.: colisores dos personagens). */
  ignore: (m: AbstractMesh) => boolean = () => false;
  /** Colisores estáticos do mapa (quando há, a colisão da câmera usa o índice). */
  colliders: ColliderIndex | null = null;

  private readonly focus = new Vector3();
  private desiredRadius = CAMERA.distance;
  private safeRatio = 1;
  private shoulder = CAMERA.shoulderOffset;
  private initialized = false;
  private shakeAmount = 0;
  private dip = 0;
  private aimingNow = false;
  /** Coice acumulado ainda não recuperado (rad). */
  private recoilPitch = 0;
  private recoilYaw = 0;
  private sinceKick = 99;
  private radiusNow = CAMERA.distance;
  private radiusInit = false;

  constructor(
    private readonly scene: Scene,
    private readonly input: Input,
  ) {
    this.camera = new ArcRotateCamera('thirdPersonCamera', -Math.PI / 2, 1.25, CAMERA.distance, Vector3.Zero(), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1200;
    this.camera.fov = CAMERA.fov;
    // Sem limites internos do Babylon: os limites são aplicados aqui.
    this.camera.lowerBetaLimit = null;
    this.camera.upperBetaLimit = null;
    this.camera.lowerRadiusLimit = null;
    this.camera.upperRadiusLimit = null;
    scene.activeCamera = this.camera;
  }

  /** Inclinação da mira em radianos (positivo = olhando para cima). */
  get aimPitch(): number {
    return this.camera.beta - Math.PI / 2 + 0.12;
  }

  /** Yaw (rad) para onde a câmera olha no plano do chão. */
  get yaw(): number {
    const f = this.getForward();
    return Math.atan2(f.x, f.z);
  }

  /** Recoloca a câmera atrás de um yaw (ex.: ao renascer). */
  lookAlong(yaw: number, beta = 1.3): void {
    this.camera.alpha = -yaw - Math.PI / 2;
    this.camera.beta = beta;
  }

  /** Teleporte da câmera (troca de modo): sem interpolação. */
  snap(): void {
    this.initialized = false;
    this.radiusInit = false;
  }

  /** Aplica o giro do mouse e o zoom. Chamar antes de mover o jogador. */
  updateRotation(): void {
    const cam = this.camera;
    const sens = CAMERA.sensitivity * this.prefs.sensitivity * (this.aimingNow ? CAMERA.aimSensitivityScale : 1);
    const dy = this.input.mouseDY * (this.prefs.invertY ? -1 : 1);
    cam.alpha -= this.input.mouseDX * sens;
    cam.beta = clamp(cam.beta - dy * sens, CAMERA.minBeta, CAMERA.maxBeta);
    // Mantém alpha num intervalo estável (evita perda de precisão após muitas voltas).
    if (cam.alpha > Math.PI * 4 || cam.alpha < -Math.PI * 4) cam.alpha %= Math.PI * 2;
    if (this.input.wheel !== 0) {
      this.desiredRadius = clamp(this.desiredRadius + this.input.wheel * 0.6, CAMERA.minDistance, CAMERA.maxDistance);
    }
  }

  /** Coice da arma: sobe a mira e treme um pouco. */
  kick(pitch: number, yaw: number, shake: number): void {
    this.camera.beta = clamp(this.camera.beta + pitch, CAMERA.minBeta, CAMERA.maxBeta);
    this.camera.alpha += yaw;
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.sinceKick = 0;
    this.shakeAmount = Math.min(0.25, this.shakeAmount + shake);
  }

  /**
   * Volta da mira depois do coice: passado um instante sem atirar, 70% do coice acumulado
   * volta suavemente (rajada contínua sobe a mira; soltar o gatilho a traz de volta).
   */
  private recoverRecoil(dt: number): void {
    this.sinceKick += dt;
    if (this.sinceKick < 0.08 || (Math.abs(this.recoilPitch) < 1e-4 && Math.abs(this.recoilYaw) < 1e-4)) return;
    const k = damp(7, dt);
    const dp = this.recoilPitch * k;
    const dy = this.recoilYaw * k;
    this.recoilPitch -= dp;
    this.recoilYaw -= dy;
    this.camera.beta = clamp(this.camera.beta - dp * 0.7, CAMERA.minBeta, CAMERA.maxBeta);
    this.camera.alpha -= dy * 0.7;
  }

  /** Afunda a câmera ao aterrissar. */
  landingDip(strength: number): void {
    this.dip = Math.max(this.dip, clamp(strength, 0, 1) * 0.35);
    this.shakeAmount = Math.min(0.3, this.shakeAmount + strength * 0.08);
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(0.4, this.shakeAmount + amount);
  }

  /** Segue um ponto (pés do personagem, avião, lobby) tratando colisão com o cenário. */
  updateFollow(dt: number, feetPosition: Vector3, o: FollowOptions): void {
    this.aimingNow = o.aiming;
    this.recoverRecoil(dt);
    const goal = new Vector3(feetPosition.x, feetPosition.y + o.height - this.dip, feetPosition.z);
    this.dip = Math.max(0, this.dip - dt * 1.4);

    if (!this.initialized) {
      this.focus.copyFrom(goal);
      this.initialized = true;
      this.safeRatio = 1;
    } else {
      // Horizontal firme (a mira não "atrasa" ao correr); vertical mais macio, para degraus,
      // meio-fio e o sobe-e-desce do pulo não sacudirem a câmera.
      const kh = damp(CAMERA.followSharpness * 1.4, dt);
      const kv = damp(CAMERA.followSharpness * 0.6, dt);
      this.focus.x += (goal.x - this.focus.x) * kh;
      this.focus.z += (goal.z - this.focus.z) * kh;
      this.focus.y += (goal.y - this.focus.y) * kv;
      // nunca fica mais de 0,6 m abaixo/acima (queda longa, elevador de escada)
      this.focus.y = clamp(this.focus.y, goal.y - 0.6, goal.y + 0.6);
    }

    const shoulderGoal = o.centered ? 0 : o.aiming ? CAMERA.aimShoulderOffset : CAMERA.shoulderOffset;
    this.shoulder += (shoulderGoal - this.shoulder) * damp(10, dt);
    const radiusTarget = o.distanceOverride ?? (o.aiming ? CAMERA.aimDistance : this.desiredRadius);
    // Distância suavizada: trocas de fase (avião → queda → paraquedas → chão) e a mira
    // aproximam/afastam a câmera em vez de pular.
    if (!this.radiusInit) {
      this.radiusNow = radiusTarget;
      this.radiusInit = true;
    }
    this.radiusNow += (radiusTarget - this.radiusNow) * damp(Math.abs(radiusTarget - this.radiusNow) > 6 ? 2.2 : 12, dt);
    const radiusGoal = this.radiusNow;

    const { alpha, beta } = this.camera;
    const dir = new Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta));
    // Deslocamento total a partir da cabeça: ombro + distância.
    const offset = this.getRight().scale(this.shoulder).addInPlace(dir.scale(radiusGoal));

    let ratio = 1;
    if (!o.noCollision) {
      const len = offset.length();
      const dir = offset.scale(1 / len);
      if (this.colliders) {
        // Índice espacial: o picking da cena percorria as ~12 mil malhas do mapa. Cinco raios
        // (centro e um anel de 20 cm) fazem as vezes de uma esfera: um raio só passava rente a
        // quinas e a câmera "entrava" na parede pela borda da tela.
        const up = new Vector3(0, 1, 0);
        const side = Vector3.Cross(up, dir).normalize();
        const vert = Vector3.Cross(dir, side).normalize();
        let best = Infinity;
        for (const [a, b] of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
          const o = this.focus.add(side.scale(a)).addInPlace(vert.scale(b));
          const d = this.colliders.raycast(o, dir, len + 0.35);
          if (d !== null && d < best) best = d;
        }
        if (best < Infinity) ratio = clamp((best - 0.3) / len, 0.08, 1);
      } else {
        const ray = new Ray(this.focus, dir, len + 0.35);
        const hit = this.scene.pickWithRay(ray, (m) => m.checkCollisions && m.isEnabled() && !this.ignore(m));
        if (hit?.hit) ratio = clamp((hit.distance - 0.35) / len, 0.08, 1);
      }
    }
    // Aproxima rápido (nunca atravessa parede), afasta suave.
    if (ratio < this.safeRatio) this.safeRatio = ratio;
    else this.safeRatio += (ratio - this.safeRatio) * damp(4, dt);

    const target = this.focus.add(this.getRight().scale(this.shoulder * this.safeRatio));

    // Tremor (decai rápido).
    const s = this.shakeAmount;
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
    if (s > 0) target.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));

    // Cópia in-place: o setter de target recalcularia alpha/beta.
    this.camera.target.copyFrom(target);
    this.camera.radius = Math.max(0.35, radiusGoal * this.safeRatio);

    const baseFov = o.fovOverride ?? this.prefs.fov;
    const fovGoal = o.aiming ? (o.aimFov ?? CAMERA.aimFov) : baseFov + (o.sprinting ? CAMERA.sprintFovBoost : 0);
    this.camera.fov += (fovGoal - this.camera.fov) * damp(8, dt);
  }

  /** Raio de mira a partir do centro da tela. */
  getAimRay(length: number): Ray {
    // Calcula a posição a partir de alpha/beta/raio (camera.position só atualiza no render).
    const { alpha, beta, radius } = this.camera;
    const out = new Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta));
    const origin = this.camera.target.add(out.scale(radius));
    return new Ray(origin, out.negate(), length);
  }

  /** Direção "para frente" da câmera projetada no plano do chão. */
  getForward(): Vector3 {
    const a = this.camera.alpha;
    return new Vector3(-Math.cos(a), 0, -Math.sin(a));
  }

  /** Direção "para a direita" da câmera projetada no plano do chão. */
  getRight(): Vector3 {
    const a = this.camera.alpha;
    return new Vector3(-Math.sin(a), 0, Math.cos(a));
  }
}
