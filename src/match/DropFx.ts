import { Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { clamp } from '../utils/random';
import { landingRing, softDot, streak } from '../world/FxTextures';
import type { RiderPhase } from './DropSequence';

export interface DropPoi {
  name: string;
  pos: Vector3;
  color: string;
}

/**
 * Efeitos da entrada no mapa (só para o jogador, para não pesar com 30 participantes):
 *   - rastro de fumaça verde e amarela na queda livre (mais forte mergulhando);
 *   - traços de vento passando pela câmera, proporcionais à velocidade de queda;
 *   - marcador de pouso no chão, embaixo do personagem (cresce com a altura);
 *   - nuvem de poeira ao pousar;
 *   - placas dos pontos de interesse vistas do alto (somem perto do chão).
 */
export class DropFx {
  /** Posição do jogador (as partículas saem dela; cada uma fica no mundo depois de emitida). */
  private readonly anchor = new Vector3();
  private readonly trail: ParticleSystem;
  private readonly wind: ParticleSystem;
  private readonly dust: ParticleSystem;
  private readonly marker: Mesh;
  private readonly markerMat: StandardMaterial;
  private readonly labels: Mesh[] = [];
  private readonly labelMats: StandardMaterial[] = [];
  private t = 0;

  constructor(private readonly scene: Scene) {
    // Rastro: fumaça colorida saindo das costas.
    this.trail = new ParticleSystem('rastroQueda', 300, scene);
    this.trail.particleTexture = softDot(scene);
    this.trail.emitter = this.anchor;
    this.trail.minEmitBox = new Vector3(-0.15, 0.6, -0.15);
    this.trail.maxEmitBox = new Vector3(0.15, 1.2, 0.15);
    this.trail.color1 = new Color4(1, 0.82, 0.12, 0.75);
    this.trail.color2 = new Color4(0.07, 0.62, 0.3, 0.75);
    this.trail.colorDead = new Color4(1, 1, 1, 0);
    this.trail.minSize = 0.5;
    this.trail.maxSize = 1.1;
    this.trail.addSizeGradient(0, 0.5);
    this.trail.addSizeGradient(1, 2.4);
    this.trail.minLifeTime = 0.9;
    this.trail.maxLifeTime = 1.5;
    this.trail.direction1 = new Vector3(-0.3, 0.2, -0.3);
    this.trail.direction2 = new Vector3(0.3, 0.5, 0.3);
    this.trail.minEmitPower = 0.2;
    this.trail.maxEmitPower = 0.6;
    this.trail.emitRate = 0;
    this.trail.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Vento: traços finos que "sobem" (o personagem cai mais rápido do que eles).
    this.wind = new ParticleSystem('ventoQueda', 160, scene);
    this.wind.particleTexture = streak(scene);
    this.wind.emitter = this.anchor;
    this.wind.minEmitBox = new Vector3(-6, -10, -6);
    this.wind.maxEmitBox = new Vector3(6, -3, 6);
    this.wind.color1 = new Color4(1, 1, 1, 0.35);
    this.wind.color2 = new Color4(0.85, 0.92, 1, 0.22);
    this.wind.colorDead = new Color4(1, 1, 1, 0);
    this.wind.minSize = 0.05;
    this.wind.maxSize = 0.09;
    this.wind.minScaleY = 14;
    this.wind.maxScaleY = 26;
    this.wind.minLifeTime = 0.35;
    this.wind.maxLifeTime = 0.6;
    this.wind.direction1 = new Vector3(0, 1, 0);
    this.wind.direction2 = new Vector3(0, 1, 0);
    this.wind.minEmitPower = 2;
    this.wind.maxEmitPower = 4;
    this.wind.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    this.wind.emitRate = 0;
    this.wind.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Poeira do pouso.
    this.dust = new ParticleSystem('poeiraPouso', 80, scene);
    this.dust.particleTexture = softDot(scene);
    this.dust.emitter = this.anchor;
    this.dust.minEmitBox = new Vector3(-0.3, 0, -0.3);
    this.dust.maxEmitBox = new Vector3(0.3, 0.1, 0.3);
    this.dust.color1 = new Color4(0.78, 0.66, 0.5, 0.6);
    this.dust.color2 = new Color4(0.66, 0.56, 0.44, 0.5);
    this.dust.colorDead = new Color4(0.6, 0.5, 0.4, 0);
    this.dust.minSize = 0.4;
    this.dust.maxSize = 0.9;
    this.dust.addSizeGradient(0, 0.5);
    this.dust.addSizeGradient(1, 1.8);
    this.dust.minLifeTime = 0.6;
    this.dust.maxLifeTime = 1.2;
    this.dust.direction1 = new Vector3(-1, 0.2, -1);
    this.dust.direction2 = new Vector3(1, 0.6, 1);
    this.dust.minEmitPower = 1.5;
    this.dust.maxEmitPower = 3.5;
    this.dust.gravity = new Vector3(0, -1.5, 0);
    this.dust.emitRate = 0;
    this.dust.manualEmitCount = 0;
    this.dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Marcador de pouso.
    this.markerMat = new StandardMaterial('marcadorPouso', scene);
    this.markerMat.diffuseColor = Color3.Black();
    this.markerMat.specularColor = Color3.Black();
    this.markerMat.emissiveColor = Color3.FromHexString('#ffd21f');
    this.markerMat.opacityTexture = landingRing(scene);
    this.markerMat.disableLighting = true;
    this.markerMat.zOffset = -4;
    this.markerMat.backFaceCulling = false;
    this.marker = MeshBuilder.CreateGround('marcadorPouso', { width: 1, height: 1 }, scene);
    this.marker.material = this.markerMat;
    this.marker.isPickable = false;
    this.marker.setEnabled(false);
  }

  /** Placas dos pontos de interesse (montadas uma vez por partida). */
  setPois(pois: DropPoi[]): void {
    for (const l of this.labels) l.dispose();
    for (const m of this.labelMats) m.dispose(true, true);
    this.labels.length = 0;
    this.labelMats.length = 0;
    for (const p of pois) {
      const tex = new DynamicTexture(`poi_${p.name}`, { width: 512, height: 128 }, this.scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = 'rgba(16,14,24,0.72)';
      roundRect(ctx, 8, 18, 496, 92, 26);
      ctx.fill();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.font = '900 58px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name, 256, 66, 460);
      tex.update();
      tex.hasAlpha = true;
      const mat = new StandardMaterial(`poiMat_${p.name}`, this.scene);
      mat.diffuseTexture = tex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.emissiveColor = Color3.White();
      mat.disableLighting = true;
      mat.fogEnabled = false;
      const plane = MeshBuilder.CreatePlane(`poi_${p.name}`, { width: 22, height: 5.5 }, this.scene);
      plane.position.copyFrom(p.pos).addInPlaceFromFloats(0, 12, 0);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.material = mat;
      plane.isPickable = false;
      plane.setEnabled(false);
      this.labels.push(plane);
      this.labelMats.push(mat);
    }
  }

  /** Um quadro: fase e estado do jogador. `height` = altura acima do chão. */
  update(dt: number, phase: RiderPhase, pos: Vector3, vel: Vector3, height: number): void {
    this.t += dt;
    this.anchor.copyFrom(pos);
    const fall = Math.max(0, -vel.y);
    const ff = phase === 'freefall';
    const air = ff || phase === 'parachute';
    const speedK = clamp((fall - 12) / 36, 0, 1);

    this.trail.emitRate = ff ? 40 + speedK * 120 : 0;
    this.wind.emitRate = ff ? speedK * 140 : phase === 'parachute' ? 6 : 0;
    if (air && !this.trail.isStarted()) {
      this.trail.start();
      this.wind.start();
    }

    // Marcador: no chão embaixo do personagem; maior e mais forte lá do alto.
    const show = air && height > 3 && height < 400;
    this.marker.setEnabled(show);
    if (show) {
      const s = clamp(2 + height * 0.06, 2, 9);
      this.marker.position.set(pos.x, pos.y - height + 0.12, pos.z);
      this.marker.scaling.set(s, 1, s);
      this.marker.rotation.y = this.t * 0.8;
      this.markerMat.alpha = clamp(0.35 + height / 120, 0.35, 0.9) * (0.85 + Math.sin(this.t * 5) * 0.15);
    }

    // Placas: só no avião e no alto (somem abaixo de ~45 m).
    const labelAlpha = phase === 'plane' ? 1 : air ? clamp((height - 45) / 30, 0, 1) : 0;
    for (let i = 0; i < this.labels.length; i++) {
      this.labels[i].setEnabled(labelAlpha > 0.01);
      this.labelMats[i].alpha = labelAlpha;
    }
  }

  /** Pouso: nuvem de poeira em volta dos pés. */
  landed(pos: Vector3): void {
    this.anchor.copyFrom(pos);
    this.dust.manualEmitCount = 40;
    this.dust.start();
    this.marker.setEnabled(false);
  }

  /** Depois do pouso: para de emitir (as partículas que já saíram terminam a vida). */
  stopAir(): void {
    if (this.trail.isStarted()) {
      this.trail.stop();
      this.wind.stop();
    }
    this.marker.setEnabled(false);
    for (const l of this.labels) l.setEnabled(false);
  }

  /** Fim da partida / troca de modo. */
  stop(): void {
    this.trail.stop();
    this.wind.stop();
    this.trail.reset();
    this.wind.reset();
    this.marker.setEnabled(false);
    for (const l of this.labels) l.setEnabled(false);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
