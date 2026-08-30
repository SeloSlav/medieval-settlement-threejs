import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  batchStaticOpaqueMeshes,
  type StaticBuildingBatchStats,
} from '../buildings/staticBuildingBatch.ts';

const DYNAMIC_RESIDENCE_NAMES = new Set([
  'ChimneyEmitter',
  'FirewoodPile',
  'ResidenceUpgradeWorks',
  'InitialCottageCompletedStructure',
  'InitialCottageConstructionFrame',
  'Residence dynamic windows',
]);

export function batchResidenceStaticMeshes(
  sourceRoot: THREE.Group,
): StaticBuildingBatchStats {
  const windowMaterial = sourceRoot.userData.windowMaterial as THREE.Material | undefined;
  if (windowMaterial) batchResidenceWindows(sourceRoot, windowMaterial);
  return batchStaticOpaqueMeshes(sourceRoot, {
    groupName: 'Residence static batches',
    rootStatsKey: 'staticResidenceBatchStats',
    groupFlag: 'residenceStaticBatches',
    meshFlag: 'residenceStaticBatch',
    includeSingletons: true,
    isDynamicBoundary: (object) => isDynamicResidenceBatchBoundary(
      object,
      windowMaterial,
    ),
  });
}

function batchResidenceWindows(
  sourceRoot: THREE.Group,
  windowMaterial: THREE.Material,
): void {
  sourceRoot.updateWorldMatrix(true, true);
  const rootWorldInverse = sourceRoot.matrixWorld.clone().invert();
  const byKey = new Map<string, THREE.Mesh[]>();
  sourceRoot.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (
      !mesh.isMesh
      || mesh.material !== windowMaterial
      || (mesh as THREE.InstancedMesh).isInstancedMesh
      || (mesh as THREE.SkinnedMesh).isSkinnedMesh
      || mesh.children.length > 0
    ) {
      return;
    }
    const key = [
      mesh.geometry.index?.array.constructor.name ?? 'non-indexed',
      mesh.castShadow ? 1 : 0,
      mesh.receiveShadow ? 1 : 0,
      mesh.renderOrder,
      mesh.frustumCulled ? 1 : 0,
      mesh.layers.mask,
      mesh.customDepthMaterial?.uuid ?? '',
      mesh.customDistanceMaterial?.uuid ?? '',
      geometryAttributes(mesh.geometry),
    ].join('|');
    const entries = byKey.get(key) ?? [];
    entries.push(mesh);
    byKey.set(key, entries);
  });

  const detached = new Set<THREE.BufferGeometry>();
  for (const meshes of byKey.values()) {
    if (meshes.length < 2) continue;
    const transformed = meshes.map((mesh) => {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(rootWorldInverse, mesh.matrixWorld),
      );
      return geometry;
    });
    const merged = mergeGeometries(transformed, false);
    for (const geometry of transformed) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const first = meshes[0]!;
    const windows = new THREE.Mesh(merged, windowMaterial);
    windows.name = 'Residence dynamic windows';
    windows.castShadow = first.castShadow;
    windows.receiveShadow = first.receiveShadow;
    windows.renderOrder = first.renderOrder;
    windows.frustumCulled = first.frustumCulled;
    windows.layers.mask = first.layers.mask;
    windows.customDepthMaterial = first.customDepthMaterial;
    windows.customDistanceMaterial = first.customDistanceMaterial;
    windows.userData.residenceDynamicWindows = true;
    windows.userData.sourceMeshCount = meshes.length;
    sourceRoot.add(windows);
    for (const mesh of meshes) {
      detached.add(mesh.geometry);
      mesh.removeFromParent();
    }
  }
  disposeDetachedResidenceGeometries(sourceRoot, detached);
}

function geometryAttributes(geometry: THREE.BufferGeometry): string {
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

function disposeDetachedResidenceGeometries(
  sourceRoot: THREE.Object3D,
  detached: ReadonlySet<THREE.BufferGeometry>,
): void {
  if (detached.size === 0) return;
  let graphRoot = sourceRoot;
  while (graphRoot.parent) graphRoot = graphRoot.parent;
  const retained = new Set<THREE.BufferGeometry>();
  graphRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) retained.add(mesh.geometry);
  });
  for (const geometry of detached) {
    if (!retained.has(geometry)) geometry.dispose();
  }
}

export function isDynamicResidenceBatchBoundary(
  object: THREE.Object3D,
  windowMaterial?: THREE.Material,
): boolean {
  return object.userData.fpNoCollision === true
    || object.userData.fpCollisionAggregate === true
    || object.userData.fpCollisionChildrenOnly === true
    || object.userData.revealAt !== undefined
    || DYNAMIC_RESIDENCE_NAMES.has(object.name)
    || object.name.startsWith('Upgrade')
    || (
      (object as THREE.Mesh).isMesh
      && meshUsesMaterial(object as THREE.Mesh, windowMaterial)
    );
}

function meshUsesMaterial(
  mesh: THREE.Mesh,
  material: THREE.Material | undefined,
): boolean {
  if (!material) return false;
  return Array.isArray(mesh.material)
    ? mesh.material.includes(material)
    : mesh.material === material;
}
