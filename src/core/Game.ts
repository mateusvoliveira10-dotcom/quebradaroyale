import { buildWeaponModel, disposeWeaponModel } from '../weapons/WeaponModels';
import { WEAPONS, WeaponId } from '../weapons/WeaponDefs';
import { placeAt } from '../world/Places';
import { Color3, Engine, Matrix, Scene, StandardMaterial, SubMesh, Texture, Vector3 } from '@babylonjs/core';
import { Appearance, loadAppearance, saveAppearance } from '../appearance/Appearance';
import { Bot } from '../bots/Bot';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { Actor, TEAM_COLORS } from '../combat/Actor';
import { CombatManager, KillEvent } from '../combat/CombatManager';
import { LootSystem } from '../loot/LootSystem';
import { DropSequence } from '../match/DropSequence';
import { SafeZone } from '../match/SafeZone';
import { loadAirAssets } from '../match/Vehicles';
import { BattleRoyaleMode } from '../modes/BattleRoyaleMode';
import { DeathmatchMode } from '../modes/DeathmatchMode';
import { GameMode } from '../modes/GameMode';
import { LobbyMode } from '../modes/LobbyMode';
import { TrainingMode } from '../modes/TrainingMode';
import { ColliderIndex } from '../nav/ColliderIndex';
import { NavGrid } from '../nav/NavGrid';
import { CharacterAsset } from '../player/CharacterAsset';
import { GarmentAsset } from '../player/GarmentAsset';
import { CharacterController, ControlInput, emptyControl } from '../player/CharacterController';
import { Hud, Plate } from '../ui/Hud';
import { Chat } from '../ui/Chat';
import { Menu, ModeId } from '../ui/Menu';
import { Minimap } from '../ui/Minimap';
import { Overlays } from '../ui/Overlays';
import { renderMapTopDown, renderShot } from '../ui/Snapshots';
import { clamp, Rng } from '../utils/random';
import { WeaponEffects } from '../weapons/Effects';
import { TrainingTarget } from '../weapons/Targets';
import { noWeaponIntent, WeaponIntent, WeaponSystem } from '../weapons/WeaponSystem';
import { buildGalpao, GalpaoInfo } from '../world/builders/Galpao';
import { buildCommunityMap, CommunityMapResult } from '../world/CommunityMap';
import { Environment } from '../world/Environment';
import { Materials } from '../world/Materials';
import { StaticBatcher } from '../world/StaticBatcher';
import { WorldAssets } from '../world/WorldAssets';
import { WorldBuilder } from '../world/WorldBuilder';
import { GameAudio } from './Audio';
import { CAMERA, WORLD } from './config';
import { Input } from './Input';
import { music } from './Music';
import { loadSettings, Quality, saveSettings, Settings } from './Settings';

export interface BotEntry {
  actor: Actor;
  weapons: WeaponSystem;
  brain: Bot;
  active: boolean;
}

const BOT_NAMES = ['Biel do Morro', 'MC Pivete', 'Jão da Laje', 'Dudu Treta', 'Kauã Zika', 'Pedrinho', 'Lelê', 'Juninho', 'Tiozão', 'Neguinho'];
/** Bots criados na tela de carregamento (o Deathmatch usa 9). */
/** Bots criados na tela de carregamento (o Battle Royale usa 29). */
const WARM_BOTS = 29;
/** Centro do Galpão da Quebrada (longe do mapa principal). */
const GALPAO_CENTER = new Vector3(0, 0, 560);

/** Monta engine, cena, mundos e sistemas; gerencia os modos de jogo. */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: Input;
  readonly audio = new GameAudio();
  settings: Settings;
  appearance: Appearance;
  readonly env: Environment;
  readonly camera: ThirdPersonCamera;
  readonly world: WorldBuilder;
  readonly map: CommunityMapResult;
  readonly galpao: GalpaoInfo;
  readonly colliders: ColliderIndex;
  readonly nav: NavGrid;
  readonly effects: WeaponEffects;
  readonly combat: CombatManager;
  readonly loot: LootSystem;
  readonly drop: DropSequence;
  readonly hud: Hud;
  /** Chat global e privado (Enter abre). */
  readonly chat: Chat;
  readonly minimap: Minimap;
  readonly menu: Menu;
  readonly overlays: Overlays;
  readonly player: Actor;
  readonly playerWeapons: WeaponSystem;
  private readonly bots: BotEntry[] = [];
  private readonly rng = new Rng(99);
  private readonly targets: TrainingTarget[] = [];
  /** Cache de visibilidade dos nomes (linha de visão é refeita a cada 0,2 s). */
  private readonly plateVis = new Map<number, { at: number; vis: boolean }>();

  private readonly lobby: LobbyMode;
  private readonly modes: { br: BattleRoyaleMode; dm: DeathmatchMode; training: TrainingMode };
  mode: GameMode;
  private paused = false;
  /** Partida esperando um clique para capturar o mouse. */
  private waitingCapture = false;
  private uncapturedFor = 0;

  /**
   * Cria engine e cena, carrega o personagem-base (GLB) e só então monta o
   * jogo. Termina com shaders do personagem já compilados.
   */
  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    progress(0.3, 'Carregando comunidade…', 0.7);
    const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, false);
    const scene = new Scene(engine);
    // Ordem dos opacos: corpo dos personagens depois das roupas e o cabelo depois do corpo.
    // O contorno de 6 mm do corpo é pintado antes dele; o cabelo, que na borda fica a 1,5 mm
    // da pele, precisa vir depois, senão ganha uma faixa do contorno por cima. As roupas
    // (mais afastadas da pele) ficam antes do corpo, como sempre ficaram. O sort é estável.
    const rank = (s: SubMesh) => {
      const n = s.getMesh().name;
      return n === 'Corpo' ? 1 : n.startsWith('roupa_Cabelo') ? 2 : 0;
    };
    scene.setRenderingOrder(0, (a, b) => rank(a) - rank(b));
    // Carros e estátua do mapa (GLB do Blender) carregam junto com o personagem.
    const worldAssets = WorldAssets.load(scene).catch((err) => console.warn('[Mapa] Modelos 3D do mapa não carregaram; usando carros de caixas.', err));
    // Avião e paraquedas (GLB do Blender); sem eles valem os de formas simples.
    const airAssets = loadAirAssets(scene).catch((err) => console.warn('[Avião] modelos não carregaram:', err));
    // Cada pacote de modelos que termina empurra a barra (30% → 70%).
    let done = 0;
    const step = <T>(p: Promise<T>) => p.then((v) => (progress(0.3 + (++done / 4) * 0.4, undefined, 0.3 + ((done + 1) / 4) * 0.4), v));
    const characterP = step(CharacterAsset.load(scene));
    await step(worldAssets);
    await step(airAssets);
    const character = await characterP;
    await step(GarmentAsset.load(scene, character.baseMaterial, character.skeletonBones));
    progress(0.72, 'Montando o mapa…', 0.86);
    // Deixa a barra ser desenhada antes da montagem (síncrona e pesada) do mundo.
    await new Promise((r) => setTimeout(r, 40));
    const game = new Game(canvas, engine, scene);
    progress(0.88, 'Preparando personagem e gráficos…', 0.98);
    await new Promise((r) => setTimeout(r, 20));
    await game.warmup();
    progress(1, 'Pronto!');
    // Em segundo plano: a foto do Babylon espera um quadro ser desenhado, e com a aba em
    // segundo plano isso só acontece quando ela volta — não pode prender o carregamento.
    // Até as fotos ficarem prontas valem a ilustração vetorial e o esboço do minimapa.
    void game.takeSnapshots().catch((err) => console.warn('[Fotos] arte dos modos/minimapa não gerada:', err));
    return game;
  }

  /**
   * Arte dos cards de modo e fundo do minimapa, renderizados pelo próprio jogo (cenas
   * reais do mapa). Ainda na tela de carregamento: leva uma fração de segundo.
   */
  private async takeSnapshots(): Promise<void> {
    const e = this.engine;
    const s = this.scene;
    const shot = async (pos: Vector3, target: Vector3, fov: number) => {
      // sombras centradas na cena fotografada
      this.env.update(target, pos);
      return renderShot(e, s, { pos, target, fov, width: 640, height: 384 });
    };
    // Battle Royale: a comunidade vista do alto, com o morro e a estátua ao fundo e o avião.
    const plane = this.drop.plane.root;
    const planeOn = plane.isEnabled();
    plane.setEnabled(true);
    plane.position.set(18, 52, -18);
    plane.rotation.set(0, -2.35, 0.14);
    const br = await shot(new Vector3(48, 60, -52), new Vector3(-58, 6, 62), 0.95);
    plane.setEnabled(planeOn);
    // Deathmatch: rua principal no nível do chão.
    const dm = await shot(new Vector3(-2.2, 1.7, -50), new Vector3(1.2, 2.4, 0), 0.9);
    // Treinamento: o galpão visto do balcão de tiro.
    const g = GALPAO_CENTER;
    const training = await shot(new Vector3(g.x - 6, 2.4, g.z + 19), new Vector3(g.x + 2, 1.4, g.z - 14), 0.95);
    this.menu.setModeArt({ br, dm, training });
    // Fotos das armas (escolha de arma do Deathmatch): cada modelo num "estúdio" no alto.
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const m = buildWeaponModel(s, id, 1);
      m.root.position.set(0, 400, 0);
      m.root.rotation.set(0, Math.PI / 2, 0);
      m.root.computeWorldMatrix(true);
      const { min, max } = m.root.getHierarchyBoundingVectors(true);
      const c = min.add(max).scale(0.5);
      const size = Math.max(max.x - min.x, max.z - min.z, 0.3);
      this.weaponPhotos[id] = await renderShot(e, s, { pos: new Vector3(c.x + size * 0.12, c.y + size * 0.16, c.z + size * 0.92), target: c, fov: 0.62, width: 320, height: 180 });
      disposeWeaponModel(m);
    }
    this.minimap.setBackground(await renderMapTopDown(e, s, WORLD.radius + 12, 1024), WORLD.radius + 12);
  }

  private constructor(canvas: HTMLCanvasElement, engine: Engine, scene: Scene) {
    this.settings = loadSettings();
    this.appearance = loadAppearance();

    this.engine = engine;
    this.scene = scene;
    this.scene.collisionsEnabled = true;
    this.scene.skipPointerMovePicking = true;

    this.input = new Input(canvas);
    this.input.onFirstGesture = () => this.audio.unlock();
    this.input.onUnlock = () => this.onPointerUnlock();
    this.input.onEscape = () => this.onPointerUnlock();
    this.input.onFallback = () => {
      console.warn('[Input] Pointer lock recusado pelo navegador: usando modo mouse livre.');
      this.hud.toast('Mouse livre: mova o mouse para olhar · Esc pausa', '#ffd21f');
    };
    document.addEventListener('pointerlockchange', () => {
      if (this.input.pointerLocked && this.paused) this.resume();
    });

    this.env = new Environment(this.scene);
    this.camera = new ThirdPersonCamera(this.scene, this.input);
    this.env.setupPostProcess(this.camera.camera);

    // ---------- Mundos (mapa da comunidade + galpão de treino) ----------
    const batcher = new StaticBatcher();
    this.world = new WorldBuilder(this.scene, batcher, new Materials(this.scene));
    this.map = buildCommunityMap(this.world);
    this.galpao = buildGalpao(this.world, new Rng(321), GALPAO_CENTER.x, GALPAO_CENTER.z);
    batcher.build(this.env.shadows);
    this.colliders = new ColliderIndex(this.world.colliders);
    // As caixas de colisão (milhares, invisíveis) saem da lista de malhas da cena: o
    // Babylon percorria todas a cada frame. Movimento, câmera, tiros e escalada
    // consultam o índice espacial (ColliderIndex), que guarda as malhas.
    for (const c of this.world.colliders) this.scene.removeMesh(c);
    this.nav = new NavGrid(this.colliders, WORLD.radius + 10);

    // ---------- Combate, loot, avião ----------
    this.effects = new WeaponEffects(this.scene, this.env.glow);
    this.combat = new CombatManager(this.scene, this.effects);
    this.combat.colliders = this.colliders;
    this.combat.onKill = (e) => this.mode.onKill?.(e);
    this.combat.onDamage = (target, amount, source, _head, shieldHit) => {
      if (target.isPlayer && amount > 0) {
        this.hud.hurt(shieldHit);
        this.audio.hurt();
        this.camera.shake(0.05);
        // Indicador de direção do dano (arco em volta da mira apontando para o atirador).
        if (source && source !== target) {
          const d = source.position.subtract(target.position);
          this.hud.damageFrom(Math.atan2(d.x, d.z) - this.camera.yaw, shieldHit);
        }
      }
    };
    this.loot = new LootSystem(this.scene, this.env.glow, this.audio);
    this.drop = new DropSequence(this.scene, this.audio, WORLD.radius);

    // ---------- Jogador ----------
    const ctrl = new CharacterController(this.scene, 'jogador', this.colliders);
    ctrl.model.setAppearance(this.appearance);
    ctrl.model.setShadowGenerator(this.env.shadows);
    this.player = new Actor(this.scene, 0, this.settings.playerName, 0, true, ctrl);
    this.playerWeapons = new WeaponSystem(this.scene, this.player, this.combat, this.audio, this.camera, () => this.camera.camera.position);
    this.wireCharacter(this.player);
    this.camera.ignore = (m) => !!m.metadata?.actor;
    this.camera.colliders = this.colliders;

    // ---------- Interface ----------
    this.hud = new Hud(this.input);
    this.chat = new Chat(() => this.settings.playerName);
    this.chat.onToggle = () => this.input.releaseAll();
    this.chat.system('Enter: conversar no chat global · /m Nome texto: mensagem privada');
    this.hud.setPlayerName(this.settings.playerName);
    this.minimap = new Minimap(this.map.features, this.map.half);
    this.overlays = new Overlays();
    this.overlays.onClick = () => this.audio.ui();
    this.menu = new Menu(this.appearance, this.settings);
    this.menu.onClick = () => {
      this.audio.unlock();
      this.audio.ui();
    };
    this.menu.onPlay = (m) => this.startMode(m);
    this.menu.onAppearance = (app) => {
      this.appearance = app;
      this.player.ctrl.model.setAppearance(app);
      saveAppearance(app);
    };
    // Prévia (ex.: camisa antes do EQUIPAR): só no personagem, sem salvar.
    this.menu.onPreview = (app) => this.player.ctrl.model.setAppearance(app);
    this.menu.onSettings = (s) => this.applySettings(s);
    this.menu.onRotate = (d) => this.lobby.rotate(d);
    this.playerWeapons.onHit = (r) => {
      this.showHitAt(r.point, r.damage, r.crit, r.shield);
      if (r.kill) this.hud.elimination();
    };
    this.playerWeapons.onMessage = (t) => this.hud.toast(t, '#ff6b5c');
    this.loot.onPickup = (t, c) => this.hud.toast(t, c);

    this.createCampinhoTargets();

    this.lobby = new LobbyMode(this);
    this.modes = { br: new BattleRoyaleMode(this), dm: new DeathmatchMode(this), training: new TrainingMode(this) };
    this.applySettings(this.settings);

    this.mode = this.lobby;
    this.mode.enter();

    this.scene.onBeforeRenderObservable.add(() => this.update());
    window.addEventListener('resize', () => this.engine.resize());
  }

  /**
   * Ainda na tela de carregamento: cria o pool de bots e compila os shaders do
   * personagem (PBR com skinning + roupas, sombra e contorno), para nenhum
   * personagem aparecer atrasado depois.
   */
  private async warmup(): Promise<void> {
    while (this.bots.length < WARM_BOTS) this.bots.push(this.createBot(this.bots.length));
    const meshes = this.player.ctrl.model.meshes;
    // Limite de tempo: o aquecimento nunca pode prender a tela de carregamento.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
    const ready = (async () => {
      for (const m of meshes) await m.material?.forceCompilationAsync(m);
      // Texturas de todas as roupas: trocar de peça no menu fica instantâneo.
      const garmentTextures = (GarmentAsset.current?.allMaterials ?? []).flatMap((m) => [m.albedoTexture!, m.bumpTexture!]);
      await new Promise<void>((resolve) => Texture.WhenAllReady(garmentTextures, resolve));
      await this.scene.whenReadyAsync();
    })();
    await Promise.race([ready, timeout]);
    this.scene.render();
    this.scene.render();
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  // ------------------------------------------------------------------ modos

  private minimapFresh = false;
  /** Fotos das armas (data URL por id), feitas na abertura. */
  readonly weaponPhotos: Partial<Record<WeaponId, string>> = {};

  startMode(id: ModeId): void {
    this.audio.unlock();
    // Refaz o fundo do minimapa na primeira partida, já com tudo carregado.
    if (!this.minimapFresh) {
      this.minimapFresh = true;
      void renderMapTopDown(this.engine, this.scene, WORLD.radius + 12, 1024).then((url) => this.minimap.setBackground(url, WORLD.radius + 12));
    }
    // A música tema fica na abertura e no lobby; a partida começa sem ela.
    music.stop();
    this.overlays.hideAll();
    this.waitingCapture = false;
    this.uncapturedFor = 0;
    this.paused = false;
    this.mode.exit();
    this.mode = this.modes[id];
    // Sifão e escudo são regras de cada modo (DM e BR ligam no próprio enter/start).
    this.combat.siphon = 0;
    // A captura do mouse precisa acontecer dentro do clique do usuário.
    if (id === 'br') this.input.lockPointer();
    this.mode.enter();
  }

  toLobby(): void {
    this.overlays.hideAll();
    this.waitingCapture = false;
    this.uncapturedFor = 0;
    this.paused = false;
    this.mode.exit();
    this.mode = this.lobby;
    this.combat.siphon = 0;
    this.mode.enter();
    music.play();
  }

  private onPointerUnlock(): void {
    if (this.mode === this.lobby || this.overlays.blocking) return;
    this.paused = true;
    this.overlays.showPause({
      continue: () => {
        // Se o navegador recusar a captura (o Chrome bloqueia ~1 s após o Esc), o jogo fica
        // parado com "CLIQUE PARA JOGAR" (ver update) até um clique conseguir capturar.
        this.input.lockPointer();
        this.resume();
      },
      restart: this.mode.restart ? () => this.mode.restart?.() : null,
      lobby: () => this.toLobby(),
      difficulty: this.mode.changeDifficulty ? () => this.mode.changeDifficulty?.() : null,
    });
  }

  private resume(): void {
    this.paused = false;
    this.overlays.hidePause();
  }

  /**
   * Partida sem o mouse capturado: congela o jogo e mostra "CLIQUE PARA JOGAR" (o cursor só
   * aparece nesse aviso, nos menus e na pausa). Devolve true enquanto estiver esperando.
   */
  private updateCaptureGate(dt: number): boolean {
    const inMatch = this.mode !== this.lobby && !this.overlays.blocking;
    this.input.active = inMatch && !this.paused;
    const uncaptured = this.input.active && !this.input.captured;
    // A confirmação da captura chega alguns ms depois do clique: tolera um instante.
    this.uncapturedFor = uncaptured ? this.uncapturedFor + dt : 0;
    const waiting = uncaptured && (this.waitingCapture || this.uncapturedFor > 0.3);
    // Setinha do mouse nunca aparece com a partida rodando (nem no modo mouse livre): só em
    // menus, pausa e no aviso "clique para jogar".
    document.body.classList.toggle('jogando', this.input.active && !waiting);
    if (waiting !== this.waitingCapture) {
      this.waitingCapture = waiting;
      this.overlays.clickToPlay(waiting, () => this.input.lockPointer());
      if (waiting) this.input.captureOnClick = true;
    }
    return waiting;
  }

  // ------------------------------------------------------------- configurações

  applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    this.camera.prefs = { sensitivity: s.sensitivity, aimSensitivity: s.aimSensitivity, scopeSensitivity: s.scopeSensitivity, invertY: s.invertY, fov: (s.fov * Math.PI) / 180 };
    this.audio.setMasterVolume(s.volume);
    music.setVolume(s.volume);
    this.player.name = s.playerName;
    this.hud.setPlayerName(s.playerName);
    this.applyQuality(s.quality);
  }

  private applyQuality(q: Quality): void {
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(q === 'alta' ? 1 / Math.min(dpr, 1.5) : q === 'media' ? 1 : 1.35);
    this.env.setQuality(q);
  }

  // ------------------------------------------------------------------ bots

  /** Ativa N bots do pool (cria se precisar). */
  acquireBots(n: number): BotEntry[] {
    while (this.bots.length < n) this.bots.push(this.createBot(this.bots.length));
    const out = this.bots.slice(0, n);
    for (const b of out) {
      b.active = true;
      b.actor.ctrl.root.setEnabled(true);
      b.weapons.setVisibleAll(true);
    }
    return out;
  }

  releaseBots(): void {
    for (const b of this.bots) {
      b.active = false;
      b.weapons.clear();
      b.weapons.enabled = false;
      b.actor.ctrl.root.setEnabled(false);
    }
  }

  private createBot(i: number): BotEntry {
    const ctrl = new CharacterController(this.scene, `bot${i}`, this.colliders);
    ctrl.speedScale = 0.94;
    ctrl.model.setShadowGenerator(this.env.shadows);
    ctrl.model.setOutline(false);
    const actor = new Actor(this.scene, i + 1, BOT_NAMES[i % BOT_NAMES.length], 1, false, ctrl);
    const weapons = new WeaponSystem(this.scene, actor, this.combat, this.audio, null, () => this.camera.camera.position);
    const brain = new Bot(actor, weapons, this.rng);
    this.wireCharacter(actor);
    ctrl.root.setEnabled(false);
    return { actor, weapons, brain, active: false };
  }

  /** Dano de queda e avisos de recuperação para qualquer personagem. */
  private wireCharacter(a: Actor): void {
    a.ctrl.onLand = (fall) => {
      if (a.isPlayer) {
        this.camera.landingDip(fall / 18);
        this.audio.land(Math.min(1, fall / 20));
      }
      if (fall > 15 && this.mode !== this.lobby) this.combat.applyDamage(a, (fall - 15) * 4.5, null, 'Queda');
    };
    a.ctrl.onRecovered = (reason) => {
      if (a.isPlayer) this.hud.toast(`Posição recuperada (${reason})`, '#ff9a3a');
    };
    if (a.isPlayer) {
      a.ctrl.onTraversal = () => this.audio.whoosh();
      a.ctrl.model.onFootstep = (running) => {
        if (this.mode !== this.lobby && a.ctrl.grounded) this.audio.footstep(running);
      };
    }
  }

  // ------------------------------------------------------------- jogador/bots

  /** Intenção de movimento do jogador a partir do teclado e da câmera. */
  private playerControl(): ControlInput {
    const i = this.input;
    const c = emptyControl();
    const ix = (i.isDown('KeyD') ? 1 : 0) - (i.isDown('KeyA') ? 1 : 0);
    const iz = (i.isDown('KeyW') ? 1 : 0) - (i.isDown('KeyS') ? 1 : 0);
    c.move = this.camera.getForward().scale(iz).addInPlace(this.camera.getRight().scale(ix));
    if (c.move.lengthSquared() > 0) c.move.normalize();
    c.sprint = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
    c.jumpPressed = i.wasPressed('Space');
    c.jumpHeld = i.isDown('Space');
    // Agachar alterna com C ou Ctrl (toque). Segurar Ctrl e apertar W fecha a aba no navegador,
    // atalho que a página não pode bloquear: por isso é alternância, e o C também funciona.
    c.crouchToggle = i.wasPressed('KeyC') || i.wasPressed('ControlLeft') || i.wasPressed('ControlRight');
    const armed = this.playerWeapons.current !== null;
    const aimHeld = i.isMouseDown(2);
    // Armado ou mirando: o corpo acompanha a câmera (strafe). Desarmado: olha para onde anda.
    c.faceYaw = armed || aimHeld ? this.camera.yaw : null;
    c.aimPitch = this.camera.aimPitch;
    const beta = this.camera.camera.beta;
    c.dive = clamp((1.25 - beta) / 0.7, 0, 1) * (i.isDown('KeyW') ? 1 : 0.4);
    return c;
  }

  private playerIntent(): WeaponIntent {
    const i = this.input;
    const w = noWeaponIntent();
    w.firePressed = i.wasMousePressed(0);
    w.fireHeld = i.isMouseDown(0);
    w.aimHeld = i.isMouseDown(2);
    w.reload = i.wasPressed('KeyR');
    w.select = i.wasPressed('Digit1') ? 0 : i.wasPressed('Digit2') ? 1 : null;
    // Q ou a rodinha do mouse alternam as armas (a rodinha não dá mais zoom na câmera).
    w.swap = i.wasPressed('KeyQ') || i.wheel !== 0;
    return w;
  }

  /** Atualiza o jogador (movimento, armas e loot). */
  updatePlayer(dt: number, allowInput: boolean, useLoot = true): void {
    const p = this.player;
    const control = allowInput && p.alive && this.input.captured ? this.playerControl() : emptyControl();
    if (!allowInput || !this.input.captured) control.faceYaw = p.ctrl.combat.hold ? this.camera.yaw : null;
    p.ctrl.update(dt, control);
    p.updateHitboxes();
    const intent = allowInput && this.input.captured ? this.playerIntent() : noWeaponIntent();
    const range = this.playerWeapons.current?.def.range ?? 100;
    this.playerWeapons.update(dt, intent, () => {
      const ray = this.camera.getAimRay(range + 60);
      // Começa o raio na altura do jogador para não acertar nada atrás dele.
      ray.origin.addInPlace(ray.direction.scale(Math.max(0, this.camera.camera.radius - 0.4)));
      return ray;
    });
    this.playerWeapons.setVisibleAll(p.ctrl.mode !== 'plane');
    if (useLoot) {
      this.loot.updatePlayer(dt, this.input, this.camera, p, this.playerWeapons);
      const pr = this.loot.prompt;
      this.hud.setPrompt(pr ? pr.text : null, pr?.color);
    }
    this.hud.setHealth(p.health, p.shield);
  }

  updateBot(b: BotEntry, dt: number, mode: 'br' | 'dm', zone: SafeZone | null): void {
    if (!b.active) return;
    b.brain.update(dt, { combat: this.combat, nav: this.nav, colliders: this.colliders, loot: mode === 'br' ? this.loot : null, zone, mode, time: this.combat.time, rng: this.rng });
    b.actor.ctrl.update(dt, b.brain.control);
    b.actor.updateHitboxes();
    b.weapons.update(dt, b.brain.intent, () => b.brain.aimRay());
    b.weapons.setVisibleAll(b.actor.ctrl.mode !== 'plane');
    // LOD: detalhes e contorno só de perto.
    const d = Vector3.Distance(b.actor.position, this.camera.camera.position);
    // Fora da tela (corpo fora do campo de visão): esqueleto quase parado.
    const onScreen = d < 6 || this.camera.camera.isInFrustum(b.actor.hitboxes[0]);
    b.actor.ctrl.model.setLod(!onScreen ? 3 : d < 20 ? 0 : d < 45 ? 1 : 2);
    b.actor.ctrl.model.setOutline(d < 14);
  }

  /** Câmera de terceira pessoa padrão seguindo o jogador. */
  followPlayerCamera(dt: number): void {
    const p = this.player.ctrl;
    this.camera.updateFollow(dt, p.position, {
      height: p.crouching ? CAMERA.crouchTargetHeight : p.mode === 'dead' ? 0.8 : CAMERA.targetHeight,
      aiming: this.playerWeapons.aiming,
      sprinting: p.sprinting && p.grounded,
      aimFov: this.playerWeapons.aimFov,
      scoped: this.playerWeapons.scoped,
    });
  }

  // ------------------------------------------------------------------ HUD

  private project(pos: Vector3): { x: number; y: number; visible: boolean } {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const p = Vector3.Project(pos, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.camera.viewport.toGlobal(w, h));
    const scale = this.engine.getHardwareScalingLevel();
    return { x: p.x * scale, y: p.y * scale, visible: p.z > 0 && p.z < 1 };
  }

  showHitAt(point: Vector3, damage: number, crit: boolean, shield = false): void {
    const s = this.project(point);
    this.hud.hit(s.x, s.y, damage, crit, shield);
  }

  reportKill(e: KillEvent): void {
    const name = (a: { name: string; isPlayer: boolean }) => (a.isPlayer ? `${a.name} (você)` : a.name);
    const color = (a: Actor) => (a.isPlayer ? '#ffd21f' : TEAM_COLORS[a.team] ?? '#ffffff');
    if (e.killer && e.killer !== e.victim) {
      this.hud.kill(name(e.killer), color(e.killer), name(e.victim), color(e.victim), e.cause);
      if (e.killer.isPlayer) {
        this.audio.eliminated();
        this.hud.toast(`Você eliminou ${e.victim.name}!`, '#2bd46b');
      }
    } else {
      this.hud.kill(e.cause, '#c9a2ff', name(e.victim), color(e.victim), '☠');
    }
  }

  /** Nomes sobre as cabeças: aliados sempre (DM), inimigos quando visíveis. */
  updatePlates(teams: boolean): void {
    const plates: Plate[] = [];
    const eye = this.camera.camera.position;
    for (const a of this.combat.actors) {
      if (a.isPlayer || !a.alive || a.ctrl.mode === 'plane') continue;
      const head = a.position.add(new Vector3(0, 2.15, 0));
      const dist = Vector3.Distance(head, eye);
      const ally = teams && a.team === this.player.team;
      if (!ally) {
        if (dist > 45) continue;
        let v = this.plateVis.get(a.id);
        if (!v || this.combat.time - v.at > 0.2) {
          v = { at: this.combat.time, vis: !this.colliders.segmentBlocked(eye, head) };
          this.plateVis.set(a.id, v);
        }
        if (!v.vis) continue;
      }
      const s = this.project(head);
      if (!s.visible) continue;
      plates.push({ id: a.id, x: s.x, y: s.y, text: a.name, color: ally ? TEAM_COLORS[0] : teams ? TEAM_COLORS[1] : '#ffffff', hp: ally ? null : a.health, shield: ally ? null : a.shield });
    }
    this.hud.updatePlates(plates);
  }

  updateMinimap(
    center: Vector3,
    plane: { pos: Vector3; dir: number } | null,
    loot: Array<{ pos: Vector3; color: string }>,
    zone: { center: Vector3; radius: number; next: Vector3; nextRadius: number } | null,
    dots: Array<{ pos: Vector3; color: string }>,
    /** Mapa inteiro (no avião e na queda); senão, a área em volta do jogador. */
    wide = false,
  ): void {
    this.minimap.update(1 / 60, center, this.camera.yaw, plane, loot, zone, dots, wide);
  }

  // ------------------------------------------------------------------ cenário

  private createCampinhoTargets(): void {
    const mat = new StandardMaterial('targetPostMat', this.scene);
    mat.diffuseColor = Color3.FromHexString('#5b5f6b');
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    for (const [x, z] of [
      [52, -14],
      [54, -18],
      [52, -22],
    ]) {
      const t = new TrainingTarget(this.scene, mat, new Vector3(x, 0, z), -Math.PI / 2);
      for (const m of t.meshes) this.env.shadows.addShadowCaster(m, false);
      for (const m of t.colliderMeshes) this.colliders.addCollisionOnly(m);
      this.combat.addShootable(...t.meshes);
      this.targets.push(t);
    }
  }

  // ------------------------------------------------------------------ loop

  private placeCheck = 0;
  private lastPlace: string | null = null;

  private update(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 1 / 30);
    const waiting = this.updateCaptureGate(dt);
    this.chat.enabled = !this.paused && !waiting && this.mode !== this.lobby;
    if (!this.chat.enabled) this.chat.close();
    if (!this.paused && !waiting) {
      this.combat.time += dt;
      this.nav.newFrame();
      if (this.input.active && this.input.captured) this.camera.updateRotation();
      this.mode.update(dt);
      for (const t of this.targets) t.update(dt);
      this.effects.update(dt);
      const v = this.player.ctrl.velocity;
      const p = this.player.position;
      // Nome da área ao entrar nela (a pé ou no ar, nunca no lobby).
      this.placeCheck -= dt;
      if (this.placeCheck <= 0) {
        this.placeCheck = 0.5;
        const place = this.mode === this.lobby || !this.player.alive ? null : placeAt(p.x, p.z);
        if (place && place !== this.lastPlace) this.hud.showPlace(place);
        this.lastPlace = place;
      }
      this.hud.update(dt, this.playerWeapons, this.mode !== this.lobby && !!this.playerWeapons.current && this.player.ctrl.mode === 'normal' && this.player.alive, {
        fps: this.engine.getFps(),
        speed: Math.hypot(v.x, v.z),
        state: this.player.ctrl.state,
        x: p.x,
        y: p.y,
        z: p.z,
        extra: `Modo ${this.mode.kind} · vivos ${this.combat.alive.length}`,
      });
    }
    this.env.update(this.mode.focus(), this.camera.camera.position);
    const camPos = this.camera.camera.position;
    this.audio.setLoop('plane', this.paused ? 0 : this.drop.engineVolume(camPos));
    const pc = this.player.ctrl;
    this.audio.setLoop('wind', this.paused ? 0 : pc.mode === 'freefall' ? Math.min(1, -pc.velocity.y / 48) * 0.5 : pc.mode === 'parachute' ? 0.12 : 0);
    if (this.paused || this.mode === this.lobby) this.audio.setLoop('chest', 0);
    this.input.endFrame();
  }
}

/** Barra de carregamento da tela da logo (index.html). */
function progress(p: number, label?: string, next?: number): void {
  (window as unknown as { __qrProgress?: (p: number, label?: string, next?: number) => void }).__qrProgress?.(p, label, next);
}
