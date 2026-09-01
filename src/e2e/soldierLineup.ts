import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  MILITARY_KINDS,
  MILITARY_RECRUITMENT,
  type MilitaryCompanyKind,
} from '../security/militaryProgression.ts';
import {
  attachWorkerTool,
  disposeWorkerToolSources,
  loadWorkerToolSources,
  type WorkerToolKind,
} from '../settlement/workerTools.ts';
import { configureVillagerMaterialLighting } from '../settlement/villagerMaterialLighting.ts';

declare global {
  interface Window {
    __SOLDIER_LINEUP_READY__?: boolean;
    __SOLDIER_LINEUP_ERROR__?: string;
    __SOLDIER_LINEUP_DIAGNOSTICS__?: SoldierLineupDiagnostics;
  }
}

type LineupView = 'all' | 'design' | 'melee' | 'ranged' | 'near' | 'far' | 'no-post' | 'topology';

type SoldierLineupDiagnostics = {
  seed: number;
  fixedTimeSeconds: number;
  view: LineupView;
  cameraBookmark: 'near' | 'design' | 'far';
  presentation: 'final' | 'no-post' | 'topology';
  companyCount: number;
  militaryKinds: MilitaryCompanyKind[];
  toolKinds: WorkerToolKind[];
  riggedCount: number;
  attachedToolCount: number;
  triangleCount: number;
  drawCalls: number;
  textureCount: number;
  geometryCount: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    near: number;
    far: number;
  };
};

const MODEL_URL = '/assets/models/villagers/worker-male-common-01-v002.glb';
const TARGET_HEIGHT_METERS = 1.72;
const FIXED_SEED = 0x5e10_1389;
const FIXED_TIME_SECONDS = 2.25;
const COMPANY_SPACING_METERS = 1.42;

const TOOL_BY_COMPANY: Record<MilitaryCompanyKind, WorkerToolKind> = {
  militia: 'spear',
  spearmen: 'spear-shield' as WorkerToolKind,
  'men-at-arms': 'sword-shield',
  crossbows: 'crossbow',
  'mercenary-spears': 'pike-kit' as WorkerToolKind,
  footmen: 'sidearm-shield' as WorkerToolKind,
  polearms: 'halberd',
  bowmen: 'bow',
  hussars: 'spear-shield' as WorkerToolKind,
  'armored-lancers': 'spear',
  'mounted-archers': 'bow',
};

const KIT_LABELS: Record<MilitaryCompanyKind, string> = {
  militia: 'Long spear · civilian dress',
  spearmen: 'Spear · shield · gambeson',
  'men-at-arms': 'Sword · rotella · mail',
  crossbows: 'Crossbow · bolt quiver',
  'mercenary-spears': 'Landsknecht pike · sidearm',
  footmen: 'Sidearm · buckler · gambeson',
  polearms: 'Halberd · two-handed harness',
  bowmen: 'War bow · arrow quiver',
  hussars: 'Lance · sidearm · small shield · padded coat · remount',
  'armored-lancers': 'Lance · sidearm · mail · armored remount',
  'mounted-archers': 'Composite bow · sidearm · quiver · remount',
};

const MELEE_KINDS = new Set<MilitaryCompanyKind>([
  'militia',
  'spearmen',
  'men-at-arms',
  'mercenary-spears',
  'footmen',
  'polearms',
  'hussars',
  'armored-lancers',
]);
const RANGED_KINDS = new Set<MilitaryCompanyKind>(['crossbows', 'bowmen', 'mounted-archers']);

const host = document.querySelector<HTMLElement>('#lineup-root');
const labels = document.querySelector<HTMLElement>('#labels');
const status = document.querySelector<HTMLElement>('#status');
const errorHost = document.querySelector<HTMLElement>('#error');
if (!host || !labels || !status || !errorHost) {
  throw new Error('Soldier lineup host is incomplete.');
}

const requestedView = new URLSearchParams(window.location.search).get('view');
const view: LineupView = isLineupView(requestedView) ? requestedView : 'design';
const cameraBookmark: SoldierLineupDiagnostics['cameraBookmark'] = view === 'near'
  ? 'near'
  : view === 'far'
    ? 'far'
    : 'design';
const presentation: SoldierLineupDiagnostics['presentation'] = view === 'no-post'
  ? 'no-post'
  : view === 'topology'
    ? 'topology'
    : 'final';
const displayedKinds = view === 'melee'
  ? MILITARY_KINDS.filter((kind) => MELEE_KINDS.has(kind))
  : view === 'ranged'
    ? MILITARY_KINDS.filter((kind) => RANGED_KINDS.has(kind))
    : [...MILITARY_KINDS];

document.body.dataset.view = view;
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-view-link]')) {
  const linkView = link.dataset.viewLink;
  const current = linkView === view || (view === 'all' && linkView === 'design');
  if (current) link.setAttribute('aria-current', 'page');
}
labels.style.setProperty('--lineup-columns', String(displayedKinds.length));
labels.style.left = '50%';
labels.style.right = 'auto';
labels.style.width = `${Math.min(92.4, Math.max(40, displayedKinds.length * 12.5))}vw`;
labels.style.transform = 'translateX(-50%)';

let renderer: THREE.WebGLRenderer | null = null;
let environmentTarget: THREE.WebGLRenderTarget | null = null;
let workerToolSources: Awaited<ReturnType<typeof loadWorkerToolSources>> | null = null;
let sourceScene: THREE.Group | null = null;
let running = true;
const ownedMaterials = new Set<THREE.Material>();
const ownedGeometries = new Set<THREE.BufferGeometry>();
const ownedTextures = new Set<THREE.Texture>();
const mixers: THREE.AnimationMixer[] = [];

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = presentation === 'no-post' || presentation === 'topology'
    ? THREE.NoToneMapping
    : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = presentation === 'no-post' || presentation === 'topology' ? 1 : 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.prepend(renderer.domElement);

  const [villagerGltf, loadedWorkerTools] = await Promise.all([
    new GLTFLoader().loadAsync(MODEL_URL),
    loadWorkerToolSources(),
  ]);
  workerToolSources = loadedWorkerTools;
  sourceScene = villagerGltf.scene;

  const sourceBounds = new THREE.Box3().setFromObject(sourceScene);
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error('The male villager source has invalid bounds.');
  }
  const idle = findAnimationClip(villagerGltf.animations, 'idle');
  if (!idle) throw new Error('The male villager source is missing its idle clip.');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(presentation === 'topology' ? 0x1c231d : 0x8e9782);
  scene.fog = presentation === 'topology'
    ? null
    : new THREE.FogExp2(0x8e9782, cameraBookmark === 'far' ? 0.017 : 0.011);

  const roomEnvironment = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.035);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.42;
  roomEnvironment.dispose();
  pmremGenerator.dispose();

  const lighting = createLighting();
  scene.add(lighting);

  const lineupWidth = Math.max(5.8, (displayedKinds.length - 1) * COMPANY_SPACING_METERS + 2.1);
  const groundTexture = createGroundTexture(FIXED_SEED);
  groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(Math.max(5, lineupWidth / 2.5), 4);
  ownedTextures.add(groundTexture);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: presentation === 'topology' ? 0x313a31 : 0x7b8066,
    map: presentation === 'topology' ? null : groundTexture,
    roughness: 0.98,
    metalness: 0,
    wireframe: presentation === 'topology',
  });
  ownedMaterials.add(groundMaterial);
  const groundGeometry = new THREE.PlaneGeometry(Math.max(34, lineupWidth + 15), 26, 28, 18);
  ownedGeometries.add(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.name = 'Military lineup packed-earth ground';
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.012;
  ground.receiveShadow = true;
  scene.add(ground);

  const markerMaterial = new THREE.MeshStandardMaterial({
    color: presentation === 'topology' ? 0x586a59 : 0x74725c,
    roughness: 0.9,
    metalness: 0,
    wireframe: presentation === 'topology',
  });
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: presentation === 'topology' ? 0xd6b650 : 0x8f7b45,
    roughness: 0.72,
    metalness: presentation === 'topology' ? 0 : 0.08,
    wireframe: presentation === 'topology',
  });
  ownedMaterials.add(markerMaterial);
  ownedMaterials.add(ringMaterial);

  let riggedCount = 0;
  let attachedToolCount = 0;
  displayedKinds.forEach((kind, index) => {
    const centeredIndex = index - (displayedKinds.length - 1) * 0.5;
    const x = centeredIndex * COMPANY_SPACING_METERS;

    const markerGeometry = new THREE.CircleGeometry(0.77, 40);
    const ringGeometry = new THREE.RingGeometry(0.75, 0.8, 48);
    ownedGeometries.add(markerGeometry);
    ownedGeometries.add(ringGeometry);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI * 0.5;
    marker.position.set(x, 0.002, 0.12);
    marker.receiveShadow = true;
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(x, 0.004, 0.12);
    scene.add(marker, ring);

    const root = new THREE.Group();
    root.name = `${MILITARY_RECRUITMENT[kind].shortLabel} lineup soldier`;
    root.position.set(x, 0, 0.12);
    root.rotation.y = centeredIndex * -0.012;
    const model = cloneSkinned(sourceScene!) as THREE.Group;
    const scale = TARGET_HEIGHT_METERS / sourceHeight;
    model.scale.setScalar(scale);
    model.position.y = -sourceBounds.min.y * scale + 0.012;
    root.add(model);
    scene.add(root);
    model.updateWorldMatrix(true, true);

    let hasRig = false;
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (mesh.isSkinnedMesh) hasRig = true;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = sourceMaterials.map((sourceMaterial) => {
        const material = sourceMaterial.clone();
        ownedMaterials.add(material);
        if (material instanceof THREE.MeshStandardMaterial) {
          configureVillagerMaterialLighting(material);
          material.wireframe = presentation === 'topology';
          if (material.map) {
            material.map.anisotropy = renderer!.capabilities.getMaxAnisotropy();
            material.map.needsUpdate = true;
          }
        }
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
    if (hasRig) riggedCount += 1;

    const toolKind = TOOL_BY_COMPANY[kind];
    const toolSource = loadedWorkerTools[toolKind];
    if (!toolSource) throw new Error(`The ${kind} company is missing its ${toolKind} equipment source.`);
    const tool = attachWorkerTool(model, toolSource);
    const equipmentMounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
    for (const mount of equipmentMounts ?? [tool]) {
      mount.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (presentation === 'topology') {
          const toolMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of toolMaterials) {
            if (material instanceof THREE.MeshStandardMaterial) material.wireframe = true;
          }
        }
      });
    }
    attachedToolCount += 1;

    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(idle, model);
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.play();
    mixer.setTime(FIXED_TIME_SECONDS % Math.max(0.001, idle.duration));
    mixers.push(mixer);

    if (presentation === 'topology') {
      const skeleton = new THREE.SkeletonHelper(model);
      skeleton.name = `${MILITARY_RECRUITMENT[kind].shortLabel} rig diagnostic`;
      const skeletonMaterial = skeleton.material as THREE.LineBasicMaterial;
      skeletonMaterial.color.setHex(0xefcd67);
      skeletonMaterial.transparent = true;
      skeletonMaterial.opacity = 0.55;
      skeletonMaterial.depthTest = false;
      skeleton.renderOrder = 3;
      ownedMaterials.add(skeletonMaterial);
      root.add(skeleton);
    }

    labels!.append(createLabel(kind, index));
  });

  const includesPike = displayedKinds.includes('mercenary-spears');
  const cameraTarget = new THREE.Vector3(0, includesPike ? 1.3 : 0.82, 0.05);
  const camera = createCamera(
    cameraBookmark,
    displayedKinds.length,
    includesPike,
    cameraTarget,
  );
  scene.add(camera);

  const resizeAndRender = (): void => {
    if (!running || !renderer) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  window.addEventListener('resize', resizeAndRender);
  resizeAndRender();
  await new Promise<void>((resolve) => requestAnimationFrame(() => {
    resizeAndRender();
    resolve();
  }));

  window.__SOLDIER_LINEUP_DIAGNOSTICS__ = {
    seed: FIXED_SEED,
    fixedTimeSeconds: FIXED_TIME_SECONDS,
    view,
    cameraBookmark,
    presentation,
    companyCount: displayedKinds.length,
    militaryKinds: [...displayedKinds],
    toolKinds: displayedKinds.map((kind) => TOOL_BY_COMPANY[kind]),
    riggedCount,
    attachedToolCount,
    triangleCount: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    textureCount: renderer.info.memory.textures,
    geometryCount: renderer.info.memory.geometries,
    camera: {
      position: camera.position.toArray() as [number, number, number],
      target: cameraTarget.toArray() as [number, number, number],
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    },
  };
  window.__SOLDIER_LINEUP_READY__ = true;
  document.body.dataset.ready = 'true';
  document.body.dataset.lineupSignature = [
    `seed:${FIXED_SEED}`,
    `time:${FIXED_TIME_SECONDS}`,
    `view:${view}`,
    `companies:${displayedKinds.join(',')}`,
    `tools:${displayedKinds.map((kind) => TOOL_BY_COMPANY[kind]).join(',')}`,
  ].join('|');
  status.textContent = `${displayedKinds.length} rigged companies · fixed seed ${FIXED_SEED.toString(16)}`;

  window.addEventListener('beforeunload', () => {
    running = false;
    window.removeEventListener('resize', resizeAndRender);
    for (const mixer of mixers) mixer.stopAllAction();
    if (workerToolSources) disposeWorkerToolSources(workerToolSources);
    disposeObjectResources(sourceScene);
    for (const material of ownedMaterials) material.dispose();
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const texture of ownedTextures) texture.dispose();
    environmentTarget?.dispose();
    renderer?.dispose();
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  window.__SOLDIER_LINEUP_ERROR__ = message;
  document.body.dataset.error = 'true';
  status.textContent = 'Lineup failed to load';
  errorHost.textContent = `Military equipment lineup failed: ${message}`;
  console.error('[Soldier lineup]', error);
}

function isLineupView(value: string | null): value is LineupView {
  return value === 'all'
    || value === 'design'
    || value === 'melee'
    || value === 'ranged'
    || value === 'near'
    || value === 'far'
    || value === 'no-post'
    || value === 'topology';
}

function findAnimationClip(
  animations: readonly THREE.AnimationClip[],
  semanticName: string,
): THREE.AnimationClip | undefined {
  return animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return normalized === semanticName
      || normalized.endsWith(`|${semanticName}`)
      || normalized.endsWith(`_${semanticName}`);
  });
}

function createCamera(
  bookmark: SoldierLineupDiagnostics['cameraBookmark'],
  companyCount: number,
  includesPike: boolean,
  target: THREE.Vector3,
): THREE.PerspectiveCamera {
  const lineWidth = Math.max(5.8, (companyCount - 1) * COMPANY_SPACING_METERS + 1.6);
  const distanceForWidth = lineWidth / (2 * Math.tan(THREE.MathUtils.degToRad(35 * 0.5)) * (16 / 9));
  const distance = bookmark === 'near'
    ? distanceForWidth * 0.72
    : bookmark === 'far'
      ? distanceForWidth * 1.48
      : distanceForWidth;
  const minimumDistance = bookmark === 'near'
    ? 5.2
    : bookmark === 'far'
      ? 10.5
      : includesPike
        ? 11.8
        : 6.2;
  const cameraDistance = Math.max(minimumDistance, distance + 1.1);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.08, 100);
  camera.position.set(
    bookmark === 'near' ? 0.8 : 0,
    bookmark === 'near'
      ? 2.9
      : bookmark === 'far'
        ? 4.8
        : THREE.MathUtils.clamp(cameraDistance * 0.3, 2.8, 4.1),
    cameraDistance,
  );
  camera.lookAt(target);
  return camera;
}

function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Military lineup three-point lighting';
  const hemisphere = new THREE.HemisphereLight(0xe8efe0, 0x40372b, 1.72);
  const sun = new THREE.DirectionalLight(0xffdfaa, 3.7);
  sun.position.set(-9, 14, 11);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 38;
  sun.shadow.bias = -0.00016;
  sun.shadow.normalBias = 0.018;
  const coolFill = new THREE.DirectionalLight(0x9db9c4, 0.82);
  coolFill.position.set(12, 6, 4);
  const rim = new THREE.DirectionalLight(0xd6b86f, 1.05);
  rim.position.set(2, 5, -9);
  group.add(hemisphere, sun, coolFill, rim);
  return group;
}

function createLabel(kind: MilitaryCompanyKind, index: number): HTMLElement {
  const label = document.createElement('article');
  label.className = 'label-card';
  label.dataset.militaryKind = kind;
  const number = document.createElement('span');
  number.className = 'label-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const title = document.createElement('strong');
  title.className = 'label-title';
  title.textContent = MILITARY_RECRUITMENT[kind].shortLabel;
  const kit = document.createElement('span');
  kit.className = 'label-kit';
  kit.textContent = KIT_LABELS[kind];
  label.append(number, title, kit);
  return label;
}

function createGroundTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the deterministic ground texture.');
  context.fillStyle = '#85866d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = 0; index < 5_400; index += 1) {
    const tone = Math.floor(92 + random() * 54);
    const alpha = 0.04 + random() * 0.08;
    context.fillStyle = `rgba(${tone},${Math.floor(tone * 0.97)},${Math.floor(tone * 0.76)},${alpha})`;
    const radius = 0.4 + random() * 2.1;
    context.fillRect(random() * 512, random() * 512, radius, radius * (0.55 + random()));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `Military lineup ground seed ${seed}`;
  return texture;
}

function disposeObjectResources(source: THREE.Object3D | null): void {
  if (!source) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
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
