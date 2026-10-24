import { Color3, Scene, StandardMaterial, Texture } from '@babylonjs/core';
import type { MaterialMeta } from './Materials';

/**
 * Materiais "de verdade" do setor reconstruído (Fase 4): texturas PBR tileáveis geradas por
 * `tools/blender/textures.py` (cor + normal map), em escala real. Cada textura cobre:
 * tijolo 1,2 m · reboco 2,5 × 3 m (um pavimento) · concreto 2 m · telha 1,6 m ·
 * fibrocimento 1,1 m · asfalto 4 m · calçada 2 m · metal 1 m · madeira 1 × 2 m · piso 1,2 m.
 *
 * Ficam em StandardMaterial (como o resto do mapa): a cena não tem mapa de ambiente, e o
 * PBR sem reflexo escurece. O reboco e o metal são neutros e recebem a cor aqui.
 */
export const HQ_TILE = {
  tijolo: 1.2,
  rebocoU: 2.5,
  rebocoV: 3,
  concreto: 2,
  telha: 1.6,
  fibrocimento: 1.1,
  asfalto: 4,
  calcada: 2,
  metal: 1,
  madeira: 1,
  piso: 1.2,
  terra: 4,
  pedra: 2,
} as const;

/** Cores de tinta de parede (mais sóbrias que as do mapa antigo: tinta de verdade desbota). */
const PAINTS = ['#e9a7b8', '#9fd2c0', '#f0d27a', '#9cc3e6', '#c4b2e0', '#f2b38a', '#e8dfca', '#a9cf8f', '#e99a90', '#86c4c6', '#ead0b0', '#c3d98c'];
const GATE_COLORS = ['#2d5fb8', '#2f7d4a', '#a8322c', '#4a4d52', '#d8d2c4', '#6b3a22'];
const CURTAINS = ['#3a2a2a', '#2b3442', '#3d3a2a', '#402b3a', '#23302a', '#4a3b2a'];

export class MaterialsHQ {
  readonly tijolo: StandardMaterial;
  readonly concreto: StandardMaterial;
  readonly concretoEscuro: StandardMaterial;
  readonly telha: StandardMaterial;
  readonly fibrocimento: StandardMaterial;
  readonly asfalto: StandardMaterial;
  readonly calcada: StandardMaterial;
  readonly meioFio: StandardMaterial;
  readonly madeira: StandardMaterial;
  readonly piso: StandardMaterial;
  /** Reboco pintado (mesma ordem de cores de `Materials.paints`). */
  readonly reboco: StandardMaterial[];
  /** Reboco sem pintura (cinza). */
  readonly rebocoCru: StandardMaterial;
  /** Chapa pintada dos portões, com ferrugem. */
  readonly portoes: StandardMaterial[];
  readonly metalCru: StandardMaterial;
  /** Peças do kit (sem textura própria). */
  readonly aluminio: StandardMaterial;
  readonly vidro: StandardMaterial;
  readonly caixa: StandardMaterial;
  readonly plastico: StandardMaterial;
  readonly borracha: StandardMaterial;
  /** Fundo escuro visto pela janela (cortina/cômodo). */
  readonly interiores: StandardMaterial[];
  readonly calha: StandardMaterial;
  readonly terra: StandardMaterial;
  /** Terra do campinho (mais alaranjada, de saibro). */
  readonly campo: StandardMaterial;
  readonly pedra: StandardMaterial;
  /** Reboco do muro em volta da comunidade. */
  readonly muro: StandardMaterial;

  private readonly cache = new Map<string, Texture>();

  constructor(private readonly scene: Scene) {
    this.tijolo = this.make('hq_tijolo', 'tijolo', '#ffffff', { spec: 0.05 });
    this.concreto = this.make('hq_concreto', 'concreto', '#ffffff', {});
    this.concretoEscuro = this.make('hq_concretoEscuro', 'concreto', '#8a8780', {});
    this.telha = this.make('hq_telha', 'telha', '#ffffff', { spec: 0.12, power: 30, bump: 1.2 });
    this.fibrocimento = this.make('hq_fibro', 'fibrocimento', '#ffffff', { bump: 1.1 });
    this.asfalto = this.make('hq_asfalto', 'asfalto', '#ffffff', { shadow: false, bump: 0.7 });
    this.calcada = this.make('hq_calcada', 'calcada', '#ffffff', { shadow: false });
    this.meioFio = this.make('hq_meioFio', 'concreto', '#d6d1c6', {});
    this.madeira = this.make('hq_madeira', 'madeira', '#ffffff', { spec: 0.08 });
    this.piso = this.make('hq_piso', 'piso', '#e6d6c8', { spec: 0.18, power: 50, shadow: false });
    this.reboco = PAINTS.map((c, i) => this.make(`hq_reboco_${i}`, 'reboco', c, { bump: 0.8 }));
    this.rebocoCru = this.make('hq_reboco_cru', 'reboco', '#b9b4aa', { bump: 0.8 });
    this.portoes = GATE_COLORS.map((c, i) => this.make(`hq_portao_${i}`, 'metal', c, { spec: 0.25, power: 40 }));
    this.terra = this.make('hq_terra', 'terra', '#ffffff', { shadow: false });
    this.campo = this.make('hq_campo', 'terra', '#f2b98a', { shadow: false });
    this.pedra = this.make('hq_pedra', 'pedra', '#ffffff', { bump: 1.2 });
    this.muro = this.make('hq_muro', 'reboco', '#e6dfcf', { bump: 0.8 });
    this.metalCru = this.make('hq_metal', 'metal', '#9aa0a6', { spec: 0.35, power: 50 });

    this.aluminio = this.plain('hq_aluminio', '#c9ccd0', 0.6, 70);
    this.vidro = this.plain('hq_vidro', '#2a3a48', 1.0, 110);
    this.vidro.alpha = 0.55;
    this.vidro.backFaceCulling = false;
    (this.vidro.metadata as MaterialMeta).castShadow = false;
    this.caixa = this.plain('hq_caixa', '#2c6fd6', 0.3, 40);
    this.plastico = this.plain('hq_plastico', '#ecebe6', 0.2, 30);
    this.borracha = this.plain('hq_borracha', '#1c1d20', 0.05, 16);
    this.calha = this.plain('hq_calha', '#8d9196', 0.4, 50);
    this.interiores = CURTAINS.map((c, i) => {
      const m = this.make(`hq_interior_${i}`, 'madeira', c, { spec: 0, shadow: false, bump: 0 });
      // Sem luz do sol lá dentro: só um pouco do próprio tom (cômodo na penumbra).
      m.emissiveColor = Color3.FromHexString(c).scale(0.35);
      return m;
    });
  }

  /** Reboco pintado equivalente a uma tinta do mapa antigo (pelo índice em `Materials.paints`). */
  paint(index: number): StandardMaterial {
    return this.reboco[((index % this.reboco.length) + this.reboco.length) % this.reboco.length];
  }

  /** Material para o papel de uma peça do kit (`kit.glb`). */
  kitRole(role: string, gate?: StandardMaterial): StandardMaterial | null {
    switch (role) {
      case 'aluminio':
        return this.aluminio;
      case 'vidro':
        return this.vidro;
      case 'madeira':
        return this.madeira;
      case 'metal':
        return gate ?? this.metalCru;
      case 'concreto':
        return this.concreto;
      case 'caixa':
        return this.caixa;
      case 'plastico':
        return this.plastico;
      case 'borracha':
        return this.borracha;
      default:
        return this.concreto;
    }
  }

  private tex(file: string): Texture {
    let t = this.cache.get(file);
    if (!t) {
      t = new Texture(`${import.meta.env.BASE_URL}assets/world/tex/${file}.jpg`, this.scene);
      t.wrapU = Texture.WRAP_ADDRESSMODE;
      t.wrapV = Texture.WRAP_ADDRESSMODE;
      t.anisotropicFilteringLevel = 8;
      this.cache.set(file, t);
    }
    return t;
  }

  private make(name: string, tex: string, hex: string, o: { spec?: number; power?: number; shadow?: boolean; bump?: number }): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c;
    m.diffuseTexture = this.tex(`${tex}_cor`);
    if ((o.bump ?? 1) > 0) {
      const n = this.tex(`${tex}_normal`);
      m.bumpTexture = n;
      n.level = o.bump ?? 1;
    }
    m.specularColor = new Color3(1, 1, 1).scale(o.spec ?? 0.04);
    m.specularPower = o.power ?? 24;
    m.emissiveColor = c.scale(0.05);
    m.metadata = { castShadow: o.shadow ?? true } satisfies MaterialMeta;
    return m;
  }

  private plain(name: string, hex: string, spec: number, power: number): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = power;
    m.emissiveColor = c.scale(0.06);
    m.metadata = { castShadow: true } satisfies MaterialMeta;
    return m;
  }
}

/** `?mapaAntigo` (ou `?setorAntigo`) na URL: mapa com os materiais e casas antigos (comparação antes/depois). */
export const OLD_MAP = typeof location !== 'undefined' && /[?&](mapaAntigo|setorAntigo)\b/.test(location.search);