import * as THREE from 'three';
import type { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import type { Terrain, TerrainBounds } from './Terrain.ts';
import { sampleHeightWithBuildingPads } from './TerrainHeight.ts';
import { updateHeightfieldNormalsInRegion } from './terrainNormals.ts';

let lastAppliedBounds: TerrainBounds[] = [];

export function updateTerrainBuildingPads(terrain: Terrain, layout: BuildingTerrainLayout | null): void {
  const geometry = terrain.mesh.geometry;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const currentBounds = layout?.getAffectedBounds() ?? [];
  const boundsToUpdate = changedBuildingPadBounds(lastAppliedBounds, currentBounds);

  if (boundsToUpdate.length === 0) {
    lastAppliedBounds = currentBounds;
    return;
  }

  const resolution = terrain.resolution;
  const size = terrain.size;
  const step = size / (resolution - 1);
  const half = size * 0.5;
  const changedIndexBounds: TerrainBounds[] = [];

  for (const bounds of boundsToUpdate) {
    const minXIndex = Math.max(0, Math.floor((bounds.minX + half) / step));
    const maxXIndex = Math.min(resolution - 1, Math.ceil((bounds.maxX + half) / step));
    const minZIndex = Math.max(0, Math.floor((bounds.minZ + half) / step));
    const maxZIndex = Math.min(resolution - 1, Math.ceil((bounds.maxZ + half) / step));

    changedIndexBounds.push({
      minX: minXIndex,
      maxX: maxXIndex,
      minZ: minZIndex,
      maxZ: maxZIndex,
    });

    for (let zIndex = minZIndex; zIndex <= maxZIndex; zIndex++) {
      const rowOffset = zIndex * resolution;
      for (let xIndex = minXIndex; xIndex <= maxXIndex; xIndex++) {
        const vertexIndex = rowOffset + xIndex;
        const positionOffset = vertexIndex * 3;
        const x = positions.array[positionOffset] as number;
        const z = positions.array[positionOffset + 2] as number;
        positions.array[positionOffset + 1] = sampleHeightWithBuildingPads(x, z, layout);
      }
    }
  }

  positions.needsUpdate = true;

  if (normals) {
    for (const bounds of changedIndexBounds) {
      updateHeightfieldNormalsInRegion(
        positions.array as Float32Array,
        normals.array as Float32Array,
        resolution,
        bounds.minX,
        bounds.maxX,
        bounds.minZ,
        bounds.maxZ,
      );
    }
    normals.needsUpdate = true;
  }

  geometry.computeBoundingSphere();
  lastAppliedBounds = currentBounds;
}

export function resetTerrainBuildingPadHistory(): void {
  lastAppliedBounds = [];
}

/**
 * Only the symmetric difference needs resampling. Unchanged pads already have
 * their final vertex heights; during preview movement this limits work to the
 * old and new preview footprints instead of rebuilding the whole settlement.
 */
export function changedBuildingPadBounds(
  previous: TerrainBounds[],
  current: TerrainBounds[],
): TerrainBounds[] {
  const changed = previous.filter(
    (bounds) => !current.some((entry) => boundsEqual(entry, bounds)),
  );
  for (const bounds of current) {
    if (
      previous.some((entry) => boundsEqual(entry, bounds))
      || changed.some((entry) => boundsEqual(entry, bounds))
    ) {
      continue;
    }
    changed.push(bounds);
  }
  return changed;
}

function boundsEqual(a: TerrainBounds, b: TerrainBounds): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}
