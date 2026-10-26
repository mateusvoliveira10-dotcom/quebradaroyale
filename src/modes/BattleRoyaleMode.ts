import { Terrain } from '../world/Terrain';
import { Vector3 } from '@babylonjs/core';
import { KillEvent } from '../combat/CombatManager';
import type { BotEntry, Game } from '../core/Game';
import { DROP } from '../core/config';
import { DropFx, DropPoi } from '../match/DropFx';
import type { RiderPhase } from '../match/DropSequence';
import { SafeZone } from '../match/SafeZone';
import { clamp, Rng } from '../utils/random';
import { GameMode } from './GameMode';

/** Duração (s) da abertura cinematográfica em volta do avião. */
const INTRO_TIME = 5;

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Quantos bots entram no Battle Royale: 49 + o jogador = 50 participantes. */
export const BR_BOTS = 49;

/**
 * Battle Royale: entrada SEMPRE pelo avião, sem respawn. Bots saltam em
 * momentos diferentes, procuram armas antes de lutar e fogem da zona.
 * O último vivo vence.
 */
export class BattleRoyaleMode implements GameMode {
  readonly kind = 'br' as const;
  readonly zone: SafeZone;
  private bots: BotEntry[] = [];
  private rng = new Rng(Date.now() & 0xffff);
  private ended = false;
  private endTimer = -1;
  private zoneTick = 0;
  private matchTime = 0;
  private placement = 0;
  private introT = 0;
  private readonly fx: DropFx;
  private lastPhase: RiderPhase = 'plane';
  /** "Soco" de FOV na abertura do paraquedas (volta a 0 sozinho). */
  private fovKick = 0;
  restart = () => this.g.startMode('br');
  changeDifficulty = null;

  constructor(private readonly g: Game) {
    this.zone = new SafeZone(g.scene, this.rng, g.map.half);
    this.fx = new DropFx(g.scene);
    this.fx.setPois(this.pois());
  }

  /** Pontos de interesse lidos do mapa, para as placas vistas do alto. */
  private pois(): DropPoi[] {
    const out: DropPoi[] = [];
    const center = (f: { x0: number; x1: number; z0: number; z1: number }) => new Vector3((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    for (const f of this.g.map.features) {
      const c = center(f);
      if (f.kind === 'shop') {
        const name = c.x > 0 && c.z > 0 ? 'BOTECO' : c.x < 0 && c.z > 0 ? 'MERCADINHO' : c.x < 0 && c.z < 0 ? 'OFICINA' : 'COMÉRCIO';
        out.push({ name, pos: c, color: '#ff8a1f' });
      } else if (f.kind === 'field') {
        out.push({ name: 'CAMPINHO', pos: c, color: '#2bd46b' });
      } else if (f.kind === 'poi' && f.name) {
        // Áreas com nome da ilha: placa vista do avião, como no Fortnite.
        out.push({ name: f.name, pos: c.add(new Vector3(0, (Terrain.current?.height(c.x, c.z) ?? 0) + 12, 0)), color: '#ffd21f' });
      } else if (f.kind === 'mata') {
        out.push({ name: 'MATA', pos: c, color: '#7bd44b' });
      }
    }
    // O último platô do morro é o cume com a estátua.
    const summit = [...this.g.map.features].reverse().find((f) => f.kind === 'terrace');
    if (summit) out.push({ name: 'MIRANTE DA PAZ', pos: center(summit).add(new Vector3(0, 20, 0)), color: '#25c4ff' });
    return out;
  }

  focus(): Vector3 {
    return this.g.drop.phaseOf(this.g.player) === 'plane' ? this.g.drop.planePosition : this.g.player.position;
  }

  enter(): void {
    const g = this.g;
    this.rng = new Rng((Date.now() ^ 0x5eed) & 0xffffff);
    this.ended = false;
    this.endTimer = -1;
    this.matchTime = 0;
    this.zoneTick = 0;
    this.introT = 0;
    this.lastPhase = 'plane';
    this.fovKick = 0;

    g.hud.show(true);
    g.hud.configure('br');
    g.hud.setPhase('NO AVIÃO', 'air');
    g.input.captureOnClick = true;

    g.loot.clear();
    g.loot.populate(g.map.lootSpots, this.rng.int(1, 1e9));

    // Participantes: jogador + bots (cada um é sua própria "equipe").
    g.combat.clear();
    // Sifão: quem elimina recupera 50 (vida e, passando de 100, escudo).
    g.combat.siphon = 50;
    g.player.team = 0;
    g.player.kills = 0;
    g.player.reset();
    g.playerWeapons.clear();
    g.playerWeapons.enabled = true;
    g.playerWeapons.infiniteReserve = false;
    g.combat.add(g.player);

    this.bots = g.acquireBots(BR_BOTS);
    // Destinos pela ilha inteira (comunidade e áreas com nome do anel externo), como os
    // bots do Fortnite: antes todos caíam no centro e se matavam no primeiro minuto.
    const spots = g.map.lootSpots.filter((s) => s.pos.y < 45).sort(() => this.rng.next() - 0.5);
    this.bots.forEach((b, i) => {
      b.actor.team = i + 1;
      b.actor.kills = 0;
      b.actor.reset();
      b.weapons.clear();
      b.weapons.enabled = true;
      b.weapons.infiniteReserve = false;
      // Visual fixo de cada bot (sorteado na tela de carregamento): refazer 49 visuais a cada
      // partida atrasava a entrada em uns 2 segundos. Só refaz se o Deathmatch trocou a camisa.
      if (JSON.stringify(b.actor.ctrl.model.currentAppearance) !== JSON.stringify(b.look)) b.actor.ctrl.model.setAppearance(b.look);
      b.brain.resetBrain();
      // Cada bot mira uma região diferente para pousar.
      const target = spots[(i * 7) % spots.length];
      b.brain.dropTarget = target.pos.clone();
      b.brain.chuteHeight = this.rng.range(40, 70);
      g.combat.add(b.actor);
    });

    g.drop.begin(
      [g.player, ...this.bots.map((b) => b.actor)],
      // Salta no trecho do voo mais perto do destino (o avião já está no começo da rota).
      (a) => {
        const t = this.bots.find((b) => b.actor === a)?.brain.dropTarget;
        if (!t) return this.rng.range(0.28, 0.62);
        const start = g.drop.planePosition;
        const dir = g.drop.planeDirection;
        const along = (t.x - start.x) * dir.x + (t.z - start.z) * dir.z;
        return Math.min(0.92, Math.max(0.06, along / (DROP.planeStartDistance * 2) - 0.04 + this.rng.range(-0.03, 0.03)));
      },
      (a) => this.bots.find((b) => b.actor === a)?.brain.chuteHeight ?? 50,
    );
    this.zone.start();
    g.hud.setAlive(g.combat.alive.length);
    g.hud.toast('O avião está cruzando a quebrada. Escolha onde cair!');
    g.camera.snap();
  }

  exit(): void {
    this.fx.stop();
    this.g.drop.end();
    this.zone.stop();
    this.g.loot.clear();
    this.g.releaseBots();
  }

  onKill(e: KillEvent): void {
    const g = this.g;
    g.reportKill(e);
    if (!e.victim.isPlayer) {
      const bot = this.bots.find((b) => b.actor === e.victim);
      if (bot) g.loot.dropInventory(e.victim.position.clone(), bot.weapons.clear(), { ...bot.weapons.ammo });
    }
    const alive = g.combat.alive.length;
    g.hud.setAlive(alive);
    if (e.victim.isPlayer) {
      this.placement = alive + 1;
      this.finish(false);
    } else if (alive === 1 && g.player.alive) {
      this.placement = 1;
      this.finish(true);
    }
  }

  private finish(win: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.endTimer = win ? 1.2 : 2.5;
    this.g.hud.setPhase(win ? 'VITÓRIA!' : 'ELIMINADO', win ? 'normal' : 'danger');
  }

  update(dt: number): void {
    const g = this.g;
    const input = g.input;
    const blocked = g.overlays.blocking;
    const playerPhase = g.drop.phaseOf(g.player);
    if (playerPhase === 'landed' && !this.ended) this.matchTime += dt;

    // Avião / salto / paraquedas.
    const space = !blocked && input.wasPressed('Space');
    g.drop.update(dt, space && playerPhase === 'plane', space && playerPhase === 'freefall');

    // Atores.
    g.updatePlayer(dt, !blocked);
    for (const b of this.bots) g.updateBot(b, dt, 'br', this.zone);

    // Zona.
    if (!this.ended) {
      this.zone.update(dt);
      this.zoneTick -= dt;
      if (this.zoneTick <= 0) {
        this.zoneTick = 1;
        for (const a of g.combat.alive) {
          if (a.ctrl.mode === 'plane' || this.zone.isSafe(a.position)) continue;
          g.combat.applyDamage(a, this.zone.damagePerSecond, null, 'Zona');
        }
      }
    }

    // Câmera.
    if (playerPhase === 'plane') {
      // Abertura cinematográfica: nos primeiros segundos a câmera passeia em volta do avião
      // (de perto, pela lateral, perto do nariz) até ficar atrás e acima dele, onde o mouse
      // assume. Depois disso, só segue (o jogador olha o mapa para escolher onde saltar).
      this.introT += dt;
      let dist = 34;
      if (this.introT < INTRO_TIME) {
        const k = smooth(this.introT / INTRO_TIME);
        const d = g.drop.planeDirection;
        const behind = Math.atan2(-d.z, -d.x);
        g.camera.camera.alpha = behind + (1 - k) * 2.1;
        g.camera.camera.beta = 1.42 - 0.2 * k;
        dist = 18 + 16 * k;
      }
      g.camera.updateFollow(dt, g.drop.planePosition, { height: 2, aiming: false, sprinting: false, distanceOverride: dist, centered: true, noCollision: true });
    } else if (playerPhase === 'freefall' || playerPhase === 'parachute') {
      // Queda livre: quanto mais rápido, mais longe a câmera, mais aberto o campo de visão e
      // mais o vento sacode (sensação de velocidade). Paraquedas: recua e abre a visão para
      // ler o mapa e escolher o pouso.
      const ff = playerPhase === 'freefall';
      const speedK = clamp((-g.player.ctrl.velocity.y - 15) / 33, 0, 1);
      if (ff && speedK > 0.2) g.camera.shake(dt * 0.18 * speedK * speedK);
      this.fovKick += (0 - this.fovKick) * Math.min(1, dt * 2.5);
      const fov = (ff ? 0.98 + speedK * 0.24 : 1.02) + this.fovKick;
      g.camera.updateFollow(dt, g.player.position, {
        height: ff ? 1.0 : 1.6,
        aiming: false,
        sprinting: false,
        distanceOverride: ff ? 8.5 + speedK * 2.5 : 11.5,
        centered: true,
        noCollision: true,
        fovOverride: fov,
      });
    } else {
      g.followPlayerCamera(dt);
    }

    // Efeitos da entrada e transições de fase do jogador.
    if (playerPhase !== this.lastPhase) {
      if (playerPhase === 'parachute') {
        // Tranco da abertura: a câmera "puxa" o FOV e sacode.
        this.fovKick = -0.22;
        g.camera.shake(0.12);
      } else if (playerPhase === 'landed' && this.lastPhase !== 'plane') {
        this.fx.landed(g.player.position);
      }
      this.lastPhase = playerPhase;
    }
    const h = playerPhase === 'plane' ? 999 : g.drop.heightOf(g.player);
    this.fx.update(dt, playerPhase, g.player.position, g.player.ctrl.velocity, h);
    if (playerPhase === 'landed') this.fx.stopAir();

    this.updateHud(playerPhase);

    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.endTimer > -50) {
        this.endTimer = -99;
        this.showEnd();
      }
    }
  }

  private updateHud(phase: string): void {
    const g = this.g;
    if (!this.ended) {
      if (phase === 'plane') {
        g.hud.setPhase('NO AVIÃO', 'air');
        const can = g.drop.overMap;
        g.hud.setDrop({
          title: can ? 'SALTE QUANDO QUISER' : 'AGUARDE O AVIÃO CHEGAR',
          hint: can ? '<kbd>Espaço</kbd> saltar do avião · salto automático no fim da rota' : 'Mexa o mouse para olhar o mapa',
          bar: 1 - g.drop.routeProgress,
        });
      } else if (phase === 'freefall') {
        g.hud.setPhase('QUEDA LIVRE', 'air');
        const h = g.drop.heightOf(g.player);
        g.hud.setDrop({
          title: `${Math.round(h)} m`,
          hint: h < DROP.manualOpenHeight ? '<kbd>Espaço</kbd> abrir paraquedas · <kbd>WASD</kbd> direcionar · olhe para baixo + <kbd>W</kbd> mergulha' : '<kbd>WASD</kbd> direcionar · olhe para baixo + <kbd>W</kbd> mergulha',
          bar: Math.min(1, h / DROP.planeAltitude),
        });
      } else if (phase === 'parachute') {
        g.hud.setPhase('PARAQUEDAS', 'air');
        const h = g.drop.heightOf(g.player);
        g.hud.setDrop({ title: `${Math.round(h)} m`, hint: '<kbd>WASD</kbd> guiar o paraquedas', bar: Math.min(1, h / DROP.planeAltitude) });
      } else {
        g.hud.setDrop(null);
        g.hud.setPhase('BATTLE ROYALE');
      }
    }
    g.hud.setTimer(this.matchTime);

    const z = this.zone;
    const outside = g.player.alive && phase === 'landed' && !z.isSafe(g.player.position);
    const t = Math.ceil(z.timer);
    const text = z.finished ? 'ZONA FINAL' : z.state === 'wait' ? `ZONA FECHA EM ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `ZONA FECHANDO · ${t}s`;
    g.hud.setZone(outside ? `VOCÊ ESTÁ FORA DA ZONA! ${text}` : text, outside);

    const plane = g.drop.plane.root.isEnabled() ? { pos: g.drop.planePosition, dir: g.drop.plane.root.rotation.y } : null;
    g.updateMinimap(this.focus(), plane, phase === 'landed' ? g.loot.weaponPositions() : [], { center: z.center, radius: z.radius, next: z.targetCenter, nextRadius: z.targetRadius }, [], phase !== 'landed');
    g.updatePlates(false);
  }

  private showEnd(): void {
    const g = this.g;
    const win = this.placement === 1;
    g.input.unlockPointer();
    g.overlays.showEnd(
      {
        win,
        title: win ? 'VITÓRIA NA QUEBRADA!' : 'ELIMINADO',
        subtitle: win ? 'Você foi o último sobrevivente.' : `Você terminou em #${this.placement} de ${BR_BOTS + 1}.`,
        stats: [
          ['COLOCAÇÃO', `#${this.placement}`],
          ['ELIMINAÇÕES', String(g.player.kills)],
          ['TEMPO', `${Math.floor(this.matchTime / 60)}:${String(Math.floor(this.matchTime % 60)).padStart(2, '0')}`],
        ],
      },
      () => g.startMode('br'),
      () => g.toLobby(),
    );
  }
}
