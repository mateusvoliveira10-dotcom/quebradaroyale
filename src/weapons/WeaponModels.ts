import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { WorldAssets } from '../world/WorldAssets';
import { RARITIES, WeaponId } from './WeaponDefs';

export interface WeaponModel {
  root: TransformNode;
  muzzle: TransformNode;
  meshes: Mesh[];
  /** Detalhes na cor da raridade (brilham no chão). */
  accents: Mesh[];
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

function mats(scene: Scene): GunMats {
  if (cache) return cache;
  const mk = (name: string, hex: string, spec: number, power: number, emissive = 0.05) => {
    const m = new StandardMaterial(name, scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = power;
    m.emissiveColor = c.scale(emissive);
    return m;
  };
  cache = {
    metal: mk('gun_metal', '#2c2f35', 0.7, 64),
    polymer: mk('gun_polymer', '#1b1c20', 0.25, 24),
    wood: mk('gun_wood', '#8a5530', 0.3, 32),
    steel: mk('gun_steel', '#8d949c', 1.0, 90),
    lens: mk('gun_lens', '#2f6d8c', 1.0, 140, 0.3),
    rubber: mk('gun_rubber', '#141416', 0.08, 12),
    rarity: RARITIES.map((r, i) => mk(`gun_rarity_${i}`, r.color, 0.5, 40, 0.6)),
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
