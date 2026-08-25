import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type StaticBuildingBatchStats = {
  readonly sourceDraws: number;
  readonly batchedDraws: number;
  readonly retainedDraws: number;
};

export type StaticOpaqueMeshBatchOptions = {
  readonly groupName: string;
  readonly rootStatsKey: string;
  readonly groupFlag: string;
  readonly meshFlag: string;
  readonly isDynamicBoundary: (object: THREE.Object3D) => boolean;
  readonly includeSingletons?: boolean;
};

type BatchEntry = {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly material: THREE.Material;
};

const DYNAMIC_BUILDING_NAMES = new Set([
  'FoundingShelters',
  'FoundingCampfire',
  'Watermill wheel',
  'Windmill sails',
  'CharcoalClampSmoke',
  'ClayBankStrata',
  'MarketFoodStall0',
  'MarketFoodStall1',
  'MarketFoodStall2',
  'MarketGoodsStall0',
  'MarketGoodsStall1',
  'MarketGoodsStall2',
]);

const DYNAMIC_BUILDING_NAME_PARTS = [
  'Stockpile',
  'Stock',
  'Staging',
  'Chest',
  'Coffer',
  'Segment',
  'Stratum',
  'Winter accumulation',
] as const;

/**
 * Identifies authored nodes whose transform, visibility, or collision role can
 * change after a completed building is registered. These objects and their
 * descendants must remain separate from immutable structural geometry.
 */
export function isDynamicBuildingBatchBoundary(object: THREE.Object3D): boolean {
  if (
    object.userData.fpNoCollision === true
    || object.userData.fpCollisionAggregate === true
    || object.userData.fpCollisionChildrenOnly === true
    || object.userData.foundersCampWinterAccumulation === true
    || object.userData.campSmoke === true
    || object.userData.buildingDetailCasterBatch === true
  ) {
    return true;
  }
  if (DYNAMIC_BUILDING_NAMES.has(object.name)) return true;
  return DYNAMIC_BUILDING_NAME_PARTS.some((part) => object.name.includes(part));
}

/**
 * Merges only immutable structural leaves within one completed building. The
 * building root remains the authoritative transform/collision object, and all
 * runtime-controlled authored subtrees remain attached and name-addressable.
 */
export function batchCompletedBuildingStaticMeshes(
  sourceRoot: THREE.Group,
): StaticBuildingBatchStats {
  return batchStaticOpaqueMeshes(sourceRoot, {
    groupName: 'Completed building static batches',
    rootStatsKey: 'staticBuildingBatchStats',
    groupFlag: 'completedBuildingStaticBatches',
    meshFlag: 'completedBuildingStaticBatch',
    isDynamicBoundary: isDynamicBuildingBatchBoundary,
    includeSingletons: true,
  });
}

/** Shared conservative merge core used by completed buildings and homes. */
export function batchStaticOpaqueMeshes(
  sourceRoot: THREE.Group,
  options: StaticOpaqueMeshBatchOptions,
): StaticBuildingBatchStats {
  sourceRoot.updateWorldMatrix(true, true);
  const rootWorldInverse = sourceRoot.matrixWorld.clone().invert();
  const entriesByKey = new Map<string, BatchEntry[]>();
  let retainedDraws = 0;

  const visit = (
    object: THREE.Object3D,
    excludedByAncestor: boolean,
  ): void => {
    const excluded = excludedByAncestor
      || !object.visible
      || options.isDynamicBoundary(object);
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    if (mesh.isMesh) {
      if (excluded || !isStaticBatchCandidate(mesh)) {
        if (mesh.visible && mesh.material.visible) retainedDraws += 1;
      } else {
        const key = batchKey(mesh);
        const entries = entriesByKey.get(key) ?? [];
        entries.push({ mesh, material: mesh.material });
        entriesByKey.set(key, entries);
      }
    }
    for (const child of object.children) visit(child, excluded);
  };
  for (const child of sourceRoot.children) visit(child, false);

  const batchGroup = new THREE.Group();
  batchGroup.name = options.groupName;
  batchGroup.userData[options.groupFlag] = true;
  const detachedGeometries = new Set<THREE.BufferGeometry>();
  let sourceDraws = 0;
  let batchedDraws = 0;
  let batchIndex = 0;

  for (const entries of entriesByKey.values()) {
    if (entries.length < 2 && options.includeSingletons !== true) {
      retainedDraws += entries.length;
      continue;
    }
    const transformed = entries.map(({ mesh }) => {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(rootWorldInverse, mesh.matrixWorld),
      );
      return geometry;
    });
    const merged = mergeGeometries(transformed, false);
    for (const geometry of transformed) geometry.dispose();
    if (!merged) {
      retainedDraws += entries.length;
      continue;
    }

    const first = entries[0]!.mesh;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const batch = new THREE.Mesh(merged, entries[0]!.material);
    batch.name = `Completed building static batch ${batchIndex + 1}`;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.frustumCulled = first.frustumCulled;
    batch.layers.mask = first.layers.mask;
    batch.customDepthMaterial = first.customDepthMaterial;
    batch.customDistanceMaterial = first.customDistanceMaterial;
    batch.userData[options.meshFlag] = true;
    batch.userData.sourceMeshCount = entries.length;
    batchGroup.add(batch);
    for (const { mesh } of entries) {
      detachedGeometries.add(mesh.geometry);
      mesh.removeFromParent();
    }
    sourceDraws += entries.length;
    batchedDraws += 1;
    batchIndex += 1;
  }

  if (batchGroup.children.length > 0) sourceRoot.add(batchGroup);
  disposeUnreferencedDetachedGeometries(sourceRoot, detachedGeometries);
  sourceRoot.userData[options.rootStatsKey] = {
    sourceDraws,
    batchedDraws,
    retainedDraws,
  } satisfies StaticBuildingBatchStats;
  return sourceRoot.userData[options.rootStatsKey] as StaticBuildingBatchStats;
}

function isStaticBatchCandidate(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
): boolean {
  const geometry = mesh.geometry;
  const material = mesh.material;
  return !(mesh as THREE.InstancedMesh).isInstancedMesh
    && !(mesh as THREE.SkinnedMesh).isSkinnedMesh
    && mesh.children.length === 0
    && material.visible
    && !material.transparent
    && material.opacity === 1
    && geometry.getAttribute('position') !== undefined
    && Object.keys(geometry.morphAttributes).length === 0
    && Object.values(geometry.attributes).every(
      (attribute) => !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute,
    )
    && geometry.drawRange.start === 0
    && geometry.drawRange.count === Infinity;
}

function batchKey(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>): string {
  return [
    mesh.material.uuid,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.renderOrder,
    mesh.frustumCulled ? 1 : 0,
    mesh.layers.mask,
    mesh.customDepthMaterial?.uuid ?? '',
    mesh.customDistanceMaterial?.uuid ?? '',
    geometryIndexSignature(mesh.geometry),
    geometryAttributeSignature(mesh.geometry),
  ].join('|');
}

function geometryIndexSignature(geometry: THREE.BufferGeometry): string {
  const index = geometry.index;
  return index
    ? `indexed:${index.array.constructor.name}:${index.normalized ? 1 : 0}`
    : 'non-indexed';
}

function geometryAttributeSignature(geometry: THREE.BufferGeometry): string {
  return Object.entries(geometry.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => [
      name,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array.constructor.name,
    ].join(':'))
    .join(',');
}

function disposeUnreferencedDetachedGeometries(
  sourceRoot: THREE.Object3D,
  detachedGeometries: ReadonlySet<THREE.BufferGeometry>,
): void {
  if (detachedGeometries.size === 0) return;
  let graphRoot = sourceRoot;
  while (graphRoot.parent) graphRoot = graphRoot.parent;
  const retainedGeometries = new Set<THREE.BufferGeometry>();
  graphRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) retainedGeometries.add(mesh.geometry);
  });
  for (const geometry of detachedGeometries) {
    if (!retainedGeometries.has(geometry)) geometry.dispose();
  }
}
