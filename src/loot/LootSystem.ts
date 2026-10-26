import { AbstractMesh, Color3, Color4, DynamicTexture, GlowLayer, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { softDot } from '../world/FxTextures';
import { instanceModel, instanceOf } from '../world/ModelInstance';
import { WorldAssets } from '../world/WorldAssets';
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
  /** chest = baú (abre com E); shield = energético (escudo); heal = kit médico (vida). */
  kind: 'weapon' | 'ammo' | 'chest' | 'shield' | 'heal';
  pos: Vector3;
  root: TransformNode;
  meshes: AbstractMesh[];
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
  /** Baú: tampa (gira na dobradiça), épico, já aberto, tempo da abertura, faíscas. */
  lid?: TransformNode;
  epic?: boolean;
  opened?: boolean;
  openT?: number;
  lootOut?: boolean;
  sparkles?: ParticleSystem;
}

export interface LootPrompt {
  text: string;
  color: string;
}

/** Até essa distância (m) o loot brilha (anel, feixe e glow); mais longe é só o objeto no chão. */
const GLOW_RANGE = 14;

/** Raridades do baú comum e do épico (azul). Arma no chão é sempre comum. */
const CHEST_WEIGHTS = [22, 40, 27, 9, 2];
const EPIC_CHEST_WEIGHTS = [0, 6, 36, 44, 14];
/** Escudo que um energético dá (aos poucos, em ENERGY_TIME s). */
const ENERGY_SHIELD = 50;
const ENERGY_TIME = 2.2;
/** Vida que o kit médico recupera (aos poucos, em MEDKIT_TIME s). */
const MEDKIT_HEAL = 100;
const MEDKIT_TIME = 4;

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
  /** Escudo do energético e vida do kit médico entrando aos poucos. */
  private readonly drinks: Array<{ actor: Actor; left: number; stat: 'shield' | 'health'; rate: number }> = [];
  private energyMat: StandardMaterial | null = null;
  private time2 = 0;
  /** Texto de interação atual do jogador (Hud.setPrompt). */
  prompt: LootPrompt | null = null;
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
    this.audio.setLoop('chest', 0);
    this.drinks.length = 0;
    for (const it of [...this.items]) this.removeItem(it);
    this.nearest = null;
  }

  /**
   * Sorteia o loot nos pontos do mapa, como no Fortnite: baús (abrir com E) na maior parte
   * dos pontos, baús épicos azuis raros, poucas armas soltas no chão (só comuns) e munição.
   */
  populate(spots: LootSpot[], seed: number): void {
    const rng = new Rng(seed);
    const weaponIds = Object.values(WEAPONS);
    for (const spot of spots) {
      const chestChance = spot.tier === 2 ? 0.72 : spot.tier === 1 ? 0.5 : 0.3;
      if (rng.chance(chestChance)) {
        const epic = rng.chance(spot.tier === 2 ? 0.12 : spot.tier === 1 ? 0.05 : 0.02);
        this.spawnChest(spot.pos.clone(), rng.range(0, Math.PI * 2), epic);
        continue;
      }
      if (rng.chance(0.22)) {
        // Arma solta no chão: só comum (raras e épicas só saem de baú).
        const pool = weaponIds.filter((w) => w.minRarity <= 0);
        const def = pickByWeight(rng, pool);
        this.spawnWeapon(def, 0, spot.pos.clone());
        const off = new Vector3(rng.range(-0.8, 0.8), 0, rng.range(-0.8, 0.8));
        if (off.length() < 0.5) off.x = 0.6;
        this.spawnAmmo(def.ammo, AMMO[def.ammo].pickup, spot.pos.add(off));
      } else {
        const types: AmmoType[] = ['leve', 'leve', 'media', 'media', 'cartucho', 'pesada'];
        const t = rng.pick(types);
        this.spawnAmmo(t, AMMO[t].pickup, spot.pos.clone());
        // Alguns pontos também têm kit médico ou energético no chão.
        if (rng.chance(0.12)) this.spawnMedkit(spot.pos.add(new Vector3(-0.7, 0, 0.4)));
        else if (rng.chance(0.08)) this.spawnShield(spot.pos.add(new Vector3(-0.7, 0, 0.4)));
        if (rng.chance(0.4)) {
          const t2 = rng.pick(types);
          this.spawnAmmo(t2, AMMO[t2].pickup, spot.pos.add(new Vector3(0.6, 0, 0.3)));
        }
      }
    }
  }

  /** Baú do modelo enviado, com a tampa presa na dobradiça de trás. */
  spawnChest(pos: Vector3, ry: number, epic: boolean): void {
    const c = WorldAssets.current?.chests.get(epic ? 'bau_epico' : 'bau');
    if (!c) return;
    const root = new TransformNode(epic ? 'bauEpico' : 'bau', this.scene);
    root.position.set(pos.x, pos.y - 0.1, pos.z);
    root.rotation.y = ry;
    const mat = (role: string) => c.materials.get(role) ?? null;
    const meshes = instanceModel(c.base, mat, root, 'bau_base');
    // Dobradiça: aresta de trás e de baixo da tampa (+Z no modelo, ver chest.py).
    const hinge = new Vector3((c.lid.min.x + c.lid.max.x) / 2, c.lid.min.y, c.lid.max.z);
    const lid = new TransformNode('bauTampa', this.scene);
    lid.parent = root;
    lid.position.copyFrom(hinge);
    for (const m of instanceModel(c.lid, mat, lid, 'bau_tampa')) {
      m.position.copyFrom(hinge.scale(-1));
      meshes.push(m);
    }
    // Brilho discreto: faíscas subindo (douradas; azuis no épico) e anel suave no chão.
    const ring = instanceOf(epic ? 'bauBrilhoEpico' : 'bauBrilho', () => {
      const d = MeshBuilder.CreateDisc('bauBrilho', { radius: 0.9, tessellation: 32 }, this.scene);
      d.visibility = 0.55;
      return d;
    }, this.ringMats[epic ? 2 : 4], root);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    ring.setEnabled(false);
    meshes.push(ring);
    this.items.push({ kind: 'chest', pos: pos.clone(), root, meshes, glowMeshes: [], rarity: epic ? 3 : 1, amount: 1, phase: 0, visible: true, lid, epic, opened: false, openT: 0 });
  }

  /** Faíscas do baú: só existem enquanto o jogador está perto (criar 200 de uma vez travava o início). */
  private chestSparkles(it: LootItem): ParticleSystem {
    const epic = !!it.epic;
    const pos = it.root.position;
    const sp = new ParticleSystem('bauFaiscas', 40, this.scene);
    sp.particleTexture = softDot(this.scene);
    sp.emitter = new Vector3(pos.x, pos.y + 0.45, pos.z);
    sp.minEmitBox = new Vector3(-0.42, -0.2, -0.32);
    sp.maxEmitBox = new Vector3(0.42, 0.35, 0.32);
    const col = epic ? new Color4(0.45, 0.7, 1, 1) : new Color4(1, 0.82, 0.35, 1);
    sp.color1 = col;
    sp.color2 = new Color4(col.r, col.g, col.b, 0.6);
    sp.colorDead = new Color4(col.r, col.g, col.b, 0);
    sp.minSize = 0.03;
    sp.maxSize = 0.07;
    sp.minLifeTime = 0.8;
    sp.maxLifeTime = 1.5;
    sp.emitRate = epic ? 16 : 10;
    sp.direction1 = new Vector3(-0.1, 1, -0.1);
    sp.direction2 = new Vector3(0.1, 1, 0.1);
    sp.minEmitPower = 0.25;
    sp.maxEmitPower = 0.5;
    sp.gravity = new Vector3(0, 0.1, 0);
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    return sp;
  }

  /** Abre o baú: a tampa sobe (e fica aberta) e o loot salta para a frente. */
  openChest(it: LootItem, byPlayer: boolean): void {
    if (it.kind !== 'chest' || it.opened) return;
    it.opened = true;
    it.openT = 0;
    it.sparkles?.dispose();
    it.sparkles = undefined;
    it.meshes[it.meshes.length - 1]?.setEnabled(false);
    if (byPlayer) this.audio.chestOpen(!!it.epic);
  }

  /** Loot do baú, espalhado na frente dele. */
  private chestLoot(it: LootItem): void {
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    const weaponIds = Object.values(WEAPONS);
    const fwd = new Vector3(-Math.sin(it.root.rotation.y), 0, -Math.cos(it.root.rotation.y));
    const side = new Vector3(fwd.z, 0, -fwd.x);
    const at = (k: number, d = 1.3) => it.root.position.add(fwd.scale(d)).add(side.scale(k)).add(new Vector3(0, 0.1, 0));
    const n = it.epic ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const rarity = pickWeighted(rng, it.epic ? EPIC_CHEST_WEIGHTS : CHEST_WEIGHTS);
      const pool = weaponIds.filter((w) => w.minRarity <= rarity);
      const def = pickByWeight(rng, pool);
      this.spawnWeapon(def, rarity, at(n === 1 ? 0 : i === 0 ? -0.7 : 0.7));
      this.spawnAmmo(def.ammo, AMMO[def.ammo].pickup, at(i === 0 ? 0.9 : -0.9, 0.9));
    }
    if (it.epic || rng.chance(0.55)) this.spawnShield(at(0, 2.1));
    if (it.epic) this.spawnShield(at(0.8, 2.0));
    if (rng.chance(it.epic ? 0.6 : 0.28)) this.spawnMedkit(at(-0.8, 2.0));
  }

  /** Energético (modelo enviado): dá escudo aos poucos ao pegar. */
  spawnShield(pos: Vector3): void {
    this.spawnConsumable('shield', pos);
  }

  /** Kit médico (caixa de medicamentos enviada): recupera vida aos poucos ao pegar. */
  spawnMedkit(pos: Vector3): void {
    this.spawnConsumable('heal', pos);
  }

  private spawnConsumable(kind: 'shield' | 'heal', pos: Vector3): void {
    const root = new TransformNode(kind === 'shield' ? 'energetico' : 'kitMedico', this.scene);
    root.position.copyFrom(pos);
    // Nó que gira e flutua (o update mexe em model.root como nas armas).
    const holder = new TransformNode('consumivel', this.scene);
    holder.parent = root;
    holder.position.y = 0.6;
    const meshes: AbstractMesh[] = [];
    const p = WorldAssets.current?.texturedProps.get(kind === 'shield' ? 'energetico' : 'kit_medico');
    if (p) {
      const inner = new TransformNode('consumivelModelo', this.scene);
      inner.parent = holder;
      // Centro do modelo no eixo de giro e um pouco maior que o real para ler de longe.
      const k = kind === 'shield' ? 1.15 : 1.1;
      inner.scaling.setAll(k);
      inner.position.set(-((p.model.min.x + p.model.max.x) / 2) * k, -0.12, -((p.model.min.z + p.model.max.z) / 2) * k);
      meshes.push(...instanceModel(p.model, (role) => p.materials.get(role) ?? null, inner, kind));
    } else {
      // Sem o modelo: lata azul ou caixa vermelha simples.
      if (!this.energyMat) {
        this.energyMat = new StandardMaterial('consumivelReserva', this.scene);
        this.energyMat.diffuseColor = Color3.FromHexString('#2f7fd8');
      }
      const m = kind === 'shield'
        ? MeshBuilder.CreateCylinder('lata', { diameter: 0.14, height: 0.26, tessellation: 20 }, this.scene)
        : MeshBuilder.CreateBox('kit', { width: 0.4, height: 0.26, depth: 0.16 }, this.scene);
      m.material = kind === 'shield' ? this.energyMat : this.crateMat;
      m.parent = holder;
      meshes.push(m);
    }
    const ring = instanceOf('anelItem', () => MeshBuilder.CreateDisc('anelItem', { radius: 0.55, tessellation: 32 }, this.scene), this.ringMats[kind === 'shield' ? 2 : 1], root);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    const model = { root: holder } as unknown as WeaponModel;
    const amount = kind === 'shield' ? ENERGY_SHIELD : MEDKIT_HEAL;
    this.items.push({ kind, pos, root, meshes: [ring, ...meshes], glowMeshes: [], rarity: kind === 'shield' ? 2 : 1, amount, model, phase: Math.random() * 6, visible: true });
  }

  /** Kit médico: vida entrando aos poucos (como o kit do Fortnite, sem passar de 100). */
  private useMedkit(it: LootItem, actor: Actor, isPlayer: boolean): void {
    this.drinks.push({ actor, left: it.amount, stat: 'health', rate: MEDKIT_HEAL / MEDKIT_TIME });
    if (isPlayer) {
      this.audio.medkit();
      this.onPickup?.(`Kit médico: +${it.amount} de vida`, '#5cff7a');
    }
    this.removeItem(it);
  }

  private drinkShield(it: LootItem, actor: Actor, isPlayer: boolean): void {
    this.drinks.push({ actor, left: it.amount, stat: 'shield', rate: ENERGY_SHIELD / ENERGY_TIME });
    if (isPlayer) {
      this.audio.drink();
      this.onPickup?.(`Energético: +${it.amount} de escudo`, '#39e0ff');
    }
    this.removeItem(it);
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
      // Baú fechado também serve de alvo (o bot abre e pega o que sair).
      if ((it.kind !== 'weapon' && !(it.kind === 'chest' && !it.opened)) || exclude?.has(it)) continue;
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
    return this.items.includes(it) && !(it.kind === 'chest' && it.opened);
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
    const box = (key: string, w: number, h: number, d: number, mat: StandardMaterial, y: number) => {
      const m = instanceOf(key, () => MeshBuilder.CreateBox(key, { width: w, height: h, depth: d }, this.scene), mat, root);
      m.position.y = y;
      return m;
    };
    const crate = box('ammoCrate', 0.42, 0.26, 0.3, this.crateMat, 0.13);
    const band = box('ammoBand', 0.44, 0.06, 0.32, this.ammoMats[type], 0.17);
    const lid = box('ammoLid', 0.44, 0.03, 0.32, this.crateMat, 0.27);
    root.rotation.y = Math.random() * Math.PI;
    this.items.push({ kind: 'ammo', pos, root, meshes: [crate, band, lid], glowMeshes: [], rarity: 0, ammoType: type, amount, phase: 0, visible: true });
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

    // Energético entrando aos poucos (jogador e bots).
    for (let i = this.drinks.length - 1; i >= 0; i--) {
      const dr = this.drinks[i];
      const add = Math.min(dr.left, dr.rate * dt);
      dr.left -= add;
      if (dr.actor.alive && dr.stat === 'shield') dr.actor.shield = Math.min(dr.actor.maxShield, dr.actor.shield + add);
      if (dr.actor.alive && dr.stat === 'health') dr.actor.health = Math.min(dr.actor.maxHealth, dr.actor.health + add);
      if (dr.left <= 0 || !dr.actor.alive) this.drinks.splice(i, 1);
    }
    // Baús: tampa abrindo (com um pequeno quique) e loot saindo no meio da animação.
    this.time2 += dt;
    for (const it of this.items) {
      if (it.kind !== 'chest' || !it.opened || !it.lid || (it.openT ?? 0) >= 1) continue;
      it.openT = Math.min(1, (it.openT ?? 0) + dt / 0.7);
      const t = it.openT;
      const ease = 1 - Math.pow(1 - t, 3);
      const bounce = Math.sin(t * Math.PI * 3) * (1 - t) * 0.12;
      it.lid.rotation.x = (ease * 1.95 + bounce) * CHEST_OPEN_SIGN;
      if (t > 0.45 && !it.lootOut) {
        it.lootOut = true;
        this.chestLoot(it);
      }
    }

    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.3;
      for (const it of this.items) {
        const d = Vector3.Distance(it.pos, p);
        if (it.kind === 'chest') {
          const vis = d < 90;
          if (vis !== it.visible) {
            it.visible = vis;
            it.root.setEnabled(vis);
          }
          // Faíscas e anel só de perto (e só enquanto fechado).
          const near = vis && d < 32 && !it.opened;
          if (near !== !!it.glowOn) {
            it.glowOn = near;
            if (near) {
              it.sparkles ??= this.chestSparkles(it);
              it.sparkles.start();
            } else if (it.sparkles) {
              it.sparkles.dispose();
              it.sparkles = undefined;
            }
            it.meshes[it.meshes.length - 1]?.setEnabled(near);
          }
          continue;
        }
        const vis = d < (it.kind === 'weapon' || it.kind === 'shield' || it.kind === 'heal' ? 70 : 45);
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
      if (!it.visible || (it.kind !== 'weapon' && it.kind !== 'shield' && it.kind !== 'heal') || !it.model) continue;
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

    // Baú fechado por perto: o "canto" mágico aumenta conforme chega perto.
    let chestD = Infinity;
    for (const it of this.items) {
      if (it.kind !== 'chest' || it.opened || !it.visible) continue;
      const d = Vector3.Distance(it.pos, p);
      if (d < chestD) chestD = d;
    }
    this.audio.setLoop('chest', player.alive ? Math.max(0, Math.min(1, (16 - chestD) / 13)) * 0.5 : 0);

    this.nearest = null;
    this.prompt = null;
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
      if (it.kind === 'shield' && dist < 1.25 && player.shield < player.maxShield) {
        this.drinkShield(it, player, true);
        continue;
      }
      if (it.kind === 'heal' && dist < 1.25 && player.health < player.maxHealth) {
        this.useMedkit(it, player, true);
        continue;
      }
      if ((it.kind === 'weapon' && dist < 2.2) || (it.kind === 'chest' && !it.opened && dist < 2.0)) {
        const facing = dist > 0.01 ? (dx * fwd.x + dz * fwd.z) / dist : 1;
        const score = dist - facing * 0.8;
        if (score < best) {
          best = score;
          this.nearest = it;
        }
      }
    }

    if (this.nearest?.kind === 'chest') {
      this.prompt = { text: this.nearest.epic ? 'Abrir baú épico [E]' : 'Abrir baú [E]', color: this.nearest.epic ? RARITIES[3].color : RARITIES[4].color };
      if (input.wasPressed('KeyE')) this.openChest(this.nearest, true);
    } else if (this.nearest) {
      const s = 1 + Math.sin(this.time * 8) * 0.06;
      this.nearest.model?.root.scaling.setAll(s * 1.15);
      this.prompt = this.promptFor(weapons);
      if (this.prompt) this.prompt.text += ' [E]';
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
      if (it.kind !== 'ammo' && it.kind !== 'shield' && it.kind !== 'heal') continue;
      if (Math.hypot(it.pos.x - p.x, it.pos.z - p.z) < 1.3 && Math.abs(it.pos.y - p.y) < 1.6) {
        if (it.kind === 'ammo') this.collectAmmo(it, weapons, false);
        else if (it.kind === 'shield' && bot.shield < bot.maxShield) this.drinkShield(it, bot, false);
        else if (it.kind === 'heal' && bot.health < bot.maxHealth) this.useMedkit(it, bot, false);
      }
    }
    if (wanted?.kind === 'chest' && this.has(wanted) && Math.hypot(wanted.pos.x - p.x, wanted.pos.z - p.z) < 1.8 && Math.abs(wanted.pos.y - p.y) < 1.8) {
      this.openChest(wanted, false);
      return true;
    }
    if (wanted && wanted.kind === 'weapon' && this.items.includes(wanted) && Math.hypot(wanted.pos.x - p.x, wanted.pos.z - p.z) < 1.7 && Math.abs(wanted.pos.y - p.y) < 1.8) {
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
    it.sparkles?.dispose();
    if (it.kind === 'shield' || it.kind === 'heal') it.model = undefined;
    if (it.model) {
      it.model.root.parent = null;
      disposeWeaponModel(it.model);
    }
    for (const m of it.meshes) if (!m.isDisposed()) m.dispose();
    it.root.dispose();
    if (this.nearest === it) this.nearest = null;
  }
}

/** Sinal da rotação que abre a tampa (para cima e para trás) no eixo X da dobradiça. */
const CHEST_OPEN_SIGN = 1;

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
