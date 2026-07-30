import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type StaticFixtureBatchStats = {
  sourceMeshes: number;
  batches: number;
  sourceTriangles: number;
  batchedTriangles: number;
};

export type FixtureStructuralSubmissionStats = {
  draws: number;
  triangles: number;
};

type BatchEntry = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
};

/**
 * Collapses immutable, single-material fixture meshes into material-compatible
 * batches. Authored metadata groups remain available, while submitted source
 * meshes are replaced by geometry-equivalent batches under the same root.
 */
export function batchStaticFixtureMeshes(
  sourceRoot: THREE.Object3D,
  name: string,
): { group: THREE.Group; stats: StaticFixtureBatchStats } {
  sourceRoot.updateWorldMatrix(true, true);
  const rootWorldInverse = sourceRoot.matrixWorld.clone().invert();
  const entriesByKey = new Map<string, BatchEntry[]>();
  const submittedSources: THREE.Mesh[] = [];
  let sourceTriangles = 0;

  sourceRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      !mesh.isMesh
      || (mesh as THREE.InstancedMesh).isInstancedMesh
      || (mesh as THREE.SkinnedMesh).isSkinnedMesh
      || !mesh.visible
      || Array.isArray(mesh.material)
      || !mesh.geometry.getAttribute('position')
      || Object.keys(mesh.geometry.morphAttributes).length > 0
    ) {
      return;
    }

    const copied = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    copied.applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(rootWorldInverse, mesh.matrixWorld),
    );
    sourceTriangles += copied.getAttribute('position').count / 3;
    const key = [
      mesh.material.uuid,
      mesh.castShadow ? 1 : 0,
      mesh.receiveShadow ? 1 : 0,
      mesh.renderOrder,
      geometryAttributeSignature(copied),
    ].join('|');
    const entries = entriesByKey.get(key) ?? [];
    entries.push({
      geometry: copied,
      material: mesh.material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      renderOrder: mesh.renderOrder,
    });
    entriesByKey.set(key, entries);
    submittedSources.push(mesh);
  });

  const group = new THREE.Group();
  group.name = name;
  let batchedTriangles = 0;
  let batchIndex = 0;
  for (const entries of entriesByKey.values()) {
    const merged = mergeGeometries(entries.map((entry) => entry.geometry), false);
    for (const entry of entries) entry.geometry.dispose();
    if (!merged) {
      throw new Error(`Unable to merge fixture batch ${name} #${batchIndex}.`);
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const first = entries[0]!;
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${name} ${batchIndex + 1}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData.staticFixtureBatch = true;
    mesh.userData.sourceMeshCount = entries.length;
    group.add(mesh);
    batchedTriangles += merged.getAttribute('position').count / 3;
    batchIndex += 1;
  }

  for (const mesh of submittedSources) mesh.removeFromParent();
  sourceRoot.add(group);
  return {
    group,
    stats: {
      sourceMeshes: submittedSources.length,
      batches: group.children.length,
      sourceTriangles: Math.round(sourceTriangles),
      batchedTriangles: Math.round(batchedTriangles),
    },
  };
}

/**
 * Counts visible triangle submissions in the authored scene graph. Unlike
 * renderer.info on WebGPU, this counter is frame-local rather than cumulative.
 */
export function countFixtureStructuralSubmissions(
  root: THREE.Object3D,
): FixtureStructuralSubmissionStats {
  let draws = 0;
  let triangles = 0;
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    if (instanceCount <= 0) return;
    const geometry = mesh.geometry;
    const availableElementCount = geometry.index?.count
      ?? geometry.getAttribute('position')?.count
      ?? 0;
    if (availableElementCount <= 0) return;
    const drawStart = Math.max(0, geometry.drawRange.start);
    const drawEnd = Math.min(
      availableElementCount,
      Number.isFinite(geometry.drawRange.count)
        ? drawStart + geometry.drawRange.count
        : availableElementCount,
    );
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (Array.isArray(mesh.material) && geometry.groups.length > 0) {
      for (const group of geometry.groups) {
        const material = materials[group.materialIndex ?? 0];
        if (!material?.visible) continue;
        const start = Math.max(drawStart, group.start);
        const end = Math.min(drawEnd, group.start + group.count);
        if (end <= start) continue;
        draws += 1;
        triangles += (end - start) / 3 * instanceCount;
      }
      return;
    }
    if (!materials[0]?.visible || drawEnd <= drawStart) return;
    draws += 1;
    triangles += (drawEnd - drawStart) / 3 * instanceCount;
  });
  return { draws, triangles: Math.round(triangles) };
}

function geometryAttributeSignature(geometry: THREE.BufferGeometry): string {
  return Object.entries(geometry.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([attributeName, attribute]) => [
      attributeName,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array.constructor.name,
    ].join(':'))
    .join(',');
}
