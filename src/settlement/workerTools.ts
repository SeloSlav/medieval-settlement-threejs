import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  attachMilitaryEquipment,
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  isMilitaryEquipmentKind,
  isMilitaryEquipmentSource,
  setMilitaryEquipmentCombatStance,
  setMilitaryEquipmentDropped,
  setMilitaryEquipmentVisible,
  type MilitaryEquipmentCombatStance,
  type MilitaryEquipmentKind,
  type MilitaryEquipmentSource,
} from './militaryEquipment.ts';

export type WorkerToolKind =
  | 'hatchet'
  | 'pickaxe'
  | 'hammer'
  | 'hoe'
  | 'shovel'
  | MilitaryEquipmentKind;

export { isMilitaryEquipmentKind };

export const WORKER_TOOL_URLS: Record<WorkerToolKind, string> = {
  hatchet: '/assets/models/worker-tools/kenney-tool-hatchet.glb',
  pickaxe: '/assets/models/worker-tools/kenney-tool-pickaxe.glb',
  hammer: '/assets/models/worker-tools/kenney-tool-hammer.glb',
  hoe: '/assets/models/worker-tools/kenney-tool-hoe.glb',
  shovel: '/assets/models/worker-tools/kenney-tool-shovel.glb',
  // Military equipment is generated at historically dimensioned metre scale.
  spear: '',
  'spear-shield': '',
  'pike-kit': '',
  crossbow: '',
  sidearm: '',
  'sidearm-shield': '',
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
  'spear-shield': { targetLength: 2.12, gripFractionFromHandleEnd: 0.28 },
  'pike-kit': { targetLength: 4.7, gripFractionFromHandleEnd: 0.28 },
  crossbow: {
    targetLength: 0.82,
    gripFractionFromHandleEnd: 0.5,
  },
  sidearm: { targetLength: 0.86, gripFractionFromHandleEnd: 0.13 },
  'sidearm-shield': { targetLength: 0.88, gripFractionFromHandleEnd: 0.13 },
  'sword-shield': { targetLength: 1.05, gripFractionFromHandleEnd: 0.35 },
  halberd: { targetLength: 2.18, gripFractionFromHandleEnd: 0.30 },
  bow: { targetLength: 1.35, gripFractionFromHandleEnd: 0.50 },
};

export type WorkerHandToolSource = {
  kind: WorkerToolKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  sourceLength: number;
};

export type WorkerToolSource = WorkerHandToolSource | MilitaryEquipmentSource;

export type WorkerToolSources = Record<WorkerToolKind, WorkerToolSource>;

export async function loadWorkerToolSources(): Promise<WorkerToolSources> {
  const loader = new GLTFLoader();
  const [hatchet, pickaxe, hammer, hoe, shovel] = await Promise.all([
    loader.loadAsync(WORKER_TOOL_URLS.hatchet),
    loader.loadAsync(WORKER_TOOL_URLS.pickaxe),
    loader.loadAsync(WORKER_TOOL_URLS.hammer),
    loader.loadAsync(WORKER_TOOL_URLS.hoe),
    loader.loadAsync(WORKER_TOOL_URLS.shovel),
  ]);
  const military = createMilitaryEquipmentSources();
  return {
    hatchet: createWorkerToolSource('hatchet', hatchet.scene),
    pickaxe: createWorkerToolSource('pickaxe', pickaxe.scene),
    hammer: createWorkerToolSource('hammer', hammer.scene),
    hoe: createWorkerToolSource('hoe', hoe.scene),
    shovel: createWorkerToolSource('shovel', shovel.scene),
    ...military,
  };
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
  if (isMilitaryEquipmentSource(source)) {
    return attachMilitaryEquipment(model, source);
  }
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

export function setWorkerToolVisible(tool: THREE.Group, visible: boolean): void {
  if (tool.userData.workerToolMounts) {
    setMilitaryEquipmentVisible(tool, visible);
    return;
  }
  tool.visible = visible;
}

export function setWorkerToolCombatStance(
  tool: THREE.Group,
  stance: MilitaryEquipmentCombatStance,
): void {
  if (!tool.userData.workerToolMounts) return;
  setMilitaryEquipmentCombatStance(tool, stance);
}

/** Only bone-mounted military equipment can become a battlefield drop. */
export function setWorkerToolDropped(
  tool: THREE.Group,
  dropped: boolean,
): void {
  if (!tool.userData.workerToolMounts) return;
  setMilitaryEquipmentDropped(tool, dropped);
}

export function disposeWorkerToolSources(sources: WorkerToolSources): void {
  for (const source of Object.values(sources)) {
    if (isMilitaryEquipmentSource(source)) disposeMilitaryEquipmentSource(source);
    else disposeModelResources(source.scene);
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
