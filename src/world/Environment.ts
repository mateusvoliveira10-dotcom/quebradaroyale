import {
  Camera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  DirectionalLight,
  DynamicTexture,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

const SKY_TOP = '#1d6fe0';
const SKY_MID = '#4aa6f2';
const SKY_HORIZON = '#bfe3fa';

/**
 * Céu em degradê com sol, luz de fim de tarde com sombras que acompanham o
 * jogador, névoa de profundidade e pós-processamento (tone mapping ACES,
 * bloom suave, FXAA, nitidez e vinheta) para um visual cartoon "premium".
 */
export class Environment {
  readonly sun: DirectionalLight;
  readonly shadows: ShadowGenerator;
  readonly glow: GlowLayer;
  private pipeline: DefaultRenderingPipeline | null = null;
  private readonly sunDisc: Mesh;

  private readonly sunDir = new Vector3(-0.55, -0.72, -0.42).normalize();

  constructor(private readonly scene: Scene) {
    const horizon = Color3.FromHexString(SKY_HORIZON);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    scene.ambientColor = new Color3(0.25, 0.25, 0.28);

    // Névoa de mormaço da cidade: mesma cor do horizonte, um pouco mais densa ao longe
    // (dá profundidade aos morros e recorta a estátua contra o céu).
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0019;
    scene.fogColor = Color3.FromHexString('#bcdcf2');

    // Céu azulado por cima e luz rebatida quente da terra e do tijolo por baixo.
    const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, 0.1), scene);
    hemi.intensity = 0.56;
    hemi.diffuse = Color3.FromHexString('#d3e4fb');
    hemi.groundColor = Color3.FromHexString('#8c6a52');
    hemi.specular = new Color3(0.16, 0.16, 0.16);

    this.sun = new DirectionalLight('sun', this.sunDir.clone(), scene);
    this.sun.intensity = 1.72;
    this.sun.diffuse = Color3.FromHexString('#ffe7c6');
    this.sun.specular = Color3.FromHexString('#fff0d8');
    this.sun.autoUpdateExtends = false;
    this.sun.autoCalcShadowZBounds = false;
    this.sun.shadowFrustumSize = 80;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 320;

    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0015;
    this.shadows.normalBias = 0.025;
    this.shadows.darkness = 0.25;
    this.shadows.transparencyShadow = false;
    // Mapa de sombra refeito a cada 2 quadros: metade do custo (~3 ms por quadro na rua) e
    // a diferença não aparece (o sol e o cenário não se mexem; só os personagens).
    this.shadows.getShadowMap()!.refreshRate = 2;
    this.cullShadowCasters();

    this.glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 32 });
    this.glow.intensity = 0.9;

    this.createSkyDome();
    this.sunDisc = this.createSunDisc();
    // Garante que só malhas registradas explicitamente brilhem.
    this.glow.addIncludedOnlyMesh(this.sunDisc);
  }

  /** Pós-processamento ligado à câmera ativa. */
  setupPostProcess(camera: Camera): void {
    const p = new DefaultRenderingPipeline('pipeline', true, this.scene, [camera]);
    p.samples = 4;
    p.fxaaEnabled = true;
    p.bloomEnabled = true;
    p.bloomThreshold = 0.82;
    p.bloomWeight = 0.28;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = 0.25;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    // Cartoon bem-feito (estilo Fortnite): claro, contrastado e saturado em todo o mapa.
    ip.exposure = 1.22;
    ip.contrast = 1.18;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.3;
    ip.vignetteColor = new Color4(0.1, 0.06, 0.08, 0);
    ip.colorCurvesEnabled = true;
    if (ip.colorCurves) {
      ip.colorCurves.globalSaturation = 28;
      ip.colorCurves.shadowsHue = 230;
      ip.colorCurves.shadowsDensity = 12;
      ip.colorCurves.highlightsHue = 40;
      ip.colorCurves.highlightsDensity = 8;
    }
    this.pipeline = p;
  }

  /** Ajusta custo gráfico (Configurações). */
  setQuality(q: 'alta' | 'media' | 'baixa'): void {
    const p = this.pipeline;
    if (p) {
      p.bloomEnabled = q !== 'baixa';
      p.samples = q === 'alta' ? 4 : q === 'media' ? 2 : 1;
      p.sharpenEnabled = q === 'alta';
    }
    this.sun.shadowEnabled = q !== 'baixa';
    this.glow.isEnabled = q !== 'baixa';
  }

  get postProcess(): DefaultRenderingPipeline | null {
    return this.pipeline;
  }

  /**
   * Profundidade de campo do lobby: personagem nítido e a comunidade ao fundo desfocada
   * (como a vitrine de personagem dos battle royales). Desligada nas partidas.
   */
  private baseFog: number | null = null;

  setLobbyFocus(distance: number | null): void {
    // Névoa mais fraca no lobby: a comunidade ao fundo aparece (desfocada) em vez de sumir.
    if (this.baseFog === null) this.baseFog = this.scene.fogDensity;
    this.scene.fogDensity = distance !== null ? 0.0016 : this.baseFog;
    const p = this.pipeline;
    if (!p) return;
    p.depthOfFieldEnabled = distance !== null;
    if (distance === null) {
      // O desfoque liga um renderizador de profundidade que desenha a cena inteira de novo a
      // cada quadro (~900 draw calls a mais) e não é desligado junto: na partida ele sobrava.
      for (const cam of p.cameras) this.scene.disableDepthRenderer(cam);
      return;
    }
    p.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Medium;
    // unidades em milímetros
    p.depthOfField.focusDistance = distance * 1000;
    p.depthOfField.focalLength = 85;
    p.depthOfField.fStop = 1.6;
  }

  /**
   * O mapa de sombra do Babylon não recorta pelo volume da luz: desenhava todos os lotes
   * que projetam sombra (~1.000 draw calls por quadro, inclusive do outro lado do mapa).
   * Aqui só entram os que cruzam a coluna de sombra em volta do jogador (distância medida
   * no plano perpendicular ao sol, com o raio da malha). Personagens e peças que se mexem
   * entram sempre (são poucos).
   */
  private cullShadowCasters(): void {
    const sm = this.shadows.getShadowMap();
    if (!sm) return;
    const out: Mesh[] = [];
    const focus = new Vector3();
    const v = new Vector3();
    const d = this.sunDir;
    // Metade da diagonal do quadrado de sombra (frustum ortográfico de 80 m) com folga.
    const reach = (this.sun.shadowFrustumSize / 2) * 1.45;
    sm.getCustomRenderList = (_pass, list, len) => {
      if (!list) return list;
      focus.copyFrom(this.sun.position).addInPlace(d.scale(150));
      out.length = 0;
      for (let i = 0; i < len; i++) {
        const m = list[i] as Mesh;
        if (!m.isWorldMatrixFrozen) {
          out.push(m);
          continue;
        }
        const s = m.getBoundingInfo().boundingSphere;
        s.centerWorld.subtractToRef(focus, v);
        const along = Vector3.Dot(v, d);
        const lx = v.x - d.x * along;
        const ly = v.y - d.y * along;
        const lz = v.z - d.z * along;
        if (Math.sqrt(lx * lx + ly * ly + lz * lz) - s.radiusWorld < reach) out.push(m);
      }
      return out as never;
    };
  }

  /** Mantém o volume de sombra centrado no jogador e o sol na direção certa. */
  update(focus: Vector3, cameraPos: Vector3): void {
    this.sun.position.copyFrom(focus).subtractInPlace(this.sunDir.scale(150));
    this.sunDisc.position.copyFrom(cameraPos).subtractInPlace(this.sunDir.scale(700));
  }

  private createSkyDome(): void {
    const tex = new DynamicTexture('skyGradient', { width: 4, height: 512 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(0.36, SKY_MID);
    grad.addColorStop(0.46, '#a9d3f2');
    grad.addColorStop(0.5, SKY_HORIZON);
    grad.addColorStop(1, '#cfdde3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 512);
    tex.update();

    const mat = new StandardMaterial('skyMat', this.scene);
    mat.emissiveTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;

    const dome = MeshBuilder.CreateSphere('skyDome', { diameter: 1800, segments: 24 }, this.scene);
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
  }

  private createSunDisc(): Mesh {
    const tex = new DynamicTexture('sunTex', { width: 256, height: 256 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,252,235,1)');
    g.addColorStop(0.22, 'rgba(255,245,200,1)');
    g.addColorStop(0.3, 'rgba(255,220,150,0.45)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    tex.update();
    tex.hasAlpha = true;

    const mat = new StandardMaterial('sunMat', this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    mat.disableDepthWrite = true;

    const disc = MeshBuilder.CreatePlane('sunDisc', { size: 110 }, this.scene);
    disc.material = mat;
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.isPickable = false;
    disc.applyFog = false;
    return disc;
  }
}
