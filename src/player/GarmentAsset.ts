import '@babylonjs/loaders/glTF';
import { AssetContainer, BoundingInfo, LoadAssetContainerAsync, Mesh, PBRMaterial, Scene, Texture, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';
import { GARMENT_SOURCES } from '../customization/garments';
import { GLASSES_MESHES, GLASSES_URL } from '../customization/glasses';
import type { CharacterInstance } from './CharacterAsset';

/**
 * Roupas 3D (camisas, partes de baixo, calçados): malhas com skinning no mesmo
 * esqueleto do personagem-base, carregadas uma vez. Cada personagem recebe
 * clones (geometria compartilhada) presos ao próprio esqueleto; cada peça é
 * só um material (textura própria), criado uma vez e reaproveitado por todos.
 */
export class GarmentAsset {
  static current: GarmentAsset | null = null;

  private readonly templates = new Map<string, Mesh>();
  private readonly materials = new Map<string, PBRMaterial>();

  private constructor() {}

  static async load(scene: Scene, baseMaterial: PBRMaterial, bodyBones: string[]): Promise<GarmentAsset> {
    const asset = new GarmentAsset();
    const containers = await Promise.all(GARMENT_SOURCES.meshes.map((s) => LoadAssetContainerAsync(s.url, scene)));
    GARMENT_SOURCES.meshes.forEach((src, i) => {
      for (const name of src.names) {
        const m = containers[i].meshes.find((x) => x.name === name && x.getTotalVertices() > 0) as Mesh | undefined;
        if (!m || !m.skeleton) throw new Error(`${src.url}: malha "${name}" com esqueleto não encontrada`);
        remapJoints(m, bodyBones, src.url);
        m.setEnabled(false);
        asset.templates.set(name, m);
      }
    });

    // Um material por peça, a partir do material do corpo (mesmas convenções do glTF,
    // como a orientação do normal map), trocando as texturas e deixando o tecido fosco.
    const normals = new Map<string, Texture>();
    for (const def of GARMENT_SOURCES.materials) {
      let normal = normals.get(def.normal);
      if (!normal) {
        normal = new Texture(def.normal, scene, false, false);
        normals.set(def.normal, normal);
      }
      const m = baseMaterial.clone(`roupa_${def.id}`) as PBRMaterial;
      m.albedoTexture = new Texture(def.albedo, scene, false, false);
      m.albedoColor.set(1, 1, 1);
      m.bumpTexture = normal;
      m.metallicTexture = null;
      m.metallic = 0;
      m.roughness = def.roughness;
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
      asset.materials.set(def.id, m);
    }
    asset.glasses = await LoadAssetContainerAsync(GLASSES_URL, scene);
    GarmentAsset.current = asset;
    return asset;
  }

  private glasses: AssetContainer | null = null;

  /**
   * Clone dos óculos (armação, detalhes e lentes) com a raiz do glTF, que converte o
   * sistema de coordenadas: basta prender a raiz no nó dos olhos do personagem.
   */
  createGlasses(): { root: TransformNode; frame: Mesh; accent: Mesh; lens: Mesh } | null {
    if (!this.glasses) return null;
    const e = this.glasses.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = e.rootNodes[0] as TransformNode;
    const meshes = root.getChildMeshes(false) as Mesh[];
    const find = (name: string) => meshes.find((m) => m.name === name)!;
    return { root, frame: find(GLASSES_MESHES.frame), accent: find(GLASSES_MESHES.accent), lens: find(GLASSES_MESHES.lens) };
  }

  material(id: string): PBRMaterial {
    const m = this.materials.get(id);
    if (!m) throw new Error(`Roupa sem material: ${id}`);
    return m;
  }

  /** Todos os materiais (para pré-carregar as texturas: trocar de roupa no menu é instantâneo). */
  get allMaterials(): PBRMaterial[] {
    return [...this.materials.values()];
  }

  /** Clone de uma malha de roupa, deformado pelo esqueleto do personagem. */
  create(inst: CharacterInstance, meshName: string): Mesh {
    const t = this.templates.get(meshName);
    if (!t) throw new Error(`Malha de roupa não carregada: ${meshName}`);
    const m = t.clone(`roupa_${meshName}`, null, true, false) as Mesh;
    m.setEnabled(true);
    m.skeleton = inst.body.skeleton;
    // Mesmo lugar do corpo na hierarquia, para as malhas deformarem igual.
    m.parent = inst.body.parent;
    m.position.copyFrom(inst.body.position);
    if (inst.body.rotationQuaternion) m.rotationQuaternion = inst.body.rotationQuaternion.clone();
    else m.rotation.copyFrom(inst.body.rotation);
    m.scaling.copyFrom(inst.body.scaling);
    m.isPickable = false;
    m.receiveShadows = true;
    m.setBoundingInfo(new BoundingInfo(new Vector3(-1, -0.3, -1.1), new Vector3(1, 2, 1.1)));
    return m;
  }
}

/**
 * Garante que os índices de osso da roupa apontem para os mesmos ossos do
 * esqueleto do personagem (os GLBs vêm do mesmo esqueleto do Blender, mas a
 * ordem das juntas não é garantida pelo formato).
 */
function remapJoints(mesh: Mesh, bodyBones: string[], url: string): void {
  const own = mesh.skeleton!.bones.map((b) => b.name);
  if (own.length === bodyBones.length && own.every((n, i) => n === bodyBones[i])) return;
  const map = own.map((n) => {
    const i = bodyBones.indexOf(n);
    if (i < 0) throw new Error(`${url}: osso "${n}" não existe no personagem-base`);
    return i;
  });
  for (const kind of [VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesIndicesExtraKind]) {
    const data = mesh.getVerticesData(kind);
    if (!data) continue;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = map[data[i]];
    mesh.setVerticesData(kind, out, false, 4);
  }
  console.info(`[GarmentAsset] ordem dos ossos de ${url} remapeada para o personagem-base`);
}
