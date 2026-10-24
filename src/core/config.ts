/** Parâmetros de jogabilidade centralizados para facilitar o ajuste fino. */

export const PLAYER = {
  /** Raio horizontal do elipsoide de colisão (m). */
  radius: 0.4,
  /** Altura total do personagem em pé e agachado (m). */
  height: 1.8,
  crouchHeight: 1.2,
  /**
   * Velocidade padrão (sem Shift): uma corrida leve, como nos battle royales atuais. Igual
   * com qualquer arma (ou sem arma), mirando ou atirando: só o sprint é que para ao mirar.
   */
  walkSpeed: 6.2,
  /** Sprint (Shift). */
  runSpeed: 8.6,
  crouchSpeed: 3.0,
  /** Deslizar: agachar durante o sprint. Velocidade inicial, duração e velocidade mínima. */
  slideSpeed: 10.5,
  slideTime: 0.85,
  /** Aceleração horizontal no chão e no ar (m/s²). */
  groundAccel: 38,
  groundDecel: 30,
  airAccel: 10,
  /** Velocidade inicial do pulo: altura ≈ v² / 2g ≈ 1,3 m. */
  jumpVelocity: 8.4,
  gravity: 26,
  /** Gravidade extra ao cair, para o pulo ficar menos "flutuante". */
  fallGravityMultiplier: 1.35,
  maxFallSpeed: 40,
  /** Tempo de tolerância para pular logo após sair de uma beirada. */
  coyoteTime: 0.12,
  /** Tempo em que um pulo apertado antes de tocar o chão ainda vale. */
  jumpBuffer: 0.14,
  /** Velocidade de giro do modelo em direção ao movimento. */
  turnSharpness: 12,
  /** Abaixo dessa altura o jogador volta ao último chão seguro. */
  killY: -30,
};

export const TRAVERSAL = {
  /** Altura mínima/máxima (acima dos pés) de uma borda que pode ser escalada. */
  minLedge: 0.45,
  maxLedgeGrounded: 2.25,
  maxLedgeAirborne: 1.95,
  /** Obstáculos finos até essa altura são pulados por cima (vault). */
  maxVaultHeight: 1.35,
  /** Distância máxima até a parede para iniciar a escalada. */
  reach: 0.75,
};

export const CAMERA = {
  distance: 3.9,
  minDistance: 2.2,
  maxDistance: 9,
  aimDistance: 2.4,
  /** Deslocamento lateral "por cima do ombro". */
  shoulderOffset: 0.75,
  aimShoulderOffset: 0.8,
  /** Altura do ponto mirado acima dos pés do personagem. */
  targetHeight: 1.55,
  crouchTargetHeight: 1.1,
  sensitivity: 0.0024,
  minBeta: 0.3,
  maxBeta: 1.75,
  followSharpness: 16,
  fov: 0.92,
  aimFov: 0.7,
  sprintFovBoost: 0.07,
};

export const DROP = {
  planeAltitude: 125,
  planeSpeed: 38,
  /** Distância do centro onde o avião nasce/some. */
  planeStartDistance: 250,
  freefallTerminal: 32,
  freefallDiveTerminal: 48,
  freefallSteer: 14,
  /** Altura acima do chão em que o paraquedas abre sozinho. */
  autoOpenHeight: 32,
  /** Altura máxima acima do chão para abrir manualmente. */
  manualOpenHeight: 95,
  parachuteFallSpeed: 5.5,
  parachuteSteer: 7.5,
};

export const WORLD = {
  seed: 20251016,
  /** Altura de um pavimento (m). */
  floorHeight: 3,
  /** Metade do tamanho do mapa jogável (m): 300 × 300 m. */
  half: 150,
  /** Metade da comunidade murada no centro do mapa (o mapa original, 148 × 148 m). */
  community: 74,
};
