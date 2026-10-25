import { Color3, DynamicTexture, GlowLayer, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { Actor } from '../combat/Actor';
import { GameAudio } from '../core/Audio';
import { Input } from '../core/Input';
import { Rng } from '../utils/random';
import { AMMO, AmmoType, RARITIES, WeaponDef, WEAPONS } from '../weapons/WeaponDefs';
import { buildWeaponModel, disposeWeaponModel, WeaponModel } from '../weapons/WeaponModels';
import { WeaponInstance, WeaponSystem } from '../weapons/WeaponSystem';
import { LootSpot } from '../world/CommunityMap';

export interface LootItem {
  kind: 'weapon' | 'ammo';
  pos: Vector3;
  root: TransformNode;
  meshes: Mesh[];
  glowMeshes: Mesh[];
  def?: WeaponDef;
  rarity: number;
  mag?: number;
  ammoType?: AmmoType;
  amount: number;
  model?: WeaponModel;
  beam?: Mesh;
  phase: number;
  visible: boolean;
  /** Brilho/anel/feixe ligados (só de perto: de longe a arma não pode "entregar" onde está). */
  glowOn?: boolean;
}

export interface LootPrompt {
  text: string;
  color: string;
}

/** Até essa distância (m) o loot brilha (anel, feixe e glow); mais longe é só o objeto no chão. */
const GLOW_RANGE = 14;

/** Pesos de raridade por nível do ponto de loot. */
const RARITY_WEIGHTS: Record<number, number[]> = {
  0: [50, 35, 13, 2, 0],
  1: [25, 38, 26, 9, 2],
  2: [6, 22, 38, 25, 9],
};

/**
 * Loot espalhado pelo mapa: armas flutuando com anel e feixe de luz na cor da
 * raridade, caixas de munição, coleta com E (jogador) ou pela IA (bots),
 * munição automática e itens largados por quem é eliminado.
 */
export class LootSystem {
  private readonly items: LootItem[] = [];
  private readonly ringMats: StandardMaterial[];
  private readonly beamMats: StandardMaterial[];
  private readonly ammoMats: Record<AmmoType, StandardMaterial>;
  private readonly crateMat: StandardMaterial;
  private nearest: LootItem | null = null;
  private cullTimer = 0;
  private time = 0;

  onPickup: ((text: string, color: string) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
    private readonly audio: GameAudio,
  ) {
    const beamTex = new DynamicTexture('beamTex', { width: 8, height: 128 }, scene, false);
    const ctx = beamTex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
    beamTex.update();
    beamTex.hasAlpha = true;

    const ringTex = new DynamicTexture('ringTex', { width: 128, height: 128 }, scene, false);
    const rctx = ringTex.getContext() as unknown as CanvasRenderingContext2D;
    rctx.clearRect(0, 0, 128, 128);
    const rg = rctx.createRadialGradient(64, 64, 20, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,0.0)');
    rg.addColorStop(0.7, 'rgba(255,255,255,0.75)');
    rg.addColorStop(0.82, 'rgba(255,255,255,0.95)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = rg;
    rctx.fillRect(0, 0, 128, 128);
    ringTex.update();
    ringTex.hasAlpha = true;

    const unlit = (name: string, hex: string, tex: DynamicTexture, alpha: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = Color3.FromHexString(hex);
      m.opacityTexture = tex;
      m.alpha = alpha;
      m.disableLighting = true;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      return m;
    };
    this.ringMats = RARITIES.map((r, i) => unlit(`lootRing_${i}`, r.color, ringTex, 0.9));
    this.beamMats = RARITIES.map((r, i) => unlit(`lootBeam_${i}`, r.color, beamTex, 0.55));

    const solid = (name: string, hex: string, emissive = 0.1) => {
      const m = new StandardMaterial(name, scene);
      const c = Color3.FromHexString(hex);
      m.diffuseColor = c;
      m.specularColor = new Color3(0.3, 0.3, 0.3);
      m.emissiveColor = c.scale(emissive);
      return m;
    };
    this.crateMat = solid('ammoCrate', '#4d5a3a');
    this.ammoMats = {
      leve: solid('ammo_leve', AMMO.leve.color, 0.5),
      media: solid('ammo_media', AMMO.media.color, 0.5),
      cartucho: solid('ammo_cartucho', AMMO.cartucho.color, 0.5),
      pesada: solid('ammo_pesada', AMMO.pesada.color, 0.5),
    };
  }

  /** Remove todo o loot (troca de modo / nova partida). */
  clear(): void {
    for (const it of [...this.items]) this.removeItem(it);
    this.nearest = null;
  }

  /** Sorteia o loot nos pontos do mapa. */
  populate(spots: LootSpot[], seed: number): void {
    const rng = new Rng(seed);
    const weaponIds = Object.values(WEAPONS);
    for (const spot of spots) {
      const weaponChance = spot.tier === 2 ? 0.85 : spot.tier === 1 ? 0.62 : 0.45;
      if (rng.chance(weaponChance)) {
        const rarity = pickWeighted(rng, RARITY_WEIGHTS[spot.tier]);
        const pool = weaponIds.filter((w) => w.minRarity <= rarity);
        const def = pickByWeight(rng, pool);
        this.spawnWeapon(def, rarity, spot.pos.clone());
        const off = new Vector3(rng.range(-0.8, 0.8), 0, rng.range(-0.8, 0.8));
        if (off.length() < 0.5) off.x = 0.6;
        this.spawnAmmo(def.ammo, AMMO[def.ammo].pickup, spot.pos.add(off));
      } else {
        const types: AmmoType[] = ['leve', 'leve', 'media', 'media', 'cartucho', 'pesada'];
        const t = rng.pick(types);
        this.spawnAmmo(t, AMMO[t].pickup, spot.pos.clone());
        if (rng.chance(0.4)) {
          const t2 = rng.pick(types);
          this.spawnAmmo(t2, AMMO[t2].pickup, spot.pos.add(new Vector3(0.6, 0, 0.3)));
        }
      }
    }
  }

  get count(): { weapons: number; ammo: number } {
    let weapons = 0;
    let ammo = 0;
    for (const i of this.items) {
      if (i.kind === 'weapon') weapons++;
      else ammo++;
    }
    return { weapons, ammo };
  }

  /** Posições das armas no chão (para o minimapa). */
  weaponPositions(): Array<{ pos: Vector3; color: string }> {
    return this.items.filter((i) => i.kind === 'weapon').map((i) => ({ pos: i.pos, color: RARITIES[i.rarity].color }));
  }

  /** Arma mais próxima (para a IA). */
  nearestWeapon(from: Vector3, maxDist: number, exclude?: Set<LootItem>): LootItem | null {
    let best: LootItem | null = null;
    let bd = maxDist;
    for (const it of this.items) {
      if (it.kind !== 'weapon' || exclude?.has(it)) continue;
      const d = Vector3.Distance(it.pos, from) + Math.abs(it.pos.y - from.y) * 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  nearestAmmo(from: Vector3, type: AmmoType, maxDist: number): LootItem | null {
    let best: LootItem | null = null;
    let bd = maxDist;
    for (const it of this.items) {
      if (it.kind !== 'ammo' || it.ammoType !== type) continue;
      const d = Vector3.Distance(it.pos, from);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  has(it: LootItem): boolean {
    return this.items.includes(it);
  }

  spawnWeapon(def: WeaponDef, rarity: number, pos: Vector3, mag?: number): void {
    const root = new TransformNode(`loot_${def.id}`, this.scene);
    root.position.copyFrom(pos);
    const model = buildWeaponModel(this.scene, def.id, rarity);
    model.root.parent = root;
    model.root.position.set(0, 0.6, 0);
    model.root.rotation.z = 0.15;
    const ring = MeshBuilder.CreateDisc('lootRing', { radius: 0.75, tessellation: 32 }, this.scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    ring.parent = root;
    ring.material = this.ringMats[rarity];
    ring.isPickable = false;
    const beam = MeshBuilder.CreateCylinder('lootBeam', { diameterTop: 0.05, diameterBottom: 0.35, height: 4.5, tessellation: 10, cap: 0 }, this.scene);
    beam.position.y = 2.25;
    beam.parent = root;
    beam.material = this.beamMats[rarity];
    beam.isPickable = false;
    const glowMeshes = [ring, ...model.accents];
    // Brilho começa desligado: liga quando o jogador chega perto (updatePlayer).
    ring.setEnabled(false);
    beam.setEnabled(false);
    this.items.push({
      kind: 'weapon', pos, root, meshes: [ring, beam, ...model.meshes], glowMeshes, def, rarity, mag, amount: 1,
      model, beam, phase: Math.random() * Math.PI * 2, visible: true,
    });
  }

  spawnAmmo(type: AmmoType, amount: number, pos: Vector3): void {
    const root = new TransformNode(`ammo_${type}`, this.scene);
    root.position.copyFrom(pos);
    const crate = MeshBuilder.CreateBox('ammoCrate', { width: 0.42, height: 0.26, depth: 0.3 }, this.scene);
    crate.position.y = 0.13;
    crate.material = this.crateMat;
    crate.parent = root;
    const band = MeshBuilder.CreateBox('ammoBand', { width: 0.44, height: 0.06, depth: 0.32 }, this.scene);
    band.position.y = 0.17;
    band.material = this.ammoMats[type];
    band.parent = root;
    const lid = MeshBuilder.CreateBox('ammoLid', { width: 0.44, height: 0.03, depth: 0.32 }, this.scene);
    lid.position.y = 0.27;
    lid.material = this.crateMat;
    lid.parent = root;
    root.rotation.y = Math.random() * Math.PI;
    for (const m of [crate, band, lid]) m.isPickable = false;
    this.items.push({ kind: 'ammo', pos, root, meshes: [crate, band, lid], glowMeshes: [band], rarity: 0, ammoType: type, amount, phase: 0, visible: true });
  }

  /** Larga as armas e a munição de quem foi eliminado. */
  dropInventory(pos: Vector3, weapons: WeaponInstance[], ammo: Record<AmmoType, number>): void {
    weapons.forEach((w, i) => {
      const a = (i / Math.max(1, weapons.length)) * Math.PI * 2;
      this.spawnWeapon(w.def, w.rarity, pos.add(new Vector3(Math.cos(a) * 0.9, 0.05, Math.sin(a) * 0.9)), w.mag);
    });
    let k = 0;
    for (const t of Object.keys(ammo) as AmmoType[]) {
      if (ammo[t] <= 0) continue;
      const a = k++ * 1.7 + 0.8;
      this.spawnAmmo(t, ammo[t], pos.add(new Vector3(Math.cos(a) * 0.6, 0.05, Math.sin(a) * 0.6)));
    }
  }

  /** Texto do botão de interação (ou null). */
  promptFor(weapons: WeaponSystem): LootPrompt | null {
    const n = this.nearest;
    if (!n || n.kind !== 'weapon' || !n.def) return null;
    const r = RARITIES[n.rarity];
    const full = weapons.slots.every((s) => s !== null);
    return { text: `${full ? 'Trocar por' : 'Pegar'} ${n.def.name} (${r.name})`, color: r.color };
  }

  /** Animação, desempenho e interação do jogador. */
  updatePlayer(dt: number, input: Input, cam: ThirdPersonCamera, player: Actor, weapons: WeaponSystem): void {
    this.time += dt;
    const p = player.position;
    const canPick = player.alive && player.ctrl.mode === 'normal';

    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.3;
      for (const it of this.items) {
        const d = Vector3.Distance(it.pos, p);
        const vis = d < (it.kind === 'weapon' ? 70 : 45);
        if (vis !== it.visible) {
          it.visible = vis;
          it.root.setEnabled(vis);
        }
        // Como no Fortnite: a cor da raridade (anel, feixe, brilho) só aparece de perto.
        const near = vis && d < GLOW_RANGE;
        if (near !== !!it.glowOn) {
          it.glowOn = near;
          // Sem a camada de glow: ela desenha o halo por cima de tudo (dava para ver o brilho
          // através das paredes). Anel e feixe são escondidos pelas paredes normalmente.
          if (it.kind === 'weapon') {
            it.meshes[0].setEnabled(near);
            it.beam?.setEnabled(near);
          }
        }
      }
    }

    for (const it of this.items) {
      if (!it.visible || it.kind !== 'weapon' || !it.model) continue;
      it.phase += dt;
      it.model.root.rotation.y += dt * 1.4;
      it.model.root.position.y = 0.62 + Math.sin(it.phase * 2.2) * 0.07;
      it.model.root.scaling.setAll(1);
      if (it.beam && it.glowOn) {
        // Some aos poucos na borda do alcance (sem "estalo").
        const d = Vector3.Distance(it.pos, p);
        const fade = Math.min(1, Math.max(0, (GLOW_RANGE - d) / 4));
        it.beam.visibility = (0.75 + Math.sin(it.phase * 3) * 0.25) * fade;
      }
    }

    this.nearest = null;
    if (!canPick) return;
    const fwd = cam.getForward();
    let best = Infinity;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const dx = it.pos.x - p.x;
      const dz = it.pos.z - p.z;
      const dy = Math.abs(it.pos.y - p.y);
      const dist = Math.hypot(dx, dz);
      if (dy > 1.6) continue;
      if (it.kind === 'ammo' && dist < 1.25) {
        this.collectAmmo(it, weapons, true);
        continue;
      }
      if (it.kind === 'weapon' && dist < 2.2) {
        const facing = dist > 0.01 ? (dx * fwd.x + dz * fwd.z) / dist : 1;
        const score = dist - facing * 0.8;
        if (score < best) {
          best = score;
          this.nearest = it;
        }
      }
    }

    if (this.nearest) {
      const s = 1 + Math.sin(this.time * 8) * 0.06;
      this.nearest.model?.root.scaling.setAll(s * 1.15);
      if (input.wasPressed('KeyE')) this.collectWeapon(this.nearest, weapons, player, cam.getForward(), true);
    }
  }

  /**
   * Coleta para bots: munição automática e, se `wanted` estiver ao alcance,
   * a arma. Devolve true se pegou a arma.
   */
  botCollect(bot: Actor, weapons: WeaponSystem, wanted: LootItem | null): boolean {
    const p = bot.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.kind !== 'ammo') continue;
      if (Math.hypot(it.pos.x - p.x, it.pos.z - p.z) < 1.3 && Math.abs(it.pos.y - p.y) < 1.6) this.collectAmmo(it, weapons, false);
    }
    if (wanted && this.items.includes(wanted) && Math.hypot(wanted.pos.x - p.x, wanted.pos.z - p.z) < 1.7 && Math.abs(wanted.pos.y - p.y) < 1.8) {
      this.collectWeapon(wanted, weapons, bot, new Vector3(0, 0, 1), false);
      return true;
    }
    return false;
  }

  private collectAmmo(it: LootItem, weapons: WeaponSystem, isPlayer: boolean): void {
    if (!it.ammoType) return;
    const got = weapons.addAmmo(it.ammoType, it.amount);
    if (got <= 0) return;
    it.amount -= got;
    if (isPlayer) {
      this.audio.pickup(0);
      this.onPickup?.(`+${got} ${AMMO[it.ammoType].name}`, AMMO[it.ammoType].color);
    }
    if (it.amount <= 0) this.removeItem(it);
  }

  private collectWeapon(it: LootItem, weapons: WeaponSystem, owner: Actor, forward: Vector3, isPlayer: boolean): void {
    if (!it.def) return;
    const dropped = weapons.addWeapon(it.def, it.rarity, it.mag);
    if (isPlayer) {
      const r = RARITIES[it.rarity];
      this.audio.pickup(it.rarity);
      this.onPickup?.(`${it.def.name} (${r.name})`, r.color);
    }
    this.removeItem(it);
    if (dropped) {
      const back = owner.position.add(forward.scale(-0.8));
      this.spawnWeapon(dropped.def, dropped.rarity, back, dropped.mag);
      weapons.disposeInstance(dropped);
    }
  }

  private removeItem(it: LootItem): void {
    const idx = this.items.indexOf(it);
    if (idx >= 0) this.items.splice(idx, 1);
    for (const m of it.glowMeshes) this.glow.removeIncludedOnlyMesh(m);
    if (it.model) {
      it.model.root.parent = null;
      disposeWeaponModel(it.model);
    }
    for (const m of it.meshes) if (!m.isDisposed()) m.dispose();
    it.root.dispose();
    if (this.nearest === it) this.nearest = null;
  }
}

function pickWeighted(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.range(0, total);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

function pickByWeight(rng: Rng, defs: WeaponDef[]): WeaponDef {
  const total = defs.reduce((a, d) => a + d.lootWeight, 0);
  let r = rng.range(0, total);
  for (const d of defs) {
    r -= d.lootWeight;
    if (r <= 0) return d;
  }
  return defs[0];
}
