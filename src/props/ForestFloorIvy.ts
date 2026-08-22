import * as THREE from 'three';
import { normalView, positionLocal } from 'three/tsl';
import { applyGroundCoverShadowPolicy } from '@seedthree/core/ground-cover-shadows.js';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import { mulberry32 } from '../utils/random.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';
import {
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverPositionNode,
  type SeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';

export const FOREST_FLOOR_IVY_TEXTURE_PATH =
  '/assets/textures/vegetation/forest-floor-ivy-card.png';
export const FOREST_FLOOR_IVY_SEED = 0x1f1c0a7;
export const FOREST_FLOOR_IVY_MIN_BLEND = 0.24;

/** Matches the authored texture's visible alpha bounds inside its 1254px source. */
export const FOREST_FLOOR_IVY_UV_BOUNDS = {
  minU: 22 / 1254,
  maxU: 1210 / 1254,
  minV: 1 - 957 / 1254,
  maxV: 1 - 263 / 1254,
} as const;

/** One patch spans approximately one terrain vertex per cell on the small map. */
export const FOREST_FLOOR_IVY_SEGMENTS_X = 8;
export const FOREST_FLOOR_IVY_SEGMENTS_Z = 6;
export const FOREST_FLOOR_IVY_VERTICES_PER_PATCH =
  (FOREST_FLOOR_IVY_SEGMENTS_X + 1) * (FOREST_FLOOR_IVY_SEGMENTS_Z + 1);
export const FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH =
  FOREST_FLOOR_IVY_SEGMENTS_X * FOREST_FLOOR_IVY_SEGMENTS_Z * 2;

/** The perimeter almost touches the litter; only a small depth-safe lift remains. */
export const FOREST_FLOOR_IVY_GROUND_CLEARANCE = 0.014;
export const FOREST_FLOOR_IVY_RELIEF_MIN = 0.12;
export const FOREST_FLOOR_IVY_RELIEF_MAX = 0.22;
const FOREST_FLOOR_IVY_HIDDEN_Y = -10_000;

type IvyTerrainSurface = Pick<Terrain, 'getHeightAt'>;

export type ForestFloorIvyPlacement = {
  x: number;
  z: number;
  sourceTreeIndex: number;
  scale: number;
  yaw: number;
  radiusX: number;
  radiusZ: number;
  reliefHeight: number;
  reliefPhase: number;
};

export type ForestFloorIvyVertexRange = {
  start: number;
  count: number;
};

export type ForestFloorIvyStats = {
  instances: number;
  verticesPerInstance: number;
  trianglesPerInstance: number;
  vertices: number;
  triangles: number;
  drawCalls: number;
  maximumRelief: number;
  seed: number;
};

export type CompiledForestFloorIvyGeometry = {
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  placementVertexRangesByTree: ForestFloorIvyVertexRange[][];
};

export type ForestFloorIvyInstances = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  placements: ForestFloorIvyPlacement[];
  placementVertexRangesByTree: ForestFloorIvyVertexRange[][];
  textures: SeedThreeGroundCoverTextures;
  stats: ForestFloorIvyStats;
  setTreeActive: (treeIndex: number, active: boolean) => boolean;
  commit: () => void;
  dispose: () => void;
};

/**
 * Manor-Lords-style ivy is a shallow leaf canopy resting on litter, not a
 * crossed billboard clump. Every patch is compiled into a world-space grid:
 * each vertex samples the rendered terrain, then receives only a few
 * centimetres of deterministic multi-lobe relief. The alpha perimeter thus
 * meets the terrain while the interior carries real grazing-light curvature.
 */
export async function createForestFloorIvyInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<ForestFloorIvyInstances> {
  const textures = await loadSeedThreeGroundCoverTextures({
    albedo: FOREST_FLOOR_IVY_TEXTURE_PATH,
  }, maxAnisotropy);
  const placements = createForestFloorIvyPlacements(
    trees,
    terrain,
    seed,
    isBlockedAt,
  );
  const compiled = createTerrainConformingIvyGeometry(
    placements,
    terrain,
    trees.length,
    seed,
  );
  const material = createSeedThreeGroundCoverMaterial(
    'SeedThree terrain-conforming woodland ivy',
    textures,
    rendererBackend ?? 'webgl',
    [0.07, 0.13, 0.04],
    0,
    positionLocal as SeedThreeGroundCoverPositionNode,
  );
  material.alphaTest = 0.31;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  if (rendererBackend === 'webgpu') {
    // SeedThree card materials normally force an upward normal. This carrier
    // is a real draped surface, so retain its computed relief/terrain normals.
    (material as THREE.Material & { normalNode: typeof normalView }).normalNode = normalView;
  }

  const mesh = new THREE.Mesh(compiled.geometry, material);
  mesh.name = 'SeedThree tessellated terrain-conforming forest-floor ivy';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  applyGroundCoverShadowPolicy(mesh, { terrainReceivesShadow: true });

  const group = new THREE.Group();
  group.name = 'Live-tree terrain-conforming forest-floor ivy';
  group.add(mesh);

  const position = compiled.geometry.getAttribute('position') as THREE.BufferAttribute;
  const livePositions = position.array as Float32Array;
  const treeActive = trees.map(() => true);
  const dirtyTrees = new Set<number>();

  return {
    group,
    mesh,
    placements,
    placementVertexRangesByTree: compiled.placementVertexRangesByTree,
    textures,
    stats: {
      instances: placements.length,
      verticesPerInstance: FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
      trianglesPerInstance: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
      vertices: FOREST_FLOOR_IVY_VERTICES_PER_PATCH * placements.length,
      triangles: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH * placements.length,
      drawCalls: placements.length > 0 ? 1 : 0,
      maximumRelief: placements.reduce(
        (maximum, placement) => Math.max(maximum, placement.reliefHeight),
        0,
      ),
      seed,
    },
    setTreeActive(treeIndex: number, active: boolean): boolean {
      if (treeActive[treeIndex] === active) return false;
      treeActive[treeIndex] = active;
      for (const range of compiled.placementVertexRangesByTree[treeIndex] ?? []) {
        const start = range.start * 3;
        const end = (range.start + range.count) * 3;
        if (active) {
          livePositions.set(compiled.originalPositions.subarray(start, end), start);
        } else {
          for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
            livePositions[vertex * 3 + 1] = FOREST_FLOOR_IVY_HIDDEN_Y;
          }
        }
      }
      dirtyTrees.add(treeIndex);
      return true;
    },
    commit(): void {
      if (dirtyTrees.size === 0) return;
      position.clearUpdateRanges();
      for (const treeIndex of dirtyTrees) {
        for (const range of compiled.placementVertexRangesByTree[treeIndex] ?? []) {
          position.addUpdateRange(range.start * 3, range.count * 3);
        }
      }
      position.needsUpdate = true;
      dirtyTrees.clear();
    },
    dispose(): void {
      compiled.geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
      group.removeFromParent();
    },
  };
}

export function createTerrainConformingIvyGeometry(
  placements: readonly ForestFloorIvyPlacement[],
  terrain: IvyTerrainSurface,
  treeCount: number,
  seed = FOREST_FLOOR_IVY_SEED,
): CompiledForestFloorIvyGeometry {
  const vertexCount = placements.length * FOREST_FLOOR_IVY_VERTICES_PER_PATCH;
  const indexCount = placements.length * FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH * 3;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const tintValues = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const placementVertexRangesByTree = Array.from(
    { length: treeCount },
    () => [] as ForestFloorIvyVertexRange[],
  );
  const color = new THREE.Color();
  const tintWhite = new THREE.Color(0xffffff);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
    const placement = placements[placementIndex]!;
    const cos = Math.cos(placement.yaw);
    const sin = Math.sin(placement.yaw);
    const tintRng = mulberry32(
      (seed ^ Math.imul(placementIndex + 1, 0x9e3779b1)) >>> 0,
    );
    color.setHSL(
      0.285 + (tintRng() - 0.5) * 0.022,
      0.34 + tintRng() * 0.08,
      0.31 + (tintRng() - 0.5) * 0.045,
    ).lerp(tintWhite, 0.18);

    const range = {
      start: vertexOffset,
      count: FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
    };
    placementVertexRangesByTree[placement.sourceTreeIndex]?.push(range);

    for (let zIndex = 0; zIndex <= FOREST_FLOOR_IVY_SEGMENTS_Z; zIndex++) {
      const tz = zIndex / FOREST_FLOOR_IVY_SEGMENTS_Z;
      const normalizedZ = tz * 2 - 1;
      for (let xIndex = 0; xIndex <= FOREST_FLOOR_IVY_SEGMENTS_X; xIndex++) {
        const tx = xIndex / FOREST_FLOOR_IVY_SEGMENTS_X;
        const normalizedX = tx * 2 - 1;
        const localX = normalizedX * placement.radiusX;
        const localZ = normalizedZ * placement.radiusZ;
        const worldX = placement.x + localX * cos - localZ * sin;
        const worldZ = placement.z + localX * sin + localZ * cos;
        const worldY = terrain.getHeightAt(worldX, worldZ)
          + FOREST_FLOOR_IVY_GROUND_CLEARANCE
          + ivyReliefAt(normalizedX, normalizedZ, placement);
        const vertexIndex = vertexOffset
          + zIndex * (FOREST_FLOOR_IVY_SEGMENTS_X + 1)
          + xIndex;
        const positionOffset = vertexIndex * 3;
        positions[positionOffset] = worldX;
        positions[positionOffset + 1] = worldY;
        positions[positionOffset + 2] = worldZ;
        const uvOffset = vertexIndex * 2;
        uvs[uvOffset] = THREE.MathUtils.lerp(
          FOREST_FLOOR_IVY_UV_BOUNDS.minU,
          FOREST_FLOOR_IVY_UV_BOUNDS.maxU,
          tx,
        );
        uvs[uvOffset + 1] = THREE.MathUtils.lerp(
          FOREST_FLOOR_IVY_UV_BOUNDS.minV,
          FOREST_FLOOR_IVY_UV_BOUNDS.maxV,
          tz,
        );
        tintValues[positionOffset] = color.r;
        tintValues[positionOffset + 1] = color.g;
        tintValues[positionOffset + 2] = color.b;
      }
    }

    const rowSize = FOREST_FLOOR_IVY_SEGMENTS_X + 1;
    for (let zIndex = 0; zIndex < FOREST_FLOOR_IVY_SEGMENTS_Z; zIndex++) {
      for (let xIndex = 0; xIndex < FOREST_FLOOR_IVY_SEGMENTS_X; xIndex++) {
        const a = vertexOffset + zIndex * rowSize + xIndex;
        const b = a + 1;
        const c = a + rowSize;
        const d = c + 1;
        indices[indexOffset++] = a;
        indices[indexOffset++] = c;
        indices[indexOffset++] = b;
        indices[indexOffset++] = b;
        indices[indexOffset++] = c;
        indices[indexOffset++] = d;
      }
    }
    vertexOffset += FOREST_FLOOR_IVY_VERTICES_PER_PATCH;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const tint = new THREE.BufferAttribute(tintValues, 3);
  // SeedThree's WebGPU material consumes aTint; the WebGL fallback consumes
  // Three's conventional color semantic. Both share one immutable buffer.
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('color', tint);
  if (vertexCount > 0) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return {
    geometry,
    originalPositions: positions.slice(),
    placementVertexRangesByTree,
  };
}

export function createForestFloorIvyPlacements(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: (x: number, z: number) => boolean,
): ForestFloorIvyPlacement[] {
  const placements: ForestFloorIvyPlacement[] = [];

  for (let treeIndex = 0; treeIndex < trees.length; treeIndex++) {
    const tree = trees[treeIndex]!;
    const rng = mulberry32((seed ^ Math.imul(treeIndex + 1, 0x85ebca6b)) >>> 0);
    const forestBlend = sampleForestBlend(terrain, tree.x, tree.z);
    if (forestBlend < FOREST_FLOOR_IVY_MIN_BLEND) continue;
    const primaryChance = THREE.MathUtils.lerp(0.38, 0.94, forestBlend);
    const patchCount = (rng() < primaryChance ? 1 : 0)
      + (forestBlend > 0.76 && rng() < 0.22 ? 1 : 0);

    for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
      const angle = rng() * Math.PI * 2;
      const canopyRadius = ivyCanopyRadius(tree);
      const radial = THREE.MathUtils.lerp(
        0.55,
        canopyRadius * 0.72 + 0.9,
        Math.sqrt(rng()),
      );
      const x = tree.x + Math.cos(angle) * radial;
      const z = tree.z + Math.sin(angle) * radial;
      if (isBlockedAt?.(x, z)) continue;
      const localForestBlend = sampleForestBlend(terrain, x, z);
      if (localForestBlend < FOREST_FLOOR_IVY_MIN_BLEND * 0.72) continue;

      const scale = THREE.MathUtils.lerp(0.92, 1.42, rng())
        * THREE.MathUtils.lerp(0.9, 1.14, localForestBlend);
      placements.push({
        x,
        z,
        sourceTreeIndex: treeIndex,
        scale,
        yaw: rng() * Math.PI * 2,
        // Preserve the trimmed image's broad 1.71:1 footprint while allowing
        // restrained colony variation. This is ground coverage, not a bush.
        radiusX: scale * THREE.MathUtils.lerp(2.25, 2.75, rng()),
        radiusZ: scale * THREE.MathUtils.lerp(1.34, 1.66, rng()),
        reliefHeight: THREE.MathUtils.lerp(
          FOREST_FLOOR_IVY_RELIEF_MIN,
          FOREST_FLOOR_IVY_RELIEF_MAX,
          rng(),
        ),
        reliefPhase: rng() * Math.PI * 2,
      });
    }
  }

  return placements;
}

function ivyReliefAt(
  x: number,
  z: number,
  placement: ForestFloorIvyPlacement,
): number {
  const radius = Math.sqrt(x * x + z * z);
  const contact = smootherstep01(THREE.MathUtils.clamp((1 - radius) / 0.72, 0, 1));
  if (contact <= 0) return 0;
  const center = gaussian2(x, z, -0.04, 0.12, 0.62, 0.52);
  const leftLobe = gaussian2(x, z, -0.43, -0.05, 0.36, 0.42);
  const rightLobe = gaussian2(x, z, 0.4, 0.02, 0.4, 0.38);
  const backLobe = gaussian2(x, z, 0.08, 0.48, 0.46, 0.3);
  const fold = 0.5 + 0.5 * Math.sin(
    x * 8.7 + z * 5.3 + placement.reliefPhase,
  );
  const profile = THREE.MathUtils.clamp(
    0.29
      + center * 0.38
      + leftLobe * 0.16
      + rightLobe * 0.14
      + backLobe * 0.12
      + fold * 0.045,
    0,
    1,
  );
  return placement.reliefHeight * contact * profile;
}

function gaussian2(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
): number {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  return Math.exp(-(dx * dx + dz * dz));
}

function smootherstep01(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function sampleForestBlend(terrain: Terrain, x: number, z: number): number {
  return THREE.MathUtils.clamp(
    sampleTerrainMeshAttributeX(
      terrain.mesh.geometry,
      'forestBlend',
      x,
      z,
      terrain.resolution,
      terrain.size,
    ),
    0,
    1,
  );
}

function ivyCanopyRadius(tree: ForestTreePlacement): number {
  if (tree.form === 'broad') return 4.1 * tree.scale;
  if (tree.form === 'young' || tree.form === 'midstory') return 2.3 * tree.scale;
  return 3.3 * tree.scale;
}
