// Junta os scripts do Roblox (pasta roblox/) e os dados do mapa exportado
// (exportar-roblox/roblox/Dados) num arquivo só, QUEBRADA_ROYALE.rbxmx, que o Studio aceita
// arrastando para a janela. Dentro: o ModuleScript INSTALAR_QUEBRADA com todos os scripts
// como filhos (desligados até o instalador pôr cada um no lugar).
//
// node tools/roblox_pacote.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let ref = 0;

const cdata = (s) => `<![CDATA[${s.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function item(cls, name, source, children = [], disabled = false) {
  const props = [`<string name="Name">${esc(name)}</string>`];
  if (source !== null) props.push(`<ProtectedString name="Source">${cdata(source)}</ProtectedString>`);
  if (cls === 'Script' || cls === 'LocalScript') props.push(`<bool name="Disabled">${disabled}</bool>`);
  return `<Item class="${cls}" referent="RBX${ref++}"><Properties>${props.join('')}</Properties>${children.join('')}</Item>`;
}

const dadosDir = path.join(root, 'exportar-roblox', 'roblox', 'Dados');
const dados = fs.existsSync(dadosDir)
  ? fs.readdirSync(dadosDir).filter((f) => f.endsWith('.lua')).sort().map((f) => item('ModuleScript', f.replace(/\.lua$/, ''), fs.readFileSync(path.join(dadosDir, f), 'utf8')))
  : [];
if (!dados.length) console.warn('Aviso: sem dados do mapa (rode o exportador antes).');

const children = [
  item('ModuleScript', 'Config', read('roblox/ReplicatedStorage/Config.lua')),
  item('Script', 'Jogadores', read('roblox/ServerScriptService/Jogadores.server.lua'), [], true),
  item('Script', 'MontarMapa', read('roblox/ServerScriptService/MontarMapa.server.lua'), [], true),
  item('LocalScript', 'Controles', read('roblox/StarterPlayerScripts/Controles.client.lua'), [], true),
  item('ModuleScript', 'CriarAgua', read('roblox/ServerStorage/CriarAgua.lua')),
  item('Folder', 'Dados', null, dados),
];
const xml =
  '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">' +
  item('ModuleScript', 'INSTALAR_QUEBRADA', read('roblox/Instalar.lua'), children) +
  '</roblox>';
const out = path.join(root, 'exportar-roblox', 'roblox', 'QUEBRADA_ROYALE.rbxmx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, xml);
console.log(`ok: ${out} (${(xml.length / 1e6).toFixed(2)} MB, ${dados.length} módulos de dados)`);
