import { Mesh, MeshBuilder, Vector3 } from '@babylonjs/core';
import { HQ_TILE } from '../MaterialsHQ';
import { riverAt, Terrain } from '../Terrain';
import { WorldBuilder } from '../WorldBuilder';

/**
 * Estradas do anel de fora: fitas que acompanham o relevo (asfalto nas ligações principais,
 * terra batida nas secundárias), saindo das quatro avenidas da comunidade para as regiões.
 * Onde uma estrada cruza um rio nasce uma ponte de concreto com rampas. As estradas não
 * colidem (o chão é o relevo); as pontes sim.
 */
export interface Road {
  name: string;
  kind: 'asfalto' | 'terra';
  width: number;
  path: Array<[number, number]>;
}

export const ROADS: Road[] = [
  // Avenida leste → ponte do Rio Azul → Jardim Primavera.
  { name: 'Estrada do Jardim', kind: 'asfalto', width: 7, path: [[150, 0], [200, 8], [240, 30], [280, 30], [318, 30], [340, 30]] },
  // Avenida oeste → Mata do Sabiá → portaria do Condomínio Bela Vista.
  { name: 'Estrada do Condomínio', kind: 'asfalto', width: 7, path: [[-150, 0], [-215, -10], [-270, -60], [-305, -125], [-325, -160]] },
  // Avenida norte (ao lado do prédio do lobby) → Vila dos Pescadores.
  { name: 'Estrada da Praia', kind: 'terra', width: 5.5, path: [[14, 152], [30, 200], [36, 260], [40, 330], [40, 400], [40, 438]] },
  // Avenida sul → sopé do Pico → Serra Grande → Lagoa da Serra → Ferro-Velho.
  { name: 'Estrada da Serra', kind: 'terra', width: 5.5, path: [[0, -150], [10, -190], [45, -225], [70, -290], [120, -320], [162, -332], [190, -275], [150, -215]] },
  // Campo de Várzea → Fazenda Santa Luzia.
  { name: 'Estrada da Fazenda', kind: 'terra', width: 5.5, path: [[-150, 120], [-200, 165], [-230, 230], [-262, 272], [-290, 290]] },
  // Lagoa Azul → Mata Fechada (trilha).
  { name: 'Trilha da Mata', kind: 'terra', width: 3.5, path: [[205, 215], [235, 265], [255, 320], [270, 380]] },
  // Jardim Primavera → praia norte (contorna o morro).
  { name: 'Estrada do Morro', kind: 'terra', width: 5, path: [[385, 130], [370, 190], [330, 240], [300, 290]] },
];

/** Distância (m) até o eixo da estrada mais próxima e a meia-largura dela. */
export function roadAt(x: number, z: number): { d: number; hw: number } {
  let best = { d: Infinity, hw: 0 };
  for (const r of ROADS) {
    const p = r.path;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best.d) best = { d, hw: r.width / 2 };
    }
  }
  return best;
}

/** Ponto de uma polilinha a `s` metros do início (interpolado). */
function along(path: Array<[number, number]>, s: number): { x: number; z: number; dx: number; dz: number } {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (acc + len >= s || i === path.length - 2) {
      const t = Math.max(0, Math.min(1, (s - acc) / len));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
    }
    acc += len;
  }
  const [x, z] = path[path.length - 1];
  return { x, z, dx: 1, dz: 0 };
}

function pathLength(path: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return s;
}

export function buildRoads(b: WorldBuilder, terrain: Terrain): void {
  const m = b.mats;
  const H = (x: number, z: number) => terrain.height(x, z);
  for (const road of ROADS) {
    const total = pathLength(road.path);
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    const center: Vector3[] = [];
    const hw = road.width / 2;
    const lift = road.kind === 'asfalto' ? 0.07 : 0.05;
    // Trechos sobre a água (ponte) ficam fora da fita: a ponte cobre.
    let bridgeFrom = -1;
    const bridges: Array<{ s0: number; s1: number; level: number }> = [];
    for (let s = 0; s <= total + 0.01; s += 2.5) {
      const p = along(road.path, Math.min(s, total));
      const rv = riverAt(p.x, p.z);
      const over = rv !== null && rv.d < rv.hw + 7;
      if (over && bridgeFrom < 0) bridgeFrom = s;
      if (!over && bridgeFrom >= 0) {
        bridges.push({ s0: bridgeFrom, s1: s, level: rv ? rv.level : 0 });
        bridgeFrom = -1;
      }
      if (over) continue;
      const nx = -p.dz;
      const nz = p.dx;
      const yl = H(p.x + nx * hw, p.z + nz * hw) + lift;
      const yr = H(p.x - nx * hw, p.z - nz * hw) + lift;
      // Mesma altura dos dois lados (o maior): a fita nunca afunda no relevo de um lado.
      const y = Math.max(yl, yr, H(p.x, p.z) + lift);
      left.push(new Vector3(p.x + nx * hw, y, p.z + nz * hw));
      right.push(new Vector3(p.x - nx * hw, y, p.z - nz * hw));
      center.push(new Vector3(p.x, y, p.z));
    }
    // A fita é cortada em pedaços nos pontos de ponte (um ribbon por trecho contínuo).
    const pieces: Array<[Vector3[], Vector3[]]> = [];
    let la: Vector3[] = [];
    let ra: Vector3[] = [];
    for (let i = 0; i < left.length; i++) {
      if (i > 0 && Vector3.Distance(left[i], left[i - 1]) > 8) {
        if (la.length > 1) pieces.push([la, ra]);
        la = [];
        ra = [];
      }
      la.push(left[i]);
      ra.push(right[i]);
    }
    if (la.length > 1) pieces.push([la, ra]);
    const mat = road.kind === 'asfalto' ? m.hq.asfalto : m.hq.terra;
    const tile = road.kind === 'asfalto' ? HQ_TILE.asfalto : HQ_TILE.terra;
    for (const [l, r] of pieces) {
      const ribbon = MeshBuilder.CreateRibbon(`estrada_${road.name}`, { pathArray: [l, r], sideOrientation: Mesh.DEFAULTSIDE }, b.scene);
      // UV ao longo da estrada (u na largura, v no comprimento).
      const uv: number[] = [];
      for (const path of [l, r]) {
        let acc = 0;
        for (let i = 0; i < path.length; i++) {
          if (i > 0) acc += Vector3.Distance(path[i], path[i - 1]);
          uv.push(path === l ? 0 : road.width / tile, acc / tile);
        }
      }
      ribbon.setVerticesData('uv', uv);
      // Acostamento de terra nas estradas de asfalto: faixa mais larga por baixo.
      b.addMesh(ribbon, mat, { cell: 128 });
    }
    if (road.kind === 'asfalto') {
      // Faixa central tracejada e acostamento de terra.
      for (let s = 6; s < total - 4; s += 9) {
        const p = along(road.path, s);
        const rv = riverAt(p.x, p.z);
        if (rv && rv.d < rv.hw + 8) continue;
        const y = Math.max(H(p.x, p.z), H(p.x + 1.5 * -p.dz, p.z + 1.5 * p.dx), H(p.x - 1.5 * -p.dz, p.z - 1.5 * p.dx)) + lift + 0.012;
        b.box({ w: 2.4, h: 0.012, d: 0.14, x: p.x, cy: y, z: p.z, mat: m.roadLine, ry: -Math.atan2(p.dz, p.dx) });
      }
    }
    for (const br of bridges) buildBridge(b, road, br.s0, br.s1, br.level, terrain);
  }
}

/** Ponte de concreto: tabuleiro com guarda-corpo, pilares na água e rampas de acesso nas duas pontas. */
function buildBridge(b: WorldBuilder, road: Road, s0: number, s1: number, level: number, terrain: Terrain): void {
  const m = b.mats;
  const a = along(road.path, s0 - 2.5);
  const c = along(road.path, s1);
  const dx = c.x - a.x;
  const dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const ry = -Math.atan2(uz, ux);
  const deckY = level + 3.0;
  const w = road.width + 1.2;
  const cx = (a.x + c.x) / 2;
  const cz = (a.z + c.z) / 2;
  b.box({ w: len, h: 0.5, d: w, x: cx, cy: deckY - 0.25, z: cz, mat: m.hq.concreto, ry, tile: HQ_TILE.concreto, collide: true });
  // Guarda-corpo dos dois lados.
  for (const side of [-1, 1]) {
    const ox = -uz * side * (w / 2 - 0.1);
    const oz = ux * side * (w / 2 - 0.1);
    b.box({ w: len, h: 1.0, d: 0.16, x: cx + ox, z: cz + oz, y: deckY, mat: m.hq.concreto, ry, tile: HQ_TILE.concreto, collide: true });
    b.box({ w: len + 0.1, h: 0.08, d: 0.24, x: cx + ox, z: cz + oz, y: deckY + 1.0, mat: m.hq.concreto, ry, tile: HQ_TILE.concreto });
  }
  // Pilares (colunas) a cada 8 m, descendo até o fundo da calha.
  for (let s = 4; s < len - 3; s += 8) {
    const px = a.x + ux * s;
    const pz = a.z + uz * s;
    for (const side of [-1, 1]) {
      const qx = px - uz * side * (w / 2 - 0.7);
      const qz = pz + ux * side * (w / 2 - 0.7);
      const floor = terrain.height(qx, qz) - 0.5;
      b.cylinder({ diameter: 0.9, h: deckY - 0.5 - floor, x: qx, y: floor, z: qz, mat: m.hq.concreto, tessellation: 10, collide: true });
    }
  }
  // Rampas de acesso: do nível do chão até o tabuleiro em 9 m.
  for (const end of [-1, 1]) {
    const ex = end > 0 ? c.x : a.x;
    const ez = end > 0 ? c.z : a.z;
    const rampLen = 9;
    const gx = ex + ux * end * rampLen;
    const gz = ez + uz * end * rampLen;
    const gy = terrain.height(gx, gz) + 0.1;
    const rise = deckY - gy;
    const mx = (ex + gx) / 2;
    const mz = (ez + gz) / 2;
    const slope = Math.atan2(rise, rampLen);
    const hyp = Math.hypot(rise, rampLen);
    // Caixa inclinada (asfalto por cima) + enchimento de concreto por baixo.
    b.box({ w: hyp, h: 0.3, d: w, x: mx, cy: (deckY + gy) / 2 - 0.15, z: mz, mat: m.hq.asfalto, ry, rz: -end * slope, tile: HQ_TILE.asfalto, collide: true });
    for (let k = 1; k <= 3; k++) {
      const f = k / 4;
      const hx = ex + ux * end * rampLen * f;
      const hz = ez + uz * end * rampLen * f;
      const top = deckY - rise * f - 0.2;
      const bottom = terrain.height(hx, hz) - 1;
      if (top > bottom) b.box({ w: rampLen / 4, h: top - bottom, d: w, x: hx, y: bottom, z: hz, mat: m.hq.concreto, ry, tile: HQ_TILE.concreto, collide: true });
    }
  }
}
