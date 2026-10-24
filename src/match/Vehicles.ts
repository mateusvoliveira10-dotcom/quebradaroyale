import '@babylonjs/loaders/glTF';
import {
  AssetContainer,
  Color3,
  DynamicTexture,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { studioMaterial } from '../player/GlassesMaterial';

function mat(scene: Scene, name: string, hex: string, spec = 0.4, emissive = 0.08): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = new Color3(spec, spec, spec);
  m.specularPower = 48;
  m.emissiveColor = c.scale(emissive);
  return m;
}

export interface Airplane {
  root: TransformNode;
  /** Hélices (giram em torno do Z local). */
  propellers: TransformNode[];
  /** Rampa de carga traseira (gira em X local na dobradiça), se o modelo tiver. */
  ramp: TransformNode | null;
}

/**
 * Modelos do avião e do paraquedas (`tools/blender/airplane.py` e `parachute.py`),
 * carregados uma vez na tela de carregamento. Sem eles, valem as versões antigas de formas
 * simples (abaixo), só como reserva.
 */
let planeAsset: AssetContainer | null = null;
let chuteAsset: AssetContainer | null = null;

export async function loadAirAssets(scene: Scene): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/world/`;
  const [plane, chute] = await Promise.allSettled([LoadAssetContainerAsync(`${base}airplane.glb`, scene), LoadAssetContainerAsync(`${base}parachute.glb`, scene)]);
  const reflect = studioMaterial(scene, 'estudio_ref', '#ffffff', 0, 1).reflectionTexture;
  for (const r of [plane, chute]) {
    if (r.status !== 'fulfilled') {
      console.warn('[Avião/paraquedas] modelo não carregou, usando o de formas simples:', r.reason);
      continue;
    }
    // A cena não tem mapa de ambiente: pintura e metal PBR refletem o "estúdio" dos óculos.
    for (const m of r.value.materials) {
      if (m instanceof PBRMaterial) {
        m.reflectionTexture = reflect;
        m.environmentIntensity = 0.7;
      }
    }
  }
  planeAsset = plane.status === 'fulfilled' ? plane.value : null;
  chuteAsset = chute.status === 'fulfilled' ? chute.value : null;
}

/** Avião do Battle Royale: o modelo do Blender (cargueiro quadrimotor), ou o de reserva. */
export function buildAirplane(scene: Scene): Airplane {
  if (planeAsset) {
    const inst = planeAsset.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = new TransformNode('airplane', scene);
    for (const n of inst.rootNodes) n.parent = root;
    const nodes = root.getChildTransformNodes(false);
    for (const m of root.getChildMeshes(false)) m.isPickable = false;
    // só os nós (as malhas por material, '..._primitive0', vêm junto como filhos)
    const find = (re: RegExp) => nodes.filter((n) => re.test(n.name.replace(/^Clone of /, '')));
    const propellers = find(/^Helice_\d+$/);
    for (const p of propellers) p.rotationQuaternion ??= Quaternion.Identity();
    const ramp = find(/^Rampa$/)[0] ?? null;
    if (ramp) ramp.rotationQuaternion ??= Quaternion.Identity();
    return { root, propellers, ramp };
  }
  return buildBoxAirplane(scene);
}

/** Avião de formas simples (reserva, se o GLB não carregar). Aponta para +Z. */
function buildBoxAirplane(scene: Scene): Airplane {
  const root = new TransformNode('airplane', scene);
  const white = mat(scene, 'plane_white', '#f2f2ee', 0.6);
  const green = mat(scene, 'plane_green', '#139a48', 0.5);
  const yellow = mat(scene, 'plane_yellow', '#ffd21f', 0.5);
  const dark = mat(scene, 'plane_dark', '#22252b', 0.8);
  const glass = mat(scene, 'plane_glass', '#1d2b40', 1.0, 0.15);

  const add = (m: Mesh, material: StandardMaterial): Mesh => {
    m.material = material;
    m.parent = root;
    m.isPickable = false;
    return m;
  };

  const body = add(MeshBuilder.CreateCapsule('fuselage', { radius: 1.7, height: 17, tessellation: 20, capSubdivisions: 8 }, scene), white);
  body.rotation.x = Math.PI / 2;
  body.scaling.set(1, 1, 0.92);
  const stripe = add(MeshBuilder.CreateCylinder('stripe', { diameter: 3.44, height: 11, tessellation: 20 }, scene), green);
  stripe.rotation.x = Math.PI / 2;
  stripe.scaling.set(1, 1, 0.92);
  stripe.position.y = -0.55;
  stripe.scaling.set(1.0, 1, 0.6);
  const stripe2 = add(MeshBuilder.CreateCylinder('stripe2', { diameter: 3.46, height: 11, tessellation: 20 }, scene), yellow);
  stripe2.rotation.x = Math.PI / 2;
  stripe2.scaling.set(1.0, 1, 0.12);
  stripe2.position.y = 0.05;
  const cockpit = add(MeshBuilder.CreateSphere('cockpit', { diameter: 2.6, segments: 14 }, scene), glass);
  cockpit.position.set(0, 0.7, 7.2);
  cockpit.scaling.set(1, 0.45, 0.8);

  const wing = add(MeshBuilder.CreateBox('wing', { width: 26, height: 0.32, depth: 3.4 }, scene), white);
  wing.position.set(0, 1.3, 1);
  const wingTipL = add(MeshBuilder.CreateBox('wingTip', { width: 2.5, height: 0.34, depth: 3.42 }, scene), green);
  wingTipL.position.set(-12, 1.3, 1);
  const wingTipR = add(MeshBuilder.CreateBox('wingTip', { width: 2.5, height: 0.34, depth: 3.42 }, scene), green);
  wingTipR.position.set(12, 1.3, 1);

  const propellers: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const engine = add(MeshBuilder.CreateCylinder('engine', { diameterTop: 0.9, diameterBottom: 1.25, height: 3.4, tessellation: 16 }, scene), dark);
    engine.rotation.x = -Math.PI / 2;
    engine.position.set(side * 5.5, 0.85, 2.4);
    const spinner = add(MeshBuilder.CreateSphere('spinner', { diameter: 0.7, segments: 10 }, scene), yellow);
    spinner.position.set(side * 5.5, 0.85, 4.2);
    const prop = add(MeshBuilder.CreateBox('prop', { width: 4.4, height: 0.3, depth: 0.08 }, scene), dark);
    prop.position.set(side * 5.5, 0.85, 4.25);
    const prop2 = add(MeshBuilder.CreateBox('prop2', { width: 0.3, height: 4.4, depth: 0.08 }, scene), dark);
    prop2.parent = prop;
    prop2.material = dark;
    propellers.push(prop);
  }

  const fin = add(MeshBuilder.CreateBox('fin', { width: 0.3, height: 4.2, depth: 3.2 }, scene), green);
  fin.position.set(0, 3.0, -7.3);
  fin.rotation.x = -0.35;
  const stab = add(MeshBuilder.CreateBox('stabilizer', { width: 9, height: 0.25, depth: 2.2 }, scene), white);
  stab.position.set(0, 1.2, -7.6);

  // Letreiro na lateral.
  const tex = new DynamicTexture('planeName', { width: 1024, height: 192 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1024, 192);
  ctx.font = '900 130px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#139a48';
  ctx.strokeText('QUEBRADA AIR', 512, 96);
  ctx.fillStyle = '#ffd21f';
  ctx.fillText('QUEBRADA AIR', 512, 96);
  tex.update();
  tex.hasAlpha = true;
  const nameMat = new StandardMaterial('planeNameMat', scene);
  nameMat.diffuseTexture = tex;
  nameMat.useAlphaFromDiffuseTexture = true;
  nameMat.emissiveColor = new Color3(0.3, 0.3, 0.3);
  nameMat.specularColor = Color3.Black();
  for (const side of [-1, 1]) {
    const label = add(MeshBuilder.CreatePlane('planeLabel', { width: 8, height: 1.5 }, scene), nameMat);
    label.position.set(side * 1.62, 0.55, 0.5);
    label.rotation.y = side * (Math.PI / 2) * -1;
  }

  return { root, propellers, ramp: null };
}

/**
 * Altura (m) do ponto de origem do paraquedas acima dos pés: o GLB tem a origem entre os
 * ombros (onde os tirantes prendem no personagem).
 */
export const CHUTE_ANCHOR_Y = 1.42;

/**
 * Paraquedas ram-air (velame em arco com células infladas, linhas e tirantes), origem nos
 * ombros. Cada personagem recebe uma cópia (geometria compartilhada).
 */
export function buildParachute(scene: Scene): TransformNode {
  if (chuteAsset) {
    const inst = chuteAsset.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = new TransformNode('parachute', scene);
    for (const n of inst.rootNodes) n.parent = root;
    for (const m of root.getChildMeshes(false)) m.isPickable = false;
    root.setEnabled(false);
    return root;
  }
  return buildBoxParachute(scene);
}

/** Paraquedas de formas simples (reserva). Origem nos pés, como era antes. */
function buildBoxParachute(scene: Scene): TransformNode {
  const outer = new TransformNode('parachute', scene);
  // mesma origem do modelo novo (ombros): o conteúdo antigo, feito a partir dos pés, desce
  const root = new TransformNode('parachuteBox', scene);
  root.parent = outer;
  root.position.y = -CHUTE_ANCHOR_Y;
  const tex = new DynamicTexture('chuteTex', { width: 512, height: 64 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const cols = ['#ffd21f', '#139a48', '#ffd21f', '#139a48', '#2457c5', '#139a48', '#ffd21f', '#139a48'];
  cols.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * 64, 0, 64, 64);
  });
  tex.update();
  const canopyMat = new StandardMaterial('chuteMat', scene);
  canopyMat.diffuseTexture = tex;
  canopyMat.backFaceCulling = false;
  canopyMat.specularColor = new Color3(0.1, 0.1, 0.1);
  canopyMat.emissiveColor = new Color3(0.15, 0.15, 0.15);

  const canopy = MeshBuilder.CreateSphere('canopy', { diameter: 4.6, segments: 20, slice: 0.42 }, scene);
  canopy.scaling.set(1, 0.55, 0.8);
  canopy.position.y = 2.6;
  canopy.material = canopyMat;
  canopy.parent = root;
  canopy.isPickable = false;

  const lineMat = new StandardMaterial('chuteLines', scene);
  lineMat.diffuseColor = new Color3(0.9, 0.9, 0.85);
  lineMat.emissiveColor = new Color3(0.4, 0.4, 0.4);
  const anchors = [
    new Vector3(-2.1, 3.15, 0),
    new Vector3(2.1, 3.15, 0),
    new Vector3(-1.4, 3.2, 1.3),
    new Vector3(1.4, 3.2, 1.3),
    new Vector3(-1.4, 3.2, -1.3),
    new Vector3(1.4, 3.2, -1.3),
  ];
  for (const a of anchors) {
    const hand = new Vector3(Math.sign(a.x) * 0.25, 1.95, 0);
    const line = MeshBuilder.CreateTube('chuteLine', { path: [a, hand], radius: 0.012, tessellation: 4 }, scene);
    line.material = lineMat;
    line.parent = root;
    line.isPickable = false;
  }
  outer.setEnabled(false);
  return outer;
}
