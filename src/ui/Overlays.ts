const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface EndInfo {
  win: boolean;
  title: string;
  subtitle: string;
  stats: Array<[string, string]>;
}

export interface Choice<T extends string> {
  id: T;
  name: string;
  desc: string;
  /** Foto (data URL), ex.: a arma renderizada pelo jogo. */
  img?: string;
}

/** Telas sobrepostas ao jogo. Cada uma recebe callbacks reais de ação. */
export class Overlays {
  onClick: (() => void) | null = null;
  private pauseHandlers: { continue: () => void; restart: (() => void) | null; lobby: () => void; difficulty: (() => void) | null } | null = null;
  private endHandlers: { again: () => void; lobby: () => void } | null = null;
  private loadoutHandlers: { go: (id: string) => void; back: () => void } | null = null;
  private trainingHandlers: { go: (id: string) => void; back: () => void } | null = null;
  private loadoutChoice = '';
  private trainingChoice = '';

  constructor() {
    const click = (id: string, fn: () => void) =>
      el(id).addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick?.();
        fn();
      });
    click('pause-continue', () => this.pauseHandlers?.continue());
    click('pause-restart', () => this.pauseHandlers?.restart?.());
    click('pause-difficulty', () => this.pauseHandlers?.difficulty?.());
    click('pause-lobby', () => this.pauseHandlers?.lobby());
    click('end-again', () => this.endHandlers?.again());
    click('end-lobby', () => this.endHandlers?.lobby());
    click('loadout-go', () => this.loadoutHandlers?.go(this.loadoutChoice));
    click('loadout-back', () => this.loadoutHandlers?.back());
    click('training-go', () => this.trainingHandlers?.go(this.trainingChoice));
    click('training-back', () => this.trainingHandlers?.back());
  }

  /** Esconde todas as telas de menu de partida. */
  hideAll(): void {
    for (const id of ['pause', 'endscreen', 'loadout-pick', 'training-setup', 'click-to-play']) el(id).classList.add('hidden');
  }

  get blocking(): boolean {
    return ['pause', 'endscreen', 'loadout-pick', 'training-setup'].some((id) => !el(id).classList.contains('hidden'));
  }

  loading(text: string | null): void {
    el('loading').classList.toggle('hidden', text === null);
    if (text) el('loading-text').textContent = text;
  }

  clickToPlay(on: boolean, onClick?: () => void): void {
    const o = el('click-to-play');
    o.classList.toggle('hidden', !on);
    o.onclick = on && onClick ? () => onClick() : null;
  }

  showPause(handlers: { continue: () => void; restart: (() => void) | null; lobby: () => void; difficulty: (() => void) | null }): void {
    this.pauseHandlers = handlers;
    el('pause-restart').classList.toggle('hidden', !handlers.restart);
    el('pause-difficulty').classList.toggle('hidden', !handlers.difficulty);
    el('pause').classList.remove('hidden');
  }

  hidePause(): void {
    el('pause').classList.add('hidden');
  }

  get paused(): boolean {
    return !el('pause').classList.contains('hidden');
  }

  showEnd(info: EndInfo, again: () => void, lobby: () => void): void {
    this.endHandlers = { again, lobby };
    const end = el('endscreen');
    end.classList.toggle('win', info.win);
    end.classList.toggle('lose', !info.win);
    el('end-title').textContent = info.title;
    el('end-sub').textContent = info.subtitle;
    el('end-stats').innerHTML = info.stats.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    end.classList.remove('hidden');
  }

  private renderChoices<T extends string>(boxId: string, choices: Choice<T>[], selected: string, pick: (id: T) => void): void {
    const box = el(boxId);
    box.className = 'choice-grid';
    box.innerHTML = '';
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice' + (c.id === selected ? ' selected' : '');
      b.innerHTML = `${c.img ? `<img src="${c.img}" alt="" style="display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin-bottom:8px;background:#1b2230">` : ''}<b>${c.name}</b><span>${c.desc}</span>`;
      b.addEventListener('click', () => {
        this.onClick?.();
        pick(c.id);
        this.renderChoices(boxId, choices, c.id, pick);
      });
      box.appendChild(b);
    }
  }

  pickLoadout<T extends string>(choices: Choice<T>[], initial: T, go: (id: T) => void, back: () => void): void {
    this.loadoutChoice = initial;
    this.loadoutHandlers = { go: (id) => go(id as T), back };
    this.renderChoices('loadout-options', choices, initial, (id) => (this.loadoutChoice = id));
    el('loadout-pick').classList.remove('hidden');
  }

  hideLoadout(): void {
    el('loadout-pick').classList.add('hidden');
  }

  trainingSetup<T extends string>(choices: Choice<T>[], initial: T, resultHtml: string | null, go: (id: T) => void, back: () => void): void {
    this.trainingChoice = initial;
    this.trainingHandlers = { go: (id) => go(id as T), back };
    this.renderChoices('difficulty-options', choices, initial, (id) => (this.trainingChoice = id));
    const r = el('training-result');
    r.classList.toggle('hidden', !resultHtml);
    r.innerHTML = resultHtml ?? '';
    el('training-setup').classList.remove('hidden');
  }

  hideTraining(): void {
    el('training-setup').classList.add('hidden');
  }
}
