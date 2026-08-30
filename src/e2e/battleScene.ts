import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { militaryEquipmentMountDiagnostics } from '../settlement/militaryEquipment.ts';
import {
  attachWorkerTool,
  disposeWorkerToolSources,
  loadWorkerToolSources,
  type WorkerToolKind,
} from '../settlement/workerTools.ts';
import { configureVillagerMaterialLighting } from '../settlement/villagerMaterialLighting.ts';
import { sampleWorldRawTerrainHeight } from '../terrain/TerrainHeight.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  resolveWorldDimensions,
} from '../world/worldGenerationSettings.ts';
import { applyTerrainPreset, seedForTerrainPreset } from '../world/worldTerrainPresets.ts';

declare global {
  interface Window {
    __BATTLE_SCENE_READY__?: boolean;
    __BATTLE_SCENE_ERROR__?: string;
    __BATTLE_SCENE_DIAGNOSTICS__?: BattleSceneDiagnostics;
  }
}

type BattleView = 'establishing' | 'charge' | 'clash' | 'aftermath' | 'no-post' | 'topology';
type BattleShot = Exclude<BattleView, 'no-post' | 'topology'>;
type Faction = 'croatian' | 'ottoman';
type FighterPose = 'hold' | 'advance' | 'slash' | 'hit' | 'fall' | 'flee' | 'angry';

type FighterSpec = {
  id: string;
  faction: Faction;
  role: string;
  tool: WorkerToolKind;
  x: number;
  z: number;
  yaw: number;
  pose: FighterPose;
  clipTime: number;
};

type FighterSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: Map<string, THREE.AnimationClip>;
};

type BattleSceneDiagnostics = {
  seed: number;
  fixedTimeSeconds: number;
  view: BattleView;
  shot: BattleShot;
  captureClean: boolean;
  presentation: 'final' | 'no-post' | 'topology';
  agentCount: number;
  croatianCount: number;
  ottomanCount: number;
  riggedCount: number;
  equipmentMountCount: number;
  skeletonHelperCount: number;
  poses: Record<FighterPose, number>;
  clipNames: string[];
  toolKinds: WorkerToolKind[];
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    subjectRadius: number;
  };
  terrain: {
    vertices: number;
    triangles: number;
    field: string;
    preset: 'lic_polje';
    presetSeed: number;
    cropCenterWorld: [number, number];
    cropExtent: [number, number];
    cropRotationRadians: number;
    roadHalfWidth: number;
    displacementBands: 'production-raw-height';
  };
  instances: { grass: number; rocks: number; shrubs: number; trees: number };
  renderer: { drawCalls: number; triangles: number; geometries: number; textures: number };
};

const CROATIAN_MODEL_URL = '/assets/models/villagers/worker-male-common-01-v002.glb';
const OTTOMAN_MODEL_URL = '/assets/models/villagers/ottoman-raider-common-01-v001.glb';
const FIXED_SEED = 0x5e10_b477;
const FIXED_TIME_SECONDS = 2.4;
const AGENTS_PER_FACTION = 12;
const TERRAIN_SIZE_X = 290;
const TERRAIN_SIZE_Z = 280;
const TERRAIN_SEGMENTS_X = 145;
const TERRAIN_SEGMENTS_Z = 140;
const ROAD_HALF_WIDTH = 2.25;
const LIC_POLJE_PRESET_SEED = seedForTerrainPreset(0x4c10_09a3, 'lic_polje');
const LIC_POLJE_DIMENSIONS = resolveWorldDimensions('small');
const LIC_POLJE_SETTINGS = applyTerrainPreset(
  {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: LIC_POLJE_PRESET_SEED,
    mapSize: 'small',
  },
  'lic_polje',
);
const CROP_CENTER_WORLD = new THREE.Vector2(17.6363, 24.2685);
const CROP_ALONG_WORLD = new THREE.Vector2(0.80895066, -0.58787654);
const CROP_CROSS_WORLD = new THREE.Vector2(0.58787654, 0.80895066);
const CROP_ROTATION_RADIANS = 0.62843137;
const CROP_BASE_HEIGHT = sampleWorldRawTerrainHeight(
  CROP_CENTER_WORLD.x,
  CROP_CENTER_WORLD.y,
  LIC_POLJE_SETTINGS,
  LIC_POLJE_DIMENSIONS,
);

const CROATIAN_TOOLS: readonly WorkerToolKind[] = [
  'spear-shield',
  'spear-shield',
  'sword-shield',
  'halberd',
  'sidearm-shield',
  'pike-kit',
  'bow',
  'crossbow',
  'uskok-kit',
  'spear',
  'sword-shield',
  'halberd',
];

const CROATIAN_ROLES = [
  'company spearman',
  'company spearman',
  'man-at-arms',
  'polearm infantry',
  'footman',
  'mercenary pikeman',
  'bowman',
  'crossbowman',
  'Uskok border infantry',
  'militia spearman',
  'man-at-arms',
  'polearm infantry',
] as const;

const root = document.querySelector<HTMLElement>('#battle-root');
const status = document.querySelector<HTMLElement>('#status');
const shotName = document.querySelector<HTMLElement>('#shot-name');
const shotMeta = document.querySelector<HTMLElement>('#shot-meta');
const errorHost = document.querySelector<HTMLElement>('#error');
if (!root || !status || !shotName || !shotMeta || !errorHost) {
  throw new Error('Battle scene host is incomplete.');
}

const params = new URLSearchParams(window.location.search);
const requestedView = params.get('view');
const view: BattleView = isBattleView(requestedView) ? requestedView : 'clash';
const shot: BattleShot = view === 'no-post' || view === 'topology' ? 'clash' : view;
const captureClean = params.get('capture') === '1';
const presentation: BattleSceneDiagnostics['presentation'] = view === 'no-post'
  ? 'no-post'
  : view === 'topology'
    ? 'topology'
    : 'final';

document.body.dataset.view = view;
document.body.dataset.capture = String(captureClean);
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-view-link]')) {
  if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
}
shotName.textContent = shotLabel(shot);
shotMeta.textContent = `Seed ${FIXED_SEED.toString(16)} · t ${FIXED_TIME_SECONDS.toFixed(2)} s`;

let renderer: THREE.WebGLRenderer | null = null;
let environmentTarget: THREE.WebGLRenderTarget | null = null;
let workerToolSources: Awaited<ReturnType<typeof loadWorkerToolSources>> | null = null;
let croatianSource: FighterSource | null = null;
let ottomanSource: FighterSource | null = null;
let running = true;
const mixers: THREE.AnimationMixer[] = [];
const ownedGeometries = new Set<THREE.BufferGeometry>();
const ownedMaterials = new Set<THREE.Material>();
const ownedTextures = new Set<THREE.Texture>();

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, captureClean ? 1.65 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = presentation === 'no-post' || presentation === 'topology'
    ? THREE.NoToneMapping
    : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = presentation === 'final' ? 1.03 : 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  root.prepend(renderer.domElement);

  const loader = new GLTFLoader();
  const [croatianGltf, ottomanGltf, tools] = await Promise.all([
    loader.loadAsync(CROATIAN_MODEL_URL),
    loader.loadAsync(OTTOMAN_MODEL_URL),
    loadWorkerToolSources(),
  ]);
  workerToolSources = tools;
  croatianSource = prepareFighterSource(croatianGltf, 1.72, presentation === 'topology');
  ottomanSource = prepareFighterSource(ottomanGltf, 1.74, presentation === 'topology');

  const scene = new THREE.Scene();
  if (presentation === 'topology') {
    scene.background = new THREE.Color(0x172019);
    scene.fog = null;
  } else {
    const skyTexture = createBattleSkyTexture();
    scene.background = skyTexture;
    scene.fog = new THREE.FogExp2(0xc4bca9, 0.0054);
    ownedTextures.add(skyTexture);
  }

  const roomEnvironment = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.035);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.36;
  roomEnvironment.dispose();
  pmremGenerator.dispose();

  addLighting(scene);
  const groundDetail = createGroundDetailTexture(FIXED_SEED);
  groundDetail.wrapS = groundDetail.wrapT = THREE.RepeatWrapping;
  groundDetail.repeat.set(54, 52);
  groundDetail.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ownedTextures.add(groundDetail);

  const terrainResult = createBattlefieldTerrain(groundDetail, presentation === 'topology');
  scene.add(terrainResult.mesh);
  ownedGeometries.add(terrainResult.mesh.geometry);
  ownedMaterials.add(terrainResult.mesh.material as THREE.Material);

  const road = createTrampledRoad(groundDetail, presentation === 'topology');
  scene.add(road);
  ownedGeometries.add(road.geometry);
  ownedMaterials.add(road.material as THREE.Material);

  const environment = createBattlefieldEnvironment(presentation === 'topology');
  scene.add(environment.group);
  for (const geometry of environment.geometries) ownedGeometries.add(geometry);
  for (const material of environment.materials) ownedMaterials.add(material);

  const specs = buildFighterSpecs(shot);
  const bounds = new THREE.Box3();
  let riggedCount = 0;
  let equipmentMountCount = 0;
  let skeletonHelperCount = 0;
  const clipNames = new Set<string>();
  const toolKinds = new Set<WorkerToolKind>();

  specs.forEach((spec, index) => {
    const source = spec.faction === 'croatian' ? croatianSource! : ottomanSource!;
    const created = createFighter(spec, source, tools, presentation === 'topology');
    scene.add(created.root);
    mixers.push(created.mixer);
    riggedCount += created.rigged ? 1 : 0;
    equipmentMountCount += created.equipmentMountCount;
    clipNames.add(created.clipName);
    toolKinds.add(spec.tool);
    bounds.expandByPoint(created.root.position);
    if (presentation === 'topology' && (index < 8 || spec.pose === 'fall')) {
      const helper = new THREE.SkeletonHelper(created.model);
      const material = helper.material as THREE.LineBasicMaterial;
      material.color.setHex(spec.faction === 'croatian' ? 0xe2d36b : 0xd8775e);
      material.transparent = true;
      material.opacity = 0.58;
      material.depthTest = false;
      helper.renderOrder = 4;
      created.root.add(helper);
      ownedMaterials.add(material);
      skeletonHelperCount += 1;
    }
  });

  if (shot === 'establishing' || shot === 'charge') {
    const standards = createFactionStandards(bounds, presentation === 'topology');
    scene.add(standards.group);
    for (const geometry of standards.geometries) ownedGeometries.add(geometry);
    for (const material of standards.materials) ownedMaterials.add(material);
    for (const texture of standards.textures) ownedTextures.add(texture);
  }

  if (presentation !== 'topology' && (shot === 'charge' || shot === 'clash')) {
    const dust = createBattleDust(shot, FIXED_SEED);
    scene.add(dust.group);
    ownedTextures.add(dust.texture);
    ownedMaterials.add(dust.material);
  }

  const camera = new THREE.PerspectiveCamera(cameraFovForShot(shot), 1, 0.08, 420);
  const cameraTarget = new THREE.Vector3();
  const cameraManifest = { subjectRadius: 0 };
  scene.add(camera);

  const resizeAndRender = (): void => {
    if (!running || !renderer) return;
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    frameHeroCamera(camera, bounds, shot, cameraTarget, cameraManifest);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  window.addEventListener('resize', resizeAndRender);
  resizeAndRender();
  await new Promise<void>((resolve) => requestAnimationFrame(() => {
    resizeAndRender();
    resolve();
  }));

  const poseCounts = Object.fromEntries(
    (['hold', 'advance', 'slash', 'hit', 'fall', 'flee', 'angry'] as const)
      .map((pose) => [pose, specs.filter((spec) => spec.pose === pose).length]),
  ) as Record<FighterPose, number>;
  const diagnostics: BattleSceneDiagnostics = {
    seed: FIXED_SEED,
    fixedTimeSeconds: FIXED_TIME_SECONDS,
    view,
    shot,
    captureClean,
    presentation,
    agentCount: specs.length,
    croatianCount: specs.filter((spec) => spec.faction === 'croatian').length,
    ottomanCount: specs.filter((spec) => spec.faction === 'ottoman').length,
    riggedCount,
    equipmentMountCount,
    skeletonHelperCount,
    poses: poseCounts,
    clipNames: [...clipNames],
    toolKinds: [...toolKinds],
    camera: {
      position: camera.position.toArray() as [number, number, number],
      target: cameraTarget.toArray() as [number, number, number],
      fov: camera.fov,
      subjectRadius: cameraManifest.subjectRadius,
    },
    terrain: {
      vertices: terrainResult.vertexCount,
      triangles: terrainResult.triangleCount,
      field: 'production Lic Polje raw world-XZ height -> slope + road/trample exposure',
      preset: 'lic_polje',
      presetSeed: LIC_POLJE_PRESET_SEED,
      cropCenterWorld: CROP_CENTER_WORLD.toArray() as [number, number],
      cropExtent: [TERRAIN_SIZE_X, TERRAIN_SIZE_Z],
      cropRotationRadians: CROP_ROTATION_RADIANS,
      roadHalfWidth: ROAD_HALF_WIDTH,
      displacementBands: 'production-raw-height',
    },
    instances: environment.counts,
    renderer: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
  };
  window.__BATTLE_SCENE_DIAGNOSTICS__ = diagnostics;
  window.__BATTLE_SCENE_READY__ = true;
  document.body.dataset.ready = 'true';
  document.documentElement.dataset.battleReady = 'true';
  document.documentElement.dataset.battleEvidence = JSON.stringify(diagnostics);
  document.body.dataset.battleSignature = [
    `seed:${FIXED_SEED}`,
    `time:${FIXED_TIME_SECONDS}`,
    `view:${view}`,
    `shot:${shot}`,
    `agents:${specs.length}`,
    `poses:${specs.map((spec) => spec.pose).join(',')}`,
  ].join('|');
  status.textContent = `${specs.length} rigged combatants · ${renderer.info.render.triangles.toLocaleString()} triangles`;

  window.addEventListener('beforeunload', () => {
    running = false;
    window.removeEventListener('resize', resizeAndRender);
    for (const mixer of mixers) mixer.stopAllAction();
    if (workerToolSources) disposeWorkerToolSources(workerToolSources);
    disposeSource(croatianSource);
    disposeSource(ottomanSource);
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    for (const texture of ownedTextures) texture.dispose();
    environmentTarget?.dispose();
    renderer?.dispose();
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  window.__BATTLE_SCENE_ERROR__ = message;
  document.body.dataset.error = 'true';
  status.textContent = 'Battle fixture failed to load';
  errorHost.textContent = `Battle photography fixture failed: ${message}`;
  console.error('[Battle scene]', error);
}

function isBattleView(value: string | null): value is BattleView {
  return value === 'establishing'
    || value === 'charge'
    || value === 'clash'
    || value === 'aftermath'
    || value === 'no-post'
    || value === 'topology';
}

function shotLabel(selected: BattleShot): string {
  switch (selected) {
    case 'establishing': return 'Lines before contact';
    case 'charge': return 'Closing charge';
    case 'clash': return 'Front-rank clash';
    case 'aftermath': return 'Aftermath';
  }
}

function prepareFighterSource(
  gltf: GLTF,
  targetHeight: number,
  topology: boolean,
): FighterSource {
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error('Combatant source has invalid bounds.');
  }
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(normalizeClipName(clip.name), clip);
  const configuredMaterials = new Set<THREE.Material>();
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (configuredMaterials.has(material)) continue;
      configuredMaterials.add(material);
      if (material instanceof THREE.MeshStandardMaterial) {
        configureVillagerMaterialLighting(material);
        material.wireframe = topology;
      }
    }
  });
  return { scene: gltf.scene, bounds, sourceHeight, targetHeight, clips };
}

function normalizeClipName(name: string): string {
  const normalized = name.toLowerCase();
  const separators = ['|', ':'];
  let semantic = normalized;
  for (const separator of separators) semantic = semantic.split(separator).at(-1) ?? semantic;
  return semantic.replace(/^.*(?:nlatrack(?:\.\d+)?)_/, '');
}

function findSemanticClip(source: FighterSource, semanticName: string): THREE.AnimationClip {
  const direct = source.clips.get(semanticName);
  if (direct) return direct;
  for (const [name, clip] of source.clips) {
    if (name === semanticName || name.endsWith(`_${semanticName}`)) return clip;
  }
  throw new Error(`Combatant source is missing ${semanticName}.`);
}

function clipForPose(faction: Faction, pose: FighterPose): string {
  switch (pose) {
    case 'hold': return faction === 'ottoman' ? 'standing_relax' : 'idle';
    case 'advance': return 'run';
    case 'slash': return 'slash';
    case 'hit': return 'hit_to_body_01';
    case 'fall': return 'fall';
    case 'flee': return 'flee_01';
    case 'angry': return faction === 'ottoman' ? 'angry_01' : 'wait';
  }
}

function createFighter(
  spec: FighterSpec,
  source: FighterSource,
  tools: Awaited<ReturnType<typeof loadWorkerToolSources>>,
  topology: boolean,
): {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  rigged: boolean;
  equipmentMountCount: number;
  clipName: string;
} {
  const rootGroup = new THREE.Group();
  rootGroup.name = `${spec.faction} ${spec.role} ${spec.id}`;
  rootGroup.position.set(spec.x, battlefieldField(spec.x, spec.z).height + 0.01, spec.z);
  rootGroup.rotation.y = spec.yaw;
  const model = cloneSkinned(source.scene) as THREE.Group;
  const scale = source.targetHeight / source.sourceHeight;
  model.scale.setScalar(scale);
  model.position.y = -source.bounds.min.y * scale + 0.012;
  rootGroup.add(model);
  model.updateWorldMatrix(true, true);

  let rigged = false;
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (mesh.isSkinnedMesh) rigged = true;
  });

  const toolSource = tools[spec.tool];
  if (!toolSource) throw new Error(`Missing ${spec.tool} equipment source.`);
  const tool = attachWorkerTool(model, toolSource);
  const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  for (const mount of mounts ?? [tool]) {
    mount.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!topology) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) material.wireframe = true;
      }
    });
  }
  const equipmentMountCount = militaryEquipmentMountDiagnostics(tool).length;

  const clipName = clipForPose(spec.faction, spec.pose);
  const clip = findSemanticClip(source, clipName);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip, model);
  action.enabled = true;
  if (spec.pose === 'fall' || spec.pose === 'hit') {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
  }
  action.play();
  mixer.setTime(Math.min(Math.max(0, spec.clipTime), Math.max(0.001, clip.duration - 0.001)));
  model.updateWorldMatrix(true, true);

  return { root: rootGroup, model, mixer, rigged, equipmentMountCount, clipName };
}

function buildFighterSpecs(selectedShot: BattleShot): FighterSpec[] {
  const specs: FighterSpec[] = [];
  for (const faction of ['croatian', 'ottoman'] as const) {
    for (let index = 0; index < AGENTS_PER_FACTION; index += 1) {
      const position = formationPosition(selectedShot, faction, index);
      const pose = fighterPose(selectedShot, faction, index);
      specs.push({
        id: `${faction}-${String(index + 1).padStart(2, '0')}`,
        faction,
        role: faction === 'croatian' ? CROATIAN_ROLES[index]! : 'Ottoman raider',
        tool: faction === 'croatian' ? CROATIAN_TOOLS[index]! : 'sidearm',
        x: position.x,
        z: position.z,
        yaw: position.yaw,
        pose,
        clipTime: clipTimeForPose(pose, faction, index),
      });
    }
  }
  return specs;
}

function formationPosition(
  selectedShot: BattleShot,
  faction: Faction,
  index: number,
): { x: number; z: number; yaw: number } {
  const side = faction === 'croatian' ? -1 : 1;
  const forwardYaw = side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  const slot = index % 6;
  const row = Math.floor(index / 6);
  const laneZ = (slot - 2.5) * 2.05 + (faction === 'ottoman' ? 0.18 : -0.08);
  if (selectedShot === 'establishing') {
    return { x: side * (6.9 + row * 2.6), z: laneZ, yaw: forwardYaw };
  }
  if (selectedShot === 'charge') {
    const stagger = ((index * 17) % 5 - 2) * 0.2;
    return {
      x: side * (3.4 + row * 2.5 + stagger),
      z: laneZ + Math.sin(index * 1.7) * 0.2,
      yaw: forwardYaw,
    };
  }
  if (selectedShot === 'clash') {
    if (row === 0) {
      const pairOffset = ((index * 13) % 5 - 2) * 0.11;
      return {
        x: side * (0.78 + pairOffset),
        z: laneZ,
        yaw: forwardYaw + (slot - 2.5) * side * 0.035,
      };
    }
    return {
      x: side * (3.7 + ((index * 7) % 3) * 0.34),
      z: laneZ + Math.cos(index * 1.3) * 0.25,
      yaw: forwardYaw,
    };
  }
  const aftermathPositions: ReadonlyArray<readonly [number, number]> = [
    [-1.3, -4.5], [-0.9, -2.5], [-1.6, -0.5], [-0.6, 1.5], [-1.2, 3.5], [-2.1, 5.2],
    [-4.2, -4.0], [-3.4, -1.8], [-4.4, 0.3], [-3.2, 2.5], [-4.8, 4.4], [-5.7, 0.9],
  ];
  const base = aftermathPositions[index]!;
  return {
    x: side < 0 ? base[0] : -base[0],
    z: base[1] + (faction === 'ottoman' ? 0.22 : 0),
    yaw: forwardYaw + (index % 3 - 1) * 0.22,
  };
}

function fighterPose(selectedShot: BattleShot, faction: Faction, index: number): FighterPose {
  if (selectedShot === 'establishing') {
    if (index >= 6 && index < 9) return 'hold';
    return faction === 'ottoman' && index % 4 === 0 ? 'angry' : 'hold';
  }
  if (selectedShot === 'charge') {
    if (faction === 'croatian' && (index === 6 || index === 7)) return 'hold';
    return faction === 'ottoman' && index === 11 ? 'angry' : 'advance';
  }
  if (selectedShot === 'clash') {
    const croatianFront: readonly FighterPose[] = ['slash', 'hit', 'slash', 'slash', 'fall', 'slash'];
    const ottomanFront: readonly FighterPose[] = ['hit', 'slash', 'slash', 'fall', 'slash', 'hit'];
    if (index < 6) return faction === 'croatian' ? croatianFront[index]! : ottomanFront[index]!;
    if (faction === 'croatian' && (index === 6 || index === 7)) return 'hold';
    return index % 3 === 0 ? 'slash' : 'advance';
  }
  const croatianAftermath: readonly FighterPose[] = [
    'fall', 'hit', 'fall', 'hold', 'fall', 'hold', 'hold', 'hold', 'slash', 'fall', 'hit', 'flee',
  ];
  const ottomanAftermath: readonly FighterPose[] = [
    'fall', 'fall', 'hit', 'fall', 'hold', 'fall', 'angry', 'flee', 'fall', 'hold', 'flee', 'angry',
  ];
  return faction === 'croatian' ? croatianAftermath[index]! : ottomanAftermath[index]!;
}

function clipTimeForPose(pose: FighterPose, faction: Faction, index: number): number {
  switch (pose) {
    case 'hold': return 1.4 + (index % 5) * 0.53;
    case 'advance': return index % 2 === 0 ? 6 / 24 : 14 / 24;
    case 'slash': return (index % 2 === 0 ? 50 : 49) / 24;
    case 'hit': return 11 / 24;
    case 'fall': return 73 / 24;
    case 'flee': return 0.62 + (index % 3) * 0.31;
    case 'angry': return faction === 'ottoman' ? 1.1 + (index % 4) * 0.38 : 2.1;
  }
}

function sampleProductionBattlefieldHeight(localAlong: number, localCross: number): number {
  const worldX = CROP_CENTER_WORLD.x
    + CROP_ALONG_WORLD.x * localAlong
    + CROP_CROSS_WORLD.x * localCross;
  const worldZ = CROP_CENTER_WORLD.y
    + CROP_ALONG_WORLD.y * localAlong
    + CROP_CROSS_WORLD.y * localCross;
  return sampleWorldRawTerrainHeight(
    worldX,
    worldZ,
    LIC_POLJE_SETTINGS,
    LIC_POLJE_DIMENSIONS,
  ) - CROP_BASE_HEIGHT;
}

function roadCenterZ(x: number): number {
  return Math.sin(x * 0.085) * 0.72 - 0.18;
}

function battlefieldField(x: number, z: number): { height: number; slope: number; road: number; exposed: number } {
  const height = sampleProductionBattlefieldHeight(x, z);
  const epsilon = 0.35;
  const dx = (
    sampleProductionBattlefieldHeight(x + epsilon, z)
    - sampleProductionBattlefieldHeight(x - epsilon, z)
  ) / (epsilon * 2);
  const dz = (
    sampleProductionBattlefieldHeight(x, z + epsilon)
    - sampleProductionBattlefieldHeight(x, z - epsilon)
  ) / (epsilon * 2);
  const slope = Math.hypot(dx, dz);
  const roadDistance = Math.abs(z - roadCenterZ(x));
  const road = 1 - THREE.MathUtils.smoothstep(roadDistance, ROAD_HALF_WIDTH * 0.42, ROAD_HALF_WIDTH);
  const slopeExposure = THREE.MathUtils.smoothstep(slope, 0.008, 0.022);
  const exposed = THREE.MathUtils.clamp(road * 0.9 + slopeExposure * 0.46, 0, 1);
  return { height, slope, road, exposed };
}

function createBattlefieldTerrain(
  detailMap: THREE.Texture,
  topology: boolean,
): { mesh: THREE.Mesh; vertexCount: number; triangleCount: number } {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE_X,
    TERRAIN_SIZE_Z,
    TERRAIN_SEGMENTS_X,
    TERRAIN_SEGMENTS_Z,
  );
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const grass = new THREE.Color(0x708058);
  const dryGrass = new THREE.Color(0x968a60);
  const soil = new THREE.Color(0x58432f);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const field = battlefieldField(x, z);
    positions.setY(index, field.height);
    if (topology) {
      color.setRGB(field.road, THREE.MathUtils.clamp(field.slope * 5.4, 0, 1), 1 - field.exposed);
    } else {
      const dryness = THREE.MathUtils.clamp(0.32 + Math.sin(x * 0.08 - z * 0.06) * 0.18, 0, 1);
      color.copy(grass).lerp(dryGrass, dryness).lerp(soil, field.exposed);
    }
    color.toArray(colors, index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: topology ? null : detailMap,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    wireframe: topology,
  });
  material.name = 'Battlefield grass-soil field material';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Stable world-XZ battlefield terrain';
  mesh.receiveShadow = true;
  return {
    mesh,
    vertexCount: positions.count,
    triangleCount: (geometry.index?.count ?? positions.count) / 3,
  };
}

function createTrampledRoad(detailMap: THREE.Texture, topology: boolean): THREE.Mesh {
  const steps = TERRAIN_SEGMENTS_X;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = THREE.MathUtils.lerp(-TERRAIN_SIZE_X * 0.5, TERRAIN_SIZE_X * 0.5, t);
    const centerZ = roadCenterZ(x);
    for (const side of [-1, 1]) {
      const z = centerZ + side * ROAD_HALF_WIDTH * 0.72;
      positions.push(x, battlefieldField(x, z).height + 0.012, z);
      uvs.push(t * 10, side < 0 ? 0 : 1);
    }
    if (index < steps) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: topology ? 0xcb6b52 : 0x4a3826,
    map: topology ? null : detailMap,
    roughness: 0.72,
    metalness: 0,
    transparent: !topology,
    opacity: topology ? 0.78 : 0.62,
    depthWrite: true,
    wireframe: topology,
  });
  material.name = 'Lower-roughness trampled battlefield road';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Road and trampled-grass surface';
  mesh.receiveShadow = true;
  return mesh;
}

function createGroundDetailTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create battlefield detail texture.');
  context.fillStyle = '#b7b29a';
  context.fillRect(0, 0, 512, 512);
  const random = mulberry32(seed);
  for (let index = 0; index < 7_200; index += 1) {
    const green = 74 + Math.floor(random() * 54);
    const red = green + Math.floor(random() * 24);
    const blue = Math.floor(green * (0.64 + random() * 0.12));
    context.fillStyle = `rgba(${red},${green},${blue},${0.035 + random() * 0.08})`;
    const length = 0.4 + random() * 2.4;
    context.fillRect(random() * 512, random() * 512, length, 0.5 + random() * 1.2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `Shared battlefield micro albedo ${seed}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBattleSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create deterministic battlefield sky.');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#8ea8b3');
  gradient.addColorStop(0.52, '#aebbb7');
  gradient.addColorStop(0.76, '#c4bca9');
  gradient.addColorStop(1, '#a9ad94');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Deterministic cool-sky warm-horizon battle gradient';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createBattlefieldEnvironment(topology: boolean): {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  counts: BattleSceneDiagnostics['instances'];
} {
  const group = new THREE.Group();
  group.name = 'Instanced battlefield vegetation and geology';
  const random = mulberry32(FIXED_SEED ^ 0x49ab_7311);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const grassGeometry = new THREE.ConeGeometry(0.025, 0.2, 3, 1);
  grassGeometry.translate(0, 0.1, 0);
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x748354,
    roughness: 0.96,
    metalness: 0,
    vertexColors: false,
    wireframe: topology,
  });
  const grassCount = 720;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
  grass.name = 'Instanced trample-aware battlefield grass';
  let grassPlaced = 0;
  while (grassPlaced < grassCount) {
    const x = THREE.MathUtils.lerp(-24, 24, random());
    const z = THREE.MathUtils.lerp(-18, 18, random());
    const field = battlefieldField(x, z);
    if (field.road > 0.14 || (Math.abs(x) < 7 && Math.abs(z) < 7 && random() < 0.72)) continue;
    quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
    const heightScale = 0.65 + random() * 0.8;
    scale.set(0.72 + random() * 0.7, heightScale, 0.72 + random() * 0.7);
    matrix.compose(new THREE.Vector3(x, field.height, z), quaternion, scale);
    grass.setMatrixAt(grassPlaced, matrix);
    color.setHex(0x63734c).lerp(new THREE.Color(0x9a8d58), random() * 0.6);
    grass.setColorAt(grassPlaced, color);
    grassPlaced += 1;
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.receiveShadow = true;
  group.add(grass);
  geometries.push(grassGeometry);
  materials.push(grassMaterial);

  const rockGeometry = createRockGeometry(FIXED_SEED ^ 0x1a72);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c4e46,
    roughness: 0.97,
    metalness: 0,
    wireframe: topology,
  });
  const rockCount = 28;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.name = 'Instanced battlefield limestone';
  for (let index = 0; index < rockCount; index += 1) {
    let x = 0;
    let z = 0;
    do {
      x = THREE.MathUtils.lerp(-23, 23, random());
      z = THREE.MathUtils.lerp(-17, 17, random());
    } while (battlefieldField(x, z).road > 0.1 || (Math.abs(x) < 8 && Math.abs(z) < 7));
    const size = 0.16 + random() * 0.42;
    quaternion.setFromEuler(new THREE.Euler(random() * 0.18, random() * Math.PI * 2, random() * 0.16));
    scale.set(size * (0.8 + random() * 0.7), size * (0.46 + random() * 0.38), size);
    matrix.compose(new THREE.Vector3(x, battlefieldField(x, z).height + 0.03, z), quaternion, scale);
    rocks.setMatrixAt(index, matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  geometries.push(rockGeometry);
  materials.push(rockMaterial);

  const shrubGeometry = new THREE.IcosahedronGeometry(0.42, 1);
  const shrubMaterial = new THREE.MeshStandardMaterial({
    color: 0x496048,
    roughness: 0.94,
    metalness: 0,
    wireframe: topology,
  });
  const shrubCount = 28;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  shrubs.name = 'Instanced battlefield-edge shrubs';
  for (let index = 0; index < shrubCount; index += 1) {
    const edge = index % 2 === 0 ? -1 : 1;
    const x = edge * THREE.MathUtils.lerp(24, 112, random());
    const z = THREE.MathUtils.lerp(42, 116, random());
    const size = 0.35 + random() * 0.56;
    quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
    scale.set(size * (0.92 + random() * 0.4), size * (0.72 + random() * 0.36), size);
    matrix.compose(new THREE.Vector3(x, battlefieldField(x, z).height + size * 0.35, z), quaternion, scale);
    shrubs.setMatrixAt(index, matrix);
    color.setHex(0x324d36).lerp(new THREE.Color(0x6c7441), random() * 0.52);
    shrubs.setColorAt(index, color);
  }
  shrubs.instanceMatrix.needsUpdate = true;
  if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
  shrubs.castShadow = true;
  group.add(shrubs);
  geometries.push(shrubGeometry);
  materials.push(shrubMaterial);

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.2, 2.3, 7);
  trunkGeometry.translate(0, 1.15, 0);
  const crownGeometry = new THREE.ConeGeometry(1.04, 2.4, 7, 2);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x493827,
    roughness: 0.96,
    metalness: 0,
    wireframe: topology,
  });
  const crownMaterial = new THREE.MeshStandardMaterial({
    color: 0x314d39,
    roughness: 0.93,
    metalness: 0,
    wireframe: topology,
  });
  const treeCount = 80;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
  trunks.name = 'Instanced distant tree-line trunks';
  crowns.name = 'Instanced distant tree-line crowns';
  for (let index = 0; index < treeCount; index += 1) {
    const x = THREE.MathUtils.lerp(-142, 142, index / Math.max(1, treeCount - 1)) + (random() - 0.5) * 3.6;
    const z = THREE.MathUtils.lerp(98, 110, random());
    const size = 0.82 + random() * 1.25;
    const groundY = battlefieldField(x, z).height;
    quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
    scale.set(size * 0.7, size, size * 0.7);
    matrix.compose(new THREE.Vector3(x, groundY, z), quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    scale.set(size * (1.05 + random() * 0.35), size * (1.2 + random() * 0.5), size * (0.92 + random() * 0.32));
    matrix.compose(new THREE.Vector3(x, groundY + size * 2.7, z), quaternion, scale);
    crowns.setMatrixAt(index, matrix);
    color.setHex(0x294637).lerp(new THREE.Color(0x4f6540), random() * 0.7);
    crowns.setColorAt(index, color);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);
  geometries.push(trunkGeometry, crownGeometry);
  materials.push(trunkMaterial, crownMaterial);

  return {
    group,
    geometries,
    materials,
    counts: { grass: grassCount, rocks: rockCount, shrubs: shrubCount, trees: treeCount },
  };
}

function createRockGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.72, 1);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const random = mulberry32(seed);
  for (let index = 0; index < position.count; index += 1) {
    const factor = 0.78 + random() * 0.4;
    position.setXYZ(
      index,
      position.getX(index) * factor,
      position.getY(index) * (0.72 + random() * 0.28),
      position.getZ(index) * factor,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createFactionStandards(
  bounds: THREE.Box3,
  topology: boolean,
): { group: THREE.Group; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] } {
  const group = new THREE.Group();
  group.name = 'Opposing faction field standards';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const poleGeometry = new THREE.CylinderGeometry(0.028, 0.038, 4.4, 9);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x5b3a24,
    roughness: 0.82,
    metalness: 0,
    wireframe: topology,
  });
  geometries.push(poleGeometry);
  materials.push(poleMaterial);
  for (const faction of ['croatian', 'ottoman'] as const) {
    const x = faction === 'croatian' ? bounds.min.x - 1.25 : bounds.max.x + 1.25;
    const z = -6.4;
    const standard = new THREE.Group();
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 2.2;
    pole.castShadow = true;
    standard.add(pole);
    const texture = createStandardTexture(faction);
    textures.push(texture);
    const flagGeometry = new THREE.PlaneGeometry(1.35, 0.78, 4, 2);
    const flagMaterial = new THREE.MeshStandardMaterial({
      map: topology ? null : texture,
      color: topology ? (faction === 'croatian' ? 0xe2d36b : 0xd8775e) : 0xffffff,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
      wireframe: topology,
    });
    geometries.push(flagGeometry);
    materials.push(flagMaterial);
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(faction === 'croatian' ? 0.69 : -0.69, 3.75, 0);
    flag.castShadow = true;
    standard.add(flag);
    standard.position.set(x, battlefieldField(x, z).height, z);
    group.add(standard);
  }
  return { group, geometries, materials, textures };
}

function createStandardTexture(faction: Faction): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 224;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create field-standard texture.');
  if (faction === 'croatian') {
    context.fillStyle = '#e7dfc8';
    context.fillRect(0, 0, 384, 224);
    const square = 56;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        if ((x + y) % 2 === 0) continue;
        context.fillStyle = '#9e332c';
        context.fillRect(x * square, y * square, square, square);
      }
    }
  } else {
    context.fillStyle = '#7f2925';
    context.fillRect(0, 0, 384, 224);
    context.strokeStyle = '#d7b65c';
    context.lineWidth = 13;
    context.beginPath();
    context.arc(192, 112, 60, 0.35 * Math.PI, 1.65 * Math.PI);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `${faction} field standard`;
  return texture;
}

function createBattleDust(selectedShot: BattleShot, seed: number): {
  group: THREE.Group;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
} {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create battle-dust texture.');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(190,164,112,.48)');
  gradient.addColorStop(0.45, 'rgba(157,136,96,.2)');
  gradient.addColorStop(1, 'rgba(120,104,76,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = 'Deterministic battle dust';
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xc4ae78,
    transparent: true,
    opacity: selectedShot === 'charge' ? 0.29 : 0.22,
    depthWrite: false,
  });
  const group = new THREE.Group();
  group.name = 'Static capture battle-dust volume';
  const random = mulberry32(seed ^ 0x2d98_1ce7);
  const count = selectedShot === 'charge' ? 14 : 10;
  for (let index = 0; index < count; index += 1) {
    const sprite = new THREE.Sprite(material);
    const x = THREE.MathUtils.lerp(-5.8, 5.8, random());
    const z = THREE.MathUtils.lerp(-5.6, 5.6, random());
    sprite.position.set(x, battlefieldField(x, z).height + 0.48 + random() * 0.75, z);
    const size = 1.4 + random() * 2.4;
    sprite.scale.set(size * 1.7, size, 1);
    group.add(sprite);
  }
  return { group, texture, material };
}

function addLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xe9f0e4, 0x4b3f32, 1.72));
  const sun = new THREE.DirectionalLight(0xffc985, 3.65);
  sun.position.set(-15, 24, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.00014;
  sun.shadow.normalBias = 0.022;
  const coolFill = new THREE.DirectionalLight(0xaacde0, 0.68);
  coolFill.position.set(14, 8, 9);
  const rim = new THREE.DirectionalLight(0xd3ab64, 0.82);
  rim.position.set(3, 7, -14);
  scene.add(sun, coolFill, rim);
}

function cameraFovForShot(selectedShot: BattleShot): number {
  switch (selectedShot) {
    case 'establishing': return 39;
    case 'charge': return 36;
    case 'clash': return 35;
    case 'aftermath': return 38;
  }
}

function frameHeroCamera(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  selectedShot: BattleShot,
  target: THREE.Vector3,
  manifest: { subjectRadius: number },
): void {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const subjectRadius = Math.hypot(size.x * 0.5, size.z * 0.5) + (selectedShot === 'establishing' ? 2.2 : 1.35);
  manifest.subjectRadius = subjectRadius;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * camera.aspect);
  const horizontalDistance = subjectRadius / Math.max(0.15, Math.sin(horizontalFov * 0.5));
  const horizontalFitMultipliers: Record<BattleShot, number> = {
    establishing: 1.16,
    charge: 1.06,
    clash: 0.96,
    aftermath: 1.08,
  };
  const cinematicRadiusMultipliers: Record<BattleShot, number> = {
    establishing: 4.8,
    charge: 2.35,
    clash: 1.72,
    aftermath: 2.4,
  };
  const distance = Math.max(
    horizontalDistance * horizontalFitMultipliers[selectedShot],
    subjectRadius * cinematicRadiusMultipliers[selectedShot],
  );
  const azimuths: Record<BattleShot, number> = {
    establishing: -2.915,
    charge: -2.98,
    clash: -2.78,
    aftermath: 2.82,
  };
  const elevations: Record<BattleShot, number> = {
    establishing: 0.08,
    charge: 0.055,
    clash: 0.035,
    aftermath: 0.12,
  };
  const azimuth = azimuths[selectedShot];
  target.set(center.x, 0.78 + battlefieldField(center.x, center.z).height, center.z);
  camera.position.set(
    target.x + Math.sin(azimuth) * distance,
    target.y + distance * elevations[selectedShot],
    target.z + Math.cos(azimuth) * distance,
  );
  camera.lookAt(target);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeSource(source: FighterSource | null): void {
  if (!source) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
