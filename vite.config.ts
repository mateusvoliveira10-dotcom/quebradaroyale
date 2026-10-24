import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer subpasta (ex.: GitHub Pages em
  // usuario.github.io/<repositorio>/) e também aberto por um servidor local.
  base: './',
  server: {
    port: 5173,
    host: true,
    // Arquivos-fonte de arte são grandes e mudam por ferramentas externas: não vigiar.
    watch: { ignored: ['**/art/**', '**/backups/**'] },
  },
  build: {
    target: 'es2020',
    // Babylon.js é grande; evita o aviso de chunk em todo build.
    chunkSizeWarningLimit: 8000,
  },
});
