import '@babylonjs/loaders/glTF';
import {
  AssetContainer,
  BoundingInfo,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  PBRMaterial,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { CHAR_PART_ATTRIBUTE } from './ClothingMaterial';

export type ClipName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'crouch' | 'climb' | 'aim' | 'shoot' | 'reload' | 'death';
export const CLIP_NAMES: ClipName[] = ['idle', 'walk', 'run', 'sprint', 'jump', 'crouch', 'climb', 'aim', 'shoot', 'reload', 'death'];
const LOOPING: ReadonlySet<ClipName> = new Set(['idle', 'walk', 'run', 'sprint', 'crouch', 'climb', 'aim']);

/** Taxa em que as animações do GLB são amostradas (o export do Blender usa 30 quadros/s). */
export const CLIP_FPS = 30;

/** Animação pré-amostrada: rotação local de cada osso por quadro e posição do quadril. */
export interface Clip {
  name: ClipName;
  duration: number;
  loop: boolean;
  frames: number;
  /** Por osso (mesma ordem de `boneNames`): quatérnios xyzw por quadro, ou null se o osso não é animado. */
  rot: Array<Float32Array | null>;
  hips: Float32Array | null;
}

export interface CharacterInstance {
  /** Raiz do glTF (converte o sistema de coordenadas); deve ser filha de um nó do personagem. */
  root: TransformNode;
  body: Mesh;
  /** Nós dos ossos que deformam, na ordem de `CharacterAsset.boneNames`. */
  bones: TransformNode[];
  nodes: Map<string, TransformNode>;
}

const UPPER_FULL = /^(Spine2|Neck|Head|Left|Right)/;
const LEG = /UpLeg|Leg|Foot|ToeBase/;

/**
 * Personagem-base (`public/models/personagem-base.glb`) carregado uma única vez.
 * As 11 animações viram tabelas de quatérnios (consulta barata por quadro, sem o
 * runtime de animação do Babylon) e cada personagem é um clone com esqueleto
 * próprio que compartilha geometria, texturas e shaders.
 */
export class CharacterAsset {
  static current: CharacterAsset | null = null;

  readonly boneNames: string[];
  /** Todos os ossos do esqueleto (encaixes incluídos), na ordem das juntas do glTF. */
  readonly skeletonBones: string[];
  readonly clips: Record<ClipName, Clip>;
  /** Peso da camada de tronco (mira/tiro/recarga) por osso: 0 = pernas/quadril, 1 = tronco e braços. */
  readonly upperMask: Float32Array;
  /** Rotação de repouso de cada osso no espaço do glTF (para inclinar a coluna pela mira). */
  readonly restWorld: Quaternion[];
  readonly restLocal: Quaternion[];
  readonly restHips: Vector3;
  readonly baseMaterial: PBRMaterial;

  private constructor(private readonly container: AssetContainer) {
    const template = this.templateBody();
    const skeleton = template.skeleton!;
    this.skeletonBones = skeleton.bones.map((b) => b.name);
    this.boneNames = this.skeletonBones.filter((n) => !n.startsWith('socket_'));
    const nodeOf = new Map<string, TransformNode>();
    for (const n of container.transformNodes) nodeOf.set(n.name, n);

    this.restLocal = this.boneNames.map((n) => nodeOf.get(n)!.rotationQuaternion?.clone() ?? Quaternion.Identity());
    this.restHips = nodeOf.get('Hips')!.position.clone();
    const esq = nodeOf.get('Hips')!.parent as TransformNode;
    const esqInv = Matrix.Invert(esq.computeWorldMatrix(true));
    this.restWorld = this.boneNames.map((n) => {
      const m = nodeOf.get(n)!.computeWorldMatrix(true).multiply(esqInv);
      const q = new Quaternion();
      m.decompose(undefined, q, undefined);
      return q;
    });
    this.upperMask = new Float32Array(this.boneNames.map((n) => (n === 'Spine1' ? 0.5 : UPPER_FULL.test(n) && !LEG.test(n) ? 1 : 0)));

    this.clips = {} as Record<ClipName, Clip>;
    for (const name of CLIP_NAMES) this.clips[name] = this.bake(name);
    // As tabelas substituem os AnimationGroups: as instâncias não precisam deles.
    for (const g of [...container.animationGroups]) g.dispose();
    container.animationGroups.length = 0;

    this.baseMaterial = template.material as PBRMaterial;
    this.computeBodyParts(template, nodeOf);
  }

  static async load(scene: Scene): Promise<CharacterAsset> {
    const url = `${import.meta.env.BASE_URL}models/personagem-base.glb`;
    const container = await LoadAssetContainerAsync(url, scene);
    const asset = new CharacterAsset(container);
    CharacterAsset.current = asset;
    return asset;
  }

  private templateBody(): Mesh {
    const m = this.container.meshes.find((x) => x.skeleton && x.getTotalVertices() > 0);
    if (!m) throw new Error('personagem-base.glb: malha com esqueleto não encontrada');
    return m as Mesh;
  }

  private bake(name: ClipName): Clip {
    const group = this.container.animationGroups.find((g) => g.name === name);
    if (!group) throw new Error(`personagem-base.glb: animação "${name}" não encontrada`);
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const duration = (group.to - group.from) / fps;
    const frames = Math.round(duration * CLIP_FPS) + 1;
    const rot: Array<Float32Array | null> = this.boneNames.map(() => null);
    let hips: Float32Array | null = null;
    for (const ta of group.targetedAnimations) {
      const target = ta.target as TransformNode;
      const bone = this.boneNames.indexOf(target.name);
      if (bone < 0) continue;
      const anim = ta.animation;
      if (anim.targetProperty === 'rotationQuaternion') {
        const out = new Float32Array(frames * 4);
        let prev: Quaternion | null = null;
        for (let f = 0; f < frames; f++) {
          const q = (anim.evaluate(group.from + (f / CLIP_FPS) * fps) as Quaternion).clone();
          if (prev && Quaternion.Dot(prev, q) < 0) q.scaleInPlace(-1);
          prev = q;
          out.set([q.x, q.y, q.z, q.w], f * 4);
        }
        rot[bone] = out;
      } else if (anim.targetProperty === 'position' && target.name === 'Hips') {
        hips = new Float32Array(frames * 3);
        for (let f = 0; f < frames; f++) {
          const v = anim.evaluate(group.from + (f / CLIP_FPS) * fps) as Vector3;
          hips.set([v.x, v.y, v.z], f * 3);
        }
      }
    }
    return { name, duration, loop: LOOPING.has(name), frames, rot, hips };
  }

  /**
   * Atributo `charPart` (compartilhado por todos os clones): quanto cada vértice
   * pertence ao braço e onde fica ao longo dele. O shader das roupas usa isso
   * para separar manga, mão e coxa (as mãos ficam encostadas no quadril).
   */
  private computeBodyParts(body: Mesh, nodeOf: Map<string, TransformNode>): void {
    const pos = body.getVerticesData('position')!;
    const idx = body.getVerticesData('matricesIndices')!;
    const wts = body.getVerticesData('matricesWeights')!;
    const bones = body.skeleton!.bones;
    const isArm = bones.map((b) => /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/.test(b.name));
    const esqInv = Matrix.Invert((nodeOf.get('Hips')!.parent as TransformNode).computeWorldMatrix(true));
    const at = (n: string) => Vector3.TransformCoordinates(Vector3.Zero(), nodeOf.get(n)!.computeWorldMatrix(true).multiply(esqInv));
    const shoulder = at('LeftArm');
    const wrist = at('LeftHand');
    const axis = wrist.subtract(shoulder);
    const len2 = axis.lengthSquared();
    const n = pos.length / 3;
    const data = new Float32Array(n * 2);
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      let arm = 0;
      for (let k = 0; k < 4; k++) if (isArm[idx[i * 4 + k]]) arm += wts[i * 4 + k];
      p.set(Math.abs(pos[i * 3]), pos[i * 3 + 1], pos[i * 3 + 2]);
      const t = Vector3.Dot(p.subtract(shoulder), axis) / len2;
      data[i * 2] = arm;
      data[i * 2 + 1] = Math.min(1, Math.max(0, t));
    }
    body.setVerticesData(CHAR_PART_ATTRIBUTE, data, false, 2);
  }

  instantiate(): CharacterInstance {
    const entries = this.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = entries.rootNodes[0] as TransformNode;
    const nodes = new Map<string, TransformNode>();
    for (const d of root.getDescendants(false)) if (d instanceof TransformNode) nodes.set(d.name, d);
    const body = root.getChildMeshes(false).find((m) => m.skeleton) as Mesh;
    body.isPickable = false;
    body.receiveShadows = true;
    // Caixa larga o suficiente para as poses deitado/queda livre (o padrão é a pose de repouso).
    body.setBoundingInfo(new BoundingInfo(new Vector3(-1, -0.3, -1.1), new Vector3(1, 2, 1.1)));
    const bones = this.boneNames.map((name) => {
      const node = nodes.get(name)!;
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.Identity();
      return node;
    });
    return { root, body, bones, nodes };
  }
}
