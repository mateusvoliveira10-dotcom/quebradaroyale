import { AbstractMesh, Material, Matrix, Mesh, MeshBuilder, Node, Quaternion, TransformNode, Vector3, VertexBuffer, VertexData } from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers/glTF';
import type { Game } from '../core/Game';
import { WORLD } from '../core/config';
import { Terrain } from '../world/Terrain';
import type { Placement } from '../world/WorldBuilder';

/**
 * Exportador do mapa para o Roblox (só no servidor de desenvolvimento, com `?exportarRoblox`
 * na URL; rodar `exportarRoblox()` no console). Gera, em `exportar-roblox/`:
 *
 *   mapa_<i>_<j>.glb   cenário fixo em blocos de 160 m (cada malha com no máximo 18 mil
 *                       triângulos, o limite de uma MeshPart), já em studs;
 *   modelos.glb         uma cópia de cada modelo repetido (carros, árvores, peças do kit),
 *                       uma variação por combinação de cores;
 *   Dados*.lua          posições das cópias, caixas de colisão e marcas de alinhamento
 *                       (ModuleScripts lidos pelo script MontarMapa no Roblox).
 *
 * Coordenadas: o exportador glTF converte a cena do Babylon (mão esquerda) espelhando X.
 * Os dados .lua usam o mesmo espaço do glTF, para tudo encaixar. Cada arquivo leva marcas
 * (cubinhos "Marca_A/B" e "Origem") que o script do Roblox usa para pôr cada bloco e cada
 * modelo exatamente no lugar, qualquer que seja a posição em que o Studio o inseriu.
 */

/** Studs por metro (1 stud = 0,28 m). */
const S = 1 / 0.28;
const TILE = 160;
const MAX_TRIS = 18000;
/** Marca B fica 20 studs ao lado da A (confere a escala da importação). */
const MARK_GAP = 20;

type Save = (name: string, data: Blob | string) => Promise<void>;

/** Ponto do Babylon (m) → espaço do glTF exportado (studs): X espelhado. */
function conv(p: Vector3): [number, number, number] {
  return [-p.x * S, p.y * S, p.z * S];
}

/**
 * Rotação do Babylon → matriz do Roblox (linhas R00..R22) no espaço espelhado em X
 * (R' = F·R·F, com F = diag(−1, 1, 1)).
 */
function convRot(q: Quaternion): number[] {
  const m = new Matrix();
  q.toRotationMatrix(m);
  const ax = (v: Vector3) => Vector3.TransformNormal(v, m);
  const r = ax(new Vector3(1, 0, 0));
  const u = ax(new Vector3(0, 1, 0));
  const f = ax(new Vector3(0, 0, 1));
  const c0 = [r.x, -r.y, -r.z];
  const c1 = [-u.x, u.y, u.z];
  const c2 = [-f.x, f.y, f.z];
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

const n2 = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));
const n3 = (v: number) => (Math.abs(v) < 0.0005 ? '0' : v.toFixed(3));

/** Entrada compacta: posição + tamanho, e só o giro em Y quando é só isso; senão a matriz toda. */
function cframeEntry(pos: [number, number, number], rot: number[], extra: string[]): string {
  const yawOnly = Math.abs(rot[1]) < 1e-3 && Math.abs(rot[3]) < 1e-3 && Math.abs(rot[5]) < 1e-3 && Math.abs(rot[7]) < 1e-3 && rot[4] > 0.999;
  const p = pos.map(n2).join(',');
  if (yawOnly) {
    const yaw = Math.atan2(-rot[6], rot[0]);
    return `{${p},${extra.join(',')},${n3(yaw)}}`;
  }
  return `{${p},${extra.join(',')},${rot.map(n3).join(',')}}`;
}

/** Divide os blocos de ModuleScript em pedaços (o Studio fica lento com scripts enormes). */
function luaChunks(header: string, entries: string[], per = 4000): string[] {
  const out: string[] = [];
  for (let i = 0; i < entries.length || i === 0; i += per) {
    out.push(`${header}\nreturn {\n${entries.slice(i, i + per).join(',\n')}\n}\n`);
    if (entries.length === 0) break;
  }
  return out;
}

interface Bucket {
  mat: Material;
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[] | null;
  idx: number[];
}

export async function exportarRoblox(game: Game, save: Save): Promise<string> {
  const scene = game.scene;
  const world = game.world;
  const log: string[] = [];
  const lodFar = new Set<AbstractMesh>();
  for (const m of world.batch.merged) for (const l of m.getLODLevels()) if (l.mesh) lodFar.add(l.mesh);
  const inside = (x: number, z: number) => Math.hypot(x, z) < WORLD.radius + 60;

  // ------------------------------------------------------------------ cenário em blocos
  const sources: Mesh[] = [...world.batch.merged.filter((m) => !lodFar.has(m)), ...(Terrain.current?.meshes ?? [])];
  const tiles = new Map<string, Map<string, Bucket[]>>();
  let totalTris = 0;
  for (const src of sources) {
    const mat = src.material;
    if (!mat || !src.getTotalIndices()) continue;
    const wm = src.computeWorldMatrix(true);
    const P = src.getVerticesData(VertexBuffer.PositionKind);
    const N = src.getVerticesData(VertexBuffer.NormalKind);
    const UV = src.getVerticesData(VertexBuffer.UVKind);
    const C = src.getVerticesData(VertexBuffer.ColorKind);
    const I = src.getIndices();
    if (!P || !I) continue;
    const wp = new Float32Array(P.length);
    const wn = new Float32Array(P.length);
    const tmp = new Vector3();
    for (let v = 0; v < P.length; v += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(P[v], P[v + 1], P[v + 2], wm, tmp);
      wp[v] = tmp.x;
      wp[v + 1] = tmp.y;
      wp[v + 2] = tmp.z;
      if (N) {
        Vector3.TransformNormalFromFloatsToRef(N[v], N[v + 1], N[v + 2], wm, tmp);
        tmp.normalize();
        wn[v] = tmp.x;
        wn[v + 1] = tmp.y;
        wn[v + 2] = tmp.z;
      }
    }
    const remap = new Map<string, Map<number, number>>();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3;
      const b = I[t + 1] * 3;
      const c = I[t + 2] * 3;
      const cx = (wp[a] + wp[b] + wp[c]) / 3;
      const cz = (wp[a + 2] + wp[b + 2] + wp[c + 2]) / 3;
      if (!inside(cx, cz)) continue;
      const key = `${Math.floor(cx / TILE)}_${Math.floor(cz / TILE)}`;
      let tile = tiles.get(key);
      if (!tile) tiles.set(key, (tile = new Map()));
      let list = tile.get(mat.uniqueId + '');
      if (!list) tile.set(mat.uniqueId + '', (list = []));
      let bk = list[list.length - 1];
      const mk = `${key}|${list.length}|${src.uniqueId}`;
      if (!bk || bk.idx.length / 3 >= MAX_TRIS) {
        bk = { mat, pos: [], nrm: [], uv: [], col: C ? [] : null, idx: [] };
        list.push(bk);
      }
      const mapKey = `${key}|${list.length}|${src.uniqueId}`;
      let vm = remap.get(mapKey);
      if (!vm) remap.set(mapKey, (vm = new Map()));
      void mk;
      for (const vi of [I[t], I[t + 1], I[t + 2]]) {
        let ni = vm.get(vi);
        if (ni === undefined) {
          ni = bk.pos.length / 3;
          vm.set(vi, ni);
          bk.pos.push(wp[vi * 3] * S, wp[vi * 3 + 1] * S, wp[vi * 3 + 2] * S);
          bk.nrm.push(wn[vi * 3], wn[vi * 3 + 1], wn[vi * 3 + 2]);
          bk.uv.push(UV ? UV[vi * 2] : 0, UV ? UV[vi * 2 + 1] : 0);
          if (bk.col) bk.col.push(C![vi * 4], C![vi * 4 + 1], C![vi * 4 + 2], C![vi * 4 + 3]);
        }
        bk.idx.push(ni);
      }
      totalTris++;
    }
  }

  const marker = (name: string, p: Vector3, parent?: Node): Mesh => {
    const m = MeshBuilder.CreateBox(name, { size: 0.5 }, scene);
    m.position.copyFrom(p);
    if (parent) m.parent = parent;
    return m;
  };

  const tileEntries: string[] = [];
  let meshCount = 0;
  for (const [key, mats] of tiles) {
    const nodes = new Set<Node>();
    let k = 0;
    for (const list of mats.values()) {
      for (const bk of list) {
        const m = new Mesh(`${(bk.mat.name || 'mat').replace(/[^\w]/g, '_')}_${k++}`, scene);
        const vd = new VertexData();
        vd.positions = bk.pos;
        vd.normals = bk.nrm;
        vd.uvs = bk.uv;
        if (bk.col) vd.colors = bk.col;
        vd.indices = bk.idx;
        vd.applyToMesh(m);
        m.material = bk.mat;
        nodes.add(m);
        meshCount++;
      }
    }
    const [ix, iz] = key.split('_').map(Number);
    const a = new Vector3((ix + 0.5) * TILE * S, 0, (iz + 0.5) * TILE * S);
    const b = a.add(new Vector3(-MARK_GAP, 0, 0));
    nodes.add(marker('Marca_A', a));
    nodes.add(marker('Marca_B', b));
    const name = `mapa_${ix}_${iz}`;
    const glb = await GLTF2Export.GLBAsync(scene, name, { shouldExportNode: (n) => nodes.has(n) });
    for (const [file, blob] of Object.entries(glb.files)) await save(file, blob as Blob);
    // Posição esperada das marcas no espaço do glTF (X espelhado; a cena já está em studs).
    tileEntries.push(`{nome="${name}",a={${n2(-a.x)},${n2(a.y)},${n2(a.z)}},b={${n2(-b.x)},${n2(b.y)},${n2(b.z)}}}`);
    for (const n of nodes) n.dispose(false, false);
    log.push(`${name}: ${nodes.size - 2} malhas`);
  }

  // ------------------------------------------------------------------ modelos repetidos
  const variants = new Map<string, { id: string; p: Placement }>();
  const placeEntries: string[] = [];
  const variantKey = (p: Placement) => `${p.model.name ?? 'modelo'}|${[...p.mats].map(([r, m]) => `${r}=${m.name}`).sort().join(';')}`;
  for (const p of world.placements) {
    if (!inside(p.x, p.z)) continue;
    const vk = variantKey(p);
    let v = variants.get(vk);
    if (!v) {
      v = { id: `M${String(variants.size + 1).padStart(3, '0')}_${(p.model.name ?? 'modelo').replace(/[^\w]/g, '_')}`, p };
      variants.set(vk, v);
    }
    const pos = conv(new Vector3(p.x, p.y, p.z));
    const rot = convRot(Quaternion.RotationYawPitchRoll(p.ry, 0, 0));
    placeEntries.push(cframeEntry(pos, rot, [`"${v.id}"`, n3(p.scale)]));
  }
  {
    const nodes = new Set<Node>();
    for (const { id, p } of variants.values()) {
      const root = new TransformNode(id, scene);
      root.scaling.setAll(S);
      nodes.add(root);
      for (const [role, base] of p.model.parts) {
        const mat = p.mats.get(role);
        if (!mat) continue;
        const m = base.clone(`${id}_${role}`.replace(/[^\w]/g, '_'), root, true) as Mesh;
        m.setEnabled(true);
        m.material = mat;
        nodes.add(m);
      }
      nodes.add(marker('Origem', Vector3.Zero(), root));
    }
    const glb = await GLTF2Export.GLBAsync(scene, 'modelos', { shouldExportNode: (n) => nodes.has(n) });
    for (const [file, blob] of Object.entries(glb.files)) await save(file, blob as Blob);
    for (const n of nodes) n.dispose(false, false);
  }

  // ------------------------------------------------------------------ colisores
  const colEntries: string[] = [];
  const q = new Quaternion();
  const sc = new Vector3();
  const tr = new Vector3();
  for (const c of world.colliders) {
    const wm = c.computeWorldMatrix(true);
    wm.decompose(sc, q, tr);
    if (!inside(tr.x, tr.z)) continue;
    const ext = c.getBoundingInfo().boundingBox.extendSize;
    const size = [ext.x * 2 * Math.abs(sc.x) * S, ext.y * 2 * Math.abs(sc.y) * S, ext.z * 2 * Math.abs(sc.z) * S];
    colEntries.push(cframeEntry(conv(tr), convRot(q), size.map(n2)));
  }

  const head = (what: string) =>
    `-- Gerado pelo exportador do QUEBRADA ROYALE (${new Date().toISOString().slice(0, 10)}). ${what}\n-- Espaço do glTF exportado, em studs. Não edite à mão: rode o exportador de novo.`;
  await save('DadosBlocos.lua', `${head('Blocos do mapa e marcas de alinhamento.')}\nreturn {\n${tileEntries.join(',\n')}\n}\n`);
  luaChunks(head('Cópias dos modelos: {x,y,z, id, escala, giroY} ou {x,y,z, id, escala, R00..R22}.'), placeEntries).forEach((src, i) => void save(`DadosModelos${i + 1}.lua`, src));
  const cols = luaChunks(head('Caixas de colisão: {x,y,z, sx,sy,sz, giroY} ou {x,y,z, sx,sy,sz, R00..R22}.'), colEntries);
  for (let i = 0; i < cols.length; i++) await save(`DadosColisores${i + 1}.lua`, cols[i]);

  const summary =
    `Blocos: ${tiles.size} (${meshCount} malhas, ${totalTris} triângulos) · modelos: ${variants.size} variações, ${placeEntries.length} cópias · ` +
    `colisores: ${colEntries.length} (${cols.length} arquivos)`;
  log.unshift(summary);
  await save('LEIA-ME.txt', log.join('\n') + '\n');
  return summary;
}

/**
 * Água (mar, lagos, rios, piscinas) para a água do Terrain do Roblox: em cada linha de 2 m,
 * os trechos contínuos de água viram um bloco {x0, x1, z, nível, fundo} (espaço do glTF, em
 * studs). O script CriarAgua do Roblox preenche esses blocos com Enum.Material.Water.
 */
export async function exportarAgua(save: Save): Promise<string> {
  const { waterBodies, waterAt } = await import('../world/Water');
  const STEP = 2;
  const R = WORLD.extent;
  const runs: string[] = [];
  for (let z = -R; z <= R; z += STEP) {
    let start: number | null = null;
    let level = 0;
    let floor = 0;
    const flush = (xEnd: number) => {
      if (start === null) return;
      // X espelhado no glTF: o trecho [start, xEnd] vira [−xEnd, −start].
      runs.push(`{${n2(-xEnd * S)},${n2(-start * S)},${n2(z * S)},${n2(level * S)},${n2(floor * S)}}`);
      start = null;
    };
    for (let x = -R; x <= R; x += STEP) {
      const w = waterAt(x, z);
      const ok = !!w && w.depth > 0.05;
      if (ok && start !== null && Math.abs(w!.level - level) > 0.01) flush(x - STEP / 2);
      if (ok) {
        if (start === null) {
          start = x - STEP / 2;
          level = w!.level;
          floor = w!.floor;
        } else floor = Math.min(floor, w!.floor);
      } else flush(x - STEP / 2);
    }
    flush(R + STEP / 2);
  }
  const names = waterBodies().map((b) => b.name).join(', ');
  const src = `-- Gerado pelo exportador do QUEBRADA ROYALE. Água: ${names}.\n-- {x0, x1, z, nivel, fundo} em studs (espaço do glTF); faixas de ${STEP} m.\nreturn {\n${runs.join(',\n')}\n}\n`;
  await save('DadosAgua.lua', src);
  return `água: ${runs.length} faixas (${names})`;
}
