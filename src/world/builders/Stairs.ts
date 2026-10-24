import { Material, Vector3 } from '@babylonjs/core';
import { WorldBuilder } from '../WorldBuilder';

export interface StairSpec {
  /** Centro da base do primeiro degrau (y = base). */
  x: number;
  z: number;
  base: number;
  /** Eixo e sentido em que a escada sobe. */
  axis: 'x' | 'z';
  dir: 1 | -1;
  run: number;
  rise: number;
  width: number;
  mat: Material;
  /** Corrimão: lados (relativos ao sentido de subida). */
  rails?: { left: boolean; right: boolean };
  /** Faixa amarela no espelho dos degraus (escadarias públicas). */
  nosing?: Material;
  stepHeight?: number;
}

/**
 * Escada maciça de alvenaria. Visual: degraus; colisão: rampa contínua levemente
 * acima da linha dos degraus + blocos de enchimento por baixo (ninguém entra sob ela).
 */
export function buildStairs(b: WorldBuilder, s: StairSpec): void {
  const along = (d: number) => (s.axis === 'x' ? new Vector3(s.x + s.dir * d, 0, s.z) : new Vector3(s.x, 0, s.z + s.dir * d));
  const steps = Math.max(2, Math.ceil(s.rise / (s.stepHeight ?? 0.21)));
  const stepRise = s.rise / steps;
  const tread = s.run / steps;

  for (let i = 0; i < steps; i++) {
    const c = along((i + 0.5) * tread);
    const h = (i + 1) * stepRise;
    const dims = s.axis === 'x' ? { w: tread + 0.01, d: s.width } : { w: s.width, d: tread + 0.01 };
    b.box({ ...dims, h, x: c.x, z: c.z, y: s.base, mat: s.mat });
    if (s.nosing) {
      const n = along(i * tread + 0.02);
      const nd = s.axis === 'x' ? { w: 0.05, d: s.width * 0.96 } : { w: s.width * 0.96, d: 0.05 };
      b.box({ ...nd, h: 0.05, x: n.x, z: n.z, y: s.base + h - 0.035, mat: s.nosing });
    }
  }

  // Rampa de colisão, enterrada no começo para não haver degrau.
  const extend = 0.6;
  const p0 = along(-extend);
  const p1 = along(s.run);
  const y0 = s.base + stepRise * 0.5 - (extend * s.rise) / s.run;
  const y1 = s.base + s.rise + stepRise * 0.5;
  const len = Math.hypot(s.run + extend, y1 - y0);
  const angle = Math.atan2(y1 - y0, s.run + extend);
  const mid = p0.add(p1).scale(0.5);
  if (s.axis === 'x') b.collider(len, 0.12, s.width, mid.x, (y0 + y1) / 2 - 0.06, mid.z, 0, 0, s.dir * angle);
  else b.collider(s.width, 0.12, len, mid.x, (y0 + y1) / 2 - 0.06, mid.z, -s.dir * angle, 0, 0);

  // Enchimento.
  for (let k = 1; k < 4; k++) {
    const hk = (s.rise * k) / 4 - 0.1;
    const c = along((k + 0.5) * (s.run / 4));
    if (s.axis === 'x') b.collider(s.run / 4, hk, s.width, c.x, s.base + hk / 2, c.z);
    else b.collider(s.width, hk, s.run / 4, c.x, s.base + hk / 2, c.z);
  }

  // Corrimãos.
  if (s.rails) {
    const side = s.axis === 'x' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    // "Esquerda" relativa ao sentido de subida.
    const leftSign = s.axis === 'x' ? s.dir : -s.dir;
    for (const [on, sign] of [
      [s.rails.left, leftSign],
      [s.rails.right, -leftSign],
    ] as const) {
      if (!on) continue;
      const off = side.scale(sign * (s.width / 2 - 0.06));
      const a = along(0.1).add(off);
      const c = along(s.run).add(off);
      a.y = s.base + stepRise + 0.9;
      c.y = s.base + s.rise + 0.9;
      b.pipe(a, c, 0.025, b.mats.metal);
      for (const t of [0, 0.5, 1]) {
        const p = Vector3.Lerp(a, c, t);
        const foot = p.clone();
        foot.y = s.base + stepRise * Math.ceil(((t * (s.run - 0.1) + 0.1) / s.run) * steps);
        b.pipe(foot, p, 0.02, b.mats.metal);
      }
    }
  }
}
