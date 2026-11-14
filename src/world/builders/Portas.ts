import { Material, Mesh, MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import { instanceOf } from '../ModelInstance';
import { registerDoor } from '../Doors';
import { WorldBuilder } from '../WorldBuilder';

/**
 * Portas que abrem (contrato em `world/Doors.ts`): o batente fica no lote estático; a folha é
 * uma instância (todas as folhas do mesmo material saem numa chamada de desenho só) presa a
 * um pivô na dobradiça, com um colisor invisível também filho do pivô. O pivô NÃO entra em
 * `WorldBuilder.colliders` (o índice estático): a jogabilidade gira o pivô e o colisor
 * acompanha. Rotação 0 = fechada; `openAngle` com sinal diz para que lado abre.
 */
export interface DoorSpec {
  /** Centro do vão no plano da parede (x, z) e piso (y). */
  x: number;
  y: number;
  z: number;
  /** Eixo da parede: 'x' = a parede corre em x (a porta olha para ±z). */
  axis: 'x' | 'z';
  /** Largura do vão (m) e altura (m). */
  width: number;
  height?: number;
  /** Lado da dobradiça ao longo do eixo da parede (-1 = na ponta menor). */
  hinge?: 1 | -1;
  /** Para que lado a folha abre (sinal no eixo perpendicular à parede). */
  swing?: 1 | -1;
  leaf: Material;
  frame?: Material;
  /** Porta dupla (duas folhas, uma em cada dobradiça). */
  double?: boolean;
  /** Espessura da parede (o batente preenche o vão). */
  wallT?: number;
}

let leafSeq = 0;

/** Folha de porta: caixa 1 × 1 × 0,045 na origem (escalada por instância). */
function leafSource(b: WorldBuilder): () => Mesh {
  return () => {
    const m = MeshBuilder.CreateBox('portaFolha', { width: 1, height: 1, depth: 0.045 }, b.scene);
    m.setEnabled(true);
    return m;
  };
}

/** Porta no vão; devolve os pivôs criados (um, ou dois na porta dupla). */
export function makeDoor(b: WorldBuilder, s: DoorSpec): TransformNode[] {
  const m = b.mats;
  const h = s.height ?? 2.1;
  const t = s.wallT ?? 0.12;
  const frame = s.frame ?? m.hq.madeiraEscura;
  const hinge = s.hinge ?? -1;
  const swing = s.swing ?? 1;
  // Batente (estático): ombreiras e verga, um pouco mais fundas que a parede.
  const along = (u: number) => (s.axis === 'x' ? { x: s.x + u, z: s.z } : { x: s.x, z: s.z + u });
  const jamb = (u: number) => {
    const p = along(u);
    if (s.axis === 'x') b.box({ w: 0.08, h, d: t + 0.04, x: p.x, z: p.z, y: s.y, mat: frame });
    else b.box({ w: t + 0.04, h, d: 0.08, x: p.x, z: p.z, y: s.y, mat: frame });
  };
  jamb(-s.width / 2 - 0.04);
  jamb(s.width / 2 + 0.04);
  if (s.axis === 'x') b.box({ w: s.width + 0.16, h: 0.08, d: t + 0.04, x: s.x, z: s.z, y: s.y + h, mat: frame });
  else b.box({ w: t + 0.04, h: 0.08, d: s.width + 0.16, x: s.x, z: s.z, y: s.y + h, mat: frame });

  const leaves = s.double ? 2 : 1;
  const leafW = s.width / leaves - 0.01;
  const out: TransformNode[] = [];
  for (let i = 0; i < leaves; i++) {
    const side = (s.double ? (i === 0 ? -1 : 1) : hinge) as 1 | -1;
    const hp = along(side * (s.width / 2));
    const pivot = new TransformNode(`porta_${leafSeq++}`, b.scene);
    pivot.position.set(hp.x, s.y, hp.z);
    // Eixo local +x do pivô corre ao longo da parede no sentido da folha (da dobradiça
    // para o meio do vão); a parede em z gira o pivô 90°.
    const dir = -side;
    pivot.rotation.y = s.axis === 'x' ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    const leaf = instanceOf('portaFolha', leafSource(b), s.leaf, pivot);
    leaf.scaling.set(leafW, h - 0.02, 1);
    leaf.position.set(leafW / 2, (h - 0.02) / 2 + 0.01, 0);
    // Maçaneta (instância pequena de metal).
    const knob = instanceOf('portaMacaneta', () => MeshBuilder.CreateBox('macaneta', { width: 0.12, height: 0.03, depth: 0.1 }, b.scene), m.metal, pivot);
    knob.position.set(leafW - 0.1, 1.02, 0.05);
    const col = MeshBuilder.CreateBox(`portaCol_${leafSeq}`, { width: leafW, height: h, depth: 0.1 }, b.scene);
    col.parent = pivot;
    col.position.set(leafW / 2, h / 2, 0);
    col.isVisible = false;
    col.isPickable = false;
    col.checkCollisions = true;
    // Sentido de abertura: para o lado `swing` (perpendicular à parede). Com o pivô virado
    // para um lado ou outro, o sinal do ângulo troca.
    const perp = s.axis === 'x' ? swing : swing;
    const openAngle = (dir > 0 ? -1 : 1) * perp * (Math.PI / 2) * (s.axis === 'x' ? 1 : -1);
    const c = along(side * (s.width / 2) + dir * (leafW / 2));
    registerDoor({ pivot, collider: col, center: new Vector3(c.x, s.y + h / 2, c.z), width: leafW, openAngle });
    out.push(pivot);
  }
  return out;
}

/** Vão sem folha (arco/passagem): só o acabamento. */
export function makeArch(b: WorldBuilder, s: Omit<DoorSpec, 'leaf'>): void {
  const frame = s.frame ?? b.mats.hq.branco;
  const h = s.height ?? 2.2;
  const t = s.wallT ?? 0.12;
  const along = (u: number) => (s.axis === 'x' ? { x: s.x + u, z: s.z } : { x: s.x, z: s.z + u });
  for (const u of [-s.width / 2 - 0.03, s.width / 2 + 0.03]) {
    const p = along(u);
    if (s.axis === 'x') b.box({ w: 0.06, h, d: t + 0.02, x: p.x, z: p.z, y: s.y, mat: frame });
    else b.box({ w: t + 0.02, h, d: 0.06, x: p.x, z: p.z, y: s.y, mat: frame });
  }
}
