import { Ray, Scene, Vector3 } from '@babylonjs/core';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { GameAudio } from '../core/Audio';
import { CAMERA } from '../core/config';
import { Actor } from '../combat/Actor';
import { CombatManager, ShotResult } from '../combat/CombatManager';
import { AMMO, AmmoType, rarityDamage, WeaponDef, WeaponId } from './WeaponDefs';
import { buildWeaponModel, disposeWeaponModel, WeaponModel } from './WeaponModels';

/**
 * Onde a palma esquerda segura cada arma (espaço da arma: origem no punho,
 * +Z cano, +X direita): guarda-mão nas longas, por baixo do punho na pistola.
 */
const SUPPORT_GRIP: Record<WeaponId, Vector3> = {
  pistola: new Vector3(-0.035, -0.035, 0.01),
  smg: new Vector3(-0.035, -0.06, 0.13),
  escopeta: new Vector3(-0.04, 0.0, 0.32),
  fuzil: new Vector3(-0.04, 0.0, 0.28),
  sniper: new Vector3(-0.04, 0.0, 0.22),
};

export interface WeaponInstance {
  def: WeaponDef;
  rarity: number;
  mag: number;
  model: WeaponModel;
}

/** O que o dono da arma quer fazer neste frame (teclado ou IA). */
export interface WeaponIntent {
  firePressed: boolean;
  fireHeld: boolean;
  aimHeld: boolean;
  reload: boolean;
  /** Slot escolhido (0/1) ou null. */
  select: number | null;
  swap: boolean;
}

export function noWeaponIntent(): WeaponIntent {
  return { firePressed: false, fireHeld: false, aimHeld: false, reload: false, select: null, swap: false };
}

/**
 * Inventário de 2 armas + munição por tipo, disparo (via CombatManager),
 * mira, recarga e troca. Usado igualmente pelo jogador e pelos bots; só o
 * jogador tem coice de câmera e marcador de acerto.
 */
export class WeaponSystem {
  readonly slots: Array<WeaponInstance | null> = [null, null];
  active = 0;
  readonly ammo: Record<AmmoType, number> = { leve: 0, media: 0, cartucho: 0, pesada: 0 };
  aiming = false;
  enabled = false;
  /** Munição de reserva infinita (treino / deathmatch). */
  infiniteReserve = false;

  onHit: ((r: ShotResult) => void) | null = null;
  onMessage: ((text: string) => void) | null = null;
  onFire: (() => void) | null = null;

  private cooldown = 0;
  private reloadTimer = -1;
  private bloom = 0;
  /** Segundos desde o último disparo (precisão do primeiro tiro e recuperação do bloom). */
  private sinceShot = 99;
  private swapTimer = 0;
  private modelsVisible = true;

  constructor(
    private readonly scene: Scene,
    readonly owner: Actor,
    private readonly combat: CombatManager,
    private readonly audio: GameAudio,
    /** Só para o jogador: câmera para coice. */
    private readonly cam: ThirdPersonCamera | null,
    /** Posição do ouvinte (câmera), para atenuar o som de tiros distantes. */
    private readonly listener: () => Vector3,
  ) {}

  get current(): WeaponInstance | null {
    return this.slots[this.active];
  }

  get hasWeapon(): boolean {
    return this.slots.some((s) => s !== null);
  }

  get reloadProgress(): number {
    const w = this.current;
    if (!w || this.reloadTimer < 0) return -1;
    return 1 - this.reloadTimer / w.def.reloadTime;
  }

  /**
   * Precisão do primeiro tiro (Fortnite): parado, no chão e mirando, depois de um
   * tempo sem atirar, o próximo tiro vai exatamente no centro da mira.
   */
  get firstShotReady(): boolean {
    const w = this.current;
    if (!w || w.def.firstShot <= 0 || !this.aiming) return false;
    const c = this.owner.ctrl;
    return c.grounded && Math.hypot(c.velocity.x, c.velocity.z) < 0.6 && this.sinceShot >= w.def.firstShot;
  }

  /** Dispersão atual (rad), usada também pela mira dinâmica do HUD. */
  get currentSpread(): number {
    const w = this.current;
    if (!w) return 0;
    if (this.firstShotReady) return 0;
    const c = this.owner.ctrl;
    let s = this.aiming ? w.def.aimSpread : w.def.spread;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    if (speed > 0.5) s *= 1.45;
    if (c.sprinting) s *= 1.3;
    if (!c.grounded) s *= 2.2;
    if (c.crouching) s *= 0.7;
    return s + this.bloom;
  }

  get scoped(): boolean {
    return this.aiming && !!this.current?.def.zoomFov;
  }

  /** FOV desejado ao mirar (luneta do rifle de precisão ou mira normal). */
  get aimFov(): number {
    return this.current?.def.zoomFov ?? CAMERA.aimFov;
  }

  /** Munição total (pente + reserva) da arma atual. */
  get totalAmmo(): number {
    const w = this.current;
    return w ? w.mag + this.ammo[w.def.ammo] : 0;
  }

  /** Coloca uma arma no inventário. Se estiver cheio, troca a atual e devolve a antiga. */
  addWeapon(def: WeaponDef, rarity: number, mag?: number): WeaponInstance | null {
    const model = buildWeaponModel(this.scene, def.id, rarity);
    for (const m of model.meshes) m.receiveShadows = true;
    const inst: WeaponInstance = { def, rarity, mag: mag ?? def.magSize, model };
    let dropped: WeaponInstance | null = null;
    const empty = this.slots.findIndex((s) => s === null);
    if (empty >= 0) {
      this.slots[empty] = inst;
      this.active = empty;
    } else {
      dropped = this.slots[this.active];
      this.slots[this.active] = inst;
    }
    this.reloadTimer = -1;
    this.swapTimer = 0.25;
    this.attachModels();
    if (dropped) dropped.model.root.setEnabled(false);
    return dropped;
  }

  /** Libera o modelo de uma arma largada (o loot cria o próprio modelo). */
  disposeInstance(inst: WeaponInstance): void {
    disposeWeaponModel(inst.model);
  }

  /** Esvazia o inventário. Devolve as armas (o chamador decide se viram loot). */
  clear(): WeaponInstance[] {
    const out: WeaponInstance[] = [];
    this.slots.forEach((s, i) => {
      if (s) {
        out.push(s);
        s.model.root.setEnabled(false);
      }
      this.slots[i] = null;
    });
    for (const k of Object.keys(this.ammo) as AmmoType[]) this.ammo[k] = 0;
    this.active = 0;
    this.reloadTimer = -1;
    this.aiming = false;
    this.bloom = 0;
    const c = this.owner.ctrl;
    c.combat.hold = null;
    c.combat.aiming = false;
    c.combat.reloadT = -1;
    return out;
  }

  addAmmo(type: AmmoType, amount: number): number {
    const before = this.ammo[type];
    this.ammo[type] = Math.min(AMMO[type].max, before + amount);
    return this.ammo[type] - before;
  }

  private select(slot: number): void {
    if (slot === this.active || !this.slots[slot]) return;
    this.active = slot;
    this.reloadTimer = -1;
    this.swapTimer = 0.3;
    this.attachModels();
    if (this.owner.isPlayer) this.audio.ui();
  }

  /** Arma ativa na mão, a outra nas costas. */
  attachModels(): void {
    const model = this.owner.ctrl.model;
    this.slots.forEach((inst, i) => {
      if (!inst) return;
      const root = inst.model.root;
      root.setEnabled(true);
      if (i === this.active) {
        // Origem da arma = punho, presa ao encaixe da mão direita; a esquerda vai ao apoio.
        root.parent = model.weaponMount;
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
        // Modelos com apoio próprio (armas do pacote, cada uma com o carregador num lugar).
        model.setSupportGrip(inst.model.supportGrip ?? SUPPORT_GRIP[inst.def.id]);
      } else {
        root.parent = model.backMount;
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
      }
    });
  }

  /** Mostra/esconde as armas (ex.: dentro do avião). */
  setVisibleAll(v: boolean): void {
    if (v === this.modelsVisible) return;
    this.modelsVisible = v;
    for (const s of this.slots) s?.model.root.setEnabled(v);
  }

  update(dt: number, intent: WeaponIntent, aim: () => Ray): void {
    this.sinceShot += dt;
    // Bloom: se recupera rápido assim que para de atirar.
    if (this.sinceShot > 0.12) this.bloom *= Math.exp(-dt * 6);
    if (this.bloom < 1e-4) this.bloom = 0;
    this.cooldown -= dt;
    this.swapTimer -= dt;

    const c = this.owner.ctrl;
    const canAct = this.enabled && this.owner.alive && c.mode === 'normal';
    let w = this.current;

    if (canAct) {
      if (intent.select !== null) this.select(intent.select);
      if (intent.swap) this.select(1 - this.active);
      w = this.current;
    }
    if (this.infiniteReserve && w) this.ammo[w.def.ammo] = AMMO[w.def.ammo].max;

    this.aiming = canAct && !!w && intent.aimHeld && this.reloadTimer < 0;

    if (w && this.reloadTimer >= 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const need = w.def.magSize - w.mag;
        const take = Math.min(need, this.ammo[w.def.ammo]);
        w.mag += take;
        this.ammo[w.def.ammo] -= take;
        this.reloadTimer = -1;
      }
    }
    if (canAct && w && intent.reload) this.startReload();

    const trigger = w ? (w.def.auto ? intent.fireHeld : intent.firePressed) : false;
    if (canAct && w && trigger && this.cooldown <= 0 && this.reloadTimer < 0 && this.swapTimer <= 0) {
      if (w.mag <= 0) {
        if (intent.firePressed && this.owner.isPlayer) this.audio.empty();
        if (this.ammo[w.def.ammo] > 0) this.startReload();
      } else {
        this.fire(w, aim());
      }
    }

    c.combat.hold = w && c.mode === 'normal' && this.owner.alive ? w.def.hold : null;
    c.combat.aiming = this.aiming;
    c.combat.reloadT = this.reloadProgress;
    // Atirar cancela a corrida por um instante (como no Fortnite).
    c.combat.firing = this.sinceShot < 0.35;
    if (this.aiming || c.combat.firing) c.sprinting = false;
  }

  private startReload(): void {
    const w = this.current;
    if (!w || this.reloadTimer >= 0 || w.mag >= w.def.magSize) return;
    if (this.ammo[w.def.ammo] <= 0) {
      this.onMessage?.(`Sem ${AMMO[w.def.ammo].name.toLowerCase()}!`);
      return;
    }
    this.reloadTimer = w.def.reloadTime;
    if (this.owner.isPlayer) this.audio.reload(w.def.reloadTime);
  }

  private volume(): number {
    const d = Vector3.Distance(this.listener(), this.owner.position);
    return Math.max(0, 1 - d / 120);
  }

  private fire(w: WeaponInstance, aim: Ray): void {
    const def = w.def;
    w.mag--;
    this.cooldown = def.fireInterval;

    const muzzle = w.model.muzzle.getAbsolutePosition().clone();
    const spread = this.currentSpread;
    const shot = { damage: def.damage * rarityDamage(w.rarity), headMult: def.headMult, falloff: def.falloff };
    const result = this.combat.fire(this.owner, muzzle, aim, def.pellets, spread, def.range, shot, def.name);
    this.sinceShot = 0;
    this.bloom = Math.min(def.bloomMax, this.bloom + def.bloomPerShot);
    if (result && result.hitTarget) {
      result.damage = Math.round(result.damage);
      if (this.owner.isPlayer) {
        this.onHit?.(result);
        if (result.damage > 0) this.audio.hitmarker(result.crit);
      }
    }
    this.onFire?.();
    this.owner.ctrl.model.shoot();

    this.combat.effects.muzzleFlash(muzzle, aim.direction, def.pellets > 1 || def.id === 'sniper');
    const vol = this.owner.isPlayer ? 1 : this.volume();
    if (vol > 0.02) this.audio.shot(def.sound, vol);
    if (this.cam) {
      const aimK = this.aiming ? 0.6 : 1;
      this.cam.kick(def.recoilPitch * aimK, (Math.random() - 0.5) * 2 * def.recoilYaw * aimK, def.shake);
    }
  }
}
