import { AbstractMesh, PickingInfo, Ray, Scene, Vector3 } from '@babylonjs/core';
import type { ColliderIndex } from '../nav/ColliderIndex';

type PickResult = PickingInfo | null;
import { WeaponEffects } from '../weapons/Effects';
import { Actor } from './Actor';

/** Algo que reage a tiros e não é um personagem (ex.: alvos de treino). */
export interface Shootable {
  onShot(point: Vector3, damage: number, shooter: Actor | null): { damage: number; crit: boolean };
}

export interface ShotResult {
  point: Vector3;
  damage: number;
  crit: boolean;
  /** O dano bateu primeiro no escudo (número azul, como no Fortnite). */
  shield: boolean;
  /** Acertou um personagem ou alvo (para o marcador de acerto). */
  hitTarget: boolean;
  /** O tiro eliminou o alvo. */
  kill: boolean;
}

/** Parâmetros de dano de um disparo. */
export interface ShotDamage {
  damage: number;
  headMult: number;
  falloff?: { near: number; far: number; minMult: number };
}

export interface KillEvent {
  victim: Actor;
  killer: Actor | null;
  cause: string;
}

/**
 * Regras de combate: registro dos atores, disparo por raycast (com hitbox de
 * cabeça), dano, fogo amigo desligado, proteção de respawn e eliminações.
 */
export class CombatManager {
  readonly actors: Actor[] = [];
  time = 0;
  friendlyFire = false;
  /** Vida/escudo que quem elimina recebe (sifão do Fortnite). 0 = desligado. */
  siphon = 0;
  /** O último applyDamage bateu primeiro no escudo. */
  private lastShieldHit = false;
  /**
   * Colisores do mapa. Com o índice, o tiro testa paredes nas caixas perto do raio e
   * personagens/alvos só nas hitboxes — o picking da cena percorria ~12 mil malhas por
   * projétil, e com 30 participantes atirando isso pesava.
   */
  colliders: ColliderIndex | null = null;
  private readonly shootables: AbstractMesh[] = [];

  /** Alvos de treino (malhas com `metadata.shootable`). */
  addShootable(...meshes: AbstractMesh[]): void {
    this.shootables.push(...meshes);
  }

  onDamage: ((target: Actor, amount: number, source: Actor | null, headshot: boolean, shieldHit: boolean) => void) | null = null;
  onKill: ((e: KillEvent) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    readonly effects: WeaponEffects,
  ) {}

  add(actor: Actor): void {
    if (!this.actors.includes(actor)) this.actors.push(actor);
  }

  clear(keep?: Actor): void {
    this.actors.length = 0;
    if (keep) this.actors.push(keep);
  }

  get alive(): Actor[] {
    return this.actors.filter((a) => a.alive);
  }

  areEnemies(a: Actor, b: Actor): boolean {
    return a !== b && a.team !== b.team;
  }

  /**
   * Aplica dano respeitando equipe e proteção. O escudo absorve primeiro, o resto
   * vai para a vida. Devolve o dano efetivo (escudo + vida).
   */
  applyDamage(target: Actor, amount: number, source: Actor | null, cause: string, headshot = false): number {
    this.lastShieldHit = false;
    if (!target.alive) return 0;
    if (source && source !== target && !this.friendlyFire && source.team === target.team) return 0;
    if (target.isProtected(this.time)) return 0;
    let left = Math.max(0, amount);
    const onShield = Math.min(target.shield, left);
    target.shield -= onShield;
    left -= onShield;
    const onHealth = Math.min(target.health, left);
    target.health -= onHealth;
    const dmg = onShield + onHealth;
    this.lastShieldHit = onShield > 0;
    target.lastDamageAt = this.time;
    this.onDamage?.(target, dmg, source, headshot, this.lastShieldHit);
    if (target.health <= 0) this.kill(target, source, cause);
    return dmg;
  }

  /** Primeiro acerto do raio: parede (índice) ou hitbox/alvo antes dela. */
  private pickIndexed(origin: Vector3, dir: Vector3, range: number, predicate: (m: AbstractMesh) => boolean): PickResult {
    const wall = this.colliders!.raycastHit(origin, dir, range);
    const ray = new Ray(origin, dir, wall ? wall.distance : range);
    const candidates: AbstractMesh[] = [];
    for (const a of this.actors) for (const m of a.hitboxes) if (predicate(m)) candidates.push(m);
    for (const m of this.shootables) if (predicate(m)) candidates.push(m);
    let best: PickingInfo | null = null;
    for (const p of ray.intersectsMeshes(candidates)) if (p.hit && (!best || p.distance < best.distance)) best = p;
    if (best) return best;
    const r = new PickingInfo();
    if (wall) {
      r.hit = true;
      r.distance = wall.distance;
      r.pickedPoint = wall.point;
      r.getNormal = () => wall.normal;
    }
    return r;
  }

  kill(victim: Actor, killer: Actor | null, cause: string): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.shield = 0;
    victim.deaths++;
    victim.ctrl.setDead(true);
    victim.updateHitboxes();
    if (killer && killer !== victim) {
      killer.kills++;
      if (this.siphon > 0 && killer.alive) killer.siphon(this.siphon);
    }
    this.onKill?.({ victim, killer, cause });
  }

  /**
   * Um disparo (um ou mais projéteis). `aim` define a direção a partir da
   * câmera/olho; o traçante sai do cano. Ignora o próprio atirador.
   */
  fire(
    shooter: Actor,
    muzzle: Vector3,
    aim: Ray,
    pellets: number,
    spread: number,
    range: number,
    shot: ShotDamage,
    cause: string,
  ): ShotResult | null {
    const predicate = (m: AbstractMesh) => {
      if (!m.isEnabled()) return false;
      const meta = m.metadata as { actor?: Actor; shootable?: Shootable } | null;
      if (meta?.actor) return meta.actor !== shooter && meta.actor.alive;
      return m.checkCollisions || !!meta?.shootable;
    };
    let result: ShotResult | null = null;
    for (let i = 0; i < pellets; i++) {
      const dir = jitter(aim.direction, spread);
      const hit = this.colliders ? this.pickIndexed(aim.origin, dir, range, predicate) : this.scene.pickWithRay(new Ray(aim.origin, dir, range), predicate);
      let end: Vector3;
      if (hit?.hit && hit.pickedPoint) {
        end = hit.pickedPoint.clone();
        const normal = hit.getNormal(true) ?? dir.negate();
        const meta = hit.pickedMesh?.metadata as { actor?: Actor; head?: boolean; shootable?: Shootable } | null;
        const damage = shot.damage * falloffMult(shot.falloff, hit.distance);
        if (meta?.actor) {
          const head = !!meta.head;
          const wasAlive = meta.actor.alive;
          const dealt = this.applyDamage(meta.actor, damage * (head ? shot.headMult : 1), shooter, cause, head);
          const kill = wasAlive && !meta.actor.alive;
          result = merge(result, { point: end, damage: dealt, crit: head, shield: this.lastShieldHit, hitTarget: true, kill });
          this.effects.impact(end, normal, true);
        } else if (meta?.shootable) {
          const r = meta.shootable.onShot(end, damage, shooter);
          result = merge(result, { point: end, damage: r.damage, crit: r.crit, shield: false, hitTarget: true, kill: false });
          this.effects.impact(end, normal, true);
        } else {
          this.effects.impact(end, normal, false);
        }
      } else {
        end = aim.origin.add(dir.scale(range));
      }
      if (i < 3) this.effects.tracer(muzzle, end);
    }
    return result;
  }
}

function merge(a: ShotResult | null, b: ShotResult): ShotResult {
  if (!a) return { ...b };
  return {
    point: b.crit ? b.point : a.point,
    damage: a.damage + b.damage,
    crit: a.crit || b.crit,
    // Como no Fortnite: a cor segue o que foi atingido primeiro.
    shield: a.shield,
    hitTarget: true,
    kill: a.kill || b.kill,
  };
}

/** Multiplicador de dano pela distância (1 até `near`, cai linear até `minMult` em `far`). */
export function falloffMult(f: ShotDamage['falloff'], dist: number): number {
  if (!f || dist <= f.near) return 1;
  const t = Math.min(1, (dist - f.near) / (f.far - f.near));
  return 1 + (f.minMult - 1) * t;
}

/** Direção aleatória dentro de um cone de abertura `angle`. */
export function jitter(dir: Vector3, angle: number): Vector3 {
  if (angle <= 0) return dir.clone();
  const up = Math.abs(dir.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const right = Vector3.Cross(dir, up).normalize();
  const upv = Vector3.Cross(right, dir).normalize();
  const a = angle * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  const t = Math.tan(a);
  return dir.add(right.scale(t * Math.cos(phi))).add(upv.scale(t * Math.sin(phi))).normalize();
}
