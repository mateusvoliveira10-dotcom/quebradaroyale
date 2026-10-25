import {
  Color3,
  Color4,
  DynamicTexture,
  GlowLayer,
  Material,
  Mesh,
  Node,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  Vector4,
} from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { softDot } from '../FxTextures';
import type { Materials } from '../Materials';
import { instantiateModel } from '../ModelInstance';
import { WorldAssets } from '../WorldAssets';

type Ctx2D = CanvasRenderingContext2D;

/**
 * Cenário vivo do lobby: o "boteco de laje" onde o personagem espera a partida.
 *
 * Tudo é relativo ao ponto do personagem (`spot`, pés dele) na laje, com a câmera ao
 * norte (+Z) olhando para o sul, para a comunidade. O que aparece no quadro fica atrás
 * e dos lados do personagem: mesa quadrada vermelha com cadeiras dobráveis, guarda-sol,
 * engradados e isopor, churrasqueira de tijolo soltando fumaça, caixa de som pulsando,
 * gambiarra de lâmpadas, bandeirinhas, varal, muro grafitado e, no céu sobre o morro,
 * pipas e pássaros. Nada colide (é só cenário) e tudo fica desligado fora do lobby.
 */
export class LobbyScene {
  readonly meshes: Mesh[] = [];
  private readonly particles: ParticleSystem[] = [];
  private readonly anims: Array<(t: number, dt: number) => void> = [];
  private readonly root: TransformNode;
  private readonly mats = new Map<string, StandardMaterial>();
  /** Nós animados: o que estiver embaixo deles não entra na junção de malhas. */
  private readonly dynamic = new Set<Node>();
  private readonly glowing = new Set<Mesh>();
  /** Malhas paradas já juntadas por material (fora da raiz, ligadas/desligadas à parte). */
  private readonly statics: Mesh[] = [];
  private readonly rng = new Rng(2025);
  private t = 0;

  constructor(
    private readonly scene: Scene,
    private readonly m: Materials,
    private readonly glow: GlowLayer,
    spot: Vector3,
  ) {
    this.root = new TransformNode('lobbyScene', scene);
    this.root.position.copyFrom(spot);
    // Espelhado em X: com a câmera olhando para o sul, o boteco (mesa, guarda-sol, grafite)
    // fica do lado esquerdo da tela, livre do cartão de modo e do botão JOGAR.
    this.root.scaling.x = -1;
    this.buildBoteco();
    this.buildChurrasqueira();
    this.buildSom();
    this.buildGambiarra();
    this.buildBandeirinhas();
    this.buildVaral();
    this.buildMuroGrafitado();
    this.buildPlantas();
    this.buildPipas();
    this.buildPassaros();
    this.buildPoeira();
    this.freeze();
    this.setEnabled(false);
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
    for (const m of this.statics) m.setEnabled(on);
    for (const p of this.particles) {
      if (on) p.start();
      else p.stop();
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const a of this.anims) a(this.t, dt);
  }

  // ------------------------------------------------------------ utilidades

  private glowMesh(mesh: Mesh): void {
    this.glowing.add(mesh);
    this.glow.addIncludedOnlyMesh(mesh);
  }

  private isDynamic(n: Node): boolean {
    for (let p: Node | null = n; p && p !== this.root; p = p.parent) if (this.dynamic.has(p)) return true;
    return false;
  }

  /**
   * Junta as peças paradas por material (centenas de caixinhas viram ~30 malhas). A raiz é
   * espelhada: a junção já grava a transformação final nos vértices.
   */
  private freeze(): void {
    this.root.computeWorldMatrix(true);
    const groups = new Map<Material, Mesh[]>();
    for (const m of this.meshes) {
      if (this.isDynamic(m) || !m.material) continue;
      let list = groups.get(m.material);
      if (!list) groups.set(m.material, (list = []));
      list.push(m);
    }
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const glows = list.some((m) => this.glowing.has(m));
      for (const m of list) {
        m.computeWorldMatrix(true);
        if (this.glowing.has(m)) this.glow.removeIncludedOnlyMesh(m);
      }
      // Primeira malha com geometria própria (ver StaticBatcher.build: senão a base do modelo cresce).
      if (list[0].geometry && list[0].geometry.meshes.length > 1) list[0].makeGeometryUnique();
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `lobby_${mat.name}`;
      merged.material = mat;
      merged.isPickable = false;
      merged.receiveShadows = true;
      if (glows) this.glow.addIncludedOnlyMesh(merged);
      this.statics.push(merged);
    }
  }

  private mat(name: string, hex: string, o: { spec?: number; power?: number; emissive?: number; tex?: Texture; bump?: Texture; twoSided?: boolean; alpha?: boolean } = {}): StandardMaterial {
    const key = `${name}`;
    let mt = this.mats.get(key);
    if (mt) return mt;
    mt = new StandardMaterial(`lobby_${name}`, this.scene);
    const c = Color3.FromHexString(hex);
    mt.diffuseColor = c;
    mt.specularColor = new Color3(1, 1, 1).scale(o.spec ?? 0.1);
    mt.specularPower = o.power ?? 32;
    mt.emissiveColor = c.scale(o.emissive ?? 0.08);
    if (o.tex) mt.diffuseTexture = o.tex;
    if (o.bump) mt.bumpTexture = o.bump;
    if (o.alpha && o.tex) {
      o.tex.hasAlpha = true;
      mt.useAlphaFromDiffuseTexture = true;
    }
    if (o.twoSided) mt.backFaceCulling = false;
    this.mats.set(key, mt);
    return mt;
  }

  /** Textura desenhada no canvas (repetível), criada uma vez por nome. */
  private readonly texs = new Map<string, DynamicTexture>();
  private tex(name: string, size: number, draw: (ctx: Ctx2D, s: number) => void, repeat = 1): DynamicTexture {
    let t = this.texs.get(name);
    if (t) return t;
    t = new DynamicTexture(`lobbyTex_${name}`, { width: size, height: size }, this.scene, true);
    const ctx = t.getContext() as unknown as Ctx2D;
    draw(ctx, size);
    t.update();
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.uScale = t.vScale = repeat;
    t.anisotropicFilteringLevel = 8;
    this.texs.set(name, t);
    return t;
  }

  /** Plástico injetado: cor com leve granulado, marcas de molde e riscos de uso. */
  private plastic(name: string, hex: string): StandardMaterial {
    const tex = this.tex(`plastico_${name}`, 256, (ctx, s) => {
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = this.rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), 1.5, 1.5);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 26; i++) {
        const x = this.rng.range(0, s);
        const y = this.rng.range(0, s);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + this.rng.range(-30, 30), y + this.rng.range(-6, 6));
        ctx.stroke();
      }
      // Sujeira acumulada nas bordas do molde.
      const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(40,25,10,0.18)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, 2);
    return this.mat(`plastico_${name}`, '#ffffff', { tex, spec: 0.45, power: 60, emissive: 0.04 });
  }

  /** Relevo genérico (granulado) para tecidos, isopor e reboco. */
  private grain(name: string, scale: number, strength: number): Texture {
    return this.tex(`relevo_${name}`, 128, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      for (let i = 0; i < s * s; i++) {
        const n = (this.rng.next() - 0.5) * strength;
        img.data[i * 4] = 128 + n * 127;
        img.data[i * 4 + 1] = 128 - n * 60;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, scale);
  }

  /** Material de um papel dos modelos de lobby.glb. */
  private role(role: string, variant = ''): StandardMaterial | null {
    switch (role) {
      case 'plastic':
        return this.plastic('vermelho', '#c41f18');
      case 'crate':
        return variant === 'red' ? this.plastic('engradadoVermelho', '#b8211a') : this.plastic('engradadoAmarelo', '#e8b81a');
      case 'bottle':
        return this.mat('vidroAmbar', '#4a2008', { spec: 1.2, power: 120, emissive: 0.1 });
      case 'cap':
        return this.mat('tampinha', '#c9a646', { spec: 1.0, power: 90, emissive: 0.08 });
      case 'shadow':
        return this.mat('vao', '#0c0b0a', { spec: 0 });
      case 'foam': {
        // Isopor: bolinhas de EPS prensadas.
        const tex = this.tex('isopor', 256, (ctx, s) => {
          ctx.fillStyle = '#efede6';
          ctx.fillRect(0, 0, s, s);
          for (let i = 0; i < 900; i++) {
            const x = this.rng.range(0, s);
            const y = this.rng.range(0, s);
            const r = this.rng.range(3, 6);
            ctx.strokeStyle = 'rgba(150,145,130,0.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
          }
          for (let i = 0; i < 10; i++) {
            ctx.fillStyle = 'rgba(120,100,70,0.08)';
            ctx.beginPath();
            ctx.arc(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(15, 40), 0, Math.PI * 2);
            ctx.fill();
          }
        }, 3);
        return this.mat('isopor', '#ffffff', { tex, spec: 0.05, emissive: 0.1, bump: this.grain('isopor', 6, 0.6) });
      }
      case 'lid':
        return this.plastic('tampaAzul', '#2b63c4');
      case 'rope':
        return this.mat('corda', '#cfc4a0', { spec: 0.02, bump: this.grain('corda', 20, 0.8) });
      case 'case': {
        const tex = this.tex('vinilCaixa', 256, (ctx, s) => {
          ctx.fillStyle = '#16161a';
          ctx.fillRect(0, 0, s, s);
          for (let i = 0; i < 5000; i++) {
            ctx.fillStyle = this.rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.3)';
            ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), 2, 2);
          }
        }, 3);
        return this.mat('vinilCaixa', '#ffffff', { tex, spec: 0.25, power: 30, emissive: 0.02, bump: this.grain('vinil', 8, 0.7) });
      }
      case 'grille': {
        const tex = this.tex('telaSom', 256, (ctx, s) => {
          ctx.fillStyle = '#2a2a2e';
          ctx.fillRect(0, 0, s, s);
          ctx.fillStyle = '#0a0a0c';
          for (let y = 4; y < s; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < s; x += 8) {
            ctx.beginPath();
            ctx.arc(x, y, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }, 6);
        return this.mat('telaSom', '#ffffff', { tex, spec: 0.6, power: 50, emissive: 0.03 });
      }
      case 'panel':
        return this.mat('painelSom', '#1b1b1f', { spec: 0.4 });
      case 'metal':
        return this.m.metal;
      default:
        return this.plastic('vermelho', '#c41f18');
    }
  }

  /** Peça de lobby.glb presa a um nó (posição/giro). false = modelo não carregado. */
  private model(name: string, parent: TransformNode, x: number, y: number, z: number, ry: number, variant = '', scale = 1): boolean {
    const model = WorldAssets.current?.props.get(name);
    if (!model) return false;
    const n = new TransformNode(`${name}_no`, this.scene);
    n.parent = parent;
    n.position.set(x, y, z);
    n.rotation.y = ry;
    n.scaling.setAll(scale);
    for (const m of instantiateModel(model, (r) => this.role(r, variant), n, name)) this.meshes.push(m);
    return true;
  }

  private add<T extends Mesh>(mesh: T, mat: StandardMaterial, parent: TransformNode = this.root): T {
    mesh.material = mat;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    return mesh;
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial, parent?: TransformNode, tile?: number): Mesh {
    const faceUV = tile
      ? [
          new Vector4(0, 0, w / tile, h / tile),
          new Vector4(0, 0, w / tile, h / tile),
          new Vector4(0, 0, d / tile, h / tile),
          new Vector4(0, 0, d / tile, h / tile),
          new Vector4(0, 0, w / tile, d / tile),
          new Vector4(0, 0, w / tile, d / tile),
        ]
      : undefined;
    const b = MeshBuilder.CreateBox('lobbyBox', { width: w, height: h, depth: d, faceUV }, this.scene);
    b.position.set(x, y + h / 2, z);
    return this.add(b, mat, parent);
  }

  private node(name: string, x: number, y: number, z: number, ry = 0): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = this.root;
    n.position.set(x, y, z);
    n.rotation.y = ry;
    return n;
  }

  // ------------------------------------------------------------ boteco

  /** Mesa quadrada vermelha de bar, quatro cadeiras dobráveis, guarda-sol, engradados e isopor. */
  private buildBoteco(): void {
    const red = this.mat('plasticoVermelho', '#d42a22', { spec: 0.35 });
    const table = this.node('mesaBar', -2.5, 0, -2.4, 0.2);
    // Mesa de plástico de bar (modelo do Blender); sem o modelo, a versão de caixas.
    const modeled = this.model('MesaBar', table, 0, 0, 0, 0);
    if (!modeled) {
      this.box(0.8, 0.04, 0.8, 0, 0.7, 0, red, table);
      for (const [lx, lz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) this.box(0.045, 0.68, 0.045, lx, 0, lz, red, table);
    }
    // Garrafas e copos americanos em cima.
    const glass = this.mat('vidroGarrafa', '#5a2e10', { spec: 0.9, emissive: 0.12 });
    const copo = this.mat('copo', '#e8d27a', { spec: 0.8, emissive: 0.2 });
    for (const [x, z] of [[-0.15, 0.1], [0.12, -0.12]]) {
      const b = MeshBuilder.CreateCylinder('garrafa', { diameter: 0.075, height: 0.24, tessellation: 10 }, this.scene);
      b.position.set(x, 0.86 + 0.02, z);
      this.add(b, glass, table);
      const n = MeshBuilder.CreateCylinder('gargalo', { diameterTop: 0.025, diameterBottom: 0.06, height: 0.09, tessellation: 8 }, this.scene);
      n.position.set(x, 1.04, z);
      this.add(n, glass, table);
    }
    for (const [x, z] of [[0.2, 0.18], [-0.22, -0.2], [0.05, 0.24]]) {
      const c = MeshBuilder.CreateCylinder('copo', { diameterTop: 0.07, diameterBottom: 0.055, height: 0.09, tessellation: 10 }, this.scene);
      c.position.set(x, 0.79, z);
      this.add(c, copo, table);
    }
    // Cadeiras dobráveis vermelhas em volta (uma afastada, como se alguém tivesse levantado).
    const chairs: Array<[number, number, number]> = [[0, -0.72, 0], [0.75, 0, -Math.PI / 2], [0, 0.78, Math.PI], [-0.95, 0.15, Math.PI / 2 + 0.4]];
    // O modelo da cadeira tem a frente para -Z: meia-volta para encarar a mesa.
    for (const [x, z, ry] of chairs) if (!this.model('CadeiraBar', table, x, 0, z, ry + Math.PI)) this.foldingChair(table, x, z, ry, red);

    // Guarda-sol de bar listrado, balançando de leve com o vento.
    const umbrella = this.node('guardaSol', -2.5, 0, -2.4);
    this.dynamic.add(umbrella);
    const pole = this.mat('mastro', '#d9d4c7', { spec: 0.4 });
    const p = MeshBuilder.CreateCylinder('mastro', { diameter: 0.04, height: 2.25, tessellation: 8 }, this.scene);
    p.position.y = 1.12;
    this.add(p, pole, umbrella);
    const stripes = new DynamicTexture('guardaSolTex', { width: 512, height: 32 }, this.scene, false);
    const sctx = stripes.getContext() as unknown as CanvasRenderingContext2D;
    for (let i = 0; i < 8; i++) {
      sctx.fillStyle = i % 2 === 0 ? '#d42a22' : '#f4efe2';
      sctx.fillRect(i * 64, 0, 64, 32);
    }
    stripes.update();
    const canopy = MeshBuilder.CreateCylinder('lona', { diameterTop: 0.08, diameterBottom: 2.5, height: 0.55, tessellation: 16 }, this.scene);
    // Varetas por baixo da lona e ponteira no alto.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rib = MeshBuilder.CreateTube('vareta', { path: [new Vector3(0, 2.3, 0), new Vector3(Math.cos(a) * 1.22, 1.79, Math.sin(a) * 1.22)], radius: 0.008, tessellation: 4 }, this.scene);
      this.add(rib, pole, umbrella);
    }
    const tip = MeshBuilder.CreateSphere('ponteira', { diameter: 0.07, segments: 6 }, this.scene);
    tip.position.y = 2.36;
    this.add(tip, pole, umbrella);
    canopy.position.y = 2.05;
    this.add(canopy, this.mat('lonaGuardaSol', '#ffffff', { tex: stripes, twoSided: true, emissive: 0.12 }), umbrella);
    const fringe = MeshBuilder.CreateCylinder('franja', { diameter: 2.52, height: 0.12, tessellation: 16, cap: Mesh.NO_CAP }, this.scene);
    fringe.position.y = 1.72;
    this.add(fringe, this.mat('franja', '#d42a22', { twoSided: true }), umbrella);
    this.anims.push((t) => {
      umbrella.rotation.x = Math.sin(t * 0.9) * 0.025;
      umbrella.rotation.z = Math.sin(t * 0.7 + 1) * 0.03;
      fringe.scaling.y = 1 + Math.sin(t * 6.3) * 0.12;
    });

    // Engradados de cerveja empilhados (amarelos e vermelhos, sem marca) e um isopor.
    const yellow = this.mat('engradadoAmarelo', '#f2c21b', { spec: 0.3 });
    const red2 = this.mat('engradadoVermelho', '#c9261f', { spec: 0.3 });
    const dark = this.mat('garrafasEngradado', '#3a1d0c', { spec: 0.6 });
    const stacks: Array<[number, number, number]> = [[-4.3, -4.3, 4], [-3.75, -4.4, 2], [-4.4, -3.75, 1]];
    for (const [x, z, n] of stacks) {
      for (let i = 0; i < n; i++) {
        const jx = this.rng.range(-0.03, 0.03);
        const jz = this.rng.range(-0.03, 0.03);
        const ry = this.rng.range(-0.12, 0.12);
        if (this.model('Engradado', this.root, x + jx, i * 0.3, z + jz, ry + Math.PI / 2, i % 2 === 0 ? '' : 'red')) continue;
        const c = this.box(0.46, 0.29, 0.34, x + jx, i * 0.3, z + jz, i % 2 === 0 ? yellow : red2);
        c.rotation.y = ry;
        this.box(0.4, 0.02, 0.28, x, i * 0.3 + 0.26, z, dark);
      }
    }
    const isopor = this.node('isopor', -3.2, 0, -4.35, 0.3);
    if (!this.model('Isopor', isopor, 0, 0, 0, 0)) {
      this.box(0.62, 0.42, 0.42, 0, 0, 0, this.mat('isopor', '#f4f2ea', { emissive: 0.15 }), isopor);
      this.box(0.66, 0.06, 0.46, 0, 0.42, 0, this.mat('tampaIsopor', '#2f6fd6', { spec: 0.3 }), isopor);
    }
  }

  private foldingChair(parent: TransformNode, x: number, z: number, ry: number, mat: StandardMaterial): void {
    const c = new TransformNode('cadeira', this.scene);
    c.parent = parent;
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    // Assento, encosto inclinado e pernas em X (cadeira dobrável de bar).
    this.box(0.42, 0.035, 0.4, 0, 0.44, 0, mat, c);
    const back = this.box(0.42, 0.36, 0.03, 0, 0.5, -0.2, mat, c);
    back.rotation.x = -0.15;
    for (const s of [-1, 1]) {
      const a = this.box(0.03, 0.62, 0.03, s * 0.19, 0, 0, mat, c);
      a.rotation.x = 0.45;
      a.position.y = 0.26;
      const b = this.box(0.03, 0.62, 0.03, s * 0.19, 0, 0, mat, c);
      b.rotation.x = -0.45;
      b.position.y = 0.26;
      this.box(0.03, 0.03, 0.4, s * 0.2, 0.82, -0.22, mat, c).rotation.x = Math.PI / 2 - 0.15;
    }
  }

  // ------------------------------------------------------------ churrasqueira e som

  private buildChurrasqueira(): void {
    const n = this.node('churrasqueira', 3.7, 0, -3.9, -0.25);
    const tijolo = this.m.hq.tijolo;
    this.box(1.3, 0.85, 0.65, 0, 0, 0, tijolo, n, 1.2);
    this.box(1.36, 0.05, 0.7, 0, 0.85, 0, this.m.hq.concreto, n, 2);
    // Boca da churrasqueira (vão escuro) e fuligem.
    this.box(0.9, 0.3, 0.02, 0, 0.38, 0.326, this.mat('fuligem', '#141110', { spec: 0 }), n);
    // Grelha com brasa e espetinhos.
    const brasa = this.mat('brasa', '#ff6a1a', { emissive: 0.9 });
    const ember = this.box(1.1, 0.03, 0.45, 0, 0.88, 0, brasa, n);
    this.glowMesh(ember);
    for (let i = 0; i < 9; i++) this.box(1.1, 0.012, 0.012, 0, 0.93, -0.2 + i * 0.05, this.m.metalDark, n);
    const carne = this.mat('espetinho', '#ffffff', {
      spec: 0.5,
      power: 40,
      tex: this.tex('carneAssada', 64, (ctx, s) => {
        ctx.fillStyle = '#6e3416';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = this.rng.chance(0.5) ? 'rgba(30,12,4,0.5)' : 'rgba(170,90,40,0.4)';
          ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(2, 8), this.rng.range(2, 5));
        }
      }),
    });
    for (let i = 0; i < 4; i++) {
      const stick = MeshBuilder.CreateCylinder('espeto', { diameter: 0.012, height: 0.62, tessellation: 5 }, this.scene);
      stick.rotation.x = Math.PI / 2;
      stick.position.set(-0.35 + i * 0.22, 0.97, 0);
      this.add(stick, this.m.wood, n);
      for (let k = 0; k < 3; k++) {
        const piece = MeshBuilder.CreateIcoSphere('carne', { radius: 0.04, subdivisions: 1 }, this.scene);
        piece.scaling.set(1, 0.85, 1.1);
        piece.position.set(-0.35 + i * 0.22, 0.97, -0.12 + k * 0.12);
        this.add(piece, carne, n);
      }
    }
    // Chaminé.
    this.box(0.35, 1.5, 0.35, 0.45, 0.85, 0.12, tijolo, n, 1.2);
    this.anims.push((t) => {
      const k = 0.75 + Math.sin(t * 7.1) * 0.12 + Math.sin(t * 13.7) * 0.08;
      (ember.material as StandardMaterial).emissiveColor.copyFromFloats(k, k * 0.42, k * 0.1);
    });

    // Fumaça do carvão subindo e se espalhando com o vento.
    const smoke = new ParticleSystem('fumacaChurrasco', 120, this.scene);
    smoke.particleTexture = softDot(this.scene);
    const emitter = MeshBuilder.CreateBox('fumacaEmissor', { size: 0.1 }, this.scene);
    emitter.isVisible = false;
    emitter.parent = n;
    emitter.position.set(0, 1.0, 0);
    smoke.emitter = emitter;
    smoke.minEmitBox = new Vector3(-0.45, 0, -0.15);
    smoke.maxEmitBox = new Vector3(0.45, 0, 0.15);
    smoke.color1 = new Color4(0.85, 0.82, 0.78, 0.32);
    smoke.color2 = new Color4(0.7, 0.68, 0.66, 0.22);
    smoke.colorDead = new Color4(0.6, 0.6, 0.6, 0);
    smoke.minSize = 0.25;
    smoke.maxSize = 0.6;
    smoke.minLifeTime = 2.2;
    smoke.maxLifeTime = 3.6;
    smoke.emitRate = 26;
    smoke.direction1 = new Vector3(-0.15, 1, -0.05);
    smoke.direction2 = new Vector3(0.35, 1, 0.1);
    smoke.minEmitPower = 0.35;
    smoke.maxEmitPower = 0.7;
    smoke.gravity = new Vector3(0.25, 0.08, -0.05);
    smoke.addSizeGradient(0, 0.3);
    smoke.addSizeGradient(1, 1.6);
    smoke.minAngularSpeed = -0.6;
    smoke.maxAngularSpeed = 0.6;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.particles.push(smoke);
  }

  /** Caixa de som de festa, com os alto-falantes pulsando na batida. */
  private buildSom(): void {
    const n = this.node('caixaSom', 1.9, 0, -4.5, 0.25);
    const black = this.mat('caixaSom', '#18181c', { spec: 0.3 });
    // Modelo com a frente para -Z: meia-volta (os alto-falantes ficam em +Z).
    if (!this.model('CaixaSom', n, 0, -0.03, 0, Math.PI)) this.box(0.55, 0.85, 0.42, 0, 0, 0, black, n);
    const cone = this.mat('cone', '#2b2b31', { spec: 0.6 });
    const ledMat = this.mat('ledSom', '#25c4ff', { emissive: 1 });
    const woofers: Mesh[] = [];
    for (const [y, d] of [[0.28, 0.36], [0.64, 0.2]]) {
      const w = MeshBuilder.CreateCylinder('woofer', { diameter: d, height: 0.04, tessellation: 20 }, this.scene);
      w.rotation.x = Math.PI / 2;
      w.position.set(0, y, 0.22);
      this.add(w, cone, n);
      this.dynamic.add(w);
      woofers.push(w);
      const ring = MeshBuilder.CreateTorus('ledAnel', { diameter: d + 0.03, thickness: 0.018, tessellation: 24 }, this.scene);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y, 0.235);
      this.add(ring, ledMat, n);
      this.glowMesh(ring);
    }
    // ~120 bpm: o grave "empurra" o cone e o LED troca de cor devagar.
    this.anims.push((t) => {
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8);
      woofers[0].scaling.set(1 + beat * 0.12, 1 + beat * 0.6, 1 + beat * 0.12);
      woofers[1].scaling.y = 1 + beat * 0.3;
      const h = (t * 0.08) % 1;
      const c = Color3.FromHSV(h * 360, 0.85, 0.7 + beat * 0.3);
      ledMat.emissiveColor.copyFrom(c);
      ledMat.diffuseColor.copyFrom(c);
    });
  }

  // ------------------------------------------------------------ luzes e enfeites

  /** Fio pendurado com barriga (tubo fino). */
  private wire(a: Vector3, b: Vector3, sag: number, segments = 14): Vector3[] {
    const path: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = Vector3.Lerp(a, b, t);
      p.y -= sag * 4 * t * (1 - t);
      path.push(p);
    }
    const tube = MeshBuilder.CreateTube('fio', { path, radius: 0.012, tessellation: 4 }, this.scene);
    this.add(tube, this.m.wire);
    return path;
  }

  /** Gambiarra de lâmpadas entre dois postes de madeira, com algumas piscando. */
  private buildGambiarra(): void {
    const wood = this.m.hq.madeira;
    for (const x of [-5, 5]) this.box(0.1, 3.1, 0.1, x, 0, -5.0, wood, undefined, 0.6);
    this.box(0.1, 2.9, 0.1, -5, 0, -0.6, wood, undefined, 0.6);
    const warm = this.mat('lampada', '#ffd690', { emissive: 1 });
    const blink = this.mat('lampadaPisca', '#ffcf7a', { emissive: 1 });
    const lines: Array<[Vector3, Vector3, number]> = [
      [new Vector3(-5, 3.05, -5.0), new Vector3(5, 3.05, -5.0), 0.45],
      [new Vector3(-5, 2.85, -0.6), new Vector3(-0.2, 3.0, -5.0), 0.35],
    ];
    for (const [a, b, sag] of lines) {
      const path = this.wire(a, b, sag, 20);
      for (let i = 1; i < path.length - 1; i++) {
        const bulb = MeshBuilder.CreateSphere('lampada', { diameter: 0.09, segments: 6 }, this.scene);
        bulb.position.copyFrom(path[i]).addInPlaceFromFloats(0, -0.07, 0);
        bulb.scaling.y = 1.3;
        const m = i % 5 === 2 ? blink : warm;
        this.add(bulb, m).receiveShadows = false;
        this.glowMesh(bulb);
      }
    }
    this.anims.push((t) => {
      const on = Math.sin(t * 11) + Math.sin(t * 3.7) > -0.6 ? 1 : 0.25;
      blink.emissiveColor.copyFromFloats(on, on * 0.8, on * 0.45);
    });
  }

  /** Bandeirinhas de festa (triângulos coloridos) tremulando no fio. */
  private buildBandeirinhas(): void {
    const colors = ['#ffd21f', '#139a48', '#2457c5', '#e8413a', '#ff8a1f', '#f07ab0'];
    const a = new Vector3(-5, 2.95, -0.6);
    const b = new Vector3(5.1, 2.7, -2.8);
    const path = this.wire(a, b, 0.3, 18);
    for (let i = 1; i < path.length - 1; i++) {
      const tri = MeshBuilder.CreateDisc('bandeirinha', { radius: 0.17, tessellation: 3 }, this.scene);
      const holder = new TransformNode('bandeirinhaPivo', this.scene);
      holder.parent = this.root;
      holder.position.copyFrom(path[i]);
      holder.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      this.dynamic.add(holder);
      tri.rotation.z = -Math.PI / 2;
      tri.position.y = -0.12;
      this.add(tri, this.mat(`bandeira${i % colors.length}`, colors[i % colors.length], { twoSided: true, emissive: 0.15 }), holder);
      const phase = i * 0.7;
      this.anims.push((t) => {
        holder.rotation.x = Math.sin(t * 3.1 + phase) * 0.35 + 0.15;
      });
    }
  }

  /** Varal com roupas balançando no vento. */
  private buildVaral(): void {
    const metal = this.m.metal;
    const a = new Vector3(1.2, 2.0, -5.2);
    const b = new Vector3(4.9, 2.0, -2.4);
    for (const p of [a, b]) this.box(0.05, 2.0, 0.05, p.x, 0, p.z, metal);
    const path = this.wire(a, b, 0.14, 12);
    const clothes = ['#e8413a', '#2f7fe0', '#ffd21f', '#ffffff', '#1fa64a', '#f07ab0', '#7a4ac8'];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
    for (let i = 1; i < path.length - 1; i++) {
      if (this.rng.chance(0.2)) continue;
      const w = this.rng.range(0.32, 0.55);
      const h = this.rng.range(0.35, 0.7);
      const holder = new TransformNode('roupaPivo', this.scene);
      holder.parent = this.root;
      holder.position.copyFrom(path[i]);
      holder.rotation.y = yaw;
      this.dynamic.add(holder);
      const kind = i % 3;
      const color = clothes[i % clothes.length];
      const cloth = MeshBuilder.CreatePlane('roupa', { width: kind === 2 ? w * 1.1 : 0.55, height: kind === 2 ? h : 0.6 }, this.scene);
      cloth.position.y = -(kind === 2 ? h : 0.6) / 2;
      this.add(cloth, this.clothMat(kind, color), holder);
      const phase = this.rng.range(0, 6);
      this.anims.push((t) => {
        holder.rotation.x = Math.sin(t * 1.9 + phase) * 0.18 + Math.sin(t * 4.3 + phase) * 0.05 + 0.08;
      });
    }
  }

  /** Roupa no varal: camiseta, bermuda ou toalha listrada, com dobras e prendedores. */
  private clothMat(kind: number, color: string): StandardMaterial {
    const tex = this.tex(`roupa_${kind}_${color}`, 128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (kind === 0) {
        // Camiseta pendurada pelos ombros.
        ctx.moveTo(s * 0.3, s * 0.04);
        ctx.lineTo(s * 0.42, s * 0.04);
        ctx.quadraticCurveTo(s * 0.5, s * 0.12, s * 0.58, s * 0.04);
        ctx.lineTo(s * 0.7, s * 0.04);
        ctx.lineTo(s * 0.98, s * 0.2);
        ctx.lineTo(s * 0.88, s * 0.36);
        ctx.lineTo(s * 0.76, s * 0.3);
        ctx.lineTo(s * 0.77, s * 0.97);
        ctx.lineTo(s * 0.23, s * 0.97);
        ctx.lineTo(s * 0.24, s * 0.3);
        ctx.lineTo(s * 0.12, s * 0.36);
        ctx.lineTo(s * 0.02, s * 0.2);
      } else if (kind === 1) {
        // Bermuda pendurada pela cintura.
        ctx.moveTo(s * 0.18, s * 0.04);
        ctx.lineTo(s * 0.82, s * 0.04);
        ctx.lineTo(s * 0.9, s * 0.8);
        ctx.lineTo(s * 0.56, s * 0.82);
        ctx.lineTo(s * 0.5, s * 0.36);
        ctx.lineTo(s * 0.44, s * 0.82);
        ctx.lineTo(s * 0.1, s * 0.8);
      } else {
        ctx.rect(0, s * 0.02, s, s * 0.98);
      }
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      if (kind === 2) {
        for (let y = 0.2; y < 1; y += 0.25) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillRect(0, s * y, s, s * 0.06);
        }
      }
      // Dobras e sombra de tecido molhado.
      for (let i = 0; i < 7; i++) {
        const x = this.rng.range(0, s);
        const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 8, 0, 16, s);
      }
      for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), 1, 1);
      }
      if (kind === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(s * 0.18, s * 0.04, s * 0.64, s * 0.07);
      }
      ctx.restore();
      // Prendedores.
      ctx.fillStyle = '#f2f2f2';
      for (const x of kind === 2 ? [0.15, 0.85] : [0.3, 0.7]) ctx.fillRect(s * x - 3, 0, 6, s * 0.1);
    });
    return this.mat(`roupa_${kind}_${color}`, '#ffffff', { tex, alpha: true, twoSided: true, emissive: 0.12, spec: 0.02 });
  }

  /** Puxadinho na lateral esquerda com grafite "QUEBRADA" (identidade do jogo). */
  private buildMuroGrafitado(): void {
    const wall = this.box(0.22, 2.5, 4.6, -5.15, 0, -2.75, this.m.hq.muro, undefined, 2.5);
    wall.receiveShadows = true;
    const tex = new DynamicTexture('grafiteLobby', { width: 1024, height: 512 }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 512);
    // Fundo de spray em manchas.
    const blobs = ['#ff4fa3', '#25c4ff', '#ffd21f', '#2bd46b', '#a35bff'];
    for (let i = 0; i < 22; i++) {
      const x = this.rng.range(80, 940);
      const y = this.rng.range(110, 400);
      const r = this.rng.range(50, 130);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `${blobs[i % blobs.length]}cc`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.font = '900 190px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.save();
    ctx.translate(512, 250);
    ctx.rotate(-0.06);
    ctx.scale(0.86, 1);
    ctx.lineWidth = 34;
    ctx.strokeStyle = '#141318';
    ctx.strokeText('QUEBRADA', 0, 0);
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('QUEBRADA', 0, 0);
    const fill = ctx.createLinearGradient(0, -90, 0, 90);
    fill.addColorStop(0, '#ffd21f');
    fill.addColorStop(1, '#ff7a1f');
    ctx.fillStyle = fill;
    ctx.fillText('QUEBRADA', 0, 0);
    ctx.restore();
    ctx.font = 'italic 700 64px "Segoe Script", "Brush Script MT", cursive';
    ctx.fillStyle = '#2bd46b';
    ctx.fillText('royale', 760, 400);
    tex.update();
    tex.hasAlpha = true;
    const mat = new StandardMaterial('lobby_grafite', this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
    mat.specularColor = Color3.Black();
    mat.zOffset = -1;
    const plane = MeshBuilder.CreatePlane('grafite', { width: 4.2, height: 2.1 }, this.scene);
    plane.position.set(-5.03, 1.3, -2.75);
    plane.rotation.y = -Math.PI / 2;
    // Desfaz o espelhamento da raiz só no grafite (o texto continua legível).
    plane.scaling.x = -1;
    this.add(plane, mat);
  }

  private buildPlantas(): void {
    const pot = this.mat('barro', '#ffffff', {
      spec: 0.08,
      tex: this.tex('barro', 128, (ctx, s) => {
        ctx.fillStyle = '#b5592f';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 1800; i++) {
          ctx.fillStyle = this.rng.chance(0.5) ? 'rgba(255,200,160,0.08)' : 'rgba(60,20,5,0.1)';
          ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), 2, 2);
        }
        // Borda de cima mais clara e manchas de água.
        ctx.fillStyle = 'rgba(255,220,190,0.18)';
        ctx.fillRect(0, 0, s, s * 0.12);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = 'rgba(240,235,220,0.12)';
          ctx.fillRect(this.rng.range(0, s), s * 0.5, this.rng.range(6, 18), s * 0.5);
        }
      }),
    });
    const soil = this.mat('terraVaso', '#3a2716', { spec: 0 });
    const leaves = WorldAssets.current?.props.get('Bananeira');
    for (const [x, z, s] of [[4.4, -0.8, 1], [-4.5, 0.6, 1.2], [0.6, -4.8, 0.9]]) {
      const p = MeshBuilder.CreateCylinder('vaso', { diameterTop: 0.5 * s, diameterBottom: 0.38 * s, height: 0.42 * s, tessellation: 20 }, this.scene);
      p.position.set(x, 0.21 * s, z);
      this.add(p, pot);
      const rim = MeshBuilder.CreateTorus('bordaVaso', { diameter: 0.5 * s, thickness: 0.04 * s, tessellation: 20 }, this.scene);
      rim.position.set(x, 0.42 * s, z);
      this.add(rim, pot);
      const dirt = MeshBuilder.CreateDisc('terraVaso', { radius: 0.23 * s, tessellation: 16 }, this.scene);
      dirt.rotation.x = Math.PI / 2;
      dirt.position.set(x, 0.39 * s, z);
      this.add(dirt, soil);
      // Muda de bananeira (modelo da vegetação) no lugar das bolas de folhas.
      if (leaves) {
        const holder = this.node('muda', x, 0.38 * s, z, this.rng.range(0, Math.PI * 2));
        holder.scaling.setAll(0.3 * s);
        for (const m of instantiateModel(leaves, (r) => (r.startsWith('leaf') || r === 'palm' ? this.m.palmLeaf : r === 'bark' ? this.m.bark : this.m.foliage), holder, 'muda')) this.meshes.push(m);
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const leaf = MeshBuilder.CreateIcoSphere('planta', { radius: 0.3 * s, subdivisions: 2 }, this.scene);
        leaf.position.set(x + this.rng.range(-0.12, 0.12), (0.62 + k * 0.18) * s, z + this.rng.range(-0.12, 0.12));
        leaf.scaling.set(1, 1.3, 1);
        this.add(leaf, k % 2 ? this.m.foliage : this.m.foliageDark);
      }
    }
  }

  // ------------------------------------------------------------ céu

  /** Pipas coloridas sobre a comunidade, cada uma com rabiola, dançando no vento. */
  private buildPipas(): void {
    const kites: Array<[number, number, number, string, string]> = [
      [-14, 7, -34, '#e8413a', '#ffd21f'],
      [9, 10, -52, '#2457c5', '#ffffff'],
      [22, 6.5, -30, '#1fa64a', '#ffd21f'],
      [-30, 12, -64, '#ff8a1f', '#7a4ac8'],
    ];
    kites.forEach(([x, y, z, c1, c2], i) => {
      const tex = new DynamicTexture(`pipa${i}`, { width: 64, height: 64 }, this.scene, false);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.fillStyle = c1;
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillRect(32, 32, 32, 32);
      tex.update();
      const holder = this.node(`pipa${i}`, x, y, z);
      this.dynamic.add(holder);
      const kite = MeshBuilder.CreatePlane('pipa', { size: 1.6 }, this.scene);
      kite.rotation.z = Math.PI / 4;
      this.add(kite, this.mat(`pipa${i}`, '#ffffff', { tex, twoSided: true, emissive: 0.35 }), holder).receiveShadows = false;
      // Rabiola: fita de retalhos.
      const tail: Mesh[] = [];
      for (let k = 0; k < 6; k++) {
        const r = MeshBuilder.CreatePlane('rabiola', { width: 0.12, height: 0.45 }, this.scene);
        r.position.set(0, -1.2 - k * 0.48, 0);
        this.add(r, this.mat(`rabiola${k % 2}`, k % 2 ? c2 : c1, { twoSided: true, emissive: 0.3 }), holder).receiveShadows = false;
        tail.push(r);
      }
      const phase = i * 1.7;
      this.anims.push((t) => {
        holder.position.x = x + Math.sin(t * 0.45 + phase) * 2.2;
        holder.position.y = y + Math.sin(t * 0.8 + phase) * 1.1;
        holder.rotation.z = Math.sin(t * 1.3 + phase) * 0.35;
        holder.rotation.y = Math.sin(t * 0.6 + phase) * 0.4;
        tail.forEach((r, k) => (r.position.x = Math.sin(t * 3 + phase - k * 0.7) * 0.18 * k));
      });
    });
  }

  /** Bando de pássaros circulando longe, batendo asas. */
  private buildPassaros(): void {
    const mat = this.mat('passaro', '#1b1a1f', { twoSided: true });
    for (let i = 0; i < 7; i++) {
      const holder = this.node(`passaro${i}`, 0, 0, 0);
      this.dynamic.add(holder);
      const wings: Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = MeshBuilder.CreatePlane('asa', { width: 0.55, height: 0.16 }, this.scene);
        w.rotation.x = Math.PI / 2;
        w.position.x = s * 0.27;
        const pivot = new TransformNode('asaPivo', this.scene);
        pivot.parent = holder;
        w.parent = pivot;
        this.add(w, mat, pivot).receiveShadows = false;
        wings.push(w);
        const phase = i * 0.9;
        this.anims.push((t) => {
          pivot.rotation.z = s * Math.sin(t * 9 + phase) * 0.6;
        });
      }
      const r = 14 + i * 1.8;
      const speed = 0.22 + (i % 3) * 0.03;
      const h = 11 + (i % 4) * 1.2;
      const off = i * 0.55;
      this.anims.push((t) => {
        const a = t * speed + off;
        holder.position.set(6 + Math.cos(a) * r, h + Math.sin(t * 0.7 + i) * 0.8, -52 + Math.sin(a) * r * 0.6);
        holder.rotation.y = -a;
      });
    }
  }

  /** Poeira dourada flutuando na luz de fim de tarde, bem de leve. */
  private buildPoeira(): void {
    const dust = new ParticleSystem('poeiraLobby', 60, this.scene);
    dust.particleTexture = softDot(this.scene);
    const emitter = MeshBuilder.CreateBox('poeiraEmissor', { size: 0.1 }, this.scene);
    emitter.isVisible = false;
    emitter.parent = this.root;
    emitter.position.set(0, 1.4, -1.5);
    dust.emitter = emitter;
    dust.minEmitBox = new Vector3(-4, -1.2, -3);
    dust.maxEmitBox = new Vector3(4, 1.5, 3);
    dust.color1 = new Color4(1, 0.9, 0.6, 0.45);
    dust.color2 = new Color4(1, 0.8, 0.5, 0.25);
    dust.colorDead = new Color4(1, 0.8, 0.5, 0);
    dust.minSize = 0.02;
    dust.maxSize = 0.05;
    dust.minLifeTime = 4;
    dust.maxLifeTime = 7;
    dust.emitRate = 9;
    dust.direction1 = new Vector3(-0.1, 0.05, -0.1);
    dust.direction2 = new Vector3(0.15, 0.12, 0.1);
    dust.minEmitPower = 0.05;
    dust.maxEmitPower = 0.15;
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.particles.push(dust);
  }
}
