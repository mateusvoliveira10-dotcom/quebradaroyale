import { Color3, DynamicTexture, FresnelParameters, Material, Scene, StandardMaterial, Texture } from '@babylonjs/core';
import { shareTint } from './StaticBatcher';
import { Rng } from '../utils/random';
import { MaterialsHQ } from './MaterialsHQ';

/** Metadados lidos pelo StaticBatcher ao montar os lotes. */
export interface MaterialMeta {
  castShadow: boolean;
  /**
   * Variação de cor de um material comum (StaticBatcher.shareTint): no lote estático a peça
   * vai para `tintBase` com a cor nos vértices, e todas as cores viram um lote só.
   */
  tintBase?: StandardMaterial;
  tint?: Color3;
}

type Ctx = CanvasRenderingContext2D;

/** Desenhos no atlas de grafites (4 colunas x 2 linhas). */
export const GRAFFITI_TILES = 8;

interface MakeOpts {
  tex?: Texture;
  castShadow?: boolean;
  emissive?: number;
  spec?: number;
  power?: number;
  alpha?: boolean;
}

/** Biblioteca de materiais cartoon-realistas com texturas procedurais (sem arquivos externos). */
export class Materials {
  readonly brick: StandardMaterial;
  readonly concrete: StandardMaterial;
  readonly concreteDark: StandardMaterial;
  readonly cement: StandardMaterial;
  readonly barrado: StandardMaterial;
  readonly stone: StandardMaterial;
  readonly tile: StandardMaterial;
  readonly asphalt: StandardMaterial;
  readonly sidewalk: StandardMaterial;
  readonly curb: StandardMaterial;
  readonly dirt: StandardMaterial;
  readonly field: StandardMaterial;
  readonly glass: StandardMaterial;
  readonly wire: StandardMaterial;
  readonly rebar: StandardMaterial;
  readonly tank: StandardMaterial;
  readonly tankLid: StandardMaterial;
  readonly roadLine: StandardMaterial;
  readonly roadWhite: StandardMaterial;
  readonly white: StandardMaterial;
  readonly muro: StandardMaterial;
  readonly cloud: StandardMaterial;
  readonly corrugated: StandardMaterial;
  readonly steelDoor: StandardMaterial;
  readonly metal: StandardMaterial;
  readonly metalDark: StandardMaterial;
  readonly rust: StandardMaterial;
  readonly wood: StandardMaterial;
  readonly orange: StandardMaterial;
  readonly rubber: StandardMaterial;
  readonly foliage: StandardMaterial;
  readonly foliageDark: StandardMaterial;
  readonly bark: StandardMaterial;
  readonly fence: StandardMaterial;
  readonly contactShadow: StandardMaterial;
  readonly pvc: StandardMaterial;
  readonly gasRed: StandardMaterial;
  readonly plasticRed: StandardMaterial;
  readonly plasticYellow: StandardMaterial;
  readonly plasticBlue: StandardMaterial;
  readonly trashBag: StandardMaterial;
  /** Sacos de lixo azul e branco, papelão, garrafa, pneu queimado e saco de areia (favela.glb). */
  readonly bagBlue: StandardMaterial;
  readonly bagWhite: StandardMaterial;
  readonly cardboard: StandardMaterial;
  readonly bottle: StandardMaterial;
  readonly rubberBurnt: StandardMaterial;
  readonly sack: StandardMaterial;
  readonly lampOff: StandardMaterial;
  readonly headlight: StandardMaterial;
  readonly taillight: StandardMaterial;
  readonly tankOld: StandardMaterial;
  readonly leafRed: StandardMaterial;
  /** Folhas finas de dois lados (coqueiro, bananeira). */
  readonly palmLeaf: StandardMaterial;
  /** Mato verde e capim seco (dois lados, sem sombra própria). */
  readonly grass: StandardMaterial;
  readonly grassDry: StandardMaterial;
  /** Cartões de folhas das árvores (trees.glb): folhas recortadas por transparência. */
  readonly leafCard: StandardMaterial;
  readonly leafCardRed: StandardMaterial;
  readonly palmCard: StandardMaterial;
  /** Relevo da ilha: detalhe de capim e terra; a cor vem dos vértices (praia, pedra, terra). */
  readonly terreno: StandardMaterial;
  /** Morros do horizonte: mata fechada, capim e barrancos de terra (no lugar do verde liso). */
  readonly morroFundo: StandardMaterial;
  /** Texturas de superfície comuns (multiplicam a cor): metal, plástico e borracha. */
  private surfaceTex!: { metal: DynamicTexture; plastic: DynamicTexture; rubber: DynamicTexture };
  /** Casca de tronco deitado e ponta cortada (anéis). */
  readonly barkLog: StandardMaterial;
  readonly woodEnd: StandardMaterial;
  /** Chão da mata (terra escura com folhas) e trilha de terra batida. */
  readonly chaoMata: StandardMaterial;
  readonly trilha: StandardMaterial;
  /** Chapa amarela da caçamba (por fora, com ferrugem escorrida) e o fundo encardido. */
  readonly cacamba: StandardMaterial;
  readonly cacambaInner: StandardMaterial;
  readonly carTrim: StandardMaterial;
  readonly chrome: StandardMaterial;
  readonly carTaxi: StandardMaterial;
  readonly carPolice: StandardMaterial;
  readonly taxiSign: StandardMaterial;
  readonly sirenRed: StandardMaterial;
  readonly sirenBlue: StandardMaterial;
  readonly statue: StandardMaterial;
  readonly statuePedestal: StandardMaterial;
  /** Pichações e grafites (atlas com fundo transparente de GRAFFITI_TILES desenhos 4 x 2). */
  readonly graffiti: StandardMaterial;
  readonly awnings: StandardMaterial[];
  readonly paints: StandardMaterial[];
  readonly frames: StandardMaterial[];
  readonly doors: StandardMaterial[];
  readonly carPaints: StandardMaterial[];
  readonly clothes: StandardMaterial[];
  /** Embalagens de mercadinho (rótulos genéricos, sem marca); mesma quantidade das cores antigas. */
  readonly productColors: StandardMaterial[];
  /** Piso cerâmico claro, lâmpada fluorescente, cartaz de oferta e gôndola de metal. */
  readonly mercadoPiso: StandardMaterial;
  readonly fluorescente: StandardMaterial;
  readonly cartazOferta: StandardMaterial;
  readonly gondola: StandardMaterial;
  /**
   * Fachadas das casinhas do horizonte e do bairro de fora (janelas, porta e laje) num atlas
   * 4 x 4: uma célula por cor de tinta e a última de tijolo. Um material só: antes eram 13,
   * e cada um virava um lote por bloco (600 malhas só de casinha ao fundo).
   */
  readonly bgAtlas: StandardMaterial;
  /** Células do atlas: cores de tinta e a de tijolo. */
  readonly bgPaintCells: number[];
  readonly bgBrickCell: number;
  /** Chão de fora do muro: terra com mato em escala grande (no lugar do verde chapado). */
  readonly campoFora: StandardMaterial;
  /** Texturas PBR em escala real do setor reconstruído (Fase 4). */
  readonly hq: MaterialsHQ;

  private readonly rng = new Rng(777);

  constructor(private readonly scene: Scene) {
    // Texturas de superfícies grandes em 512 (detalhe de perto); as demais em 128/256.
    const wallTex = this.texture('tex_wall', 512, (ctx, s) => this.drawWall(ctx, s));
    const brickTex = this.texture('tex_brick', 512, (ctx, s) => this.drawBricks(ctx, s));
    const concreteTex = this.texture('tex_concrete', 512, (ctx, s) => this.drawConcrete(ctx, s, '#aaa69e', true));
    const cementTex = this.texture('tex_cement', 256, (ctx, s) => this.drawConcrete(ctx, s, '#b3aea4'));
    const asphaltTex = this.texture('tex_asphalt', 512, (ctx, s) => this.drawAsphalt(ctx, s));
    const dirtTex = this.texture('tex_dirt', 512, (ctx, s) => this.drawDirt(ctx, s));
    const sidewalkTex = this.texture('tex_sidewalk', 256, (ctx, s) => this.drawSidewalk(ctx, s));
    const tankTex = this.texture('tex_tank', 128, (ctx, s) => this.drawTank(ctx, s));
    const stoneTex = this.texture('tex_stone', 256, (ctx, s) => this.drawStone(ctx, s));
    const tileTex = this.texture('tex_tile', 128, (ctx, s) => this.drawTile(ctx, s));
    const corrugatedTex = this.texture('tex_corrugated', 128, (ctx, s) => this.drawCorrugated(ctx, s, '#b9b9b2'));
    const steelTex = this.texture('tex_steeldoor', 128, (ctx, s) => this.drawCorrugated(ctx, s, '#8d939a', true));
    const noiseTex = this.texture('tex_noise', 128, (ctx, s) => this.drawNoise(ctx, s, '#ffffff', 0.12, 0.25));
    const leafTex = this.texture('tex_leaf', 256, (ctx, s) => this.drawLeaves(ctx, s));
    const woodTex = this.texture('tex_wood', 128, (ctx, s) => this.drawWood(ctx, s));
    const fenceTex = this.texture('tex_fence', 128, (ctx, s) => this.drawFence(ctx, s), true);
    const shadowTex = this.texture('tex_contact', 64, (ctx, s) => this.drawContact(ctx, s), true);

    this.brick = this.make('brick', '#ffffff', { tex: brickTex });
    this.concrete = this.make('concrete', '#ffffff', { tex: concreteTex });
    this.concreteDark = this.make('concreteDark', '#8f8b84', { tex: concreteTex });
    this.cement = this.make('cement', '#ffffff', { tex: cementTex, castShadow: false });
    this.barrado = this.make('barrado', '#7e7a74', { tex: concreteTex });
    this.stone = this.make('stone', '#ffffff', { tex: stoneTex });
    this.tile = this.make('tile', '#ffffff', { tex: tileTex, spec: 0.35, power: 60, castShadow: false });
    this.asphalt = this.make('asphalt', '#ffffff', { tex: asphaltTex, castShadow: false });
    this.sidewalk = this.make('sidewalk', '#ffffff', { tex: sidewalkTex, castShadow: false });
    this.curb = this.make('curb', '#d8d3c8', { tex: concreteTex });
    this.dirt = this.make('dirt', '#ffffff', { tex: dirtTex, castShadow: false });
    const hillTex = this.texture('tex_morroFundo', 512, (ctx, s) => this.drawHillVegetation(ctx, s));
    hillTex.uScale = 9;
    hillTex.vScale = 5;
    this.morroFundo = this.make('morroFundo', '#ffffff', { tex: hillTex, castShadow: false, emissive: 0.04 });
    const terrenoTex = this.texture('tex_terreno', 512, (ctx, s) => this.drawTerrainDetail(ctx, s));
    this.terreno = this.make('terreno', '#ffffff', { tex: terrenoTex, castShadow: false, emissive: 0.06 });
    this.leafCard = this.cardMat('leafCard', this.texture('tex_leafCard', 512, (ctx, s) => this.drawLeafCard(ctx, s, ['#3f9a26', '#52b030', '#66c43a', '#7ad646', '#2f8020']), true));
    this.leafCardRed = this.cardMat('leafCardRed', this.texture('tex_leafCardRed', 512, (ctx, s) => this.drawLeafCard(ctx, s, ['#d0582a', '#e6743a', '#b8471f', '#66c43a', '#f0903e']), true));
    this.palmCard = this.cardMat('palmCard', this.texture('tex_palmCard', 512, (ctx, s) => this.drawPalmCard(ctx, s), true));
    this.chaoMata = this.make('chaoMata', '#ffffff', { tex: this.texture('tex_chaoMata', 512, (ctx, s) => this.drawForestFloor(ctx, s)), castShadow: false });
    this.trilha = this.make('trilha', '#d2b48a', { tex: dirtTex, castShadow: false });
    this.field = this.make('field', '#d08a55', { tex: dirtTex, castShadow: false });
    this.glass = this.make('glass', '#2b3a52', { spec: 1.1, power: 96 });
    this.glass.emissiveColor = Color3.White();
    this.glass.emissiveFresnelParameters = new FresnelParameters({
      leftColor: Color3.FromHexString('#9fcaf0').scale(0.55),
      rightColor: Color3.FromHexString('#1a2232'),
      bias: 0.1,
      power: 1.6,
    });
    this.wire = this.make('wire', '#17141c');
    this.rebar = this.make('rebar', '#ffffff', { tex: this.texture('tex_rebarSurf', 128, (ctx, s) => this.drawRustSurface(ctx, s)) });
    this.tank = this.make('tank', '#2f7fe0', { spec: 0.35, power: 40, tex: tankTex });
    this.tankLid = this.make('tankLid', '#1e5fb3', { spec: 0.35, power: 40, tex: noiseTex });
    this.leafRed = this.make('leafRed', '#b0502a', { tex: leafTex });
    this.palmLeaf = this.make('palmLeaf', '#5a8a38', { tex: leafTex });
    this.palmLeaf.backFaceCulling = false;
    this.grass = this.make('grass', '#62c03a', { tex: noiseTex, castShadow: false, emissive: 0.08 });
    this.grass.backFaceCulling = false;
    this.grassDry = this.make('grassDry', '#c8c060', { tex: noiseTex, castShadow: false, emissive: 0.08 });
    this.grassDry.backFaceCulling = false;
    const cacambaTex = this.texture('tex_cacamba', 256, (ctx, s) => this.drawCacamba(ctx, s));
    this.cacamba = this.make('cacamba', '#f1b81a', { tex: cacambaTex, spec: 0.25, power: 40 });
    this.cacambaInner = this.make('cacambaInner', '#8d6a1c', { tex: cacambaTex });
    // Caixa d'água velha de fibrocimento (cinza, encardida).
    this.tankOld = this.make('tankOld', '#9c9c94', { tex: tankTex });
    this.roadLine = this.make('roadLine', '#ffcf1f', { castShadow: false, emissive: 0.2, tex: noiseTex });
    this.roadWhite = this.make('roadWhite', '#eeeeea', { castShadow: false, emissive: 0.15, tex: noiseTex });
    this.white = this.make('white', '#f1eee6', { tex: noiseTex });
    this.muro = this.make('muro', '#e3dccb', { tex: wallTex });
    this.cloud = this.make('cloud', '#ffffff', { castShadow: false, emissive: 0.7 });
    this.cloud.fogEnabled = false;
    this.corrugated = this.make('corrugated', '#ffffff', { tex: corrugatedTex });
    this.steelDoor = this.make('steelDoor', '#ffffff', { tex: steelTex, spec: 0.3 });
    // Superfícies que eram cor lisa: metal escovado com riscos e sujeira, plástico com
    // granulado e marcas, borracha, saco de lixo amassado, ferrugem e pedra envelhecida.
    const metalTex = this.texture('tex_metalSurf', 256, (ctx, s) => this.drawMetalSurface(ctx, s));
    const plasticTex = this.texture('tex_plasticSurf', 256, (ctx, s) => this.drawPlasticSurface(ctx, s));
    const rubberTex = this.texture('tex_rubberSurf', 128, (ctx, s) => this.drawNoise(ctx, s, '#ffffff', 0.35, 0.35));
    const bagTex = this.texture('tex_bagSurf', 256, (ctx, s) => this.drawBagSurface(ctx, s));
    this.metal = this.make('metal', '#9aa1a8', { spec: 0.6, power: 48, tex: metalTex });
    this.metalDark = this.make('metalDark', '#3a3d42', { spec: 0.4, power: 40, tex: metalTex });
    this.surfaceTex = { metal: metalTex, plastic: plasticTex, rubber: rubberTex };
    this.rust = this.make('rust', '#7a4a30', { tex: noiseTex });
    this.wood = this.make('wood', '#ffffff', { tex: woodTex });
    this.orange = this.make('orange', '#e8742a', { tex: noiseTex, spec: 0.2 });
    this.rubber = this.make('rubber', '#1f1f22', { spec: 0.15, tex: rubberTex });
    // Verdes de folha menos saturados (mata atlântica / árvore de rua, não verde de desenho).
    this.foliage = this.make('foliage', '#62a844', { tex: leafTex });
    this.foliageDark = this.make('foliageDark', '#467a33', { tex: leafTex });
    // Casca: sulcos verticais, placas e musgo (árvores); a dos troncos deitados é a mesma
    // desenhada girada (o UV dos modelos segue o eixo X do tronco).
    const barkTex = this.texture('tex_bark', 256, (ctx, s) => this.drawBark(ctx, s));
    this.bark = this.make('bark', '#ffffff', { tex: barkTex });
    const barkLogTex = this.texture('tex_barkLog', 256, (ctx, s) => this.drawBark(ctx, s));
    barkLogTex.wAng = Math.PI / 2;
    barkLogTex.uScale = barkLogTex.vScale = 1.6;
    this.barkLog = this.make('barkLog', '#ffffff', { tex: barkLogTex });
    this.woodEnd = this.make('woodEnd', '#ffffff', { tex: this.texture('tex_woodEnd', 256, (ctx, s) => this.drawWoodEnd(ctx, s)) });
    this.pvc = this.make('pvc', '#e9e6df', { spec: 0.3, tex: plasticTex });
    this.gasRed = this.make('gasRed', '#c9332b', { spec: 0.5, power: 40, tex: metalTex });
    this.plasticRed = this.make('plasticRed', '#d8312c', { spec: 0.35, tex: plasticTex });
    this.plasticYellow = this.make('plasticYellow', '#f4c21d', { spec: 0.35, tex: plasticTex });
    this.plasticBlue = this.make('plasticBlue', '#2a64c8', { spec: 0.35, tex: plasticTex });
    // Plástico de saco de lixo: escuro, com reflexo forte e "brilho de borda" (fresnel).
    this.trashBag = this.make('trashBag', '#1d1e23', { spec: 0.9, power: 70, emissive: 0.02, tex: bagTex });
    this.trashBag.emissiveColor = Color3.White();
    this.trashBag.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.16, 0.17, 0.2), rightColor: new Color3(0.01, 0.01, 0.012), bias: 0.08, power: 2.4 });
    this.bagBlue = this.make('bagBlue', '#1f4fb8', { spec: 0.8, power: 60, tex: bagTex });
    this.bagWhite = this.make('bagWhite', '#d9dad6', { spec: 0.6, power: 40, tex: bagTex });
    this.cardboard = this.make('cardboard', '#a07646', { tex: noiseTex });
    this.bottle = this.make('bottle', '#2a6b34', { spec: 1, power: 90, emissive: 0.15 });
    this.rubberBurnt = this.make('rubberBurnt', '#2a2622', { spec: 0.05, tex: noiseTex });
    this.sack = this.make('sack', '#bfae86', { tex: noiseTex });
    this.lampOff = this.make('lampOff', '#f2efe0', { emissive: 0.35 });
    this.headlight = this.make('headlight', '#fff6d8', { emissive: 0.6, spec: 1 });
    this.taillight = this.make('taillight', '#c4211e', { emissive: 0.4, spec: 1 });

    this.fence = this.make('fence', '#c9cdd2', { tex: fenceTex, alpha: true, castShadow: false });
    this.fence.backFaceCulling = false;

    this.contactShadow = new StandardMaterial('contactShadow', scene);
    this.contactShadow.diffuseColor = Color3.Black();
    this.contactShadow.specularColor = Color3.Black();
    this.contactShadow.diffuseTexture = shadowTex;
    this.contactShadow.useAlphaFromDiffuseTexture = true;
    this.contactShadow.disableLighting = true;
    this.contactShadow.zOffset = -2;
    this.contactShadow.metadata = { castShadow: false } satisfies MaterialMeta;

    this.awnings = [
      ['#d23a32', '#f6f1e6'],
      ['#1f8f4a', '#f6f1e6'],
      ['#2457c5', '#ffd21f'],
      ['#f08a1c', '#f6f1e6'],
    ].map(([a, b], i) =>
      this.make(`awning_${i}`, '#ffffff', { tex: this.texture(`tex_awning_${i}`, 128, (ctx, s) => this.drawStripes(ctx, s, a, b)) }),
    );

    const paintColors = ['#f3a5c0', '#8fdcc4', '#ffdc6a', '#86c2f5', '#c2a9f2', '#ffaf73', '#ece2cc', '#8fd47e', '#f78e86', '#63c9cf', '#f2c9a0', '#b9e07a'];
    this.paints = paintColors.map((c, i) => this.make(`paint_${i}`, c, { tex: wallTex }));

    const frameColors = ['#ffffff', '#e8e2d4', '#3a6fd8', '#2f9e55', '#d8433a', '#4a4a4a'];
    this.frames = frameColors.map((c, i) => this.make(`frame_${i}`, c, { spec: 0.25 }));

    const doorColors = ['#3a6fd8', '#2f9e55', '#d8433a', '#7a4a2a', '#e8b422', '#5b5f6b', '#8a3fb0'];
    this.doors = doorColors.map((c, i) => this.make(`door_${i}`, c, { tex: noiseTex, spec: 0.3 }));

    // Cores de rua brasileira: muito branco, prata e preto, e as cores "de antigamente" desbotadas.
    // O índice 2 (branco) também serve de teto da perua e de base da viatura.
    const carColors = ['#b8322c', '#2f5fae', '#eeece6', '#a7abb0', '#1f2124', '#2c5a3f', '#6e2230', '#d8c8a2', '#5f86ad', '#c9a227', '#8a8f96'];
    this.carPaints = carColors.map((c, i) => this.carPaint(`carPaint_${i}`, c));
    this.carTaxi = this.carPaint('carTaxi', '#f2c21b');
    this.carPolice = this.carPaint('carPolice', '#20283a');
    this.carTrim = this.make('carTrim', '#1b1c1f', { spec: 0.18, power: 30 });
    this.chrome = this.make('chrome', '#c4c8cd', { spec: 1.1, power: 110, emissive: 0.12 });
    this.chrome.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.55, 0.62, 0.7), rightColor: new Color3(0.08, 0.08, 0.09), bias: 0.15, power: 1.5 });
    this.chrome.emissiveColor = Color3.White();
    this.sirenRed = this.make('sirenRed', '#ff2a24', { emissive: 0.75, spec: 1, castShadow: false });
    this.sirenBlue = this.make('sirenBlue', '#2a64ff', { emissive: 0.75, spec: 1, castShadow: false });
    this.taxiSign = this.make('taxiSign', '#ffffff', {
      emissive: 0.35,
      tex: this.texture('tex_taxi', 256, (ctx, s, h) => this.drawTaxiSign(ctx, s, h), false, (s) => s / 4),
    });
    // Estátua de pedra-sabão clara (sem UV no modelo: cor lisa) e pedestal de concreto.
    // Pedra-sabão/concreto envelhecido: manchas, escorridos de chuva e liquens.
    const statueTex = this.texture('tex_statueStone', 512, (ctx, s) => this.drawStatueStone(ctx, s));
    this.statue = this.make('statue', '#ffffff', { spec: 0.12, power: 20, emissive: 0.06, tex: statueTex });
    this.statuePedestal = this.make('statuePedestal', '#cfc8ba', { spec: 0.05, tex: statueTex });

    // Um atlas só (4 x 2 desenhos de 256 x 128): um material = um lote por bloco do mapa.
    const graffitiTex = this.texture('tex_graffiti', 1024, (ctx, w, h) => {
      for (let i = 0; i < GRAFFITI_TILES; i++) {
        const tw = w / 4;
        const th = h / 2;
        ctx.save();
        ctx.translate((i % 4) * tw, Math.floor(i / 4) * th);
        ctx.beginPath();
        ctx.rect(0, 0, tw, th);
        ctx.clip();
        this.drawGraffiti(ctx, tw, th, i);
        ctx.restore();
      }
    }, true, (s) => s / 4);
    this.graffiti = this.make('graffiti', '#ffffff', { tex: graffitiTex, castShadow: false, emissive: 0.05 });
    // Recorte por alfa (sem mistura): não precisa ordenar e entra no lote estático normal.
    this.graffiti.useAlphaFromDiffuseTexture = false;
    this.graffiti.alphaCutOff = 0.45;
    this.graffiti.zOffset = -1;

    const clothColors = ['#e8413a', '#2f7fe0', '#ffd21f', '#ffffff', '#1fa64a', '#f07ab0', '#7a4ac8', '#ff8a1f'];
    this.clothes = clothColors.map((c, i) => this.make(`cloth_${i}`, c, { tex: noiseTex, castShadow: false }));

    // Embalagens: fundo colorido, faixa, nome genérico do produto e peso.
    const products: Array<[string, string, string, string]> = [
      ['ARROZ', '#f4efe3', '#d8312c', '5kg'],
      ['FEIJÃO', '#2f62c9', '#ffd21f', '1kg'],
      ['CAFÉ', '#3b2216', '#e8b422', '500g'],
      ['LEITE', '#ffffff', '#2f7fe0', '1L'],
      ['ÓLEO', '#f2c21b', '#1f8f4a', '900ml'],
      ['MACARRÃO', '#d8312c', '#ffffff', '500g'],
      ['BISCOITO', '#8a3fb0', '#ffd21f', '200g'],
    ];
    this.productColors = products.map(([name, bg, fg, weight], i) =>
      this.make(`product_${i}`, '#ffffff', { spec: 0.35, power: 40, tex: this.texture(`tex_product_${i}`, 128, (ctx, s) => this.drawProduct(ctx, s, name, bg, fg, weight)) }),
    );
    const pisoTex = this.texture('tex_mercadoPiso', 256, (ctx, s) => this.drawFloorTiles(ctx, s));
    this.mercadoPiso = this.make('mercadoPiso', '#ffffff', { tex: pisoTex, spec: 0.5, power: 70, castShadow: false });
    this.fluorescente = this.make('fluorescente', '#f4fbff', { emissive: 1, castShadow: false });
    this.cartazOferta = this.make('cartazOferta', '#ffffff', { emissive: 0.25, tex: this.texture('tex_oferta', 256, (ctx, s) => this.drawOffer(ctx, s)) });
    this.gondola = this.make('gondola', '#dfe3e6', { spec: 0.6, power: 60, tex: noiseTex });
    // Fachadas do horizonte: as cores das tintas sobre um desenho com janelas, porta e laje.
    const atlasTex = this.texture('tex_bgAtlas', 512, (ctx) => {
      const cell = 128;
      [...paintColors, null].forEach((color, i) => {
        ctx.save();
        ctx.translate((i % 4) * cell, Math.floor(i / 4) * cell);
        ctx.beginPath();
        ctx.rect(0, 0, cell, cell);
        ctx.clip();
        this.drawBgFacade(ctx, cell, color === null);
        if (color) {
          // Tinta por cima do reboco branco (multiplica: janelas e sujeira continuam).
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = color;
          ctx.fillRect(0, cell * 0.04, cell, cell);
        }
        ctx.restore();
      });
    });
    this.bgAtlas = this.make('bgAtlas', '#ffffff', { tex: atlasTex, castShadow: false });
    this.bgPaintCells = paintColors.map((_, i) => i);
    this.bgBrickCell = paintColors.length;
    // Textura própria (um clone de DynamicTexture nunca fica "pronto" e o chão sumia).
    const foraTex = this.texture('tex_campoFora', 256, (ctx, s) => this.drawDirt(ctx, s));
    foraTex.uScale = 150;
    foraTex.vScale = 150;
    this.campoFora = this.make('campoFora', '#a8a27a', { tex: foraTex, castShadow: false });
    this.hq = new MaterialsHQ(scene);
    // Peças do kit das casas que eram cor lisa (caixa de fibra, plástico, calha, borracha).
    this.hq.caixa.diffuseTexture = this.surfaceTex.plastic;
    this.hq.plastico.diffuseTexture = this.surfaceTex.plastic;
    this.hq.calha.diffuseTexture = this.surfaceTex.metal;
    this.hq.borracha.diffuseTexture = this.surfaceTex.rubber;
    // Variações de cor do mesmo material viram um lote só (cor por vértice).
    shareTint(this.paints, 'paint_tinta');
    shareTint(this.hq.reboco, 'hq_reboco_tinta');
    shareTint(this.hq.portoes, 'hq_portao_tinta');
  }

  private make(name: string, hex: string, o: MakeOpts = {}): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    const color = Color3.FromHexString(hex);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(1, 1, 1).scale(o.spec ?? 0.04);
    mat.specularPower = o.power ?? 24;
    // Pouco emissivo: as faces na sombra ficam com volume (antes 0,08 achatava o cenário).
    mat.emissiveColor = color.scale(o.emissive ?? 0.05);
    if (o.tex) mat.diffuseTexture = o.tex;
    if (o.alpha) {
      mat.useAlphaFromDiffuseTexture = true;
      if (o.tex) o.tex.hasAlpha = true;
    }
    const meta: MaterialMeta = { castShadow: o.castShadow ?? true };
    mat.metadata = meta;
    return mat;
  }

  /** Pintura automotiva: brilho especular forte e reflexo do céu nas bordas (fresnel). */
  private carPaint(name: string, hex: string): StandardMaterial {
    const m = this.make(name, hex, { spec: 0.9, power: 90 });
    m.emissiveColor = Color3.White();
    m.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.3, 0.36, 0.42), rightColor: Color3.FromHexString(hex).scale(0.06), bias: 0.12, power: 2.2 });
    return m;
  }

  /** `heightOf` dá a altura a partir da largura (padrão: quadrada). */
  private texture(name: string, size: number, draw: (ctx: Ctx, size: number, height: number) => void, alpha = false, heightOf?: (w: number) => number): DynamicTexture {
    const height = heightOf ? heightOf(size) : size;
    const tex = new DynamicTexture(name, { width: size, height }, this.scene, true);
    const ctx = tex.getContext() as unknown as Ctx;
    if (alpha) ctx.clearRect(0, 0, size, height);
    draw(ctx, size, height);
    tex.update();
    tex.hasAlpha = alpha;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 8;
    return tex;
  }

  // ------------------------------------------------------------- desenhos

  private drawNoise(ctx: Ctx, s: number, base: string, density: number, strength: number): void {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const count = Math.floor(s * s * density);
    for (let i = 0; i < count; i++) {
      const dark = this.rng.chance(0.6);
      ctx.fillStyle = dark ? `rgba(0,0,0,${this.rng.range(0, strength * 0.5)})` : `rgba(255,255,255,${this.rng.range(0, strength)})`;
      const size = this.rng.chance(0.85) ? 1 : 2;
      ctx.fillRect(this.rng.int(0, s - 1), this.rng.int(0, s - 1), size, size);
    }
  }

  private blotches(ctx: Ctx, s: number, count: number, color: string, rMin: number, rMax: number): void {
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      const r = this.rng.range(rMin, rMax);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  /**
   * Reboco pintado: 1 tile = 2,5 m de largura x 3 m de altura (um pavimento).
   * Sujeira na base (respingo de chuva), manchas escorridas do topo e trincas.
   */
  private drawWall(ctx: Ctx, s: number): void {
    this.drawNoise(ctx, s, '#ffffff', 0.1, 0.18);
    // Textura de reboco desempenado: manchas largas e suaves de desempenadeira.
    this.blotches(ctx, s, 26, 'rgba(120,110,95,0.07)', 30, 90);
    this.blotches(ctx, s, 14, 'rgba(255,255,255,0.10)', 20, 60);
    // Tinta descascada mostrando o reboco cinza (bordas irregulares com sombra).
    for (let i = 0; i < 2; i++) {
      const cx = this.rng.range(s * 0.1, s * 0.9);
      const cy = this.rng.range(s * 0.45, s * 0.9);
      const r = this.rng.range(s * 0.02, s * 0.045);
      ctx.beginPath();
      for (let k = 0; k <= 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const rr = r * this.rng.range(0.55, 1.25);
        const px = cx + Math.cos(a) * rr * 1.4;
        const py = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(150,145,135,0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // Mofo esverdeado subindo do chão.
    for (let i = 0; i < 18; i++) {
      const x = this.rng.range(0, s);
      const r = this.rng.range(8, 26);
      const g = ctx.createRadialGradient(x, s, 0, x, s, r * 2.2);
      g.addColorStop(0, 'rgba(58,72,40,0.30)');
      g.addColorStop(1, 'rgba(58,72,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 2.2, s - r * 2.2, r * 4.4, r * 2.2);
    }
    this.blotches(ctx, s, 10, 'rgba(120,110,95,0.10)', 20, 60);
    // Escorridos de água a partir do topo.
    for (let i = 0; i < 9; i++) {
      const x = this.rng.range(0, s);
      const w = this.rng.range(6, 22);
      const len = this.rng.range(s * 0.15, s * 0.55);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(70,60,50,0.22)');
      g.addColorStop(1, 'rgba(70,60,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, len);
    }
    // Sujeira na base.
    const base = ctx.createLinearGradient(0, s * 0.78, 0, s);
    base.addColorStop(0, 'rgba(90,70,50,0)');
    base.addColorStop(1, 'rgba(90,70,50,0.42)');
    ctx.fillStyle = base;
    ctx.fillRect(0, s * 0.78, s, s * 0.22);
    // Trincas.
    ctx.strokeStyle = 'rgba(60,50,40,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = this.rng.range(0, s);
      let y = this.rng.range(0, s * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += this.rng.range(-8, 8);
        y += this.rng.range(4, 12);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /** Tijolo baiano laranja com argamassa escorrida: 1 tile = 1 m. */
  private drawBricks(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#a8957f';
    ctx.fillRect(0, 0, s, s);
    const rows = 5;
    const cols = 3;
    const rowH = s / rows;
    const colW = s / cols;
    const mortar = 5;
    const tones = ['#c8693a', '#b95c31', '#d27a4b', '#ad542c', '#c46f43', '#d9844f', '#bf6236', '#a24b27', '#d98d5c'];
    const k = s / 256;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : colW / 2;
      for (let c = -1; c < cols + 1; c++) {
        // Junta irregular: cada tijolo assenta um pouco torto e fora de linha.
        const x = c * colW + offset + this.rng.range(-2, 2) * k;
        const y = r * rowH + this.rng.range(-1.5, 1.5) * k;
        const m = (mortar + this.rng.range(-1, 3)) * k;
        const g = ctx.createLinearGradient(0, y, 0, y + rowH);
        const tone = this.rng.chance(0.08) ? '#7f3a1f' : this.rng.pick(tones);
        g.addColorStop(0, shade(tone, 8));
        g.addColorStop(0.5, tone);
        g.addColorStop(1, shade(tone, -22));
        ctx.fillStyle = g;
        ctx.fillRect(x + m / 2, y + m / 2, colW - m, rowH - m);
        // Furinhos do tijolo baiano, realce na aresta de cima e quina lascada.
        ctx.fillStyle = 'rgba(70,25,8,0.3)';
        ctx.fillRect(x + colW * 0.18, y + rowH * 0.42, colW * 0.64, 3 * k);
        ctx.fillStyle = 'rgba(255,210,170,0.18)';
        ctx.fillRect(x + m / 2, y + m / 2, colW - m, 2 * k);
        if (this.rng.chance(0.25)) {
          ctx.fillStyle = 'rgba(168,149,127,0.9)';
          ctx.fillRect(x + m / 2 + this.rng.range(0, colW - 20 * k), y + m / 2, this.rng.range(6, 16) * k, this.rng.range(3, 7) * k);
        }
      }
      // Argamassa escorrida da junta.
      for (let q = 0; q < 5; q++) {
        ctx.fillStyle = 'rgba(190,175,155,0.65)';
        ctx.fillRect(this.rng.range(0, s), r * rowH + rowH - 3 * k, this.rng.range(3, 10) * k, this.rng.range(3, 14) * k);
      }
    }
    // Respingos de cimento e encardido.
    this.blotches(ctx, s, 8, 'rgba(180,170,155,0.18)', 10 * k, 30 * k);
    this.blotches(ctx, s, 10, 'rgba(40,20,10,0.12)', 15 * k, 45 * k);
    this.speckle(ctx, s, 0.05);
  }

  /** Concreto; `formwork` acrescenta as marcas das tábuas da fôrma e bolhas (concreto aparente). */
  private drawConcrete(ctx: Ctx, s: number, base: string, formwork = false): void {
    const k = s / 256;
    this.drawNoise(ctx, s, base, 0.14, 0.3);
    this.blotches(ctx, s, 14, 'rgba(60,55,50,0.12)', 15 * k, 50 * k);
    this.blotches(ctx, s, 8, 'rgba(255,255,255,0.10)', 10 * k, 40 * k);
    if (formwork) {
      const boards = 6;
      for (let i = 0; i < boards; i++) {
        const y = (i / boards) * s;
        ctx.fillStyle = `rgba(0,0,0,${this.rng.range(0.03, 0.08)})`;
        ctx.fillRect(0, y, s, s / boards);
        ctx.fillStyle = 'rgba(40,35,30,0.22)';
        ctx.fillRect(0, y, s, 1.5 * k);
      }
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = 'rgba(40,35,30,0.35)';
        ctx.beginPath();
        ctx.arc(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(0.6, 1.8) * k, 0, Math.PI * 2);
        ctx.fill();
      }
      // Escorrido de ferrugem e de água.
      for (let i = 0; i < 4; i++) {
        const x = this.rng.range(0, s);
        const g = ctx.createLinearGradient(0, 0, 0, s * 0.5);
        g.addColorStop(0, this.rng.chance(0.4) ? 'rgba(120,60,25,0.18)' : 'rgba(50,45,40,0.16)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, this.rng.range(4, 14) * k, s * 0.5);
      }
    }
  }

  private drawAsphalt(ctx: Ctx, s: number): void {
    const k = s / 256;
    this.drawNoise(ctx, s, '#4a4c52', 0.25, 0.4);
    // Brita aparente (asfalto gasto).
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = this.rng.pick(['rgba(150,148,140,0.35)', 'rgba(110,108,104,0.35)', 'rgba(30,30,32,0.4)']);
      ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(1, 2.5) * k, this.rng.range(1, 2.5) * k);
    }
    this.blotches(ctx, s, 10, 'rgba(20,20,22,0.25)', 15 * k, 45 * k);
    this.blotches(ctx, s, 6, 'rgba(120,120,120,0.10)', 20 * k, 50 * k);
    // Manchas de óleo.
    this.blotches(ctx, s, 5, 'rgba(10,10,14,0.35)', 6 * k, 18 * k);
    // Remendos de asfalto novo (mais escuros) com borda.
    {
      const w = this.rng.range(50, 90) * k;
      const h = this.rng.range(30, 60) * k;
      const x = this.rng.range(0, s - w);
      const y = this.rng.range(0, s - h);
      ctx.fillStyle = 'rgba(25,25,28,0.16)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(15,15,15,0.22)';
      ctx.lineWidth = 1.5 * k;
      ctx.strokeRect(x, y, w, h);
    }
    // Trincas finas.
    ctx.strokeStyle = 'rgba(15,15,18,0.4)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      let x = this.rng.range(0, s);
      let y = this.rng.range(0, s);
      let a = this.rng.range(0, Math.PI * 2);
      ctx.lineWidth = this.rng.range(0.6, 1.2) * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let q = 0; q < 8; q++) {
        a += this.rng.range(-0.7, 0.7);
        x += Math.cos(a) * 6 * k;
        y += Math.sin(a) * 6 * k;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawDirt(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#b08458';
    ctx.fillRect(0, 0, s, s);
    this.blotches(ctx, s, 30, 'rgba(110,72,40,0.30)', 8, 30);
    this.blotches(ctx, s, 20, 'rgba(210,175,125,0.30)', 8, 30);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = this.rng.pick(['rgba(84,140,56,0.55)', 'rgba(110,160,70,0.5)', 'rgba(70,120,45,0.5)']);
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      for (let b = 0; b < 5; b++) ctx.fillRect(x + this.rng.range(-3, 3), y + this.rng.range(-3, 3), 1.5, this.rng.range(3, 6));
    }
    // Pedrinhas.
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = this.rng.pick(['#8f8a80', '#c9c0b0', '#6f6458']);
      ctx.beginPath();
      ctx.arc(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(0.8, 2.2), 0, Math.PI * 2);
      ctx.fill();
    }
    this.speckle(ctx, s, 0.08);
  }

  private drawSidewalk(ctx: Ctx, s: number): void {
    const k = s / 128;
    this.drawNoise(ctx, s, '#cfc8bb', 0.12, 0.25);
    ctx.strokeStyle = 'rgba(70,60,50,0.35)';
    ctx.lineWidth = 2 * k;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    this.blotches(ctx, s, 5, 'rgba(60,55,50,0.15)', 10 * k, 30 * k);
    // Chiclete, encardido e uma trinca diagonal.
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(40,38,36,0.3)';
      ctx.beginPath();
      ctx.arc(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(1, 2.4) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,52,44,0.35)';
    ctx.lineWidth = 1 * k;
    ctx.beginPath();
    let x = this.rng.range(0, s * 0.3);
    let y = this.rng.range(0, s * 0.3);
    ctx.moveTo(x, y);
    for (let q = 0; q < 8; q++) {
      x += this.rng.range(4, 14) * k;
      y += this.rng.range(2, 12) * k;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** Caixa d'água de polietileno: frisos horizontais, tampa mais clara e sujeira escorrida. */
  private drawTank(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      const y = s * (0.12 + i * 0.15);
      const g = ctx.createLinearGradient(0, y, 0, y + s * 0.06);
      g.addColorStop(0, 'rgba(0,0,0,0.22)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, s * 0.06);
    }
    for (let i = 0; i < 10; i++) {
      const x = this.rng.range(0, s);
      const g = ctx.createLinearGradient(0, s, 0, s * 0.3);
      g.addColorStop(0, 'rgba(60,50,40,0.28)');
      g.addColorStop(1, 'rgba(60,50,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, s * 0.3, this.rng.range(2, 6), s * 0.7);
    }
    this.speckle(ctx, s, 0.04);
  }

  /**
   * Chapa pintada de caçamba (1 tile = 1 m; V sobe com a altura): ferrugem escorrendo de cima,
   * barro na base, riscos e amassados de pancada.
   */
  private drawCacamba(ctx: Ctx, s: number): void {
    this.drawNoise(ctx, s, '#ffffff', 0.08, 0.16);
    for (let i = 0; i < 14; i++) {
      const x = this.rng.range(0, s);
      const w = this.rng.range(2, 9);
      const len = this.rng.range(s * 0.2, s * 0.8);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(120,52,18,0.65)');
      g.addColorStop(1, 'rgba(120,52,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, len);
    }
    this.blotches(ctx, s, 8, 'rgba(110,50,20,0.35)', 6, 22);
    const base = ctx.createLinearGradient(0, s * 0.7, 0, s);
    base.addColorStop(0, 'rgba(80,60,40,0)');
    base.addColorStop(1, 'rgba(80,60,40,0.55)');
    ctx.fillStyle = base;
    ctx.fillRect(0, s * 0.7, s, s * 0.3);
    ctx.strokeStyle = 'rgba(60,55,50,0.55)';
    for (let i = 0; i < 18; i++) {
      ctx.lineWidth = this.rng.range(0.6, 1.6);
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.rng.range(-30, 30), y + this.rng.range(-6, 6));
      ctx.stroke();
    }
    this.blotches(ctx, s, 6, 'rgba(0,0,0,0.2)', 8, 20);
  }

  /** Metal: escovado fino, riscos, sujeira escorrida e pontos de ferrugem (branco = a cor). */
  private drawMetalSurface(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = this.rng.chance(0.5) ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      const y = this.rng.range(0, s);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + this.rng.range(-2, 2));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 30; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.rng.range(-20, 20), y + this.rng.range(-20, 20));
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = this.rng.range(0, s);
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(60,45,30,0)');
      g.addColorStop(1, 'rgba(60,45,30,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(x, this.rng.range(0, s * 0.5), this.rng.range(4, 14), s);
    }
    this.blotches(ctx, s, 6, 'rgba(140,70,30,0.25)', 3, 10);
  }

  /** Plástico/fibra: granulado, marcas de molde, sujeira e desbotado de sol. */
  private drawPlasticSurface(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = this.rng.chance(0.5) ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(this.rng.range(0, s), this.rng.range(0, s), 1.5, 1.5);
    }
    this.blotches(ctx, s, 8, 'rgba(255,255,255,0.12)', 20, 60);
    this.blotches(ctx, s, 10, 'rgba(70,55,35,0.12)', 8, 30);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0.7, 'rgba(60,45,30,0)');
    g.addColorStop(1, 'rgba(60,45,30,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  /** Saco plástico amassado: vincos claros (brilho) e escuros em várias direções. */
  private drawBagSurface(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      const a = this.rng.range(0, Math.PI);
      const l = this.rng.range(15, 70);
      ctx.strokeStyle = this.rng.chance(0.5) ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.3)';
      ctx.lineWidth = this.rng.range(1, 3.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    this.blotches(ctx, s, 12, 'rgba(0,0,0,0.12)', 10, 40);
  }

  /** Ferrugem: laranja-marrom em manchas, com descascado escuro. */
  private drawRustSurface(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#6b3d26';
    ctx.fillRect(0, 0, s, s);
    this.blotches(ctx, s, 40, 'rgba(160,80,30,0.45)', 6, 26);
    this.blotches(ctx, s, 25, 'rgba(40,20,10,0.5)', 3, 14);
    this.speckle(ctx, s, 0.12);
  }

  /** Pedra da estátua: tom de pedra-sabão, manchas, escorridos de chuva e liquens. */
  private drawStatueStone(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#d6d0c2';
    ctx.fillRect(0, 0, s, s);
    this.blotches(ctx, s, 60, 'rgba(160,150,130,0.25)', 10, 50);
    this.blotches(ctx, s, 40, 'rgba(240,236,226,0.3)', 8, 40);
    for (let i = 0; i < 70; i++) {
      const x = this.rng.range(0, s);
      const y0 = this.rng.range(0, s);
      const l = this.rng.range(40, 200);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + l);
      g.addColorStop(0, 'rgba(70,65,55,0.28)');
      g.addColorStop(1, 'rgba(70,65,55,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, this.rng.range(2, 6), l);
    }
    this.blotches(ctx, s, 14, 'rgba(110,120,70,0.22)', 6, 22);
    this.speckle(ctx, s, 0.1);
  }

  /** Encosta vista de longe: copas de árvores em tufos, clareiras de capim e barranco. */
  private drawHillVegetation(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#3f6a2c';
    ctx.fillRect(0, 0, s, s);
    // Capim mais claro e barrancos de terra.
    this.blotches(ctx, s, 26, 'rgba(140,150,70,0.35)', 20, 70);
    this.blotches(ctx, s, 10, 'rgba(130,90,55,0.45)', 10, 35);
    // Copas: bolinhas sombreadas (luz de cima à esquerda).
    for (let i = 0; i < 1400; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      const r = this.rng.range(4, 11);
      const tone = this.rng.range(-20, 25);
      ctx.fillStyle = `rgba(0,0,0,0.25)`;
      ctx.beginPath();
      ctx.arc(x + r * 0.35, y + r * 0.35, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${50 + tone},${92 + tone},${38 + tone * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,230,140,0.18)';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Detalhe do relevo (multiplica a cor dos vértices): folhinhas de capim, torrões e pedriscos. */
  private drawTerrainDetail(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    this.blotches(ctx, s, 40, 'rgba(255,255,255,0.4)', 14, 50);
    this.blotches(ctx, s, 30, 'rgba(0,0,0,0.07)', 10, 40);
    for (let i = 0; i < 5000; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      ctx.strokeStyle = this.rng.chance(0.5) ? 'rgba(255,255,230,0.35)' : 'rgba(20,30,10,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.rng.range(-2, 2), y - this.rng.range(3, 8));
      ctx.stroke();
    }
    this.speckle(ctx, s, 0.08);
  }

  /** Material de cartão de folhas: teste de transparência (recorte), dois lados, sombra recortada. */
  private cardMat(name: string, tex: DynamicTexture): StandardMaterial {
    const m = this.make(name, '#ffffff', { tex, spec: 0.08, power: 16, emissive: 0.08 });
    tex.hasAlpha = true;
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    // A transparência da textura só entra no teste de recorte com isto ligado (sem, o fundo
    // transparente saía preto); o modo continua sendo recorte, não mistura.
    m.useAlphaFromDiffuseTexture = true;
    m.transparencyMode = Material.MATERIAL_ALPHATEST;
    m.alphaCutOff = 0.42;
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
    return m;
  }

  /** Cacho de folhas visto de perto: dezenas de folhas pontudas com nervura, sombreadas. */
  private drawLeafCard(ctx: Ctx, s: number, cols: string[]): void {
    ctx.clearRect(0, 0, s, s);
    const c = s / 2;
    // Folha pintada: forma lobada (tipo carvalho), metade de cima clara, metade de baixo
    // sombreada, nervura clara e contorno escuro fino (desenho limpo, sem ruído de foto).
    const leaf = (x: number, y: number, len: number, a: number, col: string, shade: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      const shape = () => {
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        for (let k = 0; k <= 6; k++) {
          const t = -len + (2 * len * k) / 6;
          const wv = Math.sin(((t + len) / (2 * len)) * Math.PI) * len * 0.5 * (k % 2 ? 1 : 0.78);
          ctx.lineTo(t, -wv);
        }
        for (let k = 6; k >= 0; k--) {
          const t = -len + (2 * len * k) / 6;
          const wv = Math.sin(((t + len) / (2 * len)) * Math.PI) * len * 0.5 * (k % 2 ? 1 : 0.78);
          ctx.lineTo(t, wv);
        }
        ctx.closePath();
      };
      shape();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(20,60,10,0.55)';
      ctx.stroke();
      ctx.save();
      shape();
      ctx.clip();
      ctx.fillStyle = `rgba(10,40,5,${shade})`;
      ctx.fillRect(-len, 0, len * 2, len);
      ctx.fillStyle = 'rgba(255,255,200,0.18)';
      ctx.fillRect(-len, -len, len * 2, len * 0.6);
      ctx.restore();
      ctx.strokeStyle = 'rgba(230,255,190,0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-len * 0.85, 0);
      ctx.lineTo(len * 0.85, 0);
      ctx.stroke();
      ctx.restore();
    };
    // Galhinhos por baixo.
    ctx.strokeStyle = 'rgba(70,50,30,1)';
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      ctx.lineWidth = this.rng.range(2, 4);
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4);
      ctx.stroke();
    }
    // De baixo (folhas escuras, no meio do cacho) para cima (claras, na borda e no alto).
    for (let i = 0; i < 150; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * s * 0.42;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r * 0.92;
      const depth = r / (s * 0.42);
      const light = Math.min(1, depth * 0.7 + (1 - y / s) * 0.5);
      const col = cols[Math.min(cols.length - 2, Math.floor(light * (cols.length - 1)))];
      leaf(x, y, this.rng.range(s * 0.06, s * 0.1), this.rng.range(0, Math.PI), i % 7 === 0 ? cols[cols.length - 1] : col, 0.22 - light * 0.12);
    }
  }

  /** Folha de coqueiro: folíolos compridos e finos saindo da nervura, em diagonal. */
  private drawPalmCard(ctx: Ctx, s: number): void {
    ctx.clearRect(0, 0, s, s);
    const cols = ['#4f8a2c', '#5e9a34', '#6faa3c', '#3f7426', '#8ab84a'];
    for (let i = 0; i < 46; i++) {
      const x = (i / 46) * s;
      const len = s * this.rng.range(0.75, 0.95);
      ctx.save();
      ctx.translate(x, s * 0.02);
      ctx.rotate(this.rng.range(0.35, 0.55));
      ctx.fillStyle = cols[Math.floor(this.rng.range(0, cols.length))];
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.lineTo(1, len);
      ctx.lineTo(-1, len);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, 1.5, len * 0.9);
      ctx.restore();
    }
    ctx.fillStyle = '#c9b46a';
    ctx.fillRect(0, 0, s, s * 0.03);
  }

  /** Casca de árvore: base marrom, sulcos verticais irregulares, placas claras e musgo. */
  private drawBark(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#7a5134';
    ctx.fillRect(0, 0, s, s);
    // Placas da casca (faixas verticais largas, tons quentes de desenho).
    for (let x = 0; x < s; ) {
      const w = this.rng.range(14, 34);
      const t = this.rng.range(-14, 18);
      ctx.fillStyle = `rgb(${128 + t},${86 + t * 0.8},${56 + t * 0.6})`;
      ctx.fillRect(x, 0, w, s);
      x += w;
    }
    // Sulcos escuros ondulando de cima a baixo (repetem nas bordas).
    for (let i = 0; i < 10; i++) {
      let x = this.rng.range(0, s);
      ctx.strokeStyle = `rgba(60,35,18,${this.rng.range(0.45, 0.7)})`;
      ctx.lineWidth = this.rng.range(1.5, 4);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= s; y += 16) {
        x += this.rng.range(-4, 4);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Rachaduras horizontais curtas e musgo.
    ctx.strokeStyle = 'rgba(20,12,6,0.6)';
    for (let i = 0; i < 40; i++) {
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.rng.range(4, 12), y + this.rng.range(-2, 2));
      ctx.stroke();
    }
    this.blotches(ctx, s, 10, 'rgba(90,110,40,0.28)', 10, 35);
    this.speckle(ctx, s, 0.06);
  }

  /** Ponta cortada de tronco: anéis de crescimento, rachaduras radiais e casca na borda. */
  private drawWoodEnd(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#c49a68';
    ctx.fillRect(0, 0, s, s);
    const c = s / 2;
    for (let r = s * 0.5; r > 2; r -= this.rng.range(3, 7)) {
      ctx.strokeStyle = `rgba(110,70,35,${this.rng.range(0.25, 0.55)})`;
      ctx.lineWidth = this.rng.range(0.8, 2);
      ctx.beginPath();
      ctx.ellipse(c + this.rng.range(-2, 2), c + this.rng.range(-2, 2), r, r * 0.96, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(40,24,10,0.7)';
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      ctx.lineWidth = this.rng.range(1, 2.5);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 6, c + Math.sin(a) * 6);
      ctx.lineTo(c + Math.cos(a) * s * this.rng.range(0.25, 0.48), c + Math.sin(a) * s * this.rng.range(0.25, 0.48));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(70,40,15,0.5)';
    ctx.beginPath();
    ctx.arc(c, c, 5, 0, Math.PI * 2);
    ctx.fill();
    this.speckle(ctx, s, 0.05);
  }

  /** Chão de mata: terra escura e úmida coberta de folhas secas e verdes, gravetos. */
  private drawForestFloor(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#4a3a26';
    ctx.fillRect(0, 0, s, s);
    this.blotches(ctx, s, 40, 'rgba(30,22,12,0.35)', 20, 70);
    this.blotches(ctx, s, 25, 'rgba(70,80,40,0.25)', 15, 50);
    const leaf = (x: number, y: number, len: number, a: number, col: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
    };
    const cols = ['#8a5a2a', '#a8742f', '#6e4a22', '#5b6b2a', '#c08a3a', '#7a3e1e', '#4f5f24'];
    for (let i = 0; i < 900; i++) {
      leaf(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(4, 11), this.rng.range(0, Math.PI), cols[Math.floor(this.rng.range(0, cols.length))]);
    }
    ctx.strokeStyle = 'rgba(60,40,22,0.9)';
    for (let i = 0; i < 40; i++) {
      ctx.lineWidth = this.rng.range(1.5, 3);
      const x = this.rng.range(0, s);
      const y = this.rng.range(0, s);
      const a = this.rng.range(0, Math.PI);
      const l = this.rng.range(15, 45);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }

  private drawProduct(ctx: Ctx, s: number, name: string, bg: string, fg: string, weight: string): void {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = fg;
    ctx.fillRect(0, s * 0.28, s, s * 0.34);
    ctx.fillStyle = bg;
    ctx.font = `900 ${s * 0.2}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, s / 2, s * 0.45, s * 0.92);
    ctx.fillStyle = fg;
    ctx.font = `700 ${s * 0.13}px Arial, sans-serif`;
    ctx.fillText(weight, s / 2, s * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(s * 0.08, s * 0.06, s * 0.1, s * 0.88);
    this.speckle(ctx, s, 0.03);
  }

  /** Piso cerâmico 4 x 4 (1 tile = 1 m), juntas cinza e leve sujeira. */
  private drawFloorTiles(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#b9b6ae';
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = ctx.createLinearGradient(i * t, j * t, i * t + t, j * t + t);
        const tone = 228 + Math.floor(this.rng.range(-8, 6));
        g.addColorStop(0, `rgb(${tone},${tone - 2},${tone - 6})`);
        g.addColorStop(1, `rgb(${tone - 12},${tone - 14},${tone - 18})`);
        ctx.fillStyle = g;
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
    this.blotches(ctx, s, 6, 'rgba(90,80,60,0.12)', 10, 40);
  }

  private drawOffer(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#ffd21f';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#d8312c';
    ctx.fillRect(0, 0, s, s * 0.32);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${s * 0.2}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OFERTA!', s / 2, s * 0.17);
    ctx.fillStyle = '#d8312c';
    ctx.font = `900 ${s * 0.3}px Impact, "Arial Black", sans-serif`;
    ctx.fillText('R$ 4,99', s / 2, s * 0.58);
    ctx.fillStyle = '#1b1420';
    ctx.font = `700 ${s * 0.1}px Arial, sans-serif`;
    ctx.fillText('LEVE 3 PAGUE 2', s / 2, s * 0.85);
  }

  /**
   * Fachada de casinha para os morros do horizonte (uma face de caixa = uma casa de 2
   * andares): reboco, duas janelas em cada andar, porta, borda da laje e sujeira na base.
   */
  private drawBgFacade(ctx: Ctx, s: number, brick: boolean): void {
    if (brick) this.drawBricks(ctx, s);
    else this.drawNoise(ctx, s, '#ffffff', 0.1, 0.18);
    const u = s / 16;
    // Bordas de laje (concreto) em cima e no meio.
    ctx.fillStyle = 'rgba(190,186,178,1)';
    ctx.fillRect(0, 0, s, u * 1.2);
    ctx.fillRect(0, s * 0.5 - u * 0.5, s, u);
    // Janelas (vidro escuro com moldura clara) e porta.
    const win = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = '#e8e2d4';
      ctx.fillRect(x - u * 0.3, y - u * 0.3, w + u * 0.6, h + u * 0.6);
      ctx.fillStyle = '#26303d';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(160,200,230,0.35)';
      ctx.fillRect(x, y, w * 0.45, h * 0.5);
    };
    win(u * 2.5, u * 3, u * 4, u * 3.2);
    win(u * 9.5, u * 3, u * 4, u * 3.2);
    win(u * 9.5, u * 10.5, u * 4, u * 3);
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(u * 2.8, u * 10, u * 3.2, u * 6);
    // Sujeira escorrida da laje e na base.
    const g = ctx.createLinearGradient(0, s * 0.82, 0, s);
    g.addColorStop(0, 'rgba(80,60,40,0)');
    g.addColorStop(1, 'rgba(80,60,40,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, s * 0.82, s, s * 0.18);
  }

  /** Luminoso de táxi: TÁXI em preto sobre amarelo-claro (as faces da caixa repetem o letreiro). */
  private drawTaxiSign(ctx: Ctx, w: number, h: number): void {
    ctx.fillStyle = '#fff4c2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1a18';
    ctx.font = `900 ${h * 0.72}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TÁXI', w / 2, h * 0.54);
  }

  /**
   * Grafites e pichações com fundo transparente. 0–2: pichação de letras retas e altas
   * (estilo paulistano); 3–5: "bomb" de letras redondas com contorno; 6–7: tag rabiscada.
   */
  private drawGraffiti(ctx: Ctx, w: number, h: number, i: number): void {
    const words = ['VILA', 'CRIA', 'ZN', 'PAZ', 'LOKO', 'RAP', 'FÉ', 'ZL', 'MORRO', 'AMOR'];
    const word = words[(i * 3 + 1) % words.length];
    const palette = ['#1b1a1f', '#d8242c', '#1f4fd0', '#f2c21b', '#2bb35b', '#ff4fa3', '#ffffff', '#7a3bd0'];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (i < 3) {
      // Pichação: hastes verticais compridas com pontas em ângulo, em linha.
      ctx.strokeStyle = i === 1 ? '#1d1d22' : i === 2 ? '#3a1414' : '#111114';
      ctx.lineWidth = h * 0.05;
      const n = 6 + i;
      for (let q = 0; q < n; q++) {
        const x = w * (0.08 + (q / n) * 0.84);
        const top = h * this.rng.range(0.12, 0.25);
        const bottom = h * this.rng.range(0.78, 0.9);
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        ctx.lineTo(x, top);
        ctx.lineTo(x + w * this.rng.range(0.03, 0.06), top - h * this.rng.range(0.02, 0.08));
        if (this.rng.chance(0.5)) {
          ctx.moveTo(x, h * 0.5);
          ctx.lineTo(x + w * 0.05, h * this.rng.range(0.4, 0.6));
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(w * 0.06, h * 0.93);
      ctx.lineTo(w * 0.94, h * 0.9);
      ctx.lineWidth = h * 0.025;
      ctx.stroke();
      return;
    }
    const font = i < 6 ? `900 ${h * 0.68}px "Arial Black", Impact, sans-serif` : `italic 700 ${h * 0.55}px "Segoe Script", "Brush Script MT", cursive`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fill = palette[(i * 5 + 2) % palette.length];
    const outline = palette[(i * 3 + 1) % palette.length] === fill ? '#1b1a1f' : palette[(i * 3 + 1) % palette.length];
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.rng.range(-0.08, 0.08));
    const scale = Math.min(1, (w * 0.86) / ctx.measureText(word).width);
    ctx.scale(scale, 1);
    if (i < 6) {
      ctx.lineWidth = h * 0.12;
      ctx.strokeStyle = '#141318';
      ctx.strokeText(word, 0, 0);
      ctx.lineWidth = h * 0.06;
      ctx.strokeStyle = outline;
      ctx.strokeText(word, 0, 0);
      ctx.fillStyle = fill;
      ctx.fillText(word, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(word, -h * 0.02, -h * 0.04);
    } else {
      ctx.lineWidth = h * 0.03;
      ctx.strokeStyle = fill;
      ctx.strokeText(word, 0, 0);
    }
    ctx.restore();
    // Respingos de spray.
    for (let q = 0; q < 40; q++) {
      ctx.fillStyle = `${fill}88`;
      ctx.fillRect(this.rng.range(w * 0.05, w * 0.95), this.rng.range(h * 0.1, h * 0.95), 1.5, 1.5);
    }
  }

  private drawStone(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#6d6862';
    ctx.fillRect(0, 0, s, s);
    const tones = ['#8d877d', '#a39c90', '#7b766e', '#958b7c', '#b0a898'];
    let y = 0;
    while (y < s) {
      const h = this.rng.range(28, 48);
      let x = -this.rng.range(0, 30);
      while (x < s) {
        const w = this.rng.range(34, 70);
        ctx.fillStyle = this.rng.pick(tones);
        ctx.beginPath();
        const r = 9;
        ctx.roundRect(x + 3, y + 3, w - 6, h - 6, r);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x + 6, y + 5, w - 14, 3);
        x += w;
      }
      y += h;
    }
    this.speckle(ctx, s, 0.06);
  }

  private drawTile(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#b5523a';
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#c7643f' : '#bd5a38';
        ctx.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
      }
    }
    this.speckle(ctx, s, 0.05);
  }

  private drawCorrugated(ctx: Ctx, s: number, base: string, horizontal = false): void {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const waves = 8;
    for (let i = 0; i < waves; i++) {
      const p = (i / waves) * s;
      const g = horizontal ? ctx.createLinearGradient(0, p, 0, p + s / waves) : ctx.createLinearGradient(p, 0, p + s / waves, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.22)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      if (horizontal) ctx.fillRect(0, p, s, s / waves);
      else ctx.fillRect(p, 0, s / waves, s);
    }
    this.blotches(ctx, s, 5, 'rgba(110,80,50,0.18)', 10, 30);
  }

  /**
   * Folhagem densa (multiplica a cor da copa): fundo escuro entre as folhas, camadas de
   * folhas com nervura, lado iluminado e lado na sombra. Antes eram pontinhos esparsos e a
   * copa parecia um bloco verde liso.
   */
  private drawLeaves(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#5a6a50';
    ctx.fillRect(0, 0, s, s);
    const leaf = (x: number, y: number, len: number, a: number, light: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      const v = Math.round(150 + light * 105);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(1.5, 1.5, len, len * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${v},${Math.min(255, v + 12)},${Math.round(v * 0.8)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,60,20,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
    };
    // Três camadas: do fundo (escuras) para a frente (claras).
    for (const [n, light] of [[260, 0.15], [220, 0.5], [160, 0.85]] as const) {
      for (let i = 0; i < n; i++) leaf(this.rng.range(0, s), this.rng.range(0, s), this.rng.range(6, 13), this.rng.range(0, Math.PI), light * this.rng.range(0.8, 1.1));
    }
  }

  private drawWood(ctx: Ctx, s: number): void {
    ctx.fillStyle = '#a07040';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = this.rng.pick(['rgba(80,50,25,0.35)', 'rgba(190,140,90,0.25)']);
      ctx.lineWidth = this.rng.range(1, 3);
      const y = this.rng.range(0, s);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + this.rng.range(-4, 4), s * 0.6, y + this.rng.range(-4, 4), s, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,10,0.5)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * s) / 4, s, 2);
  }

  private drawFence(ctx: Ctx, s: number): void {
    ctx.strokeStyle = 'rgba(200,205,210,1)';
    ctx.lineWidth = 2;
    const step = s / 8;
    for (let i = -8; i < 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step + s, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * step + s, 0);
      ctx.lineTo(i * step, s);
      ctx.stroke();
    }
  }

  /** Gradiente para sombra de contato: escuro embaixo (V = 0), some em cima. */
  private drawContact(ctx: Ctx, s: number): void {
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  private drawStripes(ctx: Ctx, s: number, a: string, b: string): void {
    const n = 8;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 === 0 ? a : b;
      ctx.fillRect((i * s) / n, 0, s / n, s);
    }
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  private speckle(ctx: Ctx, s: number, density: number): void {
    const count = Math.floor(s * s * density);
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(0,0,0,${this.rng.range(0, 0.12)})`;
      ctx.fillRect(this.rng.int(0, s - 1), this.rng.int(0, s - 1), 1, 1);
    }
  }
}

/** Clareia/escurece uma cor hex em `amount` (−255..255). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}
