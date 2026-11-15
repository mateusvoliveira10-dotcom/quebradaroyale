import { defineConfig } from 'vite';
// @ts-expect-error -- plugin em JS puro (o projeto não usa os tipos do Node)
import exportarRoblox from './tools/vite-exportar-roblox.js';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer subpasta (ex.: GitHub Pages em
  // usuario.github.io/<repositorio>/) e também aberto por um servidor local.
  base: './',
  // Grava os arquivos do exportador do mapa para o Roblox (só no servidor de desenvolvimento).
  plugins: [exportarRoblox()],
  server: {
    port: 5173,
    host: true,
    // Arquivos-fonte de arte são grandes e mudam por ferramentas externas: não vigiar.
    watch: { ignored: ['**/art/**', '**/backups/**', '**/exportar-roblox/**'] },
  },
  build: {
    target: 'es2020',
    // Babylon.js é grande; evita o aviso de chunk em todo build.
    chunkSizeWarningLimit: 8000,
  },
});
