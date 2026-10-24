import { DynamicTexture, Scene, Texture } from '@babylonjs/core';
import { HairStyle } from '../appearance/Styles';
import { Rng } from '../utils/random';

type Ctx = CanvasRenderingContext2D;

/** Cache por cena + chave: dez personagens iguais não geram texturas repetidas. */
const cache = new Map<string, DynamicTexture>();

function makeTexture(scene: Scene, name: string, w: number, h: number, draw: (ctx: Ctx) => void, alpha = false, wrapV = false): DynamicTexture {
  const key = `${scene.uid}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as Ctx;
  if (alpha) ctx.clearRect(0, 0, w, h);
  draw(ctx);
  tex.update();
  tex.hasAlpha = alpha;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = wrapV ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  cache.set(key, tex);
  return tex;
}

/** Fios de cabelo com luzes/reflexos; `fade` apaga a base (degradê). */
export function createHairTexture(scene: Scene, id: string, s: HairStyle, fade: 'none' | 'low' | 'high'): DynamicTexture {
  const S = 256;
  const rng = new Rng(id.length * 7 + fade.length);
  return makeTexture(
    scene,
    `tex_hair_${id}_${fade}`,
    S,
    S,
    (ctx) => {
      ctx.fillStyle = s.base;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 520; i++) {
        const x = rng.range(0, S);
        const len = rng.range(20, 90);
        const y = rng.range(-20, S);
        ctx.strokeStyle = rng.chance(0.5) ? s.dark : s.base;
        ctx.globalAlpha = rng.range(0.5, 1);
        ctx.lineWidth = rng.range(1, 2.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + rng.range(-6, 6), y + len / 2, x + rng.range(-8, 8), y + len);
        ctx.stroke();
      }
      const n = Math.floor(260 * s.amount);
      for (let i = 0; i < n; i++) {
        const x = rng.range(0, S);
        const y = rng.range(-10, S * 0.65);
        const len = rng.range(15, 60);
        ctx.strokeStyle = s.highlight;
        ctx.globalAlpha = rng.range(0.35, 0.9) * (1 - y / (S * 0.8));
        ctx.lineWidth = rng.range(1, 2.4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rng.range(-5, 5), y + len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (fade !== 'none') {
        ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createLinearGradient(0, 0, 0, S);
        const start = fade === 'high' ? 0.35 : 0.6;
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(start, 'rgba(0,0,0,1)');
        g.addColorStop(Math.min(0.95, start + 0.3), 'rgba(0,0,0,0.3)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
    fade !== 'none',
  );
}

/** Pele com variação sutil (evita aspecto de plástico). */
export function createSkinTexture(scene: Scene): DynamicTexture {
  const S = 128;
  const rng = new Rng(5);
  return makeTexture(
    scene,
    'tex_skin',
    S,
    S,
    (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(150,70,40,${rng.range(0, 0.06)})`;
        ctx.fillRect(rng.int(0, S), rng.int(0, S), 2, 2);
      }
    },
    false,
    true,
  );
}
