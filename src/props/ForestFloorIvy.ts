import * as THREE from 'three';
import { applyGroundCoverShadowPolicy } from '@seedthree/core/ground-cover-shadows.js';
import {
  supportsNodeMaterials,
  type RendererBackendKind,
} from '../scene/RendererBackend.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import { mulberry32 } from '../utils/random.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';
import {
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import {
  applyIvyLeafHingeWebGLWind,
  createIvyLeafHingeWindNodes,
} from '../vegetation/seedthree/seedThreeFoliageWind.ts';

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

/**
 * A clean peripheral leaf already present in the authored colony texture.
 * Explicit geometry traces this source shape, so animated leaves reuse the
 * existing artwork/material/atlas instead of introducing another draw.
 */
const FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS = [
  [1031, 351],
  [1028, 337],
  [1021, 330],
  [1021, 324],
  [1029, 322],
  [1029, 314],
  [1038, 322],
  [1052, 321],
  [1061, 329],
  [1048, 335],
  [1042, 340],
  [1034, 338],
] as const;
const FOREST_FLOOR_IVY_LEAF_UV_CENTER_PIXEL = [1038, 328] as const;
const FOREST_FLOOR_IVY_LEAF_ROOT_PIXEL = FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS[0];
const FOREST_FLOOR_IVY_LEAF_PIXEL_LENGTH = 37;
const FOREST_FLOOR_IVY_LEAF_PIXEL_HALF_WIDTH = 40;

export type ForestFloorIvyLayerKind = 'ground' | 'lower' | 'upper' | 'crown';

export type ForestFloorIvyLayerSpec = {
  kind: ForestFloorIvyLayerKind;
  tier: 0 | 1 | 2 | 3;
  segmentsX: number;
  segmentsZ: number;
  footprintX: number;
  footprintZ: number;
  offsetX: number;
  offsetZ: number;
  yawOffset: number;
  riseScale: number;
  reliefScale: number;
  overhangScale: number;
  supportGap: number;
  tintScale: number;
  uvGuard: number;
};

/**
 * One alpha-cut leaf colony is compiled as seven botanical sheets distributed
 * across four height tiers. Paired lower and upper lobes break the silhouette
 * so the colony reads as overlapping foliage shelves rather than a concentric
 * height-field mound.
 */
export const FOREST_FLOOR_IVY_LAYER_SPECS = [
  {
    kind: 'ground',
    tier: 0,
    segmentsX: 8,
    segmentsZ: 6,
    footprintX: 1,
    footprintZ: 1,
    offsetX: 0,
    offsetZ: 0,
    yawOffset: 0,
    riseScale: 0,
    reliefScale: 0.38,
    overhangScale: 0,
    supportGap: 0,
    tintScale: 0.82,
    uvGuard: 0,
  },
  {
    kind: 'lower',
    tier: 1,
    segmentsX: 5,
    segmentsZ: 4,
    footprintX: 0.62,
    footprintZ: 0.56,
    offsetX: -0.22,
    offsetZ: -0.04,
    yawOffset: 0.28,
    riseScale: 0.07,
    reliefScale: 0.14,
    overhangScale: 0.16,
    supportGap: 0.006,
    tintScale: 0.88,
    uvGuard: 0.01,
  },
  {
    kind: 'lower',
    tier: 1,
    segmentsX: 5,
    segmentsZ: 4,
    footprintX: 0.57,
    footprintZ: 0.5,
    offsetX: 0.24,
    offsetZ: 0.1,
    yawOffset: -0.42,
    riseScale: 0.09,
    reliefScale: 0.14,
    overhangScale: 0.18,
    supportGap: 0.006,
    tintScale: 0.9,
    uvGuard: 0.01,
  },
  {
    kind: 'upper',
    tier: 2,
    segmentsX: 4,
    segmentsZ: 3,
    footprintX: 0.43,
    footprintZ: 0.4,
    offsetX: -0.14,
    offsetZ: 0.2,
    yawOffset: -0.25,
    riseScale: 0.12,
    reliefScale: 0.17,
    overhangScale: 0.2,
    supportGap: 0.008,
    tintScale: 0.96,
    uvGuard: 0.012,
  },
  {
    kind: 'upper',
    tier: 2,
    segmentsX: 4,
    segmentsZ: 3,
    footprintX: 0.39,
    footprintZ: 0.35,
    offsetX: 0.18,
    offsetZ: -0.15,
    yawOffset: 0.52,
    riseScale: 0.13,
    reliefScale: 0.18,
    overhangScale: 0.22,
    supportGap: 0.008,
    tintScale: 0.98,
    uvGuard: 0.012,
  },
  {
    kind: 'crown',
    tier: 3,
    segmentsX: 4,
    segmentsZ: 3,
    footprintX: 0.31,
    footprintZ: 0.29,
    offsetX: 0.02,
    offsetZ: 0.15,
    yawOffset: 0.67,
    riseScale: 0.16,
    reliefScale: 0.2,
    overhangScale: 0.22,
    supportGap: 0.009,
    tintScale: 1.02,
    uvGuard: 0.014,
  },
  {
    kind: 'crown',
    tier: 3,
    segmentsX: 3,
    segmentsZ: 3,
    footprintX: 0.26,
    footprintZ: 0.24,
    offsetX: -0.23,
    offsetZ: -0.1,
    yawOffset: -0.72,
    riseScale: 0.15,
    reliefScale: 0.18,
    overhangScale: 0.2,
    supportGap: 0.009,
    tintScale: 1,
    uvGuard: 0.014,
  },
] as const satisfies readonly ForestFloorIvyLayerSpec[];

export const FOREST_FLOOR_IVY_LAYER_COUNT = FOREST_FLOOR_IVY_LAYER_SPECS.length;
export const FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH = FOREST_FLOOR_IVY_LAYER_SPECS
  .reduce((total, layer) => total + (layer.segmentsX + 1) * (layer.segmentsZ + 1), 0);
export const FOREST_FLOOR_IVY_SHEET_TRIANGLES_PER_PATCH = FOREST_FLOOR_IVY_LAYER_SPECS
  .reduce((total, layer) => total + layer.segmentsX * layer.segmentsZ * 2, 0);
/** Sparse real leaves animate above the dense baked colony without moving it. */
export const FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH = 18;
export const FOREST_FLOOR_IVY_LEAF_VERTICES =
  FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS.length + 1;
export const FOREST_FLOOR_IVY_LEAF_TRIANGLES =
  FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS.length;
export const FOREST_FLOOR_IVY_VERTICES_PER_PATCH =
  FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH
  + FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_VERTICES;
export const FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH =
  FOREST_FLOOR_IVY_SHEET_TRIANGLES_PER_PATCH
  + FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_TRIANGLES;
export const FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT = 0.07;

const FOREST_FLOOR_IVY_LEAF_LAYER_SEQUENCE = [
  0, 0,
  1, 2, 1, 2, 1, 2,
  3, 4, 3, 4, 3, 4,
  5, 6, 5, 6,
] as const;

/** The perimeter almost touches the litter; only a small depth-safe lift remains. */
export const FOREST_FLOOR_IVY_GROUND_CLEARANCE = 0.014;
export const FOREST_FLOOR_IVY_RELIEF_MIN = 0.12;
export const FOREST_FLOOR_IVY_RELIEF_MAX = 0.22;
/** Absolute ground-to-crown guardrail, including every supporting shelf. */
export const FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX = 0.48;
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

export type ForestFloorIvyLayerVertexRange = ForestFloorIvyVertexRange & {
  placementIndex: number;
  layerIndex: number;
  kind: ForestFloorIvyLayerKind;
  tier: 0 | 1 | 2 | 3;
};

export type ForestFloorIvyAnimatedLeafVertexRange = ForestFloorIvyVertexRange & {
  placementIndex: number;
  leafIndex: number;
  layerIndex: number;
  tier: 0 | 1 | 2 | 3;
  rootVertex: number;
  tipVertex: number;
};

export type ForestFloorIvyStats = {
  instances: number;
  verticesPerInstance: number;
  trianglesPerInstance: number;
  vertices: number;
  triangles: number;
  layersPerInstance: number;
  layers: number;
  animatedLeavesPerInstance: number;
  animatedLeaves: number;
  drawCalls: number;
  maximumRelief: number;
  maximumCanopyHeight: number;
  seed: number;
};

export type CompiledForestFloorIvyGeometry = {
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  placementVertexRangesByTree: ForestFloorIvyVertexRange[][];
  layerVertexRanges: ForestFloorIvyLayerVertexRange[];
  animatedLeafVertexRanges: ForestFloorIvyAnimatedLeafVertexRange[];
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

export function createForestFloorIvyMaterial(
  name: string,
  textures: SeedThreeGroundCoverTextures,
  rendererBackend: RendererBackendKind,
): THREE.Material {
  const hingeWind = createIvyLeafHingeWindNodes();
  const material = createSeedThreeGroundCoverMaterial(
    name,
    textures,
    rendererBackend,
    [0.07, 0.13, 0.04],
    0,
    hingeWind.positionNode,
  );
  material.alphaTest = 0.31;
  if (supportsNodeMaterials(rendererBackend)) {
    // The same rigid petiole rotation drives lighting as well as position;
    // otherwise close leaves visibly brighten/darken against a static normal.
    (material as THREE.Material & { normalNode: unknown }).normalNode =
      hingeWind.normalNode;
  } else {
    applyIvyLeafHingeWebGLWind(material);
  }
  return material;
}

/**
 * Manor-Lords-style ivy is a layered leaf canopy resting on litter, not a
 * crossed billboard clump or one embossed sheet. Every patch compiles a broad
 * ground-contact drape plus paired lower, paired upper, and crown shelves, then
 * roots sparse cambered hero leaves into those supports. The dense sheets stay
 * welded to litter while each real leaf hinges independently in SeedThree wind.
 * Every support samples the rendered terrain and the strata beneath it, so the
 * alpha perimeter lands on foliage while the interior has grazing-view depth.
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
  const material = createForestFloorIvyMaterial(
    'SeedThree terrain-conforming woodland ivy',
    textures,
    rendererBackend ?? 'webgl',
  );

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
      layersPerInstance: FOREST_FLOOR_IVY_LAYER_COUNT,
      layers: FOREST_FLOOR_IVY_LAYER_COUNT * placements.length,
      animatedLeavesPerInstance: FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
      animatedLeaves: FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH * placements.length,
      drawCalls: placements.length > 0 ? 1 : 0,
      maximumRelief: placements.reduce(
        (maximum, placement) => Math.max(maximum, placement.reliefHeight),
        0,
      ),
      maximumCanopyHeight: placements.reduce(
        (maximum, placement) => Math.max(
          maximum,
          Math.min(
            FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
            placement.reliefHeight * ivyMaximumStackScale()
              + ivyMaximumSupportGap(),
          ),
        ),
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
  const layerValues = new Uint8Array(vertexCount);
  const rootPhaseValues = new Float32Array(vertexCount * 4);
  const hingeValues = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  const placementVertexRangesByTree = Array.from(
    { length: treeCount },
    () => [] as ForestFloorIvyVertexRange[],
  );
  const layerVertexRanges: ForestFloorIvyLayerVertexRange[] = [];
  const animatedLeafVertexRanges: ForestFloorIvyAnimatedLeafVertexRange[] = [];
  const color = new THREE.Color();
  const layerColor = new THREE.Color();
  const tintWhite = new THREE.Color(0xffffff);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
    const placement = placements[placementIndex]!;
    const layerPlans = createIvyLayerPlans(placement, placementIndex, seed);
    const tintRng = mulberry32(
      (seed ^ Math.imul(placementIndex + 1, 0x9e3779b1)) >>> 0,
    );
    color.setHSL(
      0.285 + (tintRng() - 0.5) * 0.022,
      0.34 + tintRng() * 0.08,
      0.31 + (tintRng() - 0.5) * 0.045,
    ).lerp(tintWhite, 0.18);

    const placementStart = vertexOffset;
    for (let layerIndex = 0; layerIndex < layerPlans.length; layerIndex++) {
      const layer = layerPlans[layerIndex]!;
      const spec = layer.spec;
      const layerStart = vertexOffset;
      layerColor.copy(color).multiplyScalar(spec.tintScale);
      const minU = Math.max(0, FOREST_FLOOR_IVY_UV_BOUNDS.minU - spec.uvGuard);
      const maxU = Math.min(1, FOREST_FLOOR_IVY_UV_BOUNDS.maxU + spec.uvGuard);
      const minV = Math.max(0, FOREST_FLOOR_IVY_UV_BOUNDS.minV - spec.uvGuard);
      const maxV = Math.min(1, FOREST_FLOOR_IVY_UV_BOUNDS.maxV + spec.uvGuard);

      for (let zIndex = 0; zIndex <= spec.segmentsZ; zIndex++) {
        const tz = zIndex / spec.segmentsZ;
        const normalizedZ = tz * 2 - 1;
        for (let xIndex = 0; xIndex <= spec.segmentsX; xIndex++) {
          const tx = xIndex / spec.segmentsX;
          const normalizedX = tx * 2 - 1;
          const localX = normalizedX * layer.radiusX;
          const localZ = normalizedZ * layer.radiusZ;
          const worldX = layer.centerX + localX * layer.cos - localZ * layer.sin;
          const worldZ = layer.centerZ + localX * layer.sin + localZ * layer.cos;
          const supportHeight = layerIndex === 0
            ? 0
            : ivyStackHeightAtWorld(
              worldX,
              worldZ,
              placement,
              layerPlans,
              layerIndex,
            );
          const shelfHeight = Math.min(
            FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
            supportHeight + ivyLayerOwnElevation(
              normalizedX,
              normalizedZ,
              placement,
              layer,
            ),
          );
          const worldY = terrain.getHeightAt(worldX, worldZ)
            + FOREST_FLOOR_IVY_GROUND_CLEARANCE
            + shelfHeight;
          const vertexIndex = vertexOffset
            + zIndex * (spec.segmentsX + 1)
            + xIndex;
          const positionOffset = vertexIndex * 3;
          positions[positionOffset] = worldX;
          positions[positionOffset + 1] = worldY;
          positions[positionOffset + 2] = worldZ;
          const uvOffset = vertexIndex * 2;
          uvs[uvOffset] = THREE.MathUtils.lerp(
            minU,
            maxU,
            layer.flipU ? 1 - tx : tx,
          );
          uvs[uvOffset + 1] = THREE.MathUtils.lerp(
            minV,
            maxV,
            tz,
          );
          tintValues[positionOffset] = layerColor.r;
          tintValues[positionOffset + 1] = layerColor.g;
          tintValues[positionOffset + 2] = layerColor.b;
          layerValues[vertexIndex] = layerIndex;
        }
      }

      const rowSize = spec.segmentsX + 1;
      for (let zIndex = 0; zIndex < spec.segmentsZ; zIndex++) {
        for (let xIndex = 0; xIndex < spec.segmentsX; xIndex++) {
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

      const layerCount = (spec.segmentsX + 1) * (spec.segmentsZ + 1);
      layerVertexRanges.push({
        start: layerStart,
        count: layerCount,
        placementIndex,
        layerIndex,
        kind: spec.kind,
        tier: spec.tier,
      });
      vertexOffset += layerCount;
    }

    const leafWrite = appendAnimatedIvyLeaves({
      placement,
      placementIndex,
      layerPlans,
      terrain,
      seed,
      baseColor: color,
      positions,
      uvs,
      tintValues,
      layerValues,
      rootPhaseValues,
      hingeValues,
      indices,
      vertexOffset,
      indexOffset,
      animatedLeafVertexRanges,
    });
    vertexOffset = leafWrite.vertexOffset;
    indexOffset = leafWrite.indexOffset;

    placementVertexRangesByTree[placement.sourceTreeIndex]?.push({
      start: placementStart,
      count: vertexOffset - placementStart,
    });
  }

  if (vertexOffset !== vertexCount || indexOffset !== indexCount) {
    throw new Error(
      `Forest-floor ivy compiler wrote ${vertexOffset}/${vertexCount} vertices and ${indexOffset}/${indexCount} indices.`,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('ivyLayer', new THREE.Uint8BufferAttribute(layerValues, 1));
  geometry.setAttribute('aIvyRootPhase', new THREE.BufferAttribute(rootPhaseValues, 4));
  geometry.setAttribute('aIvyHinge', new THREE.BufferAttribute(hingeValues, 4));
  const tint = new THREE.BufferAttribute(tintValues, 3);
  // SeedThree's WebGPU material consumes aTint; the WebGL fallback consumes
  // Three's conventional color semantic. Both share one immutable buffer.
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('color', tint);
  if (vertexCount > 0) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.boundingBox?.expandByScalar(
      FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT,
    );
    if (geometry.boundingSphere) {
      geometry.boundingSphere.radius += FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT;
    }
  }
  return {
    geometry,
    originalPositions: positions.slice(),
    placementVertexRangesByTree,
    layerVertexRanges,
    animatedLeafVertexRanges,
  };
}

type CompiledIvyLayerPlan = {
  spec: (typeof FOREST_FLOOR_IVY_LAYER_SPECS)[number];
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  cos: number;
  sin: number;
  phase: number;
  flipU: boolean;
};

function createIvyLayerPlans(
  placement: ForestFloorIvyPlacement,
  placementIndex: number,
  seed: number,
): CompiledIvyLayerPlan[] {
  const rng = mulberry32(
    (seed ^ Math.imul(placementIndex + 1, 0x27d4eb2d)) >>> 0,
  );
  const placementCos = Math.cos(placement.yaw);
  const placementSin = Math.sin(placement.yaw);

  return FOREST_FLOOR_IVY_LAYER_SPECS.map((spec, layerIndex) => {
    const upperLayer = layerIndex > 0;
    const offsetJitterX = upperLayer ? (rng() - 0.5) * 0.045 : 0;
    const offsetJitterZ = upperLayer ? (rng() - 0.5) * 0.045 : 0;
    const radiusJitterX = upperLayer ? THREE.MathUtils.lerp(0.96, 1.04, rng()) : 1;
    const radiusJitterZ = upperLayer ? THREE.MathUtils.lerp(0.96, 1.04, rng()) : 1;
    const yaw = placement.yaw
      + spec.yawOffset
      + (upperLayer ? (rng() - 0.5) * 0.14 : 0);
    const localCenterX = placement.radiusX * (spec.offsetX + offsetJitterX);
    const localCenterZ = placement.radiusZ * (spec.offsetZ + offsetJitterZ);
    return {
      spec,
      centerX: placement.x
        + localCenterX * placementCos
        - localCenterZ * placementSin,
      centerZ: placement.z
        + localCenterX * placementSin
        + localCenterZ * placementCos,
      radiusX: placement.radiusX * spec.footprintX * radiusJitterX,
      radiusZ: placement.radiusZ * spec.footprintZ * radiusJitterZ,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      phase: placement.reliefPhase
        + layerIndex * 1.73
        + (upperLayer ? (rng() - 0.5) * 0.5 : 0),
      flipU: upperLayer && rng() < 0.5,
    };
  });
}

type AnimatedIvyLeafWriteArgs = {
  placement: ForestFloorIvyPlacement;
  placementIndex: number;
  layerPlans: readonly CompiledIvyLayerPlan[];
  terrain: IvyTerrainSurface;
  seed: number;
  baseColor: THREE.Color;
  positions: Float32Array;
  uvs: Float32Array;
  tintValues: Float32Array;
  layerValues: Uint8Array;
  rootPhaseValues: Float32Array;
  hingeValues: Float32Array;
  indices: Uint32Array;
  vertexOffset: number;
  indexOffset: number;
  animatedLeafVertexRanges: ForestFloorIvyAnimatedLeafVertexRange[];
};

function appendAnimatedIvyLeaves(
  args: AnimatedIvyLeafWriteArgs,
): { vertexOffset: number; indexOffset: number } {
  const {
    placement,
    placementIndex,
    layerPlans,
    terrain,
    seed,
    baseColor,
    positions,
    uvs,
    tintValues,
    layerValues,
    rootPhaseValues,
    hingeValues,
    indices,
    animatedLeafVertexRanges,
  } = args;
  const rng = mulberry32(
    (seed ^ Math.imul(placementIndex + 1, 0x165667b1)) >>> 0,
  );
  const sourcePixels = [
    ...FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS,
    FOREST_FLOOR_IVY_LEAF_UV_CENTER_PIXEL,
  ] as const;
  const boundaryCount = FOREST_FLOOR_IVY_LEAF_UV_BOUNDARY_PIXELS.length;
  const centerLocalIndex = FOREST_FLOOR_IVY_LEAF_VERTICES - 1;
  const rootPixelX = FOREST_FLOOR_IVY_LEAF_ROOT_PIXEL[0];
  const rootPixelY = FOREST_FLOOR_IVY_LEAF_ROOT_PIXEL[1];
  const tierLengthRanges = [
    [0.18, 0.25],
    [0.21, 0.3],
    [0.23, 0.34],
    [0.25, 0.37],
  ] as const;
  const tierHingeRanges = [
    [0.025, 0.04],
    [0.04, 0.058],
    [0.065, 0.09],
    [0.085, 0.115],
  ] as const;
  const tierTiltRanges = [
    [8, 16],
    [12, 22],
    [16, 28],
    [18, 32],
  ] as const;
  const placementScale = THREE.MathUtils.clamp(placement.scale, 0.82, 1.25);
  const leafColor = new THREE.Color();
  let vertexOffset = args.vertexOffset;
  let indexOffset = args.indexOffset;

  for (
    let leafIndex = 0;
    leafIndex < FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH;
    leafIndex++
  ) {
    const layerIndex = FOREST_FLOOR_IVY_LEAF_LAYER_SEQUENCE[leafIndex]!;
    const layer = layerPlans[layerIndex]!;
    const tier = layer.spec.tier;
    const radialAngle = rng() * Math.PI * 2;
    const radialMinimum = tier === 0 ? 0.56 : 0.18;
    const radialMaximum = tier === 0 ? 0.86 : 0.78;
    const radial = THREE.MathUtils.lerp(
      radialMinimum,
      radialMaximum,
      Math.sqrt(rng()),
    );
    const normalizedX = Math.cos(radialAngle) * radial;
    const normalizedZ = Math.sin(radialAngle) * radial;
    const localX = normalizedX * layer.radiusX;
    const localZ = normalizedZ * layer.radiusZ;
    const rootX = layer.centerX + localX * layer.cos - localZ * layer.sin;
    const rootZ = layer.centerZ + localX * layer.sin + localZ * layer.cos;
    const supportHeight = layerIndex === 0
      ? 0
      : ivyStackHeightAtWorld(
        rootX,
        rootZ,
        placement,
        layerPlans,
        layerIndex,
      );
    const shelfHeight = Math.min(
      FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
      supportHeight + ivyLayerOwnElevation(
        normalizedX,
        normalizedZ,
        placement,
        layer,
      ),
    );
    const rootY = terrain.getHeightAt(rootX, rootZ)
      + FOREST_FLOOR_IVY_GROUND_CLEARANCE
      + shelfHeight
      + 0.003;

    const outwardYaw = Math.atan2(rootZ - layer.centerZ, rootX - layer.centerX);
    const forwardYaw = outwardYaw + (rng() - 0.5) * 1.35;
    const forwardX = Math.cos(forwardYaw);
    const forwardZ = Math.sin(forwardYaw);
    const hingeX = -forwardZ;
    const hingeZ = forwardX;
    const lengthRange = tierLengthRanges[tier];
    const length = THREE.MathUtils.lerp(lengthRange[0], lengthRange[1], rng())
      * placementScale;
    const width = length * THREE.MathUtils.lerp(0.76, 0.94, rng());
    const tiltRange = tierTiltRanges[tier];
    const tilt = THREE.MathUtils.degToRad(
      THREE.MathUtils.lerp(tiltRange[0], tiltRange[1], rng()),
    );
    const forwardHorizontal = Math.cos(tilt);
    const forwardVertical = Math.sin(tilt);
    const camber = length * THREE.MathUtils.lerp(0.035, 0.065, rng());
    const twist = length * (rng() - 0.5) * 0.055;
    const hingeRange = tierHingeRanges[tier];
    const hingeAmplitude = THREE.MathUtils.lerp(
      hingeRange[0],
      hingeRange[1],
      rng(),
    );
    const phase = placement.reliefPhase
      + leafIndex * 0.73
      + (rng() - 0.5) * 0.62;
    const mirror = rng() < 0.5 ? -1 : 1;
    leafColor.copy(baseColor).multiplyScalar(
      layer.spec.tintScale * THREE.MathUtils.lerp(0.94, 1.075, rng()),
    );

    const leafStart = vertexOffset;
    for (let localIndex = 0; localIndex < sourcePixels.length; localIndex++) {
      const sourcePixel = sourcePixels[localIndex]!;
      const localForward = THREE.MathUtils.clamp(
        (rootPixelY - sourcePixel[1]) / FOREST_FLOOR_IVY_LEAF_PIXEL_LENGTH,
        0,
        1,
      );
      const localWidth = mirror
        * (sourcePixel[0] - rootPixelX)
        / FOREST_FLOOR_IVY_LEAF_PIXEL_HALF_WIDTH;
      const edgeDistance = Math.min(1, Math.abs(localWidth));
      const foldLift = Math.sin(localForward * Math.PI)
        * camber
        * (1 - edgeDistance * 0.48);
      const twistLift = localWidth * localForward * twist;
      const along = localForward * length;
      const across = localWidth * width;
      const vertexIndex = vertexOffset + localIndex;
      const positionOffset = vertexIndex * 3;
      positions[positionOffset] = rootX
        + forwardX * along * forwardHorizontal
        + hingeX * across;
      positions[positionOffset + 1] = rootY
        + along * forwardVertical
        + foldLift
        + twistLift;
      positions[positionOffset + 2] = rootZ
        + forwardZ * along * forwardHorizontal
        + hingeZ * across;
      const uvOffset = vertexIndex * 2;
      uvs[uvOffset] = sourcePixel[0] / 1254;
      uvs[uvOffset + 1] = 1 - sourcePixel[1] / 1254;
      tintValues[positionOffset] = leafColor.r;
      tintValues[positionOffset + 1] = leafColor.g;
      tintValues[positionOffset + 2] = leafColor.b;
      layerValues[vertexIndex] = layerIndex;
      const motionOffset = vertexIndex * 4;
      rootPhaseValues[motionOffset] = rootX;
      rootPhaseValues[motionOffset + 1] = rootY;
      rootPhaseValues[motionOffset + 2] = rootZ;
      rootPhaseValues[motionOffset + 3] = phase;
      hingeValues[motionOffset] = hingeX;
      hingeValues[motionOffset + 1] = 0;
      hingeValues[motionOffset + 2] = hingeZ;
      hingeValues[motionOffset + 3] = hingeAmplitude;
    }

    for (let boundaryIndex = 0; boundaryIndex < boundaryCount; boundaryIndex++) {
      indices[indexOffset++] = leafStart + centerLocalIndex;
      if (mirror > 0) {
        indices[indexOffset++] = leafStart + (boundaryIndex + 1) % boundaryCount;
        indices[indexOffset++] = leafStart + boundaryIndex;
      } else {
        indices[indexOffset++] = leafStart + boundaryIndex;
        indices[indexOffset++] = leafStart + (boundaryIndex + 1) % boundaryCount;
      }
    }
    animatedLeafVertexRanges.push({
      start: leafStart,
      count: FOREST_FLOOR_IVY_LEAF_VERTICES,
      placementIndex,
      leafIndex,
      layerIndex,
      tier,
      rootVertex: leafStart,
      tipVertex: leafStart + 5,
    });
    vertexOffset += FOREST_FLOOR_IVY_LEAF_VERTICES;
  }

  return { vertexOffset, indexOffset };
}

function ivyStackHeightAtWorld(
  worldX: number,
  worldZ: number,
  placement: ForestFloorIvyPlacement,
  layers: readonly CompiledIvyLayerPlan[],
  throughLayerExclusive: number,
): number {
  const targetTier = layers[throughLayerExclusive]!.spec.tier;
  const heightByTier = [0, 0, 0, 0];
  for (let layerIndex = 0; layerIndex < throughLayerExclusive; layerIndex++) {
    const layer = layers[layerIndex]!;
    if (layer.spec.tier >= targetTier) continue;
    const dx = worldX - layer.centerX;
    const dz = worldZ - layer.centerZ;
    const normalizedX = (dx * layer.cos + dz * layer.sin) / layer.radiusX;
    const normalizedZ = (-dx * layer.sin + dz * layer.cos) / layer.radiusZ;
    if (normalizedX * normalizedX + normalizedZ * normalizedZ >= 1) continue;
    heightByTier[layer.spec.tier] = Math.max(
      heightByTier[layer.spec.tier]!,
      ivyLayerOwnElevation(
      normalizedX,
      normalizedZ,
      placement,
      layer,
      ),
    );
  }
  return heightByTier.reduce((height, tierHeight) => height + tierHeight, 0);
}

function ivyLayerOwnElevation(
  x: number,
  z: number,
  placement: ForestFloorIvyPlacement,
  layer: CompiledIvyLayerPlan,
): number {
  const radius = Math.sqrt(x * x + z * z);
  const contactWidth = layer.spec.tier === 0 ? 0.72 : 0.38;
  const contact = smootherstep01(
    THREE.MathUtils.clamp((1 - radius) / contactWidth, 0, 1),
  );
  const rootArc = smootherstep01(THREE.MathUtils.clamp((0.62 - z) / 1.15, 0, 1));
  const fringe = smootherstep01(1 - contact);
  return layer.spec.supportGap + placement.reliefHeight * (
    layer.spec.riseScale * contact
    + layer.spec.reliefScale * ivyLayerProfileAt(x, z, contact, layer.phase)
    + layer.spec.overhangScale * rootArc * fringe
  );
}

function ivyLayerProfileAt(
  x: number,
  z: number,
  contact: number,
  phase: number,
): number {
  const center = gaussian2(x, z, -0.04, 0.12, 0.62, 0.52);
  const leftLobe = gaussian2(x, z, -0.43, -0.05, 0.36, 0.42);
  const rightLobe = gaussian2(x, z, 0.4, 0.02, 0.4, 0.38);
  const backLobe = gaussian2(x, z, 0.08, 0.48, 0.46, 0.3);
  const fold = 0.5 + 0.5 * Math.sin(x * 8.7 + z * 5.3 + phase);
  return contact * THREE.MathUtils.clamp(
    0.29
      + center * 0.38
      + leftLobe * 0.16
      + rightLobe * 0.14
      + backLobe * 0.12
      + fold * 0.045,
    0,
    1,
  );
}

function ivyMaximumStackScale(): number {
  const maximumByTier = [0, 0, 0, 0];
  for (const layer of FOREST_FLOOR_IVY_LAYER_SPECS) {
    maximumByTier[layer.tier] = Math.max(
      maximumByTier[layer.tier]!,
      layer.riseScale + layer.reliefScale + layer.overhangScale,
    );
  }
  return maximumByTier.reduce((total, maximum) => total + maximum, 0);
}

function ivyMaximumSupportGap(): number {
  const maximumByTier = [0, 0, 0, 0];
  for (const layer of FOREST_FLOOR_IVY_LAYER_SPECS) {
    maximumByTier[layer.tier] = Math.max(
      maximumByTier[layer.tier]!,
      layer.supportGap,
    );
  }
  return maximumByTier.reduce((total, maximum) => total + maximum, 0);
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
