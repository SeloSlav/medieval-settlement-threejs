import * as THREE from 'three';
import type { QuarryLayout } from '../quarries/QuarryLayout.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { WorldDimensions } from '../world/worldGenerationSettings.ts';
import { forestDensityAt, type ForestCore } from '../props/forestField.ts';
import { sampleTerrainBlendWeights, sampleTerrainUv } from './TerrainBlendWeights.ts';
import { sampleBaseTerrainHeight } from './TerrainHeight.ts';
import { createHeightfieldNormals } from './terrainNormals.ts';

// The end-to-end smoke verifies renderer/material compatibility and placement,
// not production terrain tessellation. Keeping its software-rendered world
// lightweight makes that regression check deterministic on CI.
export const TERRAIN_RESOLUTION = import.meta.env?.VITE_E2E_TEST === '1' ? 257 : 769;
export const FOREST_FLOOR_BLEND_START = 0.34;
export const FOREST_FLOOR_BLEND_END = 0.68;

export type TerrainGeometryData = {
  resolution: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  forestBlends: Float32Array;
  shoreBlends: Float32Array;
  quarryPadBlends: Float32Array;
  indices: Uint32Array;
  boundingSphere: {
    center: [number, number, number];
    radius: number;
  };
};

export async function buildTerrainGeometryData(
  riverField: RiverField | undefined,
  quarryLayout: QuarryLayout | undefined,
  dimensions: WorldDimensions,
  onProgress?: (completedRows: number, totalRows: number) => void,
  yieldControl: () => Promise<void> = async () => undefined,
  forestCores: readonly ForestCore[] = [],
): Promise<TerrainGeometryData> {
  const resolution = TERRAIN_RESOLUTION;
  const size = dimensions.terrainSize;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const forestBlends = new Float32Array(vertexCount);
  const shoreBlends = new Float32Array(vertexCount);
  const quarryPadBlends = new Float32Array(vertexCount);
  const step = size / (resolution - 1);
  const half = size * 0.5;

  for (let zIndex = 0; zIndex < resolution; zIndex++) {
    const rowOffset = zIndex * resolution;
    for (let xIndex = 0; xIndex < resolution; xIndex++) {
      const vertexIndex = rowOffset + xIndex;
      const x = -half + xIndex * step;
      const z = -half + zIndex * step;
      const positionOffset = vertexIndex * 3;
      positions[positionOffset] = x;
      positions[positionOffset + 1] = sampleBaseTerrainHeight(x, z);
      positions[positionOffset + 2] = z;

      const uv = sampleTerrainUv(x, z);
      const uvOffset = vertexIndex * 2;
      uvs[uvOffset] = uv[0];
      uvs[uvOffset + 1] = uv[1];

      const weights = sampleTerrainBlendWeights(x, z);
      const colorOffset = vertexIndex * 3;
      colors[colorOffset] = weights[0];
      colors[colorOffset + 1] = weights[1];
      colors[colorOffset + 2] = weights[2];

      const forestDensity = forestDensityAt(
        x,
        z,
        forestCores,
        dimensions.generationSize * 0.5,
        dimensions.terrainSize * 0.5,
      );
      forestBlends[vertexIndex] = forestFloorBlendAtDensity(
        forestDensity,
        riverField?.isRenderedWetAt(x, z) ?? false,
      );

      shoreBlends[vertexIndex] = riverField?.sampleMudBlendAt(x, z) ?? 0;
      quarryPadBlends[vertexIndex] = quarryLayout?.getPadBlend(x, z) ?? 0;
    }

    onProgress?.(zIndex + 1, resolution);
    if ((zIndex + 1) % 40 === 0) await yieldControl();
  }

  const quadCount = (resolution - 1) * (resolution - 1);
  const indices = new Uint32Array(quadCount * 6);
  let indexOffset = 0;
  for (let zIndex = 0; zIndex < resolution - 1; zIndex++) {
    for (let xIndex = 0; xIndex < resolution - 1; xIndex++) {
      const a = zIndex * resolution + xIndex;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices[indexOffset++] = a;
      indices[indexOffset++] = c;
      indices[indexOffset++] = b;
      indices[indexOffset++] = b;
      indices[indexOffset++] = c;
      indices[indexOffset++] = d;
    }
  }

  await yieldControl();
  const normals = createHeightfieldNormals(positions, resolution);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere ?? new THREE.Sphere();
  geometry.dispose();

  return {
    resolution,
    positions,
    normals,
    uvs,
    colors,
    forestBlends,
    shoreBlends,
    quarryPadBlends,
    indices,
    boundingSphere: {
      center: [sphere.center.x, sphere.center.y, sphere.center.z],
      radius: sphere.radius,
    },
  };
}

export function createTerrainGeometry(data: TerrainGeometryData): THREE.BufferGeometry {
  const vertexCount = data.resolution * data.resolution;
  const roadWearBlends = new Float32Array(vertexCount);
  const dirtZoomGates = new Float32Array(vertexCount);
  const staticMaskValues = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index++) {
    const offset = index * 3;
    staticMaskValues[offset] = data.forestBlends[index];
    staticMaskValues[offset + 1] = data.shoreBlends[index];
    staticMaskValues[offset + 2] = data.quarryPadBlends[index];
  }
  // WebGPU guarantees only eight vertex-buffer slots. These three immutable
  // scalar masks used to consume one slot each; adding forestBlend pushed the
  // river-shore terrain pipeline to nine. Interleave the static masks so the
  // complete terrain geometry remains within the portable eight-slot limit.
  const staticMasks = new THREE.InterleavedBuffer(staticMaskValues, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('forestBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 0));
  geometry.setAttribute('shoreBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 1));
  geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(roadWearBlends, 1));
  geometry.setAttribute('quarryPadBlend', new THREE.InterleavedBufferAttribute(staticMasks, 1, 2));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(dirtZoomGates, 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(...data.boundingSphere.center),
    data.boundingSphere.radius,
  );
  return geometry;
}

export function forestFloorBlendAtDensity(
  density: number,
  blockedByRenderedWater = false,
): number {
  if (blockedByRenderedWater) return 0;
  const t = THREE.MathUtils.clamp(
    (density - FOREST_FLOOR_BLEND_START)
      / (FOREST_FLOOR_BLEND_END - FOREST_FLOOR_BLEND_START),
    0,
    1,
  );
  return t * t * (3 - 2 * t);
}
