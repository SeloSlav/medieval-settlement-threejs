import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type StaticGeometryPart = {
  source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
};

const CELL_SIZE_METERS = 192;

/** Exact opaque geometry, combined into native draws with local spatial bounds. */
export class SpatialMergedGeometry {
  readonly group = new THREE.Group();
  constructor(parent: THREE.Group) {
    this.group.name = 'Spatially merged static geometry';
    parent.add(this.group);
  }

  rebuild(parts: Iterable<StaticGeometryPart>): void {
    this.clear();
    const buckets = new Map<string, StaticGeometryPart[]>();
    for (const part of parts) {
      const { source, geometry, matrix } = part;
      const key = [Math.floor(matrix.elements[12]! / CELL_SIZE_METERS), Math.floor(matrix.elements[14]! / CELL_SIZE_METERS),
        source.material.uuid, source.castShadow, source.receiveShadow, source.layers.mask,
        source.renderOrder, source.customDepthMaterial?.uuid, source.customDistanceMaterial?.uuid,
        source.frustumCulled, !!geometry.index,
        ...Object.keys(geometry.attributes).sort().map(name => {
          const a = geometry.getAttribute(name);
          return `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${(a as THREE.BufferAttribute).gpuType}`;
        }),
      ].join('|');
      const bucket = buckets.get(key) ?? [];
      bucket.push(part); buckets.set(key, bucket);
    }
    for (const parts of buckets.values()) {
      const first = parts[0]!;
      // Store vertices close to their own cell origin to retain float precision.
      const origin = new THREE.Vector3(
        Math.floor(first.matrix.elements[12]! / CELL_SIZE_METERS) * CELL_SIZE_METERS, 0,
        Math.floor(first.matrix.elements[14]! / CELL_SIZE_METERS) * CELL_SIZE_METERS,
      );
      const inverse = new THREE.Matrix4().makeTranslation(-origin.x, 0, -origin.z);
      const copies = parts.map(part => part.geometry.clone().applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, part.matrix),
      ));
      const geometry = copies.length === 1 ? copies[0]! : mergeGeometries(copies, false);
      if (copies.length > 1) for (const copy of copies) copy.dispose();
      if (!geometry) throw new Error('Static spatial geometry attributes must be compatible');
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, first.source.material);
      mesh.name = 'Exact static geometry cell';
      mesh.position.copy(origin); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
      mesh.castShadow = first.source.castShadow;
      mesh.receiveShadow = first.source.receiveShadow;
      mesh.layers.mask = first.source.layers.mask;
      mesh.renderOrder = first.source.renderOrder;
      mesh.frustumCulled = first.source instanceof THREE.BatchedMesh
        ? first.source.perObjectFrustumCulled : first.source.frustumCulled;
      mesh.customDepthMaterial = first.source.customDepthMaterial;
      mesh.customDistanceMaterial = first.source.customDistanceMaterial;
      this.group.add(mesh);
    }
  }

  clear(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.group.clear();
  }

  dispose(): void { this.clear(); this.group.removeFromParent(); }
}

/** Extract a tightly packed owned geometry using BatchedMesh's public ranges. */
export function extractBatchedGeometry(mesh: THREE.BatchedMesh, id: number): THREE.BufferGeometry {
  const range = mesh.getGeometryRangeAt(id);
  if (!range) throw new Error('Missing packed static geometry');
  const geometry = new THREE.BufferGeometry();
  for (const [name, raw] of Object.entries(mesh.geometry.attributes)) {
    const attr = raw as THREE.BufferAttribute;
    const copy = new THREE.BufferAttribute(attr.array.slice(
      range.vertexStart * attr.itemSize, (range.vertexStart + range.vertexCount) * attr.itemSize,
    ), attr.itemSize, attr.normalized);
    copy.gpuType = attr.gpuType;
    geometry.setAttribute(name, copy);
  }
  if (mesh.geometry.index) {
    const indices = mesh.geometry.index.array.slice(range.indexStart, range.indexStart + range.indexCount);
    for (let i = 0; i < indices.length; i++) indices[i]! -= range.vertexStart;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  return geometry;
}
