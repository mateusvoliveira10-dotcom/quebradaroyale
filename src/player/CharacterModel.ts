import {
  Color3,
  DynamicTexture,
  FresnelParameters,
  Matrix,
  Mesh,
  MeshBuilder,
  Node,
  PBRMaterial,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { Appearance, defaultAppearance } from '../appearance/Appearance';
import { glassesById } from '../customization/glasses';
import { HAIR_MESH } from '../customization/hair';
import { CHAIN_CATALOG } from '../customization/chains';
import { bottomById, GarmentSlot, shoeById } from '../customization/garments';
import { JERSEY_SHARED, jerseyById } from '../customization/jerseys';
import { clamp, damp } from '../utils/random';
import { CharacterAsset, CharacterInstance, Clip, CLIP_FPS, ClipName } from './CharacterAsset';
import { clothingKey, clothingMaterial } from './ClothingMaterial';
import { GarmentAsset, UNDER_SHIRT } from './GarmentAsset';
import { glassesMaterials, studioMaterial } from './GlassesMaterial';

const OUTLINE = Color3.FromHexString('#1a1218');

const capTexCache = new Map<string, DynamicTexture>();

/**
 * Tecido do boné: sarja com trama, costuras dos 6 gomos e ilhoses (copa) ou pespontos
 * paralelos à borda (aba). Na copa, u = volta em torno da cabeça e v = da base ao topo.
 */
/** Emblema bordado genérico: círculo com uma onda (sem logotipo de marca). */
function emblemTexture(scene: Scene, fg: string, bg: string): DynamicTexture {
  const key = `${scene.uid}:emblema:${fg}:${bg}`;
  const hit = capTexCache.get(key);
  if (hit) return hit;
  const s = 128;
  const t = new DynamicTexture(`cap_emblema_${fg}`, { width: s, height: s }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = bg;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const x = s * 0.2 + (s * 0.6 * i) / 20;
    const y = s / 2 + Math.sin((i / 20) * Math.PI * 2) * s * 0.12;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  t.update(true);
  capTexCache.set(key, t);
  return t;
}

function capTexture(scene: Scene, part: 'copa' | 'aba', base: string, trim: string, brim: boolean): DynamicTexture {
  const key = `${scene.uid}:${part}:${base}:${trim}`;
  const hit = capTexCache.get(key);
  if (hit) return hit;
  const s = 256;
  const t = new DynamicTexture(`cap_${part}_${base}`, { width: s, height: s }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  // Trama de sarja (diagonais finas claras/escuras).
  for (let i = -s; i < s; i += 3) {
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + s, s);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  if (!brim) {
    // Costuras dos gomos (duas linhas de pesponto de cada lado) e ilhoses perto do topo.
    for (let k = 0; k < 6; k++) {
      const u = (k / 6) * s;
      for (const d of [-3, 3]) {
        ctx.beginPath();
        ctx.moveTo(u + d, 0);
        ctx.lineTo(u + d, s);
        ctx.stroke();
      }
    }
    // Sombra suave perto da base (dobra da faixa interna).
    const g = ctx.createLinearGradient(0, s, 0, s * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, s * 0.85, s, s * 0.15);
  } else {
    // Pespontos paralelos à borda da aba (v = do encaixe até a borda).
    for (const v of [0.35, 0.5, 0.65, 0.8, 0.93]) {
      ctx.beginPath();
      ctx.moveTo(0, v * s);
      ctx.lineTo(s, v * s);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  t.update(true);
  t.anisotropicFilteringLevel = 4;
  capTexCache.set(key, t);
  return t;
}

export type AnimMode = 'normal' | 'climb' | 'vault' | 'freefall' | 'parachute' | 'plane' | 'dead';
export type HoldStyle = 'pistol' | 'rifle' | null;

export interface AnimInput {
  speed: number;
  runSpeed: number;
  grounded: boolean;
  verticalSpeed: number;
  crouching: boolean;
  sprinting: boolean;
  mode: AnimMode;
  /** Progresso 0..1 da escalada/vault. */
  traversalT: number;
  hold: HoldStyle;
  aiming: boolean;
  /** Inclinação da mira (rad, positivo = olhando para cima). */
  aimPitch: number;
  /** Progresso 0..1 da recarga, ou -1. */
  reloadT: number;
  /** Velocidade local (m/s): lateral (+ = direita) e para a frente do corpo. */
  localVelX: number;
  localVelZ?: number;
  /** Giro do corpo (rad/s, + = para a direita), para inclinar nas curvas. */
  turnRate?: number;
  /** Deslizando (agachou durante o sprint). */
  sliding?: boolean;
  /** 0..1: quanto o personagem está mergulhando na queda livre. */
  dive: number;
}

type Group = 'hair' | 'glasses' | 'acc';

export type LodLevel = 0 | 1 | 2 | 3;
/** De quantos em quantos quadros o esqueleto é recalculado em cada nível de detalhe. */
const LOD_POSE_EVERY: Record<LodLevel, number> = { 0: 1, 1: 2, 2: 4, 3: 10 };
/** Clipes da camada de corpo inteiro (a de tronco usa aim/shoot/reload). */
const BASE_CLIPS: ClipName[] = ['idle', 'walk', 'run', 'sprint', 'jump', 'crouch', 'climb', 'death'];
/** Distância percorrida por ciclo de passada de cada clipe (m), para sincronizar pés e chão. */
const STRIDE: Partial<Record<ClipName, number>> = { walk: 1.9, run: 3.3, sprint: 4.6, crouch: 1.5 };

/** Momentos (s) do clipe `jump` usados como poses: impulso, ápice, queda e aterrissagem. */
const JUMP_TAKEOFF = 11 / 30;
const JUMP_APEX = 19 / 30;
const JUMP_FALL = 27 / 30;

interface MatOpts {
  tex?: Texture;
  spec?: number;
  power?: number;
  rim?: string;
  rimStrength?: number;
  emissive?: number;
  alpha?: boolean;
}

const matCache = new Map<string, StandardMaterial>();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpM = new Matrix();

/**
 * Personagem-base do GLB (`public/models/personagem-base.glb`) com esqueleto
 * Mixamo. As animações do GLB são misturadas por pesos em duas camadas: corpo
 * inteiro (parado, andar, correr, sprint, pulo, agachar, escalar, morte) e
 * tronco (mira, tiro, recarga), separadas por uma máscara de ossos. Roupas,
 * meias, tênis e o degradê do cabelo são pintados no corpo pelo shader
 * (ClothingMaterial); cabelo alto, boné, óculos, corrente, relógio, pulseiras,
 * mochila e armas são malhas rígidas presas aos nós `socket_*`. Olha para +Z,
 * pés em y = 0.
 */
export class CharacterModel {
  readonly root: TransformNode;
  /** Ponto onde a arma empunhada é presa (filho de `socket_weapon_R`). */
  readonly weaponMount: TransformNode;
  /** Ponto onde a arma guardada fica (costas, filho de `socket_back`). */
  readonly backMount: TransformNode;
  /** Chamado a cada passada no chão (para som de passos). */
  onFootstep: ((running: boolean) => void) | null = null;

  private readonly asset: CharacterAsset;
  private readonly inst: CharacterInstance;
  /** Gira o corpo inteiro em torno do quadril (queda livre). */
  private readonly pivot: TransformNode;
  private readonly offset: TransformNode;
  private readonly headMount: TransformNode;
  private readonly eyesMount: TransformNode;
  private readonly spineMount: TransformNode;
  private readonly wristL: TransformNode;
  private readonly wristR: TransformNode;

  private readonly groups: Record<Group, Mesh[]> = { hair: [], glasses: [], acc: [] };
  /** Roupas 3D equipadas por slot (null = nada no slot). */
  private readonly garments: Record<GarmentSlot, { mesh: Mesh; meshName: string } | null> = { top: null, bottom: null, feet: null };
  private readonly details = new Set<Mesh>();
  private readonly silhouettes = new Set<Mesh>();
  private appearance: Appearance = defaultAppearance();
  private shadowGen: ShadowGenerator | null = null;
  private outlineOn = true;
  private lodLevel: LodLevel = 0;
  /** Nó onde worldOf para de subir durante a IK (ver solveSupportArm). */
  private ikRoot: TransformNode | null = null;
  private lodNear = true;
  private shadowsOn = true;
  private building: Group | null = null;

  // ---- animação
  private readonly weights: Record<ClipName, number>;
  private readonly targets: Record<ClipName, number>;
  private readonly times: Record<ClipName, number>;
  private upperWeight = 0;
  private aimTime = 0;
  private shootT = 99;
  private phase = 0;
  private time = Math.random() * 10;
  private landImpact = 0;
  private deathT = 0;
  private pitch = 0;
  private bodyPitch = 0;
  /** Inclinação lateral do corpo nas curvas (rad). */
  private bodyRoll = 0;
  /** Inclinação do tronco para a frente (sprint). */
  private lean = 0;
  /**
   * Giro do quadril para o lado em que se anda (strafe/andar para trás com arma): as pernas
   * andam na direção do movimento e o tronco gira de volta, mantendo a mira.
   */
  private hipYaw = 0;
  /** -1: clipe de locomoção tocando ao contrário (andando de costas). */
  private phaseDir = 1;
  /** Pesos das poses aéreas (queda livre em "caixa" e pendurado no paraquedas). */
  private freefallW = 0;
  private chuteW = 0;
  private skipCount = 0;
  private readonly pitchAxis: Vector3[];
  /** Eixo vertical do personagem no espaço local de cada osso em repouso. */
  private readonly yawAxis: Vector3[];
  private readonly hipsBone: number;
  private readonly spine0: number;
  private readonly spine1: number;
  private readonly spine2: number;
  private readonly hipsNode: TransformNode;
  private supportGrip: Vector3 | null = null;
  /** Raiz do clone dos óculos (presa ao nó dos olhos). */
  private glassesRoot: TransformNode | null = null;
  private holdStyle: HoldStyle = null;
  /** Empunhadura da mão direita no espaço da Spine2 (fuzil junto ao peito, pistola com braços estendidos). */
  private readonly rifleGrip: Vector3;
  private readonly pistolGrip: Vector3;

  constructor(
    private readonly scene: Scene,
    parent: Node,
    appearance?: Appearance,
  ) {
    const asset = CharacterAsset.current;
    if (!asset) throw new Error('CharacterAsset não carregado (CharacterAsset.load antes de criar personagens)');
    this.asset = asset;

    this.root = new TransformNode('characterRoot', scene);
    this.root.parent = parent;
    this.pivot = new TransformNode('characterPivot', scene);
    this.pivot.parent = this.root;
    this.pivot.position.y = 0.95;
    this.offset = new TransformNode('characterOffset', scene);
    this.offset.parent = this.pivot;
    this.offset.position.y = -0.95;

    this.inst = asset.instantiate();
    this.inst.root.parent = this.offset;
    const body = this.inst.body;
    body.renderOutline = true;
    body.outlineColor = OUTLINE;
    body.outlineWidth = 0.006;
    this.silhouettes.add(body);
    this.hipsNode = this.inst.nodes.get('Hips')!;

    this.weights = {} as Record<ClipName, number>;
    this.targets = {} as Record<ClipName, number>;
    this.times = {} as Record<ClipName, number>;
    for (const c of BASE_CLIPS) {
      this.weights[c] = c === 'idle' ? 1 : 0;
      this.targets[c] = 0;
      this.times[c] = 0;
    }
    this.hipsBone = asset.boneNames.indexOf('Hips');
    this.spine0 = asset.boneNames.indexOf('Spine');
    this.spine1 = asset.boneNames.indexOf('Spine1');
    this.spine2 = asset.boneNames.indexOf('Spine2');
    // Eixos lateral (glTF +X) e vertical (glTF +Y) do personagem no espaço local de cada osso em repouso.
    this.pitchAxis = asset.restWorld.map((q) => {
      q.toRotationMatrix(tmpM);
      return Vector3.TransformNormal(Vector3.Right(), tmpM.transpose()).normalize();
    });
    this.yawAxis = asset.restWorld.map((q) => {
      q.toRotationMatrix(tmpM);
      return Vector3.TransformNormal(Vector3.Up(), tmpM.transpose()).normalize();
    });

    // ---------- Encaixes: adaptadores no "espaço do personagem" ----------
    // O modelo procedural servia de referência para os acessórios: cada adaptador
    // leva aquele espaço (cabeça, peito, coluna, antebraço) para o encaixe do GLB.
    const head = this.charSpace(new Vector3(0, 1.528, 0.005), new Vector3(0.84, 0.82, 0.97));
    this.headMount = this.adapter('head', 'socket_head_top', head);
    // Óculos em medidas reais do GLB: origem no centro dos olhos (1,615 m; o socket_eyes fica
    // ~3 cm acima, em 1,645 m), sem escala.
    this.eyesMount = this.adapter('eyes', 'socket_eyes', this.charSpace(new Vector3(0, 1.615, 0), Vector3.One()));
    this.spineMount = this.adapter('spine', 'socket_back', this.charSpace(new Vector3(0, 0.97, -0.035), new Vector3(0.93, 0.95, 0.86)));
    this.wristL = this.adapter('wristL', 'socket_wrist_L', this.forearmSpace('LeftForeArm', 'LeftHand'));
    this.wristR = this.adapter('wristR', 'socket_wrist_R', this.forearmSpace('RightForeArm', 'RightHand'));
    this.backMount = new TransformNode('backMount', scene);
    this.backMount.parent = this.spineMount;
    this.backMount.position.set(0, 0.36, -0.16);
    this.backMount.rotation.set(0, Math.PI / 2, 0.75);
    this.weaponMount = this.createWeaponMount();
    // Pontos em repouso (glTF: +X esquerda, +Z frente) levados para o espaço da Spine2.
    const esqInv = Matrix.Invert(this.worldOf(this.hipsNode.parent as TransformNode));
    const spineInv = Matrix.Invert(this.worldOf(this.inst.nodes.get('Spine2')!).multiply(esqInv));
    this.rifleGrip = Vector3.TransformCoordinates(new Vector3(-0.12, 1.24, 0.2), spineInv);
    this.pistolGrip = Vector3.TransformCoordinates(new Vector3(-0.06, 1.3, 0.36), spineInv);

    this.setAppearance(appearance ?? defaultAppearance());
  }

  get meshes(): Mesh[] {
    const garments = Object.values(this.garments).flatMap((g) => (g ? [g.mesh] : []));
    return [this.inst.body, ...garments, ...Object.values(this.groups).flat()];
  }

  /**
   * Malhas que projetam sombra. As roupas 3D ficam de fora: o corpo por baixo (1–2 cm
   * menor) já projeta praticamente a mesma sombra, e assim cada personagem economiza
   * três desenhos com esqueleto na passada de sombra.
   */
  private get shadowMeshes(): Mesh[] {
    return [this.inst.body, ...Object.values(this.groups).flat()];
  }

  get currentAppearance(): Appearance {
    return this.appearance;
  }

  // ------------------------------------------------------------- encaixes

  /** Matriz de mundo atualizada de um nó (recalcula a cadeia de pais). */
  private worldOf(node: TransformNode): Matrix {
    const chain: TransformNode[] = [];
    // Durante a IK o esqueleto (e tudo acima dele) não muda: a cadeia para nele, que já foi
    // calculado no começo (eram ~110 recálculos da hierarquia inteira por personagem).
    for (let n: Node | null = node; n && n !== this.ikRoot; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
    for (const n of chain) n.computeWorldMatrix(true);
    return node.getWorldMatrix();
  }

  /** Espaço do personagem (+Z frente, -X esquerda) com origem dada em coordenadas do glTF. */
  private charSpace(originGltf: Vector3, scale: Vector3): Matrix {
    const o = new Vector3(-originGltf.x, originGltf.y, originGltf.z);
    return Matrix.Compose(scale, Quaternion.Identity(), o).multiply(this.worldOf(this.offset));
  }

  /** Espaço do antebraço do modelo procedural: origem no cotovelo, +Y do punho para o cotovelo. */
  private forearmSpace(elbowName: string, wristName: string): Matrix {
    const elbow = this.worldOf(this.inst.nodes.get(elbowName)!).getTranslation();
    const wrist = this.worldOf(this.inst.nodes.get(wristName)!).getTranslation();
    const y = elbow.subtract(wrist).normalize();
    const fwd = Vector3.TransformNormal(Vector3.Forward(), this.worldOf(this.offset)).normalize();
    const z = fwd.subtract(y.scale(Vector3.Dot(fwd, y))).normalize();
    const x = Vector3.Cross(y, z).normalize();
    const s = 0.95;
    const m = new Matrix();
    Matrix.FromXYZAxesToRef(x.scale(s), y.scale(s), z.scale(s), m);
    m.setTranslation(elbow);
    return m;
  }

  /** Cria um nó filho do encaixe cuja matriz de mundo (na pose de repouso) é `world`. */
  private adapter(name: string, socket: string, world: Matrix): TransformNode {
    const s = this.inst.nodes.get(socket);
    if (!s) throw new Error(`personagem-base.glb: encaixe ${socket} não encontrado`);
    const n = new TransformNode(`${name}Mount`, this.scene);
    n.parent = s;
    n.rotationQuaternion = new Quaternion();
    world.multiply(Matrix.Invert(this.worldOf(s))).decompose(n.scaling, n.rotationQuaternion, n.position);
    return n;
  }

  /**
   * Arma na mão direita, orientada para que o cano aponte para a frente com o
   * personagem na pose de mira (a mesma usada para empunhar).
   */
  private createWeaponMount(): TransformNode {
    const aim = this.asset.clips.aim;
    const bones = this.inst.bones;
    bones.forEach((b, i) => this.sampleRot(aim, i, 0, b.rotationQuaternion!));
    const socket = this.inst.nodes.get('socket_weapon_R')!;
    const sw = this.worldOf(socket);
    const rot = new Quaternion();
    this.worldOf(this.offset).decompose(undefined, rot, undefined);
    const desired = Matrix.Compose(Vector3.One(), rot, sw.getTranslation());
    const n = new TransformNode('weaponMount', this.scene);
    n.parent = socket;
    n.rotationQuaternion = new Quaternion();
    desired.multiply(Matrix.Invert(sw)).decompose(n.scaling, n.rotationQuaternion, n.position);
    bones.forEach((b, i) => b.rotationQuaternion!.copyFrom(this.asset.restLocal[i]));
    return n;
  }

  // ------------------------------------------------------------- aparência

  setShadowGenerator(sg: ShadowGenerator | null): void {
    this.shadowGen = sg;
    if (sg) for (const m of this.shadowMeshes) sg.addShadowCaster(m, false);
  }

  /**
   * Nível de detalhe (otimização para bots): 0 = perto (tudo), 1 = médio (sem
   * detalhes finos, animação a cada 2 quadros), 2 = longe (sem sombra,
   * animação a cada 4 quadros), 3 = fora da tela (pose a cada 10 quadros, só para
   * não ficar parada se a câmera virar de repente).
   */
  setLod(level: LodLevel): void {
    this.lodLevel = level;
    const near = level === 0;
    if (near !== this.lodNear) {
      this.lodNear = near;
      for (const m of this.details) m.setEnabled(near);
    }
    const shadows = level < 2;
    if (shadows !== this.shadowsOn && this.shadowGen) {
      this.shadowsOn = shadows;
      for (const m of this.shadowMeshes) {
        if (shadows) this.shadowGen.addShadowCaster(m, false);
        else this.shadowGen.removeShadowCaster(m, false);
      }
    }
  }

  setOutline(on: boolean): void {
    if (on === this.outlineOn) return;
    this.outlineOn = on;
    for (const m of this.silhouettes) m.renderOutline = on;
  }

  /** Troca roupas (material do corpo) e acessórios (só reconstrói o que mudou). */
  setAppearance(app: Appearance): void {
    const prev = this.appearance;
    const first = this.groups.hair.length === 0 && !this.inst.body.material?.name.startsWith('personagem_');
    const accChanged = first || prev.accessories.join() !== app.accessories.join();
    this.appearance = { ...app, accessories: [...app.accessories] };
    if (first || clothingKey(prev) !== clothingKey(app)) {
      this.inst.body.material = clothingMaterial(this.scene, this.asset.baseMaterial, app);
    }
    if (first || prev.jersey !== app.jersey) {
      const j = app.jersey === 'none' ? undefined : jerseyById(app.jersey);
      this.applyGarment('top', j ? JERSEY_SHARED.meshName[j.collar] : null, j?.id ?? null);
    }
    // Com camisa, a parte de baixo usa a variante encolhida no cós (não fura a barra).
    if (first || prev.bottom !== app.bottom || (prev.jersey === 'none') !== (app.jersey === 'none')) {
      const b = bottomById(app.bottom);
      const mesh = b && app.jersey !== 'none' ? `${b.mesh}${UNDER_SHIRT}` : b?.mesh;
      this.applyGarment('bottom', mesh ?? null, b?.id ?? null);
    }
    if (first || prev.shoes !== app.shoes) {
      const s = shoeById(app.shoes);
      this.applyGarment('feet', s?.mesh ?? null, s?.id ?? null);
    }
    if (first || prev.glasses !== app.glasses) this.rebuild('glasses', () => this.buildGlasses());
    if (accChanged || prev.jersey !== app.jersey) this.rebuild('acc', () => this.buildAccessories());
    // O boné esconde o topete (o degradê pintado continua por baixo).
    if (first || prev.hair !== app.hair || accChanged) this.rebuild('hair', () => this.buildHair());
  }

  /**
   * Roupa 3D de um slot: malha comum (por modelo) + material da peça. Trocar
   * entre peças da mesma malha só troca o material; mudar de malha troca a malha.
   */
  private applyGarment(slot: GarmentSlot, meshName: string | null, materialId: string | null): void {
    const cur = this.garments[slot];
    if (cur && cur.meshName !== meshName) {
      this.silhouettes.delete(cur.mesh);
      cur.mesh.dispose(false, false);
      this.garments[slot] = null;
    }
    const asset = GarmentAsset.current;
    if (!meshName || !materialId || !asset) return;
    let g = this.garments[slot];
    if (!g) {
      const m = asset.create(this.inst, meshName);
      m.renderOutline = this.outlineOn;
      m.outlineColor = OUTLINE;
      m.outlineWidth = this.inst.body.outlineWidth;
      this.silhouettes.add(m);
      g = { mesh: m, meshName };
      this.garments[slot] = g;
    }
    g.mesh.material = asset.material(materialId);
  }

  private rebuild(group: Group, build: () => void): void {
    for (const m of this.groups[group]) {
      this.shadowGen?.removeShadowCaster(m, false);
      this.details.delete(m);
      this.silhouettes.delete(m);
      m.dispose(false, false);
    }
    this.groups[group] = [];
    this.building = group;
    build();
    this.building = null;
    for (const m of this.groups[group]) {
      if (this.shadowsOn) this.shadowGen?.addShadowCaster(m, false);
      if (!this.lodNear && this.details.has(m)) m.setEnabled(false);
    }
  }

  /**
   * Cabelo 3D (malha moldada no couro cabeludo, `tools/blender/hair.py`) acima do degradê,
   * que é pintado no corpo. Com boné, só o degradê aparece.
   */
  private buildHair(): void {
    const id = this.appearance.hair;
    const capOn = this.appearance.accessories.some((a) => a.startsWith('bone_'));
    const asset = GarmentAsset.current;
    if (capOn || !asset) return;
    const m = asset.create(this.inst, HAIR_MESH[id]);
    m.material = asset.material(`cabelo_${id}`);
    // Sem contorno: a borda da malha fica sobre o degradê, e o contorno desenhava uma linha ali.
    this.groups.hair.push(m);
  }

  /**
   * Óculos: clone do modelo 3D único (`tools/blender/glasses.py`), já encaixado no rosto do
   * manequim, com origem no centro dos olhos, e preso ao nó dos olhos (que segue o osso da
   * cabeça). A variação escolhida só troca os materiais: armação, detalhes e lentes.
   */
  private buildGlasses(): void {
    this.glassesRoot?.dispose(false, false);
    this.glassesRoot = null;
    const g = glassesById(this.appearance.glasses);
    const parts = g ? GarmentAsset.current?.createGlasses() : null;
    if (!g || !parts) return;
    parts.root.parent = this.eyesMount;
    this.glassesRoot = parts.root;
    // PBR com reflexo de um estúdio próprio (metal e lente espelhada de verdade).
    const { frame, accent, lens } = glassesMaterials(this.scene, g);
    for (const [m, mat] of [[parts.frame, frame], [parts.accent, accent], [parts.lens, lens]] as const) {
      m.material = mat;
      m.isPickable = false;
      m.receiveShadows = false;
      this.details.add(m);
      this.groups.glasses.push(m);
    }
  }

  private buildAccessories(): void {
    const acc = this.appearance.accessories;
    const s2 = this.scene;
    // Boné e detalhe da mochila combinam com a camisa (sem camisa: grafite).
    const j = this.appearance.jersey === 'none' ? undefined : jerseyById(this.appearance.jersey);
    const jersey = { base: j?.primary ?? '#2d3340', trim: j?.trim ?? '#ffd21f' };
    const has = (id: string) => acc.includes(id as never);

    // Corrente de MC: elos 3D com skinning no tronco/pescoço (tools/blender/chains.py),
    // assentados por cima de qualquer camisa. Ouro e pedras com o reflexo do estúdio.
    const chain = CHAIN_CATALOG.find((c) => has(c.id));
    const asset = GarmentAsset.current;
    if (chain && asset) {
      const parts: Array<[string, PBRMaterial]> = [[chain.gold, studioMaterial(this.scene, 'corrente_ouro', '#ffb52e', 1, 0.2, 1.25)]];
      if (chain.stones) parts.push([chain.stones, studioMaterial(this.scene, 'corrente_pedras', '#f4f8ff', 0.75, 0.02, 1.6)]);
      for (const [meshName, mat] of parts) {
        const m = asset.create(this.inst, meshName);
        m.material = mat;
        m.receiveShadows = false;
        this.groups.acc.push(m);
        // Muitos elos: só de perto (LOD), como os outros detalhes finos.
        this.details.add(m);
      }
    }
    if (has('bone_tras') || has('bone_frente') || has('bone_aba_reta')) this.buildCap(has('bone_frente') ? 'curva' : 'reta', has('bone_tras'), jersey);
    if (has('pulseiras')) {
      const cols = ['#ffc23a', '#16100c', '#1fa64a'];
      cols.forEach((c, i) => {
        this.add(MeshBuilder.CreateTorus('bracelet', { diameter: 0.088, thickness: 0.012, tessellation: 16 }, s2), this.mat(`bracelet_${c}`, c, { spec: 0.8, power: 60 }), this.wristR, { y: -0.215 + i * 0.016 }, false, true);
      });
    }
    if (has('relogio')) {
      const band = this.mat('watch_band', '#202020', { spec: 0.8, power: 60 });
      const face = this.mat('watch_face', '#ffc23a', { spec: 1.2, power: 80 });
      this.add(MeshBuilder.CreateCylinder('watch', { diameter: 0.088, height: 0.035, tessellation: 16 }, s2), band, this.wristL, { y: -0.225 }, false);
      this.add(MeshBuilder.CreateCylinder('watchFace', { diameter: 0.04, height: 0.012, tessellation: 12 }, s2), face, this.wristL, { y: -0.225, z: -0.042, rx: Math.PI / 2 }, false, true);
    }
    const backpack = has('mochila');
    this.backMount.position.z = backpack ? -0.32 : -0.16;
    if (backpack) {
      const bag = this.mat('backpack', '#2d3340', { spec: 0.25, rim: '#9fb4ff', rimStrength: 0.2 });
      const bagAccent = this.mat(`backpackAccent_${jersey.trim}`, jersey.trim, { spec: 0.2 });
      const sp = this.spineMount;
      this.add(MeshBuilder.CreateBox('bagBody', { width: 0.3, height: 0.38, depth: 0.14 }, s2), bag, sp, { y: 0.28, z: -0.2 });
      this.add(MeshBuilder.CreateBox('bagPocket', { width: 0.22, height: 0.15, depth: 0.05 }, s2), bag, sp, { y: 0.2, z: -0.29 }, false);
      this.add(MeshBuilder.CreateBox('bagZip', { width: 0.24, height: 0.02, depth: 0.06 }, s2), bagAccent, sp, { y: 0.28, z: -0.29 }, false, true);
      for (const side of [-1, 1]) {
        this.add(MeshBuilder.CreateBox('strap', { width: 0.04, height: 0.34, depth: 0.018 }, s2), bag, sp, { x: side * 0.09, y: 0.3, z: 0.142, rx: -0.12 }, false, true);
        this.add(MeshBuilder.CreateBox('strapTop', { width: 0.04, height: 0.018, depth: 0.27 }, s2), bag, sp, { x: side * 0.09, y: 0.48, z: 0.0 }, false, true);
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Boné de 6 gomos: copa com costuras, ilhoses e botão, faixa interna, aba com pespontos e
   * forro de baixo, e emblema bordado genérico na frente (sem logotipo de marca). Aba curva
   * (estilo "dad cap" de grife esportiva) ou reta (snapback); `back` gira o boné para trás.
   */
  private buildCap(style: 'curva' | 'reta', back: boolean, jersey: { base: string; trim: string }): void {
    const s2 = this.scene;
    const reta = style === 'reta';
    const crownTex = capTexture(s2, 'copa', jersey.base, jersey.trim, false);
    const brimTex = capTexture(s2, 'aba', jersey.base, jersey.trim, true);
    const crown = this.mat(`capCrown_${jersey.base}_${jersey.trim}`, '#ffffff', { spec: 0.12, power: 20, tex: crownTex });
    const brim = this.mat(`capBrimTop_${jersey.base}_${jersey.trim}`, '#ffffff', { spec: 0.12, power: 20, tex: brimTex });
    const under = this.mat(reta ? 'capUnder_reta' : 'capUnder_curva', reta ? '#2b3a2c' : '#3a3c42', { spec: 0.05 });
    // Raiz vazia: gira o boné inteiro (para trás) sem deixar nó solto quando ele sai.
    const rootMesh = this.add(new Mesh('capRoot', s2), crown, this.headMount, { y: 0.143, ry: back ? Math.PI : 0 }, false);
    const sx = 0.97;
    const sz = 1.04;
    const sy = reta ? 0.98 : 0.88;
    this.add(MeshBuilder.CreateSphere('capCrown', { diameter: 0.3, segments: 24, slice: 0.5 }, s2), crown, rootMesh, { sx, sy, sz, rx: -0.1 });
    this.add(MeshBuilder.CreateTorus('capBand', { diameter: 0.285, thickness: 0.012, tessellation: 32 }, s2), under, rootMesh, { y: 0.004, sx, sz, rx: -0.1 }, false, true);
    this.add(MeshBuilder.CreateSphere('capButton', { diameter: 0.024, segments: 8 }, s2), crown, rootMesh, { y: 0.29 * 0.5 * sy - 0.004, z: -0.013 }, false, true);
    // Emblema bordado na frente e ilhoses nos gomos, assentados na superfície da copa
    // (filhos da copa: herdam a mesma escala e inclinação).
    const crownMesh = this.groups.acc[this.groups.acc.length - 3];
    const onCrown = (mesh: Mesh, mat: StandardMaterial, elev: number, yaw: number) =>
      this.add(mesh, mat, crownMesh, {
        x: 0.157 * Math.cos(elev) * Math.sin(yaw),
        y: 0.157 * Math.sin(elev),
        z: 0.157 * Math.cos(elev) * Math.cos(yaw),
        rx: -elev,
        ry: yaw,
      }, false, true);
    onCrown(MeshBuilder.CreateDisc('capEmblem', { radius: 0.03, tessellation: 24, sideOrientation: Mesh.DOUBLESIDE }, s2), this.mat(`capEmblem_${jersey.trim}_${jersey.base}`, '#ffffff', { spec: 0.3, tex: emblemTexture(s2, jersey.trim, jersey.base) }), reta ? 0.5 : 0.45, 0);
    for (let k = 0; k < 6; k++) onCrown(MeshBuilder.CreateDisc('capEyelet', { radius: 0.0045, tessellation: 8, sideOrientation: Mesh.DOUBLESIDE }, s2), under, 1.0, (k + 0.5) * (Math.PI / 3));
    // Aba: fileiras do encaixe na copa até a borda; a curva desce nas laterais.
    const rows: Vector3[][] = [];
    const len = reta ? 0.092 : 0.088;
    const span = 1.0;
    for (let r = 0; r <= 4; r++) {
      const k = r / 4;
      const row: Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const phi = -span + (2 * span * i) / 24;
        const l = len * Math.pow(Math.max(0.02, Math.cos(phi * 1.35)), 0.7) * k;
        const x = (0.146 + l) * Math.sin(phi);
        const z = (0.156 + l) * Math.cos(phi);
        const droop = reta ? 0 : -0.04 * Math.pow(Math.sin(phi), 2) * k - 0.01 * k * k;
        row.push(new Vector3(x, droop - 0.004 + (reta ? -0.003 * k : 0), z));
      }
      rows.push(row);
    }
    const brimTop = MeshBuilder.CreateRibbon('capBrim', { pathArray: rows, sideOrientation: Mesh.BACKSIDE }, s2);
    const brimBottom = MeshBuilder.CreateRibbon('capBrimUnder', { pathArray: rows.map((row) => row.map((p) => p.add(new Vector3(0, -0.007, 0)))), sideOrientation: Mesh.FRONTSIDE }, s2);
    this.add(brimTop, brim, rootMesh, { rx: -0.1 });
    this.add(brimBottom, under, rootMesh, { rx: -0.1 }, false);
    // Borda da aba (espessura).
    const edge = MeshBuilder.CreateTube('capBrimEdge', { path: rows[4].map((p) => p.add(new Vector3(0, -0.0035, 0))), radius: 0.0036, tessellation: 6 }, s2);
    this.add(edge, brim, rootMesh, { rx: -0.1 }, false, true);
  }

  private mat(name: string, hex: string, o: MatOpts = {}): StandardMaterial {
    const key = `${this.scene.uid}:${name}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const m = new StandardMaterial(name, this.scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c;
    if (o.tex) m.diffuseTexture = o.tex;
    if (o.alpha) m.useAlphaFromDiffuseTexture = true;
    m.specularColor = new Color3(1, 1, 1).scale(o.spec ?? 0.1);
    m.specularPower = o.power ?? 32;
    if (o.rim) {
      // Fresnel no emissivo = luz de recorte nas bordas (visual "premium cartoon").
      m.emissiveColor = Color3.White();
      m.emissiveFresnelParameters = new FresnelParameters({
        leftColor: Color3.FromHexString(o.rim).scale(o.rimStrength ?? 0.3),
        rightColor: c.scale(0.06),
        bias: 0.05,
        power: 2.6,
      });
    } else {
      m.emissiveColor = c.scale(o.emissive ?? 0.06);
    }
    matCache.set(key, m);
    return m;
  }

  /**
   * Prende uma malha a um encaixe. `outline` = faz parte da silhueta (contorno);
   * `detail` = some quando o personagem está longe (LOD).
   */
  private add(
    mesh: Mesh,
    mat: StandardMaterial,
    parent: Node,
    t: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number } = {},
    outline = true,
    detail = false,
  ): Mesh {
    mesh.material = mat;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.position.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    mesh.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
    mesh.scaling.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    mesh.receiveShadows = true;
    if (outline) {
      mesh.renderOutline = this.outlineOn;
      mesh.outlineColor = OUTLINE;
      mesh.outlineWidth = 0.006;
      this.silhouettes.add(mesh);
    }
    if (detail) this.details.add(mesh);
    if (this.building) this.groups[this.building].push(mesh);
    return mesh;
  }

  // --------------------------------------------------------------- animação

  /** Agachamento rápido ao aterrissar (proporcional à velocidade de queda). */
  land(fallSpeed: number): void {
    this.landImpact = Math.max(this.landImpact, clamp((fallSpeed - 4) / 14, 0.15, 1));
  }

  /** Coice do tiro (camada de tronco). */
  shoot(): void {
    this.shootT = 0;
  }

  animate(dt: number, a: AnimInput): void {
    this.time += dt;
    const t = this.targets;
    for (const c of BASE_CLIPS) t[c] = 0;
    let sharp = 12;
    let bodyPitch = 0;
    const holding = !!a.hold && a.mode === 'normal';
    if (a.hold) this.holdStyle = a.hold;

    if (a.mode === 'dead') {
      this.deathT += dt;
      t.death = 1;
      this.times.death = Math.min(this.deathT, this.asset.clips.death.duration);
      sharp = 20;
    } else {
      this.deathT = 0;
      if (a.mode === 'freefall' || a.mode === 'plane') {
        t.jump = 1;
        this.times.jump = JUMP_FALL;
        bodyPitch = 1.15 + clamp(a.dive, 0, 1) * 0.35;
        sharp = 6;
      } else if (a.mode === 'parachute') {
        t.jump = 1;
        this.times.jump = JUMP_TAKEOFF;
        sharp = 6;
      } else if (a.mode === 'climb') {
        t.climb = 1;
        this.times.climb = a.traversalT * this.asset.clips.climb.duration * 0.5;
        sharp = 18;
      } else if (a.mode === 'vault') {
        t.jump = 1;
        this.times.jump = JUMP_TAKEOFF + (JUMP_FALL - JUMP_TAKEOFF) * a.traversalT;
        sharp = 18;
      } else if (!a.grounded) {
        t.jump = 1;
        const vy = a.verticalSpeed;
        this.times.jump = vy > 0 ? JUMP_APEX - (JUMP_APEX - JUMP_TAKEOFF) * clamp(vy / 8.4, 0, 1) : JUMP_APEX + (JUMP_FALL - JUMP_APEX) * clamp(-vy / 8, 0, 1);
        sharp = 10;
      } else {
        this.groundTargets(dt, a);
      }
    }
    if (this.landImpact > 0 && a.mode !== 'dead') {
      // Aterrissagem: mistura rápida com a pose agachada.
      const k = this.landImpact;
      for (const c of BASE_CLIPS) t[c] *= 1 - k * 0.6;
      t.crouch += k * 0.6;
      this.landImpact = Math.max(0, this.landImpact - dt * 3.2);
    }

    // Camada de tronco: mira/tiro/recarga só enquanto empunha uma arma.
    const upperTarget = holding ? (a.sprinting && !a.aiming ? 0.6 : 1) : 0;
    this.upperWeight += (upperTarget - this.upperWeight) * damp(14, dt);
    this.aimTime += dt;
    this.shootT += dt;
    this.pitch += ((holding ? clamp(a.aimPitch, -0.9, 0.9) : 0) - this.pitch) * damp(20, dt);
    if (Math.abs(this.pitch) < 1e-4) this.pitch = 0;
    // Deslize: pose agachada com o corpo jogado para trás.
    const ground = a.mode === 'normal' && a.grounded;
    if (ground && a.sliding) bodyPitch = -0.28;
    this.bodyPitch += (bodyPitch - this.bodyPitch) * damp(a.sliding ? 12 : 6, dt);
    if (Math.abs(this.bodyPitch) < 1e-4) this.bodyPitch = 0;
    // Poses aéreas (IK de braços e pernas por cima do clipe; ver applyAirPose).
    this.freefallW += ((a.mode === 'freefall' ? 1 : 0) - this.freefallW) * damp(5, dt);
    this.chuteW += ((a.mode === 'parachute' ? 1 : 0) - this.chuteW) * damp(4, dt);
    if (this.freefallW < 1e-3) this.freefallW = 0;
    if (this.chuteW < 1e-3) this.chuteW = 0;
    // Inclina para dentro da curva (mais quanto mais rápido) e para a frente no sprint; no ar,
    // inclina para o lado em que se está guiando (queda livre e paraquedas).
    const air = a.mode === 'freefall' || a.mode === 'parachute';
    const rollGoal = ground
      ? clamp(-(a.turnRate ?? 0) * a.speed * 0.011, -0.16, 0.16)
      : air
        ? clamp(-a.localVelX * (a.mode === 'freefall' ? 0.035 : 0.025), -0.4, 0.4)
        : 0;
    this.bodyRoll += (rollGoal - this.bodyRoll) * damp(8, dt);
    const leanGoal = ground && a.sprinting ? 0.14 : ground && a.speed > 3 ? 0.05 : 0;
    this.lean += (leanGoal - this.lean) * damp(6, dt);
    // Pernas na direção do movimento quando o corpo não está virado para ela (com arma o
    // corpo acompanha a câmera): até ~70° de lado; andando de costas o clipe toca ao contrário.
    let yawGoal = 0;
    if (ground && a.speed > 0.6 && !a.sliding) {
      const ang = Math.atan2(a.localVelX, a.localVelZ ?? a.speed);
      const back = Math.abs(ang) > 1.95;
      this.phaseDir = back ? -1 : 1;
      const legs = back ? Math.atan2(Math.sin(ang - Math.PI), Math.cos(ang - Math.PI)) : ang;
      yawGoal = clamp(legs, -1.2, 1.2);
    } else {
      this.phaseDir = 1;
    }
    this.hipYaw += (yawGoal - this.hipYaw) * damp(10, dt);
    if (Math.abs(this.hipYaw) < 1e-4) this.hipYaw = 0;

    // Pesos suavizados (crossfade) e normalizados.
    const k = damp(sharp, dt);
    let sum = 0;
    for (const c of BASE_CLIPS) {
      this.weights[c] += (t[c] - this.weights[c]) * k;
      if (this.weights[c] < 0.002) this.weights[c] = 0;
      sum += this.weights[c];
    }
    if (sum < 1e-4) {
      this.weights.idle = 1;
      sum = 1;
    }
    for (const c of BASE_CLIPS) this.weights[c] /= sum;

    // LOD: bots distantes atualizam o esqueleto com menos frequência.
    if (this.lodLevel > 0 && ++this.skipCount % LOD_POSE_EVERY[this.lodLevel] !== 0) return;
    this.applyPose(a.reloadT);
  }

  /** Locomoção no chão: parado/andar/correr/sprint ou agachado, com fase sincronizada. */
  private groundTargets(dt: number, a: AnimInput): void {
    const t = this.targets;
    const s = a.speed;
    const moving = s > 0.25;
    if (a.sliding) {
      // deslize: pose agachada parada (as pernas não "andam")
      t.crouch = 1;
    } else if (a.crouching) {
      t.crouch = 1;
      if (moving) {
        // Agachado andando: pose agachada com as pernas do andar.
        const m = clamp(s / 2, 0, 1) * 0.45;
        t.crouch = 1 - m;
        t.walk = m;
      }
    } else {
      const idle = 1 - clamp((s - 0.25) / 1.2, 0, 1);
      const moveW = 1 - idle;
      // Andar até ~3 m/s, correr em ~5–6,5 m/s (o passo padrão), sprint a partir de ~7 m/s.
      const run = clamp((s - 2.6) / 2.2, 0, 1);
      const sprint = clamp((s - 6.6) / 1.8, 0, 1);
      t.idle = idle;
      t.walk = moveW * (1 - run);
      t.run = moveW * run * (1 - sprint);
      t.sprint = moveW * run * sprint;
    }
    if (moving && !a.sliding) {
      let stride = 0;
      let wsum = 0;
      for (const c of ['walk', 'run', 'sprint', 'crouch'] as const) {
        stride += (STRIDE[c] ?? 2) * t[c];
        wsum += t[c];
      }
      stride = wsum > 0 ? stride / wsum : 2;
      const prev = this.phase;
      // andando de costas o ciclo corre ao contrário (pés acompanham o chão)
      this.phase = (((this.phase + (this.phaseDir * dt * s) / stride) % 1) + 1) % 1;
      // Passos no contato de cada pé (início e metade do ciclo).
      if (Math.floor(prev * 2) !== Math.floor(this.phase * 2) || Math.abs(this.phase - prev) > 0.5) this.onFootstep?.(a.sprinting);
    }
    for (const c of ['walk', 'run', 'sprint'] as const) this.times[c] = this.phase * this.asset.clips[c].duration;
    this.times.crouch = moving ? 0 : this.time % this.asset.clips.crouch.duration;
    this.times.idle = this.time % this.asset.clips.idle.duration;
  }

  /** Pose do lobby: idle do GLB, sem arma. */
  animateLobby(dt: number): void {
    this.animate(dt, {
      speed: 0, runSpeed: 1, grounded: true, verticalSpeed: 0, crouching: false, sprinting: false, mode: 'normal',
      traversalT: 0, hold: null, aiming: false, aimPitch: 0, reloadT: -1, localVelX: 0, dive: 0,
    });
  }

  /** Lê a rotação de um osso num clipe (interpolação linear entre quadros amostrados). */
  private sampleRot(clip: Clip, bone: number, time: number, out: Quaternion): Quaternion {
    const data = clip.rot[bone];
    if (!data) return out.copyFrom(this.asset.restLocal[bone]);
    const last = clip.frames - 1;
    let f = time * CLIP_FPS;
    f = clip.loop ? ((f % last) + last) % last : clamp(f, 0, last);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, last);
    const u = f - i0;
    const a = i0 * 4;
    const b = i1 * 4;
    out.set(
      data[a] + (data[b] - data[a]) * u,
      data[a + 1] + (data[b + 1] - data[a + 1]) * u,
      data[a + 2] + (data[b + 2] - data[a + 2]) * u,
      data[a + 3] + (data[b + 3] - data[a + 3]) * u,
    );
    return out.normalize();
  }

  private sampleHips(clip: Clip, time: number, out: Vector3): Vector3 {
    const data = clip.hips;
    if (!data) return out.copyFrom(this.asset.restHips);
    const last = clip.frames - 1;
    let f = time * CLIP_FPS;
    f = clip.loop ? ((f % last) + last) % last : clamp(f, 0, last);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, last);
    const u = f - i0;
    return out.set(
      data[i0 * 3] + (data[i1 * 3] - data[i0 * 3]) * u,
      data[i0 * 3 + 1] + (data[i1 * 3 + 1] - data[i0 * 3 + 1]) * u,
      data[i0 * 3 + 2] + (data[i1 * 3 + 2] - data[i0 * 3 + 2]) * u,
    );
  }

  /** Mistura as camadas e escreve a rotação de cada osso. */
  private applyPose(reloadT: number): void {
    const clips = this.asset.clips;
    const active: Array<[Clip, number, number]> = [];
    for (const c of BASE_CLIPS) if (this.weights[c] > 0) active.push([clips[c], this.times[c], this.weights[c]]);

    let upper: Clip | null = null;
    let upperTime = 0;
    if (this.upperWeight > 0.01) {
      if (reloadT >= 0) {
        upper = clips.reload;
        upperTime = reloadT * clips.reload.duration;
      } else if (this.shootT < clips.shoot.duration) {
        upper = clips.shoot;
        upperTime = this.shootT;
      } else {
        upper = clips.aim;
        upperTime = this.aimTime;
      }
    }

    const mask = this.asset.upperMask;
    const bones = this.inst.bones;
    for (let i = 0; i < bones.length; i++) {
      let x = 0, y = 0, z = 0, w = 0;
      for (let j = 0; j < active.length; j++) {
        const [clip, time, wt] = active[j];
        const q = this.sampleRot(clip, i, time, tmpQ);
        // Mesmo hemisfério do primeiro, para a média não "dar a volta".
        const s = j > 0 && x * q.x + y * q.y + z * q.z + w * q.w < 0 ? -wt : wt;
        x += q.x * s; y += q.y * s; z += q.z * s; w += q.w * s;
      }
      const out = bones[i].rotationQuaternion!;
      out.set(x, y, z, w).normalize();
      const um = upper ? this.upperWeight * mask[i] : 0;
      if (um > 0) {
        this.sampleRot(upper!, i, upperTime, tmpQ);
        Quaternion.SlerpToRef(out, tmpQ, um, out);
      }
    }

    // Quadril girado para o lado em que se anda; a coluna gira de volta o mesmo tanto, em
    // três vértebras, para o peito (e a arma) continuar para onde se mira.
    // (sinal invertido: o esqueleto está no espaço do glTF, espelhado em X em relação à cena)
    if (Math.abs(this.hipYaw) > 1e-3) {
      Quaternion.RotationAxisToRef(this.yawAxis[this.hipsBone], -this.hipYaw, tmpQ2);
      const qh = bones[this.hipsBone].rotationQuaternion!;
      qh.multiplyToRef(tmpQ2, qh);
      for (const [bone, share] of [[this.spine0, 0.3], [this.spine1, 0.35], [this.spine2, 0.35]] as const) {
        if (bone < 0) continue;
        Quaternion.RotationAxisToRef(this.yawAxis[bone], this.hipYaw * share, tmpQ2);
        const q = bones[bone].rotationQuaternion!;
        q.multiplyToRef(tmpQ2, q);
      }
    }

    // Inclinação da mira dividida entre as duas vértebras de cima, mais o tronco para a
    // frente no sprint.
    if (Math.abs(this.pitch) > 1e-3 || Math.abs(this.lean) > 1e-3) {
      for (const [bone, share] of [[this.spine1, 0.4], [this.spine2, 0.6]] as const) {
        Quaternion.RotationAxisToRef(this.pitchAxis[bone], -this.pitch * share * this.upperWeight + this.lean * share, tmpQ2);
        const q = bones[bone].rotationQuaternion!;
        q.multiplyToRef(tmpQ2, q);
      }
    }

    // Quadril (altura/deslocamento do clipe).
    const hips = this.hipsNode.position;
    let hx = 0, hy = 0, hz = 0;
    const v = new Vector3();
    for (const [clip, time, wt] of active) {
      this.sampleHips(clip, time, v);
      hx += v.x * wt; hy += v.y * wt; hz += v.z * wt;
    }
    hips.set(hx, hy, hz);

    this.pivot.rotation.x = this.bodyPitch;
    this.pivot.rotation.z = this.bodyRoll;

    // Mão de apoio na arma (o clipe de mira deixa a mão esquerda longe do guarda-mão).
    // Só de perto (LOD 0): a 20 m+ a mão de apoio solta não aparece, e a IK custava ~2 ms
    // por personagem.
    const ik = this.supportGrip && reloadT < 0 && this.lodLevel === 0 ? this.upperWeight : 0;
    if (ik > 0.01) this.solveSupportArm(this.supportGrip!, ik);
    if (this.freefallW > 0.01 || this.chuteW > 0.01) this.applyAirPose();
  }

  /**
   * Poses aéreas por IK (o GLB não tem clipes de queda livre nem de paraquedas): alvos das
   * mãos e dos pés no espaço do esqueleto (glTF: +X esquerda, +Y cima, +Z frente), com o
   * corpo em pé — a inclinação da queda livre vem do pivô.
   *   queda livre ("caixa" de paraquedista): braços abertos e dobrados para a cabeça,
   *     joelhos dobrados com os pés para trás;
   *   paraquedas: mãos nos tirantes acima dos ombros, pernas soltas um pouco à frente.
   */
  private applyAirPose(): void {
    const n = this.inst.nodes;
    const esqInv = Matrix.Invert(this.worldOf(this.hipsNode.parent as TransformNode));
    const ff = this.freefallW;
    const pc = this.chuteW;
    const w = Math.min(1, ff + pc);
    const mix = (f: Vector3, p: Vector3) => f.scale(ff / Math.max(w, 1e-3)).add(p.scale(pc / Math.max(w, 1e-3)));
    for (const side of [1, -1]) {
      const L = side > 0 ? 'Left' : 'Right';
      // O vento sacode braços e pernas na queda livre (pernas balançam alternadas no paraquedas).
      const flutter = Math.sin(this.time * 13 + side * 1.3) * 0.035 * ff;
      const swing = Math.sin(this.time * 2.1 + side * Math.PI) * 0.08 * pc;
      const hand = mix(new Vector3(side * 0.6, 1.66 + flutter, 0.1 + flutter * 0.5), new Vector3(side * 0.26, 1.78, 0.04));
      const palm = n.get(side > 0 ? 'socket_weapon_L' : 'socket_weapon_R')!;
      const cur = this.relPos(palm, esqInv);
      this.twoBone(n.get(`${L}Arm`)!, n.get(`${L}ForeArm`)!, palm, Vector3.Lerp(cur, hand, w), esqInv);
      const foot = mix(new Vector3(side * 0.26, 0.42 - flutter * 0.6, -0.42), new Vector3(side * 0.13, 0.1, 0.16 + swing));
      const footNode = n.get(`${L}Foot`);
      if (!footNode) continue;
      const curF = this.relPos(footNode, esqInv);
      this.twoBone(n.get(`${L}UpLeg`)!, n.get(`${L}Leg`)!, footNode, Vector3.Lerp(curF, foot, w), esqInv);
    }
  }

  /** Ponto onde a mão esquerda segura a arma, no espaço da arma (null = sem mão de apoio). */
  setSupportGrip(local: Vector3 | null): void {
    this.supportGrip = local ? local.clone() : null;
  }

  /** Posição de um nó no espaço do esqueleto (glTF, sem o espelhamento da raiz). */
  private relPos(node: TransformNode, esqInv: Matrix): Vector3 {
    return Vector3.TransformCoordinates(Vector3.Zero(), this.worldOf(node).multiplyToRef(esqInv, tmpM));
  }

  private relRot(node: TransformNode, esqInv: Matrix, out: Quaternion): Quaternion {
    this.worldOf(node).multiplyToRef(esqInv, tmpM).decompose(undefined, out, undefined);
    return out;
  }

  /**
   * IK analítico de dois ossos (braço + antebraço) levando a palma esquerda
   * (`socket_weapon_L`) até o ponto de apoio da arma, mantendo o cotovelo do
   * lado em que o clipe o colocou. Tudo no espaço do esqueleto, onde não há
   * escala negativa.
   */
  private solveSupportArm(grip: Vector3, weight: number): void {
    const n = this.inst.nodes;
    const esq = this.hipsNode.parent as TransformNode;
    const esqInv = Matrix.Invert(this.worldOf(esq));
    this.ikRoot = esq;
    try {
      this.solveSupportArmIn(grip, weight, n, esqInv);
    } finally {
      this.ikRoot = null;
    }
  }

  private solveSupportArmIn(grip: Vector3, weight: number, n: Map<string, TransformNode>, esqInv: Matrix): void {

    // 1) Mão direita: do ponto do clipe (aberto demais) para a empunhadura junto ao peito,
    //    definida no espaço da Spine2 para acompanhar a inclinação da mira. A orientação
    //    da arma (cano para a frente, já inclinado) é preservada.
    const spineRel = this.worldOf(n.get('Spine2')!).multiply(esqInv);
    const gripGoal = Vector3.TransformCoordinates(this.holdStyle === 'pistol' ? this.pistolGrip : this.rifleGrip, spineRel);
    const wantRot = this.relRot(this.weaponMount, esqInv, new Quaternion());
    for (let it = 0; it < 2; it++) {
      const cur = this.relPos(n.get('socket_weapon_R')!, esqInv);
      this.twoBone(n.get('RightArm')!, n.get('RightForeArm')!, n.get('socket_weapon_R')!, Vector3.Lerp(cur, gripGoal, weight), esqInv);
      const mount = this.relRot(this.weaponMount, esqInv, new Quaternion());
      this.rotateBoneBy(n.get('RightHand')!, wantRot.multiply(Quaternion.Inverse(mount)), esqInv);
    }

    // 2) Mão esquerda no apoio da arma.
    const target = Vector3.TransformCoordinates(grip, this.worldOf(this.weaponMount).multiply(esqInv));
    const p0 = this.relPos(n.get('socket_weapon_L')!, esqInv);
    this.twoBone(n.get('LeftArm')!, n.get('LeftForeArm')!, n.get('socket_weapon_L')!, Vector3.Lerp(p0, target, weight), esqInv);
  }

  /** IK analítico de dois ossos: leva `effector` até `goal` girando `arm` e `fore`. */
  private twoBone(arm: TransformNode, fore: TransformNode, palm: TransformNode, goal: Vector3, esqInv: Matrix): void {
    const s = this.relPos(arm, esqInv);
    const e = this.relPos(fore, esqInv);
    const p = this.relPos(palm, esqInv);
    const a = Vector3.Distance(s, e);
    const b = Vector3.Distance(e, p);
    const toGoal = goal.subtract(s);
    const d = clamp(toGoal.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toGoal.normalize();
    // Lado do cotovelo: componente do cotovelo atual perpendicular à linha ombro→alvo.
    const se = e.subtract(s);
    let pole = se.subtract(dir.scale(Vector3.Dot(se, dir)));
    if (pole.lengthSquared() < 1e-6) pole = new Vector3(0, -1, 0);
    pole.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const elbow = s.add(dir.scale(cosA * a)).add(pole.scale(Math.sqrt(1 - cosA * cosA) * a));

    this.rotateBone(arm, se.normalize(), elbow.subtract(s).normalize(), esqInv);
    const e2 = this.relPos(fore, esqInv);
    const p2 = this.relPos(palm, esqInv);
    this.rotateBone(fore, p2.subtract(e2).normalize(), goal.subtract(e2).normalize(), esqInv);
  }

  /** Gira um osso (no espaço do esqueleto) para que a direção `from` vire `to`. */
  private rotateBone(node: TransformNode, from: Vector3, to: Vector3, esqInv: Matrix): void {
    const delta = new Quaternion();
    Quaternion.FromUnitVectorsToRef(from, to, delta);
    this.rotateBoneBy(node, delta, esqInv);
  }

  /** Aplica uma rotação `delta` (espaço do esqueleto) a um osso: local' = P⁻¹ · Δ · P · local. */
  private rotateBoneBy(node: TransformNode, delta: Quaternion, esqInv: Matrix): void {
    const parent = this.relRot(node.parent as TransformNode, esqInv, new Quaternion());
    const q = node.rotationQuaternion!;
    Quaternion.Inverse(parent).multiply(delta).multiply(parent).multiplyToRef(q, q);
  }
}
