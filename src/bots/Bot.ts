import { Ray, Vector3 } from '@babylonjs/core';
import { Actor } from '../combat/Actor';
import { CombatManager } from '../combat/CombatManager';
import { LootItem, LootSystem } from '../loot/LootSystem';
import { SafeZone } from '../match/SafeZone';
import { ColliderIndex } from '../nav/ColliderIndex';
import { NavGrid } from '../nav/NavGrid';
import { emptyControl, ControlInput } from '../player/CharacterController';
import { clamp, Rng } from '../utils/random';
import { noWeaponIntent, WeaponIntent, WeaponSystem } from '../weapons/WeaponSystem';

export interface BotContext {
  combat: CombatManager;
  nav: NavGrid;
  colliders: ColliderIndex;
  loot: LootSystem | null;
  zone: SafeZone | null;
  mode: 'br' | 'dm';
  time: number;
  rng: Rng;
}

type Goal = 'loot' | 'ammo' | 'roam' | 'zone' | 'hunt' | 'cover' | 'none';

/** Distância preferida de combate por arma. */
const PREFERRED: Record<string, number> = { pistola: 12, smg: 10, escopeta: 6, fuzil: 20, sniper: 38 };

/**
 * IA de bot. Gera um ControlInput (mesma física do jogador) e um WeaponIntent
 * (mesmo sistema de armas). Percepção por linha de visão com tempo de reação,
 * caminhos A* na NavGrid, busca de armas/munição (Battle Royale), caça a
 * inimigos (Deathmatch), combate com strafe/distância, cobertura com pouca
 * vida, fuga da zona e recuperação quando fica preso.
 */
export class Bot {
  readonly control: ControlInput = emptyControl();
  readonly intent: WeaponIntent = noWeaponIntent();
  /** Alvo de pouso escolhido no avião (Battle Royale). */
  dropTarget: Vector3 | null = null;
  /** Altura em que abre o paraquedas. */
  chuteHeight = 45;
  /** 0..1: pontaria e reflexo. */
  skill: number;

  private path: Vector3[] = [];
  private pathIdx = 0;
  private goal: Goal = 'none';
  private goalPos: Vector3 | null = null;
  private repathTimer = 0;
  private thinkTimer = 0;
  private perceiveTimer = 0;
  private target: Actor | null = null;
  private targetVisible = false;
  private seenSince = -1;
  private lastSeenPos: Vector3 | null = null;
  private lastSeenAt = -99;
  private wanted: LootItem | null = null;
  private readonly unreachable = new Set<LootItem>();
  private strafeDir = 1;
  private strafeTimer = 0;
  private fireCooldown = 0;
  private readonly aimOffset = new Vector3();
  private aimOffsetTimer = 0;
  private stuckTimer = 0;
  private stuckCount = 0;
  private readonly progressPos = new Vector3();
  private coverUntil = 0;
  private roamSince = 0;
  private lastPathAt = -99;

  constructor(
    readonly actor: Actor,
    readonly weapons: WeaponSystem,
    rng: Rng,
  ) {
    this.skill = rng.range(0.35, 0.7);
  }

  /** Mira deste frame (a partir dos olhos, na direção do alvo com erro). */
  aimRay(): Ray {
    const eye = this.actor.position.add(new Vector3(0, 1.5, 0));
    const t = this.target;
    let point: Vector3;
    if (t) {
      point = t.position.add(new Vector3(0, t.ctrl.crouching ? 0.85 : 1.25, 0)).add(this.aimOffset);
    } else {
      point = eye.add(this.facing().scale(10));
    }
    return new Ray(eye, point.subtract(eye).normalize(), 400);
  }

  private facing(): Vector3 {
    const y = this.actor.ctrl.yaw;
    return new Vector3(Math.sin(y), 0, Math.cos(y));
  }

  resetBrain(): void {
    this.path = [];
    this.goal = 'none';
    this.goalPos = null;
    this.target = null;
    this.targetVisible = false;
    this.lastSeenPos = null;
    this.wanted = null;
    this.unreachable.clear();
    this.coverUntil = 0;
  }

  update(dt: number, ctx: BotContext): void {
    const c = this.control;
    c.move.setAll(0);
    c.sprint = false;
    c.jumpPressed = false;
    c.jumpHeld = false;
    c.crouchToggle = false;
    c.faceYaw = null;
    c.dive = 0;
    const w = this.intent;
    w.firePressed = false;
    w.fireHeld = false;
    w.aimHeld = false;
    w.reload = false;
    w.select = null;
    w.swap = false;

    const a = this.actor;
    if (!a.alive) return;
    const ctrl = a.ctrl;
    if (ctrl.mode === 'freefall' || ctrl.mode === 'parachute') {
      this.steerDrop(ctx);
      return;
    }
    if (ctrl.mode !== 'normal') return;

    this.perceive(dt, ctx);
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.4 + ctx.rng.range(0, 0.2);
      this.think(ctx);
    }

    const engaging = this.target !== null && this.targetVisible && this.weapons.hasWeapon && this.weapons.totalAmmo > 0;
    if (engaging) this.fight(dt, ctx);
    else this.followPath(dt, ctx);

    // Coleta (munição sempre; arma quando chega nela).
    if (ctx.loot) {
      if (ctx.loot.botCollect(a, this.weapons, this.goal === 'loot' ? this.wanted : null)) {
        this.wanted = null;
        this.goal = 'none';
        this.thinkTimer = 0;
      }
    }
    // Recarrega com calma quando não está em combate.
    const cur = this.weapons.current;
    if (cur && !engaging && cur.mag < cur.def.magSize * 0.5) w.reload = true;
    // Troca para a outra arma se a atual secou.
    if (cur && cur.mag === 0 && this.weapons.ammo[cur.def.ammo] === 0 && this.weapons.slots[1 - this.weapons.active]) w.swap = true;
  }

  // ------------------------------------------------------------------ queda

  private steerDrop(ctx: BotContext): void {
    const p = this.actor.position;
    const t = this.dropTarget;
    if (!t) return;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2) this.control.move.set(dx / dist, 0, dz / dist);
    const height = p.y - t.y;
    // Mergulha quando já está em cima do alvo, plana quando ainda está longe.
    this.control.dive = dist < height * 0.6 ? 1 : 0;
    void ctx;
  }

  // ------------------------------------------------------------- percepção

  private perceive(dt: number, ctx: BotContext): void {
    this.perceiveTimer -= dt;
    if (this.perceiveTimer > 0) return;
    this.perceiveTimer = 0.15;
    const me = this.actor;
    const eye = me.position.add(new Vector3(0, 1.5, 0));
    let best: Actor | null = null;
    let bestD = 75;
    for (const other of ctx.combat.actors) {
      if (!other.alive || !ctx.combat.areEnemies(me, other) || other.ctrl.mode === 'plane') continue;
      const d = Vector3.Distance(other.position, me.position);
      if (d > bestD) continue;
      const chest = other.position.add(new Vector3(0, 1.2, 0));
      if (ctx.colliders.segmentBlocked(eye, chest)) continue;
      best = other;
      bestD = d;
    }
    if (best) {
      if (this.target !== best || !this.targetVisible) this.seenSince = ctx.time;
      this.target = best;
      this.targetVisible = true;
      this.lastSeenPos = best.position.clone();
      this.lastSeenAt = ctx.time;
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  // ---------------------------------------------------------------- decisão

  private think(ctx: BotContext): void {
    const me = this.actor;
    const p = me.position;
    const armed = this.weapons.hasWeapon && this.weapons.totalAmmo > 0;

    // 1) Zona (Battle Royale).
    if (ctx.zone && !ctx.zone.isSafe(p, 6)) {
      if (this.goal !== 'zone' || !this.goalPos || !ctx.zone.isSafe(this.goalPos, 2)) {
        const c = ctx.zone.targetCenter;
        const dest = ctx.nav.randomNear(new Vector3(c.x, 0, c.z), ctx.zone.targetRadius * 0.55, ctx.rng) ?? ctx.nav.nearestWalkable(new Vector3(c.x, 0, c.z), 30);
        if (dest) this.setGoal('zone', dest, ctx);
      }
      return;
    }

    // 2) Pouca vida no Deathmatch: cobertura.
    if (ctx.mode === 'dm' && me.health < 40 && ctx.time - me.lastDamageAt < 4 && ctx.time > this.coverUntil && this.target) {
      const cover = this.findCover(ctx, this.target);
      if (cover) {
        this.setGoal('cover', cover, ctx);
        this.coverUntil = ctx.time + 5;
        return;
      }
    }
    if (this.goal === 'cover' && ctx.time < this.coverUntil) return;

    // 3) Sem arma (Battle Royale): procurar arma.
    if (!this.weapons.hasWeapon && ctx.loot) {
      if (!this.wanted || !ctx.loot.has(this.wanted)) {
        this.wanted = ctx.loot.nearestWeapon(p, 120, this.unreachable);
      }
      if (this.wanted) {
        if (this.goal !== 'loot' || !this.goalPos || Vector3.Distance(this.goalPos, this.wanted.pos) > 0.5) {
          if (!this.setGoal('loot', this.wanted.pos, ctx)) {
            this.unreachable.add(this.wanted);
            this.wanted = null;
          }
        }
        return;
      }
    }

    // 4) Pouca munição: procurar munição do tipo certo.
    const cur = this.weapons.current;
    if (ctx.loot && cur && this.weapons.totalAmmo < cur.def.magSize && !this.targetVisible) {
      const ammo = ctx.loot.nearestAmmo(p, cur.def.ammo, 60);
      if (ammo) {
        this.setGoal('ammo', ammo.pos, ctx);
        return;
      }
    }

    // 5) Caçar: último lugar onde viu o inimigo, ou (DM) o inimigo mais próximo.
    if (armed && !this.targetVisible) {
      if (this.lastSeenPos && ctx.time - this.lastSeenAt < 6) {
        const stale = !this.goalPos || Vector3.Distance(this.goalPos, this.lastSeenPos) > 6;
        if ((this.goal !== 'hunt' || stale) && ctx.time - this.lastPathAt > 1.5) this.setGoal('hunt', this.lastSeenPos, ctx);
        return;
      }
      const huntAll = ctx.mode === 'dm' || ctx.time - this.roamSince > 50;
      if (huntAll) {
        const enemy = this.closestEnemy(ctx);
        if (enemy && (this.goal !== 'hunt' || ctx.time - this.lastPathAt > 4 || this.pathIdx >= this.path.length)) {
          this.setGoal('hunt', enemy.position, ctx);
        }
        if (enemy) return;
      }
    }

    // 6) Explorar.
    if (this.goal === 'none' || !this.goalPos || this.path.length === 0 || this.pathIdx >= this.path.length) {
      let dest: Vector3 | null = null;
      if (ctx.zone) {
        const c = ctx.zone.targetCenter;
        dest = ctx.nav.randomNear(new Vector3(c.x, 0, c.z), Math.max(8, ctx.zone.targetRadius * 0.7), ctx.rng);
      } else {
        dest = ctx.nav.randomNear(p, 35, ctx.rng, 10);
      }
      if (dest) {
        this.setGoal('roam', dest, ctx);
        if (this.roamSince === 0) this.roamSince = ctx.time;
      }
    }
  }

  private closestEnemy(ctx: BotContext): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const o of ctx.combat.actors) {
      if (!o.alive || !ctx.combat.areEnemies(this.actor, o) || o.ctrl.mode !== 'normal') continue;
      const d = Vector3.Distance(o.position, this.actor.position);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private findCover(ctx: BotContext, enemy: Actor): Vector3 | null {
    const enemyEye = enemy.position.add(new Vector3(0, 1.5, 0));
    for (let i = 0; i < 14; i++) {
      const cand = ctx.nav.randomNear(this.actor.position, 11, ctx.rng, 2.5);
      if (!cand) continue;
      if (ctx.colliders.segmentBlocked(enemyEye, cand.add(new Vector3(0, 1.3, 0)))) return cand;
    }
    return null;
  }

  private setGoal(goal: Goal, pos: Vector3, ctx: BotContext): boolean {
    // Orçamento global de buscas: se esgotou, tenta de novo no próximo pensamento.
    if (!ctx.nav.tryBudget()) {
      this.thinkTimer = 0.1;
      return true;
    }
    this.lastPathAt = ctx.time;
    const path = ctx.nav.findPath(this.actor.position, pos);
    this.goal = goal;
    this.goalPos = pos.clone();
    if (!path) {
      this.path = [];
      // Sem caminho: espera antes de tentar de novo (cada busca que falha percorre
      // milhares de células; com 29 bots, repetir a cada pensamento travava o jogo).
      this.thinkTimer = Math.max(this.thinkTimer, ctx.rng.range(1, 2));
      return false;
    }
    this.path = path;
    this.pathIdx = 0;
    this.progressPos.copyFrom(this.actor.position);
    this.stuckTimer = 0;
    return true;
  }

  // ---------------------------------------------------------------- movimento

  private followPath(dt: number, ctx: BotContext): void {
    const p = this.actor.position;
    this.repathTimer -= dt;
    if (this.pathIdx >= this.path.length) {
      if (this.goal === 'hunt' || this.goal === 'roam' || this.goal === 'ammo') this.goal = 'none';
      return;
    }
    const wp = this.path[this.pathIdx];
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const dist = Math.hypot(dx, dz);
    const last = this.pathIdx === this.path.length - 1;
    if (dist < (last ? 0.7 : 0.55)) {
      this.pathIdx++;
      return;
    }
    this.control.move.set(dx / dist, 0, dz / dist);
    const remaining = this.path.length - this.pathIdx;
    this.control.sprint = (remaining > 2 || dist > 8) && this.goal !== 'cover' ? true : this.goal === 'zone';
    // Degrau/beirada mais alto à frente: pula (a escalada cuida do resto).
    if (wp.y > p.y + 0.5 && dist < 1.6) {
      this.control.jumpPressed = true;
      this.control.jumpHeld = true;
    }
    this.checkStuck(dt, ctx);
  }

  private checkStuck(dt: number, ctx: BotContext): void {
    this.stuckTimer += dt;
    if (this.stuckTimer < 1.1) return;
    const moved = Vector3.Distance(this.progressPos, this.actor.position);
    this.progressPos.copyFrom(this.actor.position);
    this.stuckTimer = 0;
    if (moved > 0.6) {
      this.stuckCount = 0;
      return;
    }
    this.stuckCount++;
    this.control.jumpPressed = true;
    this.control.jumpHeld = true;
    if (this.stuckCount >= 2) {
      // Contorna: vai para um ponto próximo e depois retoma.
      this.stuckCount = 0;
      const detour = ctx.nav.randomNear(this.actor.position, 5, ctx.rng, 1.5);
      if (detour) this.path.splice(this.pathIdx, 0, detour);
      if (this.goal === 'loot' && this.wanted) {
        this.unreachable.add(this.wanted);
        this.wanted = null;
        this.goal = 'none';
      }
    }
  }

  // ------------------------------------------------------------------ combate

  private fight(dt: number, ctx: BotContext): void {
    const t = this.target!;
    const me = this.actor;
    const p = me.position;
    const toT = t.position.subtract(p);
    const dist = Math.hypot(toT.x, toT.z);
    const dir = new Vector3(toT.x / Math.max(dist, 0.01), 0, toT.z / Math.max(dist, 0.01));
    const cur = this.weapons.current;
    const pref = cur ? PREFERRED[cur.def.id] ?? 14 : 14;

    // Encara o alvo e mira.
    this.control.faceYaw = Math.atan2(dir.x, dir.z);
    const dy = t.position.y + 1.2 - (p.y + 1.5);
    this.control.aimPitch = Math.atan2(dy, dist);
    this.intent.aimHeld = dist > 14 || cur?.def.id === 'sniper';

    // Strafe + manter distância.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = ctx.rng.range(0.6, 1.6);
      this.strafeDir = ctx.rng.chance(0.5) ? 1 : -1;
    }
    const side = new Vector3(dir.z, 0, -dir.x).scale(this.strafeDir);
    let fwd = 0;
    if (dist > pref + 5) fwd = 1;
    else if (dist < pref - 4) fwd = -0.8;
    const move = side.scale(0.8).add(dir.scale(fwd));
    if (move.lengthSquared() > 0.01) this.control.move.copyFrom(move.normalize());

    // Erro de mira: menor com o tempo de rastreio e a habilidade.
    this.aimOffsetTimer -= dt;
    const tracking = clamp((ctx.time - this.seenSince) / 2.2, 0, 1);
    if (this.aimOffsetTimer <= 0) {
      this.aimOffsetTimer = 0.25;
      const speed = Math.hypot(t.ctrl.velocity.x, t.ctrl.velocity.z);
      const err = (0.25 + dist * 0.028 + speed * 0.07) * (1.25 - this.skill) * (1.15 - tracking * 0.6);
      this.aimOffset.set(ctx.rng.range(-err, err), ctx.rng.range(-err * 0.6, err * 0.8), ctx.rng.range(-err, err));
    }

    // Tempo de reação antes do primeiro tiro.
    const reaction = 0.75 - this.skill * 0.45;
    if (ctx.time - this.seenSince < reaction || !cur) return;
    if (cur.mag === 0) {
      this.intent.reload = true;
      return;
    }
    if (dist > cur.def.range * 0.95) return;
    this.fireCooldown -= dt;
    if (cur.def.auto) {
      // Rajadas curtas.
      const burst = Math.sin(ctx.time * 3 + this.actor.id) > -0.3;
      this.intent.fireHeld = burst;
    } else if (this.fireCooldown <= 0) {
      this.intent.firePressed = true;
      this.fireCooldown = Math.max(cur.def.fireInterval, 0.28 + ctx.rng.range(0, 0.35) * (1.2 - this.skill));
    }
  }
}
