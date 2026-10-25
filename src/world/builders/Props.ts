import { Color3, DynamicTexture, Material, MeshBuilder, PBRMaterial, StandardMaterial, Vector3, Vector4, VertexBuffer } from '@babylonjs/core';
import { studioMaterial } from '../../player/GlassesMaterial';
import { Rng } from '../../utils/random';
import { GRAFFITI_TILES } from '../Materials';
import { CarModelId, DetailedVehicleId, WorldAssets } from '../WorldAssets';
import { WorldBuilder } from '../WorldBuilder';
import { pickSpecies, placeCacamba, placeProp, placeTree, TreeSpecies } from './Vegetation';

type Ctx = CanvasRenderingContext2D;

/** Converte coordenadas locais (x, z) de um objeto girado em ry para o mundo. */
function local(x: number, z: number, ry: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

// ------------------------------------------------------------------ letreiros

export interface SignOptions {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  facing: 1 | -1;
  bg: string;
  fg: string;
  graffiti?: boolean;
  subtitle?: string;
  /** Moldura com profundidade (placa de loja). */
  board?: boolean;
  /** Eixo da parede: 'z' (padrão, placa olha para ±Z) ou 'x' (olha para ±X). */
  axis?: 'x' | 'z';
}

/**
 * Placa pintada (letreiro de comércio ou grafite) aplicada numa parede.
 * `facing` = direção para onde a placa olha no eixo Z.
 */
export function addSign(b: WorldBuilder, text: string, o: SignOptions): void {
  const resW = 1024;
  const resH = Math.max(96, Math.round((resW * o.height) / o.width));
  const tex = new DynamicTexture(`sign_${text}`, { width: resW, height: resH }, b.scene, true);
  const ctx = tex.getContext() as unknown as Ctx;

  if (o.graffiti) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, resW, resH);
    const rng = new Rng(text.length * 97);
    const colors = ['#ff4fa3', '#25c4ff', '#ffd21f', '#2bd46b', '#a35bff', '#ff7a1f'];
    for (let i = 0; i < 50; i++) {
      const x = rng.range(0, resW);
      const y = rng.range(0, resH);
      const r = rng.range(10, 70);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rng.pick(colors) + 'aa');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, resH);
    g.addColorStop(0, o.bg);
    g.addColorStop(1, darken(o.bg, 0.78));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, resW, resH);
    ctx.strokeStyle = o.fg;
    ctx.lineWidth = resH * 0.05;
    ctx.strokeRect(ctx.lineWidth * 1.2, ctx.lineWidth * 1.2, resW - ctx.lineWidth * 2.4, resH - ctx.lineWidth * 2.4);
  }

  const mainH = o.subtitle ? resH * 0.62 : resH;
  let fontSize = mainH * 0.62;
  const font = (size: number) => `900 ${size}px Impact, "Arial Black", sans-serif`;
  ctx.font = font(fontSize);
  const maxW = resW * 0.86;
  const measured = ctx.measureText(text).width;
  if (measured > maxW) {
    fontSize *= maxW / measured;
    ctx.font = font(fontSize);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ty = o.subtitle ? mainH * 0.58 : resH / 2;
  ctx.lineWidth = fontSize * (o.graffiti ? 0.16 : 0.08);
  ctx.strokeStyle = '#1b1420';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, resW / 2, ty);
  ctx.fillStyle = o.fg;
  ctx.fillText(text, resW / 2, ty);
  if (o.graffiti) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(text, resW / 2 - fontSize * 0.03, ty - fontSize * 0.05);
  }
  if (o.subtitle) {
    ctx.font = `700 ${resH * 0.2}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = o.fg;
    ctx.fillText(o.subtitle, resW / 2, resH * 0.8);
  }
  tex.update();

  const mat = new StandardMaterial(`signMat_${text}`, b.scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = new Color3(0.25, 0.25, 0.25);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);

  const plane = MeshBuilder.CreatePlane(`sign_${text}`, { width: o.width, height: o.height }, b.scene);
  plane.material = mat;
  plane.isPickable = false;
  const out = o.board ? 0.11 : 0.07;
  // O plano padrão é visível de -Z; gira para olhar para o lado certo.
  if (o.axis === 'x') {
    plane.position.set(o.x + o.facing * out, o.y, o.z);
    plane.rotation.y = o.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else {
    plane.position.set(o.x, o.y, o.z + o.facing * out);
    if (o.facing > 0) plane.rotation.y = Math.PI;
  }
  plane.receiveShadows = true;
  plane.freezeWorldMatrix();

  if (o.board) {
    if (o.axis === 'x') b.box({ w: 0.1, h: o.height + 0.14, d: o.width + 0.14, x: o.x + o.facing * 0.055, z: o.z, cy: o.y, mat: b.mats.metalDark });
    else b.box({ w: o.width + 0.14, h: o.height + 0.14, d: 0.1, x: o.x, z: o.z + o.facing * 0.055, cy: o.y, mat: b.mats.metalDark });
  }
}

/** Sorteio fixo a partir de uma posição (não consome o gerador do mapa). */
export function spotRng(x: number, z: number, salt = 0): Rng {
  return new Rng((Math.floor(x * 7919) ^ Math.floor(z * 104729) ^ (salt * 2654435761)) >>> 0);
}

/**
 * Pichação ou grafite pintado na parede (plano com recorte por alfa, entra no lote estático).
 * `axis` = eixo da normal da parede; `facing` = para que lado ela olha.
 */
export function addGraffitiTag(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, axis: 'x' | 'z', facing: 1 | -1, width: number): void {
  const plane = MeshBuilder.CreatePlane('graffiti', { width, height: width / 2 }, b.scene);
  const out = 0.025;
  if (axis === 'x') {
    plane.position.set(x + facing * out, y, z);
    plane.rotation.y = facing > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else {
    plane.position.set(x, y, z + facing * out);
    if (facing > 0) plane.rotation.y = Math.PI;
  }
  plane.rotation.z = rng.range(-0.05, 0.05);
  // Recorta um dos desenhos do atlas (4 x 2). V = 0 é a base da textura (última linha do canvas).
  const tile = rng.int(0, GRAFFITI_TILES - 1);
  const u0 = (tile % 4) / 4;
  const v0 = Math.floor(tile / 4) === 0 ? 0.5 : 0;
  const uvs = plane.getVerticesData(VertexBuffer.UVKind)!;
  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i] = u0 + uvs[i] / 4;
    uvs[i + 1] = v0 + uvs[i + 1] / 2;
  }
  plane.setVerticesData(VertexBuffer.UVKind, uvs);
  b.addMesh(plane, b.mats.graffiti);
}

function darken(hex: string, k: number): string {
  const c = Color3.FromHexString(hex).scale(k);
  return c.toHexString();
}

// ------------------------------------------------------------------ postes

/** Poste de concreto com cruzeta e luminária. */
export function addPole(b: WorldBuilder, x: number, z: number, armAlongX: boolean, lampToward: Vector3): Vector3[] {
  const m = b.mats;
  b.cylinder({ diameter: 0.32, diameterTop: 0.22, h: 8.4, x, y: 0, z, mat: m.concrete, tessellation: 10, collide: true });
  b.box(
    armAlongX
      ? { w: 1.8, h: 0.12, d: 0.12, x, z, y: 7.6, mat: m.concrete }
      : { w: 0.12, h: 0.12, d: 1.8, x, z, y: 7.6, mat: m.concrete },
  );
  // Isoladores.
  const o = 0.75;
  const tips = armAlongX
    ? [new Vector3(x - o, 7.86, z), new Vector3(x, 7.86, z), new Vector3(x + o, 7.86, z)]
    : [new Vector3(x, 7.86, z - o), new Vector3(x, 7.86, z), new Vector3(x, 7.86, z + o)];
  for (const t of tips) b.cylinder({ diameter: 0.08, h: 0.14, x: t.x, y: 7.72, z: t.z, mat: m.white, tessellation: 6 });

  // "Bolo" de fios enrolados e caixinha de derivação, como em todo poste de comunidade.
  const pr = spotRng(x, z, 7);
  if (pr.chance(0.6)) {
    const coilY = pr.range(5.6, 6.4);
    for (let i = 0; i < pr.int(2, 4); i++) {
      const coil = MeshBuilder.CreateTorus('coil', { diameter: pr.range(0.45, 0.75), thickness: 0.035, tessellation: 12 }, b.scene);
      coil.position.set(x + (armAlongX ? 0 : 0.2), coilY - i * 0.09, z + (armAlongX ? 0.2 : 0));
      coil.rotation.set(Math.PI / 2 + pr.range(-0.4, 0.4), pr.range(0, Math.PI), pr.range(-0.3, 0.3));
      b.addMesh(coil, m.wire);
    }
    b.box({ w: 0.22, h: 0.3, d: 0.14, x: x + (armAlongX ? 0 : -0.2), z: z + (armAlongX ? -0.2 : 0), y: coilY - 0.6, mat: m.metalDark });
  }

  // Transformador em alguns postes.
  if (Math.abs(Math.round(x * 3 + z)) % 3 === 0) {
    const tx = x + (armAlongX ? 0 : 0.42);
    const tz = z + (armAlongX ? 0.42 : 0);
    b.cylinder({ diameter: 0.6, h: 0.9, x: tx, y: 6.1, z: tz, mat: m.metal, tessellation: 12 });
    b.cylinder({ diameter: 0.66, h: 0.06, x: tx, y: 7.0, z: tz, mat: m.metalDark, tessellation: 12 });
  }

  // Luminária pública voltada para a rua.
  const dir = lampToward.subtract(new Vector3(x, 0, z));
  dir.y = 0;
  dir.normalize();
  const a = new Vector3(x, 6.8, z);
  const c = a.add(dir.scale(1.6));
  c.y = 7.0;
  b.pipe(a, c, 0.04, m.metal);
  b.box({ w: 0.55, h: 0.12, d: 0.26, x: c.x + dir.x * 0.2, z: c.z + dir.z * 0.2, y: 6.92, mat: m.metalDark, ry: Math.atan2(dir.z, -dir.x) });
  b.box({ w: 0.45, h: 0.03, d: 0.2, x: c.x + dir.x * 0.2, z: c.z + dir.z * 0.2, y: 6.9, mat: m.lampOff, ry: Math.atan2(dir.z, -dir.x) });
  return tips;
}

// ------------------------------------------------------------------ campinho

/** Campinho de terra com traves, alambrado e arquibancada simples. */
export function addFootballField(b: WorldBuilder, cx: number, cz: number, length: number, width: number): void {
  const m = b.mats;
  b.box({ w: length, h: 0.04, d: width, x: cx, z: cz, y: 0, mat: m.field, tile: 4 });
  const lw = 0.12;
  const ly = 0.04;
  const lh = 0.012;
  const line = (w: number, d: number, x: number, z: number) => b.box({ w, h: lh, d, x, z, y: ly, mat: m.roadWhite });

  line(length - 1, lw, cx, cz - width / 2 + 0.5);
  line(length - 1, lw, cx, cz + width / 2 - 0.5);
  line(lw, width - 1, cx - length / 2 + 0.5, cz);
  line(lw, width - 1, cx + length / 2 - 0.5, cz);
  line(lw, width - 1, cx, cz);
  const r = 2.2;
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    b.box({ w: 0.6, h: lh, d: lw, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, y: ly, mat: m.roadWhite, ry: -a + Math.PI / 2 });
  }

  // Traves com rede.
  for (const side of [-1, 1]) {
    const gx = cx + side * (length / 2 - 0.5);
    for (const pz of [cz - 1.6, cz + 1.6]) {
      b.cylinder({ diameter: 0.12, h: 2.1, x: gx, y: 0, z: pz, mat: m.white, tessellation: 8, collide: true });
    }
    b.box({ w: 0.12, h: 0.12, d: 3.32, x: gx, z: cz, y: 2.04, mat: m.white, collide: true });
    b.box({ w: 0.02, h: 2.1, d: 3.2, x: gx + side * 0.8, z: cz, y: 0, mat: m.fence });
    b.box({ w: 0.8, h: 0.02, d: 3.2, x: gx + side * 0.4, z: cz, y: 2.08, mat: m.fence });
  }

  // Alambrado nas laterais compridas (com vãos para entrar).
  const fh = 3.2;
  for (const sz of [-1, 1]) {
    const fz = cz + sz * (width / 2 + 0.8);
    const segments = 6;
    const segLen = (length + 1.6) / segments;
    for (let i = 0; i < segments; i++) {
      if (i === 2) continue; // vão
      const sx = cx - (length + 1.6) / 2 + segLen * (i + 0.5);
      b.box({ w: segLen, h: fh, d: 0.04, x: sx, z: fz, y: 0, mat: m.fence, tile: 1.5, collide: true });
    }
    for (let i = 0; i <= segments; i++) {
      const px = cx - (length + 1.6) / 2 + segLen * i;
      b.cylinder({ diameter: 0.08, h: fh + 0.1, x: px, y: 0, z: fz, mat: m.metal, tessellation: 6 });
    }
    b.pipe(new Vector3(cx - (length + 1.6) / 2, fh, fz), new Vector3(cx + (length + 1.6) / 2, fh, fz), 0.03, m.metal);
  }

  // Arquibancada de concreto (2 degraus) num dos lados.
  const bz = cz - width / 2 - 2.2;
  b.box({ w: 10, h: 0.45, d: 1.6, x: cx, z: bz, y: 0, mat: m.concrete, collide: true });
  b.box({ w: 10, h: 0.9, d: 0.8, x: cx, z: bz - 0.4, y: 0, mat: m.concrete, collide: true });
  b.contactShadow(cx, bz, 10, 1.6, 0);
}

// ------------------------------------------------------------------ céu

/** Nuvens cartoon: aglomerados de esferas achatadas no céu. */
export function addClouds(b: WorldBuilder, rng: Rng, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(120, 320);
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const cy = rng.range(70, 120);
    const puffs = rng.int(4, 7);
    for (let p = 0; p < puffs; p++) {
      const s = rng.range(12, 26);
      const sphere = MeshBuilder.CreateSphere('cloud', { diameter: s, segments: 10 }, b.scene);
      sphere.position.set(cx + rng.range(-18, 18), cy + rng.range(-2, 4), cz + rng.range(-10, 10));
      sphere.scaling.y = 0.5;
      b.addMesh(sphere, b.mats.cloud);
    }
  }
}

/**
 * UV de uma casinha de fundo na célula `cell` do atlas 4 x 4 (Materials.bgAtlas): faces
 * laterais com a fachada inteira; topo e fundo só na faixa de concreto (laje). Margem de
 * meio texel para a célula vizinha não vazar.
 */
const BG_HOUSE_UV = Array.from({ length: 16 }, (_, cell) => {
  const u0 = (cell % 4) / 4 + 0.004;
  const u1 = (cell % 4 + 1) / 4 - 0.004;
  // DynamicTexture inverte o V: a linha 0 do canvas fica no alto da textura.
  const v1 = 1 - Math.floor(cell / 4) / 4 - 0.004;
  const v0 = 1 - (Math.floor(cell / 4) + 1) / 4 + 0.004;
  const roof = new Vector4(u0, v1 - 0.06 * 0.25, u1, v1 - 0.01 * 0.25);
  return [0, 1, 2, 3].map(() => new Vector4(u0, v0, u1, v1)).concat([roof, roof.clone()]);
});
/** Cenário de fundo em blocos grandes: poucos lotes (é barato e quase sempre está longe). */
const BG_CELL = 160;

/**
 * Bairro em volta do muro, até ~75 m para fora: quarteirões de casinhas (fachada com janelas,
 * laje cinza, caixa d'água azul em parte delas) separados por ruas. Só cenário, sem colisão
 * (fica fora da área jogável). Gerador próprio: o mapa não muda.
 */
export function addOutskirts(b: WorldBuilder, half: number): void {
  const m = b.mats;
  const rng = new Rng(31415);
  const inner = half + 7;
  const outer = half + 75;
  const block = 22; // quarteirão + rua
  for (let gx = -outer; gx < outer; gx += block) {
    for (let gz = -outer; gz < outer; gz += block) {
      // Só o anel em volta da comunidade.
      const cxB = gx + block / 2;
      const czB = gz + block / 2;
      if (Math.max(Math.abs(cxB), Math.abs(czB)) < inner + block / 2 - 4) continue;
      // Casas em fileira dentro do quarteirão (deixa 5 m de rua).
      for (let x = gx + 2.5; x < gx + block - 7; x += rng.range(5.5, 8)) {
        for (const zz of [gz + 2.5, gz + block / 2 + 0.5]) {
          if (rng.chance(0.12)) continue;
          const w = rng.range(5, 7.5);
          const d = rng.range(5, 7.5);
          const h = rng.chance(0.55) ? 6 : 3;
          const px = x + w / 2;
          const pz = zz + d / 2;
          if (Math.max(Math.abs(px), Math.abs(pz)) < inner) continue;
          // Prédio e câmera do lobby (além do muro norte, perto de x = -8): área livre.
          if (px > -34 && px < 20 && pz > half && pz < half + 40) continue;
          const cell = rng.chance(0.35) ? m.bgBrickCell : rng.pick(m.bgPaintCells);
          const box = MeshBuilder.CreateBox('subúrbio', { width: w, height: h, depth: d, faceUV: BG_HOUSE_UV[cell] }, b.scene);
          box.position.set(px, h / 2, pz);
          b.addMesh(box, m.bgAtlas, { cell: BG_CELL });
          if (rng.chance(0.4)) {
            const tank = MeshBuilder.CreateCylinder('caixa', { diameter: 1.2, height: 0.9, tessellation: 10 }, b.scene);
            tank.position.set(px + rng.range(-w / 4, w / 4), h + 0.45, pz + rng.range(-d / 4, d / 4));
            b.addMesh(tank, m.tank, { cell: BG_CELL });
          }
        }
      }
    }
  }
}

/**
 * Morros ao redor da comunidade cobertos de casinhas (pano de fundo). Dá a
 * sensação de uma cidade enorme sem custo de colisão.
 */
export function addBackdropHills(b: WorldBuilder, rng: Rng, innerRadius: number): void {
  const m = b.mats;
  const hillMat = m.morroFundo;
  const count = 11;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const dist = innerRadius + rng.range(60, 140);
    const hx = Math.cos(angle) * dist;
    const hz = Math.sin(angle) * dist;
    const rx = rng.range(55, 95);
    const ry = rng.range(35, 70);
    const hill = MeshBuilder.CreateSphere('hill', { diameter: 2, segments: 16 }, b.scene);
    hill.scaling.set(rx, ry, rx * 0.8);
    hill.position.set(hx, -ry * 0.25, hz);
    b.addMesh(hill, hillMat);

    // Casinhas coloridas sobre a encosta virada para o mapa.
    const houses = rng.int(70, 120);
    for (let k = 0; k < houses; k++) {
      const a = angle + Math.PI + rng.range(-1.2, 1.2);
      const t = rng.range(0.15, 0.9);
      const lx = Math.cos(a) * rx * t;
      const lz = Math.sin(a) * rx * 0.8 * t;
      const h = Math.sqrt(Math.max(0, 1 - t * t)) * ry - ry * 0.25;
      if (h < 1) continue;
      const w = rng.range(4, 8);
      const hh = rng.range(3, 7);
      const cell = rng.chance(0.4) ? m.bgBrickCell : rng.pick(m.bgPaintCells);
      const box = MeshBuilder.CreateBox('bgHouse', { width: w, height: hh, depth: rng.range(4, 7), faceUV: BG_HOUSE_UV[cell] }, b.scene);
      box.position.set(hx + lx, h + hh / 2 - 0.8, hz + lz);
      box.rotation.y = rng.range(0, Math.PI);
      b.addMesh(box, m.bgAtlas, { cell: BG_CELL });
    }
  }
}

// ------------------------------------------------------------------ mobiliário urbano

export function addPlasticChair(b: WorldBuilder, x: number, y: number, z: number, ry: number, mat: Material): void {
  const [sx, sz] = local(x, z, ry, 0, 0);
  b.box({ w: 0.44, h: 0.04, d: 0.42, x: sx, z: sz, y: y + 0.42, mat, ry });
  const [bx, bz] = local(x, z, ry, 0, -0.2);
  b.box({ w: 0.44, h: 0.44, d: 0.04, x: bx, z: bz, y: y + 0.46, mat, ry, rx: -0.12 });
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
    const [px, pz] = local(x, z, ry, lx, lz);
    b.box({ w: 0.04, h: 0.42, d: 0.04, x: px, z: pz, y, mat, ry });
  }
}

export function addPlasticTable(b: WorldBuilder, x: number, y: number, z: number, mat: Material): void {
  b.box({ w: 0.78, h: 0.04, d: 0.78, x, z, y: y + 0.7, mat });
  for (const [lx, lz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) {
    b.box({ w: 0.05, h: 0.7, d: 0.05, x: x + lx, z: z + lz, y, mat });
  }
  b.collider(0.78, 0.74, 0.78, x, y + 0.37, z);
}

/** Engradados de cerveja empilhados. */
export function addCrates(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const mat = rng.chance(0.5) ? b.mats.plasticYellow : b.mats.plasticRed;
    b.box({ w: 0.45, h: 0.3, d: 0.32, x: x + rng.range(-0.03, 0.03), z: z + rng.range(-0.03, 0.03), y: y + i * 0.3, mat, ry: rng.range(-0.1, 0.1) });
  }
  b.collider(0.45, n * 0.3, 0.32, x, y + (n * 0.3) / 2, z);
}

export function addBarrel(b: WorldBuilder, x: number, y: number, z: number, mat: Material): void {
  b.cylinder({ diameter: 0.6, h: 0.9, x, y, z, mat, tessellation: 14, collide: true });
  b.cylinder({ diameter: 0.63, h: 0.04, x, y: y + 0.28, z, mat: b.mats.metalDark, tessellation: 14 });
  b.cylinder({ diameter: 0.63, h: 0.04, x, y: y + 0.6, z, mat: b.mats.metalDark, tessellation: 14 });
}

export function addTireStack(b: WorldBuilder, x: number, y: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const t = MeshBuilder.CreateTorus('tire', { diameter: 0.58, thickness: 0.22, tessellation: 18 }, b.scene);
    t.position.set(x + (i % 2) * 0.03, y + 0.11 + i * 0.21, z);
    b.addMesh(t, b.mats.rubber);
  }
  b.collider(0.75, n * 0.21 + 0.02, 0.75, x, y + (n * 0.21) / 2, z);
}

/**
 * Caçamba de entulho amarela (modelo 3D com ferrugem e entulho). Consome os mesmos sorteios
 * da caçamba antiga, que continua como reserva sem os modelos.
 */
export function addDumpster(b: WorldBuilder, rng: Rng, x: number, z: number, ry: number): void {
  if (WorldAssets.current?.props.has('Cacamba')) {
    for (let i = 0; i < 72; i++) rng.next();
    placeCacamba(b, x, z, ry);
    return;
  }
  const m = b.mats;
  b.extrude([[-1.35, 0.08], [1.35, 0.08], [1.7, 1.12], [-1.7, 1.12]], 1.6, m.orange, x, 0, z, ry);
  for (const lx of [-1.0, 1.0]) {
    const [px, pz] = local(x, z, ry, lx, 0);
    b.box({ w: 0.25, h: 0.12, d: 1.66, x: px, z: pz, y: 0, mat: m.metalDark, ry });
  }
  // Entulho aparecendo por cima.
  for (let i = 0; i < 9; i++) {
    const [px, pz] = local(x, z, ry, rng.range(-1.3, 1.3), rng.range(-0.55, 0.55));
    const mat = rng.pick([m.brick, m.concrete, m.wood, m.concreteDark]);
    b.box({ w: rng.range(0.25, 0.6), h: rng.range(0.15, 0.35), d: rng.range(0.2, 0.5), x: px, z: pz, y: 1.0, mat, ry: rng.range(0, 3), rx: rng.range(-0.3, 0.3) });
  }
  b.collider(3.3, 1.12, 1.6, x, 0.56, z, 0, ry, 0);
  b.contactShadow(x, z, Math.abs(Math.cos(ry)) > 0.5 ? 3.0 : 1.6, Math.abs(Math.cos(ry)) > 0.5 ? 1.6 : 3.0, 0, 0.5);
}

/**
 * Monte de sacos de lixo (modelo 3D de `favela_props.py`: sacos amarrados e amassados,
 * papelão, garrafa). Consome os mesmos sorteios do monte antigo de esferas, que continua
 * como reserva sem o modelo.
 */
export function addTrashPile(b: WorldBuilder, rng: Rng, x: number, y: number, z: number): void {
  if (WorldAssets.current?.props.has('Lixo_a')) {
    const n = rng.int(3, 6);
    for (let i = 0; i < n * 7; i++) rng.next();
    const r = spotRng(x, z, 21);
    placeProp(b, r.pick(['Lixo_a', 'Lixo_b', 'Lixo_c']), x, y, z, r.range(0, Math.PI * 2), r.range(0.85, 1.1));
    return;
  }
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const s = MeshBuilder.CreateSphere('trash', { diameter: rng.range(0.45, 0.7), segments: 8 }, b.scene);
    s.position.set(x + rng.range(-0.5, 0.5), y + 0.2 + (i > 3 ? 0.25 : 0), z + rng.range(-0.4, 0.4));
    s.scaling.set(1, rng.range(0.7, 0.95), rng.range(0.85, 1.1));
    s.rotation.y = rng.range(0, 3);
    b.addMesh(s, rng.chance(0.75) ? b.mats.trashBag : b.mats.plasticBlue);
  }
}

export type CarVariant = 'comum' | 'taxi' | 'policia';

/** Sorteio dos modelos: os hatches e sedãs dominam a rua, como na vida real. */
const CAR_WEIGHTS: ReadonlyArray<[CarModelId, number]> = [
  ['hatch', 0.3],
  ['seda', 0.2],
  ['besouro', 0.18],
  ['picape', 0.16],
  ['perua', 0.16],
];

function pickCarModel(rng: Rng): CarModelId {
  let r = rng.next();
  for (const [id, w] of CAR_WEIGHTS) {
    if ((r -= w) <= 0) return id;
  }
  return 'hatch';
}

/**
 * Carro popular brasileiro genérico (modelo 3D de `tools/blender/cars.py`): hatch anos 90,
 * sedã antigo, perua, picape ou "besouro", com pintura sorteada. `variant` põe o luminoso
 * de táxi (amarelo) ou o giroflex e as portas escuras da viatura (genérica, sem brasão).
 * Sem o GLB carregado, cai no carro de caixas antigo.
 */
export function addCar(b: WorldBuilder, rng: Rng, x: number, z: number, ry: number, variant: CarVariant = 'comum'): void {
  const assets = WorldAssets.current;
  if (!assets) {
    addBoxCar(b, rng, x, z, ry);
    return;
  }
  const m = b.mats;
  // Um único sorteio do gerador do mapa (como o carro antigo); o resto vem de um gerador próprio,
  // para a disposição das casas sorteadas depois continuar a mesma.
  const r = new Rng(rng.int(1, 1e9));
  // Viatura: o modelo detalhado enviado, quando carregou.
  if (variant === 'policia' && addVehicle(b, 'viatura', x, z, ry)) return;
  const id = variant === 'comum' ? pickCarModel(r) : r.pick(['hatch', 'seda'] as const);
  // A perua de cars.py deu lugar à Kombi enviada (modelo detalhado com textura).
  if (id === 'perua' && addVehicle(b, 'kombi', x, z, ry)) return;
  const model = assets.cars.get(id)!;
  const paint = variant === 'taxi' ? m.carTaxi : variant === 'policia' ? m.carPaints[2] : r.pick(m.carPaints);
  // Perua de duas cores: teto/saia de cima branco; a viatura tem portas escuras.
  const paint2 = id === 'perua' ? m.carPaints[2] : variant === 'policia' ? m.carPolice : paint;
  const roles: Record<string, Material> = {
    paint,
    paint2,
    glass: m.glass,
    trim: m.carTrim,
    chrome: m.chrome,
    rubber: m.rubber,
    rim: m.metal,
    light_f: m.headlight,
    light_r: m.taillight,
    plate: m.white,
    blue: m.plasticBlue,
    under: m.rubber,
  };
  // O modelo tem a frente em -X; gira meia volta para manter o carro antigo (frente em +X).
  const rot = ry + Math.PI;
  b.model(model, x, 0, z, rot, (role) => roles[role] ?? paint);

  const cabin = model.colliders[1] ?? model.colliders[0];
  const roofY = cabin.center.y + cabin.size.y / 2;
  const [rx, rz] = local(x, z, rot, cabin.center.x, cabin.center.z);
  if (variant === 'taxi') {
    b.box({ w: 0.62, h: 0.05, d: 0.2, x: rx, z: rz, y: roofY + 0.02, mat: m.carTrim, ry: rot });
    b.box({ w: 0.6, h: 0.2, d: 0.18, x: rx, z: rz, y: roofY + 0.07, mat: m.taxiSign, ry: rot, tile: 0.6, tileV: 0.2 });
  } else if (variant === 'policia') {
    b.box({ w: 0.3, h: 0.06, d: 1.1, x: rx, z: rz, y: roofY + 0.02, mat: m.carTrim, ry: rot });
    for (const side of [-1, 1]) {
      const [lx, lz] = local(rx, rz, rot, 0, side * 0.28);
      b.box({ w: 0.24, h: 0.11, d: 0.48, x: lx, z: lz, y: roofY + 0.08, mat: side > 0 ? m.sirenRed : m.sirenBlue, ry: rot });
    }
  }

  const sx = model.max.x - model.min.x;
  const sz = model.max.z - model.min.z;
  const along = Math.abs(Math.cos(ry)) > 0.5;
  b.contactShadow(x, z, along ? sx - 0.3 : sz - 0.1, along ? sz - 0.1 : sx - 0.3, 0, 0.6);
}

/**
 * Veículo detalhado enviado (Fusca, viatura, ambulância — `tools/blender/vehicle.py`)
 * estacionado: carroceria com a textura original e vidros. Perto usa o modelo de 40 mil
 * triângulos; longe, a versão leve. `ry` segue a mesma convenção do addCar. Devolve false
 * se o modelo não carregou (o chamador decide o que pôr no lugar).
 */
export function addVehicle(b: WorldBuilder, id: DetailedVehicleId, x: number, z: number, ry: number): boolean {
  const v = WorldAssets.current?.vehicles.get(id);
  if (!v) return false;
  const glass = vehicleGlass(b);
  const mat = (role: string) => (role === `${id}_glass` ? glass : (v.materials.get(role) ?? null));
  // O modelo tem a frente em -X, como os carros de cars.py.
  const rot = ry + Math.PI;
  // A versão de longe da ambulância saía derretida e desbotada (parecia uma Kombi velha):
  // são só duas no mapa, então ela usa o modelo completo sempre (some além de 130 m pelo
  // corte de detalhes do StaticBatcher).
  const lod = id === 'ambulancia' ? null : v.lod;
  b.model(v.model, x, 0, z, rot, mat, lod ? { lod: 0 } : {});
  if (lod) b.model(lod, x, 0, z, rot, mat, { lod: 1, collide: false });
  const sx = v.model.max.x - v.model.min.x;
  const sz = v.model.max.z - v.model.min.z;
  const along = Math.abs(Math.cos(ry)) > 0.5;
  b.contactShadow(x, z, along ? sx - 0.3 : sz - 0.1, along ? sz - 0.1 : sx - 0.3, 0, 0.6);
  return true;
}

let glassMat: Material | null = null;

/** Vidro dos veículos detalhados: escuro, quase sem rugosidade, com o reflexo do estúdio (como as lentes). */
function vehicleGlass(b: WorldBuilder): Material {
  if (glassMat && glassMat.getScene() === b.scene) return glassMat;
  const m = studioMaterial(b.scene, 'veiculo_vidro', '#0b1116', 0.0, 0.04, 1.4);
  m.alpha = 0.42;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.backFaceCulling = false;
  m.metadata = { castShadow: false };
  glassMat = m;
  return m;
}

/** Carro de caixas (o antigo), usado só se o GLB dos carros não carregar. */
function addBoxCar(b: WorldBuilder, rng: Rng, x: number, z: number, ry: number): void {
  const m = b.mats;
  const paint = rng.pick(m.carPaints);
  const body: Array<[number, number]> = [
    [-1.96, 0.3], [1.96, 0.3], [2.02, 0.55], [1.9, 0.8], [0.95, 0.9], [-1.0, 0.92], [-1.86, 0.86], [-2.0, 0.6],
  ];
  b.extrude(body, 1.7, paint, x, 0, z, ry);
  b.extrude([[-0.98, 0.88], [0.92, 0.88], [0.5, 1.4], [-0.78, 1.42]], 1.52, m.glass, x, 0, z, ry);
  const [rx, rz] = local(x, z, ry, -0.14, 0);
  b.box({ w: 1.34, h: 0.06, d: 1.56, x: rx, z: rz, y: 1.39, mat: paint, ry });
  // Colunas.
  for (const lx of [-0.86, 0.72]) {
    for (const lz of [-0.76, 0.76]) {
      const [px, pz] = local(x, z, ry, lx, lz);
      b.box({ w: 0.08, h: 0.52, d: 0.05, x: px, z: pz, y: 0.88, mat: paint, ry, rz: lx > 0 ? 0.6 : -0.35 });
    }
  }
  // Rodas.
  for (const lx of [-1.25, 1.25]) {
    for (const lz of [-0.8, 0.8]) {
      const [px, pz] = local(x, z, ry, lx, lz);
      b.cylinder({ diameter: 0.64, h: 0.24, x: px, y: 0.32 - 0.12, z: pz, mat: m.rubber, tessellation: 16, rx: Math.PI / 2, ry });
      const [hx, hz] = local(x, z, ry, lx, lz * 1.16);
      b.cylinder({ diameter: 0.36, h: 0.04, x: hx, y: 0.32 - 0.02, z: hz, mat: m.metal, tessellation: 12, rx: Math.PI / 2, ry });
    }
  }
  // Para-choques e luzes.
  for (const side of [-1, 1]) {
    const [bx, bz] = local(x, z, ry, side * 2.02, 0);
    b.box({ w: 0.14, h: 0.14, d: 1.74, x: bx, z: bz, y: 0.3, mat: m.metalDark, ry });
    for (const lz of [-0.58, 0.58]) {
      const [lx2, lz2] = local(x, z, ry, side * 2.0, lz);
      b.box({ w: 0.06, h: 0.13, d: 0.3, x: lx2, z: lz2, y: 0.58, mat: side > 0 ? m.headlight : m.taillight, ry });
    }
  }
  b.collider(4.05, 1.42, 1.72, x, 0.71, z, 0, ry, 0);
  const along = Math.abs(Math.cos(ry)) > 0.5;
  b.contactShadow(x, z, along ? 3.8 : 1.6, along ? 1.6 : 3.8, 0, 0.6);
}

/**
 * Árvore 3D (mangueira, amendoeira, coqueiro ou árvore de calçada; `species` força uma).
 * Consome do gerador do mapa exatamente os mesmos sorteios da árvore antiga, para tudo o
 * que é sorteado depois continuar no mesmo lugar. Sem os modelos, faz a árvore antiga.
 */
export function addTree(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, scale = 1, species?: TreeSpecies): void {
  if (WorldAssets.current) {
    rng.next();
    rng.next();
    const clumps = rng.int(5, 8);
    for (let i = 0; i < clumps * 8; i++) rng.next();
    const r = spotRng(x, z, 5);
    if (placeTree(b, species ?? pickSpecies(r), x, y, z, r.range(0, Math.PI * 2), scale)) return;
  }
  addBoxTree(b, rng, x, y, z, scale);
}

/** Árvore de cachos low-poly (a antiga). */
function addBoxTree(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, scale: number): void {
  const m = b.mats;
  const h = 2.6 * scale;
  b.cylinder({ diameter: 0.5 * scale, diameterTop: 0.3 * scale, h, x, y, z, mat: m.bark, tessellation: 9, collide: true });
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, Math.PI * 2);
    b.cylinder({ diameter: 0.18 * scale, diameterTop: 0.1 * scale, h: 1.4 * scale, x: x + Math.cos(a) * 0.35, y: y + h - 0.5, z: z + Math.sin(a) * 0.35, mat: m.bark, tessellation: 6, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 });
  }
  const clumps = rng.int(5, 8);
  for (let i = 0; i < clumps; i++) {
    const r = rng.range(1.0, 1.7) * scale;
    const s = MeshBuilder.CreateIcoSphere('leaves', { radius: r, subdivisions: 2, flat: true }, b.scene);
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 1.3) * scale;
    s.position.set(x + Math.cos(a) * d, y + h + rng.range(0.4, 1.8) * scale, z + Math.sin(a) * d);
    s.scaling.set(1, rng.range(0.75, 0.95), 1);
    s.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
    b.addMesh(s, rng.chance(0.5) ? m.foliage : m.foliageDark);
  }
}

export function addPotPlant(b: WorldBuilder, rng: Rng, x: number, y: number, z: number): void {
  const m = b.mats;
  b.cylinder({ diameter: 0.38, diameterTop: 0.42, h: 0.36, x, y, z, mat: m.rust, tessellation: 10 });
  const s = MeshBuilder.CreateIcoSphere('plant', { radius: rng.range(0.25, 0.4), subdivisions: 1, flat: true }, b.scene);
  s.position.set(x, y + 0.55, z);
  s.scaling.y = rng.range(0.9, 1.4);
  b.addMesh(s, rng.chance(0.5) ? m.foliage : m.foliageDark);
}

/** Varal com roupas penduradas. `axis` = direção dos fios. */
export function addClothesline(b: WorldBuilder, rng: Rng, x: number, y: number, z: number, length: number, axis: 'x' | 'z'): void {
  const m = b.mats;
  const dx = axis === 'x' ? length / 2 : 0;
  const dz = axis === 'z' ? length / 2 : 0;
  const a = new Vector3(x - dx, y, z - dz);
  const c = new Vector3(x + dx, y, z + dz);
  for (const p of [a, c]) b.cylinder({ diameter: 0.05, h: 1.7, x: p.x, y, z: p.z, mat: m.metal, tessellation: 6 });
  const top = new Vector3(0, 1.62, 0);
  b.wire(a.add(top), c.add(top), 0.12, 0.012);
  const n = Math.floor(length / 0.55);
  for (let i = 0; i < n; i++) {
    if (rng.chance(0.25)) continue;
    const t = (i + 0.5) / n;
    const p = Vector3.Lerp(a, c, t);
    const sag = 0.12 * 4 * t * (1 - t);
    const w = rng.range(0.32, 0.5);
    const h = rng.range(0.35, 0.65);
    b.box({
      w: axis === 'x' ? w : 0.02,
      h,
      d: axis === 'z' ? w : 0.02,
      x: p.x,
      z: p.z,
      y: y + 1.6 - sag - h,
      mat: rng.pick(m.clothes),
    });
  }
}

export function addSatelliteDish(b: WorldBuilder, x: number, y: number, z: number, ry: number): void {
  const m = b.mats;
  b.cylinder({ diameter: 0.05, h: 0.75, x, y, z, mat: m.metalDark, tessellation: 6 });
  const dish = MeshBuilder.CreateCylinder('dish', { diameterTop: 0.75, diameterBottom: 0.12, height: 0.16, tessellation: 18 }, b.scene);
  dish.position.set(x, y + 0.85, z);
  dish.rotation.set(-0.9, ry, 0);
  b.addMesh(dish, m.white);
}

export function addAcUnit(b: WorldBuilder, x: number, y: number, z: number, axis: 'x' | 'z', facing: 1 | -1): void {
  const m = b.mats;
  const w = 0.78;
  const d = 0.3;
  if (axis === 'z') {
    b.box({ w, h: 0.5, d, x, z: z + facing * d / 2, y, mat: m.white });
    b.box({ w: w * 0.55, h: 0.36, d: 0.02, x: x + 0.1, z: z + facing * (d + 0.005), y: y + 0.07, mat: m.metalDark });
  } else {
    b.box({ w: d, h: 0.5, d: w, x: x + facing * d / 2, z, y, mat: m.white });
    b.box({ w: 0.02, h: 0.36, d: w * 0.55, x: x + facing * (d + 0.005), z: z + 0.1, y: y + 0.07, mat: m.metalDark });
  }
}

export function addGasCylinder(b: WorldBuilder, x: number, y: number, z: number): void {
  b.cylinder({ diameter: 0.36, h: 0.5, x, y, z, mat: b.mats.gasRed, tessellation: 12 });
  b.cylinder({ diameter: 0.12, h: 0.1, x, y: y + 0.5, z, mat: b.mats.metal, tessellation: 8 });
}

/** Caixote de feira com frutas. */
export function addFruitCrate(b: WorldBuilder, rng: Rng, x: number, y: number, z: number): void {
  const m = b.mats;
  b.box({ w: 0.55, h: 0.3, d: 0.38, x, z, y, mat: m.wood });
  const fruit = rng.pick([m.orange, m.plasticYellow, m.plasticRed, m.foliage]);
  for (let i = 0; i < 6; i++) {
    const s = MeshBuilder.CreateSphere('fruit', { diameter: 0.13, segments: 6 }, b.scene);
    s.position.set(x - 0.18 + (i % 3) * 0.18, y + 0.33, z - 0.08 + Math.floor(i / 3) * 0.16);
    b.addMesh(s, fruit);
  }
}

/** Muro de bloco/reboco com coroamento (para o parkour). */
export function addWall(b: WorldBuilder, x0: number, z0: number, x1: number, z1: number, h: number, mat: Material, base = 0): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  b.box({ w: len, h, d: 0.22, x: cx, z: cz, y: base, mat, ry, tile: 2.5, tileV: 3, collide: true });
  b.box({ w: len + 0.06, h: 0.08, d: 0.3, x: cx, z: cz, y: base + h, mat: b.mats.concrete, ry });
}
