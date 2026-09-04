import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  createBackyardGoatModel,
  loadBackyardGoatSource,
} from '../residences/backyardGoatAssets.ts';

declare global {
  interface Window {
    __ANIMAL_LINEUP_READY__?: boolean;
    __ANIMAL_LINEUP_ERROR__?: string;
    __ANIMAL_LINEUP_DIAGNOSTICS__?: AnimalLineupDiagnostics;
  }
}

type AnimalCategory = 'domestic' | 'wild' | 'water';
type ScaleMode = 'height' | 'length';

type AnimalSpec = {
  id: string;
  label: string;
  detail: string;
  category: AnimalCategory;
  url: string;
  targetMeters: number;
  scaleMode: ScaleMode;
  x: number;
  z: number;
  yaw: number;
  lift?: number;
};

type AnimalLineupDiagnostics = {
  presentationCount: number;
  distinctSourceCount: number;
  loadedIds: string[];
  animatedCount: number;
  triangleCount: number;
  drawCalls: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
};

type LineupAnimal = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
};

const BACK_ROW_Z = -2.8;
const FRONT_ROW_Z = 3.2;
const DOMESTIC_X = [-8.1, -5.4, -2.7, 0, 2.7, 5.4, 8.1] as const;
const WILD_X = [-6.75, -4.05, -1.35, 1.35, 4.05, 6.75] as const;

const ANIMALS: readonly AnimalSpec[] = [
  {
    id: 'bull-ox', label: 'Bull / Ox', detail: 'Cattle & draft power', category: 'domestic',
    url: '/assets/models/livestock/quaternius-bull.glb', targetMeters: 1.72,
    scaleMode: 'height', x: DOMESTIC_X[0], z: BACK_ROW_Z, yaw: -0.2,
  },
  {
    id: 'cow', label: 'Cow', detail: 'Pasture cattle', category: 'domestic',
    url: '/assets/models/livestock/quaternius-cow.glb', targetMeters: 1.55,
    scaleMode: 'height', x: DOMESTIC_X[1], z: BACK_ROW_Z, yaw: -0.14,
  },
  {
    id: 'sheep', label: 'Sheep', detail: 'Pasture flock', category: 'domestic',
    url: '/assets/models/livestock/quaternius-sheep.glb', targetMeters: 0.92,
    scaleMode: 'height', x: DOMESTIC_X[2], z: BACK_ROW_Z, yaw: -0.08,
  },
  {
    id: 'goat', label: 'Goat', detail: 'Quaternius horned variant', category: 'domestic',
    url: '/assets/models/livestock/quaternius-goat.glb', targetMeters: 0.86,
    scaleMode: 'height', x: DOMESTIC_X[3], z: BACK_ROW_Z, yaw: 0,
  },
  {
    id: 'pig', label: 'Pig', detail: 'Swine & backyard pens', category: 'domestic',
    url: '/assets/models/livestock/quaternius-pig.glb', targetMeters: 0.78,
    scaleMode: 'height', x: DOMESTIC_X[4], z: BACK_ROW_Z, yaw: 0.08,
  },
  {
    id: 'chicken', label: 'Chicken', detail: 'Backyard poultry', category: 'domestic',
    url: '/assets/models/livestock/quaternius-chicken.glb', targetMeters: 0.45,
    scaleMode: 'height', x: DOMESTIC_X[5], z: BACK_ROW_Z, yaw: 0.14,
  },
  {
    id: 'horse', label: 'Horse', detail: 'Pasture & cavalry', category: 'domestic',
    url: '/assets/models/horses/quaternius-horse.gltf', targetMeters: 1.7,
    scaleMode: 'height', x: DOMESTIC_X[6], z: BACK_ROW_Z, yaw: 0.2,
  },
  {
    id: 'doe', label: 'Doe', detail: 'Roaming deer', category: 'wild',
    url: '/assets/models/deer/quaternius-deer.glb', targetMeters: 1.7,
    scaleMode: 'height', x: WILD_X[0], z: FRONT_ROW_Z, yaw: -0.18,
  },
  {
    id: 'stag', label: 'Stag', detail: 'Roaming deer', category: 'wild',
    url: '/assets/models/deer/quaternius-stag.glb', targetMeters: 2,
    scaleMode: 'height', x: WILD_X[1], z: FRONT_ROW_Z, yaw: -0.1,
  },
  {
    id: 'dog', label: 'Dog', detail: 'Guard animal', category: 'wild',
    url: '/assets/models/wild-animals/quaternius-husky.gltf', targetMeters: 1.45,
    scaleMode: 'length', x: WILD_X[2], z: FRONT_ROW_Z, yaw: Math.PI - 0.52,
  },
  {
    id: 'fox', label: 'Fox', detail: 'Wild attacker', category: 'wild',
    url: '/assets/models/wild-animals/quaternius-fox.gltf', targetMeters: 1.12,
    scaleMode: 'length', x: WILD_X[3], z: FRONT_ROW_Z, yaw: Math.PI + 0.44,
  },
  {
    id: 'wolf', label: 'Wolf', detail: 'Wild attacker', category: 'wild',
    url: '/assets/models/wild-animals/quaternius-wolf.gltf', targetMeters: 1.72,
    scaleMode: 'length', x: WILD_X[4], z: FRONT_ROW_Z, yaw: Math.PI - 0.42,
  },
  {
    id: 'fish', label: 'Fish', detail: 'River shoals', category: 'water',
    url: '/assets/models/fish/quaternius-fish.glb', targetMeters: 0.82,
    scaleMode: 'length', x: WILD_X[5], z: FRONT_ROW_Z, yaw: Math.PI * 0.42, lift: 0.42,
  },
] as const;

const REVIEW_PARAMS = new URLSearchParams(window.location.search);
const IS_EYE_REVIEW = REVIEW_PARAMS.get('view') === 'eyes';
const REQUESTED_EYE_REVIEW_ANIMAL = REVIEW_PARAMS.get('animal');
const EYE_REVIEW_IDS = REQUESTED_EYE_REVIEW_ANIMAL
  && ['cow', 'sheep', 'goat', 'pig'].includes(REQUESTED_EYE_REVIEW_ANIMAL)
  ? [REQUESTED_EYE_REVIEW_ANIMAL]
  : ['cow', 'sheep', 'goat', 'pig'];
const EYE_REVIEW_X = [-2, -0.67, 0.67, 2] as const;
const ACTIVE_ANIMALS: readonly AnimalSpec[] = IS_EYE_REVIEW
  ? EYE_REVIEW_IDS.map((id, index) => {
      const source = ANIMALS.find((animal) => animal.id === id)!;
      const isSingleAnimalReview = EYE_REVIEW_IDS.length === 1;
      return {
        ...source,
        x: isSingleAnimalReview ? 0 : EYE_REVIEW_X[index]!,
        z: 0,
        yaw: isSingleAnimalReview
          ? -0.58
          : [-0.5, -0.42, 0.42, 0.5][index]!,
      };
    })
  : ANIMALS;

const host = document.querySelector<HTMLElement>('#lineup-root');
const status = document.querySelector<HTMLElement>('#status');
const errorHost = document.querySelector<HTMLElement>('#error');
if (!host || !status || !errorHost) throw new Error('Animal lineup host is incomplete.');

let renderer: THREE.WebGLRenderer | null = null;
let labelRenderer: CSS2DRenderer | null = null;
let environmentTarget: THREE.WebGLRenderTarget | null = null;
let running = true;
const lineupAnimals: LineupAnimal[] = [];
const ownedMaterials = new Set<THREE.Material>();
const ownedGeometries = new Set<THREE.BufferGeometry>();

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.prepend(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.zIndex = '3';
  labelRenderer.domElement.style.pointerEvents = 'none';
  host.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87927d);
  scene.fog = new THREE.Fog(0x87927d, 19, 34);

  const roomEnvironment = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.035);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.4;
  roomEnvironment.dispose();
  pmremGenerator.dispose();

  scene.add(createLighting());
  scene.add(createGround());
  scene.add(createBackdrop());

  const loader = new GLTFLoader();
  const standardSpecs = ACTIVE_ANIMALS.filter((spec) => spec.id !== 'goat');
  const [standardGltfs, goatSource] = await Promise.all([
    Promise.all(standardSpecs.map((spec) => loader.loadAsync(spec.url))),
    loadBackyardGoatSource(),
  ]);

  const gltfById = new Map<string, GLTF>();
  standardSpecs.forEach((spec, index) => gltfById.set(spec.id, standardGltfs[index]!));

  let animatedCount = 0;
  for (const spec of ACTIVE_ANIMALS) {
    const lineupAnimal = spec.id === 'goat'
      ? createGoatLineupAnimal(spec, goatSource)
      : createLineupAnimal(spec, gltfById.get(spec.id)!);
    if (lineupAnimal.mixer) animatedCount += 1;
    lineupAnimals.push(lineupAnimal);
    scene.add(lineupAnimal.root);
    scene.add(createGroundMarker(spec));
    if (spec.id === 'fish') scene.add(createFishPool(spec));
  }

  const isSingleAnimalReview = IS_EYE_REVIEW && ACTIVE_ANIMALS.length === 1;
  const singleReviewId = isSingleAnimalReview ? ACTIVE_ANIMALS[0]!.id : null;
  const singleReviewCamera = singleReviewId === 'cow'
    ? { targetX: -0.6, targetY: 1.18, targetZ: 0.52, positionY: 1.34, positionZ: 2.35 }
    : singleReviewId === 'pig'
      ? { targetX: -0.36, targetY: 0.55, targetZ: 0.48, positionY: 0.68, positionZ: 1.48 }
      : { targetX: -0.24, targetY: 0.79, targetZ: 0.42, positionY: 0.9, positionZ: 1.62 };
  const cameraTarget = IS_EYE_REVIEW
    ? new THREE.Vector3(
        isSingleAnimalReview ? singleReviewCamera.targetX : 0,
        isSingleAnimalReview ? singleReviewCamera.targetY : 0.72,
        isSingleAnimalReview ? singleReviewCamera.targetZ : 0,
      )
    : new THREE.Vector3(0, 0.9, 0.55);
  const camera = new THREE.PerspectiveCamera(IS_EYE_REVIEW ? 27 : 34, 16 / 9, 0.08, 80);
  camera.position.set(
    isSingleAnimalReview ? singleReviewCamera.targetX : 0,
    isSingleAnimalReview ? singleReviewCamera.positionY : IS_EYE_REVIEW ? 2.5 : 8.5,
    isSingleAnimalReview ? singleReviewCamera.positionZ : IS_EYE_REVIEW ? 10.5 : 18.8,
  );
  camera.lookAt(cameraTarget);
  scene.add(camera);

  const render = (): void => {
    if (!running || !renderer || !labelRenderer) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  const timer = new THREE.Timer();
  timer.connect(document);
  const animate = (timestamp: DOMHighResTimeStamp): void => {
    if (!running) return;
    timer.update(timestamp);
    const dt = Math.min(0.05, timer.getDelta());
    for (const animal of lineupAnimals) animal.mixer?.update(dt);
    render();
    requestAnimationFrame(animate);
  };

  window.addEventListener('resize', render);
  render();
  await new Promise<void>((resolve) => requestAnimationFrame(() => {
    render();
    resolve();
  }));

  window.__ANIMAL_LINEUP_DIAGNOSTICS__ = {
    presentationCount: ACTIVE_ANIMALS.length,
    distinctSourceCount: new Set(ACTIVE_ANIMALS.map((spec) => spec.url)).size,
    loadedIds: ACTIVE_ANIMALS.map((spec) => spec.id),
    animatedCount,
    triangleCount: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    camera: {
      position: camera.position.toArray() as [number, number, number],
      target: cameraTarget.toArray() as [number, number, number],
      fov: camera.fov,
    },
  };
  window.__ANIMAL_LINEUP_READY__ = true;
  document.body.dataset.ready = 'true';
  document.body.dataset.lineupSignature = ACTIVE_ANIMALS.map((spec) => spec.id).join(',');
  status.textContent = IS_EYE_REVIEW
    ? singleReviewId === 'goat'
      ? 'Quaternius horn construction · close review'
      : 'Quaternius eye construction · close review'
    : `${ACTIVE_ANIMALS.length} presentations · ${animatedCount} animated · true scale`;
  if (IS_EYE_REVIEW) {
    const heading = document.querySelector<HTMLElement>('h1');
    const caption = document.querySelector<HTMLElement>('#caption');
    if (heading) heading.textContent = singleReviewId === 'goat' ? 'Goat Horn Review' : 'Animal Eye Review';
    if (caption) caption.textContent = singleReviewId === 'goat'
      ? 'Cow-source horn facets · original material · fully weighted to the goat head'
      : 'Cow reference · head-weighted black eye geometry · white catchlight facets';
  }
  requestAnimationFrame(animate);

  window.addEventListener('beforeunload', () => {
    running = false;
    window.removeEventListener('resize', render);
    for (const animal of lineupAnimals) animal.mixer?.stopAllAction();
    for (const material of ownedMaterials) material.dispose();
    for (const geometry of ownedGeometries) geometry.dispose();
    timer.dispose();
    environmentTarget?.dispose();
    labelRenderer?.domElement.remove();
    renderer?.dispose();
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  window.__ANIMAL_LINEUP_ERROR__ = message;
  document.body.dataset.error = 'true';
  status.textContent = 'Lineup failed to load';
  errorHost.textContent = `Animal lineup failed: ${message}`;
  console.error('[Animal lineup]', error);
}

function createLineupAnimal(spec: AnimalSpec, gltf: GLTF): LineupAnimal {
  const model = gltf.scene;
  const sourceBounds = new THREE.Box3().setFromObject(model);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const measuredDimension = spec.scaleMode === 'height'
    ? sourceSize.y
    : Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
  if (!Number.isFinite(measuredDimension) || measuredDimension <= 0.001) {
    throw new Error(`${spec.label} has invalid model bounds.`);
  }

  const scale = spec.targetMeters / measuredDimension;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  centerAndGround(model, spec.lift ?? 0.018);
  configureAnimalMeshes(model);

  const root = new THREE.Group();
  root.name = `${spec.label} animal lineup presentation`;
  root.position.set(spec.x, 0, spec.z);
  root.rotation.y = spec.yaw;
  root.add(model);
  attachLabel(root, spec);
  return { root, mixer: startPresentationAnimation(model, gltf.animations) };
}

function createGoatLineupAnimal(
  spec: AnimalSpec,
  source: Awaited<ReturnType<typeof loadBackyardGoatSource>>,
): LineupAnimal {
  const model = createBackyardGoatModel(source, spec.targetMeters);
  model.updateMatrixWorld(true);
  centerAndGround(model, 0.018);
  configureAnimalMeshes(model);

  const root = new THREE.Group();
  root.name = 'Goat animal lineup presentation';
  root.position.set(spec.x, 0, spec.z);
  root.rotation.y = spec.yaw;
  root.add(model);
  attachLabel(root, spec);
  return { root, mixer: startPresentationAnimation(model, [source.idle, source.graze]) };
}

function centerAndGround(model: THREE.Object3D, lift: number): void {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y += lift - bounds.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
}

function configureAnimalMeshes(model: THREE.Object3D): void {
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = Math.max(0.56, material.roughness);
      }
    }
  });
}

function startPresentationAnimation(
  model: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
): THREE.AnimationMixer | null {
  if (animations.length === 0) return null;
  const preferred = animations.find((clip) => {
    const name = clip.name.toLowerCase();
    return name.includes('idle') && !name.includes('headlow');
  }) ?? animations.find((clip) => clip.name.toLowerCase().includes('swimming_normal'))
    ?? animations.find((clip) => clip.name.toLowerCase().includes('eat'))
    ?? animations[0];
  if (!preferred) return null;
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(preferred, model);
  action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
  action.play();
  mixer.setTime((hashString(model.name || preferred.name) % 1000) / 1000 * Math.max(0.001, preferred.duration));
  return mixer;
}

function attachLabel(root: THREE.Group, spec: AnimalSpec): void {
  const element = document.createElement('div');
  element.className = 'animal-label';
  element.dataset.category = spec.category;
  const title = document.createElement('strong');
  title.textContent = spec.label;
  const detail = document.createElement('span');
  detail.textContent = spec.detail;
  element.append(title, detail);
  const label = new CSS2DObject(element);
  label.name = `${spec.label} lineup label`;
  // A shared presentation plane keeps the two perspective rows legible even
  // though the actors range from a 45 cm chicken to a two-metre stag.
  label.position.set(0, spec.category === 'domestic' ? 2.42 : 2.34, 0);
  root.add(label);
}

function createGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(48, 34, 1, 1);
  const texture = createGroundTexture();
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 8);
  const material = new THREE.MeshStandardMaterial({
    color: 0x778064,
    map: texture,
    roughness: 0.98,
    metalness: 0,
  });
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'Animal lineup grass court';
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.018;
  ground.receiveShadow = true;
  return ground;
}

function createGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 384;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create animal lineup ground texture.');
  context.fillStyle = '#788066';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let state = 0x51e10a11;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = 0; index < 4_200; index += 1) {
    const shade = Math.floor(78 + random() * 78);
    context.fillStyle = `rgba(${Math.floor(shade * 0.78)},${shade},${Math.floor(shade * 0.58)},${0.05 + random() * 0.11})`;
    const radius = 0.45 + random() * 1.8;
    context.fillRect(random() * canvas.width, random() * canvas.height, radius, radius * (0.5 + random()));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createGroundMarker(spec: AnimalSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = `${spec.label} lineup ground marker`;
  const color = spec.category === 'domestic' ? 0xa9853f : spec.category === 'wild' ? 0x607a51 : 0x4f8290;
  const diskGeometry = new THREE.CircleGeometry(spec.id === 'fish' ? 0.82 : 0.72, 40);
  const ringGeometry = new THREE.RingGeometry(spec.id === 'fish' ? 0.8 : 0.7, spec.id === 'fish' ? 0.87 : 0.76, 48);
  const diskMaterial = new THREE.MeshStandardMaterial({ color: 0x70745d, roughness: 0.94 });
  const ringMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04 });
  ownedGeometries.add(diskGeometry);
  ownedGeometries.add(ringGeometry);
  ownedMaterials.add(diskMaterial);
  ownedMaterials.add(ringMaterial);
  const disk = new THREE.Mesh(diskGeometry, diskMaterial);
  disk.rotation.x = -Math.PI * 0.5;
  disk.position.set(spec.x, 0.003, spec.z);
  disk.receiveShadow = true;
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI * 0.5;
  ring.position.set(spec.x, 0.006, spec.z);
  group.add(disk, ring);
  return group;
}

function createFishPool(spec: AnimalSpec): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(0.68, 48);
  const material = new THREE.MeshStandardMaterial({
    color: 0x477785,
    roughness: 0.24,
    metalness: 0.04,
    transparent: true,
    opacity: 0.86,
  });
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  const pool = new THREE.Mesh(geometry, material);
  pool.name = 'Fish lineup water inset';
  pool.rotation.x = -Math.PI * 0.5;
  pool.position.set(spec.x, 0.014, spec.z);
  pool.receiveShadow = true;
  return pool;
}

function createBackdrop(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Animal lineup woodland backdrop';
  const trunkGeometry = new THREE.CylinderGeometry(0.09, 0.14, 3.1, 7);
  const crownGeometry = new THREE.ConeGeometry(0.75, 2.35, 9);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x514330, roughness: 1 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x465b3d, roughness: 0.98 });
  ownedGeometries.add(trunkGeometry);
  ownedGeometries.add(crownGeometry);
  ownedMaterials.add(trunkMaterial);
  ownedMaterials.add(crownMaterial);
  for (let index = 0; index < 19; index += 1) {
    const x = -18 + index * 2;
    const z = -7.2 - (index % 3) * 0.65;
    const scale = 0.74 + (index % 5) * 0.08;
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, 1.55 * scale, z);
    trunk.scale.setScalar(scale);
    trunk.castShadow = true;
    const crown = new THREE.Mesh(crownGeometry, crownMaterial);
    crown.position.set(x, 3.25 * scale, z);
    crown.scale.setScalar(scale);
    crown.castShadow = true;
    group.add(trunk, crown);
  }
  return group;
}

function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Animal lineup three-point lighting';
  const hemisphere = new THREE.HemisphereLight(0xe6ede1, 0x40382c, 1.65);
  const sun = new THREE.DirectionalLight(0xffdfac, 3.5);
  sun.position.set(-10, 15, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 42;
  sun.shadow.bias = -0.00016;
  sun.shadow.normalBias = 0.018;
  const fill = new THREE.DirectionalLight(0xa9c1c8, 0.65);
  fill.position.set(11, 7, 4);
  const rim = new THREE.DirectionalLight(0xd2b56d, 0.75);
  rim.position.set(1, 6, -8);
  group.add(hemisphere, sun, fill, rim);
  return group;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
