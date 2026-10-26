import { Camera, DumpTools, Engine, FreeCamera, RenderTargetTexture, Scene, Texture, Vector3 } from '@babylonjs/core';

/**
 * "Fotos" tiradas pelo próprio jogo, uma vez na abertura: a arte dos cards de modo
 * (cenas reais do mapa em vez de ilustração vetorial) e o fundo do minimapa (o mapa visto
 * de cima, em projeção ortográfica). Renderizadas fora da tela, com uma câmera própria.
 */
export interface ShotSpec {
  pos: Vector3;
  target: Vector3;
  fov?: number;
  width: number;
  height: number;
}

export async function renderShot(engine: Engine, scene: Scene, s: ShotSpec): Promise<string> {
  const cam = new FreeCamera('foto', s.pos.clone(), scene);
  cam.setTarget(s.target);
  cam.fov = s.fov ?? 0.85;
  cam.minZ = 0.3;
  cam.maxZ = 1500;
  try {
    return await shootToDataUrl(engine, scene, cam, s.width, s.height, 4);
  } finally {
    cam.dispose();
  }
}

/**
 * Mapa visto de cima (norte = +Z para cima na imagem), cobrindo [-half, half] nos dois
 * eixos. A câmera fica abaixo das nuvens e a névoa é desligada durante a foto.
 */
export async function renderMapTopDown(engine: Engine, scene: Scene, half: number, size: number): Promise<string> {
  const cam = new FreeCamera('fotoMapa', new Vector3(0, 60, 0), scene);
  cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
  cam.orthoLeft = -half;
  cam.orthoRight = half;
  cam.orthoTop = half;
  cam.orthoBottom = -half;
  // olhando para baixo com o norte (+Z) para cima na imagem
  cam.upVector = new Vector3(0, 0, 1);
  cam.setTarget(new Vector3(0, 0, 0.001));
  cam.minZ = 1;
  cam.maxZ = 90;
  const fog = scene.fogEnabled;
  scene.fogEnabled = false;
  // Só fotografa com tudo pronto (relevo e mar ainda compilando saíam de fora: fundo marrom).
  await scene.whenReadyAsync();
  try {
    return await shootToDataUrl(engine, scene, cam, size, size, 1);
  } finally {
    scene.fogEnabled = fog;
    cam.dispose();
  }
}

/**
 * Foto fora da tela com a câmera dada. Faz o mesmo que o CreateScreenshotUsingRenderTarget
 * do Babylon, com uma diferença importante: o Babylon troca a largura/altura da tela pelas
 * da foto ENQUANTO espera a cena ficar pronta, e se a partida começava nesse meio-tempo o
 * jogo era desenhado em metade da tela (e a mira usava o tamanho errado). Aqui a troca só
 * vale durante o desenho da foto, que é síncrono.
 */
async function shootToDataUrl(engine: Engine, scene: Scene, cam: Camera, width: number, height: number, samples: number): Promise<string> {
  const tex = new RenderTargetTexture('foto', { width, height }, scene, false, false, 0, false, Texture.BILINEAR_SAMPLINGMODE, undefined, false, undefined, undefined, undefined, samples);
  tex.renderList = scene.meshes.slice();
  tex.activeCamera = cam;
  tex.renderSprites = true;
  try {
    // Espera tudo pronto sem mexer em nada do motor.
    while (!(tex.isReadyForRendering() && cam.isReady(true))) await new Promise((r) => setTimeout(r, 50));
    const getW = engine.getRenderWidth;
    const getH = engine.getRenderHeight;
    const prevCam = scene.activeCamera;
    const prevCams = scene.activeCameras;
    const prevOut = cam.outputRenderTarget;
    const prevMeshes = scene.meshes;
    engine.getRenderWidth = (useScreen = false) => (!useScreen && engine._currentRenderTarget ? engine._currentRenderTarget.width : width);
    engine.getRenderHeight = (useScreen = false) => (!useScreen && engine._currentRenderTarget ? engine._currentRenderTarget.height : height);
    engine.onResizeObservable.notifyObservers(engine);
    try {
      scene.incrementRenderId();
      scene.resetCachedMaterial();
      scene.activeCamera = cam;
      scene.activeCameras = null;
      cam.outputRenderTarget = tex;
      scene.meshes = tex.renderList!;
      scene.render();
    } finally {
      scene.activeCamera = prevCam;
      scene.activeCameras = prevCams;
      cam.outputRenderTarget = prevOut;
      scene.meshes = prevMeshes;
      engine.getRenderWidth = getW;
      engine.getRenderHeight = getH;
      engine.onResizeObservable.notifyObservers(engine);
      prevCam?.getProjectionMatrix(true);
    }
    const data = await tex.readPixels(undefined, undefined, undefined, false);
    if (!data) throw new Error('foto sem dados');
    return await DumpTools.DumpDataAsync(width, height, data, 'image/jpeg', undefined, true, false, 0.9);
  } finally {
    tex.dispose();
  }
}
