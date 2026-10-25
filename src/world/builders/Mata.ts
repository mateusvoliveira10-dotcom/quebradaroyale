import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { Rng } from '../../utils/random';
import { WorldBuilder } from '../WorldBuilder';
import { addUnderbrush, pickSpecies, placeProp, placeTree, prop } from './Vegetation';

/** Área retangular no chão (x0 < x1, z0 < z1). */
export interface MataRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface MataResult {
  /** Faixas das trilhas e da clareira: o espalhamento de mato não cobre o caminho. */
  clear: MataRect[];
  /** Pontos de loot (clareira e beira de trilha). */
  loot: Array<{ pos: Vector3; tier: 0 | 1 }>;
}

const TRAIL_W = 1.9;

/**
 * Mata no terreno ao lado do campinho: chão de folhas, trilhas de terra batida que
 * serpenteiam (com pedras na beirada e uma bifurcação), clareira com fogueira, bancos de
 * tronco e um abrigo de lona, troncos caídos, pedras, árvores densas, bananeiras e muito
 * mato. Gerador próprio: o resto do mapa não muda.
 */
export function buildMata(b: WorldBuilder, r: MataRect): MataResult {
  const m = b.mats;
  const rng = new Rng(4242);
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const clear: MataRect[] = [];
  const loot: MataResult['loot'] = [];

  // Chão de mata: terra escura com folhas secas (por cima da terra batida do mapa).
  b.box({ w, h: 0.01, d, x: cx, z: cz, y: 0.004, mat: m.chaoMata, tile: 6 });

  // ----- Trilhas: linha principal de oeste a leste, ondulando, e um ramal para a clareira.
  const main: Array<[number, number]> = [];
  for (let x = r.x0; x <= r.x1 - 2; x += 3) {
    const t = (x - r.x0) / w;
    main.push([x, cz + Math.sin(t * Math.PI * 2.4 + 0.6) * d * 0.28]);
  }
  const clearing = { x: r.x0 + w * 0.55, z: cz + (main[Math.floor(main.length * 0.55)][1] > cz ? -d * 0.22 : d * 0.22) };
  const branchStart = main[Math.floor(main.length * 0.4)];
  const branch: Array<[number, number]> = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    branch.push([
      branchStart[0] + (clearing.x - branchStart[0]) * t + Math.sin(t * Math.PI) * 2.5,
      branchStart[1] + (clearing.z - branchStart[1]) * t,
    ]);
  }
  const trailPts: Array<[number, number]> = [];
  for (const path of [main, branch]) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      b.box({ w: TRAIL_W, h: 0.012, d: len + 0.6, x: (ax + bx) / 2, z: (az + bz) / 2, y: 0.012, mat: m.trilha, tile: 2.5, ry });
      // Pedrinhas na beirada (de vez em quando).
      for (const side of [-1, 1]) {
        if (!rng.chance(0.55)) continue;
        const k = rng.range(0.2, 0.8);
        const px = ax + (bx - ax) * k + Math.cos(ry) * side * (TRAIL_W / 2 + 0.15);
        const pz = az + (bz - az) * k - Math.sin(ry) * side * (TRAIL_W / 2 + 0.15);
        const st = MeshBuilder.CreateSphere('pedrinha', { diameter: 1, segments: 5 }, b.scene);
        st.scaling.set(rng.range(0.18, 0.35), rng.range(0.1, 0.18), rng.range(0.18, 0.32));
        st.position.set(px, 0.03, pz);
        st.rotation.y = rng.range(0, Math.PI);
        b.addMesh(st, m.stone);
      }
      for (let k = 0; k <= 4; k++) trailPts.push([ax + (bx - ax) * (k / 4), az + (bz - az) * (k / 4)]);
      clear.push({ x0: Math.min(ax, bx) - 1.2, x1: Math.max(ax, bx) + 1.2, z0: Math.min(az, bz) - 1.2, z1: Math.max(az, bz) + 1.2 });
    }
  }
  const nearTrail = (x: number, z: number, dist: number) => trailPts.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < dist * dist);

  // ----- Clareira: fogueira com pedras, troncos de sentar e um abrigo de lona.
  const CR = 5.5;
  const disc = MeshBuilder.CreateDisc('clareira', { radius: CR, tessellation: 28 }, b.scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(clearing.x, 0.016, clearing.z);
  b.addMesh(disc, m.trilha);
  clear.push({ x0: clearing.x - CR, x1: clearing.x + CR, z0: clearing.z - CR, z1: clearing.z + CR });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = MeshBuilder.CreateSphere('pedraFogueira', { diameter: 1, segments: 6 }, b.scene);
    st.scaling.set(0.32, 0.2, 0.28);
    st.position.set(clearing.x + Math.cos(a) * 0.7, 0.08, clearing.z + Math.sin(a) * 0.7);
    b.addMesh(st, m.stone);
  }
  b.cylinder({ diameter: 1.0, h: 0.03, x: clearing.x, y: 0.02, z: clearing.z, mat: m.rubberBurnt, tessellation: 14 });
  for (let i = 0; i < 3; i++) {
    const ry = (i / 3) * Math.PI * 2;
    b.box({ w: 0.12, h: 0.12, d: 0.9, x: clearing.x, z: clearing.z, y: 0.06, mat: m.bark, ry, rx: 0.12 });
  }
  // Bancos de tronco em volta.
  for (const [ox, oz, along] of [[0, 2.4, true], [2.3, -0.4, false], [-2.3, -0.6, false]] as const) {
    const x = clearing.x + ox;
    const z = clearing.z + oz;
    // Tronco de sentar (modelo com casca e pontas cortadas; deitado no eixo X).
    if (!placeProp(b, 'Tronco_b', x, 0, z, along ? 0 : Math.PI / 2, 0.95)) {
      b.cylinder({ diameter: 0.45, h: 2.0, x, y: 0.22 - 1.0, z, mat: m.bark, rz: along ? Math.PI / 2 : 0, rx: along ? 0 : Math.PI / 2, tessellation: 10 });
      b.collider(along ? 2 : 0.45, 0.45, along ? 0.45 : 2, x, 0.22, z);
    }
  }
  // Abrigo: quatro varas e uma lona azul inclinada.
  const sx = clearing.x - 3.4;
  const sz = clearing.z - 3.2;
  for (const [px, pz, ph] of [[-1.3, -1, 2.2], [1.3, -1, 2.2], [-1.3, 1, 1.5], [1.3, 1, 1.5]] as const) {
    b.cylinder({ diameter: 0.08, h: ph, x: sx + px, y: 0, z: sz + pz, mat: m.bark, tessellation: 6, collide: true });
  }
  b.box({ w: 2.9, h: 0.03, d: 2.3, x: sx, z: sz, y: 1.83, mat: m.plasticBlue, rx: 0.3 });
  loot.push({ pos: new Vector3(sx, 0.1, sz), tier: 1 });
  loot.push({ pos: new Vector3(clearing.x + 1.2, 0.1, clearing.z + 1.1), tier: 0 });

  // Ponto de loot na beira da trilha, perto das duas pontas.
  for (const p of [main[2], main[main.length - 3]]) loot.push({ pos: new Vector3(p[0], 0.1, p[1] + 1.4), tier: 0 });
  const nearLoot = (x: number, z: number, dist: number) => loot.some((l) => (l.pos.x - x) ** 2 + (l.pos.z - z) ** 2 < dist * dist);
  const inClearing = (x: number, z: number, extra: number) => (x - clearing.x) ** 2 + (z - clearing.z) ** 2 < (CR + extra) ** 2;
  const inside = (x: number, z: number, margin: number) => x > r.x0 + margin && x < r.x1 - margin && z > r.z0 + margin && z < r.z1 - margin;

  // ----- Árvores densas (troncos a 3,5 m uns dos outros), longe da trilha e da clareira.
  const trunks: Array<[number, number]> = [];
  for (let tries = 0; tries < 1500 && trunks.length < 60; tries++) {
    const x = rng.range(r.x0 + 1.5, r.x1 - 3);
    const z = rng.range(r.z0 + 1.5, r.z1 - 1.5);
    if (nearTrail(x, z, 2.6) || inClearing(x, z, 1.5) || nearLoot(x, z, 2.5)) continue;
    if (trunks.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < 3.5 * 3.5)) continue;
    // Mata fechada: mais mangueira e amendoeira, quase nenhum coqueiro.
    let species = pickSpecies(rng);
    if (species === 'coqueiro' && rng.chance(0.7)) species = 'mangueira';
    if (!placeTree(b, species, x, 0, z, rng.range(0, Math.PI * 2), rng.range(0.85, 1.25))) break;
    trunks.push([x, z]);
  }
  const freeOfTrunks = (x: number, z: number, dist: number) => !trunks.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < dist * dist);

  // Bananeiras em touceira na beira da mata.
  const banana = prop('Bananeira');
  let bananas = 0;
  for (let tries = 0; tries < 400 && banana && bananas < 14; tries++) {
    const x = rng.range(r.x0 + 1, r.x1 - 2);
    const z = rng.chance(0.5) ? rng.range(r.z0 + 1, r.z0 + 4) : rng.range(r.z1 - 4, r.z1 - 1);
    if (nearTrail(x, z, 2) || !freeOfTrunks(x, z, 2.2) || nearLoot(x, z, 2)) continue;
    placeProp(b, 'Bananeira', x, 0, z, rng.range(0, Math.PI * 2), rng.range(0.9, 1.2));
    trunks.push([x, z]);
    bananas++;
  }

  // Troncos caídos (alinhados aos eixos, com colisão) e pedras grandes.
  let logs = 0;
  for (let tries = 0; tries < 300 && logs < 9; tries++) {
    const alongX = rng.chance(0.5);
    const len = rng.range(2.5, 4.5);
    const x = rng.range(r.x0 + 3, r.x1 - 4);
    const z = rng.range(r.z0 + 2, r.z1 - 2);
    if (!inside(x, z, alongX ? 1 : len / 2 + 0.5) || !inside(x + (alongX ? len / 2 : 0), z, 0.5) || !inside(x - (alongX ? len / 2 : 0), z, 0.5)) continue;
    if (nearTrail(x, z, 2 + len / 2) || inClearing(x, z, 2) || !freeOfTrunks(x, z, len / 2 + 1) || nearLoot(x, z, 3)) continue;
    const dia = rng.range(0.35, 0.6);
    // Modelo de tronco caído (casca, toco de galho, pontas com anéis), já com colisor.
    // Antes era um cilindro e, girado, o centro subia meio comprimento: o tronco voava.
    const big = len > 3.4;
    if (!placeProp(b, big ? 'Tronco_a' : 'Tronco_b', x, 0, z, (alongX ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0), (big ? len / 3.6 : len / 2.2) * 0.98)) {
      b.cylinder({ diameter: dia, diameterTop: dia * 0.8, h: len, x, y: dia / 2 - len / 2, z, mat: m.bark, rz: alongX ? Math.PI / 2 : 0, rx: alongX ? 0 : Math.PI / 2, tessellation: 9 });
      b.collider(alongX ? len : dia, dia, alongX ? dia : len, x, dia / 2, z);
    }
    trunks.push([x, z]);
    logs++;
  }
  let rocks = 0;
  for (let tries = 0; tries < 300 && rocks < 14; tries++) {
    const x = rng.range(r.x0 + 1.5, r.x1 - 3);
    const z = rng.range(r.z0 + 1.5, r.z1 - 1.5);
    if (nearTrail(x, z, 1.8) || inClearing(x, z, 0.5) || !freeOfTrunks(x, z, 1.8) || nearLoot(x, z, 2)) continue;
    const s = rng.range(0.5, 1.4);
    const st = MeshBuilder.CreateSphere('pedra', { diameter: 1, segments: 7 }, b.scene);
    st.scaling.set(s * rng.range(0.9, 1.4), s * rng.range(0.5, 0.8), s * rng.range(0.9, 1.3));
    st.position.set(x, s * 0.18, z);
    st.rotation.y = rng.range(0, Math.PI);
    b.addMesh(st, m.stone);
    if (s > 0.9) b.collider(s * 1.1, s * 0.6, s * 1.1, x, s * 0.3, z);
    trunks.push([x, z]);
    rocks++;
  }

  // Mato fechado (tufos repetidos), fora do caminho.
  const spots: Array<{ x: number; y: number; z: number; dry: boolean }> = [];
  for (let tries = 0; tries < 6000 && spots.length < 1300; tries++) {
    const x = rng.range(r.x0 + 0.5, r.x1 - 0.5);
    const z = rng.range(r.z0 + 0.5, r.z1 - 0.5);
    if (nearTrail(x, z, 1.3) || inClearing(x, z, -0.5) || !freeOfTrunks(x, z, 0.6)) continue;
    spots.push({ x, y: 0, z, dry: rng.chance(0.2) });
  }
  addUnderbrush(b, spots, rng);
  return { clear, loot };
}
