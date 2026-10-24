import './style.css';
import { Game } from './core/Game';
import { music } from './core/Music';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #game-canvas não encontrado');
}

// Música tema desde a abertura (se o navegador bloquear, começa no primeiro clique/tecla).
music.play();

// Deixa a tela de carregamento aparecer antes da construção pesada do mundo.
setTimeout(async () => {
  try {
    const t0 = performance.now();
    const game = await Game.create(canvas);
    console.info(`[QUEBRADA] Jogo pronto em ${Math.round(performance.now() - t0)} ms (personagem e shaders incluídos)`);
    game.start();
    document.getElementById('loading')?.classList.add('hidden');
    // Facilita depuração pelo console do navegador.
    (window as unknown as { game: Game }).game = game;
  } catch (err) {
    console.error(err);
    const t = document.getElementById('loading-text');
    if (t) t.textContent = `Erro ao carregar: ${(err as Error).message}`;
  }
}, 50);
