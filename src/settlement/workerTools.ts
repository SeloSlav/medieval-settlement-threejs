import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type WorkerToolKind = 'hatchet' | 'pickaxe' | 'hammer' | 'hoe' | 'shovel';

export const WORKER_TOOL_URLS: Record<WorkerToolKind, string> = {
  hatchet: '/assets/models/worker-tools/kenney-tool-hatchet.glb',
  pickaxe: '/assets/models/worker-tools/kenney-tool-pickaxe.glb',
  hammer: '/assets/models/worker-tools/kenney-tool-hammer.glb',
  hoe: '/assets/models/worker-tools/kenney-tool-hoe.glb',
  shovel: '/assets/models/worker-tools/kenney-tool-shovel.glb',
};

const TARGET_TOOL_LENGTH: Record<WorkerToolKind, number> = {
  hatchet: 0.58,
  pickaxe: 0.68,
  hammer: 0.6,
  hoe: 0.82,
  shovel: 0.88,
};

const GRIP_FRACTION_FROM_HANDLE_END: Record<WorkerToolKind, number> = {
  hatchet: 0.34,
  pickaxe: 0.38,
  hammer: 0.34,
  hoe: 0.3,
  shovel: 0.28,
};

export type WorkerToolSource = {
  kind: WorkerToolKind;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceLength: number;
};

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
  return {
    hatchet: createWorkerToolSource('hatchet', hatchet.scene),
    pickaxe: createWorkerToolSource('pickaxe', pickaxe.scene),
    hammer: createWorkerToolSource('hammer', hammer.scene),
    hoe: createWorkerToolSource('hoe', hoe.scene),
    shovel: createWorkerToolSource('shovel', shovel.scene),
  };
}

export function createWorkerToolSource(
  kind: WorkerToolKind,
  scene: THREE.Group,
): WorkerToolSource {
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const sourceLength = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(sourceLength) || sourceLength <= 0.001) {
    throw new Error(`Invalid ${kind} model bounds.`);
  }
  return { kind, scene, bounds, sourceLength };
}

/**
 * Parents a lightweight CC0 tool directly to the authored right-palm joint.
 * Kenney's tools and the Quaternius rig use different source scales, so the
 * local scale is derived after reading the palm's accumulated rig scale.
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
  const localScale =
    TARGET_TOOL_LENGTH[source.kind] / (source.sourceLength * inheritedScale);

  const tool = source.scene.clone(true);
  tool.name = `Worker ${source.kind}`;
  tool.userData.workerTool = source.kind;
  tool.scale.setScalar(localScale);
  tool.position.set(
    0,
    -source.sourceLength
      * localScale
      * GRIP_FRACTION_FROM_HANDLE_END[source.kind],
    0,
  );
  tool.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
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
