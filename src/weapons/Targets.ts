import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { Shootable } from '../combat/CombatManager';

/**
 * Alvos de treino (placa redonda num poste). Mostram a sensação de acerto:
 * marcador, dano e balanço. Acertar o centro conta como crítico.
 */
export class TrainingTarget implements Shootable {
  private readonly board: Mesh;
  private readonly post: Mesh;
  private wobble = 0;
  private wobbleVel = 0;

  constructor(scene: Scene, mat: StandardMaterial, center: Vector3, facingY: number) {
    const post = (this.post = MeshBuilder.CreateCylinder('targetPost', { diameter: 0.08, height: 1.3, tessellation: 8 }, scene));
    post.position.set(center.x, center.y + 0.65, center.z);
    post.material = mat;
    post.checkCollisions = true;
    this.board = MeshBuilder.CreateCylinder('targetBoard', { diameter: 0.9, height: 0.06, tessellation: 32 }, scene);
    this.board.rotation.set(Math.PI / 2, facingY, 0);
    this.board.position.set(center.x, center.y + 1.65, center.z);
    this.board.material = targetMaterial(scene);
    this.board.checkCollisions = true;
    this.board.metadata = { shootable: this };
  }

  /** Malhas que bloqueiam o movimento (poste e placa). */
  get colliderMeshes(): Mesh[] {
    return [this.post, this.board];
  }

  get meshes(): Mesh[] {
    return [this.board];
  }

  onShot(point: Vector3, damage: number): { damage: number; crit: boolean } {
    const c = this.board.position;
    const dist = Vector3.Distance(point, c);
    const crit = dist < 0.12;
    this.wobbleVel += crit ? 7 : 4;
    return { damage: Math.round(damage * (crit ? 2 : 1)), crit };
  }

  update(dt: number): void {
    // Mola amortecida para o balanço.
    this.wobbleVel += -this.wobble * 60 * dt - this.wobbleVel * 6 * dt;
    this.wobble += this.wobbleVel * dt;
    this.board.rotation.z = this.wobble * 0.15;
  }
}

let cached: StandardMaterial | null = null;

export function targetMaterial(scene: Scene): StandardMaterial {
  if (cached) return cached;
  const tex = new DynamicTexture('targetTex', { width: 256, height: 256 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, 256, 256);
  const rings = ['#d23a32', '#f4efe2', '#d23a32', '#f4efe2', '#ffd21f'];
  rings.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(128, 128, 120 - i * 24, 0, Math.PI * 2);
    ctx.fill();
  });
  tex.update();
  const m = new StandardMaterial('targetMat', scene);
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  m.emissiveColor = new Color3(0.15, 0.15, 0.15);
  cached = m;
  return m;
}
