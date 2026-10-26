import '@babylonjs/loaders/glTF';
import { LoadAssetContainerAsync, Material, Mesh, Node, PBRMaterial, Scene, Vector3, VertexData } from '@babylonjs/core';
import { studioMaterial } from '../player/GlassesMaterial';

/**
 * Modelos 3D do mapa gerados no Blender (`tools/blender/cars.py` e `statue.py`):
 * carros populares genéricos e a estátua do morro.
 *
 * O GLB é carregado uma vez na tela de carregamento. Cada peça (uma por material) vira uma
 * malha-base invisível com a transformação do glTF já aplicada nos vértices; o mapa clona
 * essas bases para o StaticBatcher, que as junta aos lotes por material e bloco. Assim os
 * carros não acrescentam draw calls por instância. Os materiais do arquivo são só nomes de
 * papel ('paint', 'glass', 'trim'...): o mapa usa os StandardMaterials da biblioteca dele.
 */

/** Caixa de colisão no espaço do modelo (centro e tamanho). */
export interface ModelCollider {
  center: Vector3;
  size: Vector3;
}

export interface WorldModel {
  /** Uma malha-base por papel de material. */
  parts: Map<string, Mesh>;
  colliders: ModelCollider[];
  /** Caixa envolvente da parte visível (espaço do modelo). */
  min: Vector3;
  max: Vector3;
}

export type CarModelId = 'hatch' | 'seda' | 'perua' | 'picape' | 'besouro';
export const CAR_MODELS: readonly CarModelId[] = ['hatch', 'seda', 'perua', 'picape', 'besouro'];

export type DetailedVehicleId = 'fusca' | 'viatura' | 'ambulancia' | 'kombi' | 'gol' | 'onibus';
export const DETAILED_VEHICLES: readonly DetailedVehicleId[] = ['fusca', 'viatura', 'ambulancia', 'kombi', 'gol', 'onibus'];

export interface DetailedVehicle {
  /** Versão de perto e de longe. */
  model: WorldModel;
  lod: WorldModel | null;
  /** Materiais do GLB por nome (`<id>_body`, `<id>_glass`). */
  materials: Map<string, Material>;
}

export class WorldAssets {
  static current: WorldAssets | null = null;

  readonly cars = new Map<CarModelId, WorldModel>();
  statue: WorldModel | null = null;
  /**
   * Vegetação e caçamba (`tools/blender/vegetation.py`), pelo nome do objeto do Blender:
   * Arv_<espécie> (+ Arv_<espécie>_lod1), Bananeira, Mato, Capim, Trepadeira, Cacamba.
   */
  readonly props = new Map<string, WorldModel>();
  /**
   * Veículos enviados pelo usuário (modelos do Tripo tratados por `tools/blender/vehicle.py`:
   * vidros gerados, letreiros corrigidos, versão de longe). Ao contrário dos carros de
   * cars.py, usam os próprios materiais (textura da pintura e vidro).
   */
  readonly vehicles = new Map<DetailedVehicleId, DetailedVehicle>();
  /**
   * Kit das casas (`tools/blender/house_kit.py`): Kit_Janela, Kit_Grade, Kit_Basculante,
   * Kit_Porta, Kit_Portao, Kit_Caixa, Kit_Medidor, Kit_ArCondicionado, Kit_Antena. Origem no
   * centro do vão, no plano da face externa da parede, olhando para +Z.
   */
  readonly kit = new Map<string, WorldModel>();
  /**
   * Props enviados com textura própria (`tools/blender/textured_prop.py`): Prop_<id> e os
   * materiais do GLB (ex.: saco_lixo).
   */
  readonly texturedProps = new Map<string, { model: WorldModel; materials: Map<string, Material> }>();
  /** Baús do loot (`tools/blender/chest.py`): base e tampa separadas, comum e épico (azul). */
  readonly chests = new Map<'bau' | 'bau_epico', { base: WorldModel; lid: WorldModel; materials: Map<string, Material> }>();

  static async load(scene: Scene): Promise<WorldAssets> {
    const base = `${import.meta.env.BASE_URL}assets/world/`;
    const assets = new WorldAssets();
    const [cars, statue, vegetation] = await Promise.all([
      LoadAssetContainerAsync(`${base}cars.glb`, scene),
      LoadAssetContainerAsync(`${base}statue.glb`, scene),
      LoadAssetContainerAsync(`${base}vegetation.glb`, scene),
    ]);
    // Veículos detalhados: um arquivo que falte (ex.: ambulância ainda não enviada) não
    // impede o jogo de abrir, só não aparece no mapa.
    await Promise.all(
      DETAILED_VEHICLES.map(async (id) => {
        try {
          const v = await loadDetailedVehicle(scene, `${base}${id}.glb`, id);
          if (v) assets.vehicles.set(id, v);
        } catch (e) {
          console.warn(`[WorldAssets] ${id}.glb não carregou:`, e);
        }
      }),
    );
    for (const id of ['bau', 'bau_epico'] as const) {
      try {
        const c = await LoadAssetContainerAsync(`${base}${id}.glb`, scene);
        const models = collect(scene, c.meshes);
        const b = models.get('Bau_base');
        const l = models.get('Bau_tampa');
        const materials = new Map<string, Material>();
        for (const mat of c.materials) {
          if (mat instanceof PBRMaterial) {
            mat.reflectionTexture = studioMaterial(scene, 'estudio_ref', '#ffffff', 0, 1).reflectionTexture;
            mat.environmentIntensity = 0.8;
          }
          scene.addMaterial(mat);
          for (const t of mat.getActiveTextures()) scene.addTexture(t);
          materials.set(mat.name, mat);
        }
        for (const m of c.meshes) m.dispose(false, false);
        // Interior (caixa interna e forro da tampa): visto dos dois lados.
        const inner = materials.get('interior');
        if (inner) inner.backFaceCulling = false;
        if (b && l) assets.chests.set(id, { base: b, lid: l, materials });
      } catch (e) {
        console.warn(`[WorldAssets] ${id}.glb não carregou:`, e);
      }
    }
    for (const id of [
      'saco_lixo', 'pneus', 'barril', 'kit_medico', 'tubarao', 'cone', 'energetico', 'barco', 'arvore1', 'arvore2', 'cristo',
      'mochila_esportiva', 'mochila_esportiva_azul', 'mochila_esportiva_vermelha', 'mochila_tatica',
      'relogio', 'relogio_azul', 'relogio_preto', 'relogio_vermelho', 'relogio_dourado',
      'fone', 'fone_preto', 'fone_vermelho', 'fone_azul', 'fone_rosa',
    ]) {
      try {
        const p = await loadTexturedProp(scene, `${base}${id}.glb`, id);
        if (p) assets.texturedProps.set(id, p);
      } catch (e) {
        console.warn(`[WorldAssets] ${id}.glb não carregou:`, e);
      }
    }
    try {
      const kit = await LoadAssetContainerAsync(`${base}kit.glb`, scene);
      for (const [name, model] of collect(scene, kit.meshes)) assets.kit.set(name, model);
      kit.dispose();
    } catch (e) {
      console.warn('[WorldAssets] kit.glb não carregou (casas do setor novo ficam sem janelas de verdade):', e);
    }
    const props = collect(scene, vegetation.meshes);
    for (const [name, model] of props) {
      if (name.startsWith('Col_')) continue;
      model.colliders.push(...(props.get(`Col_${name}`)?.colliders ?? []));
      assets.props.set(name, model);
    }
    vegetation.dispose();
    // Props de favela (`favela_props.py`: Lixo_a/b/c, Pneu, PilhaPneus, BarricadaPneus,
    // BarricadaMadeira), armas (`weapons.py`: Arma_<id>) e peças do lobby e troncos da mata
    // (`lobby_props.py`: MesaBar, CadeiraBar, Engradado, Isopor, CaixaSom, Tronco_a/b). Opcionais: sem eles o jogo usa
    // as versões antigas feitas de primitivas.
    await Promise.all(
      ['favela.glb', 'weapons.glb', 'lobby.glb', 'trees.glb'].map(async (file) => {
        try {
          const c = await LoadAssetContainerAsync(`${base}${file}`, scene);
          const models = collect(scene, c.meshes);
          for (const [name, model] of models) {
            if (name.startsWith('Col_')) continue;
            model.colliders.push(...(models.get(`Col_${name}`)?.colliders ?? []));
            assets.props.set(name, model);
          }
          c.dispose();
        } catch (err) {
          console.warn(`[Mapa] ${file} não carregou; usando a versão antiga.`, err);
        }
      }),
    );
    const carModels = collect(scene, cars.meshes);
    for (const id of CAR_MODELS) {
      const model = carModels.get(`Car_${id}`);
      if (!model) throw new Error(`cars.glb sem o modelo Car_${id}`);
      model.colliders.push(...(carModels.get(`Col_${id}`)?.colliders ?? []));
      assets.cars.set(id, model);
    }
    const statueModels = collect(scene, statue.meshes);
    assets.statue = statueModels.get('Estatua') ?? null;
    if (assets.statue) assets.statue.colliders.push(...(statueModels.get('Col_estatua')?.colliders ?? []));
    // As malhas originais do glTF não vão para a cena: só as bases assadas.
    cars.dispose();
    statue.dispose();
    WorldAssets.current = assets;
    return assets;
  }
}

/** Prop texturizado (`Prop_<id>`), com os materiais do próprio GLB. */
async function loadTexturedProp(scene: Scene, url: string, id: string): Promise<{ model: WorldModel; materials: Map<string, Material> } | null> {
  const c = await LoadAssetContainerAsync(url, scene);
  const models = collect(scene, c.meshes);
  // Variações de cor (recolor.py) guardam o nome do modelo de origem (Prop_relogio em relogio_azul.glb).
  const model = models.get(`Prop_${id}`) ?? [...models].find(([k]) => k.startsWith('Prop_'))?.[1];
  if (!model) return null;
  const materials = new Map<string, Material>();
  for (const mat of c.materials) {
    if (mat instanceof PBRMaterial) {
      mat.reflectionTexture = studioMaterial(scene, 'estudio_ref', '#ffffff', 0, 1).reflectionTexture;
      mat.environmentIntensity = 0.7;
    }
    scene.addMaterial(mat);
    for (const t of mat.getActiveTextures()) scene.addTexture(t);
    materials.set(mat.name, mat);
  }
  for (const m of c.meshes) m.dispose(false, false);
  return { model, materials };
}

/** Carrega um veículo detalhado (`<id>.glb`: Car_<id>, Car_<id>_lod1, Col_<id>_*). */
async function loadDetailedVehicle(scene: Scene, url: string, id: string): Promise<DetailedVehicle | null> {
  const c = await LoadAssetContainerAsync(url, scene);
  const models = collect(scene, c.meshes);
  const model = models.get(`Car_${id}`);
  if (!model) return null;
  model.colliders.push(...(models.get(`Col_${id}`)?.colliders ?? []));
  const lod = models.get(`Car_${id}_lod1`) ?? null;
  const materials = new Map<string, Material>();
  for (const mat of c.materials) {
    // A cena não tem mapa de ambiente e a pintura PBR sem nada para refletir fica quase
    // preta: usa o mesmo "estúdio" dos óculos e das correntes.
    if (mat instanceof PBRMaterial) {
      mat.reflectionTexture = studioMaterial(scene, 'estudio_ref', '#ffffff', 0, 1).reflectionTexture;
      mat.environmentIntensity = 0.85;
    }
    scene.addMaterial(mat);
    for (const t of mat.getActiveTextures()) scene.addTexture(t);
    materials.set(mat.name, mat);
  }
  // Só as malhas originais saem: os materiais (com as texturas) ficam para as cópias.
  for (const m of c.meshes) m.dispose(false, false);
  return { model, lod, materials };
}

/**
 * Nome do objeto do Blender dono da malha: o nó logo abaixo da raiz do glTF ('Car_hatch',
 * 'Estatua', 'Arv_mangueira_lod1'...). Colisores perdem o sufixo: 'Col_hatch_1' → 'Col_hatch'.
 */
function ownerName(mesh: Node): string | null {
  let n: Node = mesh;
  while (n.parent && n.parent.name !== '__root__') n = n.parent;
  if (!n.parent) return null;
  const name = n.name.replace(/_primitive\d+$/, '');
  return name.startsWith('Col_') ? name.replace(/_\d+$/, '') : name;
}

/**
 * Junta vértices idênticos (posição, normal e UV iguais). Alguns GLBs vêm com cada
 * triângulo com vértices próprios (as esquadrias de alumínio tinham 1.248 vértices por
 * janela para 572 triângulos): no mapa inteiro eram ~4 milhões de vértices só delas.
 */
function weld(vd: VertexData): void {
  const p = vd.positions!;
  const n = vd.normals;
  const uv = vd.uvs;
  const idx = vd.indices;
  if (!idx || !n) return;
  const count = p.length / 3;
  const map = new Map<string, number>();
  const remap = new Int32Array(count);
  const np: number[] = [];
  const nn: number[] = [];
  const nuv: number[] = [];
  const r = (v: number) => Math.round(v * 1e4);
  for (let i = 0; i < count; i++) {
    const key = `${r(p[i * 3])},${r(p[i * 3 + 1])},${r(p[i * 3 + 2])},${r(n[i * 3] * 10)},${r(n[i * 3 + 1] * 10)},${r(n[i * 3 + 2] * 10)}${uv ? `,${r(uv[i * 2])},${r(uv[i * 2 + 1])}` : ''}`;
    let k = map.get(key);
    if (k === undefined) {
      k = np.length / 3;
      map.set(key, k);
      np.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      nn.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      if (uv) nuv.push(uv[i * 2], uv[i * 2 + 1]);
    }
    remap[i] = k;
  }
  if (np.length / 3 > count * 0.9) return;
  vd.positions = np;
  vd.normals = nn;
  if (uv) vd.uvs = nuv;
  vd.indices = Array.from(idx, (i) => remap[i]);
}

function collect(scene: Scene, meshes: ReadonlyArray<{ getTotalVertices(): number } & Node>): Map<string, WorldModel> {
  const out = new Map<string, WorldModel>();
  const get = (name: string): WorldModel => {
    let m = out.get(name);
    if (!m) {
      m = { parts: new Map(), colliders: [], min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
      out.set(name, m);
    }
    return m;
  };
  for (const node of meshes) {
    if (!(node instanceof Mesh) || node.getTotalVertices() === 0) continue;
    const owner = ownerName(node);
    if (!owner) continue;
    node.computeWorldMatrix(true);
    const model = get(owner);
    if (owner.startsWith('Col_')) {
      const bb = node.getBoundingInfo().boundingBox;
      model.colliders.push({ center: bb.centerWorld.clone(), size: bb.extendSizeWorld.scale(2) });
      continue;
    }
    // Assa a transformação do glTF (inclui a troca de mão do sistema de coordenadas).
    const vd = VertexData.ExtractFromMesh(node, true, true);
    vd.transform(node.getWorldMatrix());
    // A transformação assada inclui o espelhamento do glTF (mão esquerda): os triângulos
    // ficavam ao contrário e, com o descarte de faces de trás, aparecia o lado de dentro de
    // tudo (troncos e móveis pretos, peças "ocas"). Desvira a ordem dos vértices.
    if (node.getWorldMatrix().determinant() < 0 && vd.indices) {
      const idx = Array.from(vd.indices);
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      vd.indices = idx;
    }
    // O GLB vem sem UV, mas o lote estático só junta malhas com os mesmos atributos das
    // caixas do mapa (posição, normal, UV). Projeção de caixa pela normal de cada vértice
    // (topo usa x-z, lados usam o plano da face): textura sem esticar em nenhuma face.
    const pos = vd.positions!;
    const nrm = vd.normals;
    if (!vd.uvs) {
      const uvs = new Float32Array((pos.length / 3) * 2);
      for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
        const ax = nrm ? Math.abs(nrm[i]) : 0;
        const ay = nrm ? Math.abs(nrm[i + 1]) : 0;
        const az = nrm ? Math.abs(nrm[i + 2]) : 1;
        if (ay >= ax && ay >= az) {
          uvs[j] = pos[i];
          uvs[j + 1] = pos[i + 2];
        } else if (ax >= az) {
          uvs[j] = pos[i + 2];
          uvs[j + 1] = pos[i + 1];
        } else {
          uvs[j] = pos[i];
          uvs[j + 1] = pos[i + 1];
        }
      }
      vd.uvs = uvs;
    }
    vd.colors = null;
    vd.tangents = null;
    weld(vd);
    const role = node.material?.name ?? 'paint';
    const baked = new Mesh(`${owner}_${role}`, scene);
    vd.applyToMesh(baked, false);
    baked.setEnabled(false);
    baked.isPickable = false;
    model.parts.set(role, baked);
    const bb = baked.getBoundingInfo().boundingBox;
    model.min.minimizeInPlace(bb.minimumWorld);
    model.max.maximizeInPlace(bb.maximumWorld);
  }
  return out;
}
