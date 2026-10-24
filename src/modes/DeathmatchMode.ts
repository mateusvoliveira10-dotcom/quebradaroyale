import { Vector3 } from '@babylonjs/core';
import { randomAppearance } from '../appearance/Appearance';
import { Actor, TEAM_COLORS } from '../combat/Actor';
import { KillEvent } from '../combat/CombatManager';
import type { BotEntry, Game } from '../core/Game';
import { Rng } from '../utils/random';
import { WeaponId, WEAPONS } from '../weapons/WeaponDefs';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { GameMode } from './GameMode';

const MATCH_SECONDS = 300;
const RESPAWN_DELAY = 4;
const PROTECTION = 2.5;
/** Escudo ao nascer e sifão por eliminação (vida, e o excedente vira escudo). */
const SPAWN_SHIELD = 50;
const SIPHON = 50;

/** Áreas de nascimento de cada equipe (rua principal, lados opostos do cruzamento). */
const SPAWN_CENTERS: Record<number, Vector3[]> = {
  0: [new Vector3(-42, 0, 0), new Vector3(-36, 0, -10), new Vector3(-46, 0, 8)],
  1: [new Vector3(42, 0, 0), new Vector3(36, 0, 10), new Vector3(46, 0, -8)],
};

const PRIMARIES: Array<{ id: WeaponId; desc: string }> = [
  { id: 'fuzil', desc: 'Versátil, automático, bom a média distância' },
  { id: 'smg', desc: 'Cadência altíssima para becos e curta distância' },
  { id: 'escopeta', desc: 'Devastadora de perto, ideal dentro das lojas' },
  { id: 'sniper', desc: 'Um tiro, um susto. Para lajes e ruas longas' },
];

interface Respawn {
  actor: Actor;
  at: number;
}

/**
 * Deathmatch 5v5: Azul (jogador + 4 bots) contra Vermelho (5 bots). Mecânicas
 * próprias: escolha de equipamento, renascimento com proteção em pontos da
 * própria equipe, regeneração fora de combate, munição de reserva infinita,
 * placar por eliminações e 5 minutos de partida.
 */
export class DeathmatchMode implements GameMode {
  readonly kind = 'dm' as const;
  private bots: BotEntry[] = [];
  private rng = new Rng(1);
  private started = false;
  private ended = false;
  private timeLeft = MATCH_SECONDS;
  private readonly score = [0, 0];
  private respawns: Respawn[] = [];
  private primary: WeaponId = 'fuzil';
  private spawnPoints: Record<number, Vector3[]> = { 0: [], 1: [] };
  restart = () => this.g.startMode('dm');
  changeDifficulty = null;

  constructor(private readonly g: Game) {}

  focus(): Vector3 {
    return this.g.player.position;
  }

  enter(): void {
    const g = this.g;
    this.rng = new Rng((Date.now() ^ 0xd34d) & 0xffffff);
    this.started = false;
    this.ended = false;
    this.timeLeft = MATCH_SECONDS;
    this.score[0] = 0;
    this.score[1] = 0;
    this.respawns = [];
    g.loot.clear();
    g.hud.show(false);
    g.input.captureOnClick = false;
    g.input.unlockPointer();
    this.buildSpawnPoints();

    // Jogador espera na base azul enquanto escolhe o equipamento.
    g.combat.clear();
    g.player.reset();
    g.playerWeapons.clear();
    g.player.ctrl.spawnAt(this.spawnPoints[0][0].clone(), Math.PI / 2);
    g.camera.lookAlong(Math.PI / 2);
    g.camera.snap();

    g.overlays.pickLoadout(
      PRIMARIES.map((p) => ({ id: p.id, name: WEAPONS[p.id].name, desc: p.desc })),
      this.primary,
      (id) => {
        this.primary = id;
        g.overlays.hideLoadout();
        g.input.lockPointer();
        this.start();
      },
      () => g.toLobby(),
    );
  }

  /** Pontos válidos (andáveis e sem colisor) perto das áreas de cada equipe. */
  private buildSpawnPoints(): void {
    const g = this.g;
    for (const team of [0, 1]) {
      const pts: Vector3[] = [];
      for (const c of SPAWN_CENTERS[team]) {
        for (let i = 0; i < 12 && pts.length < 14; i++) {
          const p = g.nav.randomNear(c, 7, this.rng);
          if (!p) continue;
          const feet = p.add(new Vector3(0, 0.05, 0));
          if (!g.colliders.isBodyFree(feet)) continue;
          if (pts.some((q) => Vector3.Distance(q, feet) < 2.2)) continue;
          pts.push(feet);
        }
      }
      this.spawnPoints[team] = pts.length > 0 ? pts : [SPAWN_CENTERS[team][0].clone()];
    }
  }

  private start(): void {
    const g = this.g;
    g.hud.show(true);
    g.hud.configure('dm');
    g.input.captureOnClick = true;
    g.combat.clear();
    g.combat.siphon = SIPHON;

    g.player.team = 0;
    g.player.kills = 0;
    g.player.deaths = 0;
    g.combat.add(g.player);

    this.bots = g.acquireBots(9);
    this.bots.forEach((b, i) => {
      const team = i < 4 ? 0 : 1;
      b.actor.team = team;
      b.actor.kills = 0;
      b.actor.deaths = 0;
      b.actor.ctrl.model.setAppearance(randomAppearance(this.rng, team === 0 ? 'jersey_cruzeiro' : 'jersey_flamengo'));
      b.brain.resetBrain();
      g.combat.add(b.actor);
    });

    for (const a of g.combat.actors) this.spawn(a, true);
    this.started = true;
    g.hud.toast('Deathmatch 5v5: elimine a equipe vermelha!', TEAM_COLORS[0]);
  }

  private weaponsOf(a: Actor): WeaponSystem {
    if (a.isPlayer) return this.g.playerWeapons;
    return this.bots.find((b) => b.actor === a)!.weapons;
  }

  /** Nasce/renasce num ponto da equipe longe dos inimigos, com proteção. */
  private spawn(a: Actor, first: boolean): void {
    const g = this.g;
    const enemies = g.combat.actors.filter((o) => o.alive && o.team !== a.team && o !== a);
    let best = this.spawnPoints[a.team][0];
    let bestScore = -Infinity;
    for (const p of this.spawnPoints[a.team]) {
      if (!g.colliders.isBodyFree(p)) continue;
      const nearestEnemy = enemies.reduce((m, e) => Math.min(m, Vector3.Distance(e.position, p)), 999);
      const crowd = g.combat.actors.filter((o) => o !== a && o.alive && Vector3.Distance(o.position, p) < 1.5).length;
      const score = nearestEnemy - crowd * 30 + this.rng.range(0, 6);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const yaw = a.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    a.reset(100, SPAWN_SHIELD);
    a.ctrl.spawnAt(best.clone(), yaw);
    a.protectedUntil = g.combat.time + PROTECTION;
    const w = this.weaponsOf(a);
    if (first || !w.hasWeapon) {
      w.clear();
      const prim: WeaponId = a.isPlayer ? this.primary : this.rng.pick(['fuzil', 'fuzil', 'smg', 'escopeta', 'sniper'] as const);
      w.addWeapon(WEAPONS.pistola, 1);
      w.addWeapon(WEAPONS[prim], a.isPlayer ? 2 : this.rng.int(1, 3));
    } else {
      for (const s of w.slots) if (s) s.mag = s.def.magSize;
    }
    w.infiniteReserve = true;
    w.enabled = true;
    if (a.isPlayer) {
      g.camera.lookAlong(yaw);
      g.camera.snap();
    } else {
      this.bots.find((b) => b.actor === a)?.brain.resetBrain();
    }
  }

  onKill(e: KillEvent): void {
    const g = this.g;
    g.reportKill(e);
    const scoringTeam = e.killer && e.killer.team !== e.victim.team ? e.killer.team : 1 - e.victim.team;
    if (!this.ended) this.score[scoringTeam]++;
    this.respawns.push({ actor: e.victim, at: g.combat.time + RESPAWN_DELAY });
  }

  exit(): void {
    this.g.releaseBots();
    this.g.overlays.hideLoadout();
  }

  update(dt: number): void {
    const g = this.g;
    if (!this.started) {
      g.player.ctrl.model.animateLobby(dt);
      g.camera.updateFollow(dt, g.player.position, { height: 1.3, aiming: false, sprinting: false, centered: true, distanceOverride: 4.5, noCollision: true });
      return;
    }
    const blocked = g.overlays.blocking;

    if (!this.ended) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.finish();
    }

    g.updatePlayer(dt, !blocked && !this.ended);
    for (const b of this.bots) g.updateBot(b, dt, 'dm', null);

    // Regeneração fora de combate.
    for (const a of g.combat.alive) {
      if (g.combat.time - a.lastDamageAt > 5 && a.health < a.maxHealth) a.health = Math.min(a.maxHealth, a.health + 8 * dt);
    }

    // Renascimentos.
    for (const r of [...this.respawns]) {
      if (g.combat.time >= r.at && !this.ended) {
        this.respawns.splice(this.respawns.indexOf(r), 1);
        this.spawn(r.actor, false);
      }
    }

    g.followPlayerCamera(dt);

    const mine = this.respawns.find((r) => r.actor.isPlayer);
    g.hud.setRespawn(mine ? mine.at - g.combat.time : null);
    g.hud.setProtected(g.player.alive && g.player.isProtected(g.combat.time));
    g.hud.setTeamScore(this.score[0], this.score[1], this.timeLeft);
    const allies = g.combat.actors.filter((a) => a.alive && !a.isPlayer && a.team === 0).map((a) => ({ pos: a.position, color: TEAM_COLORS[0] }));
    g.updateMinimap(g.player.position, null, [], null, allies);
    g.updatePlates(true);
  }

  private finish(): void {
    const g = this.g;
    this.ended = true;
    const [blue, red] = this.score;
    const win = blue > red;
    const draw = blue === red;
    g.input.unlockPointer();
    g.overlays.showEnd(
      {
        win,
        title: draw ? 'EMPATE' : win ? 'VITÓRIA AZUL!' : 'VITÓRIA VERMELHA',
        subtitle: `Azul ${blue} x ${red} Vermelho`,
        stats: [
          ['SUAS ELIMINAÇÕES', String(g.player.kills)],
          ['MORTES', String(g.player.deaths)],
          ['K/D', (g.player.kills / Math.max(1, g.player.deaths)).toFixed(2)],
          ['MELHOR DA EQUIPE', this.bestOf(0)],
        ],
      },
      () => g.startMode('dm'),
      () => g.toLobby(),
    );
  }

  private bestOf(team: number): string {
    const list = this.g.combat.actors.filter((a) => a.team === team).sort((a, b) => b.kills - a.kills);
    return list[0] ? `${list[0].name} (${list[0].kills})` : '-';
  }
}
