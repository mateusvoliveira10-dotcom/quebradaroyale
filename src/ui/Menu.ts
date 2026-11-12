import {
  ACCESSORY_OPTIONS,
  AccessoryId,
  Appearance,
  GLASSES_OPTIONS,
  HAIR_OPTIONS,
  JerseyChoice,
  Option,
  toggleAccessory,
} from '../appearance/Appearance';
import { BACKPACKS, HEADPHONES, WATCHES } from '../appearance/Appearance';
import { HAIRS } from '../appearance/Styles';
import { CHAIN_CATALOG, chainById, ChainId, chainThumb } from '../customization/chains';
import { glassesThumb } from '../customization/glasses';
import { Settings } from '../core/Settings';
import { BOTTOM_CATALOG, GarmentDef, garmentFiles, SHOE_CATALOG } from '../customization/garments';
import { COLLAR_LABEL, JERSEY_CATALOG, jerseyById, jerseyFiles } from '../customization/jerseys';
import { modeArt } from './ModeArt';

export type ModeId = 'br' | 'dm' | 'training';
export type LobbyTab = 'play' | 'custom' | 'settings';

interface ModeCard {
  id: ModeId;
  name: string;
  short: string;
  /** Selo do card (formato da partida). */
  tag: string;
  color: string;
  desc: string;
}

const MODES: ModeCard[] = [
  {
    id: 'br',
    name: 'BATTLE ROYALE',
    short: '30 jogadores · último vivo vence',
    tag: 'SOLO',
    color: '#ffd21f',
    desc: 'Salte do avião sobre a comunidade, abra o paraquedas, pegue armas nos becos, lajes e lojas e sobreviva à zona que fecha. 30 participantes: só um sai vivo.',
  },
  {
    id: 'dm',
    name: 'DEATHMATCH 5V5',
    short: 'Azul x Vermelho · 5 minutos',
    tag: 'EQUIPES',
    color: '#3a9cff',
    desc: 'Sua equipe (você + 4 bots) contra 5 bots. Escolha o equipamento, elimine adversários pelas ruas, becos e escadarias. Renascimento com proteção; vence quem fizer mais eliminações em 5 minutos.',
  },
  {
    id: 'training',
    name: 'TREINAMENTO',
    short: 'Galpão da Quebrada · alvos',
    tag: 'PRÁTICA',
    color: '#2bd46b',
    desc: 'Estande de tiro num galpão industrial. Escolha a arma na bancada e a dificuldade (fácil, médio, difícil). Pontuação, cronômetro, tiros, acertos e precisão.',
  },
];

/**
 * Arte de cada modo: cena real do mapa renderizada pelo jogo na abertura (ver Snapshots).
 * Até ela ficar pronta, vale a ilustração vetorial.
 */
const MODE_ART: Partial<Record<ModeId, string>> = {};

/** Conteúdo de um card de modo: ilustração + selo + nome + resumo. */
function tileHtml(m: ModeCard, uid: string): string {
  const art = MODE_ART[m.id] ? `<img src="${MODE_ART[m.id]}" alt="" draggable="false">` : modeArt(m.id, uid);
  return `<div class="media" style="--mc:${m.color}"><div class="art">${art}</div><div class="tile-info"><span class="tag">${m.tag}</span><b>${m.name}</b><span class="sub">${m.short}</span></div></div>`;
}

type Category = 'hair' | 'glasses' | 'cap' | 'phones' | 'jersey' | 'chains' | 'bottom' | 'shoes' | 'watch' | 'bracelet' | 'backpack';

/** Espaços do armário (como nos battle royales): agrupados por parte do corpo. */
const SLOT_GROUPS: Array<{ name: string; slots: Array<{ id: Category; name: string }> }> = [
  { name: 'CABEÇA', slots: [{ id: 'hair', name: 'CABELO' }, { id: 'cap', name: 'BONÉ' }, { id: 'glasses', name: 'ÓCULOS' }, { id: 'phones', name: 'FONE' }] },
  { name: 'CORPO', slots: [{ id: 'jersey', name: 'CAMISA' }, { id: 'chains', name: 'CORRENTE' }, { id: 'bottom', name: 'CALÇA/BERMUDA' }, { id: 'shoes', name: 'TÊNIS' }] },
  { name: 'EXTRAS', slots: [{ id: 'watch', name: 'RELÓGIO' }, { id: 'bracelet', name: 'PULSEIRA' }, { id: 'backpack', name: 'MOCHILA' }] },
];

/** Acessórios de cada espaço (um por vez; pulseiras podem ser as duas). */
const ACC_SLOTS: Partial<Record<Category, { ids: AccessoryId[]; none: string; multi?: boolean }>> = {
  cap: { ids: ['bone_frente', 'bone_aba_reta', 'bone_tras'], none: 'Sem boné' },
  phones: { ids: [...HEADPHONES], none: 'Sem fone' },
  watch: { ids: [...WATCHES], none: 'Sem relógio' },
  bracelet: { ids: ['pulseiras', 'pulseira_ouro'], none: 'Sem pulseira', multi: true },
  backpack: { ids: [...BACKPACKS], none: 'Sem mochila' },
};

/** Cores de cada acessório (amostras no cartão e no espaço). */
const ACC_COLORS: Partial<Record<AccessoryId, string[]>> = {
  bone_tras: ['#e8322b', '#16100c'],
  bone_frente: ['#2457c5', '#16100c'],
  bone_aba_reta: ['#16100c', '#ffd21f'],
  pulseiras: ['#ffc23a', '#16100c', '#1fa64a'],
  pulseira_ouro: ['#ffb52e'],
  relogio: ['#c8ccd2', '#1fa66a'],
  relogio_azul: ['#c8ccd2', '#2457c5'],
  relogio_preto: ['#c8ccd2', '#16100c'],
  relogio_vermelho: ['#c8ccd2', '#d8242c'],
  relogio_dourado: ['#ffc23a', '#c89a2a'],
  mochila_esportiva: ['#b07a3a', '#16100c'],
  mochila_esportiva_azul: ['#2a5fb8', '#16100c'],
  mochila_esportiva_vermelha: ['#b8302a', '#16100c'],
  mochila_tatica: ['#1d1e22'],
  fone: ['#e8e8e8'],
  fone_preto: ['#16100c'],
  fone_vermelho: ['#d8242c'],
  fone_azul: ['#2457c5'],
  fone_rosa: ['#f07ab0'],
};

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Interface do lobby: modos, personalização e configurações. */
export class Menu {
  selectedMode: ModeId = 'br';
  tab: LobbyTab = 'play';
  private category: Category = 'hair';
  /** Camisa em prévia no personagem (null = mostrando a equipada). */
  private preview: JerseyChoice | null = null;
  private dragging = false;
  private lastX = 0;

  onPlay: ((mode: ModeId) => void) | null = null;
  /** Aparência escolhida (salvar e aplicar). */
  onAppearance: ((app: Appearance) => void) | null = null;
  /** Aparência só para mostrar no personagem do lobby, sem salvar. */
  onPreview: ((app: Appearance) => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  onTab: ((tab: LobbyTab) => void) | null = null;
  onRotate: ((delta: number) => void) | null = null;
  onClick: (() => void) | null = null;

  constructor(
    private appearance: Appearance,
    private settings: Settings,
  ) {
    document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => this.setTab(b.dataset.tab as LobbyTab));
    });
    document.querySelectorAll<HTMLButtonElement>('.back-btn').forEach((b) => {
      b.addEventListener('click', () => this.setTab((b.dataset.back as LobbyTab) ?? 'play'));
    });
    el('play-button').addEventListener('click', () => {
      this.onClick?.();
      this.onPlay?.(this.selectedMode);
    });
    const openPicker = () => {
      this.onClick?.();
      this.showPicker(true);
    };
    el('selected-mode').addEventListener('click', openPicker);
    el('change-mode').addEventListener('click', openPicker);
    el('picker-close').addEventListener('click', () => {
      this.onClick?.();
      this.showPicker(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.pickerOpen) this.showPicker(false);
    });
    el('rot-left').addEventListener('click', () => this.onRotate?.(-0.5));
    el('rot-right').addEventListener('click', () => this.onRotate?.(0.5));

    // Arrastar no canvas gira o personagem (aba Personalizar).
    const canvas = el<HTMLCanvasElement>('game-canvas');
    canvas.addEventListener('pointerdown', (e) => {
      if (this.isOpen && this.tab === 'custom') {
        this.dragging = true;
        this.lastX = e.clientX;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.onRotate?.((e.clientX - this.lastX) * 0.012);
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));

    this.renderModes();
    this.renderCustom();
    this.bindSettings();
  }

  get isOpen(): boolean {
    return !el('lobby').classList.contains('hidden');
  }

  show(on: boolean): void {
    if (!on) this.endPreview();
    el('lobby').classList.toggle('hidden', !on);
    if (on) this.setTab('play');
  }

  get pickerOpen(): boolean {
    return !el('mode-picker').classList.contains('hidden');
  }

  private showPicker(on: boolean): void {
    el('mode-picker').classList.toggle('hidden', !on);
    el('play-dock').classList.toggle('hidden', on);
    el('mode-info').classList.toggle('hidden', on);
  }

  setTab(tab: LobbyTab): void {
    if (tab !== this.tab) this.endPreview();
    this.tab = tab;
    if (this.pickerOpen) this.showPicker(false);
    document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    el('tab-play').classList.toggle('hidden', tab !== 'play');
    el('tab-custom').classList.toggle('hidden', tab !== 'custom');
    el('tab-settings').classList.toggle('hidden', tab !== 'settings');
    // No armário o chat e os botões de girar saem de cima dos espaços da esquerda.
    document.body.classList.toggle('locker-open', tab === 'custom');
    this.onTab?.(tab);
  }

  // ------------------------------------------------------------------ modos

  /** Troca a arte dos cards pelas cenas renderizadas do mapa. */
  setModeArt(art: Partial<Record<ModeId, string>>): void {
    Object.assign(MODE_ART, art);
    this.renderModes();
  }

  private renderModes(): void {
    const grid = el('mode-grid');
    grid.innerHTML = '';
    for (const m of MODES) {
      const b = document.createElement('button');
      b.className = 'mode-tile big' + (m.id === this.selectedMode ? ' selected' : '');
      b.type = 'button';
      b.innerHTML = tileHtml(m, `g-${m.id}`) + `<p class="tile-desc">${m.desc}</p>`;
      b.style.setProperty('--mc', m.color);
      b.addEventListener('click', () => {
        this.onClick?.();
        this.selectedMode = m.id;
        this.renderModes();
        this.showPicker(false);
      });
      grid.appendChild(b);
    }
    const cur = MODES.find((m) => m.id === this.selectedMode)!;
    el('selected-mode').innerHTML = tileHtml(cur, 'sel');
    el('selected-mode').style.setProperty('--mc', cur.color);
    el('mode-info-tag').textContent = cur.tag;
    el('mode-info-title').textContent = cur.name;
    el('mode-info-desc').textContent = cur.desc;
  }

  // ------------------------------------------------------------ personalizar

  /** O que está equipado num espaço: nome e cores/miniatura para o quadradinho. */
  private slotInfo(c: Category): { name: string; img?: string; colors: string[] } {
    const app = this.appearance;
    const acc = ACC_SLOTS[c];
    if (acc) {
      const on = acc.ids.filter((id) => app.accessories.includes(id));
      if (!on.length) return { name: acc.none, colors: [] };
      return { name: on.map((id) => ACCESSORY_OPTIONS.find((o) => o.id === id)?.name ?? id).join(' + '), colors: on.flatMap((id) => ACC_COLORS[id] ?? []) };
    }
    switch (c) {
      case 'hair':
        return { name: HAIR_OPTIONS.find((o) => o.id === app.hair)?.name ?? '', colors: [HAIRS[app.hair].base, HAIRS[app.hair].highlight] };
      case 'glasses':
        return app.glasses === 'nenhum' ? { name: 'Sem óculos', colors: [] } : { name: GLASSES_OPTIONS.find((o) => o.id === app.glasses)?.name ?? '', img: glassesThumb(app.glasses), colors: [] };
      case 'jersey':
        return app.jersey === 'none' ? { name: 'Sem camisa', colors: [] } : { name: jerseyById(app.jersey)?.name ?? '', img: jerseyFiles(app.jersey).thumb, colors: [] };
      case 'chains': {
        const ch = CHAIN_CATALOG.find((x) => app.accessories.includes(x.id));
        return ch ? { name: ch.name, img: chainThumb(ch.id), colors: [] } : { name: 'Sem corrente', colors: [] };
      }
      case 'bottom':
        return { name: BOTTOM_CATALOG.find((x) => x.id === app.bottom)?.name ?? '', img: garmentFiles('bottom', app.bottom).thumb, colors: [] };
      case 'shoes':
        return { name: SHOE_CATALOG.find((x) => x.id === app.shoes)?.name ?? '', img: garmentFiles('feet', app.shoes).thumb, colors: [] };
      default:
        return { name: '', colors: [] };
    }
  }

  /** Armário: espaços à esquerda (cada um mostra o que está equipado). */
  private renderSlots(): void {
    const wrap = el('custom-slots');
    wrap.innerHTML = '';
    for (const g of SLOT_GROUPS) {
      const h = document.createElement('div');
      h.className = 'slot-group';
      h.textContent = g.name;
      wrap.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'slot-grid';
      for (const s of g.slots) {
        const info = this.slotInfo(s.id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'locker-slot' + (s.id === this.category ? ' active' : '');
        const pic = info.img
          ? `<img src="${info.img}" alt="" draggable="false">`
          : info.colors.length
            ? `<div class="ls-sw">${info.colors.slice(0, 3).map((c) => `<i style="background:${c}"></i>`).join('')}</div>`
            : '<div class="ls-empty">—</div>';
        b.innerHTML = `<span class="ls-label">${s.name}</span>${pic}<span class="ls-name">${info.name}</span>`;
        b.title = `${s.name}: ${info.name}`;
        b.addEventListener('click', () => {
          this.onClick?.();
          this.endPreview();
          this.category = s.id;
          this.renderCustom();
        });
        grid.appendChild(b);
      }
      wrap.appendChild(grid);
    }
  }

  private renderCustom(): void {
    this.renderSlots();
    const slot = SLOT_GROUPS.flatMap((g) => g.slots).find((s) => s.id === this.category);
    el('custom-title').textContent = slot ? slot.name : 'PERSONALIZAR';
    el('custom-cats').innerHTML = '';

    const box = el('custom-options');
    box.innerHTML = '';
    box.classList.toggle('jerseys', ['jersey', 'bottom', 'shoes', 'glasses', 'chains'].includes(this.category));
    const app = this.appearance;
    const add = <T extends string>(opt: Option<T>, selected: boolean, swatches: string[], onPick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (selected ? ' selected' : '');
      b.innerHTML = `<div class="sw">${swatches.map((c) => `<i style="background:${c}"></i>`).join('')}</div>${opt.name}`;
      b.addEventListener('click', () => {
        this.onClick?.();
        onPick();
      });
      box.appendChild(b);
    };

    switch (this.category) {
      case 'hair':
        for (const o of HAIR_OPTIONS) add(o, app.hair === o.id, [HAIRS[o.id].base, HAIRS[o.id].highlight], () => this.update({ ...app, hair: o.id }));
        break;
      case 'glasses':
        this.renderGlasses(box);
        break;
      case 'jersey':
        this.renderJerseys(box);
        break;
      case 'chains':
        this.renderChains(box);
        break;
      case 'cap':
      case 'phones':
      case 'watch':
      case 'bracelet':
      case 'backpack': {
        // Um espaço de acessório: "nenhum" + as opções dele (trocar já equipa na hora).
        const s = ACC_SLOTS[this.category]!;
        const without = app.accessories.filter((a) => !s.ids.includes(a));
        add({ id: 'none', name: s.none }, !app.accessories.some((a) => s.ids.includes(a)), ['transparent'], () => this.update({ ...app, accessories: without }));
        for (const id of s.ids) {
          const o = ACCESSORY_OPTIONS.find((x) => x.id === id)!;
          const pick = () => (s.multi ? this.update(toggleAccessory(app, id)) : this.update({ ...app, accessories: [...toggleAccessory({ ...app, accessories: without }, id).accessories] }));
          add(o, app.accessories.includes(id), ACC_COLORS[id] ?? [], pick);
        }
        break;
      }
      case 'bottom':
        this.renderThumbCards(box, BOTTOM_CATALOG, app.bottom, 'bottom', (id) => this.update({ ...this.appearance, bottom: id }));
        break;
      case 'shoes':
        this.renderThumbCards(box, SHOE_CATALOG, app.shoes, 'feet', (id) => this.update({ ...this.appearance, shoes: id }));
        break;
    }
  }

  /** Correntes de MC 3D, com miniatura no peito do manequim; clicar equipa (uma por vez). */
  private renderChains(box: HTMLElement): void {
    const current = CHAIN_CATALOG.find((c) => this.appearance.accessories.includes(c.id))?.id ?? null;
    const withoutChains = this.appearance.accessories.filter((a) => !chainById(a));
    const options: Array<{ id: ChainId | null; name: string }> = [{ id: null, name: 'Sem corrente' }, ...CHAIN_CATALOG.map((c) => ({ id: c.id, name: c.name }))];
    for (const o of options) {
      const card = document.createElement('button');
      card.type = 'button';
      const on = o.id === current;
      card.className = 'jersey-card' + (on ? ' selected equipped' : '');
      const img = o.id ? `<img src="${chainThumb(o.id)}" alt="" draggable="false">` : '<div class="no-thumb">SEM CORRENTE</div>';
      card.innerHTML = `${img}<b>${o.name}</b>` + (on ? '<em>EQUIPADA</em>' : '');
      card.addEventListener('click', () => {
        this.onClick?.();
        this.update({ ...this.appearance, accessories: o.id ? [...withoutChains, o.id] : withoutChains });
      });
      box.appendChild(card);
    }
  }

  /** Óculos: o mesmo modelo 3D em 10 cores, com miniatura no rosto do manequim; clicar já equipa. */
  private renderGlasses(box: HTMLElement): void {
    const equipped = this.appearance.glasses;
    for (const o of GLASSES_OPTIONS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'jersey-card' + (o.id === equipped ? ' selected equipped' : '');
      const img = o.id === 'nenhum' ? '<div class="no-thumb">SEM ÓCULOS</div>' : `<img src="${glassesThumb(o.id)}" alt="" draggable="false">`;
      card.innerHTML = `${img}<b>${o.name}</b>` + (o.id === equipped ? '<em>EQUIPADO</em>' : '');
      card.addEventListener('click', () => {
        this.onClick?.();
        this.update({ ...this.appearance, glasses: o.id });
      });
      box.appendChild(card);
    }
  }

  /** Roupas 3D com miniatura renderizada (partes de baixo, calçados): clicar já equipa. */
  private renderThumbCards<T extends string>(box: HTMLElement, items: readonly GarmentDef<T>[], equipped: T, slot: 'bottom' | 'feet', pick: (id: T) => void): void {
    for (const it of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'jersey-card' + (it.id === equipped ? ' selected equipped' : '');
      card.innerHTML = `<img src="${garmentFiles(slot, it.id).thumb}" alt="" draggable="false"><b>${it.name}</b>` + (it.id === equipped ? '<em>EQUIPADO</em>' : '');
      card.addEventListener('click', () => {
        this.onClick?.();
        pick(it.id);
      });
      box.appendChild(card);
    }
  }

  /** Camisas: cartões com miniatura, prévia no personagem, EQUIPAR e REMOVER. */
  private renderJerseys(box: HTMLElement): void {
    const equipped = this.appearance.jersey;
    const shown = this.preview ?? equipped;
    for (const j of JERSEY_CATALOG) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'jersey-card' + (shown === j.id ? ' selected' : '') + (equipped === j.id ? ' equipped' : '');
      card.innerHTML =
        `<img src="${jerseyFiles(j.id).thumb}" alt="" draggable="false">` +
        `<b>${j.name}</b><span>${COLLAR_LABEL[j.collar]}</span>` +
        (equipped === j.id ? '<em>EQUIPADA</em>' : '');
      card.addEventListener('click', () => {
        this.onClick?.();
        this.previewJersey(j.id);
      });
      box.appendChild(card);
    }
    const def = shown === 'none' ? undefined : jerseyById(shown);
    const bar = document.createElement('div');
    bar.className = 'jersey-actions';
    const isEquipped = shown === equipped;
    bar.innerHTML =
      `<div class="ja-name"><b>${def ? def.name : 'Sem camisa'}</b><span>${isEquipped ? 'Equipada' : 'Prévia no personagem'}</span></div>` +
      `<button type="button" class="ja-equip"${isEquipped ? ' disabled' : ''}>${isEquipped ? 'EQUIPADA ✓' : 'EQUIPAR'}</button>` +
      `<button type="button" class="ja-remove"${equipped === 'none' ? ' disabled' : ''}>REMOVER CAMISA</button>` +
      `<button type="button" class="ja-turn">VER COSTAS ⟳</button>`;
    bar.querySelector('.ja-equip')!.addEventListener('click', () => {
      this.onClick?.();
      this.preview = null;
      this.update({ ...this.appearance, jersey: shown });
    });
    bar.querySelector('.ja-remove')!.addEventListener('click', () => {
      this.onClick?.();
      this.preview = null;
      this.update({ ...this.appearance, jersey: 'none' });
    });
    bar.querySelector('.ja-turn')!.addEventListener('click', () => {
      this.onClick?.();
      this.onRotate?.(Math.PI);
    });
    box.appendChild(bar);
  }

  /** Mostra uma camisa no personagem sem equipar (o salvo só muda no EQUIPAR). */
  private previewJersey(id: JerseyChoice): void {
    this.preview = id === this.appearance.jersey ? null : id;
    this.onPreview?.({ ...this.appearance, jersey: id });
    this.renderCustom();
  }

  /** Desfaz a prévia (ao trocar de categoria/aba ou sair do lobby). */
  private endPreview(): void {
    if (this.preview === null) return;
    this.preview = null;
    this.onPreview?.(this.appearance);
  }

  private update(app: Appearance): void {
    this.appearance = app;
    this.onAppearance?.(app);
    this.renderCustom();
  }

  // ------------------------------------------------------------ configurações

  private bindSettings(): void {
    const s = this.settings;
    const name = el<HTMLInputElement>('set-name');
    const sens = el<HTMLInputElement>('set-sens');
    const aim = el<HTMLInputElement>('set-aim');
    const scope = el<HTMLInputElement>('set-scope');
    const inv = el<HTMLInputElement>('set-invert');
    const fov = el<HTMLInputElement>('set-fov');
    const vol = el<HTMLInputElement>('set-vol');
    const q = el<HTMLSelectElement>('set-quality');
    name.value = s.playerName;
    sens.value = String(s.sensitivity);
    aim.value = String(s.aimSensitivity);
    scope.value = String(s.scopeSensitivity);
    inv.checked = s.invertY;
    fov.value = String(s.fov);
    vol.value = String(s.volume);
    q.value = s.quality;
    const labels = () => {
      el('set-sens-val').textContent = `${Number(sens.value).toFixed(2)}x`;
      el('set-aim-val').textContent = `${Math.round(Number(aim.value) * 100)}%`;
      el('set-scope-val').textContent = `${Math.round(Number(scope.value) * 100)}%`;
      el('set-fov-val').textContent = `${fov.value}°`;
      el('set-vol-val').textContent = `${Math.round(Number(vol.value) * 100)}%`;
    };
    labels();
    const commit = () => {
      this.settings = {
        playerName: name.value.trim().slice(0, 18) || 'Cria da Quebrada',
        sensitivity: Number(sens.value),
        aimSensitivity: Number(aim.value),
        scopeSensitivity: Number(scope.value),
        invertY: inv.checked,
        fov: Number(fov.value),
        volume: Number(vol.value),
        quality: q.value as Settings['quality'],
      };
      labels();
      el('lobby-name').textContent = this.settings.playerName;
      this.onSettings?.(this.settings);
    };
    for (const input of [name, sens, aim, scope, inv, fov, vol, q]) input.addEventListener('input', commit);
    for (const input of [inv, q]) input.addEventListener('change', commit);
    el('lobby-name').textContent = s.playerName;
  }
}
