import {
  Color3,
  Color4,
  DynamicTexture,
  GlowLayer,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

interface Tracer {
  mesh: Mesh;
  life: number;
}

/**
 * Efeitos de tiro com pool de objetos: clarão na boca do cano (com luz),
 * traçantes, faíscas/poeira no impacto e marcas de bala nas superfícies.
 */
export class WeaponEffects {
  private readonly flash: Mesh;
  private readonly flashLight: PointLight;
  private flashLife = 0;
  private readonly tracers: Tracer[] = [];
  private tracerIndex = 0;
  private readonly sparks: ParticleSystem[] = [];
  private readonly dust: ParticleSystem[] = [];
  private psIndex = 0;
  private readonly decals: Mesh[] = [];
  private decalIndex = 0;

  constructor(
    private readonly scene: Scene,
    glow: GlowLayer,
  ) {
    const flashTex = this.radialTexture('muzzleTex', [
      [0, 'rgba(255,255,240,1)'],
      [0.25, 'rgba(255,220,120,0.95)'],
      [0.6, 'rgba(255,140,40,0.35)'],
      [1, 'rgba(255,100,20,0)'],
    ]);
    const flashMat = new StandardMaterial('muzzleMat', scene);
    flashMat.emissiveTexture = flashTex;
    flashMat.opacityTexture = flashTex;
    flashMat.diffuseColor = Color3.Black();
    flashMat.specularColor = Color3.Black();
    flashMat.disableLighting = true;
    flashMat.backFaceCulling = false;
    flashMat.alphaMode = 1; // ALPHA_ADD

    const p1 = MeshBuilder.CreatePlane('flashA', { width: 0.5, height: 0.5 }, scene);
    const p2 = MeshBuilder.CreatePlane('flashB', { width: 0.5, height: 0.5 }, scene);
    p2.rotation.y = Math.PI / 2;
    const p3 = MeshBuilder.CreatePlane('flashC', { width: 0.3, height: 0.3 }, scene);
    p3.rotation.x = Math.PI / 2;
    this.flash = Mesh.MergeMeshes([p1, p2, p3], true) as Mesh;
    this.flash.material = flashMat;
    this.flash.isPickable = false;
    this.flash.setEnabled(false);
    glow.addIncludedOnlyMesh(this.flash);

    this.flashLight = new PointLight('muzzleLight', Vector3.Zero(), scene);
    this.flashLight.diffuse = Color3.FromHexString('#ffc070');
    this.flashLight.specular = Color3.FromHexString('#ffc070');
    this.flashLight.range = 9;
    this.flashLight.intensity = 0;

    // Traçantes.
    const tracerMat = new StandardMaterial('tracerMat', scene);
    tracerMat.emissiveColor = Color3.FromHexString('#ffe9a8');
    tracerMat.diffuseColor = Color3.Black();
    tracerMat.disableLighting = true;
    tracerMat.alpha = 0.85;
    for (let i = 0; i < 24; i++) {
      const t = MeshBuilder.CreateCylinder('tracer', { diameter: 0.025, height: 1, tessellation: 5 }, scene);
      t.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2).multiply(Matrix.Translation(0, 0, 0.5)));
      t.material = tracerMat;
      t.isPickable = false;
      t.setEnabled(false);
      glow.addIncludedOnlyMesh(t);
      this.tracers.push({ mesh: t, life: 0 });
    }

    // Partículas de impacto.
    const sparkTex = this.radialTexture('sparkTex', [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    for (let i = 0; i < 6; i++) {
      const s = new ParticleSystem('sparks', 120, scene);
      s.particleTexture = sparkTex;
      s.emitter = Vector3.Zero();
      s.minEmitBox = Vector3.Zero();
      s.maxEmitBox = Vector3.Zero();
      s.color1 = new Color4(1, 0.9, 0.5, 1);
      s.color2 = new Color4(1, 0.6, 0.2, 1);
      s.colorDead = new Color4(0.3, 0.1, 0, 0);
      s.minSize = 0.025;
      s.maxSize = 0.07;
      s.minLifeTime = 0.08;
      s.maxLifeTime = 0.28;
      s.minEmitPower = 2;
      s.maxEmitPower = 6;
      s.emitRate = 0;
      s.gravity = new Vector3(0, -12, 0);
      s.blendMode = ParticleSystem.BLENDMODE_ADD;
      s.start();
      this.sparks.push(s);

      const d = new ParticleSystem('dust', 80, scene);
      d.particleTexture = sparkTex;
      d.emitter = Vector3.Zero();
      d.minEmitBox = Vector3.Zero();
      d.maxEmitBox = Vector3.Zero();
      d.color1 = new Color4(0.75, 0.68, 0.58, 0.55);
      d.color2 = new Color4(0.6, 0.55, 0.48, 0.45);
      d.colorDead = new Color4(0.6, 0.55, 0.5, 0);
      d.minSize = 0.12;
      d.maxSize = 0.35;
      d.minLifeTime = 0.3;
      d.maxLifeTime = 0.7;
      d.minEmitPower = 0.4;
      d.maxEmitPower = 1.4;
      d.emitRate = 0;
      d.gravity = new Vector3(0, -0.6, 0);
      d.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      d.start();
      this.dust.push(d);
    }

    // Marcas de bala.
    const holeTex = this.radialTexture('holeTex', [
      [0, 'rgba(10,8,6,0.95)'],
      [0.35, 'rgba(25,20,15,0.8)'],
      [0.6, 'rgba(40,32,25,0.3)'],
      [1, 'rgba(40,32,25,0)'],
    ]);
    const holeMat = new StandardMaterial('holeMat', scene);
    holeMat.diffuseTexture = holeTex;
    holeMat.useAlphaFromDiffuseTexture = true;
    holeMat.diffuseTexture.hasAlpha = true;
    holeMat.specularColor = Color3.Black();
    holeMat.zOffset = -3;
    holeMat.backFaceCulling = false;
    for (let i = 0; i < 90; i++) {
      const dmesh = MeshBuilder.CreatePlane('bulletHole', { size: 0.14 }, scene);
      dmesh.material = holeMat;
      dmesh.isPickable = false;
      dmesh.setEnabled(false);
      this.decals.push(dmesh);
    }
  }

  private radialTexture(name: string, stops: Array<[number, string]>): DynamicTexture {
    const tex = new DynamicTexture(name, { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    return tex;
  }

  muzzleFlash(pos: Vector3, dir: Vector3, big: boolean): void {
    this.flash.setEnabled(true);
    this.flash.position.copyFrom(pos);
    this.flash.lookAt(pos.add(dir));
    this.flash.rotate(new Vector3(0, 0, 1), Math.random() * Math.PI);
    const s = (big ? 1.5 : 1) * (0.8 + Math.random() * 0.4);
    this.flash.scaling.setAll(s);
    this.flashLife = 0.05;
    this.flashLight.position.copyFrom(pos);
    this.flashLight.intensity = big ? 3.5 : 2.2;
  }

  tracer(from: Vector3, to: Vector3): void {
    const t = this.tracers[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length;
    const len = Vector3.Distance(from, to);
    if (len < 0.5) return;
    t.mesh.setEnabled(true);
    t.mesh.position.copyFrom(from);
    t.mesh.lookAt(to);
    t.mesh.scaling.set(1, 1, len);
    t.mesh.visibility = 1;
    t.life = 0.07;
  }

  impact(point: Vector3, normal: Vector3, metal: boolean): void {
    const i = this.psIndex;
    this.psIndex = (this.psIndex + 1) % this.sparks.length;
    const n = normal.normalize();
    const spark = this.sparks[i];
    spark.emitter = point.add(n.scale(0.03));
    spark.direction1 = n.add(new Vector3(-0.6, -0.2, -0.6));
    spark.direction2 = n.add(new Vector3(0.6, 0.8, 0.6));
    spark.manualEmitCount = metal ? 14 : 7;
    const dust = this.dust[i];
    dust.emitter = point.add(n.scale(0.05));
    dust.direction1 = n.add(new Vector3(-0.3, 0, -0.3));
    dust.direction2 = n.add(new Vector3(0.3, 0.5, 0.3));
    dust.manualEmitCount = metal ? 2 : 6;

    const dmesh = this.decals[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % this.decals.length;
    dmesh.setEnabled(true);
    dmesh.position.copyFrom(point.add(n.scale(0.012)));
    dmesh.lookAt(point.subtract(n));
    dmesh.rotate(new Vector3(0, 0, 1), Math.random() * Math.PI);
    dmesh.scaling.setAll(0.7 + Math.random() * 0.6);
  }

  update(dt: number): void {
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashLight.intensity *= 0.6;
      if (this.flashLife <= 0) {
        this.flash.setEnabled(false);
        this.flashLight.intensity = 0;
      }
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.visibility = Math.max(0, t.life / 0.07);
      if (t.life <= 0) t.mesh.setEnabled(false);
    }
  }
}
