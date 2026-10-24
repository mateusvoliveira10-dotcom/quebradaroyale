// Visualizador de desenvolvimento: carrega um GLB, mostra estatísticas, esqueleto,
// pontos de encaixe e toca as animações. Não faz parte do jogo.
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  Scene,
  SceneLoader,
  SkeletonViewer,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.13, 0.14, 0.18, 1);
const cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.35, 3.2, new Vector3(0, 0.9, 0), scene);
cam.attachControl(canvas, true);
cam.wheelPrecision = 60;
cam.minZ = 0.01;
new HemisphericLight('h', new Vector3(0, 1, 0), scene).intensity = 0.7;
const sun = new DirectionalLight('d', new Vector3(-0.5, -1, -0.8), scene);
sun.intensity = 1.6;

// Régua de 1,75 m ao lado do modelo.
const rulerMat = new StandardMaterial('r', scene);
rulerMat.emissiveColor = Color3.FromHexString('#2bd46b');
const ruler = MeshBuilder.CreateBox('ruler', { width: 0.02, height: 1.75, depth: 0.02 }, scene);
ruler.position.set(0.6, 0.875, 0);
ruler.material = rulerMat;
const ground = MeshBuilder.CreateGround('g', { width: 4, height: 4 }, scene);
const gm = new StandardMaterial('gm', scene);
gm.diffuseColor = Color3.FromHexString('#3a3f4c');
ground.material = gm;

const params = new URLSearchParams(location.search);
const file = params.get('file') ?? '/models/personagem-base.glb';
const t0 = performance.now();
SceneLoader.ImportMeshAsync('', '', file, scene).then((res) => {
  const ms = performance.now() - t0;
  let verts = 0;
  let tris = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of res.meshes) {
    verts += m.getTotalVertices();
    tris += (m.getTotalIndices() || 0) / 3;
    if (m.getTotalVertices() > 0) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, b.minimumWorld.y);
      maxY = Math.max(maxY, b.maximumWorld.y);
    }
  }
  const sk = res.skeletons[0];
  if (sk && res.meshes.find((m) => m.skeleton)) {
    const viewer = new SkeletonViewer(sk, res.meshes.find((m) => m.skeleton)!, scene, false, 3, { displayMode: SkeletonViewer.DISPLAY_LINES });
    viewer.isEnabled = params.has('bones');
  }
  const groups = res.animationGroups;
  groups.forEach((g) => g.stop());
  const box = document.getElementById('anims')!;
  for (const g of groups) {
    const b = document.createElement('button');
    b.textContent = g.name;
    b.onclick = () => {
      groups.forEach((x) => x.stop());
      g.start(true);
    };
    box.appendChild(b);
  }
  const play = params.get('anim');
  if (play) groups.find((g) => g.name === play)?.start(true);
  // ?jersey=<id>: veste uma camisa (malha de jersey_base.glb presa a este esqueleto).
  const jerseyId = params.get('jersey');
  const bodyMesh = res.meshes.find((m) => m.skeleton);
  if (jerseyId && sk && bodyMesh) {
    // ?model=long|tank: manga longa ou regata (padrão: manga curta); todas de gola redonda.
    const model = params.get('model');
    const collar = model === 'long' ? 'Camisa_MangaLonga' : model === 'tank' ? 'Regata' : 'Camisa_GolaRedonda';
    SceneLoader.ImportMeshAsync('', '', '/assets/customization/jerseys/jersey_base.glb', scene).then((jr) => {
      for (const m of jr.meshes) if (m.getTotalVertices() > 0 && m.name !== collar) m.dispose();
      const shirt = jr.meshes.find((m) => m.name === collar)!;
      const names = sk.bones.map((b) => b.name);
      const map = shirt.skeleton!.bones.map((b) => names.indexOf(b.name));
      const idx = shirt.getVerticesData('matricesIndices')!;
      shirt.setVerticesData('matricesIndices', Float32Array.from(idx, (i) => map[i]), false, 4);
      shirt.skeleton = sk;
      const mat = shirt.material as PBRMaterial;
      mat.albedoTexture = new Texture(`/assets/customization/jerseys/${jerseyId}/albedo.webp`, scene, false, false);
      mat.backFaceCulling = false;
      shirt.alwaysSelectAsActiveMesh = true;
      bodyMesh.alwaysSelectAsActiveMesh = true;
      info.textContent += `\nCamisa: ${jerseyId} (${collar}, ${(shirt.getTotalIndices() ?? 0) / 3} triângulos)`;
    });
  }
  const sockets = scene.transformNodes.filter((n) => n.name.startsWith('socket_')).map((n) => n.name);
  info.textContent = [
    `Arquivo: ${file}`,
    `Carregado em ${ms.toFixed(0)} ms`,
    `Malhas: ${res.meshes.filter((m) => m.getTotalVertices() > 0).length} · vértices: ${verts} · triângulos: ${tris}`,
    `Altura: ${(maxY - minY).toFixed(3)} m`,
    `Ossos: ${sk ? sk.bones.length : 0} · animações: ${groups.length}`,
    `Encaixes: ${sockets.join(', ') || 'nenhum'}`,
  ].join('\n');
  (window as unknown as Record<string, unknown>).viewer = { scene, res, cam };
}).catch((e) => {
  info.textContent = 'Erro: ' + (e as Error).message;
  console.error(e);
});

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
