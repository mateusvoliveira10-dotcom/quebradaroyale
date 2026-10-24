import { Color3, Engine, MaterialPluginBase, PBRMaterial, Scene, SubMesh, UniformBuffer } from '@babylonjs/core';
import { Appearance } from '../appearance/Appearance';
import { HAIRS } from '../appearance/Styles';
import { bottomById } from '../customization/garments';
import { CollarType, jerseyById } from '../customization/jerseys';

/** Atributo por vértice: x = peso dos ossos do braço, y = posição ao longo do braço (0 ombro, 1 punho). */
export const CHAR_PART_ATTRIBUTE = 'charPart';

const lin = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

/** Pele coberta pela camisa equipada: 0 = sem camisa, 1 = manga curta, 3 = manga longa, 4 = regata. */
type Cover = 0 | 1 | 3 | 4;
const COVER: Record<CollarType, Cover> = { crew: 1, long: 3, tank: 4 };

interface ClothingParams {
  cover: Cover;
  /** Altura (m, pose de repouso) onde a parte de baixo termina. */
  legEnd: number;
  /** 1 = bermuda (aparecem meias entre a barra e o tênis). */
  shorts: number;
  hairBase: Color3;
  hairDark: Color3;
  hairHi: Color3;
  hairAmount: number;
  /** Linha do cabelo na nuca/laterais e largura do degradê. */
  hairLine: number;
  hairFade: number;
}

/**
 * Material do corpo do personagem-base. Camisa, parte de baixo e tênis são
 * malhas 3D à parte (GarmentAsset); aqui o corpo só descarta a pele que elas
 * cobrem, para braços, pernas e tronco nunca atravessarem o tecido, e pinta
 * o que fica direto no corpo: meias (com bermuda) e o degradê do cabelo.
 *
 * As regras são as mesmas dos scripts do Blender (convertidas do Blender para o
 * glTF: y = altura, z = frente), usando a posição de repouso de cada vértice:
 *   camisa (`jerseys.py`, só gola redonda): tronco 0,90 < y < decote − 0,035, com
 *   decote = 1,415 − 0,25·z perto do pescoço (|x| < 0,12), limitado a 1,46; mangas:
 *   braço com t < 0,34 (manga curta) ou t < 0,89 (manga longa); regata: decote 1,5 cm
 *   mais fundo, alças até 1,445, sem manga, tronco só do lado de dentro da cava
 *   ((|x| − 0,17)·0,28 + (y − 1,43)·0,04 ≤ 0);
 *   parte de baixo (`garments.py`): fim da peça + 0,02 < y < 0,915 (fora dos braços);
 *   tênis (`garments.py`): y < 0,115 (fora dos braços).
 */
class ClothingPlugin extends MaterialPluginBase {
  params: ClothingParams | null = null;

  constructor(material: PBRMaterial) {
    super(material, 'Clothing', 200, { CLOTHING: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'ClothingPlugin';
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.CLOTHING = true;
  }

  override isReadyForSubMesh(): boolean {
    return this.params !== null;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(CHAR_PART_ATTRIBUTE);
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'clCover', size: 1, type: 'float' },
        { name: 'clHairBase', size: 3, type: 'vec3' },
        { name: 'clHairDark', size: 3, type: 'vec3' },
        { name: 'clHairHi', size: 4, type: 'vec4' },
        { name: 'clParams', size: 4, type: 'vec4' },
        { name: 'clHair', size: 2, type: 'vec2' },
      ],
      fragment: `
        uniform float clCover;
        uniform vec3 clHairBase;
        uniform vec3 clHairDark;
        uniform vec4 clHairHi;
        uniform vec4 clParams;
        uniform vec2 clHair;`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    const p = this.params;
    if (!p) return;
    ubo.updateFloat('clCover', p.cover);
    ubo.updateColor3('clHairBase', p.hairBase);
    ubo.updateColor3('clHairDark', p.hairDark);
    ubo.updateFloat4('clHairHi', p.hairHi.r, p.hairHi.g, p.hairHi.b, p.hairAmount);
    ubo.updateFloat4('clParams', p.legEnd, 0, 0, p.shorts);
    ubo.updateFloat2('clHair', p.hairLine, p.hairFade);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef CLOTHING
          attribute vec2 ${CHAR_PART_ATTRIBUTE};
          varying vec3 vClPos;
          varying vec2 vClPart;
          #endif`,
        CUSTOM_VERTEX_MAIN_BEGIN: `
          #ifdef CLOTHING
          vClPos = position;
          vClPart = ${CHAR_PART_ATTRIBUTE};
          #endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef CLOTHING
        varying vec3 vClPos;
        varying vec2 vClPart;
        float clHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        #endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        float clCloth = 0.0;
        #ifdef CLOTHING
        {
          vec3 p = vClPos;
          float ax = abs(p.x);
          bool isArm = vClPart.x > 0.5;
          float armT = vClPart.y;
          vec3 col = surfaceAlbedo;
          // ---- pele coberta pelas roupas 3D: descarta para não atravessar o tecido
          if (clCover > 0.5 && p.y < 1.46) {
            bool tank = clCover > 3.5;
            // Gola redonda (a única): plano inclinado perto do pescoço; a regata é 1,5 cm mais
            // funda e tem alças até 1,445.
            float top = tank ? 1.445 : 1.46;
            float neck = ax < 0.12 ? min(top, 1.415 - (tank ? 0.015 : 0.0) - 0.25 * p.z) : top;
            bool torso;
            bool sleeve;
            // Pele mantida 3,5 cm abaixo do decote (sem vão visível entre a gola e o pescoço).
            if (tank) {
              // Regata: tudo do lado de dentro da cava (as alças ficam sobre a clavícula,
              // que pesa no osso do ombro), sem manga.
              torso = p.y > 0.90 && p.y < neck - 0.035 && (ax - 0.17) * 0.28 + (p.y - 1.43) * 0.04 <= 0.0;
              sleeve = false;
            } else {
              torso = !isArm && p.y > 0.90 && p.y < neck - 0.035;
              sleeve = isArm && armT < (clCover > 2.5 ? 0.89 : 0.34);
            }
            if (torso || sleeve) discard;
          }
          if (!isArm && p.y < 0.915 && p.y > clParams.x + 0.02) discard;
          if (!isArm && p.y < 0.115) discard;
          // ---- meias (só com bermuda), entre a barra e o tênis
          if (!isArm && clParams.w > 0.5 && p.y <= clParams.x && p.y < 0.215) {
            col = vec3(0.82);
            clCloth = 1.0;
          }
          // ---- cabelo (degradê pintado no couro cabeludo)
          if (!isArm && p.y > 1.55) {
            float front = smoothstep(-0.02, 0.09, p.z);
            float line = mix(clHair.x, 1.705, front);
            // Orelha: só o que se projeta além da lateral da cabeça (meia-largura ~0,099 ali;
            // a orelha vai de 0,106 a 0,124 entre z −0,02 e −0,06).
            float ear = smoothstep(0.099, 0.104, ax) * (1.0 - smoothstep(1.655, 1.665, p.y)) * step(-0.07, p.z) * step(p.z, 0.0);
            float h = smoothstep(line - 0.006, line + clHair.y, p.y) * (1.0 - ear);
            // Fios: células finas na horizontal (~1 mm) e longas na vertical (~8 mm), sem blocos.
            float n = clHash(floor(vec3(p.x * 950.0, p.y * 120.0, p.z * 950.0)));
            vec3 hc = mix(clHairBase, clHairDark, n * 0.8);
            hc = mix(hc, clHairHi.rgb, clHairHi.a * step(0.5, fract(n * 7.13)) * smoothstep(1.63, 1.74, p.y));
            col = mix(col, hc, h);
            // Cabelo raspado é fosco: sem isso o reflexo do céu deixava a faixa do degradê lilás.
            clCloth = max(clCloth, h);
          }
          surfaceAlbedo = col;
          #ifdef NORMAL
          normalW = normalize(mix(normalW, normalize(vNormalW), clCloth * 0.75));
          #endif
        }
        #endif`,
      // Meias e cabelo pintados: foscos e não metálicos.
      '!vec4 surfaceMetallicOrReflectivityColorMap=texture2D\\(reflectivitySampler,vReflectivityUV\\+uvOffset\\);':
        'vec4 surfaceMetallicOrReflectivityColorMap=texture2D(reflectivitySampler,vReflectivityUV+uvOffset);\n' +
        'surfaceMetallicOrReflectivityColorMap.g=mix(surfaceMetallicOrReflectivityColorMap.g,0.88,clCloth);\n' +
        'surfaceMetallicOrReflectivityColorMap.b=mix(surfaceMetallicOrReflectivityColorMap.b,0.0,clCloth);',
    };
  }
}

/** Tipo de gola da camisa equipada (null = sem camisa). */
export function coverOf(app: Appearance): CollarType | null {
  return app.jersey === 'none' ? null : (jerseyById(app.jersey)?.collar ?? null);
}

/** Onde a parte de baixo termina (o corpo esconde a pele de lá até o cós). */
function legEndOf(app: Appearance): number {
  return bottomById(app.bottom)?.end ?? 0.1;
}

function paramsFor(app: Appearance): ClothingParams {
  const collar = coverOf(app);
  const h = HAIRS[app.hair];
  const legEnd = legEndOf(app);
  return {
    cover: collar === null ? 0 : COVER[collar],
    legEnd,
    shorts: legEnd > 0.3 ? 1 : 0,
    hairBase: lin(h.base),
    hairDark: lin(h.dark),
    hairHi: lin(h.highlight),
    hairAmount: h.amount,
    hairLine: h.shape === 'high' ? 1.665 : 1.615,
    hairFade: h.shape === 'high' ? 0.045 : 0.03,
  };
}

const cache = new Map<string, PBRMaterial>();

/** Chave das partes da aparência que mudam o material do corpo. */
export function clothingKey(app: Appearance): string {
  // As roupas só influenciam o corpo pela pele que escondem (gola e fim da parte de baixo).
  return `${coverOf(app) ?? 'none'}|${legEndOf(app)}|${app.hair}`;
}

/**
 * Material do corpo para uma aparência. Personagens com a mesma combinação
 * compartilham o material; todos usam o mesmo shader (mesmos defines), então
 * uma roupa nova não recompila nada.
 */
export function clothingMaterial(scene: Scene, base: PBRMaterial, app: Appearance): PBRMaterial {
  const key = `${scene.uid}:${clothingKey(app)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = base.clone(`personagem_${clothingKey(app)}`) as PBRMaterial;
  const plugin = new ClothingPlugin(m);
  plugin.params = paramsFor(app);
  cache.set(key, m);
  return m;
}
