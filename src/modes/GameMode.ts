import { KillEvent } from '../combat/CombatManager';

export type ModeKind = 'lobby' | 'br' | 'dm' | 'training';

/** Contrato de um modo de jogo (lobby, Battle Royale, Deathmatch, Treinamento). */
export interface GameMode {
  readonly kind: ModeKind;
  enter(): void;
  exit(): void;
  update(dt: number): void;
  /** Reiniciar pelo menu de pausa (null = não suportado). */
  restart: (() => void) | null;
  /** Mudar dificuldade pelo menu de pausa (só treino). */
  changeDifficulty: (() => void) | null;
  onKill?(e: KillEvent): void;
  /** Ponto que a câmera/sombras devem acompanhar. */
  focus(): import('@babylonjs/core').Vector3;
}
