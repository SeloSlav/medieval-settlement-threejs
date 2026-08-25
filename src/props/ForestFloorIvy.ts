import * as THREE from 'three';
import { applyGroundCoverShadowPolicy } from '@seedthree/core/ground-cover-shadows.js';
import { setForestCardSnowCoverage } from '@seedthree/core/branch-cards.js';
import {
  attribute,
  float,
  mix,
  normalWorldGeometry,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  supportsNodeMaterials,
  type RendererBackendKind,
} from '../scene/RendererBackend.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import { mulberry32 } from '../utils/random.ts';
import { createForestFloorPlacementMask } from './ForestFloorPlacementMask.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';
import {
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import {
  applyIvyLeafHingeWebGLWind,
  createIvyLeafHingeWindNodes,
} from '../vegetation/seedthree/seedThreeFoliageWind.ts';

export const FOREST_FLOOR_IVY_SEED = 0x1f1c0a7;
export const FOREST_FLOOR_IVY_MIN_BLEND = 0.24;
export const FOREST_FLOOR_IVY_SNOW_RGB = [0.92, 0.955, 0.98] as const;
export const FOREST_FLOOR_IVY_SNOW_EXPOSURE_MIN = 0.2;
export const FOREST_FLOOR_IVY_SNOW_EXPOSURE_MAX = 0.86;
export const FOREST_FLOOR_IVY_SNOW_MAX_BLEND = 0.58;
export const FOREST_FLOOR_IVY_SNOW_SSS_ATTENUATION = 0.82;

type IvySnowNode = {
  add: (value: unknown) => IvySnowNode;
  mul: (value: unknown) => IvySnowNode;
  sub: (value: unknown) => IvySnowNode;
  a: IvySnowNode;
  rgb: IvySnowNode;
  x: IvySnowNode;
  y: IvySnowNode;
  z: IvySnowNode;
};

type IvySnowUniformNode = IvySnowNode & { value: number };

type IvySnowNodeMaterial = THREE.Material & {
  colorNode: IvySnowNode | null;
  thicknessColorNode: IvySnowNode | null;
};

const ivySnowTsl = {
  attribute: attribute as (name: string, type: string) => IvySnowNode,
  float: float as (value: number) => IvySnowNode,
  mix: mix as (a: unknown, b: unknown, amount: unknown) => IvySnowNode,
  normalWorldGeometry: normalWorldGeometry as IvySnowNode,
  positionWorld: positionWorld as IvySnowNode,
  sin: sin as (value: unknown) => IvySnowNode,
  smoothstep: smoothstep as (
    edge0: unknown,
    edge1: unknown,
    value: unknown,
  ) => IvySnowNode,
  texture: texture as (source: THREE.Texture) => IvySnowNode,
  uniform: uniform as (value: number) => IvySnowUniformNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => IvySnowNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => IvySnowNode,
};

const FOREST_FLOOR_IVY_SNOW_WEBGL_CACHE_KEY =
  'seedthree-forest-floor-ivy-snow-v1';
const FOREST_FLOOR_IVY_SNOW_WEBGL_VERTEX_DECLARATIONS = `
varying float vForestFloorIvySnowExposure;
varying vec2 vForestFloorIvySnowWorldXZ;
`;
const FOREST_FLOOR_IVY_SNOW_WEBGL_FRAGMENT_DECLARATIONS = `
uniform float uForestFloorIvySnowCoverage;
varying float vForestFloorIvySnowExposure;
varying vec2 vForestFloorIvySnowWorldXZ;
`;

/**
 * Procedural five-lobed ivy silhouette in (half-width, root-to-tip) space.
 * The geometry owns the outline, so no atlas alpha can drift away from it.
 */
export const FOREST_FLOOR_IVY_LEAF_BOUNDARY = [
  [0, 0],
  [0.11, 0.13],
  [0.38, 0.24],
  [0.24, 0.36],
  [0.58, 0.51],
  [0.28, 0.61],
  [0.18, 0.77],
  [0.08, 0.88],
  [0, 1],
  [-0.08, 0.88],
  [-0.18, 0.77],
  [-0.28, 0.61],
  [-0.58, 0.51],
  [-0.24, 0.36],
  [-0.38, 0.24],
  [-0.11, 0.13],
] as const;

export const FOREST_FLOOR_IVY_RUNNERS_PER_PATCH = 7;
export const FOREST_FLOOR_IVY_LEAVES_PER_RUNNER = 6;
export const FOREST_FLOOR_IVY_RUNNER_SEGMENTS = FOREST_FLOOR_IVY_LEAVES_PER_RUNNER;
export const FOREST_FLOOR_IVY_RUNNER_VERTICES =
  (FOREST_FLOOR_IVY_RUNNER_SEGMENTS + 1) * 3;
export const FOREST_FLOOR_IVY_RUNNER_TRIANGLES =
  FOREST_FLOOR_IVY_RUNNER_SEGMENTS * 4;
export const FOREST_FLOOR_IVY_RUNNER_VERTICES_PER_PATCH =
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH * FOREST_FLOOR_IVY_RUNNER_VERTICES;
export const FOREST_FLOOR_IVY_RUNNER_TRIANGLES_PER_PATCH =
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH * FOREST_FLOOR_IVY_RUNNER_TRIANGLES;
export const FOREST_FLOOR_IVY_LEAVES_PER_PATCH =
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH * FOREST_FLOOR_IVY_LEAVES_PER_RUNNER;
/** All visible leaves are explicit meshes and all of them animate. */
export const FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH =
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH;
export const FOREST_FLOOR_IVY_LEAF_VERTICES =
  FOREST_FLOOR_IVY_LEAF_BOUNDARY.length + 1;
export const FOREST_FLOOR_IVY_LEAF_TRIANGLES =
  FOREST_FLOOR_IVY_LEAF_BOUNDARY.length;
export const FOREST_FLOOR_IVY_VERTICES_PER_PATCH =
  FOREST_FLOOR_IVY_RUNNER_VERTICES_PER_PATCH
  + FOREST_FLOOR_IVY_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_VERTICES;
export const FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH =
  FOREST_FLOOR_IVY_RUNNER_TRIANGLES_PER_PATCH
  + FOREST_FLOOR_IVY_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_TRIANGLES;
export const FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT = 0.07;

/** The perimeter almost touches the litter; only a small depth-safe lift remains. */
export const FOREST_FLOOR_IVY_GROUND_CLEARANCE = 0.014;
export const FOREST_FLOOR_IVY_RELIEF_MIN = 0.12;
export const FOREST_FLOOR_IVY_RELIEF_MAX = 0.22;
/** Absolute ground-to-leaf-tip guardrail for the low runner network. */
export const FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX = 0.22;
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

export type ForestFloorIvyBlocker = (x: number, z: number) => boolean;

export type ForestFloorIvyVertexRange = {
  start: number;
  count: number;
};

export type ForestFloorIvyRunnerVertexRange = ForestFloorIvyVertexRange & {
  placementIndex: number;
  runnerIndex: number;
};

export type ForestFloorIvyLeafVertexRange = ForestFloorIvyVertexRange & {
  placementIndex: number;
  leafIndex: number;
  runnerIndex: number;
  runnerNodeIndex: number;
  runnerRootVertex: number;
  rootVertex: number;
  tipVertex: number;
};

export type ForestFloorIvyStats = {
  instances: number;
  verticesPerInstance: number;
  trianglesPerInstance: number;
  vertices: number;
  triangles: number;
  runnersPerInstance: number;
  runners: number;
  leavesPerInstance: number;
  leaves: number;
  drawCalls: number;
  maximumRelief: number;
  maximumCanopyHeight: number;
  seed: number;
};

export type CompiledForestFloorIvyGeometry = {
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  placementVertexRanges: ForestFloorIvyVertexRange[];
  placementVertexRangesByTree: ForestFloorIvyVertexRange[][];
  runnerVertexRanges: ForestFloorIvyRunnerVertexRange[];
  leafVertexRanges: ForestFloorIvyLeafVertexRange[];
};

export type ForestFloorIvyInstances = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  placements: ForestFloorIvyPlacement[];
  placementVertexRanges: ForestFloorIvyVertexRange[];
  placementVertexRangesByTree: ForestFloorIvyVertexRange[][];
  placementIndicesByTree: number[][];
  textures: SeedThreeGroundCoverTextures;
  stats: ForestFloorIvyStats;
  setSnowCoverage: (coverage: number) => boolean;
  setTreeActive: (treeIndex: number, active: boolean) => boolean;
  setPlacementActive: (placementIndex: number, active: boolean) => boolean;
  refreshBlockedMask: (isBlockedAt?: ForestFloorIvyBlocker) => number;
  commit: () => void;
  dispose: () => void;
};

function applyForestFloorIvyNodeSnow(
  material: THREE.Material,
  textures: SeedThreeGroundCoverTextures,
): void {
  const target = material as IvySnowNodeMaterial;
  const snowCoverage = ivySnowTsl.uniform(0);
  const albedo = ivySnowTsl.texture(textures.albedo);
  const baseColor = albedo.mul(
    ivySnowTsl.vec4(
      ivySnowTsl.attribute('aTint', 'vec3'),
      ivySnowTsl.float(1),
    ),
  );
  const upwardExposure = ivySnowTsl.smoothstep(
    ivySnowTsl.float(FOREST_FLOOR_IVY_SNOW_EXPOSURE_MIN),
    ivySnowTsl.float(FOREST_FLOOR_IVY_SNOW_EXPOSURE_MAX),
    ivySnowTsl.normalWorldGeometry.y,
  );
  const snowVariation = ivySnowTsl.sin(
    ivySnowTsl.positionWorld.x
      .mul(ivySnowTsl.float(0.81))
      .add(ivySnowTsl.positionWorld.z.mul(ivySnowTsl.float(1.13))),
  ).mul(ivySnowTsl.float(0.12)).add(ivySnowTsl.float(0.88));
  const snowAmount = snowCoverage
    .mul(upwardExposure)
    .mul(snowVariation)
    .mul(ivySnowTsl.float(FOREST_FLOOR_IVY_SNOW_MAX_BLEND));
  const snowColor = ivySnowTsl.vec3(
    FOREST_FLOOR_IVY_SNOW_RGB[0],
    FOREST_FLOOR_IVY_SNOW_RGB[1],
    FOREST_FLOOR_IVY_SNOW_RGB[2],
  );

  // Preserve procedural vertex coloration while changing only the visible
  // leaf surface. Snow also mutes the same SSS path used by SeedThree foliage
  // so covered leaves do not glow green.
  target.colorNode = ivySnowTsl.vec4(
    ivySnowTsl.mix(baseColor.rgb, snowColor, snowAmount),
    baseColor.a,
  );
  if (target.thicknessColorNode) {
    target.thicknessColorNode = target.thicknessColorNode.mul(
      ivySnowTsl.float(1).sub(
        snowAmount.mul(ivySnowTsl.float(FOREST_FLOOR_IVY_SNOW_SSS_ATTENUATION)),
      ),
    );
  }
  material.userData.forestSnowCoverage = snowCoverage;
}

function applyForestFloorIvyWebGLSnow(material: THREE.Material): void {
  const snowCoverage = new THREE.Uniform(0);
  material.userData.forestSnowCoverage = snowCoverage;
  chainMaterialShaderPatch(
    material,
    FOREST_FLOOR_IVY_SNOW_WEBGL_CACHE_KEY,
    (shader) => {
      shader.uniforms.uForestFloorIvySnowCoverage = snowCoverage;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n${FOREST_FLOOR_IVY_SNOW_WEBGL_VERTEX_DECLARATIONS}`,
      );
      // The petiole-wind patch rotates objectNormal before this chunk. Reading
      // it here keeps snow exposure coherent without replacing the wind hook.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
vec3 forestFloorIvySnowWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
vForestFloorIvySnowExposure = smoothstep(
  ${FOREST_FLOOR_IVY_SNOW_EXPOSURE_MIN.toFixed(2)},
  ${FOREST_FLOOR_IVY_SNOW_EXPOSURE_MAX.toFixed(2)},
  forestFloorIvySnowWorldNormal.y
);`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vForestFloorIvySnowWorldXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#include <project_vertex>`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n${FOREST_FLOOR_IVY_SNOW_WEBGL_FRAGMENT_DECLARATIONS}`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float forestFloorIvySnowVariation = sin(
  vForestFloorIvySnowWorldXZ.x * 0.81
  + vForestFloorIvySnowWorldXZ.y * 1.13
) * 0.12 + 0.88;
float forestFloorIvySnowAmount = clamp(
  uForestFloorIvySnowCoverage
  * vForestFloorIvySnowExposure
  * forestFloorIvySnowVariation
  * ${FOREST_FLOOR_IVY_SNOW_MAX_BLEND.toFixed(2)},
  0.0,
  1.0
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  vec3(
    ${FOREST_FLOOR_IVY_SNOW_RGB[0].toFixed(3)},
    ${FOREST_FLOOR_IVY_SNOW_RGB[1].toFixed(3)},
    ${FOREST_FLOOR_IVY_SNOW_RGB[2].toFixed(3)}
  ),
  forestFloorIvySnowAmount
);`,
      );
    },
  );
  material.needsUpdate = true;
}

/**
 * The runner and leaf meshes own their exact silhouettes and coloration.
 * SeedThree's shared ground-cover material still expects an albedo map, so a
 * neutral texel keeps that material path without reintroducing a leaf atlas.
 */
export function createForestFloorIvyTextures(
  maxAnisotropy = 1,
): SeedThreeGroundCoverTextures {
  const albedo = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  albedo.name = 'Procedural forest-floor ivy neutral albedo';
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.ClampToEdgeWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  albedo.needsUpdate = true;
  return {
    albedo,
    normal: null,
    roughness: null,
    translucency: null,
  };
}

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
  material.alphaTest = 0;
  if (supportsNodeMaterials(rendererBackend)) {
    applyForestFloorIvyNodeSnow(material, textures);
    // The same rigid petiole rotation drives lighting as well as position;
    // otherwise close leaves visibly brighten/darken against a static normal.
    (material as THREE.Material & { normalNode: unknown }).normalNode =
      hingeWind.normalNode;
  } else {
    applyIvyLeafHingeWebGLWind(material);
    applyForestFloorIvyWebGLSnow(material);
  }
  return material;
}

/**
 * Every patch is a small ivy growth graph: tapered runners crawl across the
 * rendered terrain and alternating lobed leaves attach at successive nodes.
 * There is no colony card or floating hero-leaf layer. Each visible leaf owns
 * its silhouette and hinges independently at the petiole in SeedThree wind.
 */
export async function createForestFloorIvyInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: ForestFloorIvyBlocker,
): Promise<ForestFloorIvyInstances> {
  const textures = createForestFloorIvyTextures(maxAnisotropy);
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
  mesh.name = 'SeedThree runner-chain terrain-conforming forest-floor ivy';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  applyGroundCoverShadowPolicy(mesh, { terrainReceivesShadow: true });

  const group = new THREE.Group();
  group.name = 'Live-tree terrain-conforming forest-floor ivy';
  group.add(mesh);

  const position = compiled.geometry.getAttribute('position') as THREE.BufferAttribute;
  const livePositions = position.array as Float32Array;
  const dirtyPlacements = new Set<number>();
  const placementMask = createForestFloorPlacementMask(
    placements,
    trees.length,
    (placementIndex, visible) => {
      const range = compiled.placementVertexRanges[placementIndex];
      if (!range) return;
      const start = range.start * 3;
      const end = (range.start + range.count) * 3;
      if (visible) {
        livePositions.set(compiled.originalPositions.subarray(start, end), start);
      } else {
        for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
          livePositions[vertex * 3 + 1] = FOREST_FLOOR_IVY_HIDDEN_Y;
        }
      }
      dirtyPlacements.add(placementIndex);
    },
  );

  return {
    group,
    mesh,
    placements,
    placementVertexRanges: compiled.placementVertexRanges,
    placementVertexRangesByTree: compiled.placementVertexRangesByTree,
    placementIndicesByTree: placementMask.placementIndicesByTree,
    textures,
    stats: {
      instances: placements.length,
      verticesPerInstance: FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
      trianglesPerInstance: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
      vertices: FOREST_FLOOR_IVY_VERTICES_PER_PATCH * placements.length,
      triangles: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH * placements.length,
      runnersPerInstance: FOREST_FLOOR_IVY_RUNNERS_PER_PATCH,
      runners: FOREST_FLOOR_IVY_RUNNERS_PER_PATCH * placements.length,
      leavesPerInstance: FOREST_FLOOR_IVY_LEAVES_PER_PATCH,
      leaves: FOREST_FLOOR_IVY_LEAVES_PER_PATCH * placements.length,
      drawCalls: placements.length > 0 ? 1 : 0,
      maximumRelief: placements.reduce(
        (maximum, placement) => Math.max(maximum, placement.reliefHeight),
        0,
      ),
      maximumCanopyHeight: placements.length > 0
        ? FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX
        : 0,
      seed,
    },
    setSnowCoverage(coverage: number): boolean {
      return setForestCardSnowCoverage(material, coverage);
    },
    setTreeActive: placementMask.setTreeActive,
    setPlacementActive: placementMask.setPlacementActive,
    refreshBlockedMask(blocker?: ForestFloorIvyBlocker): number {
      return placementMask.refreshBlockedMask((placement) => (
        ivyIntersectsBlocker(placement, blocker)
      ));
    },
    commit(): void {
      if (dirtyPlacements.size === 0) return;
      position.clearUpdateRanges();
      for (const placementIndex of dirtyPlacements) {
        const range = compiled.placementVertexRanges[placementIndex];
        if (range) position.addUpdateRange(range.start * 3, range.count * 3);
      }
      position.needsUpdate = true;
      dirtyPlacements.clear();
    },
    dispose(): void {
      compiled.geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
      group.removeFromParent();
    },
  };
}

type IvyRunnerNode = {
  x: number;
  y: number;
  z: number;
  lift: number;
  tangentX: number;
  tangentZ: number;
};

type CompiledIvyRunnerPlan = {
  runnerIndex: number;
  phase: number;
  baseWidth: number;
  nodes: IvyRunnerNode[];
};

type IvyGeometryWriteBuffers = {
  positions: Float32Array;
  uvs: Float32Array;
  tintValues: Float32Array;
  runnerValues: Uint8Array;
  rootPhaseValues: Float32Array;
  hingeValues: Float32Array;
  indices: Uint32Array;
};

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
  const runnerValues = new Uint8Array(vertexCount);
  const rootPhaseValues = new Float32Array(vertexCount * 4);
  const hingeValues = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  const buffers: IvyGeometryWriteBuffers = {
    positions,
    uvs,
    tintValues,
    runnerValues,
    rootPhaseValues,
    hingeValues,
    indices,
  };
  const placementVertexRanges: ForestFloorIvyVertexRange[] = [];
  const placementVertexRangesByTree = Array.from(
    { length: treeCount },
    () => [] as ForestFloorIvyVertexRange[],
  );
  const runnerVertexRanges: ForestFloorIvyRunnerVertexRange[] = [];
  const leafVertexRanges: ForestFloorIvyLeafVertexRange[] = [];
  const baseColor = new THREE.Color();
  const tintWhite = new THREE.Color(0xffffff);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
    const placement = placements[placementIndex]!;
    const tintRng = mulberry32(
      (seed ^ Math.imul(placementIndex + 1, 0x9e3779b1)) >>> 0,
    );
    baseColor.setHSL(
      0.292 + (tintRng() - 0.5) * 0.026,
      0.5 + tintRng() * 0.1,
      0.17 + (tintRng() - 0.5) * 0.03,
    ).lerp(tintWhite, 0.018);

    const runnerPlans = createIvyRunnerPlans(
      placement,
      placementIndex,
      terrain,
      seed,
    );
    const placementStart = vertexOffset;
    const runnerWrite = appendIvyRunners({
      placementIndex,
      runnerPlans,
      terrain,
      baseColor,
      buffers,
      vertexOffset,
      indexOffset,
      runnerVertexRanges,
    });
    vertexOffset = runnerWrite.vertexOffset;
    indexOffset = runnerWrite.indexOffset;

    const leafWrite = appendIvyRunnerLeaves({
      placement,
      placementIndex,
      runnerPlans,
      runnerVertexRanges: runnerVertexRanges.slice(
        runnerVertexRanges.length - FOREST_FLOOR_IVY_RUNNERS_PER_PATCH,
      ),
      terrain,
      seed,
      baseColor,
      buffers,
      vertexOffset,
      indexOffset,
      leafVertexRanges,
    });
    vertexOffset = leafWrite.vertexOffset;
    indexOffset = leafWrite.indexOffset;

    const placementRange = {
      start: placementStart,
      count: vertexOffset - placementStart,
    };
    placementVertexRanges.push(placementRange);
    placementVertexRangesByTree[placement.sourceTreeIndex]?.push(placementRange);
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
  geometry.setAttribute('ivyRunner', new THREE.Uint8BufferAttribute(runnerValues, 1));
  geometry.setAttribute('aIvyRootPhase', new THREE.BufferAttribute(rootPhaseValues, 4));
  geometry.setAttribute('aIvyHinge', new THREE.BufferAttribute(hingeValues, 4));
  const tint = new THREE.BufferAttribute(tintValues, 3);
  // SeedThree's WebGPU material consumes aTint; the WebGL fallback consumes
  // Three's conventional color semantic. Both share one immutable buffer.
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('color', tint);
  geometry.userData.seedThreeGenerator = 'terrain-following-ivy-runner-chain';
  geometry.userData.runnersPerPatch = FOREST_FLOOR_IVY_RUNNERS_PER_PATCH;
  geometry.userData.leavesPerRunner = FOREST_FLOOR_IVY_LEAVES_PER_RUNNER;
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
    placementVertexRanges,
    placementVertexRangesByTree,
    runnerVertexRanges,
    leafVertexRanges,
  };
}

function createIvyRunnerPlans(
  placement: ForestFloorIvyPlacement,
  placementIndex: number,
  terrain: IvyTerrainSurface,
  seed: number,
): CompiledIvyRunnerPlan[] {
  const rng = mulberry32(
    (seed ^ Math.imul(placementIndex + 1, 0x27d4eb2d)) >>> 0,
  );
  const placementCos = Math.cos(placement.yaw);
  const placementSin = Math.sin(placement.yaw);
  const placementScale = THREE.MathUtils.clamp(placement.scale, 0.82, 1.3);
  const plans: CompiledIvyRunnerPlan[] = [];

  for (
    let runnerIndex = 0;
    runnerIndex < FOREST_FLOOR_IVY_RUNNERS_PER_PATCH;
    runnerIndex++
  ) {
    const angle = runnerIndex / FOREST_FLOOR_IVY_RUNNERS_PER_PATCH
      * Math.PI * 2
      + (rng() - 0.5) * 0.34;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const sideX = -directionZ;
    const sideZ = directionX;
    const endRadius = THREE.MathUtils.lerp(0.82, 0.96, rng());
    const bend = (rng() - 0.5) * 0.34;
    const originX = (rng() - 0.5) * 0.1;
    const originZ = (rng() - 0.5) * 0.1;
    const phase = placement.reliefPhase
      + runnerIndex * 1.37
      + (rng() - 0.5) * 0.46;
    const liftScale = placement.reliefHeight
      * THREE.MathUtils.lerp(0.032, 0.048, rng());
    const nodes: IvyRunnerNode[] = [];

    for (
      let nodeIndex = 0;
      nodeIndex <= FOREST_FLOOR_IVY_RUNNER_SEGMENTS;
      nodeIndex++
    ) {
      const t = nodeIndex / FOREST_FLOOR_IVY_RUNNER_SEGMENTS;
      const reach = THREE.MathUtils.lerp(0.035, endRadius, t);
      const lateral = Math.sin(t * Math.PI) * bend;
      const normalizedX = originX * (1 - t)
        + directionX * reach
        + sideX * lateral;
      const normalizedZ = originZ * (1 - t)
        + directionZ * reach
        + sideZ * lateral;
      const localX = normalizedX * placement.radiusX;
      const localZ = normalizedZ * placement.radiusZ;
      const worldX = placement.x
        + localX * placementCos
        - localZ * placementSin;
      const worldZ = placement.z
        + localX * placementSin
        + localZ * placementCos;
      const arch = Math.sin(t * Math.PI);
      const lift = 0.0025 + arch * arch * liftScale
        * (0.78 + 0.22 * Math.sin(phase + t * Math.PI * 2));
      nodes.push({
        x: worldX,
        y: terrain.getHeightAt(worldX, worldZ)
          + FOREST_FLOOR_IVY_GROUND_CLEARANCE
          + lift,
        z: worldZ,
        lift,
        tangentX: 0,
        tangentZ: 0,
      });
    }

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const previous = nodes[Math.max(0, nodeIndex - 1)]!;
      const next = nodes[Math.min(nodes.length - 1, nodeIndex + 1)]!;
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const inverseLength = 1 / Math.max(1e-6, Math.hypot(dx, dz));
      nodes[nodeIndex]!.tangentX = dx * inverseLength;
      nodes[nodeIndex]!.tangentZ = dz * inverseLength;
    }

    plans.push({
      runnerIndex,
      phase,
      baseWidth: THREE.MathUtils.lerp(0.018, 0.027, rng()) * placementScale,
      nodes,
    });
  }

  return plans;
}

type AppendIvyRunnersArgs = {
  placementIndex: number;
  runnerPlans: readonly CompiledIvyRunnerPlan[];
  terrain: IvyTerrainSurface;
  baseColor: THREE.Color;
  buffers: IvyGeometryWriteBuffers;
  vertexOffset: number;
  indexOffset: number;
  runnerVertexRanges: ForestFloorIvyRunnerVertexRange[];
};

function appendIvyRunners(
  args: AppendIvyRunnersArgs,
): { vertexOffset: number; indexOffset: number } {
  const runnerColor = new THREE.Color();
  let vertexOffset = args.vertexOffset;
  let indexOffset = args.indexOffset;

  for (const plan of args.runnerPlans) {
    const runnerStart = vertexOffset;
    runnerColor.copy(args.baseColor)
      .offsetHSL(-0.035, -0.12, -0.025)
      .multiplyScalar(0.84);
    for (let nodeIndex = 0; nodeIndex < plan.nodes.length; nodeIndex++) {
      const node = plan.nodes[nodeIndex]!;
      const t = nodeIndex / FOREST_FLOOR_IVY_RUNNER_SEGMENTS;
      const tipTaper = smootherstep01(
        THREE.MathUtils.clamp((t - 0.68) / 0.32, 0, 1),
      );
      const width = plan.baseWidth
        * THREE.MathUtils.lerp(1, 0.18, tipTaper)
        * (0.9 + 0.1 * Math.sin(plan.phase + t * Math.PI));
      const sideX = -node.tangentZ;
      const sideZ = node.tangentX;

      for (let sideIndex = 0; sideIndex < 3; sideIndex++) {
        const across = sideIndex - 1;
        const vertexIndex = vertexOffset + nodeIndex * 3 + sideIndex;
        const worldX = node.x + sideX * across * width;
        const worldZ = node.z + sideZ * across * width;
        const positionOffset = vertexIndex * 3;
        args.buffers.positions[positionOffset] = worldX;
        args.buffers.positions[positionOffset + 1] = sideIndex === 1
          ? node.y
          : args.terrain.getHeightAt(worldX, worldZ)
            + FOREST_FLOOR_IVY_GROUND_CLEARANCE
            + node.lift;
        args.buffers.positions[positionOffset + 2] = worldZ;
        const uvOffset = vertexIndex * 2;
        args.buffers.uvs[uvOffset] = sideIndex * 0.5;
        args.buffers.uvs[uvOffset + 1] = t;
        const centerHighlight = sideIndex === 1 ? 1.12 : 0.86;
        args.buffers.tintValues[positionOffset] = runnerColor.r * centerHighlight;
        args.buffers.tintValues[positionOffset + 1] = runnerColor.g * centerHighlight;
        args.buffers.tintValues[positionOffset + 2] = runnerColor.b * centerHighlight;
        args.buffers.runnerValues[vertexIndex] = plan.runnerIndex;
      }
    }

    for (
      let segmentIndex = 0;
      segmentIndex < FOREST_FLOOR_IVY_RUNNER_SEGMENTS;
      segmentIndex++
    ) {
      const current = vertexOffset + segmentIndex * 3;
      const next = current + 3;
      args.buffers.indices[indexOffset++] = current;
      args.buffers.indices[indexOffset++] = next;
      args.buffers.indices[indexOffset++] = current + 1;
      args.buffers.indices[indexOffset++] = current + 1;
      args.buffers.indices[indexOffset++] = next;
      args.buffers.indices[indexOffset++] = next + 1;
      args.buffers.indices[indexOffset++] = current + 1;
      args.buffers.indices[indexOffset++] = next + 1;
      args.buffers.indices[indexOffset++] = current + 2;
      args.buffers.indices[indexOffset++] = current + 2;
      args.buffers.indices[indexOffset++] = next + 1;
      args.buffers.indices[indexOffset++] = next + 2;
    }

    args.runnerVertexRanges.push({
      start: runnerStart,
      count: FOREST_FLOOR_IVY_RUNNER_VERTICES,
      placementIndex: args.placementIndex,
      runnerIndex: plan.runnerIndex,
    });
    vertexOffset += FOREST_FLOOR_IVY_RUNNER_VERTICES;
  }

  return { vertexOffset, indexOffset };
}

type AppendIvyRunnerLeavesArgs = {
  placement: ForestFloorIvyPlacement;
  placementIndex: number;
  runnerPlans: readonly CompiledIvyRunnerPlan[];
  runnerVertexRanges: readonly ForestFloorIvyRunnerVertexRange[];
  terrain: IvyTerrainSurface;
  seed: number;
  baseColor: THREE.Color;
  buffers: IvyGeometryWriteBuffers;
  vertexOffset: number;
  indexOffset: number;
  leafVertexRanges: ForestFloorIvyLeafVertexRange[];
};

function appendIvyRunnerLeaves(
  args: AppendIvyRunnerLeavesArgs,
): { vertexOffset: number; indexOffset: number } {
  const rng = mulberry32(
    (args.seed ^ Math.imul(args.placementIndex + 1, 0x165667b1)) >>> 0,
  );
  const centerLocalIndex = FOREST_FLOOR_IVY_LEAF_VERTICES - 1;
  const leafColor = new THREE.Color();
  const placementScale = THREE.MathUtils.clamp(args.placement.scale, 0.82, 1.25);
  let vertexOffset = args.vertexOffset;
  let indexOffset = args.indexOffset;

  for (const plan of args.runnerPlans) {
    const runnerRange = args.runnerVertexRanges[plan.runnerIndex]!;
    for (
      let nodeIndex = 1;
      nodeIndex <= FOREST_FLOOR_IVY_LEAVES_PER_RUNNER;
      nodeIndex++
    ) {
      const node = plan.nodes[nodeIndex]!;
      const leafIndex = plan.runnerIndex * FOREST_FLOOR_IVY_LEAVES_PER_RUNNER
        + nodeIndex - 1;
      const sideSign = (plan.runnerIndex + nodeIndex) % 2 === 0 ? -1 : 1;
      const terminal = nodeIndex === FOREST_FLOOR_IVY_RUNNER_SEGMENTS;
      const tangentYaw = Math.atan2(node.tangentZ, node.tangentX);
      const sideAngle = terminal
        ? (rng() - 0.5) * 0.42
        : sideSign * THREE.MathUtils.lerp(0.74, 1.08, rng())
          + (rng() - 0.5) * 0.18;
      const forwardYaw = tangentYaw + sideAngle;
      const forwardX = Math.cos(forwardYaw);
      const forwardZ = Math.sin(forwardYaw);
      const hingeX = -forwardZ;
      const hingeZ = forwardX;
      const progress = nodeIndex / FOREST_FLOOR_IVY_LEAVES_PER_RUNNER;
      const length = THREE.MathUtils.lerp(0.195, 0.305, rng())
        * THREE.MathUtils.lerp(0.92, 1.08, progress)
        * placementScale;
      const width = length * THREE.MathUtils.lerp(0.78, 0.94, rng());
      const tilt = THREE.MathUtils.degToRad(
        THREE.MathUtils.lerp(3.5, terminal ? 11 : 8.5, rng()),
      );
      const forwardHorizontal = Math.cos(tilt);
      const forwardVertical = Math.sin(tilt);
      const camber = length * THREE.MathUtils.lerp(0.035, 0.065, rng());
      const twist = length * (rng() - 0.5) * 0.045;
      const hingeAmplitude = THREE.MathUtils.lerp(0.064, 0.108, rng());
      const phase = plan.phase + nodeIndex * 0.79 + (rng() - 0.5) * 0.54;
      leafColor.copy(args.baseColor)
        .offsetHSL(
          (rng() - 0.5) * 0.024,
          (rng() - 0.5) * 0.08,
          (rng() - 0.5) * 0.045,
        )
        .multiplyScalar(THREE.MathUtils.lerp(0.9, 1.06, rng()));

      const leafStart = vertexOffset;
      for (
        let localIndex = 0;
        localIndex < FOREST_FLOOR_IVY_LEAF_VERTICES;
        localIndex++
      ) {
        const [localWidth, localForward] = localIndex < FOREST_FLOOR_IVY_LEAF_BOUNDARY.length
          ? FOREST_FLOOR_IVY_LEAF_BOUNDARY[localIndex]!
          : [0, 0.48] as const;
        const along = localForward * length;
        const across = localWidth * width;
        const worldX = node.x
          + forwardX * along * forwardHorizontal
          + hingeX * across;
        const worldZ = node.z
          + forwardZ * along * forwardHorizontal
          + hingeZ * across;
        const edgeDistance = Math.min(1, Math.abs(localWidth) / 0.58);
        const foldLift = Math.sin(localForward * Math.PI)
          * camber
          * (1 - edgeDistance * 0.48);
        const twistLift = localWidth * localForward * twist;
        const vertexIndex = vertexOffset + localIndex;
        const positionOffset = vertexIndex * 3;
        args.buffers.positions[positionOffset] = worldX;
        args.buffers.positions[positionOffset + 1] = localIndex === 0
          ? node.y
          : args.terrain.getHeightAt(worldX, worldZ)
            + FOREST_FLOOR_IVY_GROUND_CLEARANCE
            + node.lift * (1 - localForward * 0.45)
            + along * forwardVertical
            + foldLift
            + twistLift;
        args.buffers.positions[positionOffset + 2] = worldZ;
        const uvOffset = vertexIndex * 2;
        args.buffers.uvs[uvOffset] = 0.5 + localWidth * 0.82;
        args.buffers.uvs[uvOffset + 1] = localForward;
        const brightness = localIndex === centerLocalIndex
          ? 1.08
          : localIndex === 0
            ? 0.68
            : 0.84 + localForward * 0.13 + (1 - edgeDistance) * 0.035;
        args.buffers.tintValues[positionOffset] = leafColor.r * brightness;
        args.buffers.tintValues[positionOffset + 1] = leafColor.g * brightness;
        args.buffers.tintValues[positionOffset + 2] = leafColor.b * brightness;
        args.buffers.runnerValues[vertexIndex] = plan.runnerIndex;
        const motionOffset = vertexIndex * 4;
        args.buffers.rootPhaseValues[motionOffset] = node.x;
        args.buffers.rootPhaseValues[motionOffset + 1] = node.y;
        args.buffers.rootPhaseValues[motionOffset + 2] = node.z;
        args.buffers.rootPhaseValues[motionOffset + 3] = phase;
        args.buffers.hingeValues[motionOffset] = hingeX;
        args.buffers.hingeValues[motionOffset + 1] = 0;
        args.buffers.hingeValues[motionOffset + 2] = hingeZ;
        args.buffers.hingeValues[motionOffset + 3] = hingeAmplitude;
      }

      for (
        let boundaryIndex = 0;
        boundaryIndex < FOREST_FLOOR_IVY_LEAF_BOUNDARY.length;
        boundaryIndex++
      ) {
        args.buffers.indices[indexOffset++] = leafStart + centerLocalIndex;
        args.buffers.indices[indexOffset++] = leafStart + boundaryIndex;
        args.buffers.indices[indexOffset++] = leafStart
          + (boundaryIndex + 1) % FOREST_FLOOR_IVY_LEAF_BOUNDARY.length;
      }

      const runnerRootVertex = runnerRange.start + nodeIndex * 3 + 1;
      args.leafVertexRanges.push({
        start: leafStart,
        count: FOREST_FLOOR_IVY_LEAF_VERTICES,
        placementIndex: args.placementIndex,
        leafIndex,
        runnerIndex: plan.runnerIndex,
        runnerNodeIndex: nodeIndex,
        runnerRootVertex,
        rootVertex: leafStart,
        tipVertex: leafStart + 8,
      });
      vertexOffset += FOREST_FLOOR_IVY_LEAF_VERTICES;
    }
  }

  return { vertexOffset, indexOffset };
}

export function createForestFloorIvyPlacements(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: ForestFloorIvyBlocker,
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
      const localForestBlend = sampleForestBlend(terrain, x, z);
      if (localForestBlend < FOREST_FLOOR_IVY_MIN_BLEND * 0.72) continue;

      const scale = THREE.MathUtils.lerp(0.92, 1.42, rng())
        * THREE.MathUtils.lerp(0.9, 1.14, localForestBlend);
      const placement: ForestFloorIvyPlacement = {
        x,
        z,
        sourceTreeIndex: treeIndex,
        scale,
        yaw: rng() * Math.PI * 2,
        // Broad elliptical reach gives the runner fan room to crawl beneath
        // the canopy. This remains ground coverage, not a freestanding bush.
        radiusX: scale * THREE.MathUtils.lerp(2.25, 2.75, rng()),
        radiusZ: scale * THREE.MathUtils.lerp(1.34, 1.66, rng()),
        reliefHeight: THREE.MathUtils.lerp(
          FOREST_FLOOR_IVY_RELIEF_MIN,
          FOREST_FLOOR_IVY_RELIEF_MAX,
          rng(),
        ),
        reliefPhase: rng() * Math.PI * 2,
      };
      if (ivyIntersectsBlocker(placement, isBlockedAt)) continue;
      placements.push(placement);
    }
  }

  return placements;
}

function ivyIntersectsBlocker(
  placement: ForestFloorIvyPlacement,
  isBlockedAt?: ForestFloorIvyBlocker,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(placement.x, placement.z)) return true;
  const cosYaw = Math.cos(placement.yaw);
  const sinYaw = Math.sin(placement.yaw);
  const rings = [
    { radius: 0.32, samples: 8 },
    { radius: 0.64, samples: 12 },
    { radius: 0.96, samples: 16 },
  ] as const;
  for (const ring of rings) {
    for (let sampleIndex = 0; sampleIndex < ring.samples; sampleIndex++) {
      const angle = sampleIndex / ring.samples * Math.PI * 2;
      const localX = Math.cos(angle) * placement.radiusX * ring.radius;
      const localZ = Math.sin(angle) * placement.radiusZ * ring.radius;
      if (isBlockedAt(
        placement.x + localX * cosYaw - localZ * sinYaw,
        placement.z + localX * sinYaw + localZ * cosYaw,
      )) {
        return true;
      }
    }
  }
  return false;
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
