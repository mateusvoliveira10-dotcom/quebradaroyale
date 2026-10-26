/**
 * Grafite de spray pintado direto no canvas (placas grafitadas, atlas de pichações e o logo
 * do lobby). Em vez de um "adesivo" com fundo e borda lisa, a tinta tem névoa de spray
 * em volta, sombra 3D, brilho, escorridos e desgaste que deixa a parede aparecer.
 */
import { Rng } from '../utils/random';

type Ctx = CanvasRenderingContext2D;

export interface SprayPiece {
  word: string;
  /** Retângulo onde a peça cabe. */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: [string, string];
  outline: string;
  /** Cor da sombra 3D (extrusão para baixo e para a direita). */
  shadow?: string;
  /** Névoa de spray atrás das letras. */
  haze?: string;
  font?: string;
  rng: Rng;
}

/** Peça de letras gordas (bomb/throw-up) com névoa, extrusão, contorno, brilho e escorridos. */
export function sprayPiece(ctx: Ctx, o: SprayPiece): void {
  const { rng } = o;
  const font = (px: number) => `900 ${px}px ${o.font ?? '"Arial Black", Impact, sans-serif'}`;
  const size = o.h * 0.62;
  ctx.font = font(size);
  const tw = ctx.measureText(o.word).width;
  const sx = Math.min(1.05, (o.w * 0.86) / tw);
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rng.range(-0.07, 0.05));
  ctx.scale(sx, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Cada letra levemente torta e fora da linha (mão, não fonte de computador).
  const letters = [...o.word];
  const widths = letters.map((l) => ctx.measureText(l).width);
  const total = widths.reduce((a, b) => a + b, 0) * 0.94;
  const place: Array<{ l: string; x: number; y: number; r: number }> = [];
  let px = -total / 2;
  letters.forEach((l, i) => {
    place.push({ l, x: px + widths[i] / 2, y: rng.range(-0.05, 0.05) * size, r: rng.range(-0.09, 0.09) });
    px += widths[i] * 0.94;
  });
  const each = (draw: (l: string) => void, dx = 0, dy = 0) => {
    for (const p of place) {
      ctx.save();
      ctx.translate(p.x + dx, p.y + dy);
      ctx.rotate(p.r);
      draw(p.l);
      ctx.restore();
    }
  };

  // Névoa de spray (overspray) em volta das letras.
  if (o.haze) {
    ctx.save();
    ctx.shadowColor = o.haze;
    ctx.shadowBlur = size * 0.35;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = o.haze;
    each((l) => ctx.fillText(l, 0, 0));
    ctx.restore();
  }
  // Extrusão 3D (várias camadas) e contorno escuro grosso.
  const depth = size * 0.09;
  ctx.fillStyle = o.shadow ?? '#1a1420';
  ctx.strokeStyle = o.shadow ?? '#1a1420';
  ctx.lineWidth = size * 0.16;
  for (let k = 1; k <= 6; k++) each((l) => { ctx.strokeText(l, 0, 0); ctx.fillText(l, 0, 0); }, (depth * k) / 6, (depth * k) / 6);
  ctx.strokeStyle = '#121016';
  ctx.lineWidth = size * 0.17;
  each((l) => ctx.strokeText(l, 0, 0));
  ctx.strokeStyle = o.outline;
  ctx.lineWidth = size * 0.085;
  each((l) => ctx.strokeText(l, 0, 0));
  // Preenchimento em degradê de spray.
  const g = ctx.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
  g.addColorStop(0, o.fill[0]);
  g.addColorStop(1, o.fill[1]);
  ctx.fillStyle = g;
  each((l) => ctx.fillText(l, 0, 0));
  // Brilhos: traços brancos curtos no alto das letras.
  ctx.save();
  each((l) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-size, -size, size * 2, size * 0.75);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(l, -size * 0.025, -size * 0.04);
    ctx.restore();
  });
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = size * 0.025;
  for (const p of place) {
    if (!rng.chance(0.6)) continue;
    ctx.beginPath();
    ctx.moveTo(p.x - size * 0.15, p.y - size * 0.22);
    ctx.lineTo(p.x - size * 0.06, p.y - size * 0.25);
    ctx.stroke();
  }
  // Escorridos de tinta saindo da base das letras.
  for (const p of place) {
    if (!rng.chance(0.55)) continue;
    const x = p.x + rng.range(-0.2, 0.2) * size;
    const y0 = p.y + size * 0.3;
    const len = rng.range(0.15, 0.55) * size;
    ctx.strokeStyle = o.fill[1];
    ctx.lineWidth = rng.range(0.025, 0.045) * size;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + rng.range(-1, 1), y0 + len);
    ctx.stroke();
    ctx.fillStyle = o.fill[1];
    ctx.beginPath();
    ctx.arc(x, y0 + len, ctx.lineWidth * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Respingos finos de spray em volta (pontinhos soltos, como sai da lata). */
export function spraySpeckle(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number, color: string, n: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.4, 1.6);
    ctx.globalAlpha = rng.range(0.2, 0.7);
    ctx.beginPath();
    ctx.arc(x + rng.range(0, w), y + rng.range(0, h), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Desgaste: apaga a tinta em pontos, riscos e manchas (a parede aparece por baixo), como
 * grafite que pegou sol e chuva. Usa o alfa do canvas.
 */
export function weather(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number, amount = 1): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  const dots = Math.floor(((w * h) / 90) * amount);
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.15, 0.6)})`;
    ctx.fillRect(x + rng.range(0, w), y + rng.range(0, h), rng.range(1, 3), rng.range(1, 2.5));
  }
  for (let i = 0; i < 6 * amount; i++) {
    const cx = x + rng.range(0, w);
    const cy = y + rng.range(0, h);
    const r = rng.range(0.04, 0.12) * Math.min(w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 10 * amount; i++) {
    ctx.lineWidth = rng.range(0.6, 1.6);
    const sx = x + rng.range(0, w);
    const sy = y + rng.range(0, h);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + rng.range(-20, 20), sy + rng.range(-6, 6));
    ctx.stroke();
  }
  // Tinta mais fraca no geral (não é plástico: a textura do reboco aparece por baixo).
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}
