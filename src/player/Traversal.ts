import { AbstractMesh, Ray, Scene, Vector3 } from '@babylonjs/core';
import { PLAYER, TRAVERSAL } from '../core/config';
import type { ColliderIndex, RayHit } from '../nav/ColliderIndex';

export interface LedgeInfo {
  kind: 'climb' | 'vault';
  /** Posição dos pés ao começar. */
  start: Vector3;
  /** Posição dos pés ao terminar. */
  end: Vector3;
  /** Altura do topo do obstáculo (y absoluto). */
  topY: number;
  /** Altura relativa aos pés no início. */
  height: number;
  duration: number;
  forward: Vector3;
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

/**
 * Procura uma borda escalável à frente do jogador usando raios contra os colisores:
 * 1) parede à frente; 2) topo plano acima dela; 3) espaço livre em cima;
 * 4) se o obstáculo é fino e baixo, vira um "vault" (passa por cima).
 */
export function findLedge(
  scene: Scene,
  feet: Vector3,
  forward: Vector3,
  maxHeight: number,
  exclude: AbstractMesh,
  isFree?: (feet: Vector3) => boolean,
  index?: ColliderIndex | null,
): LedgeInfo | null {
  const result = findLedgeRaw(scene, feet, forward, maxHeight, exclude, index ?? null);
  // Nunca termina uma escalada dentro de outro colisor (casa vizinha, caixa d'água...).
  if (result && isFree && !isFree(result.end)) return null;
  return result;
}

function findLedgeRaw(
  scene: Scene,
  feet: Vector3,
  forward: Vector3,
  maxHeight: number,
  exclude: AbstractMesh,
  index: ColliderIndex | null,
): LedgeInfo | null {
  const pred = (m: AbstractMesh) => m.checkCollisions && m !== exclude;
  // Com o índice espacial, só as caixas perto do raio (o picking percorria a cena inteira).
  const cast = (origin: Vector3, dir: Vector3, len: number): RayHit | null => {
    if (index) return index.raycastHit(origin, dir, len);
    const h = scene.pickWithRay(new Ray(origin, dir, len), pred);
    return h?.hit && h.pickedPoint ? { distance: h.distance, point: h.pickedPoint, normal: h.getNormal(true) ?? dir.negate() } : null;
  };

  // 1) Parede à frente (em três alturas).
  const reach = PLAYER.radius + TRAVERSAL.reach;
  let wallDist = Infinity;
  for (const h of [0.3, 0.8, 1.3]) {
    const hit = cast(feet.add(new Vector3(0, h, 0)), forward, reach);
    if (!hit) continue;
    if (Vector3.Dot(hit.normal, forward) > -0.45) continue; // parede muito oblíqua
    wallDist = Math.min(wallDist, hit.distance);
  }
  if (!isFinite(wallDist)) return null;

  // 2) Topo do obstáculo (perto da face, para muros finos, e um pouco além).
  const fromY = feet.y + maxHeight + 0.3;
  let probe = feet;
  let topHit = null;
  for (const inset of [0.07, 0.3]) {
    probe = feet.add(forward.scale(wallDist + inset));
    topHit = cast(new Vector3(probe.x, fromY, probe.z), DOWN, maxHeight + 0.3 - TRAVERSAL.minLedge + 0.05);
    if (topHit) break;
  }
  if (!topHit) return null;
  if (topHit.normal.y < 0.7) return null;
  const topY = topHit.point.y;
  const height = topY - feet.y;
  if (height < TRAVERSAL.minLedge || height > maxHeight) return null;

  // 3) Espaço livre: nada entre o jogador e a borda na altura do topo, e teto acima.
  if (cast(new Vector3(feet.x, topY + 0.35, feet.z), forward, wallDist + 0.7)) return null;
  if (cast(new Vector3(probe.x, topY + 0.05, probe.z), UP, 1.15)) return null;

  // 4) Fino ou grosso?
  const beyond = feet.add(forward.scale(wallDist + 0.95));
  const beyondHit = cast(new Vector3(beyond.x, topY + 0.3, beyond.z), DOWN, 0.6);
  const thin = !beyondHit;

  if (thin && height <= TRAVERSAL.maxVaultHeight) {
    const clear = !cast(new Vector3(feet.x, topY + 0.55, feet.z), forward, wallDist + 1.4);
    if (clear) {
      const end = feet.add(forward.scale(wallDist + PLAYER.radius + 0.8));
      end.y = topY + 0.05;
      return { kind: 'vault', start: feet.clone(), end, topY, height, duration: 0.34 + height * 0.12, forward: forward.clone() };
    }
  }

  const end = feet.add(forward.scale(wallDist + PLAYER.radius + 0.12));
  end.y = topY + 0.03;
  return { kind: 'climb', start: feet.clone(), end, topY, height, duration: 0.3 + height * 0.2, forward: forward.clone() };
}

/** Posição dos pés ao longo da escalada/vault (t de 0 a 1). */
export function traversalPosition(l: LedgeInfo, t: number, out: Vector3): Vector3 {
  if (l.kind === 'climb') {
    const lift = 0.68;
    if (t < lift) {
      const k = t / lift;
      const e = 1 - (1 - k) * (1 - k);
      out.x = l.start.x + l.forward.x * 0.12 * k;
      out.z = l.start.z + l.forward.z * 0.12 * k;
      out.y = l.start.y + (l.end.y + 0.06 - l.start.y) * e;
    } else {
      const k = (t - lift) / (1 - lift);
      const e = k * k * (3 - 2 * k);
      const sx = l.start.x + l.forward.x * 0.12;
      const sz = l.start.z + l.forward.z * 0.12;
      out.x = sx + (l.end.x - sx) * e;
      out.z = sz + (l.end.z - sz) * e;
      out.y = l.end.y + 0.06 * (1 - e);
    }
  } else {
    out.x = l.start.x + (l.end.x - l.start.x) * t;
    out.z = l.start.z + (l.end.z - l.start.z) * t;
    const peak = l.topY + 0.22;
    // Parábola start.y -> peak -> end.y
    const a = l.start.y;
    const c = l.end.y;
    out.y = (1 - t) * (1 - t) * a + 2 * (1 - t) * t * (2 * peak - (a + c) / 2) + t * t * c;
  }
  return out;
}
