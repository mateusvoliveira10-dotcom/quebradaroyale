import { Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
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
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      b.position.set(s.x + x, y, s.z + z);
      return add(b, mat);
    };
    // Prédio (tijolo aparente) e laje.
    box('lobbyPredio', 10, STAGE_H, 10, 0, STAGE_H / 2, 0, m.brick);
    box('lobbyLaje', 10.6, 0.25, 10.6, 0, STAGE_H + 0.02, 0, m.concrete);
    // Mureta só nas laterais: o fundo (para a comunidade) e a frente ficam livres.
    box('lobbyMuretaE', 0.2, 0.9, 10.2, -5.1, STAGE_H + 0.6, 0, m.muro);
    box('lobbyMuretaD', 0.2, 0.9, 10.2, 5.1, STAGE_H + 0.6, 0, m.muro);
    // Caixa d'água e antena nos cantos (emolduram o personagem sem tapar o fundo).
    const tank = MeshBuilder.CreateCylinder('lobbyCaixa', { diameterTop: 1.5, diameterBottom: 1.3, height: 1.2, tessellation: 24 }, scene);
    tank.position.set(s.x - 3.7, STAGE_H + 0.75, s.z + 3.6);
    add(tank, m.tank);
    const lid = MeshBuilder.CreateCylinder('lobbyTampa', { diameter: 1.6, height: 0.12, tessellation: 24 }, scene);
    lid.position.set(s.x - 3.7, STAGE_H + 1.4, s.z + 3.6);
    add(lid, m.tankLid);
    const mast = MeshBuilder.CreateCylinder('lobbyAntena', { diameter: 0.05, height: 2.4, tessellation: 6 }, scene);
    mast.position.set(s.x + 3.9, STAGE_H + 1.3, s.z + 3.9);
    add(mast, m.metal);
    const dish = MeshBuilder.CreateSphere('lobbyParabolica', { diameter: 0.9, slice: 0.45, segments: 12 }, scene);
    dish.position.set(s.x + 3.9, STAGE_H + 2.2, s.z + 3.9);
    dish.rotation.x = -Math.PI / 2.4;
    add(dish, m.white);

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
