import type { ModeId } from './Menu';
import { Rng } from '../utils/random';

/**
 * Ilustrações vetoriais dos cards de modo (estilo cartaz de battle royale).
 * Geradas por código, sem assets externos. `uid` deixa os ids de gradiente únicos
 * para a mesma arte poder aparecer duas vezes na página.
 */
export function modeArt(id: ModeId, uid: string): string {
  const body = id === 'br' ? brArt(uid) : id === 'dm' ? dmArt(uid) : trainingArt(uid);
  return `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

const HOUSE_COLORS = ['#ff5a4a', '#ffb21f', '#3a9cff', '#2bd46b', '#f07ab0', '#ffd21f', '#25c4ff', '#ff8a1f', '#b65cff'];
const INK = '#1b1420';

/** Fileira de casinhas empilhadas acompanhando uma encosta. */
function hillHouses(rng: Rng, x0: number, x1: number, baseY: (x: number) => number, size: number, opacity = 1): string {
  let out = '';
  for (let x = x0; x < x1; x += size * rng.range(0.85, 1.25)) {
    const w = size * rng.range(0.8, 1.2);
    const stories = 1 + Math.floor(rng.range(0, 2.4));
    const h = size * 0.7 * stories;
    const y = baseY(x + w / 2) - h + size * 0.15;
    const c = HOUSE_COLORS[Math.floor(rng.range(0, HOUSE_COLORS.length))];
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" stroke="${INK}" stroke-width="1.4" opacity="${opacity}"/>`;
    // Janelas acesas.
    for (let s = 0; s < stories; s++) {
      const wy = y + size * 0.18 + s * size * 0.7;
      out += `<rect x="${(x + w * 0.22).toFixed(1)}" y="${wy.toFixed(1)}" width="${(w * 0.22).toFixed(1)}" height="${(size * 0.26).toFixed(1)}" fill="#fff3a6" opacity="${opacity}"/>`;
      if (w > size * 0.95) out += `<rect x="${(x + w * 0.58).toFixed(1)}" y="${wy.toFixed(1)}" width="${(w * 0.2).toFixed(1)}" height="${(size * 0.26).toFixed(1)}" fill="${INK}" opacity="${0.55 * opacity}"/>`;
    }
    // Caixa d'água azul em algumas lajes.
    if (rng.next() < 0.3) out += `<rect x="${(x + w * 0.55).toFixed(1)}" y="${(y - size * 0.32).toFixed(1)}" width="${(size * 0.32).toFixed(1)}" height="${(size * 0.32).toFixed(1)}" rx="2" fill="#2457c5" stroke="${INK}" stroke-width="1" opacity="${opacity}"/>`;
  }
  return out;
}

function brArt(u: string): string {
  const rng = new Rng(7);
  const far = (x: number) => 150 - Math.sin((x / 400) * Math.PI) * 70;
  const near = (x: number) => 205 - Math.sin(((x + 60) / 520) * Math.PI) * 45;
  return `
  <defs>
    <linearGradient id="brSky${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a1d6b"/><stop offset="0.45" stop-color="#ff6b5c"/><stop offset="1" stop-color="#ffd36b"/>
    </linearGradient>
    <radialGradient id="brSun${u}"><stop offset="0" stop-color="#fff6c4"/><stop offset="0.6" stop-color="#ffd21f"/><stop offset="1" stop-color="#ffb21f" stop-opacity="0"/></radialGradient>
    <linearGradient id="brStorm${u}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7a2bd4" stop-opacity="0.85"/><stop offset="1" stop-color="#b65cff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="400" height="240" fill="url(#brSky${u})"/>
  <circle cx="300" cy="118" r="70" fill="url(#brSun${u})"/>
  <path d="M330 64 l4 0 l0 10 l12 0 l0 4 l-12 0 l0 22 l-4 0 l0 -22 l-12 0 l0 -4 l12 0 z" fill="${INK}" opacity="0.8"/>
  <path d="M0 ${far(0)} ${Array.from({ length: 21 }, (_, i) => `L${i * 20} ${far(i * 20).toFixed(1)}`).join(' ')} L400 240 L0 240 Z" fill="#1f7a4a" stroke="${INK}" stroke-width="2"/>
  ${hillHouses(rng, 20, 380, far, 17)}
  <path d="M0 ${near(0)} ${Array.from({ length: 21 }, (_, i) => `L${i * 20} ${near(i * 20).toFixed(1)}`).join(' ')} L400 240 L0 240 Z" fill="#14593a" stroke="${INK}" stroke-width="2"/>
  ${hillHouses(rng, -10, 410, near, 24)}
  <rect width="140" height="240" fill="url(#brStorm${u})"/>
  <path d="M120 0 Q 150 120 118 240" stroke="#e7c4ff" stroke-width="3" fill="none" opacity="0.8"/>
  <g transform="translate(60 26) rotate(-8)">
    <path d="M0 14 L70 8 Q80 8 82 13 Q80 18 70 18 L0 18 Z" fill="#f4f1ea" stroke="${INK}" stroke-width="2"/>
    <path d="M30 13 L48 -4 L56 -4 L44 13 Z M30 15 L48 32 L56 32 L44 15 Z" fill="#2bd46b" stroke="${INK}" stroke-width="2"/>
    <path d="M0 10 L-2 0 L8 0 L12 12 Z" fill="#2bd46b" stroke="${INK}" stroke-width="2"/>
  </g>
  <g transform="translate(205 40)">
    <path d="M-34 16 Q0 -22 34 16 Z" fill="#ffd21f" stroke="${INK}" stroke-width="2.5"/>
    <path d="M-12 -2 Q0 -12 12 -2 L8 14 L-8 14 Z" fill="#2bd46b" opacity="0.9"/>
    <path d="M-32 16 L-3 46 M32 16 L3 46 M-12 15 L-2 46 M12 15 L2 46" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="0" cy="49" r="4.5" fill="#c98a5b" stroke="${INK}" stroke-width="1.5"/>
    <path d="M-5 53 L5 53 L6 66 L-6 66 Z" fill="#ffd21f" stroke="${INK}" stroke-width="1.5"/>
    <path d="M-6 66 L-9 76 M6 66 L9 76" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function soldier(x: number, y: number, flip: boolean, color: string): string {
  const s = flip ? -1 : 1;
  return `<g transform="translate(${x} ${y}) scale(${s} 1)">
    <path d="M-16 92 L-10 40 L12 40 L18 92 Z" fill="${INK}"/>
    <path d="M-14 46 L14 46 L16 74 L-16 74 Z" fill="${color}" stroke="${INK}" stroke-width="3"/>
    <circle cx="0" cy="24" r="15" fill="#c98a5b" stroke="${INK}" stroke-width="3"/>
    <path d="M-16 20 Q0 2 16 20 L16 14 Q0 -2 -16 14 Z" fill="${INK}"/>
    <rect x="6" y="50" width="70" height="9" rx="2" fill="#2d3340" stroke="${INK}" stroke-width="2.5"/>
    <rect x="22" y="58" width="9" height="16" rx="1.5" fill="#2d3340" stroke="${INK}" stroke-width="2"/>
    <path d="M-8 54 Q10 66 26 56" stroke="#c98a5b" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M-8 54 Q10 66 26 56" stroke="${INK}" stroke-width="2" fill="none" opacity="0.6"/>
  </g>`;
}

function dmArt(u: string): string {
  return `
  <defs>
    <linearGradient id="dmBlue${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a9cff"/><stop offset="1" stop-color="#1235a0"/></linearGradient>
    <linearGradient id="dmRed${u}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b4a"/><stop offset="1" stop-color="#a0101a"/></linearGradient>
    <radialGradient id="dmFlash${u}"><stop offset="0" stop-color="#fff6c4"/><stop offset="1" stop-color="#ffd21f" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="400" height="240" fill="url(#dmBlue${u})"/>
  <path d="M230 0 L400 0 L400 240 L170 240 Z" fill="url(#dmRed${u})"/>
  <g opacity="0.25" fill="${INK}">
    <rect x="0" y="150" width="60" height="90"/><rect x="58" y="128" width="46" height="112"/><rect x="104" y="160" width="40" height="80"/>
    <rect x="262" y="140" width="50" height="100"/><rect x="310" y="120" width="44" height="120"/><rect x="352" y="156" width="48" height="84"/>
  </g>
  <path d="M230 0 L170 240" stroke="#fff" stroke-width="10"/>
  <path d="M230 0 L170 240" stroke="${INK}" stroke-width="3"/>
  ${soldier(92, 70, false, '#3a9cff')}
  ${soldier(308, 70, true, '#ff4b3a')}
  <circle cx="200" cy="100" r="46" fill="url(#dmFlash${u})"/>
  <path d="M206 52 L180 106 L200 106 L190 150 L224 88 L204 88 L216 52 Z" fill="#ffd21f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <text x="200" y="36" text-anchor="middle" font-family="Impact, 'Arial Black', sans-serif" font-size="34" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">5 V 5</text>`;
}

function target(x: number, y: number, r: number): string {
  const rings = [1, 0.78, 0.56, 0.34, 0.14];
  return rings
    .map((k, i) => `<circle cx="${x}" cy="${y}" r="${(r * k).toFixed(1)}" fill="${i % 2 === 0 ? '#e8322b' : '#f4f1ea'}" stroke="${INK}" stroke-width="${i === 0 ? 3 : 1.2}"/>`)
    .join('');
}

function trainingArt(u: string): string {
  const trusses = Array.from({ length: 9 }, (_, i) => `<path d="M${i * 50} 0 L${200 + (i * 50 - 200) * 0.35} 40" stroke="#5b5f6b" stroke-width="3"/>`).join('');
  return `
  <defs>
    <linearGradient id="trWall${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4150"/><stop offset="1" stop-color="#22262f"/></linearGradient>
    <linearGradient id="trBeam${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a6" stop-opacity="0.55"/><stop offset="1" stop-color="#fff3a6" stop-opacity="0"/></linearGradient>
    <linearGradient id="trFloor${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b6f78"/><stop offset="1" stop-color="#3a3d44"/></linearGradient>
  </defs>
  <rect width="400" height="240" fill="url(#trWall${u})"/>
  ${trusses}
  <path d="M0 40 L400 40" stroke="#5b5f6b" stroke-width="4"/>
  <path d="M120 0 L170 0 L230 240 L60 240 Z" fill="url(#trBeam${u})"/>
  <path d="M250 0 L290 0 L360 240 L210 240 Z" fill="url(#trBeam${u})" opacity="0.7"/>
  <rect x="0" y="40" width="400" height="18" fill="#2bd46b" opacity="0.9"/>
  <text x="200" y="54" text-anchor="middle" font-family="Impact, 'Arial Black', sans-serif" font-size="14" fill="${INK}" letter-spacing="3">GALPÃO DA QUEBRADA</text>
  <path d="M0 180 L400 180 L400 240 L0 240 Z" fill="url(#trFloor${u})"/>
  <path d="M0 180 L400 180" stroke="#ffd21f" stroke-width="4" stroke-dasharray="18 10"/>
  <rect x="70" y="142" width="4" height="40" fill="${INK}"/>${target(72, 136, 18)}
  <rect x="320" y="146" width="4" height="36" fill="${INK}"/>${target(322, 140, 15)}
  <rect x="196" y="150" width="8" height="32" fill="${INK}"/>${target(200, 122, 44)}
  <circle cx="190" cy="112" r="3.5" fill="${INK}"/><circle cx="207" cy="128" r="3.5" fill="${INK}"/><circle cx="199" cy="120" r="3.5" fill="${INK}"/>
  <g stroke="#fff" stroke-width="3" fill="none" opacity="0.95">
    <circle cx="200" cy="122" r="56"/>
    <path d="M200 62 L200 92 M200 152 L200 182 M134 122 L170 122 M230 122 L266 122"/>
  </g>
  <rect x="0" y="200" width="400" height="40" fill="#8a5a2b" stroke="${INK}" stroke-width="3"/>
  <rect x="40" y="190" width="70" height="12" rx="2" fill="#2d3340" stroke="${INK}" stroke-width="2"/>
  <rect x="290" y="192" width="54" height="10" rx="2" fill="#2d3340" stroke="${INK}" stroke-width="2"/>`;
}
