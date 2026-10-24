import { Color3, Constants, PBRMaterial, RawCubeTexture, Scene } from '@babylonjs/core';
import type { GlassesDef } from '../customization/glasses';

/**
 * Materiais PBR dos óculos. A cena não tem mapa de ambiente, e metal ou lente espelhada sem
 * nada para refletir ficam pretos; por isso os óculos usam um "estúdio" próprio, pequeno e
 * gerado por código: céu claro em cima, faixa de horizonte bem clara, chão escuro embaixo e
 * duas luzes verticais (softboxes). É o que dá o degradê das lentes espelhadas e o brilho do
 * metal, como nas referências (o mesmo estúdio é usado nas miniaturas, em glasses.py).
 */
const SIZE = 64;
let studio: RawCubeTexture | null = null;

function studioCube(scene: Scene): RawCubeTexture {
  if (studio && studio.getScene() === scene) return studio;
  const faces: Uint8Array[] = [];
  // Ordem do Babylon: +X, -X, +Y, -Y, +Z, -Z.
  const dirs = [
    (u: number, v: number) => [1, -v, -u],
    (u: number, v: number) => [-1, -v, u],
    (u: number, v: number) => [u, 1, v],
    (u: number, v: number) => [u, -1, -v],
    (u: number, v: number) => [u, -v, 1],
    (u: number, v: number) => [-u, -v, -1],
  ];
  for (const dir of dirs) {
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const [x, y, z] = dir(((i + 0.5) / SIZE) * 2 - 1, ((j + 0.5) / SIZE) * 2 - 1);
        const l = Math.hypot(x, y, z);
        const h = y / l;
        let r: number, g: number, b: number;
        if (h > 0.06) {
          const t = Math.min(1, (h - 0.06) / 0.7);
          r = 235 - 90 * t;
          g = 240 - 70 * t;
          b = 250 - 35 * t;
        } else if (h > -0.04) {
          r = g = b = 255; // horizonte bem claro
        } else {
          const t = Math.min(1, (-h - 0.04) / 0.5);
          r = 70 - 50 * t;
          g = 68 - 48 * t;
          b = 66 - 44 * t;
        }
        // Duas softboxes verticais (faixas de luz que aparecem nas lentes e no metal).
        const az = Math.atan2(x, z);
        for (const c of [0.7, -2.2]) {
          const d = Math.abs(Math.atan2(Math.sin(az - c), Math.cos(az - c)));
          if (d < 0.12 && h > -0.3 && h < 0.75) r = g = b = 255;
        }
        const k = (j * SIZE + i) * 4;
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
      }
    }
    faces.push(data);
  }
  studio = new RawCubeTexture(scene, faces, SIZE, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true);
  studio.name = 'oculos_estudio';
  return studio;
}

const cache = new Map<string, { frame: PBRMaterial; accent: PBRMaterial; lens: PBRMaterial }>();

const studioCache = new Map<string, PBRMaterial>();

/**
 * Material PBR com o reflexo do estúdio (metais, lentes, pedras). Compartilhado por nome:
 * todos os personagens com a mesma peça usam o mesmo material.
 */
export function studioMaterial(scene: Scene, name: string, hex: string, metallic: number, roughness: number, envIntensity = 1.1): PBRMaterial {
  const key = `${scene.uid}:${name}`;
  const hit = studioCache.get(key);
  if (hit) return hit;
  const m = pbr(scene, name, hex, metallic, roughness);
  m.environmentIntensity = envIntensity;
  studioCache.set(key, m);
  return m;
}

function pbr(scene: Scene, name: string, hex: string, metallic: number, roughness: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  m.metallic = metallic;
  m.roughness = roughness;
  m.reflectionTexture = studioCube(scene);
  m.environmentIntensity = 1.1;
  return m;
}

/** Armação, detalhes e lente de uma variação (criados uma vez por cena e compartilhados). */
export function glassesMaterials(scene: Scene, g: GlassesDef): { frame: PBRMaterial; accent: PBRMaterial; lens: PBRMaterial } {
  const key = `${scene.uid}:${g.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const metal = g.frameMetal;
  const mats = {
    frame: pbr(scene, `oculos_armacao_${g.id}`, g.frame, metal, metal > 0.5 ? 0.28 : 0.45),
    accent: pbr(scene, `oculos_detalhe_${g.id}`, g.accent, metal, 0.32),
    // Lente espelhada: metal tingido pela cor da lente, quase sem rugosidade. Lente escura
    // (pouco espelhada): reflete pouco e fica escura.
    lens: pbr(scene, `oculos_lente_${g.id}`, g.lens, g.mirror, 0.05),
  };
  if (g.mirror < 0.5) mats.lens.environmentIntensity = 0.6;
  cache.set(key, mats);
  return mats;
}
