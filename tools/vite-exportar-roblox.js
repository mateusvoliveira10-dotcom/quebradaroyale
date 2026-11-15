// Plugin do Vite (só no servidor de desenvolvimento): recebe os arquivos do exportador do
// mapa para o Roblox (src/tools/RobloxExport.ts) e grava em `exportar-roblox/`.
import fs from 'node:fs';
import path from 'node:path';

export default function exportarRoblox() {
  return {
    name: 'exportar-roblox',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__exportar', (req, res) => {
        const name = path.basename(new URL(req.url ?? '', 'http://x').searchParams.get('arquivo') ?? '');
        if (req.method !== 'POST' || !/^[\w.-]+$/.test(name)) {
          res.statusCode = 400;
          res.end('nome inválido');
          return;
        }
        const dir = path.resolve('exportar-roblox');
        fs.mkdirSync(dir, { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}
