import { ALL_PLACES } from '../world/Places';
import { Vector3 } from '@babylonjs/core';
import { FeatureKind, MapFeature } from '../world/CommunityMap';

const COLORS: Record<FeatureKind, string> = {
  road: '#3d3f45',
  sidewalk: '#9c968a',
  beco: '#b3ad9f',
  field: '#c98a56',
  poi: 'rgba(0,0,0,0)',
  mata: '#2f5a2a',
  terrace: '#8f8576',
  house: '#d98b5f',
  shop: '#ffd21f',
};

const ORDER: FeatureKind[] = ['terrace', 'mata', 'road', 'sidewalk', 'beco', 'field', 'house', 'shop'];

/** Largura (m) da área mostrada em volta do jogador no chão. */
const VIEW_GROUND = 110;

/**
 * Minimapa (norte para cima). O fundo é o próprio mapa visto de cima, renderizado pelo
 * jogo na abertura (Snapshots.renderMapTopDown); antes disso, um esboço com as áreas do
 * mapa. No chão mostra ~110 m em volta do jogador; no avião e na queda, o mapa inteiro,
 * para escolher onde cair. Zona, próxima zona, avião, aliados e armas por cima.
 */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  /** Imagem do mapa inteiro e a meia-largura (m) que ela cobre. */
  private bg: CanvasImageSource;
  private bgHalf: number;
  private bgSize: number;
  private timer = 0;
  private readonly px: number;
  /** Janela atual (m): centro e largura. */
  private cx = 0;
  private cz = 0;
  private span = VIEW_GROUND;

  constructor(
    features: MapFeature[],
    private readonly half: number,
  ) {
    // Canvas na resolução da tela (nítido em telas de alta densidade).
    const css = this.canvas.clientWidth || 210;
    this.px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = this.px;
    this.canvas.height = this.px;
    // Esboço provisório (até a foto de cima ficar pronta).
    const size = 512;
    const sketch = document.createElement('canvas');
    sketch.width = sketch.height = size;
    const b = sketch.getContext('2d') as CanvasRenderingContext2D;
    const toS = (x: number, z: number): [number, number] => [((x + half) / (2 * half)) * size, ((half - z) / (2 * half)) * size];
    b.fillStyle = '#a98a62';
    b.fillRect(0, 0, size, size);
    for (const kind of ORDER) {
      b.fillStyle = COLORS[kind];
      for (const f of features) {
        if (f.kind !== kind) continue;
        const [x0, y0] = toS(f.x0, f.z1);
        const [x1, y1] = toS(f.x1, f.z0);
        b.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
    }
    this.bg = sketch;
    this.bgHalf = half;
    this.bgSize = size;
  }

  /** Fundo definitivo: o mapa visto de cima (data URL), cobrindo [-half, half]. */
  setBackground(url: string, half: number): void {
    const img = new Image();
    img.onload = () => {
      // A foto fora da tela sai sem o tone mapping/exposição da tela (fica escura e
      // apagada): corrige uma vez aqui.
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const c = cv.getContext('2d') as CanvasRenderingContext2D;
      c.filter = 'brightness(1.7) saturate(1.3) contrast(1.08)';
      c.drawImage(img, 0, 0);
      this.bg = cv;
      this.bgHalf = half;
      this.bgSize = img.naturalWidth;
    };
    img.src = url;
  }

  /** Mundo (x, z) → pixel do canvas, na janela atual. */
  private toMap(x: number, z: number): [number, number] {
    const k = this.px / this.span;
    return [(x - this.cx) * k + this.px / 2, (this.cz - z) * k + this.px / 2];
  }

  update(
    dt: number,
    player: Vector3,
    headingRad: number,
    plane: { pos: Vector3; dir: number } | null,
    loot: Array<{ pos: Vector3; color: string }>,
    zone: { center: Vector3; radius: number; next: Vector3; nextRadius: number } | null = null,
    dots: Array<{ pos: Vector3; color: string }> = [],
    wide = false,
  ): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    const c = this.ctx;
    const P = this.px;

    // Janela: mapa inteiro (no ar) ou em volta do jogador, sem passar da borda do mapa.
    const goalSpan = wide ? this.half * 2 + 12 : VIEW_GROUND;
    this.span += (goalSpan - this.span) * 0.25;
    const lim = Math.max(0, this.half + 6 - this.span / 2);
    const gx = wide ? 0 : Math.max(-lim, Math.min(lim, player.x));
    const gz = wide ? 0 : Math.max(-lim, Math.min(lim, player.z));
    this.cx += (gx - this.cx) * 0.35;
    this.cz += (gz - this.cz) * 0.35;

    // Fundo: recorte da imagem do mapa inteiro.
    c.fillStyle = '#3f5a33';
    c.fillRect(0, 0, P, P);
    const s = this.bgSize / (2 * this.bgHalf);
    const sx = (this.cx - this.span / 2 + this.bgHalf) * s;
    const sy = (this.bgHalf - (this.cz + this.span / 2)) * s;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.bg, sx, sy, this.span * s, this.span * s, 0, 0, P, P);
    // leve vinheta para os ícones se destacarem
    const vg = c.createRadialGradient(P / 2, P / 2, P * 0.3, P / 2, P / 2, P * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = vg;
    c.fillRect(0, 0, P, P);
    const k = P / this.span;
    const u = P / 210; // unidade de desenho (ícones do mesmo tamanho em qualquer resolução)

    // Armas próximas.
    for (const l of loot) {
      if (Vector3.Distance(l.pos, player) > 45) continue;
      const [x, y] = this.toMap(l.pos.x, l.pos.z);
      c.fillStyle = l.color;
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = u;
      c.beginPath();
      c.arc(x, y, 2.2 * u, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    if (zone) {
      const [zx, zy] = this.toMap(zone.center.x, zone.center.z);
      c.save();
      // tempestade fora da zona
      c.fillStyle = 'rgba(120,50,210,0.42)';
      c.beginPath();
      c.rect(0, 0, P, P);
      c.arc(zx, zy, Math.max(0, zone.radius * k), 0, Math.PI * 2, true);
      c.fill('evenodd');
      c.strokeStyle = '#d6b8ff';
      c.lineWidth = 2 * u;
      c.beginPath();
      c.arc(zx, zy, Math.max(0, zone.radius * k), 0, Math.PI * 2);
      c.stroke();
      const [nx, ny] = this.toMap(zone.next.x, zone.next.z);
      c.strokeStyle = '#ffffff';
      c.setLineDash([5 * u, 4 * u]);
      c.lineWidth = 1.5 * u;
      c.beginPath();
      c.arc(nx, ny, Math.max(0, zone.nextRadius * k), 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    // Nomes das áreas (no mapa inteiro, todos; perto, só os que cabem na janela).
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${Math.round((wide ? 6.2 : 7.5) * u)}px "Arial Black", Impact, sans-serif`;
    for (const pl of ALL_PLACES) {
      const [x, y] = this.toMap(pl.x, pl.z);
      if (x < -20 || y < -20 || x > P + 20 || y > P + 20) continue;
      c.lineWidth = 2.6 * u;
      c.strokeStyle = 'rgba(20,14,24,0.85)';
      c.strokeText(pl.name, x, y);
      c.fillStyle = '#ffffff';
      c.fillText(pl.name, x, y);
    }
    c.restore();

    for (const d of dots) {
      const [x, y] = this.toMap(d.pos.x, d.pos.z);
      c.fillStyle = d.color;
      c.strokeStyle = '#1b1420';
      c.lineWidth = 1.2 * u;
      c.beginPath();
      c.arc(x, y, 3.4 * u, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    if (plane) {
      const [x, y] = this.toMap(plane.pos.x, plane.pos.z);
      // rota do avião
      c.save();
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.setLineDash([4 * u, 4 * u]);
      c.lineWidth = 1.5 * u;
      c.beginPath();
      c.moveTo(x - Math.sin(plane.dir) * P * 2, y + Math.cos(plane.dir) * P * 2);
      c.lineTo(x + Math.sin(plane.dir) * P * 2, y - Math.cos(plane.dir) * P * 2);
      c.stroke();
      c.restore();
      c.save();
      c.translate(x, y);
      c.rotate(plane.dir);
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#1b1420';
      c.lineWidth = 1.2 * u;
      c.beginPath();
      c.moveTo(0, -8 * u);
      c.lineTo(7 * u, 5 * u);
      c.lineTo(0, 2 * u);
      c.lineTo(-7 * u, 5 * u);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }

    // Jogador: seta amarela com cone de visão.
    const [px, py] = this.toMap(player.x, player.z);
    c.save();
    c.translate(px, py);
    c.rotate(headingRad);
    const cone = c.createRadialGradient(0, 0, 0, 0, 0, 34 * u);
    cone.addColorStop(0, 'rgba(255,240,170,0.35)');
    cone.addColorStop(1, 'rgba(255,240,170,0)');
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, 34 * u, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffd21f';
    c.strokeStyle = '#1b1420';
    c.lineWidth = 1.6 * u;
    c.beginPath();
    c.moveTo(0, -8 * u);
    c.lineTo(6 * u, 6 * u);
    c.lineTo(0, 3 * u);
    c.lineTo(-6 * u, 6 * u);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // Norte.
    c.font = `900 ${11 * u}px 'Segoe UI', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(15,12,20,0.7)';
    c.beginPath();
    c.arc(P / 2, 11 * u, 8 * u, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffd21f';
    c.fillText('N', P / 2, 11.5 * u);
  }
}
