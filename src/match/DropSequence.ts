import { Axis, Quaternion, Scene, Space, TransformNode, Vector3 } from '@babylonjs/core';
import { Actor } from '../combat/Actor';
import { GameAudio } from '../core/Audio';
import { DROP } from '../core/config';
import { clamp } from '../utils/random';
import { Airplane, buildAirplane, buildParachute, CHUTE_ANCHOR_Y } from './Vehicles';

export type RiderPhase = 'plane' | 'freefall' | 'parachute' | 'landed';

/** Quanto a rampa de carga abre (rad) e de onde se salta (relativo ao centro do avião). */
const RAMP_ANGLE = 0.55;
const RAMP_EXIT = { back: -9.5, y: -2.6 };

interface Rider {
  actor: Actor;
  phase: RiderPhase;
  /** Progresso da rota (0..1) em que um bot salta. */
  jumpAt: number;
  /** Altura (acima do chão) em que um bot abre o paraquedas. */
  openHeight: number;
  chuteAnim: number;
  height: number;
  /** Balanço lateral do paraquedas (rad). */
  sway: number;
}

/**
 * Início do Battle Royale: o avião cruza o mapa numa rota aleatória levando
 * todos os participantes. O jogador salta com Espaço (ou é ejetado no fim da
 * rota); os bots saltam em momentos diferentes. Queda livre → paraquedas →
 * pouso exatamente onde a física levou cada um.
 */
export class DropSequence {
  readonly plane: Airplane;
  private readonly riders: Rider[] = [];
  private readonly chutes = new Map<Actor, TransformNode>();
  private readonly start = new Vector3();
  private readonly dir = new Vector3();
  private travelled = 0;
  private routeLength = 0;
  /** 0 = rampa fechada, 1 = aberta. */
  private rampOpen = 0;
  active = false;

  onRiderPhase: ((actor: Actor, phase: RiderPhase) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly audio: GameAudio,
    private readonly mapHalf: number,
  ) {
    this.plane = buildAirplane(scene);
    this.plane.root.setEnabled(false);
  }

  get planePosition(): Vector3 {
    return this.plane.root.position;
  }

  get planeDirection(): Vector3 {
    return this.dir;
  }

  /** 0..1 do trajeto do avião. */
  get routeProgress(): number {
    return this.routeLength > 0 ? this.travelled / this.routeLength : 0;
  }

  /** O avião está sobre a comunidade? */
  get overMap(): boolean {
    const p = this.plane.root.position;
    return Math.abs(p.x) < this.mapHalf + 8 && Math.abs(p.z) < this.mapHalf + 8;
  }

  phaseOf(actor: Actor): RiderPhase {
    return this.riders.find((r) => r.actor === actor)?.phase ?? 'landed';
  }

  heightOf(actor: Actor): number {
    return this.riders.find((r) => r.actor === actor)?.height ?? 0;
  }

  private chuteFor(actor: Actor): TransformNode {
    let c = this.chutes.get(actor);
    if (!c) {
      c = buildParachute(this.scene);
      c.parent = actor.ctrl.model.root;
      this.chutes.set(actor, c);
    }
    return c;
  }

  /** Começa um novo voo com todos os participantes a bordo. */
  begin(actors: Actor[], botJumpAt: (a: Actor) => number, botOpenHeight: (a: Actor) => number): void {
    const angle = Math.random() * Math.PI * 2;
    this.dir.set(Math.cos(angle), 0, Math.sin(angle));
    const side = new Vector3(-this.dir.z, 0, this.dir.x).scale((Math.random() - 0.5) * this.mapHalf * 0.6);
    this.start.copyFrom(this.dir.scale(-DROP.planeStartDistance)).addInPlace(side);
    this.start.y = DROP.planeAltitude;
    this.routeLength = DROP.planeStartDistance * 2;
    this.travelled = 0;
    this.rampOpen = 0;
    this.plane.root.setEnabled(true);
    this.plane.root.position.copyFrom(this.start);
    this.plane.root.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.riders.length = 0;
    for (const a of actors) {
      a.ctrl.enterPlane();
      a.ctrl.position.copyFrom(this.start);
      this.chuteFor(a).setEnabled(false);
      this.riders.push({ actor: a, phase: 'plane', jumpAt: a.isPlayer ? 2 : botJumpAt(a), openHeight: a.isPlayer ? 0 : botOpenHeight(a), chuteAnim: 0, height: 999, sway: 0 });
    }
    this.active = true;
  }

  /** Encerra (troca de modo): esconde avião e paraquedas. */
  end(): void {
    this.active = false;
    this.plane.root.setEnabled(false);
    for (const c of this.chutes.values()) c.setEnabled(false);
    this.riders.length = 0;
  }

  update(dt: number, playerJump: boolean, playerOpen: boolean): void {
    if (!this.active) return;
    if (this.plane.root.isEnabled()) {
      this.travelled += DROP.planeSpeed * dt;
      const pr = this.plane.root;
      pr.position.copyFrom(this.start).addInPlace(this.dir.scale(this.travelled));
      // Voo suave: sobe e desce bem devagar, com pequenas correções de asa (duas ondas
      // lentas somadas, para não parecer um balanço mecânico) e o nariz acompanhando.
      const d = this.travelled;
      pr.position.y = DROP.planeAltitude + Math.sin(d * 0.018) * 1.6 + Math.sin(d * 0.047 + 1.3) * 0.4;
      pr.rotation.z = Math.sin(d * 0.011) * 0.05 + Math.sin(d * 0.031 + 0.7) * 0.015;
      pr.rotation.x = -Math.cos(d * 0.018) * 0.018;
      for (const p of this.plane.propellers) p.rotate(Axis.Z, dt * 32, Space.LOCAL);
      // Rampa de carga: abre ao chegar sobre o mapa (é por ela que se salta) e fecha depois.
      if (this.plane.ramp) {
        const open = this.overMap && this.riders.some((r) => r.phase === 'plane') ? 1 : 0;
        this.rampOpen += (open - this.rampOpen) * Math.min(1, dt * 1.2);
        this.plane.ramp.rotationQuaternion = Quaternion.RotationAxis(Axis.X, -RAMP_ANGLE * this.rampOpen);
      }
      if (this.travelled > this.routeLength + 60 && this.riders.every((r) => r.phase !== 'plane')) this.plane.root.setEnabled(false);
    }

    const progress = this.routeProgress;
    // Fim da rota: todos saltam AINDA sobre a comunidade (nunca fora do muro).
    const p = this.plane.root.position;
    const edge = this.mapHalf - 14;
    const forced = progress > 0.5 && (Math.abs(p.x) > edge || Math.abs(p.z) > edge);

    for (const r of this.riders) {
      const ctrl = r.actor.ctrl;
      const chute = this.chuteFor(r.actor);
      switch (r.phase) {
        case 'plane': {
          ctrl.position.copyFrom(this.plane.root.position);
          const wants = r.actor.isPlayer ? playerJump : progress >= r.jumpAt;
          if ((wants && this.overMap) || forced) this.jump(r);
          break;
        }
        case 'freefall': {
          this.keepInside(r);
          r.height = ctrl.heightAboveGround();
          const manual = r.actor.isPlayer && playerOpen && r.height < DROP.manualOpenHeight;
          const auto = r.height < (r.actor.isPlayer ? DROP.autoOpenHeight : Math.max(DROP.autoOpenHeight, r.openHeight));
          if ((manual || auto) && ctrl.openParachute()) {
            chute.setEnabled(true);
            chute.rotation.set(0, 0, 0);
            chute.scaling.set(0.12, 0.1, 0.35);
            chute.position.set(0, CHUTE_ANCHOR_Y, 0);
            r.chuteAnim = 0;
            if (r.actor.isPlayer) this.audio.parachute();
            this.setPhase(r, 'parachute');
          }
          if (ctrl.mode === 'normal' || ctrl.mode === 'dead') this.land(r);
          break;
        }
        case 'parachute': {
          this.keepInside(r);
          r.height = ctrl.heightAboveGround();
          // Abertura em duas etapas: o velame sai embolado e se estica para cima (linhas
          // esticando), depois enche de ar e abre na largura — ~1 s no total.
          r.chuteAnim = Math.min(1, r.chuteAnim + dt * 1.1);
          const up = easeOutBack(clamp(r.chuteAnim / 0.45, 0, 1));
          const wide = easeOutBack(clamp((r.chuteAnim - 0.25) / 0.75, 0, 1));
          chute.scaling.set(0.12 + 0.88 * wide, 0.1 + 0.9 * up, 0.35 + 0.65 * wide);
          chute.position.y = CHUTE_ANCHOR_Y;
          // Balança com as curvas e com o vento (o velame fica para fora da curva).
          const right = new Vector3(Math.cos(ctrl.facingYaw), 0, -Math.sin(ctrl.facingYaw));
          const lateral = Vector3.Dot(ctrl.velocity, right);
          r.sway += (clamp(-lateral * 0.05, -0.3, 0.3) - r.sway) * Math.min(1, dt * 2);
          chute.rotation.z = r.sway + Math.sin(this.travelled * 0.05 + r.jumpAt * 9) * 0.03;
          chute.rotation.x = -0.08;
          if (ctrl.mode === 'normal' || ctrl.mode === 'dead') this.land(r);
          break;
        }
        case 'landed': {
          if (chute.isEnabled()) {
            // Pouso: o velame murcha e cai para a frente.
            r.chuteAnim -= dt * 1.6;
            const s = Math.max(0.01, r.chuteAnim);
            chute.scaling.set(s, s * 0.5, s);
            chute.position.y = Math.max(0, chute.position.y - dt * 2.2);
            chute.rotation.x = Math.min(1.2, chute.rotation.x + dt * 1.8);
            if (r.chuteAnim <= 0) chute.setEnabled(false);
          }
          break;
        }
      }
    }
  }

  /** Na descida, o vento empurra de volta para dentro da comunidade. */
  private keepInside(r: Rider): void {
    const c = r.actor.ctrl;
    const lim = this.mapHalf - 4;
    for (const axis of ['x', 'z'] as const) {
      const v = c.position[axis];
      if (Math.abs(v) > lim) {
        c.velocity[axis] = -Math.sign(v) * Math.max(3, Math.abs(c.velocity[axis]));
        c.position[axis] = Math.sign(v) * Math.min(Math.abs(v), this.mapHalf - 1.5);
      }
    }
  }

  /**
   * Salto pela rampa traseira: o personagem sai da ponta da rampa com parte da velocidade
   * do avião (que o ar vai tirando) e começa a cair com a gravidade — nada de surgir já
   * deitado e em velocidade de queda embaixo do avião.
   */
  private jump(r: Rider): void {
    const lateral = new Vector3(-this.dir.z, 0, this.dir.x).scale((Math.random() - 0.5) * 1.6);
    const pos = this.plane.root.position.add(new Vector3(0, RAMP_EXIT.y, 0)).add(this.dir.scale(RAMP_EXIT.back)).add(lateral);
    r.actor.ctrl.startFreefall(pos, this.dir.scale(DROP.planeSpeed * 0.6).add(new Vector3(0, -1.5, 0)));
    r.sway = 0;
    if (r.actor.isPlayer) this.audio.whoosh();
    this.setPhase(r, 'freefall');
  }

  private land(r: Rider): void {
    r.chuteAnim = 1;
    r.height = 0;
    this.setPhase(r, 'landed');
  }

  private setPhase(r: Rider, p: RiderPhase): void {
    r.phase = p;
    this.onRiderPhase?.(r.actor, p);
  }

  /** Volume do motor conforme a distância da câmera. */
  engineVolume(cameraPos: Vector3): number {
    if (!this.plane.root.isEnabled()) return 0;
    const d = Vector3.Distance(cameraPos, this.plane.root.position);
    return clamp(1 - d / 220, 0, 1) * 0.6;
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
