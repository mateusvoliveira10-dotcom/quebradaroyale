import { AbstractMesh, Axis, Vector3 } from '@babylonjs/core';

/** Caixa orientada (os colisores do mapa são todos caixas). */
interface Obb {
  c: Vector3;
  ax: Vector3;
  ay: Vector3;
  az: Vector3;
  hx: number;
  hy: number;
  hz: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  mesh: AbstractMesh;
}

export interface RayHit {
  distance: number;
  point: Vector3;
  /** Normal da face atingida (para fora da caixa). */
  normal: Vector3;
}

export interface SurfaceHit {
  y: number;
  /** Componente vertical da normal (1 = plano, < 1 = rampa). */
  ny: number;
}

/**
 * Índice espacial dos colisores estáticos em blocos de 8 m. Permite consultas
 * rápidas e exatas (caixas orientadas) sem passar pelo picking do Babylon:
 * ponto dentro de sólido, altura do piso numa coluna e linha de visão.
 */
export class ColliderIndex {
  private readonly cells = new Map<number, Obb[]>();
  private readonly all: Obb[] = [];
  private readonly chunk = 8;

  constructor(meshes: AbstractMesh[]) {
    for (const m of meshes) this.add(m);
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 4096 + (cz + 512);
  }

  add(mesh: AbstractMesh): void {
    mesh.computeWorldMatrix(true);
    const wm = mesh.getWorldMatrix();
    const bb = mesh.getBoundingInfo().boundingBox;
    const c = Vector3.TransformCoordinates(bb.center, wm);
    const ax = Vector3.TransformNormal(Axis.X, wm);
    const ay = Vector3.TransformNormal(Axis.Y, wm);
    const az = Vector3.TransformNormal(Axis.Z, wm);
    const sx = ax.length();
    const sy = ay.length();
    const sz = az.length();
    const o: Obb = {
      c,
      ax: ax.scale(1 / sx),
      ay: ay.scale(1 / sy),
      az: az.scale(1 / sz),
      hx: bb.extendSize.x * sx,
      hy: bb.extendSize.y * sy,
      hz: bb.extendSize.z * sz,
      minX: bb.minimumWorld.x,
      maxX: bb.maximumWorld.x,
      minY: bb.minimumWorld.y,
      maxY: bb.maximumWorld.y,
      minZ: bb.minimumWorld.z,
      maxZ: bb.maximumWorld.z,
      mesh,
    };
    this.all.push(o);
    const x0 = Math.floor(o.minX / this.chunk);
    const x1 = Math.floor(o.maxX / this.chunk);
    const z0 = Math.floor(o.minZ / this.chunk);
    const z1 = Math.floor(o.maxZ / this.chunk);
    // Caixas gigantes (chão, muro) vão para todos os blocos que tocam.
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(o);
      }
    }
  }

  /**
   * Malhas que colidem mas não entram nas consultas de piso/navegação (ex.: alvos do
   * campinho): só participam da colisão de movimento (meshesAround).
   */
  addCollisionOnly(mesh: AbstractMesh): void {
    this.extra.push(mesh);
  }

  private readonly extra: AbstractMesh[] = [];
  private readonly around: AbstractMesh[] = [];
  private readonly seen = new Set<AbstractMesh>();

  /**
   * Colisores na área (x ± r, z ± r), para o moveWithCollisions testar só eles
   * (`surroundingMeshes`) em vez de percorrer todas as malhas da cena — no mapa de
   * 300 m são ~12 mil malhas, e com 30 personagens isso custava dezenas de ms por frame.
   * O array devolvido é reaproveitado na próxima chamada.
   */
  meshesAround(x: number, z: number, r: number): AbstractMesh[] {
    const out = this.around;
    out.length = 0;
    this.seen.clear();
    const x0 = Math.floor((x - r) / this.chunk);
    const x1 = Math.floor((x + r) / this.chunk);
    const z0 = Math.floor((z - r) / this.chunk);
    const z1 = Math.floor((z + r) / this.chunk);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const o of list) {
          if (o.maxX < x - r || o.minX > x + r || o.maxZ < z - r || o.minZ > z + r || this.seen.has(o.mesh)) continue;
          this.seen.add(o.mesh);
          out.push(o.mesh);
        }
      }
    }
    for (const m of this.extra) out.push(m);
    return out;
  }

  private near(x: number, z: number): Obb[] {
    return this.cells.get(this.key(Math.floor(x / this.chunk), Math.floor(z / this.chunk))) ?? [];
  }

  /** O ponto está dentro de algum colisor (com folga opcional)? */
  isInsideSolid(p: Vector3, margin = 0): boolean {
    for (const o of this.near(p.x, p.z)) {
      if (p.y < o.minY - margin || p.y > o.maxY + margin) continue;
      const dx = p.x - o.c.x;
      const dy = p.y - o.c.y;
      const dz = p.z - o.c.z;
      if (
        Math.abs(dx * o.ax.x + dy * o.ax.y + dz * o.ax.z) <= o.hx + margin &&
        Math.abs(dx * o.ay.x + dy * o.ay.y + dz * o.ay.z) <= o.hy + margin &&
        Math.abs(dx * o.az.x + dy * o.az.y + dz * o.az.z) <= o.hz + margin
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * O corpo de um personagem (cilindro aproximado por pontos) cabe com os pés
   * nesta posição sem atravessar nada?
   */
  isBodyFree(feet: Vector3, height = 1.8, radius = 0.38): boolean {
    const p = new Vector3();
    for (const h of [0.25, height * 0.5, height - 0.15]) {
      for (const [ox, oz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
        p.set(feet.x + ox, feet.y + h, feet.z + oz);
        if (this.isInsideSolid(p)) return false;
      }
    }
    return true;
  }

  /** Superfície mais alta abaixo de `fromY` na coluna (x, z). */
  surfaceBelow(x: number, z: number, fromY: number): SurfaceHit | null {
    let best: SurfaceHit | null = null;
    const origin = new Vector3(x, fromY, z);
    const dir = new Vector3(0, -1, 0);
    for (const o of this.near(x, z)) {
      if (x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ || o.minY > fromY) continue;
      const hit = rayObb(origin, dir, o, fromY + 100);
      if (!hit) continue;
      const y = fromY - hit.t;
      if (!best || y > best.y) best = { y, ny: Math.abs(hit.ny) };
    }
    return best;
  }

  /**
   * Distância até o primeiro colisor ao longo do raio (dir normalizada), até `len`, ou
   * null. Mesma ideia do picking do Babylon, mas só com as caixas perto do raio.
   */
  raycast(origin: Vector3, dir: Vector3, len: number): number | null {
    return this.raycastHit(origin, dir, len)?.distance ?? null;
  }

  /** Como `raycast`, com a normal da face atingida (para efeitos e escalada). */
  raycastHit(origin: Vector3, dir: Vector3, len: number): RayHit | null {
    const seen = new Set<Obb>();
    let best: { t: number; o: Obb; axis: number; sign: number } | null = null;
    const steps = Math.ceil(len / (this.chunk * 0.5)) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * len;
      for (const o of this.near(origin.x + dir.x * t, origin.z + dir.z * t)) {
        if (seen.has(o)) continue;
        seen.add(o);
        const hit = rayObb(origin, dir, o, len);
        if (hit && (best === null || hit.t < best.t)) best = { t: hit.t, o, axis: hit.axis, sign: hit.sign };
      }
    }
    if (!best) return null;
    const n = [best.o.ax, best.o.ay, best.o.az][best.axis].scale(best.sign);
    return { distance: best.t, point: origin.add(dir.scale(best.t)), normal: n };
  }

  /** Algum colisor entre a e b? (linha de visão) */
  segmentBlocked(a: Vector3, b: Vector3): boolean {
    const d = b.subtract(a);
    const len = d.length();
    if (len < 1e-4) return false;
    d.scaleInPlace(1 / len);
    // Percorre os blocos atravessados pelo segmento.
    const seen = new Set<Obb>();
    const steps = Math.ceil(len / (this.chunk * 0.5)) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * len;
      const px = a.x + d.x * t;
      const pz = a.z + d.z * t;
      for (const o of this.near(px, pz)) {
        if (seen.has(o)) continue;
        seen.add(o);
        const hit = rayObb(a, d, o, len);
        if (hit && hit.t > 0.05 && hit.t < len - 0.05) return true;
      }
    }
    return false;
  }
}

/** Interseção raio x caixa orientada (método das fatias). */
function rayObb(origin: Vector3, dir: Vector3, o: Obb, maxT: number): { t: number; ny: number; axis: number; sign: number } | null {
  const dx = origin.x - o.c.x;
  const dy = origin.y - o.c.y;
  const dz = origin.z - o.c.z;
  const axes = [o.ax, o.ay, o.az];
  const halves = [o.hx, o.hy, o.hz];
  let tMin = -Infinity;
  let tMax = Infinity;
  let hitAxis = 0;
  let hitSign = 1;
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const e = dx * a.x + dy * a.y + dz * a.z;
    const f = dir.x * a.x + dir.y * a.y + dir.z * a.z;
    const h = halves[i];
    if (Math.abs(f) < 1e-9) {
      if (-e - h > 0 || -e + h < 0) return null;
      continue;
    }
    let t1 = (-e - h) / f;
    let t2 = (-e + h) / f;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitAxis = i;
      hitSign = sign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax || tMax < 0) return null;
  }
  if (tMin < 0 || tMin > maxT) return null;
  const n = axes[hitAxis];
  return { t: tMin, ny: n.y * hitSign, axis: hitAxis, sign: hitSign };
}
