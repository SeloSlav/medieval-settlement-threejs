import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type WorkerToolKind = 'hatchet' | 'pickaxe' | 'hammer' | 'hoe' | 'shovel' | 'spear';

export const WORKER_TOOL_URLS: Record<WorkerToolKind, string> = {
  hatchet: '/assets/models/worker-tools/kenney-tool-hatchet.glb',
  pickaxe: '/assets/models/worker-tools/kenney-tool-pickaxe.glb',
  hammer: '/assets/models/worker-tools/kenney-tool-hammer.glb',
  hoe: '/assets/models/worker-tools/kenney-tool-hoe.glb',
  shovel: '/assets/models/worker-tools/kenney-tool-shovel.glb',
  spear: '/assets/models/worker-tools/quaternius-spear.glb',
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
 * Parents a lightweight CC0 tool directly to the authored right-palm joint.
 * Kenney's tools and the Quaternius rig use different source scales. The
 * local fit is derived after reading the palm's accumulated rig scale, with
 * independent axes for the deliberately exaggerated Kenney models.
 */
export function attachWorkerTool(
  model: THREE.Group,
  source: WorkerToolSource,
): THREE.Group {
  const palm = model.getObjectByName('PalmR');
  if (!(palm instanceof THREE.Bone)) {
    throw new Error('Worker rig is missing its PalmR hand joint.');
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
