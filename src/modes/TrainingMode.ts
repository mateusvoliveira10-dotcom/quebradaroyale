import { Vector3 } from '@babylonjs/core';
import { WORLD } from '../core/config';
import type { Game } from '../core/Game';
import { MAP_FENCE } from '../player/CharacterController';
import { Rng } from '../utils/random';
import { PopTarget, PopTargetConfig } from '../weapons/PopTarget';
import { WeaponId, WEAPONS } from '../weapons/WeaponDefs';
import { buildWeaponModel, disposeWeaponModel, WeaponModel } from '../weapons/WeaponModels';
import { GameMode } from './GameMode';

type Difficulty = 'facil' | 'medio' | 'dificil';

const DIFFS: Record<Difficulty, { name: string; desc: string; count: number; cfg: () => PopTargetConfig; minDist: number; maxDist: number }> = {
  facil: { name: 'FÁCIL', desc: 'Alvos grandes e parados', count: 3, minDist: 9, maxDist: 20, cfg: () => ({ size: 1.0, exposure: Infinity, moveAmp: 0, moveSpeed: 0, points: 100 }) },
  medio: { name: 'MÉDIO', desc: 'Alvos menores em posições variadas, somem em 3,5 s', count: 2, minDist: 10, maxDist: 28, cfg: () => ({ size: 0.62, exposure: 3.5, moveAmp: 0, moveSpeed: 0, points: 150 }) },
  dificil: { name: 'DIFÍCIL', desc: 'Alvos pequenos e móveis, só 1,7 s expostos', count: 2, minDist: 12, maxDist: 32, cfg: () => ({ size: 0.44, exposure: 1.7, moveAmp: 0, moveSpeed: 0, points: 220 }) },
};

const SESSION = 60;
const BENCH_WEAPONS: WeaponId[] = ['pistola', 'smg', 'escopeta', 'fuzil', 'sniper'];
const BEST_KEY = 'quebrada-royale.training.best.v1';

/**
 * Treinamento no Galpão da Quebrada: spawn fixo, armas de treino nas bancadas
 * (munição infinita), alvos basculantes que reagem ao tiro real, três
 * dificuldades, cronômetro, pontuação, tiros, acertos e precisão.
 */
export class TrainingMode implements GameMode {
  readonly kind = 'training' as const;
  private readonly targets: PopTarget[] = [];
  private displays: WeaponModel[] = [];
  private difficulty: Difficulty = 'facil';
  private state: 'setup' | 'countdown' | 'running' = 'setup';
  private countdown = 0;
  private timeLeft = SESSION;
  private score = 0;
  private hits = 0;
  private shots = 0;
  private rng = new Rng(4);
  private nearBench = -1;
  restart = () => this.beginSession();
  changeDifficulty = () => this.showSetup(null);

  constructor(private readonly g: Game) {
    for (let i = 0; i < 4; i++) {
      const t = new PopTarget(g.scene);
      for (const m of t.meshes) g.env.shadows.addShadowCaster(m, false);
      g.combat.addShootable(...t.meshes);
      t.onHit = (pts, crit, point) => this.onTargetHit(t, pts, crit, point);
      t.onExpired = () => {
        // Alvo perdido: só some.
      };
      this.targets.push(t);
    }
  }

  focus(): Vector3 {
    return this.g.player.position;
  }

  enter(): void {
    const g = this.g;
    g.loot.clear();
    g.combat.clear(g.player);
    g.player.team = 0;
    g.player.reset();
    g.player.ctrl.bounds = { cx: g.galpao.center.x, cz: g.galpao.center.z, half: 40 };
    // O galpão fica fora do mapa da comunidade e tem paredes próprias: sem a cerca do mapa
    // (definida antes do spawn, senão o jogador seria puxado para a borda do mapa).
    g.player.ctrl.fence = null;
    g.player.ctrl.spawnAt(g.galpao.spawn.clone(), g.galpao.spawnYaw);
    g.camera.lookAlong(g.galpao.spawnYaw, 1.42);
    g.camera.snap();
    g.playerWeapons.clear();
    g.playerWeapons.addWeapon(WEAPONS.pistola, 2);
    g.playerWeapons.infiniteReserve = true;
    g.playerWeapons.enabled = true;
    g.playerWeapons.onFire = () => {
      if (this.state === 'running') this.shots++;
    };
    g.hud.show(true);
    g.hud.configure('training');
    g.hud.setPhase('TREINAMENTO');

    // Armas de treino em exibição nas bancadas.
    this.displays = g.galpao.weaponSlots.map((p, i) => {
      const m = buildWeaponModel(g.scene, BENCH_WEAPONS[i], 2);
      m.root.position.copyFrom(p);
      m.root.rotation.set(0, Math.PI / 2, Math.PI / 2);
      return m;
    });
    for (const t of this.targets) t.hide();
    this.showSetup(null);
  }

  exit(): void {
    for (const t of this.targets) t.hide();
    for (const d of this.displays) disposeWeaponModel(d);
    this.displays = [];
    this.g.playerWeapons.onFire = null;
    this.g.player.ctrl.bounds = { cx: 0, cz: 0, half: WORLD.extent };
    this.g.player.ctrl.fence = MAP_FENCE;
    this.g.overlays.hideTraining();
  }

  private showSetup(resultHtml: string | null): void {
    const g = this.g;
    this.state = 'setup';
    for (const t of this.targets) t.hide();
    g.input.captureOnClick = false;
    g.input.unlockPointer();
    g.hud.setCountdown(null);
    g.overlays.trainingSetup(
      (Object.keys(DIFFS) as Difficulty[]).map((id) => ({ id, name: DIFFS[id].name, desc: `${DIFFS[id].desc} · recorde ${this.best(id)}` })),
      this.difficulty,
      resultHtml,
      (id) => {
        this.difficulty = id;
        g.overlays.hideTraining();
        g.input.captureOnClick = true;
        g.input.lockPointer();
        this.beginSession();
      },
      () => g.toLobby(),
    );
  }

  private beginSession(): void {
    this.state = 'countdown';
    this.countdown = 3;
    this.timeLeft = SESSION;
    this.score = 0;
    this.hits = 0;
    this.shots = 0;
    this.rng = new Rng(Date.now() & 0xffff);
    for (const t of this.targets) t.hide();
    this.g.player.ctrl.spawnAt(this.g.galpao.spawn.clone(), this.g.galpao.spawnYaw);
  }

  private best(d: Difficulty): number {
    try {
      const o = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
      return o[d] ?? 0;
    } catch {
      return 0;
    }
  }

  private saveBest(d: Difficulty, score: number): boolean {
    if (score <= this.best(d)) return false;
    try {
      const o = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
      o[d] = score;
      localStorage.setItem(BEST_KEY, JSON.stringify(o));
    } catch {
      // sem armazenamento
    }
    return true;
  }

  private onTargetHit(t: PopTarget, pts: number, crit: boolean, point: Vector3): void {
    if (this.state !== 'running') return;
    this.hits++;
    this.score += pts;
    this.g.audio.targetDown();
    this.g.showHitAt(point, pts, crit);
    void t;
  }

  /** Posição livre para um novo alvo (sem sobrepor os outros). */
  private spawnTarget(t: PopTarget): void {
    const a = this.g.galpao.targetArea;
    const d = DIFFS[this.difficulty];
    const counter = this.g.galpao.counterZ;
    for (let tries = 0; tries < 20; tries++) {
      const z = counter - this.rng.range(d.minDist, d.maxDist);
      const x = this.rng.range(a.x0 + 1.5, a.x1 - 1.5);
      const p = new Vector3(x, 0, Math.max(a.z0, Math.min(a.z1, z)));
      if (this.targets.some((o) => o !== t && o.busy && Vector3.Distance(o.position, p) < 3.2)) continue;
      const cfg = d.cfg();
      if (this.difficulty === 'dificil') {
        cfg.moveAmp = this.rng.range(1.8, 3.4);
        cfg.moveSpeed = this.rng.range(1.3, 2.2);
        p.x = Math.max(a.x0 + cfg.moveAmp + 0.5, Math.min(a.x1 - cfg.moveAmp - 0.5, p.x));
      }
      t.pop(p, cfg);
      return;
    }
  }

  update(dt: number): void {
    const g = this.g;
    const blocked = g.overlays.blocking;
    g.updatePlayer(dt, !blocked, false);
    g.followPlayerCamera(dt);
    for (const t of this.targets) t.update(dt);

    // Bancadas: trocar a arma de treino.
    this.nearBench = -1;
    const p = g.player.position;
    g.galpao.weaponSlots.forEach((s, i) => {
      if (Math.hypot(s.x - p.x, s.z - p.z) < 1.9) this.nearBench = i;
    });
    for (const d of this.displays) d.root.rotation.x += dt * 0.6;
    if (this.nearBench >= 0) {
      const def = WEAPONS[BENCH_WEAPONS[this.nearBench]];
      g.hud.setPrompt(`Pegar ${def.name} (treino)`, '#7fe3ff');
      if (!blocked && g.input.wasPressed('KeyE')) {
        g.playerWeapons.clear();
        g.playerWeapons.addWeapon(def, 2);
        g.playerWeapons.infiniteReserve = true;
        g.audio.pickup(2);
        g.hud.toast(`${def.name} equipada`, '#7fe3ff');
      }
    } else {
      g.hud.setPrompt(null);
    }

    if (!blocked && this.state !== 'setup' && g.input.wasPressed('KeyT')) this.beginSession();

    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before && now > 0) g.audio.ui();
      g.hud.setCountdown(this.countdown > 0 ? now : 0);
      if (this.countdown <= -0.5) {
        g.hud.setCountdown(null);
        this.state = 'running';
      }
    } else if (this.state === 'running') {
      this.timeLeft -= dt;
      const d = DIFFS[this.difficulty];
      let active = this.targets.filter((t) => t.busy).length;
      for (const t of this.targets) {
        if (active >= d.count) break;
        if (!t.busy) {
          this.spawnTarget(t);
          active++;
        }
      }
      if (this.timeLeft <= 0) this.endSession();
    }

    g.hud.setTraining({ time: Math.max(0, this.timeLeft), score: this.score, hits: this.hits, shots: this.shots, difficulty: DIFFS[this.difficulty].name });
    g.updatePlates(false);
  }

  private endSession(): void {
    const acc = this.shots > 0 ? Math.round((this.hits / this.shots) * 100) : 0;
    const record = this.saveBest(this.difficulty, this.score);
    this.showSetup(
      `${record ? '🏆 NOVO RECORDE! ' : ''}${DIFFS[this.difficulty].name}: <b>${this.score}</b> pontos · ${this.hits} acertos · ${this.shots} tiros · precisão <b>${acc}%</b>`,
    );
  }
}
