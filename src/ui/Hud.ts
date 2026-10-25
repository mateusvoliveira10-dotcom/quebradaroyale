import { Input } from '../core/Input';
import { AMMO, AmmoType, RARITIES } from '../weapons/WeaponDefs';
import { WeaponSystem } from '../weapons/WeaponSystem';

export interface HudDebug {
  fps: number;
  speed: number;
  state: string;
  x: number;
  y: number;
  z: number;
  extra: string;
}

export interface DropInfo {
  title: string;
  hint: string;
  /** 0..1 da barra (altura ou progresso da rota), ou null para esconder. */
  bar: number | null;
}

export interface Plate {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  hp: number | null;
  /** Escudo (barra azul acima da vida), ou null para esconder. */
  shield?: number | null;
}

export interface TrainingStats {
  time: number;
  score: number;
  hits: number;
  shots: number;
  difficulty: string;
}

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** HUD de partida: fase/tempo, vida, armas, mira, avisos, placar, zona e nomes. */
export class Hud {
  private readonly root = el('hud');
  private readonly debug = el('debug');
  private readonly help = el('help');
  private readonly crosshair = el('crosshair');
  private readonly hitmarker = el('hitmarker');
  private readonly damageLayer = el('damage-layer');
  private readonly scope = el('scope');
  private readonly phasePill = el('phase-pill');
  private readonly timer = el('match-timer');
  private readonly dropPanel = el('drop-panel');
  private readonly dropTitle = el('drop-title');
  private readonly dropHint = el('drop-hint');
  private readonly altFill = el('altimeter-fill');
  private readonly toasts = el('toasts');
  private readonly prompt = el('prompt');
  private readonly promptText = el('prompt-text');
  private readonly reload = el('reload');
  private readonly reloadFill = el('reload-fill');
  private readonly ammoReserve = el('ammo-reserve');
  private readonly slotEls = [el('slot-0'), el('slot-1')];
  private readonly healthFill = el('health-fill');
  private readonly healthNum = el('health-num');
  private readonly shieldFill = el('shield-fill');
  private readonly shieldNum = el('shield-num');
  private readonly dmgDirs = el('dmg-dirs');
  private readonly elim = el('elim');
  private readonly elimCount = el('elim-count');
  private elimTimer = 0;
  private elimStreak = 0;
  private lastShield = -1;
  private reticle = '';
  private readonly vignette = el('damage-vignette');
  private readonly killfeed = el('killfeed');
  private readonly plates = el('nameplates');
  private readonly plateEls = new Map<number, HTMLElement>();
  private elapsed = 0;
  private hitTimer = 0;
  private vignetteTimer = 0;
  private lastLoadoutKey = '';
  private lastHealth = -1;

  constructor(private readonly input: Input) {}

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.clearPlates();
      this.toasts.innerHTML = '';
      this.killfeed.innerHTML = '';
    }
  }

  /** Configura quais blocos aparecem em cada modo. */
  configure(mode: 'br' | 'dm' | 'training'): void {
    document.body.classList.toggle('dm', mode === 'dm');
    el('alive-pill').classList.toggle('hidden', mode !== 'br');
    el('teamscore').classList.toggle('hidden', mode !== 'dm');
    el('zone-info').classList.toggle('hidden', mode !== 'br');
    el('training-panel').classList.toggle('hidden', mode !== 'training');
    el('minimap-wrap').classList.toggle('hidden', mode === 'training');
    el('protect').classList.add('hidden');
    el('respawn').classList.add('hidden');
    el('countdown').classList.add('hidden');
    this.setDrop(null);
    this.setPrompt(null);
    this.lastLoadoutKey = '';
    this.lastHealth = -1;
    this.lastShield = -1;
    this.elimTimer = 0;
    this.elim.classList.add('hidden');
    this.dmgDirs.innerHTML = '';
  }

  setPlayerName(name: string): void {
    el('player-name').textContent = name.toUpperCase();
  }

  private placeEl: HTMLDivElement | null = null;
  private placeTimer = 0;

  /** Nome grande da área ao entrar nela (como no Fortnite), some sozinho. */
  showPlace(name: string): void {
    if (!this.placeEl) {
      const d = document.createElement('div');
      d.style.cssText =
        'position:fixed;left:50%;top:16%;transform:translateX(-50%);pointer-events:none;z-index:20;' +
        'font:900 34px "Arial Black",Impact,sans-serif;letter-spacing:2px;color:#fff;' +
        'text-shadow:0 3px 0 #1b1420,0 0 18px rgba(0,0,0,0.6);transition:opacity .5s;opacity:0;white-space:nowrap';
      document.body.appendChild(d);
      this.placeEl = d;
    }
    this.placeEl.textContent = name;
    this.placeEl.style.opacity = '1';
    this.placeTimer = 2.6;
  }

  /** Esconde o nome da área (fim de partida, lobby). */
  hidePlace(): void {
    this.placeTimer = 0;
    if (this.placeEl) this.placeEl.style.opacity = '0';
  }

  toast(text: string, color = '#ffd21f'): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeftColor = color;
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3100);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  kill(killer: string, killerColor: string, victim: string, victimColor: string, weapon: string): void {
    const k = document.createElement('div');
    k.className = 'kill';
    const a = document.createElement('span');
    a.textContent = killer;
    a.style.color = killerColor;
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = `[${weapon}]`;
    const v = document.createElement('span');
    v.textContent = victim;
    v.style.color = victimColor;
    k.append(a, w, v);
    this.killfeed.appendChild(k);
    setTimeout(() => k.remove(), 5100);
    while (this.killfeed.children.length > 6) this.killfeed.firstElementChild?.remove();
  }

  /**
   * Marcador de acerto + número de dano na posição da tela. Cores como no Fortnite:
   * branco = vida, azul = escudo, amarelo = crítico (cabeça).
   */
  hit(screenX: number, screenY: number, damage: number, crit: boolean, shield = false): void {
    this.hitmarker.classList.add('show');
    this.hitmarker.classList.toggle('crit', crit);
    this.hitmarker.classList.remove('kill');
    this.hitTimer = 0.12;
    if (damage <= 0) return;
    const d = document.createElement('div');
    d.className = 'dmg' + (crit ? ' crit' : shield ? ' shield' : '');
    d.textContent = String(damage);
    d.style.left = `${screenX + (Math.random() - 0.5) * 30}px`;
    d.style.top = `${screenY}px`;
    this.damageLayer.appendChild(d);
    setTimeout(() => d.remove(), 850);
  }

  /** Eliminação feita pelo jogador: marcador vermelho, faixa "ELIMINADO" e sequência. */
  elimination(): void {
    this.hitmarker.classList.add('show', 'kill');
    this.hitTimer = 0.35;
    this.elimStreak = this.elimTimer > 0 ? this.elimStreak + 1 : 1;
    this.elimCount.textContent = this.elimStreak > 1 ? `x${this.elimStreak}` : '';
    this.elim.classList.remove('hidden', 'pop');
    void this.elim.offsetWidth; // reinicia a animação
    this.elim.classList.add('pop');
    this.elimTimer = 2.2;
  }

  hurt(shield = false): void {
    this.vignette.classList.add('on');
    this.vignette.classList.toggle('shield', shield);
    this.vignetteTimer = 0.15;
  }

  /** Arco em volta da mira apontando para quem atirou (ângulo em relação à câmera). */
  damageFrom(angle: number, shield: boolean): void {
    const a = document.createElement('div');
    a.className = 'dmg-dir' + (shield ? ' shield' : '');
    a.style.transform = `rotate(${angle}rad)`;
    this.dmgDirs.appendChild(a);
    setTimeout(() => a.remove(), 1100);
    while (this.dmgDirs.children.length > 6) this.dmgDirs.firstElementChild?.remove();
  }

  setPhase(text: string, style: 'normal' | 'air' | 'danger' = 'normal'): void {
    this.phasePill.textContent = text;
    this.phasePill.classList.toggle('air', style === 'air');
    this.phasePill.classList.toggle('danger', style === 'danger');
  }

  setTimer(seconds: number): void {
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    this.timer.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  setAlive(n: number): void {
    el('alive-count').textContent = String(n);
  }

  setTeamScore(blue: number, red: number, secondsLeft: number): void {
    el('score-blue').textContent = String(blue);
    el('score-red').textContent = String(red);
    const s = Math.max(0, Math.ceil(secondsLeft));
    el('dm-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  setZone(text: string | null, danger: boolean): void {
    const z = el('zone-info');
    z.classList.toggle('hidden', !text);
    if (text) z.textContent = text;
    z.classList.toggle('danger', danger);
  }

  setProtected(on: boolean): void {
    el('protect').classList.toggle('hidden', !on);
  }

  setRespawn(seconds: number | null): void {
    el('respawn').classList.toggle('hidden', seconds === null);
    if (seconds !== null) el('respawn-time').textContent = String(Math.ceil(seconds));
  }

  setCountdown(n: number | null): void {
    const c = el('countdown');
    c.classList.toggle('hidden', n === null);
    if (n !== null) c.textContent = n > 0 ? String(n) : 'JÁ!';
  }

  setTraining(s: TrainingStats): void {
    el('tp-time').textContent = s.time.toFixed(1);
    el('tp-score').textContent = String(s.score);
    el('tp-hits').textContent = String(s.hits);
    el('tp-shots').textContent = String(s.shots);
    el('tp-acc').textContent = `${s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0}%`;
    el('tp-diff').textContent = s.difficulty;
  }

  setDrop(info: DropInfo | null): void {
    this.dropPanel.classList.toggle('hidden', !info);
    if (!info) return;
    this.dropTitle.textContent = info.title;
    this.dropHint.innerHTML = info.hint;
    el('altimeter').classList.toggle('hidden', info.bar === null);
    if (info.bar !== null) this.altFill.style.width = `${Math.round(info.bar * 100)}%`;
  }

  setPrompt(text: string | null, color = '#ffffff'): void {
    this.prompt.classList.toggle('hidden', !text);
    if (text) {
      this.promptText.textContent = text;
      this.prompt.style.setProperty('--rarity', color);
    }
  }

  setHealth(hp: number, shield = 0): void {
    const v = Math.max(0, Math.round(hp));
    const s = Math.max(0, Math.round(shield));
    if (v !== this.lastHealth) {
      this.lastHealth = v;
      this.healthNum.textContent = String(v);
      this.healthFill.style.width = `${v}%`;
      this.healthFill.classList.toggle('low', v < 35);
    }
    if (s !== this.lastShield) {
      this.lastShield = s;
      this.shieldNum.textContent = String(s);
      this.shieldNum.classList.toggle('zero', s === 0);
      this.shieldFill.style.width = `${s}%`;
    }
  }

  /** Nomes/vida sobre as cabeças (posição já projetada na tela). */
  updatePlates(list: Plate[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let e = this.plateEls.get(p.id);
      if (!e) {
        e = document.createElement('div');
        e.className = 'plate';
        e.innerHTML = '<div class="n"></div><div class="sh"><i></i></div><div class="hp"><i></i></div>';
        this.plates.appendChild(e);
        this.plateEls.set(p.id, e);
      }
      e.style.left = `${p.x}px`;
      e.style.top = `${p.y}px`;
      e.style.color = p.color;
      (e.querySelector('.n') as HTMLElement).textContent = p.text;
      const hp = e.querySelector('.hp') as HTMLElement;
      hp.style.display = p.hp === null ? 'none' : 'block';
      if (p.hp !== null) (hp.firstElementChild as HTMLElement).style.width = `${Math.max(0, p.hp)}%`;
      const sh = e.querySelector('.sh') as HTMLElement;
      const shield = p.shield ?? 0;
      sh.style.display = p.shield == null || shield <= 0 ? 'none' : 'block';
      if (shield > 0) (sh.firstElementChild as HTMLElement).style.width = `${shield}%`;
    }
    for (const [id, e] of this.plateEls) {
      if (!seen.has(id)) {
        e.remove();
        this.plateEls.delete(id);
      }
    }
  }

  clearPlates(): void {
    for (const e of this.plateEls.values()) e.remove();
    this.plateEls.clear();
  }

  update(dt: number, weapons: WeaponSystem, armedView: boolean, dbg: HudDebug): void {
    if (this.placeTimer > 0) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0 && this.placeEl) this.placeEl.style.opacity = '0';
    }
    if (this.input.wasPressed('KeyH')) this.help.classList.toggle('hidden');
    if (this.input.wasPressed('F3')) this.debug.classList.toggle('hidden');

    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('show');
    }
    if (this.vignetteTimer > 0) {
      this.vignetteTimer -= dt;
      if (this.vignetteTimer <= 0) this.vignette.classList.remove('on');
    }
    if (this.elimTimer > 0) {
      this.elimTimer -= dt;
      if (this.elimTimer <= 0) this.elim.classList.add('hidden');
    }

    const w = weapons.current;
    const scoped = weapons.scoped;
    this.scope.classList.toggle('on', scoped);
    this.crosshair.classList.toggle('hidden', !armedView || scoped);
    if (w) {
      // Retículo por arma (cruz, círculo da escopeta, ponto do rifle de precisão), que
      // abre com a dispersão real e fecha por completo com a precisão do primeiro tiro.
      if (w.def.reticle !== this.reticle) {
        this.crosshair.classList.remove('cross', 'circle', 'dot');
        this.crosshair.classList.add(w.def.reticle);
        this.reticle = w.def.reticle;
      }
      const fsa = weapons.firstShotReady;
      const gap = fsa ? 2 : 4 + weapons.currentSpread * 420;
      this.crosshair.style.setProperty('--gap', `${Math.min(70, gap).toFixed(1)}px`);
      this.crosshair.classList.toggle('fsa', fsa);
    }

    const rp = weapons.reloadProgress;
    this.reload.classList.toggle('hidden', rp < 0);
    if (rp >= 0) this.reloadFill.style.width = `${Math.round(rp * 100)}%`;

    this.updateLoadout(weapons);

    this.elapsed += dt;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;
    this.debug.textContent =
      `FPS ${dbg.fps.toFixed(0)}\n` +
      `Estado ${dbg.state}\n` +
      `Vel. ${dbg.speed.toFixed(1)} m/s\n` +
      `Pos. ${dbg.x.toFixed(1)}, ${dbg.y.toFixed(1)}, ${dbg.z.toFixed(1)}\n` +
      dbg.extra;
  }

  private updateLoadout(weapons: WeaponSystem): void {
    const key =
      weapons.slots.map((s) => (s ? `${s.def.id}${s.rarity}:${s.mag}` : '-')).join('|') +
      `#${weapons.active}#${weapons.infiniteReserve}#` +
      (Object.keys(weapons.ammo) as AmmoType[]).map((k) => weapons.ammo[k]).join(',');
    if (key === this.lastLoadoutKey) return;
    this.lastLoadoutKey = key;

    weapons.slots.forEach((s, i) => {
      const slot = this.slotEls[i];
      const name = slot.querySelector('.name') as HTMLElement;
      const mag = slot.querySelector('.mag') as HTMLElement;
      slot.classList.toggle('active', i === weapons.active && !!s);
      slot.classList.toggle('empty', !s);
      if (s) {
        const color = RARITIES[s.rarity].color;
        slot.style.setProperty('--rarity', color);
        name.textContent = s.def.name;
        name.style.color = color;
        const reserve = weapons.infiniteReserve ? '∞' : String(weapons.ammo[s.def.ammo]);
        mag.innerHTML = `${s.mag}<small> / ${reserve}</small>`;
      } else {
        slot.style.removeProperty('--rarity');
        name.textContent = 'Vazio';
        name.style.color = '';
        mag.textContent = '';
      }
    });

    this.ammoReserve.innerHTML = weapons.infiniteReserve
      ? ''
      : (Object.keys(AMMO) as AmmoType[])
          .filter((k) => weapons.ammo[k] > 0)
          .map((k) => `<span class="ammo-chip" style="--c:${AMMO[k].color}">${AMMO[k].name} <b>${weapons.ammo[k]}</b></span>`)
          .join('');
  }
}
