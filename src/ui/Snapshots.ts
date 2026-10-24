import { Camera, Engine, FreeCamera, Scene, Tools, Vector3 } from '@babylonjs/core';

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
    return await Tools.CreateScreenshotUsingRenderTargetAsync(engine, cam, { width: s.width, height: s.height }, 'image/jpeg', 4, true);
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
  try {
    return await Tools.CreateScreenshotUsingRenderTargetAsync(engine, cam, { width: size, height: size }, 'image/jpeg', 1, true);
  } finally {
    scene.fogEnabled = fog;
    cam.dispose();
  }
}
