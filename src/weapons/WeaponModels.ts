import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import { WorldAssets } from '../world/WorldAssets';
import { RARITIES, WeaponId } from './WeaponDefs';

export interface WeaponModel {
  root: TransformNode;
  muzzle: TransformNode;
  meshes: Mesh[];
  /** Detalhes na cor da raridade (brilham no chão). */
  accents: Mesh[];
  /** Onde a mão esquerda apoia (espaço da arma); sem isto vale o padrão do tipo de arma. */
  supportGrip?: Vector3;
}

interface GunMats {
  metal: StandardMaterial;
  polymer: StandardMaterial;
  wood: StandardMaterial;
  steel: StandardMaterial;
  lens: StandardMaterial;
  rubber: StandardMaterial;
  rarity: StandardMaterial[];
}

let cache: GunMats | null = null;

type Ctx = CanvasRenderingContext2D;

/** Gerador simples e fixo (as texturas saem sempre iguais). */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(scene: Scene, name: string, size: number, draw: (ctx: Ctx, s: number, r: () => number) => void, repeat: number): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = t.getContext() as unknown as Ctx;
  draw(ctx, size, rnd(name.length * 7919 + size));
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  // UV em metros (projeção de caixa): repeat = repetições por metro.
  t.uScale = repeat;
  t.vScale = repeat;
  t.anisotropicFilteringLevel = 8;
  return t;
}

/** Metal oxidado: escovado fino, manchas, riscos e desgaste claro (branco = cor cheia). */
function drawMetal(ctx: Ctx, s: number, r: () => number): void {
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 3; i++) {
    const y = r() * s;
    ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.05})`;
    ctx.fillRect(0, y, s, 1);
  }
  for (let i = 0; i < 14; i++) {
    const x = r() * s, y = r() * s, rad = 8 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(40,36,30,0.18)');
    g.addColorStop(1, 'rgba(40,36,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 26; i++) {
    ctx.lineWidth = 0.5 + r();
    const x = r() * s, y = r() * s, a = r() * Math.PI, l = 6 + r() * 30;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`;
    ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1);
  }
}

/** Polímero: pontilhado fino (textura de empunhadura) e leve variação. */
function drawPolymer(ctx: Ctx, s: number, r: () => number): void {
  ctx.fillStyle = '#d0d0d0';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s * s * 0.25; i++) {
    ctx.fillStyle = `rgba(${r() < 0.55 ? '0,0,0' : '255,255,255'},${0.06 + r() * 0.1})`;
    ctx.fillRect(r() * s, r() * s, 1.5, 1.5);
  }
  for (let i = 0; i < 8; i++) {
    const x = r() * s, y = r() * s, rad = 20 + r() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** Madeira: veios ondulados escuros e claros com alguns nós. */
function drawWood(ctx: Ctx, s: number, r: () => number): void {
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#e2c39a');
  g.addColorStop(1, '#cfa979');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 70; i++) {
    const y0 = r() * s, amp = 2 + r() * 6, f = 0.01 + r() * 0.03, ph = r() * 6;
    ctx.strokeStyle = r() < 0.6 ? `rgba(90,50,20,${0.15 + r() * 0.25})` : `rgba(255,235,200,${0.1 + r() * 0.15})`;
    ctx.lineWidth = 0.6 + r() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= s; x += 4) {
      const y = y0 + Math.sin(x * f + ph) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = r() * s, y = r() * s;
    ctx.fillStyle = 'rgba(70,35,12,0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + r() * 5, 2 + r() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Relevo fino comum (normal map a partir de ruído): poros do polímero, marcas do metal. */
function drawBump(ctx: Ctx, s: number, r: () => number): void {
  const h = new Float32Array(s * s);
  for (let i = 0; i < h.length; i++) h[i] = r();
  // Suaviza um pouco (ruído "granulado" em vez de chiado).
  const sm = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let t = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += h[((y + dy + s) % s) * s + ((x + dx + s) % s)];
    sm[y * s + x] = t / 9;
  }
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (sm[y * s + ((x + 1) % s)] - sm[y * s + ((x - 1 + s) % s)]) * 3;
    const dy = (sm[((y + 1) % s) * s + x] - sm[((y - 1 + s) % s) * s + x]) * 3;
    const i = (y * s + x) * 4;
    img.data[i] = Math.max(0, Math.min(255, 128 - dx * 127));
    img.data[i + 1] = Math.max(0, Math.min(255, 128 - dy * 127));
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function mats(scene: Scene): GunMats {
  if (cache && cache.metal.getScene() === scene) return cache;
  const bump = canvasTex(scene, 'gun_bump', 128, drawBump, 22);
  bump.level = 0.35;
  const metalTex = canvasTex(scene, 'gun_metalTex', 256, drawMetal, 7);
  const polyTex = canvasTex(scene, 'gun_polyTex', 256, drawPolymer, 9);
  const woodTex = canvasTex(scene, 'gun_woodTex', 256, drawWood, 4);
  const mk = (name: string, hex: string, spec: number, power: number, o: { tex?: Texture; specTex?: Texture; bump?: boolean; emissive?: number } = {}) => {
    const m = new StandardMaterial(name, scene);
    const col = Color3.FromHexString(hex);
    m.diffuseColor = col;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = power;
    m.emissiveColor = col.scale(o.emissive ?? 0.14);
    if (o.tex) m.diffuseTexture = o.tex;
    if (o.specTex) m.specularTexture = o.specTex;
    if (o.bump) m.bumpTexture = bump;
    return m;
  };
  cache = {
    // Aço oxidado (oxidação preta), com reflexo nos riscos e quinas gastas.
    metal: mk('gun_metal', '#5c616a', 0.75, 72, { tex: metalTex, specTex: metalTex, bump: true }),
    polymer: mk('gun_polymer', '#3e4046', 0.18, 18, { tex: polyTex, bump: true }),
    wood: mk('gun_wood', '#8a5228', 0.35, 30, { tex: woodTex, bump: true }),
    steel: mk('gun_steel', '#a3a9b0', 1.1, 110, { tex: metalTex, specTex: metalTex }),
    lens: mk('gun_lens', '#2f6d8c', 1.0, 160, { emissive: 0.3 }),
    rubber: mk('gun_rubber', '#16171a', 0.06, 10, { tex: polyTex, bump: true }),
    rarity: RARITIES.map((r, i) => mk(`gun_rarity_${i}`, r.color, 0.5, 40, { emissive: 0.45, tex: polyTex })),
  };
  return cache;
}

/**
 * Armas estilizadas montadas com primitivas. Origem no punho, cano apontando
 * para +Z (o personagem segura pela origem).
 */
/** Onde sai o tiro (relativo ao punho), igual para o modelo novo e o antigo. */
const MUZZLE: Record<WeaponId, [number, number]> = {
  pistola: [0.055, 0.18],
  smg: [0.05, 0.39],
  escopeta: [0.065, 0.8],
  fuzil: [0.05, 0.78],
  sniper: [0.05, 0.92],
};

/**
 * Arma do GLB (`tools/blender/weapons.py`): uma malha por material, clonada da base (a
 * geometria é compartilhada entre todas as cópias). Mesma origem e medidas das antigas.
 */
function buildFromAsset(scene: Scene, id: WeaponId, rarity: number): WeaponModel | null {
  const model = WorldAssets.current?.props.get(`Arma_${id}`);
  if (!model) return null;
  const g = mats(scene);
  const root = new TransformNode(`weapon_${id}`, scene);
  const meshes: Mesh[] = [];
  const accents: Mesh[] = [];
  const byRole: Record<string, StandardMaterial> = { metal: g.metal, polymer: g.polymer, wood: g.wood, steel: g.steel, lens: g.lens, rubber: g.rubber, accent: g.rarity[rarity] };
  for (const [role, base] of model.parts) {
    const m = base.clone(`gun_${id}_${role}`, root, true);
    m.setEnabled(true);
    m.material = byRole[role] ?? g.metal;
    m.isPickable = false;
    meshes.push(m);
    if (role === 'accent') accents.push(m);
  }
  const muzzle = new TransformNode('muzzle', scene);
  muzzle.parent = root;
  muzzle.position = new Vector3(0, MUZZLE[id][0], MUZZLE[id][1]);
  return { root, muzzle, meshes, accents };
}

export function buildWeaponModel(scene: Scene, id: WeaponId, rarity: number): WeaponModel {
  const fromAsset = buildFromAsset(scene, id, rarity);
  if (fromAsset) return fromAsset;
  const g = mats(scene);
  const root = new TransformNode(`weapon_${id}`, scene);
  const meshes: Mesh[] = [];
  const accents: Mesh[] = [];
  const accent = g.rarity[rarity];

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial, rx = 0): Mesh => {
    const mesh = MeshBuilder.CreateBox('gunPart', { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = false;
    meshes.push(mesh);
    if (mat === accent) accents.push(mesh);
    return mesh;
  };
  const tube = (dia: number, len: number, x: number, y: number, z: number, mat: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateCylinder('gunTube', { diameter: dia, height: len, tessellation: 12 }, scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };

  let muzzleZ = 0.2;
  let muzzleY = 0.05;

  switch (id) {
    case 'pistola':
      box(0.034, 0.042, 0.2, 0, 0.055, 0.06, g.metal);
      box(0.03, 0.03, 0.17, 0, 0.022, 0.05, g.polymer);
      box(0.03, 0.115, 0.05, 0, -0.03, -0.005, g.polymer, 0.22);
      box(0.036, 0.008, 0.12, 0, 0.078, 0.06, accent);
      box(0.012, 0.012, 0.012, 0, 0.082, 0.15, g.steel);
      tube(0.016, 0.02, 0, 0.055, 0.165, g.steel);
      muzzleZ = 0.18;
      muzzleY = 0.055;
      break;
    case 'smg':
      box(0.05, 0.07, 0.3, 0, 0.04, 0.08, g.metal);
      tube(0.026, 0.16, 0, 0.05, 0.3, g.steel);
      box(0.034, 0.16, 0.05, 0, -0.06, 0.12, g.polymer, -0.1);
      box(0.034, 0.1, 0.045, 0, -0.03, -0.01, g.polymer, 0.25);
      box(0.012, 0.02, 0.2, 0, 0.08, 0.08, g.steel);
      box(0.052, 0.012, 0.18, 0, 0.0, 0.12, accent);
      box(0.02, 0.06, 0.16, 0, 0.03, -0.14, g.steel);
      box(0.03, 0.08, 0.02, 0, 0.0, -0.22, g.polymer);
      muzzleZ = 0.39;
      break;
    case 'escopeta':
      box(0.05, 0.075, 0.24, 0, 0.04, 0.06, g.metal);
      tube(0.034, 0.62, 0, 0.065, 0.48, g.steel);
      tube(0.03, 0.5, 0, 0.03, 0.42, g.metal);
      box(0.06, 0.06, 0.18, 0, 0.032, 0.38, g.wood);
      box(0.04, 0.11, 0.045, 0, -0.03, -0.02, g.wood, 0.3);
      box(0.045, 0.085, 0.32, 0, 0.0, -0.22, g.wood, -0.08);
      box(0.052, 0.014, 0.2, 0, 0.083, 0.06, accent);
      muzzleZ = 0.8;
      muzzleY = 0.065;
      break;
    case 'fuzil':
      box(0.055, 0.09, 0.42, 0, 0.045, 0.1, g.metal);
      box(0.06, 0.07, 0.24, 0, 0.045, 0.42, g.polymer);
      tube(0.024, 0.3, 0, 0.05, 0.62, g.steel);
      box(0.035, 0.18, 0.06, 0, -0.07, 0.17, g.metal, -0.28);
      box(0.035, 0.11, 0.045, 0, -0.035, -0.02, g.polymer, 0.25);
      box(0.045, 0.09, 0.28, 0, 0.02, -0.25, g.polymer);
      box(0.02, 0.04, 0.14, 0, 0.11, 0.08, g.metal);
      box(0.058, 0.016, 0.3, 0, 0.0, 0.32, accent);
      box(0.06, 0.012, 0.12, 0, 0.1, -0.25, accent);
      muzzleZ = 0.78;
      break;
    case 'sniper':
      box(0.05, 0.08, 0.36, 0, 0.04, 0.06, g.metal);
      tube(0.026, 0.68, 0, 0.05, 0.56, g.steel);
      tube(0.05, 0.3, 0, 0.13, 0.08, g.polymer);
      tube(0.062, 0.03, 0, 0.13, 0.24, g.metal);
      tube(0.062, 0.03, 0, 0.13, -0.08, g.metal);
      box(0.012, 0.05, 0.02, 0, 0.095, 0.0, g.metal);
      box(0.012, 0.05, 0.02, 0, 0.095, 0.16, g.metal);
      box(0.035, 0.11, 0.045, 0, -0.035, -0.03, g.wood, 0.25);
      box(0.05, 0.1, 0.36, 0, 0.0, -0.26, g.wood, -0.06);
      box(0.055, 0.016, 0.24, 0, 0.0, 0.2, accent);
      muzzleZ = 0.92;
      break;
  }

  const muzzle = new TransformNode('muzzle', scene);
  muzzle.parent = root;
  muzzle.position = new Vector3(0, muzzleY, muzzleZ);
  return { root, muzzle, meshes, accents };
}

export function disposeWeaponModel(model: WeaponModel): void {
  for (const m of model.meshes) m.dispose();
  model.muzzle.dispose();
  model.root.dispose();
}
