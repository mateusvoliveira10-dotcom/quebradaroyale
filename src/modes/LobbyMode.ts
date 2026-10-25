import { Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, Vector4 } from '@babylonjs/core';
import { instantiateModel } from '../world/ModelInstance';
import { WorldAssets } from '../world/WorldAssets';
import type { Game } from '../core/Game';
import { LobbyScene } from '../world/builders/LobbyScene';
import { WORLD } from '../core/config';
import { MAP_FENCE } from '../player/CharacterController';
import { GameMode } from './GameMode';

/**
 * Palco do lobby: laje de um prédio alto na borda norte do mapa, de frente para a
 * comunidade. O sol vem do nordeste, então o personagem (virado para o norte, para a
 * câmera) e a comunidade ao fundo ficam bem iluminados; o fundo sai desfocado
 * (profundidade de campo), como a vitrine de personagem dos battle royales.
 */
const STAGE_H = 11;
export const LOBBY_SPOT = new Vector3(-8, STAGE_H + 0.12, WORLD.half + 13);

/** Entrada da câmera ao abrir o lobby (s). */
const INTRO = 2.6;

/**
 * Lobby 3D: o personagem do jogador (com a aparência salva) em pose idle no meio de
 * um "boteco de laje" vivo (LobbyScene): mesa de bar, churrasqueira, som, gambiarra,
 * bandeirinhas, varal e pipas (só o personagem do jogador; sem NPCs). A câmera entra num movimento de
 * aproximação e depois orbita devagar; as abas do menu mudam o enquadramento.
 */
export class LobbyMode implements GameMode {
  readonly kind = 'lobby' as const;
  restart = null;
  changeDifficulty = null;
  private readonly stage: Mesh[] = [];
  private readonly scenery: LobbyScene;
  private yaw = 0;
  private time = 0;
  private intro = 0;

  constructor(private readonly g: Game) {
    this.buildStage();
    this.scenery = new LobbyScene(g.scene, g.world.mats, g.env.glow, LOBBY_SPOT);
  }

  /** Prédio com laje (pódio, mureta, caixa d'água, antena, varal) — só visual, sem colisão. */
  private buildStage(): void {
    const scene = this.g.scene;
    const m = this.g.world.mats;
    const s = LOBBY_SPOT;
    const add = (mesh: Mesh, mat: StandardMaterial) => {
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      this.stage.push(mesh);
      return mesh;
    };
    // UV em metros (`tile` = tamanho de uma repetição): tijolo e concreto sem esticar.
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial, tile = 0) => {
      const faceUV = tile
        ? [w, w, d, d].map((u) => new Vector4(0, 0, u / tile, h / tile)).concat([new Vector4(0, 0, w / tile, d / tile), new Vector4(0, 0, w / tile, d / tile)])
        : undefined;
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d, faceUV }, scene);
      b.position.set(s.x + x, y, s.z + z);
      return add(b, mat);
    };
    // Prédio (tijolo aparente) e laje.
    const hq = m.hq;
    box('lobbyPredio', 10, STAGE_H, 10, 0, STAGE_H / 2, 0, hq.tijolo, 1.2);
    // Laje de concreto com a borda da viga aparente e um ralo.
    box('lobbyLaje', 10.6, 0.25, 10.6, 0, STAGE_H + 0.02, 0, hq.concreto, 2);
    box('lobbyViga', 10.7, 0.3, 10.7, 0, STAGE_H - 0.2, 0, hq.concretoEscuro, 2);
    const ralo = MeshBuilder.CreateDisc('lobbyRalo', { radius: 0.09, tessellation: 12 }, scene);
    ralo.rotation.x = Math.PI / 2;
    ralo.position.set(s.x + 2.2, STAGE_H + 0.151, s.z + 1.8);
    add(ralo, m.metalDark);
    // Mureta só nas laterais (reboco pintado com chapisco), com pingadeira de concreto.
    box('lobbyMuretaE', 0.2, 0.9, 10.2, -5.1, STAGE_H + 0.6, 0, hq.muro, 2.5);
    box('lobbyMuretaD', 0.2, 0.9, 10.2, 5.1, STAGE_H + 0.6, 0, hq.muro, 2.5);
    box('lobbyPingE', 0.28, 0.05, 10.3, -5.1, STAGE_H + 1.07, 0, hq.concreto, 2);
    box('lobbyPingD', 0.28, 0.05, 10.3, 5.1, STAGE_H + 1.07, 0, hq.concreto, 2);
    // Caixa d'água de fibra e antena (modelos do kit das casas), nos cantos.
    const kit = WorldAssets.current?.kit;
    const place = (name: string, x: number, z: number, ry: number, scale: number) => {
      const model = kit?.get(name);
      if (!model) return false;
      const n = new TransformNode(`${name}_lobby`, scene);
      n.position.set(s.x + x, STAGE_H + 0.15, s.z + z);
      n.rotation.y = ry;
      n.scaling.setAll(scale);
      for (const mesh of instantiateModel(model, (r) => hq.kitRole(r), n, name)) add(mesh, mesh.material as StandardMaterial);
      return true;
    };
    if (!place('Kit_Caixa', -3.7, 3.6, 0.4, 1.1)) {
      const tank = MeshBuilder.CreateCylinder('lobbyCaixa', { diameterTop: 1.5, diameterBottom: 1.3, height: 1.2, tessellation: 24 }, scene);
      tank.position.set(s.x - 3.7, STAGE_H + 0.75, s.z + 3.6);
      add(tank, m.tank);
    }
    if (!place('Kit_Antena', 3.9, 3.9, -0.6, 1.2)) {
      const mast = MeshBuilder.CreateCylinder('lobbyAntena', { diameter: 0.05, height: 2.4, tessellation: 6 }, scene);
      mast.position.set(s.x + 3.9, STAGE_H + 1.3, s.z + 3.9);
      add(mast, m.metal);
    }

    for (const mesh of this.stage) mesh.setEnabled(false);
  }

  enter(): void {
    const g = this.g;
    g.input.captureOnClick = false;
    g.input.unlockPointer();
    g.hud.show(false);
    g.overlays.hideAll();
    g.loot.clear();
    g.drop.end();
    g.releaseBots();
    g.combat.clear(g.player);
    g.playerWeapons.clear();
    g.playerWeapons.enabled = false;
    g.player.reset();
    // Fora da cerca do mapa (o palco fica além do muro norte): sem cerca no lobby.
    g.player.ctrl.fence = null;
    g.player.ctrl.spawnAt(LOBBY_SPOT.clone(), 0);
    g.player.ctrl.model.root.rotation.y = 0;
    for (const m of this.stage) m.setEnabled(true);
    this.scenery.setEnabled(true);
    g.menu.show(true);
    g.camera.snap();
    this.yaw = 0;
    this.intro = 0;
  }

  exit(): void {
    this.g.player.ctrl.fence = MAP_FENCE;
    for (const m of this.stage) m.setEnabled(false);
    this.scenery.setEnabled(false);
    this.g.env.setLobbyFocus(null);
    this.g.menu.show(false);
  }

  /** Gira o personagem (arrastar na aba Personalizar). */
  rotate(delta: number): void {
    this.yaw += delta;
  }

  focus(): Vector3 {
    return LOBBY_SPOT;
  }

  update(dt: number): void {
    const g = this.g;
    this.time += dt;
    const custom = g.menu.tab === 'custom';
    if (!custom) this.yaw += (0 - this.yaw) * Math.min(1, dt * 2);
    const model = g.player.ctrl.model;
    model.root.rotation.y = this.yaw;
    model.animateLobby(dt);
    this.scenery.update(dt);

    // Câmera ao norte do personagem, olhando para o sul (para a comunidade). Ao entrar,
    // vem de longe e de lado num arco suave (2,6 s); depois orbita devagar, "respirando".
    this.intro = Math.min(INTRO, this.intro + dt);
    const k = 1 - Math.pow(1 - this.intro / INTRO, 3);
    const cam = g.camera;
    const orbit = custom ? Math.sin(this.time * 0.15) * 0.05 : Math.sin(this.time * 0.11) * 0.2 + Math.sin(this.time * 0.27) * 0.04;
    cam.camera.alpha = Math.PI / 2 + orbit + (1 - k) * 0.85;
    cam.camera.beta = (custom ? 1.5 : 1.38 + Math.sin(this.time * 0.19) * 0.025) - (1 - k) * 0.28;
    const focus = LOBBY_SPOT.add(new Vector3(custom ? -0.75 : 0, 0, 0));
    const dist = (custom ? 3.0 : 5.3) + (1 - k) * 7;
    cam.updateFollow(dt, focus, {
      height: custom ? 1.2 : 1.05,
      aiming: false,
      sprinting: false,
      centered: true,
      noCollision: true,
      distanceOverride: dist,
      fovOverride: 0.7,
    });
    g.env.setLobbyFocus(dist);
  }
}
