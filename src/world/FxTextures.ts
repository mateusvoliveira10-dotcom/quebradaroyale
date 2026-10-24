import { DynamicTexture, Scene } from '@babylonjs/core';

const cache = new WeakMap<Scene, Map<string, DynamicTexture>>();

function get(scene: Scene, key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  let m = cache.get(scene);
  if (!m) cache.set(scene, (m = new Map()));
  let t = m.get(key);
  if (!t) {
    t = new DynamicTexture(`fx_${key}`, { width: size, height: size }, scene, false);
    const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, size, size);
    draw(ctx, size);
    t.update();
    t.hasAlpha = true;
    m.set(key, t);
  }
  return t;
}

/** Ponto suave (fumaça, poeira, brilho): branco no centro, some na borda. */
export function softDot(scene: Scene): DynamicTexture {
  return get(scene, 'softDot', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Traço de vento: linha fina com pontas que somem (para partículas esticadas). */
export function streak(scene: Scene): DynamicTexture {
  return get(scene, 'streak', 64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(s * 0.44, 0, s * 0.12, s);
  });
}

/** Anel do ponto de pouso (borda forte, miolo transparente, cruz no centro). */
export function landingRing(scene: Scene): DynamicTexture {
  return get(scene, 'landingRing', 128, (ctx, s) => {
    const c = s / 2;
    ctx.lineWidth = s * 0.06;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(c, c, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = s * 0.03;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(c, c, s * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(c, c, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  });
}
