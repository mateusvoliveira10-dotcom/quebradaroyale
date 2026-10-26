import { Color3, DynamicTexture, Material, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { WatchId } from '../appearance/Appearance';
import { studioMaterial } from './GlassesMaterial';

/**
 * Relógio de pulso feito no jogo: caixa de aço (ou ouro), luneta colorida, mostrador com
 * índices, ponteiros e reflexo, e pulseira de elos dando a volta no punho. Fica no espaço
 * do antebraço (WristMount: eixo Y ao longo do braço, punho em y ≈ -0,2; o lado de fora
 * do punho é -Z).
 */
const STYLE: Record<WatchId, { dial: string; bezel: string; gold: boolean }> = {
  relogio: { dial: '#11845a', bezel: '#0d5c3f', gold: false },
  relogio_azul: { dial: '#1f4fc4', bezel: '#173a8c', gold: false },
  relogio_preto: { dial: '#15171b', bezel: '#0c0d10', gold: false },
  relogio_vermelho: { dial: '#b8202a', bezel: '#7d1219', gold: false },
  relogio_dourado: { dial: '#d8b45a', bezel: '#c49125', gold: true },
};

const dialCache = new Map<string, StandardMaterial>();

function dialMaterial(scene: Scene, hex: string, gold: boolean): StandardMaterial {
  const key = `${scene.uid}|${hex}|${gold}`;
  const hit = dialCache.get(key);
  if (hit) return hit;
  const S = 256;
  const tex = new DynamicTexture(`mostrador_${hex}`, { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const c = S / 2;
  const base = Color3.FromHexString(hex);
  // Raios de sol (sunburst) do centro para fora.
  const g = ctx.createRadialGradient(c * 0.8, c * 0.7, 4, c, c, c);
  g.addColorStop(0, Color3.Lerp(base, Color3.White(), 0.35).toHexString());
  g.addColorStop(0.6, hex);
  g.addColorStop(1, base.scale(0.55).toHexString());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
    ctx.stroke();
  }
  // Índices das horas (12 maior), em metal.
  const metal = gold ? '#fff1c4' : '#f4f6f8';
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const big = h % 3 === 0;
    ctx.save();
    ctx.translate(c + Math.cos(a) * c * 0.78, c + Math.sin(a) * c * 0.78);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = metal;
    ctx.fillRect(big ? -7 : -4, -16, big ? 14 : 8, big ? 32 : 22);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(big ? 5 : 3, -16, 2, big ? 32 : 22);
    ctx.restore();
  }
  // Ponteiros (10:10) e ponteiro de segundos.
  const hand = (ang: number, len: number, w: number, col: string) => {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 10);
    ctx.lineTo(-w / 2, -len + w);
    ctx.lineTo(0, -len);
    ctx.lineTo(w / 2, -len + w);
    ctx.lineTo(w / 2, 10);
    ctx.fill();
    ctx.restore();
  };
  hand((-60 / 180) * Math.PI, c * 0.5, 12, metal);
  hand((60 / 180) * Math.PI, c * 0.7, 9, metal);
  hand((160 / 180) * Math.PI, c * 0.78, 3, gold ? '#8a5a10' : '#ff3b30');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(c, c, 8, 0, Math.PI * 2);
  ctx.fill();
  // Reflexo do vidro.
  const r = ctx.createLinearGradient(0, 0, S, S);
  r.addColorStop(0, 'rgba(255,255,255,0.28)');
  r.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  const m = new StandardMaterial(`mostrador_${hex}`, scene);
  m.diffuseTexture = tex;
  m.emissiveColor = new Color3(0.25, 0.25, 0.25);
  m.specularColor = new Color3(0.9, 0.9, 0.9);
  m.specularPower = 120;
  dialCache.set(key, m);
  return m;
}

/** Monta o relógio no punho; devolve as malhas (para o grupo de acessórios do personagem). */
export function buildWatch(scene: Scene, wrist: TransformNode, id: WatchId): Mesh[] {
  const st = STYLE[id];
  const metal = st.gold ? studioMaterial(scene, 'relogio_ouro', '#ffbf3a', 1, 0.2, 1.25) : studioMaterial(scene, 'relogio_aco', '#d6dbe0', 1, 0.22, 1.2);
  const bezelMat = studioMaterial(scene, `relogio_luneta_${st.bezel}`, st.bezel, 0.6, 0.25, 1.1);
  const root = new Mesh(`relogio_${id}`, scene);
  root.parent = wrist;
  root.position.set(0, -0.205, 0);
  // Mostrador para fora do punho (lado de fora do braço esquerdo).
  root.rotation.y = Math.PI / 2;
  const out: Mesh[] = [root];
  const add = (m: Mesh, mat: Material) => {
    m.material = mat;
    m.parent = root;
    m.isPickable = false;
    m.receiveShadows = true;
    out.push(m);
    return m;
  };
  // Pulseira de elos: anéis finos lado a lado em volta do punho (mais grossa embaixo da caixa).
  const R = 0.051;
  const links = 26;
  const pieces: Mesh[] = [];
  for (let i = 0; i < links; i++) {
    const a = (i / links) * Math.PI * 2;
    const b = MeshBuilder.CreateBox('elo', { width: 0.011, height: 0.02, depth: 0.006 }, scene);
    b.position.set(Math.sin(a) * R, 0, -Math.cos(a) * R);
    b.rotation.y = -a;
    pieces.push(b);
  }
  const band = Mesh.MergeMeshes(pieces, true, true);
  if (band) add(band, metal);
  // Caixa: cilindro deitado com a face para fora do punho (-Z), alças e coroa.
  const z = -(R + 0.009);
  const box = add(MeshBuilder.CreateCylinder('caixa', { diameter: 0.042, height: 0.011, tessellation: 28 }, scene), metal);
  box.rotation.x = Math.PI / 2;
  box.position.z = z;
  const bezel = add(MeshBuilder.CreateTorus('luneta', { diameter: 0.037, thickness: 0.0055, tessellation: 28 }, scene), bezelMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = z - 0.0068;
  const dial = add(MeshBuilder.CreateDisc('mostrador', { radius: 0.0165, tessellation: 28 }, scene), dialMaterial(scene, st.dial, st.gold));
  dial.position.z = z - 0.0078;
  dial.rotation.z = Math.PI;
  for (const s of [-1, 1]) {
    const lug = add(MeshBuilder.CreateBox('alca', { width: 0.014, height: 0.008, depth: 0.005 }, scene), metal);
    lug.position.set(0, s * 0.0215, z + 0.001);
  }
  const crown = add(MeshBuilder.CreateCylinder('coroa', { diameter: 0.006, height: 0.006, tessellation: 10 }, scene), metal);
  crown.rotation.z = Math.PI / 2;
  crown.position.set(0.024, 0, z);
  return out;
}
