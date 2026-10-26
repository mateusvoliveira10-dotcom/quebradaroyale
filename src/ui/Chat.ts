/**
 * Chat do jogo: canal GLOBAL e mensagem PRIVADA para uma pessoa.
 *
 *  - Enter abre a caixa de texto; Enter envia; Esc fecha sem enviar.
 *  - `/m Nome mensagem` (ou /msg, /p) manda no privado; `/r mensagem` responde o último
 *    privado recebido. Tab alterna entre GLOBAL e o último privado.
 *
 * O envio passa por um ChatTransport. Hoje o padrão é o BroadcastChannel do navegador (as
 * abas abertas no mesmo computador conversam entre si, bom para testar); quando o jogo tiver
 * servidor online basta trocar por um transporte de WebSocket com a mesma interface.
 */

export interface ChatMessage {
  /** 'global' ou 'privado'. */
  channel: 'global' | 'privado';
  from: string;
  /** Destinatário (só no privado). */
  to?: string;
  text: string;
  time: number;
}

export interface ChatTransport {
  send(msg: ChatMessage): void;
  onMessage: ((msg: ChatMessage) => void) | null;
  /** Nomes de quem está online agora (para avisar se o destinatário do privado não existe). */
  online(): string[];
}

/** Transporte local: abas do mesmo navegador (BroadcastChannel), com presença por "ping". */
export class LocalChatTransport implements ChatTransport {
  onMessage: ((msg: ChatMessage) => void) | null = null;
  private readonly ch: BroadcastChannel | null;
  private readonly peers = new Map<string, number>();

  constructor(private readonly me: () => string) {
    this.ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('quebrada-royale-chat') : null;
    if (this.ch) {
      this.ch.onmessage = (e) => {
        const d = e.data as { kind: 'msg'; msg: ChatMessage } | { kind: 'ping'; name: string };
        if (d.kind === 'ping') this.peers.set(d.name, performance.now());
        else this.onMessage?.(d.msg);
      };
      const ping = () => this.ch!.postMessage({ kind: 'ping', name: this.me() });
      ping();
      setInterval(ping, 4000);
    }
  }

  send(msg: ChatMessage): void {
    this.ch?.postMessage({ kind: 'msg', msg });
  }

  online(): string[] {
    const now = performance.now();
    return [...this.peers].filter(([, t]) => now - t < 10000).map(([n]) => n);
  }
}

const SHOW_TIME = 9000;
const MAX_LINES = 40;

export class Chat {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly field: HTMLInputElement;
  private readonly chip: HTMLSpanElement;
  private target: string | null = null;
  private lastPrivate: string | null = null;
  isOpen = false;
  /** Chamado ao abrir/fechar (o jogo solta as teclas de movimento). */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(
    private readonly myName: () => string,
    private readonly transport: ChatTransport = new LocalChatTransport(myName),
  ) {
    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.box = document.createElement('div');
    this.box.className = 'chat-input hidden';
    this.chip = document.createElement('span');
    this.chip.className = 'chat-chip';
    this.field = document.createElement('input');
    this.field.type = 'text';
    this.field.maxLength = 140;
    this.field.placeholder = 'Mensagem… (/m Nome texto = privado)';
    this.field.autocomplete = 'off';
    this.box.append(this.chip, this.field);
    this.root.append(this.log, this.box);
    document.body.appendChild(this.root);
    this.updateChip();

    // Teclas digitadas não chegam ao jogo (o Input escuta no window).
    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.target = this.target ? null : this.lastPrivate;
        this.updateChip();
      }
    });
    this.field.addEventListener('keyup', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (this.isOpen || !this.enabled) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.open();
      }
    });
    this.transport.onMessage = (m) => this.receive(m);
  }

  /** Só abre durante o jogo (o Game liga/desliga conforme menus e pausa). */
  enabled = false;

  open(): void {
    this.isOpen = true;
    this.root.classList.add('open');
    this.box.classList.remove('hidden');
    this.field.value = '';
    this.field.focus();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.box.classList.add('hidden');
    this.field.blur();
    this.onToggle?.(false);
  }

  /** Mensagem do sistema (entrada na partida, aviso de privado etc.). */
  system(text: string): void {
    this.addLine(`<span class="chat-sys">${esc(text)}</span>`);
  }

  private submit(): void {
    const raw = this.field.value.trim();
    this.close();
    if (!raw) return;
    const me = this.myName();
    const cmd = raw.match(/^\/(m|msg|p|w)\s+(\S+)\s+(.+)$/i);
    const reply = raw.match(/^\/r\s+(.+)$/i);
    let msg: ChatMessage;
    if (cmd || reply || this.target) {
      const to = cmd ? cmd[2] : reply ? this.lastPrivate : this.target;
      const text = cmd ? cmd[3] : reply ? reply[1] : raw;
      if (!to) {
        this.system('Ninguém para responder ainda.');
        return;
      }
      msg = { channel: 'privado', from: me, to, text, time: Date.now() };
      this.target = to;
      this.lastPrivate = to;
      this.updateChip();
      if (!this.transport.online().some((n) => n.toLowerCase() === to.toLowerCase())) {
        this.system(`${to} não está online agora (o privado chega quando estiver conectado).`);
      }
    } else {
      msg = { channel: 'global', from: me, text: raw, time: Date.now() };
    }
    this.transport.send(msg);
    this.show(msg, true);
  }

  private receive(m: ChatMessage): void {
    if (m.channel === 'privado') {
      if (!m.to || m.to.toLowerCase() !== this.myName().toLowerCase()) return;
      this.lastPrivate = m.from;
    }
    this.show(m, false);
  }

  private show(m: ChatMessage, mine: boolean): void {
    if (m.channel === 'global') {
      this.addLine(`<span class="chat-tag g">GLOBAL</span><b class="${mine ? 'me' : ''}">${esc(m.from)}:</b> ${esc(m.text)}`);
    } else {
      const who = mine ? `Para ${esc(m.to ?? '')}` : `De ${esc(m.from)}`;
      this.addLine(`<span class="chat-tag p">PRIVADO</span><b class="pm">${who}:</b> ${esc(m.text)}`);
    }
  }

  private addLine(html: string): void {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = html;
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('old'), SHOW_TIME);
  }

  private updateChip(): void {
    this.chip.textContent = this.target ? `PRIVADO: ${this.target}` : 'GLOBAL';
    this.chip.classList.toggle('p', !!this.target);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
