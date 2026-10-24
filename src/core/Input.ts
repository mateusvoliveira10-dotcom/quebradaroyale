/**
 * Teclado + mouse com Pointer Lock. Os deltas e "pressed" são zerados a cada frame em endFrame().
 *
 * Captura do mouse:
 *  - só é pedida dentro de um clique do jogador (JOGAR, CONTINUAR, "clique para jogar");
 *  - usa `unadjustedMovement` (movimento cru, sem aceleração do sistema) quando o navegador suporta;
 *  - se o navegador recusar (ex.: clique logo após o Esc, que o Chrome bloqueia por ~1 s), o jogo
 *    fica parado com "CLIQUE PARA JOGAR" e o próximo clique tenta de novo — o cursor nunca fica
 *    visível com o jogo rodando.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;
  /**
   * Mouse livre: último recurso para ambientes onde o pointer lock nunca funciona (painel
   * embutido de apps, alguns iframes). Só liga se a captura nunca deu certo nesta sessão e
   * foi recusada duas vezes. Num navegador normal, depois da primeira captura, nunca liga.
   */
  fallback = false;
  private everLocked = false;
  private lockFailures = 0;
  /** Descarta os primeiros movimentos após capturar (o navegador costuma mandar um pico). */
  private skipMoves = 0;
  /** Definido pelo Game a cada frame: a partida está aceitando comandos (fora de menus/pausa). */
  active = false;
  /** Chamado quando o pointer lock falha e o modo mouse livre é ativado. */
  onFallback: (() => void) | null = null;
  /** Chamado ao apertar Esc no modo mouse livre (equivale a perder a captura). */
  onEscape: (() => void) | null = null;
  /** Botões do mouse: 0 = esquerdo, 2 = direito. */
  private readonly mouseDown = new Set<number>();
  private readonly mousePressed = new Set<number>();
  /** Chamado no primeiro gesto do usuário (necessário para liberar o áudio). */
  onFirstGesture: (() => void) | null = null;
  /** Chamado quando o pointer lock é perdido (Esc, alt-tab...). */
  onUnlock: (() => void) | null = null;
  /** Quando false, cliques no canvas não capturam o mouse (menus). */
  captureOnClick = false;
  private lastLockAttempt = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'F3') e.preventDefault();
      if (e.code === 'Escape' && !this.pointerLocked && this.fallback && this.active) this.onEscape?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const lost = this.pointerLocked && !locked;
      this.pointerLocked = locked;
      if (locked) {
        this.everLocked = true;
        this.lockFailures = 0;
        this.fallback = false;
        this.skipMoves = 2;
        this.mouseDX = this.mouseDY = 0;
      } else {
        this.releaseAll();
      }
      if (lost) this.onUnlock?.();
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    document.addEventListener('mousemove', (e) => {
      if (!this.captured) return;
      if (this.skipMoves > 0) {
        this.skipMoves--;
        return;
      }
      // Alguns navegadores geram picos absurdos ao (re)capturar o mouse: descarta.
      if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    // Eventos de ponteiro em vez de mousedown/mouseup: o Babylon cancela o pointerdown do canvas,
    // e aí o navegador não gera os mousedown de compatibilidade. Os botões vêm de e.buttons
    // porque um segundo botão apertado junto (mirar + atirar) chega só como pointermove.
    document.addEventListener('pointerdown', (e) => {
      this.gesture();
      this.syncButtons(e);
    });
    document.addEventListener('pointermove', (e) => this.syncButtons(e));
    document.addEventListener('pointerup', (e) => this.syncButtons(e));
    document.addEventListener('contextmenu', (e) => {
      if (this.captured) e.preventDefault();
    });
    canvas.addEventListener('click', () => {
      if (this.captureOnClick) this.lockPointer();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** O jogador está no controle: mouse capturado, ou mouse livre durante a partida. */
  get captured(): boolean {
    return this.pointerLocked || (this.fallback && this.active);
  }

  private syncButtons(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    // No modo mouse livre só valem cliques no próprio jogo (não em botões da interface).
    const allowed = this.captured && (this.pointerLocked || e.target === this.canvas);
    for (const [button, bit] of [
      [0, 1],
      [2, 2],
    ] as const) {
      const isDown = allowed && (e.buttons & bit) !== 0;
      if (isDown && !this.mouseDown.has(button)) this.mousePressed.add(button);
      if (isDown) this.mouseDown.add(button);
      else this.mouseDown.delete(button);
    }
  }

  private gesture(): void {
    if (this.onFirstGesture) {
      const cb = this.onFirstGesture;
      this.onFirstGesture = null;
      cb();
    }
  }

  private releaseAll(): void {
    this.down.clear();
    this.mouseDown.clear();
  }

  private lockFailed(): void {
    if (this.pointerLocked) return;
    this.lockFailures++;
    if (!this.everLocked && this.lockFailures >= 2 && !this.fallback) {
      this.fallback = true;
      this.onFallback?.();
    }
  }

  /** Pede a captura do mouse. Precisa ser chamado dentro de um clique/tecla do jogador. */
  lockPointer(): void {
    this.gesture();
    if (this.pointerLocked) return;
    const now = performance.now();
    if (now - this.lastLockAttempt < 200) return;
    this.lastLockAttempt = now;
    const request = (opts?: object): Promise<void> | void =>
      (this.canvas.requestPointerLock as (o?: object) => Promise<void> | void).call(this.canvas, opts);
    try {
      // Movimento cru (sem aceleração do Windows): mira consistente e sem saltos.
      const r = request({ unadjustedMovement: true });
      if (r instanceof Promise) {
        r.catch((err: DOMException) => {
          // Navegador sem suporte à opção: tenta a captura comum, ainda dentro do gesto.
          if (err?.name === 'NotSupportedError') {
            const r2 = request();
            if (r2 instanceof Promise) r2.catch(() => undefined);
          }
        });
      }
    } catch {
      try {
        request();
      } catch {
        // O próximo clique tenta de novo.
      }
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseDown.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
