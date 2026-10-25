import { Material, Mesh, MeshBuilder, Scene, Vector3, Vector4, VertexBuffer } from '@babylonjs/core';
import { Materials } from './Materials';
import { HQ_TILE, OLD_MAP } from './MaterialsHQ';
import { BatchOptions, StaticBatcher } from './StaticBatcher';
import type { WorldModel } from './WorldAssets';

export interface BoxOptions {
  w: number;
  h: number;
  d: number;
  x: number;
  z: number;
  /** Base da caixa (y do fundo). Ignorado se `cy` for informado. */
  y?: number;
  /** Centro vertical da caixa. */
  cy?: number;
  mat?: Material;
  /** Tamanho (m) de uma repetição da textura na horizontal. */
  tile?: number;
  /** Tamanho (m) de uma repetição da textura na vertical (padrão = tile). */
  tileV?: number;
  collide?: boolean;
  /** false = só colisor invisível. */
  visual?: boolean;
  rx?: number;
  ry?: number;
  rz?: number;
  /**
   * UV pela posição no mundo (caixas sem giro): u na horizontal da face, v na altura. Pedaços
   * de uma mesma parede (entre janelas, verga, peitoril) continuam o desenho da textura.
   * `tile`/`tileV` em metros; v = v0 + (y − y0) / tileV (topo e fundo: x e z).
   */
  worldUV?: { tile: number; tileV?: number; y0?: number; v0?: number };
  /** Topo/fundo com u ao longo do x local e v ao longo do z local (águas de telhado: as ondas da telha correm para baixo). */
  topUV?: boolean;
}

export interface CylinderOptions {
  diameter: number;
  diameterTop?: number;
  h: number;
  x: number;
  y: number;
  z: number;
  mat: Material;
  tessellation?: number;
  collide?: boolean;
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface ModelOptions {
  /** Escala uniforme (também nos colisores). */
  scale?: number;
  /** Nível de detalhe no lote estático (0 = perto, 1 = longe). */
  lod?: 0 | 1;
  /** false = sem colisores (ex.: a versão de longe de uma árvore). */
  collide?: boolean;
}

interface Swap {
  mat: Material;
  tile: number;
  plaster: boolean;
}

/** UV de uma caixa (sem giro) pela posição de cada vértice no mundo. */
function setWorldUV(mesh: Mesh, x: number, y: number, z: number, o: NonNullable<BoxOptions['worldUV']>): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const uv = new Float32Array((pos.length / 3) * 2);
  const tv = o.tileV ?? o.tile;
  const y0 = o.y0 ?? 0;
  const v0 = o.v0 ?? 0;
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const wx = pos[i] + x;
    const wy = pos[i + 1] + y;
    const wz = pos[i + 2] + z;
    if (Math.abs(nrm[i + 1]) > 0.5) {
      uv[j] = wx / o.tile;
      uv[j + 1] = wz / o.tile;
    } else {
      // Faces viradas para ±X correm em z; para ±Z, em x. O sinal acompanha a normal para
      // o desenho não sair espelhado (o tijolo continua na mesma direção ao virar a quina).
      uv[j] = Math.abs(nrm[i]) > 0.5 ? (Math.sign(nrm[i]) * wz) / o.tile : (-Math.sign(nrm[i + 2]) * wx) / o.tile;
      uv[j + 1] = v0 + (wy - y0) / tv;
    }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

/**
 * Fábrica de geometria estática. Separa visual (agrupado no StaticBatcher) de
 * colisão (caixas invisíveis), mantendo poucos draw calls e colisores simples.
 */
export class WorldBuilder {
  readonly colliders: Mesh[] = [];
  /** Material antigo → material com textura em escala real (vazio com `?mapaAntigo`). */
  private readonly swap = new Map<Material, Swap>();

  constructor(
    readonly scene: Scene,
    readonly batch: StaticBatcher,
    readonly mats: Materials,
  ) {
    if (OLD_MAP) return;
    const m = mats;
    const hq = m.hq;
    const set = (from: Material, to: Material, tile: number, plaster = false) => this.swap.set(from, { mat: to, tile, plaster });
    set(m.brick, hq.tijolo, HQ_TILE.tijolo);
    set(m.concrete, hq.concreto, HQ_TILE.concreto);
    set(m.concreteDark, hq.concretoEscuro, HQ_TILE.concreto);
    set(m.barrado, hq.concretoEscuro, HQ_TILE.concreto);
    set(m.cement, hq.concreto, HQ_TILE.concreto);
    set(m.curb, hq.meioFio, HQ_TILE.concreto);
    set(m.asphalt, hq.asfalto, HQ_TILE.asfalto);
    set(m.sidewalk, hq.calcada, HQ_TILE.calcada);
    set(m.stone, hq.pedra, HQ_TILE.pedra);
    set(m.dirt, hq.terra, HQ_TILE.terra);
    set(m.field, hq.campo, HQ_TILE.terra);
    set(m.tile, hq.piso, HQ_TILE.piso);
    set(m.corrugated, hq.fibrocimento, HQ_TILE.fibrocimento);
    set(m.wood, hq.madeira, HQ_TILE.madeira);
    set(m.muro, hq.muro, HQ_TILE.rebocoU, true);
    m.paints.forEach((p, i) => set(p, hq.paint(i), HQ_TILE.rebocoU, true));
  }

  box(o: BoxOptions): void {
    const cy = o.cy ?? (o.y ?? 0) + o.h / 2;
    const rx = o.rx ?? 0;
    const ry = o.ry ?? 0;
    const rz = o.rz ?? 0;

    if (o.visual !== false && o.mat) {
      let mat = o.mat;
      let t = o.tile ?? 1;
      let tv = o.tileV ?? t;
      let v0 = 0;
      let worldUV = o.worldUV;
      const { w, h, d } = o;
      // Materiais antigos viram os de textura em escala real (Fase 5: o mapa todo).
      const sw = worldUV ? undefined : this.swap.get(mat);
      if (sw) {
        mat = sw.mat;
        t = tv = sw.tile;
        const bottom = cy - h / 2;
        if (sw.plaster) {
          // Reboco: um pavimento (3 m) por repetição, com a umidade só no pé de paredes
          // que nascem no chão; paredes baixas mostram o alto da textura (escorridos).
          tv = h <= 6 ? Math.max(h, 3) : 3;
          if (bottom > 0.5) {
            tv = (h <= 6 ? h : 3) / 0.67;
            v0 = 0.33;
          } else if (h < 3) v0 = 1 - h / 3;
        }
        const rotated = rx !== 0 || ry !== 0 || rz !== 0;
        if (!rotated) worldUV = sw.plaster ? { tile: t, tileV: tv, y0: bottom, v0 } : { tile: t };
      }
      const faceUV = [
        new Vector4(0, v0, w / t, v0 + h / tv),
        new Vector4(0, v0, w / t, v0 + h / tv),
        new Vector4(0, v0, d / t, v0 + h / tv),
        new Vector4(0, v0, d / t, v0 + h / tv),
        new Vector4(0, 0, w / t, d / t),
        new Vector4(0, 0, w / t, d / t),
      ];
      const mesh = MeshBuilder.CreateBox('box', { width: w, height: h, depth: d, faceUV, wrap: true }, this.scene);
      if (worldUV) setWorldUV(mesh, o.x, cy, o.z, worldUV);
      if (o.topUV) {
        const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
        const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
        const uv = mesh.getVerticesData(VertexBuffer.UVKind)!;
        for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
          if (Math.abs(nrm[i + 1]) < 0.5) continue;
          uv[j] = pos[i] / t;
          uv[j + 1] = pos[i + 2] / tv;
        }
        mesh.setVerticesData(VertexBuffer.UVKind, uv);
      }
      mesh.position.set(o.x, cy, o.z);
      mesh.rotation.set(rx, ry, rz);
      mesh.material = mat;
      this.batch.add(mesh);
    }

    if (o.collide) this.collider(o.w, o.h, o.d, o.x, cy, o.z, rx, ry, rz);
  }

  collider(w: number, h: number, d: number, x: number, cy: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
    const col = MeshBuilder.CreateBox('collider', { width: w, height: h, depth: d }, this.scene);
    col.position.set(x, cy, z);
    col.rotation.set(rx, ry, rz);
    col.isVisible = false;
    col.checkCollisions = true;
    col.computeWorldMatrix(true);
    col.freezeWorldMatrix();
    col.doNotSyncBoundingInfo = true;
    this.colliders.push(col);
    return col;
  }

  cylinder(o: CylinderOptions): void {
    const mesh = MeshBuilder.CreateCylinder(
      'cyl',
      { height: o.h, diameterBottom: o.diameter, diameterTop: o.diameterTop ?? o.diameter, tessellation: o.tessellation ?? 14 },
      this.scene,
    );
    mesh.position.set(o.x, o.y + o.h / 2, o.z);
    mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    mesh.material = this.swap.get(o.mat)?.mat ?? o.mat;
    this.batch.add(mesh);
    if (o.collide) this.collider(o.diameter * 0.9, o.h, o.diameter * 0.9, o.x, o.y + o.h / 2, o.z);
  }

  /** Malha pronta adicionada ao lote estático. */
  addMesh(mesh: Mesh, mat: Material, o: BatchOptions = {}): Mesh {
    mesh.material = mat;
    this.batch.add(mesh, o);
    return mesh;
  }

  /**
   * Modelo do Blender (WorldAssets) girado em `ry` e posto em (x, y, z): cada peça é
   * clonada para o lote estático com o material que `mat` der para o papel dela (null =
   * peça omitida); as caixas de colisão do modelo viram colisores girados junto.
   */
  model(model: WorldModel, x: number, y: number, z: number, ry: number, mat: (role: string) => Material | null, o: ModelOptions = {}): void {
    const k = o.scale ?? 1;
    for (const [role, base] of model.parts) {
      const material = mat(role);
      if (!material) continue;
      const mesh = base.clone(base.name, null, true);
      mesh.setEnabled(true);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.scaling.setAll(k);
      mesh.material = material;
      // Com LOD, o bloco sai da posição do modelo: perto e longe caem no mesmo lote.
      this.batch.add(mesh, o.lod === undefined ? {} : { lod: o.lod, x, z });
    }
    if (o.collide === false) return;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (const col of model.colliders) {
      const { center: p, size } = col;
      this.collider(size.x * k, size.y * k, size.z * k, x + (p.x * c + p.z * s) * k, y + p.y * k, z + (-p.x * s + p.z * c) * k, 0, ry, 0);
    }
  }

  /**
   * Construtor que descarta tudo. Serve para rodar um trecho de construção só pelos sorteios
   * (o gerador do mapa avança igual e o resto do mapa não muda) sem pôr nada na cena.
   */
  sink(): WorldBuilder {
    return new SinkBuilder(this.scene, this.batch, this.mats);
  }

  /** Tubo reto entre dois pontos (corrimão, cano, haste). */
  pipe(a: Vector3, b: Vector3, radius: number, mat: Material): void {
    const tube = MeshBuilder.CreateTube('pipe', { path: [a, b], radius, tessellation: 8, cap: 3 }, this.scene);
    this.addMesh(tube, mat);
  }

  /** Fio pendurado entre dois pontos com barriga (catenária aproximada). */
  wire(a: Vector3, b: Vector3, sag: number, radius = 0.022): void {
    const path: Vector3[] = [];
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = Vector3.Lerp(a, b, t);
      p.y -= sag * 4 * t * (1 - t);
      path.push(p);
    }
    const tube = MeshBuilder.CreateTube('wire', { path, radius, tessellation: 5 }, this.scene);
    this.addMesh(tube, this.mats.wire);
  }

  /**
   * Sombra de contato no chão ao redor de uma área retangular (falso oclusão
   * ambiente). Dá "peso" às construções e objetos.
   */
  contactShadow(cx: number, cz: number, w: number, d: number, y: number, size = 0.7): void {
    const sides: Array<[number, number, number, number]> = [
      // centro x, centro z, comprimento, direção (ângulo para fora)
      [cx, cz + d / 2 + size / 2, w + size, 0],
      [cx, cz - d / 2 - size / 2, w + size, Math.PI],
      [cx + w / 2 + size / 2, cz, d + size, Math.PI / 2],
      [cx - w / 2 - size / 2, cz, d + size, -Math.PI / 2],
    ];
    for (const [x, z, len, angle] of sides) {
      const g = MeshBuilder.CreateGround('contact', { width: len, height: size }, this.scene);
      g.position.set(x, y + 0.075, z);
      g.rotation.y = angle;
      this.addMesh(g, this.mats.contactShadow);
    }
  }

  /** Extrusão de um perfil 2D (no plano XY) ao longo de Z, centrada. */
  extrude(profile: Array<[number, number]>, depth: number, mat: Material, x: number, y: number, z: number, ry = 0): Mesh {
    const shape = profile.map(([px, py]) => new Vector3(px, py, 0));
    shape.push(shape[0].clone());
    const mesh = MeshBuilder.ExtrudeShape(
      'extrude',
      { shape, path: [new Vector3(0, 0, -depth / 2), new Vector3(0, 0, depth / 2)], cap: Mesh.CAP_ALL, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    return this.addMesh(mesh, mat);
  }
}

class SinkBuilder extends WorldBuilder {
  private dummy: Mesh | null = null;

  override box(): void {}

  override collider(): Mesh {
    if (!this.dummy) {
      this.dummy = new Mesh('sink', this.scene);
      this.dummy.setEnabled(false);
    }
    return this.dummy;
  }

  override cylinder(): void {}

  override addMesh(mesh: Mesh): Mesh {
    mesh.dispose();
    return mesh;
  }

  override model(): void {}

  override pipe(): void {}

  override wire(): void {}

  override contactShadow(): void {}
}
