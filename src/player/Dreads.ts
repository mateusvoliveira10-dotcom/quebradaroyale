import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import type { HairId } from '../appearance/Appearance';
import { Rng } from '../utils/random';

/**
 * Dreads feitos no próprio jogo: cada mecha nasce no couro cabeludo de verdade do personagem
 * (a malha de cabelo curto do hair.py, moldada na cabeça), sai um pouco para fora e cai com a
 * gravidade em volta do rosto, sem atravessar a cabeça nem cobrir a cara. Textura de corda
 * torcida (fios enrolados) na cor escolhida.
 */
export const DREAD_COLORS: Partial<Record<HairId, string>> = {
  dread_preto: '#1d1510',
  dread_castanho: '#5c3a1f',
  dread_loiro: '#c9a061',
};

const texCache = new Map<string, DynamicTexture>();

/** Textura de dread: listras diagonais (torção), fios claros e escuros e pontinhos de frizz. */
function ropeTexture(scene: Scene, hex: string): DynamicTexture {
  const key = `${hex}_${scene.uid}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const W = 128;
  const H = 256;
  const tex = new DynamicTexture(`dread_${hex}`, { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const base = Color3.FromHexString(hex);
  const css = (c: Color3, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, W, H);
  const rng = new Rng(hex.length * 31 + hex.charCodeAt(2));
  // Torção: faixas inclinadas alternando claro/escuro, repetidas em volta da mecha.
  for (let i = -H; i < H * 2; i += 18) {
    ctx.strokeStyle = css(base.scale(0.55), 0.55);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(W, i + W * 0.9);
    ctx.stroke();
    ctx.strokeStyle = css(Color3.Lerp(base, Color3.White(), 0.25), 0.35);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, i + 8);
    ctx.lineTo(W, i + 8 + W * 0.9);
    ctx.stroke();
  }
  // Fios soltos e frizz.
  for (let i = 0; i < 900; i++) {
    const light = rng.chance(0.5);
    ctx.fillStyle = light ? css(Color3.Lerp(base, Color3.White(), 0.35), 0.35) : css(base.scale(0.4), 0.4);
    ctx.fillRect(rng.range(0, W), rng.range(0, H), 1, rng.range(2, 6));
  }
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  texCache.set(key, tex);
  return tex;
}

// Sem clonar a textura: clone de DynamicTexture nunca fica pronto no Babylon.
export function dreadMaterial(scene: Scene, hex: string): StandardMaterial {
  const m = new StandardMaterial(`dreadMat_${hex}`, scene);
  m.diffuseTexture = ropeTexture(scene, hex);
  m.specularColor = new Color3(0.08, 0.07, 0.06);
  m.specularPower = 12;
  m.emissiveColor = Color3.FromHexString(hex).scale(0.12);
  return m;
}

/**
 * Mechas presas em `mount` (nó da cabeça), a partir dos vértices do couro cabeludo `scalp`
 * (malha com skinning, já criada no personagem). Devolve uma malha só (mechas juntas).
 */
export function buildDreadStrands(scene: Scene, scalp: Mesh, mount: TransformNode, hex: string): Mesh | null {
  scalp.computeWorldMatrix(true);
  mount.computeWorldMatrix(true);
  const raw = scalp.getPositionData(true);
  if (!raw || raw.length < 30) return null;
  const toLocal = scalp.getWorldMatrix().multiply(Matrix.Invert(mount.getWorldMatrix()));
  const verts: Vector3[] = [];
  for (let i = 0; i < raw.length; i += 3) verts.push(Vector3.TransformCoordinates(new Vector3(raw[i], raw[i + 1], raw[i + 2]), toLocal));
  const min = verts.reduce((a, v) => Vector3.Minimize(a, v), verts[0].clone());
  const max = verts.reduce((a, v) => Vector3.Maximize(a, v), verts[0].clone());
  // Cabeça como uma esfera: raio pela largura da calota, centro abaixo do topo.
  const R = (max.x - min.x) / 2;
  const center = new Vector3((min.x + max.x) / 2, max.y - R * 1.05, (min.z + max.z) / 2);
  const rng = new Rng(7177);

  // Raízes espalhadas pela calota (distância mínima entre elas).
  const order = verts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const roots: Vector3[] = [];
  const minGap = R * 0.2;
  for (const i of order) {
    const v = verts[i];
    if (roots.every((r) => Vector3.DistanceSquared(r, v) > minGap * minGap)) roots.push(v);
    if (roots.length >= 120) break;
  }

  const N = 10;
  const tubes: Mesh[] = [];
  for (const root of roots) {
    const n = root.subtract(center).normalize();
    // Para onde a mecha cai: para os lados e para trás; as da frente penteadas para trás
    // e para os lados, deixando o rosto livre.
    const front = n.z > 0.25;
    const h = new Vector3(n.x, 0, front ? n.z - 1.3 : n.z);
    if (h.lengthSquared() < 1e-4) h.set(0, 0, -1);
    h.normalize();
    if (front) h.x += Math.sign(n.x || (rng.chance(0.5) ? 1 : -1)) * 0.7;
    h.normalize();
    const len = R * rng.range(2.1, 3.0) * (n.z < -0.3 ? 1.15 : 1);
    const path: Vector3[] = [];
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      const p = root
        .add(n.scale(R * 0.12 * Math.min(1, t * 4)))
        .add(h.scale(R * (0.25 + 0.2 * t) * Math.min(1, t * 2.5)))
        .add(new Vector3(rng.range(-0.02, 0.02) * R, -len * Math.pow(t, 1.25), rng.range(-0.02, 0.02) * R));
      // Não entra na cabeça…
      const d = p.subtract(center);
      const minR = R * 1.1;
      if (d.y > -R * 1.1 && d.length() < minR) p.copyFrom(center.add(d.normalize().scale(minR)));
      // …nem passa na frente do rosto.
      if (p.z - center.z > R * 0.25 && p.y < center.y + R * 0.45) {
        const sx = Math.sign(p.x - center.x || n.x || 1);
        p.x = center.x + sx * Math.max(Math.abs(p.x - center.x), R * 1.08);
        p.z = Math.min(p.z, center.z + R * 0.55);
      }
      path.push(p);
    }
    const r = R * rng.range(0.065, 0.085);
    const tube = MeshBuilder.CreateTube('dread', { path, tessellation: 6, cap: Mesh.CAP_END, radiusFunction: (i) => r * (i === N - 1 ? 0.7 : i === 0 ? 0.85 : 1) }, scene);
    tubes.push(tube);
  }
  const merged = Mesh.MergeMeshes(tubes, true, true);
  if (!merged) return null;
  merged.name = 'dreads';
  merged.parent = mount;
  merged.material = dreadMaterial(scene, hex);
  merged.isPickable = false;
  return merged;
}
