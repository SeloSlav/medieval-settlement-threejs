import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type WorkerToolKind = 'hatchet' | 'pickaxe' | 'hammer' | 'hoe' | 'shovel' | 'spear' | 'crossbow' | 'sidearm' | 'sword-shield' | 'halberd' | 'bow';

export const WORKER_TOOL_URLS: Record<WorkerToolKind, string> = {
  hatchet: '/assets/models/worker-tools/kenney-tool-hatchet.glb',
  pickaxe: '/assets/models/worker-tools/kenney-tool-pickaxe.glb',
  hammer: '/assets/models/worker-tools/kenney-tool-hammer.glb',
  hoe: '/assets/models/worker-tools/kenney-tool-hoe.glb',
  shovel: '/assets/models/worker-tools/kenney-tool-shovel.glb',
  spear: '/assets/models/worker-tools/quaternius-spear.glb',
  // Crossbows are assembled below from lightweight primitives so the military
  // renderer does not depend on another externally-authored asset.
  crossbow: '',
  sidearm: '',
  'sword-shield': '',
  halberd: '',
  bow: '',
};

type WorkerToolFit = {
  /** Target dimensions along the model's authored X/Y/Z axes, in metres. */
  targetSize?: readonly [number, number, number];
  targetLength?: number;
  gripFractionFromHandleEnd: number;
};

/**
 * Kenney's hand tools deliberately exaggerate their metal heads. Fitting the
 * whole model to a single length made the 60 cm builder hammer especially
 * toy-like and left every other head much too thick. These axis-specific
 * dimensions preserve readable silhouettes while matching ordinary historic
 * hand-tool proportions against a 1.6-1.75 m villager.
 */
const WORKER_TOOL_FIT: Record<WorkerToolKind, WorkerToolFit> = {
  hatchet: {
    targetSize: [0.15, 0.42, 0.045],
    gripFractionFromHandleEnd: 0.18,
  },
  pickaxe: {
    targetSize: [0.48, 0.82, 0.055],
    gripFractionFromHandleEnd: 0.32,
  },
  hammer: {
    targetSize: [0.13, 0.34, 0.045],
    gripFractionFromHandleEnd: 0.14,
  },
  hoe: {
    targetSize: [0.18, 0.95, 0.07],
    gripFractionFromHandleEnd: 0.28,
  },
  shovel: {
    targetSize: [0.18, 0.9, 0.055],
    gripFractionFromHandleEnd: 0.25,
  },
  // Quaternius' source includes an off-axis root transform, so retain its
  // uniform fit. This target yields an approximately 1.8 m carried spear.
  spear: {
    targetLength: 2.25,
    gripFractionFromHandleEnd: 0.28,
  },
  crossbow: {
    targetLength: 0.82,
    gripFractionFromHandleEnd: 0.5,
  },
  sidearm: { targetLength: 0.86, gripFractionFromHandleEnd: 0.13 },
  'sword-shield': { targetLength: 1.05, gripFractionFromHandleEnd: 0.35 },
  halberd: { targetLength: 2.18, gripFractionFromHandleEnd: 0.30 },
  bow: { targetLength: 1.35, gripFractionFromHandleEnd: 0.50 },
};

export type WorkerToolSource = {
  kind: WorkerToolKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  sourceLength: number;
};

export type WorkerToolSources = Record<WorkerToolKind, WorkerToolSource>;

export async function loadWorkerToolSources(): Promise<WorkerToolSources> {
  const loader = new GLTFLoader();
  const [hatchet, pickaxe, hammer, hoe, shovel, spear] = await Promise.all([
    loader.loadAsync(WORKER_TOOL_URLS.hatchet),
    loader.loadAsync(WORKER_TOOL_URLS.pickaxe),
    loader.loadAsync(WORKER_TOOL_URLS.hammer),
    loader.loadAsync(WORKER_TOOL_URLS.hoe),
    loader.loadAsync(WORKER_TOOL_URLS.shovel),
    loader.loadAsync(WORKER_TOOL_URLS.spear),
  ]);
  return {
    hatchet: createWorkerToolSource('hatchet', hatchet.scene),
    pickaxe: createWorkerToolSource('pickaxe', pickaxe.scene),
    hammer: createWorkerToolSource('hammer', hammer.scene),
    hoe: createWorkerToolSource('hoe', hoe.scene),
    shovel: createWorkerToolSource('shovel', shovel.scene),
    spear: createWorkerToolSource('spear', spear.scene),
    crossbow: createWorkerToolSource('crossbow', createProceduralCrossbow()),
    sidearm: createWorkerToolSource('sidearm', createProceduralSidearm()),
    'sword-shield': createWorkerToolSource('sword-shield', createProceduralSwordShield()),
    halberd: createWorkerToolSource('halberd', createProceduralHalberd()),
    bow: createWorkerToolSource('bow', createProceduralBow()),
  };
}

function militaryMaterials(): { wood: THREE.MeshStandardMaterial; iron: THREE.MeshStandardMaterial; cord: THREE.LineBasicMaterial } {
  return {
    wood: new THREE.MeshStandardMaterial({ color: 0x704826, roughness: 0.84, metalness: 0.02 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x555754, roughness: 0.42, metalness: 0.72 }),
    cord: new THREE.LineBasicMaterial({ color: 0xc4b58d }),
  };
}

function createProceduralSidearm(): THREE.Group {
  const group = new THREE.Group();
  const { wood, iron } = militaryMaterials();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.68, 0.018), iron);
  blade.position.y = 0.40;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.04), iron);
  guard.position.y = 0.035;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.18, 7), wood);
  grip.position.y = -0.075;
  group.add(blade, guard, grip);
  group.name = 'Procedural sidearm';
  return group;
}

function createProceduralSwordShield(): THREE.Group {
  const group = new THREE.Group();
  const { wood, iron } = militaryMaterials();
  const sword = createProceduralSidearm();
  sword.position.set(-0.22, -0.08, 0.06);
  sword.rotation.z = 0.18;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), wood);
  shield.scale.set(0.68, 1.0, 0.12);
  shield.position.set(0.26, 0.27, 0.04);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), iron);
  boss.scale.z = 0.42;
  boss.position.set(0.26, 0.27, 0.10);
  group.add(sword, shield, boss);
  group.name = 'Procedural sword and large shield';
  return group;
}

function createProceduralHalberd(): THREE.Group {
  const group = new THREE.Group();
  const { wood, iron } = militaryMaterials();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.92, 8), wood);
  const spear = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.30, 4), iron);
  spear.position.y = 1.10;
  const axe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.20, 0.045), iron);
  axe.position.set(0.12, 0.94, 0);
  axe.rotation.z = -0.22;
  group.add(shaft, spear, axe);
  group.name = 'Procedural halberd';
  return group;
}

function createProceduralBow(): THREE.Group {
  const group = new THREE.Group();
  const { wood, cord } = militaryMaterials();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.70, 8), wood);
  upper.position.set(0.12, 0.34, 0);
  upper.rotation.z = -0.34;
  const lower = upper.clone();
  lower.position.set(0.12, -0.34, 0);
  lower.rotation.z = 0.34;
  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.235, 0.67, 0), new THREE.Vector3(-0.02, 0, 0), new THREE.Vector3(0.235, -0.67, 0),
  ]);
  group.add(upper, lower, new THREE.Line(stringGeometry, cord));
  group.name = 'Procedural bow';
  return group;
}

function createProceduralCrossbow(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6f4527,
    roughness: 0.82,
    metalness: 0.02,
  });
  const iron = new THREE.MeshStandardMaterial({
    color: 0x4a4945,
    roughness: 0.48,
    metalness: 0.65,
  });
  const cord = new THREE.LineBasicMaterial({ color: 0xc8b992 });

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.72, 0.065), wood);
  stock.position.y = 0.05;
  group.add(stock);

  const tiller = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.055), wood);
  tiller.position.set(0, -0.28, 0.04);
  tiller.rotation.z = -0.22;
  group.add(tiller);

  const bow = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.035, 0.045), iron);
  bow.position.set(0, 0.29, 0);
  group.add(bow);

  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 8), iron);
  nut.rotation.z = Math.PI / 2;
  nut.position.set(0, 0.06, 0.02);
  group.add(nut);

  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.39, 0.29, 0.01),
    new THREE.Vector3(0, 0.06, 0.01),
    new THREE.Vector3(0.39, 0.29, 0.01),
  ]);
  group.add(new THREE.Line(stringGeometry, cord));
  group.name = 'Procedural crossbow';
  return group;
}

export function createWorkerToolSource(
  kind: WorkerToolKind,
  scene: THREE.Group,
): WorkerToolSource {
  const bounds = new THREE.Box3().setFromObject(scene);
  const sourceSize = bounds.getSize(new THREE.Vector3());
  const sourceLength = Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
  if (
    !Number.isFinite(sourceLength)
    || sourceLength <= 0.001
    || !Number.isFinite(sourceSize.x)
    || !Number.isFinite(sourceSize.y)
    || !Number.isFinite(sourceSize.z)
    || sourceSize.x <= 0.001
    || sourceSize.y <= 0.001
    || sourceSize.z <= 0.001
  ) {
    throw new Error(`Invalid ${kind} model bounds.`);
  }
  return { kind, scene, bounds, sourceSize, sourceLength };
}

/**
 * Parents a lightweight CC0 tool directly to the authored right-hand joint.
 * Kenney's tools and the villager rigs use different source scales. The
 * local fit is derived after reading the palm's accumulated rig scale, with
 * independent axes for the deliberately exaggerated Kenney models.
 */
export function attachWorkerTool(
  model: THREE.Group,
  source: WorkerToolSource,
): THREE.Group {
  const palm = model.getObjectByName('PalmR') ?? model.getObjectByName('R_Hand');
  if (!(palm instanceof THREE.Bone)) {
    throw new Error('Worker rig is missing its PalmR/R_Hand joint.');
  }

  model.updateWorldMatrix(true, true);
  const palmScale = palm.getWorldScale(new THREE.Vector3());
  const inheritedScale = Math.max(
    0.001,
    Math.abs(palmScale.x),
    Math.abs(palmScale.y),
    Math.abs(palmScale.z),
  );
  const fit = WORKER_TOOL_FIT[source.kind];
  const localScale = fit.targetSize
    ? new THREE.Vector3(
        fit.targetSize[0] / (source.sourceSize.x * inheritedScale),
        fit.targetSize[1] / (source.sourceSize.y * inheritedScale),
        fit.targetSize[2] / (source.sourceSize.z * inheritedScale),
      )
    : new THREE.Vector3().setScalar(
        fit.targetLength! / (source.sourceLength * inheritedScale),
      );

  const tool = source.scene.clone(true);
  tool.name = `Worker ${source.kind}`;
  tool.userData.workerTool = source.kind;
  tool.scale.copy(localScale);
  tool.position.set(
    0,
    -(source.bounds.min.y + source.sourceSize.y * fit.gripFractionFromHandleEnd)
      * localScale.y,
    0,
  );
  tool.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
  palm.add(tool);
  return tool;
}

export function disposeWorkerToolSources(sources: WorkerToolSources): void {
  for (const source of Object.values(sources)) {
    disposeModelResources(source.scene);
  }
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
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
