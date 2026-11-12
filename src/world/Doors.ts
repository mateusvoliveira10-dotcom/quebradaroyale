import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';

/**
 * Registro das portas que abrem (contrato entre o mapa e a jogabilidade).
 *
 * O mapa cria cada porta como peça dinâmica (fora do lote estático): um `pivot` na dobradiça
 * com a folha da porta como filha, e um colisor invisível do tamanho da folha, também filho do
 * pivot (o colisor acompanha a porta ao girar). A jogabilidade (tecla E, bots, som) gira o
 * pivot entre 0 e `openAngle`.
 */
export interface Door {
  /** Dobradiça: gira em y. Rotação 0 = fechada. */
  pivot: TransformNode;
  /** Colisor da folha (filho do pivot; checkCollisions = true). */
  collider: Mesh;
  /** Centro do vão (mundo), para distância de interação. */
  center: Vector3;
  /** Largura do vão (m). */
  width: number;
  /** Ângulo aberto (rad, com sinal: para que lado abre). */
  openAngle: number;
  /** Estado atual (0 = fechada, 1 = aberta) — controlado pela jogabilidade. */
  open: number;
  /** Alvo (0 ou 1). */
  target: number;
}

const doors: Door[] = [];

export function registerDoor(d: Omit<Door, 'open' | 'target'>): Door {
  const door: Door = { ...d, open: 0, target: 0 };
  doors.push(door);
  return door;
}

export function allDoors(): readonly Door[] {
  return doors;
}

export function clearDoors(): void {
  doors.length = 0;
}

/** Porta mais próxima de `p` dentro de `maxDist` (m), ou null. */
export function nearestDoor(p: Vector3, maxDist: number): Door | null {
  let best: Door | null = null;
  let bd = maxDist * maxDist;
  for (const d of doors) {
    const dx = d.center.x - p.x;
    const dy = d.center.y - p.y;
    const dz = d.center.z - p.z;
    const d2 = dx * dx + dz * dz + dy * dy * 0.25;
    if (d2 < bd) {
      bd = d2;
      best = d;
    }
  }
  return best;
}
