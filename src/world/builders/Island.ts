import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { WORLD } from '../../core/config';
import { Rng } from '../../utils/random';
import { LAKE, OUTER_POIS, SEA_LEVEL, Terrain, TerrainPoi } from '../Terrain';
import { WorldAssets } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';
import { buildHouse, HouseInfo } from './House';
import { addCar, addFootballField, addPlasticChair, addPlasticTable, addSign } from './Props';
import { addUnderbrush, BUSHES, pickSpecies, placeCacamba, placeProp, placeTextured, placeTree, prop } from './Vegetation';

export interface IslandResult {
  houses: HouseInfo[];
  loot: Array<{ pos: Vector3; tier: 0 | 1 | 2 }>;
  /** Áreas onde o espalhamento de vegetação da comunidade não deve pôr nada. */
  blocked: Array<{ x0: number; x1: number; z0: number; z1: number }>;
}

/**
 * Anel externo da ilha (fora da comunidade): mar, lagoa e o conteúdo de cada área com nome
 * (Vila dos Pescadores, Lagoa Azul, Pedreira, Ferro-Velho, Pico do Mirante, Sítio do Seu Zé,
 * Mata do Sabiá e Campo de Várzea), mais árvores pelos morros. Tudo assentado na altura do
 * terreno. Gerador próprio: a comunidade sorteada antes não muda.
 */
export function buildIsland(b: WorldBuilder, terrain: Terrain): IslandResult {
  const rng = new Rng(880011);
  const m = b.mats;
  const out: IslandResult = { houses: [], loot: [], blocked: [] };
  const H = (x: number, z: number) => terrain.height(x, z);
  const loot = (x: number, z: number, tier: 0 | 1 | 2, dy = 0.1) => out.loot.push({ pos: new Vector3(x, H(x, z) + dy, z), tier });
  const poi = (name: string) => OUTER_POIS.find((p) => p.name === name)!;
  const used: Array<[number, number, number]> = [];
  const free = (x: number, z: number, r: number) => !used.some(([ux, uz, ur]) => (ux - x) ** 2 + (uz - z) ** 2 < (ur + r) ** 2);
  const reserve = (x: number, z: number, r: number) => used.push([x, z, r]);

  buildWater(b);

  // ---------------------------------------------------------- Vila dos Pescadores
  {
    const p = poi('VILA DOS PESCADORES');
    const spots: Array<[number, number, 1 | -1]> = [[-18, -14, 1], [-4, -16, 1], [10, -14, 1], [-14, 6, -1], [4, 8, -1]];
    for (const [ox, oz, front] of spots) {
      const x0 = p.x + ox;
      const z0 = p.z + oz;
      const info = buildHouse(b, rng, { x0, z0, w: rng.range(6, 8), d: rng.range(6, 7.5), base: 0, floors: rng.chance(0.4) ? 2 : 1, front, stair: rng.chance(0.5), puxadinho: false });
      out.houses.push(info);
      reserve(x0 + 3.5, z0 + 3.5, 6);
      loot(x0 + 3, z0 + 3, 1, 0.1);
    }
    // Píer de madeira entrando no mar, com quiosque e mesas de plástico.
    const pierX = p.x + 2;
    const pierZ0 = p.z + 22;
    const pierLen = Math.max(14, WORLD.radius + 18 - Math.hypot(pierX, pierZ0));
    b.box({ w: 3, h: 0.18, d: pierLen, x: pierX, z: pierZ0 + pierLen / 2, y: 0.9, mat: m.hq.madeira, tile: 1.2, collide: true });
    for (let k = 0; k <= pierLen; k += 3) {
      for (const s of [-1, 1]) b.cylinder({ diameter: 0.22, h: 3.2, x: pierX + s * 1.35, y: -2.2, z: pierZ0 + k, mat: m.bark, tessellation: 8 });
    }
    loot(pierX, pierZ0 + pierLen - 2, 2, 1.1);
    const kx = p.x - 14;
    const kz = p.z + 18;
    b.box({ w: 4, h: 0.1, d: 3, x: kx, z: kz, y: 2.6, mat: m.hq.fibrocimento, tile: 1.5 });
    for (const [ox, oz] of [[-1.9, -1.4], [1.9, -1.4], [-1.9, 1.4], [1.9, 1.4]]) b.box({ w: 0.12, h: 2.6, d: 0.12, x: kx + ox, z: kz + oz, y: 0, mat: m.hq.madeira, tile: 0.6, collide: true });
    b.box({ w: 3.6, h: 1.0, d: 0.6, x: kx, z: kz - 1.1, y: 0, mat: m.hq.madeira, tile: 1, collide: true });
    for (let i = 0; i < 3; i++) {
      const tx = kx - 4 + i * 4;
      addPlasticTable(b, tx, 0, kz + 4, m.plasticRed);
      addPlasticChair(b, tx - 0.8, 0, kz + 4, Math.PI / 2, m.plasticRed);
      addPlasticChair(b, tx + 0.8, 0, kz + 4, -Math.PI / 2, m.plasticRed);
    }
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2);
      const x = p.x + Math.cos(a) * rng.range(18, 30);
      const z = p.z + Math.sin(a) * rng.range(18, 30);
      if (free(x, z, 2)) placeTree(b, 'coqueiro', x, H(x, z), z, rng.range(0, 6), rng.range(0.9, 1.2));
    }
    addCar(b, rng, p.x + 18, p.z - 4, Math.PI / 2);
  }

  // ---------------------------------------------------------- Lagoa Azul
  {
    const deckX = LAKE.x - LAKE.r + 6;
    const deckZ = LAKE.z;
    b.box({ w: 14, h: 0.16, d: 2.4, x: deckX + 5, z: deckZ, y: LAKE.level + 0.35, mat: m.hq.madeira, tile: 1.2, collide: true });
    for (let k = 0; k <= 12; k += 3) for (const s of [-1, 1]) b.cylinder({ diameter: 0.18, h: 3, x: deckX + k, y: LAKE.level - 2.4, z: deckZ + s * 1.1, mat: m.bark, tessellation: 7 });
    loot(deckX + 11, deckZ, 2, LAKE.level + 0.55 - H(deckX + 11, deckZ));
    // Árvores em volta da margem e uma casinha de barco.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const d = LAKE.r + rng.range(6, 16);
      const x = LAKE.x + Math.cos(a) * d;
      const z = LAKE.z + Math.sin(a) * d;
      if (Math.abs(a - Math.PI) < 0.25 || !free(x, z, 2.5)) continue;
      placeTree(b, pickSpecies(rng), x, H(x, z), z, rng.range(0, 6), rng.range(0.9, 1.25));
      reserve(x, z, 2.5);
    }
    const hx = LAKE.x - LAKE.r - 10;
    const hz = LAKE.z + 12;
    out.houses.push(buildHouse(b, rng, { x0: hx - 3, z0: hz - 3, w: 6, d: 6, base: H(hx, hz), floors: 1, front: -1, stair: false, puxadinho: false }));
    loot(hx, hz, 1, 0.1);
  }

  // ---------------------------------------------------------- Pedreira
  {
    const p = poi('PEDREIRA');
    for (let i = 0; i < 22; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(4, 30);
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      const s = rng.range(0.7, 2.4);
      if (!free(x, z, s)) continue;
      boulder(b, rng, x, H(x, z), z, s);
      reserve(x, z, s);
    }
    // Montes de brita, caçambas e a picape da obra.
    for (let i = 0; i < 4; i++) {
      const x = p.x - 10 + i * 6;
      const z = p.z + 22;
      const cone = MeshBuilder.CreateCylinder('brita', { diameterTop: 0.4, diameterBottom: 5, height: 2.2, tessellation: 14 }, b.scene);
      cone.position.set(x, H(x, z) + 1.0, z);
      b.addMesh(cone, m.hq.pedra);
      b.collider(3.4, 2, 3.4, x, H(x, z) + 1, z);
    }
    const cy = H(p.x, p.z);
    loot(p.x, p.z, 2, 0.1);
    loot(p.x + 8, p.z - 6, 1, 0.1);
    for (let i = 0; i < 5; i++) {
      const x = p.x - 18 + i * 1.4;
      const z = p.z + 26;
      placeTextured(b, 'barril', x, H(x, z), z, rng.range(0, 6), 1, [0.6, 0.88]);
    }
    void cy;
    if (WorldAssets.current) {
      placeCacambaAt(b, p.x - 14, p.z - 24, 0, H(p.x - 14, p.z - 24));
      placeCacambaAt(b, p.x + 16, p.z + 18, Math.PI / 2, H(p.x + 16, p.z + 18));
    }
  }

  // ---------------------------------------------------------- Ferro-Velho
  {
    const p = poi('FERRO-VELHO');
    const half = 20;
    // Alambrado em volta (com portão aberto no lado da comunidade).
    for (const s of [-1, 1]) {
      b.box({ w: half * 2, h: 2.6, d: 0.05, x: p.x, z: p.z + s * half, y: 0, mat: m.fence, tile: 1.5, collide: true });
      if (s > 0) b.box({ w: 0.05, h: 2.6, d: half * 2, x: p.x + s * half, z: p.z, y: 0, mat: m.fence, tile: 1.5, collide: true });
      else {
        b.box({ w: 0.05, h: 2.6, d: half - 4, x: p.x - half, z: p.z - (half + 4) / 2, y: 0, mat: m.fence, tile: 1.5, collide: true });
        b.box({ w: 0.05, h: 2.6, d: half - 4, x: p.x - half, z: p.z + (half + 4) / 2, y: 0, mat: m.fence, tile: 1.5, collide: true });
      }
    }
    // Carcaças empilhadas (carros enferrujados, sem rodas no de cima).
    const assets = WorldAssets.current;
    const ids = ['hatch', 'seda', 'picape', 'besouro'] as const;
    for (let i = 0; i < 9; i++) {
      const x = p.x - 14 + (i % 3) * 12 + rng.range(-1.5, 1.5);
      const z = p.z - 12 + Math.floor(i / 3) * 11 + rng.range(-1.5, 1.5);
      const ry = rng.range(0, Math.PI * 2);
      const levels = rng.int(1, 3);
      for (let l = 0; l < levels; l++) {
        const model = assets?.cars.get(rng.pick(ids));
        if (!model) break;
        b.model(model, x + rng.range(-0.12, 0.12), l * 1.32, z + rng.range(-0.12, 0.12), ry + rng.range(-0.12, 0.12), (role) => (role === 'glass' ? m.glass : role === 'rubber' || role === 'under' ? m.rubber : m.rust));
      }
      loot(x + 3, z, l0(i), 0.1);
    }
    for (let i = 0; i < 10; i++) {
      const x = p.x + rng.range(-17, 17);
      const z = p.z + rng.range(-17, 17);
      if (!placeTextured(b, 'pneus', x, 0, z, rng.range(0, 6), rng.range(0.9, 1.15), [0.85, 1.05])) placeProp(b, 'PilhaPneus', x, 0, z, rng.range(0, 6));
    }
    for (let i = 0; i < 12; i++) placeTextured(b, 'barril', p.x + rng.range(-18, 18), 0, p.z + rng.range(-18, 18), rng.range(0, 6), 1, [0.6, 0.88]);
    // Barracão do dono.
    out.houses.push(buildHouse(b, rng, { x0: p.x + 10, z0: p.z + 10, w: 7, d: 6, base: 0, floors: 1, front: -1, stair: true, puxadinho: false }));
    out.blocked.push({ x0: p.x - half, x1: p.x + half, z0: p.z - half, z1: p.z + half });
  }

  // ---------------------------------------------------------- Pico do Mirante
  {
    const p = poi('PICO DO MIRANTE');
    const top = H(p.x, p.z);
    // Torre de antena treliçada.
    const th = 22;
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      b.cylinder({ diameter: 0.14, diameterTop: 0.08, h: th, x: p.x + ox * 0.6, y: top, z: p.z + oz * 0.6, mat: m.metal, tessellation: 6, rx: oz * -0.03, rz: ox * 0.03, collide: true });
    }
    for (let y = 2; y < th; y += 2.5) {
      const k = 1 - (y / th) * 0.55;
      for (const s of [-1, 1]) {
        b.box({ w: 1.5 * k, h: 0.06, d: 0.06, x: p.x, z: p.z + s * 0.72 * k, y: top + y, mat: m.metal });
        b.box({ w: 0.06, h: 0.06, d: 1.5 * k, x: p.x + s * 0.72 * k, z: p.z, y: top + y, mat: m.metal });
      }
    }
    const lamp = MeshBuilder.CreateSphere('luzTorre', { diameter: 0.4, segments: 8 }, b.scene);
    lamp.position.set(p.x, top + th + 0.3, p.z);
    b.addMesh(lamp, m.sirenRed);
    // Mirante com guarda-corpo e bancos.
    b.box({ w: 10, h: 0.2, d: 10, x: p.x, z: p.z + 7, y: top - 0.1, mat: m.hq.concreto, tile: 2, collide: true });
    for (let i = 0; i < 2; i++) b.box({ w: 2, h: 0.45, d: 0.45, x: p.x - 2 + i * 4, z: p.z + 10, y: top + 0.1, mat: m.hq.madeira, tile: 1, collide: true });
    loot(p.x + 2, p.z + 6, 2, 0.25);
    loot(p.x - 3, p.z + 4, 1, 0.25);
    addSign(b, 'MIRANTE', { x: p.x, y: top + 1.2, z: p.z + 12.2, width: 3, height: 0.8, facing: 1, bg: '#2a5a2a', fg: '#ffffff', board: true });
  }

  // ---------------------------------------------------------- Sítio do Seu Zé
  {
    const p = poi('SÍTIO DO SEU ZÉ');
    out.houses.push(buildHouse(b, rng, { x0: p.x - 4, z0: p.z - 4, w: 9, d: 7, base: 0, floors: 1, front: 1, stair: false, puxadinho: false }));
    loot(p.x, p.z, 1);
    // Horta em canteiros, cerca de madeira e bananeiras.
    for (let i = 0; i < 6; i++) {
      const z = p.z + 10 + i * 1.6;
      b.box({ w: 12, h: 0.18, d: 0.9, x: p.x + 8, z, y: 0, mat: m.chaoMata, tile: 3 });
    }
    const fx0 = p.x - 16;
    const fx1 = p.x + 22;
    const fz0 = p.z - 14;
    const fz1 = p.z + 22;
    for (let x = fx0; x <= fx1; x += 2.5) {
      for (const z of [fz0, fz1]) b.box({ w: 0.12, h: 1.1, d: 0.12, x, z, y: 0, mat: m.hq.madeira, tile: 0.6 });
    }
    for (let z = fz0; z <= fz1; z += 2.5) for (const x of [fx0, fx1]) b.box({ w: 0.12, h: 1.1, d: 0.12, x, z, y: 0, mat: m.hq.madeira, tile: 0.6 });
    for (const z of [fz0, fz1]) for (const y of [0.45, 0.9]) b.box({ w: fx1 - fx0, h: 0.08, d: 0.05, x: (fx0 + fx1) / 2, z, y, mat: m.hq.madeira, tile: 1.5 });
    for (const x of [fx0, fx1]) for (const y of [0.45, 0.9]) b.box({ w: 0.05, h: 0.08, d: fz1 - fz0, x, z: (fz0 + fz1) / 2, y, mat: m.hq.madeira, tile: 1.5 });
    const banana = prop('Bananeira');
    for (let i = 0; i < 10 && banana; i++) {
      const x = p.x - 12 + rng.range(0, 6);
      const z = p.z + rng.range(-10, 18);
      b.model(banana, x, 0, z, rng.range(0, 6), (r) => (r === 'bark' ? m.bark : r === 'palm' || r.startsWith('leaf') ? m.palmLeaf : m.foliage), { scale: rng.range(0.9, 1.2) });
    }
    addCar(b, rng, p.x + 14, p.z - 8, 0);
    for (const [ox, oz] of [[6, -3], [6.7, -2.6], [-6, 8]]) placeTextured(b, 'barril', p.x + ox, 0, p.z + oz, rng.range(0, 6), 1, [0.6, 0.88]);
    loot(p.x + 8, p.z + 14, 0);
    out.blocked.push({ x0: fx0, x1: fx1, z0: fz0, z1: fz1 });
  }

  // ---------------------------------------------------------- Campo de Várzea
  {
    const p = poi('CAMPO DE VÁRZEA');
    addFootballField(b, p.x, p.z, 30, 18);
    loot(p.x, p.z, 1, 0.15);
    loot(p.x + 12, p.z - 7, 0, 0.15);
    out.blocked.push({ x0: p.x - 17, x1: p.x + 17, z0: p.z - 11, z1: p.z + 11 });
  }

  // ---------------------------------------------------------- Mata do Sabiá e árvores pelos morros
  {
    const p = poi('MATA DO SABIÁ');
    // Cabana de madeira no meio da mata.
    const cy = H(p.x, p.z);
    b.box({ w: 5, h: 2.6, d: 4, x: p.x, z: p.z, y: cy - 0.3, mat: m.hq.madeira, tile: 1.2, collide: true });
    b.box({ w: 5.8, h: 0.12, d: 4.8, x: p.x, z: p.z, y: cy + 2.3, mat: m.hq.telha, tile: 1.6, rx: 0.12 });
    loot(p.x + 3.5, p.z, 2, 0.1);
    loot(p.x - 8, p.z + 10, 1, 0.1);
    reserve(p.x, p.z, 6);
  }
  // Árvores espalhadas por todo o anel externo, mais densas na mata e nos morros.
  let trees = 0;
  for (let tries = 0; tries < 9000 && trees < 520; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(WORLD.half * 0.9, WORLD.radius - 22);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < WORLD.half + 6 && Math.abs(z) < WORLD.half + 6) continue;
    if (Math.hypot(x + 8, z - (WORLD.half + 13)) < 26) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3) continue;
    const inPoi = OUTER_POIS.find((q) => Math.hypot(x - q.x, z - q.z) < q.r);
    const forest = Math.hypot(x - poi('MATA DO SABIÁ').x, z - poi('MATA DO SABIÁ').z) < 60;
    if (inPoi && !forest) continue;
    // Densidade por manchas (bosques e campos abertos).
    const patch = Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2) + Math.cos(z * 0.019 - Math.sin(x * 0.013));
    if (!forest && patch < 0.2 && rng.chance(0.75)) continue;
    if (!free(x, z, 3)) continue;
    if (terrain.slopeNy(x, z) < 0.8) continue;
    let species = pickSpecies(rng);
    if (species === 'calcada') species = 'mangueira';
    if (!placeTree(b, species, x, H(x, z) - 0.1, z, rng.range(0, Math.PI * 2), rng.range(0.9, 1.4))) break;
    reserve(x, z, 3);
    trees++;
    // Arbustos em volta da árvore (como as moitas do Fortnite).
    for (let k = rng.int(0, 2); k > 0; k--) {
      const ba = rng.range(0, Math.PI * 2);
      const bx = x + Math.cos(ba) * rng.range(2.5, 4.5);
      const bz = z + Math.sin(ba) * rng.range(2.5, 4.5);
      placeProp(b, rng.pick(BUSHES), bx, H(bx, bz) - 0.05, bz, rng.range(0, 6), rng.range(0.8, 1.3));
    }
  }
  // Moitas soltas pelos campos.
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(WORLD.half, WORLD.radius - 24);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < WORLD.half + 4 && Math.abs(z) < WORLD.half + 4) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2 || !free(x, z, 1.5) || terrain.slopeNy(x, z) < 0.8) continue;
    if (out.blocked.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1)) continue;
    placeProp(b, rng.pick(BUSHES), x, H(x, z) - 0.05, z, rng.range(0, 6), rng.range(0.8, 1.4));
  }

  // Capim e mato em touceiras por todo o anel externo (fora da praia e da água).
  const grass: Array<{ x: number; y: number; z: number; dry: boolean }> = [];
  for (let tries = 0; tries < 40000 && grass.length < 9000; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(WORLD.half * 0.95, WORLD.radius - 16);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < WORLD.half + 2 && Math.abs(z) < WORLD.half + 2) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 1) continue;
    if (out.blocked.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1)) continue;
    if (terrain.slopeNy(x, z) < 0.82) continue;
    const n = rng.int(3, 7);
    const dry = rng.chance(0.18);
    for (let k = 0; k < n; k++) {
      const px = x + rng.range(-1.2, 1.2);
      const pz = z + rng.range(-1.2, 1.2);
      grass.push({ x: px, y: H(px, pz) - 0.05, z: pz, dry });
    }
  }
  addUnderbrush(b, grass, rng);

  // Placas das áreas na entrada de cada uma (de frente para a comunidade).
  for (const q of OUTER_POIS) signAt(b, q);
  return out;
}

function l0(i: number): 0 | 1 {
  return i % 3 === 0 ? 1 : 0;
}

/** Caçamba assentada numa altura qualquer (placeCacamba assume o chão em 0). */
function placeCacambaAt(b: WorldBuilder, x: number, z: number, ry: number, y: number): void {
  const model = prop('Cacamba');
  if (!model) {
    placeCacamba(b, x, z, ry);
    return;
  }
  placeProp(b, 'Cacamba', x, y, z, ry);
}

/** Pedra grande irregular (icosfera achatada e girada), com colisão. */
function boulder(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, s: number): void {
  const st = MeshBuilder.CreateIcoSphere('rocha', { radius: 1, subdivisions: 2 }, b.scene);
  const pos = st.getVerticesData('position')!;
  for (let i = 0; i < pos.length; i += 3) {
    const n = 1 + 0.18 * Math.sin(pos[i] * 5 + x) * Math.cos(pos[i + 2] * 4 + z) + 0.1 * Math.sin(pos[i + 1] * 7);
    pos[i] *= n;
    pos[i + 1] *= n;
    pos[i + 2] *= n;
  }
  st.setVerticesData('position', pos);
  st.createNormals(true);
  st.scaling.set(s * rng.range(1, 1.5), s * rng.range(0.55, 0.85), s * rng.range(0.9, 1.3));
  st.rotation.y = rng.range(0, Math.PI);
  st.position.set(x, y + s * 0.25, z);
  b.addMesh(st, b.mats.hq.pedra);
  b.collider(s * 1.6, s * 1.1, s * 1.6, x, y + s * 0.3, z);
}

/** Placa de madeira com o nome da área, na borda voltada para o centro da ilha. */
function signAt(b: WorldBuilder, q: TerrainPoi): void {
  const t = Terrain.current!;
  const d = Math.hypot(q.x, q.z);
  const x = q.x - (q.x / d) * (q.r * 0.9);
  const z = q.z - (q.z / d) * (q.r * 0.9);
  const y = t.height(x, z);
  const facing: 1 | -1 = Math.abs(q.z) > Math.abs(q.x) ? (q.z > 0 ? -1 : 1) : q.x > 0 ? -1 : 1;
  const axis: 'x' | 'z' = Math.abs(q.z) > Math.abs(q.x) ? 'z' : 'x';
  for (const s of [-1, 1]) {
    const px = axis === 'z' ? x + s * 1.6 : x;
    const pz = axis === 'z' ? z : z + s * 1.6;
    b.box({ w: 0.14, h: 2.6, d: 0.14, x: px, z: pz, y: y - 0.2, mat: b.mats.hq.madeira, tile: 0.6, collide: true });
  }
  addSign(b, q.name, { x, y: y + 1.6, z, width: 3.8, height: 0.9, facing, bg: '#6b4a2a', fg: '#fff3d6', board: true, axis });
}

/** Mar em volta da ilha e a água da lagoa: azul com ondinhas que correm devagar. */
function buildWater(b: WorldBuilder): void {
  const scene = b.scene;
  const tex = new DynamicTexture('aguaTex', { width: 256, height: 256 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(0,40,70,0.25)';
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 8, y - 3, x + 16 + Math.random() * 10, y);
    ctx.stroke();
  }
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  // UV em metros (ver worldUV abaixo): uma repetição a cada 6 m.
  const sea = new StandardMaterial('mar', scene);
  sea.diffuseColor = Color3.FromHexString('#2c87b0');
  sea.diffuseTexture = tex;
  sea.specularColor = new Color3(0.9, 0.9, 0.9);
  sea.specularPower = 120;
  sea.emissiveColor = Color3.FromHexString('#0b3550').scale(0.6);
  sea.alpha = 0.88;
  sea.metadata = { castShadow: false };
  // Anel de mar a partir da praia (um disco inteiro aparecia por cima do chão no nível 0).
  const ring = (r0: number, r1: number) => {
    const inner: Vector3[] = [];
    const outer: Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      inner.push(new Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0));
      outer.push(new Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1));
    }
    return MeshBuilder.CreateRibbon('mar', { pathArray: [outer, inner], sideOrientation: Mesh.DOUBLESIDE }, scene);
  };
  const ocean = ring(WORLD.radius + 1, 470);
  ocean.position.y = SEA_LEVEL;
  const worldUV = (mesh: Mesh) => {
    const p = mesh.getVerticesData('position')!;
    const uv: number[] = [];
    for (let i = 0; i < p.length; i += 3) uv.push(p[i] / 6, p[i + 2] / 6);
    mesh.setVerticesData('uv', uv);
  };
  worldUV(ocean);
  ocean.material = sea;
  ocean.isPickable = false;
  ocean.receiveShadows = true;
  const lakeMat = sea.clone('lagoa');
  lakeMat.diffuseColor = Color3.FromHexString('#3a8f8a');
  const lake = MeshBuilder.CreateDisc('lagoa', { radius: LAKE.r + 2, tessellation: 40 }, scene);
  lake.rotation.x = Math.PI / 2;
  lake.position.set(LAKE.x, LAKE.level, LAKE.z);
  worldUV(lake);
  lake.material = lakeMat;
  lake.isPickable = false;
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    tex.uOffset = t * 0.004;
    tex.vOffset = Math.sin(t * 0.3) * 0.003;
  });
  void (ocean as Mesh);
}
