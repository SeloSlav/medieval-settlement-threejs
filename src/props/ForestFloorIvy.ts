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
  uv,
  vec2,
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
  loadSeedThreeGroundCoverTextures,
  type SeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import {
  applyIvyLeafHingeWebGLWind,
  createIvyLeafHingeWindNodes,
} from '../vegetation/seedthree/seedThreeFoliageWind.ts';

export const FOREST_FLOOR_IVY_TEXTURE_PATH =
  '/assets/textures/vegetation/forest-floor-ivy-leaf-atlas-v2.png';
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
  w: IvySnowNode;
  xy: IvySnowNode;
  zw: IvySnowNode;
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
  texture: texture as (source: THREE.Texture, uvNode?: unknown) => IvySnowNode,
  uniform: uniform as (value: number) => IvySnowUniformNode,
  uv: uv as () => IvySnowNode,
  vec2: vec2 as (x: unknown, y?: unknown) => IvySnowNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => IvySnowNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => IvySnowNode,
};

const FOREST_FLOOR_IVY_SNOW_WEBGL_CACHE_KEY =
  'seedthree-forest-floor-ivy-snow-v1';
const FOREST_FLOOR_IVY_ATLAS_WEBGL_CACHE_KEY =
  'seedthree-forest-floor-ivy-atlas-v2';
const FOREST_FLOOR_IVY_SNOW_WEBGL_VERTEX_DECLARATIONS = `
varying float vForestFloorIvySnowExposure;
varying vec2 vForestFloorIvySnowWorldXZ;
`;
const FOREST_FLOOR_IVY_SNOW_WEBGL_FRAGMENT_DECLARATIONS = `
uniform float uForestFloorIvySnowCoverage;
varying float vForestFloorIvySnowExposure;
varying vec2 vForestFloorIvySnowWorldXZ;
`;

export const FOREST_FLOOR_IVY_ATLAS_SIZE = 1254;
/** Alpha-trimmed pixel bounds for the generated 600px-class leaf variants. */
export const FOREST_FLOOR_IVY_ATLAS_LEAVES = [
  { minX: 24, minY: 17, maxX: 616, maxY: 627 },
  { minX: 690, minY: 43, maxX: 1229, maxY: 579 },
  { minX: 26, minY: 627, maxX: 609, maxY: 1210 },
  { minX: 675, minY: 641, maxX: 1237, maxY: 1210 },
] as const;

export type ForestFloorIvyLayerKind = 'ground' | 'lower' | 'upper' | 'crown';

export type ForestFloorIvyLayerSpec = {
  kind: ForestFloorIvyLayerKind;
  tier: 0 | 1 | 2 | 3;
  leafCount: number;
  runnerCount: number;
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
};

/**
 * Seven unrendered density envelopes retain the broad/lower/upper/crown
 * composition. Surface-following runners own every rendered leaf root; there
 * are no carrier sheets and no detached overlay leaves.
 */
export const FOREST_FLOOR_IVY_LAYER_SPECS = [
  {
    kind: 'ground',
    tier: 0,
    leafCount: 76,
    runnerCount: 8,
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
  },
  {
    kind: 'lower',
    tier: 1,
    leafCount: 27,
    runnerCount: 3,
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
  },
  {
    kind: 'lower',
    tier: 1,
    leafCount: 22,
    runnerCount: 3,
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
  },
  {
    kind: 'upper',
    tier: 2,
    leafCount: 13,
    runnerCount: 2,
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
  },
  {
    kind: 'upper',
    tier: 2,
    leafCount: 10,
    runnerCount: 2,
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
  },
  {
    kind: 'crown',
    tier: 3,
    leafCount: 7,
    runnerCount: 1,
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
  },
  {
    kind: 'crown',
    tier: 3,
    leafCount: 5,
    runnerCount: 1,
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
  },
] as const satisfies readonly ForestFloorIvyLayerSpec[];

export const FOREST_FLOOR_IVY_LAYER_COUNT = FOREST_FLOOR_IVY_LAYER_SPECS.length;
export const FOREST_FLOOR_IVY_LEAVES_PER_PATCH = FOREST_FLOOR_IVY_LAYER_SPECS
  .reduce((total, layer) => total + layer.leafCount, 0);
export const FOREST_FLOOR_IVY_LEAF_VERTICES = 9;
export const FOREST_FLOOR_IVY_LEAF_TRIANGLES = 8;
export const FOREST_FLOOR_IVY_LEAF_ROOT_VERTEX = 1;
export const FOREST_FLOOR_IVY_LEAF_TIP_VERTEX = 7;
export const FOREST_FLOOR_IVY_VERTICES_PER_PATCH =
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_VERTICES;
export const FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH =
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH * FOREST_FLOOR_IVY_LEAF_TRIANGLES;
export const FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT = 0.07;

/** The perimeter almost touches the litter; only a small depth-safe lift remains. */
export const FOREST_FLOOR_IVY_GROUND_CLEARANCE = 0.014;
export const FOREST_FLOOR_IVY_RELIEF_MIN = 0.12;
export const FOREST_FLOOR_IVY_RELIEF_MAX = 0.22;
/** Absolute ground-to-crown guardrail, including every supporting shelf. */
export const FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX = 0.48;

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

export type ForestFloorIvyInstanceRange = {
  start: number;
  count: number;
};

export type ForestFloorIvyLayerInstanceRange = ForestFloorIvyInstanceRange & {
  placementIndex: number;
  layerIndex: number;
  kind: ForestFloorIvyLayerKind;
  tier: 0 | 1 | 2 | 3;
};

export type ForestFloorIvyStats = {
  instances: number;
  verticesPerInstance: number;
  trianglesPerInstance: number;
  vertices: number;
  triangles: number;
  layersPerInstance: number;
  layers: number;
  leavesPerInstance: number;
  leaves: number;
  leafPrototypeVertices: number;
  leafPrototypeTriangles: number;
  drawCalls: number;
  maximumRelief: number;
  maximumCanopyHeight: number;
  seed: number;
};

export type CompiledForestFloorIvyGeometry = {
  geometry: THREE.BufferGeometry;
  instanceCount: number;
  instanceMatrices: Float32Array;
  placementInstanceRanges: ForestFloorIvyInstanceRange[];
  placementInstanceRangesByTree: ForestFloorIvyInstanceRange[][];
  layerInstanceRanges: ForestFloorIvyLayerInstanceRange[];
};

export type ForestFloorIvyInstances = {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  placements: ForestFloorIvyPlacement[];
  placementInstanceRanges: ForestFloorIvyInstanceRange[];
  placementInstanceRangesByTree: ForestFloorIvyInstanceRange[][];
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
  const atlasRect = ivySnowTsl.attribute('aIvyAtlasRect', 'vec4');
  const leafUv = ivySnowTsl.uv();
  const atlasUv = ivySnowTsl.vec2(
    atlasRect.x.add(leafUv.x.mul(atlasRect.z)),
    atlasRect.y.add(leafUv.y.mul(atlasRect.w)),
  );
  const albedo = ivySnowTsl.texture(textures.albedo, atlasUv);
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

  // Preserve the authored alpha cutout and immutable aTint coloration while
  // changing only the visible leaf surface. Snow also mutes the same SSS path
  // used by SeedThree evergreen cards so covered leaves do not glow green.
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
      // transformedNormal already includes the local hinge, instance basis,
      // model normal matrix, and every non-uniform leaf scale.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
vec3 forestFloorIvySnowWorldNormal = normalize(
  inverseTransformDirection( transformedNormal, viewMatrix )
);
vForestFloorIvySnowExposure = smoothstep(
  ${FOREST_FLOOR_IVY_SNOW_EXPOSURE_MIN.toFixed(2)},
  ${FOREST_FLOOR_IVY_SNOW_EXPOSURE_MAX.toFixed(2)},
  forestFloorIvySnowWorldNormal.y
);`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 forestFloorIvyObjectPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
forestFloorIvyObjectPosition = instanceMatrix * forestFloorIvyObjectPosition;
#endif
vForestFloorIvySnowWorldXZ = ( modelMatrix * forestFloorIvyObjectPosition ).xz;
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

function applyForestFloorIvyWebGLAtlas(material: THREE.Material): void {
  chainMaterialShaderPatch(
    material,
    FOREST_FLOOR_IVY_ATLAS_WEBGL_CACHE_KEY,
    (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aIvyAtlasRect;',
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <map_vertex>',
        `#include <map_vertex>
#ifdef USE_MAP
vMapUv = aIvyAtlasRect.xy + vMapUv * aIvyAtlasRect.zw;
#endif`,
      );
    },
  );
  material.needsUpdate = true;
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
  material.alphaTest = 0.31;
  if (supportsNodeMaterials(rendererBackend)) {
    applyForestFloorIvyNodeSnow(material, textures);
    // The same rigid petiole rotation drives lighting as well as position;
    // otherwise close leaves visibly brighten/darken against a static normal.
    (material as THREE.Material & { normalNode: unknown }).normalNode =
      hingeWind.normalNode;
  } else {
    applyIvyLeafHingeWebGLWind(material);
    applyForestFloorIvyWebGLAtlas(material);
    applyForestFloorIvyWebGLSnow(material);
  }
  return material;
}

/**
 * Every visible element is now a real ivy leaf rooted to a deterministic,
 * surface-following runner. The former colony sheets and eighteen detached
 * overlays do not render. Seven density envelopes preserve their broad, paired
 * lower/upper, and crown composition while one InstancedMesh keeps world-scale
 * memory bounded and gives every leaf its own SeedThree petiole hinge.
 */
export async function createForestFloorIvyInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: ForestFloorIvyBlocker,
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

  const mesh = createForestFloorIvyMesh(compiled, material);
  mesh.name = 'SeedThree rooted instanced forest-floor ivy leaves';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  applyGroundCoverShadowPolicy(mesh, { terrainReceivesShadow: true });

  const group = new THREE.Group();
  group.name = 'Live-tree terrain-conforming forest-floor ivy';
  group.add(mesh);

  const visibility = compiled.geometry.getAttribute(
    'aIvyVisibility',
  ) as THREE.InstancedBufferAttribute;
  const liveVisibility = visibility.array as Float32Array;
  const dirtyPlacements = new Set<number>();
  const placementMask = createForestFloorPlacementMask(
    placements,
    trees.length,
    (placementIndex, visible) => {
      const range = compiled.placementInstanceRanges[placementIndex];
      if (!range) return;
      liveVisibility.fill(visible ? 1 : 0, range.start, range.start + range.count);
      dirtyPlacements.add(placementIndex);
    },
  );

  return {
    group,
    mesh,
    placements,
    placementInstanceRanges: compiled.placementInstanceRanges,
    placementInstanceRangesByTree: compiled.placementInstanceRangesByTree,
    placementIndicesByTree: placementMask.placementIndicesByTree,
    textures,
    stats: {
      instances: placements.length,
      verticesPerInstance: FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
      trianglesPerInstance: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
      vertices: FOREST_FLOOR_IVY_VERTICES_PER_PATCH * placements.length,
      triangles: FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH * placements.length,
      layersPerInstance: FOREST_FLOOR_IVY_LAYER_COUNT,
      layers: FOREST_FLOOR_IVY_LAYER_COUNT * placements.length,
      leavesPerInstance: FOREST_FLOOR_IVY_LEAVES_PER_PATCH,
      leaves: FOREST_FLOOR_IVY_LEAVES_PER_PATCH * placements.length,
      leafPrototypeVertices: FOREST_FLOOR_IVY_LEAF_VERTICES,
      leafPrototypeTriangles: FOREST_FLOOR_IVY_LEAF_TRIANGLES,
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
      visibility.clearUpdateRanges();
      for (const placementIndex of dirtyPlacements) {
        const range = compiled.placementInstanceRanges[placementIndex];
        if (range) visibility.addUpdateRange(range.start, range.count);
      }
      visibility.needsUpdate = true;
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

export function createTerrainConformingIvyGeometry(
  placements: readonly ForestFloorIvyPlacement[],
  terrain: IvyTerrainSurface,
  treeCount: number,
  seed = FOREST_FLOOR_IVY_SEED,
): CompiledForestFloorIvyGeometry {
  const instanceCount = placements.length * FOREST_FLOOR_IVY_LEAVES_PER_PATCH;
  const instanceMatrices = new Float32Array(instanceCount * 16);
  const tintValues = new Uint8Array(instanceCount * 3);
  const layerValues = new Uint8Array(instanceCount);
  const runnerValues = new Uint8Array(instanceCount);
  const rootPhaseValues = new Float32Array(instanceCount * 4);
  const hingeValues = new Float32Array(instanceCount * 4);
  const visibilityValues = new Float32Array(instanceCount);
  const atlasRectValues = new Float32Array(instanceCount * 4);
  visibilityValues.fill(1);
  const placementInstanceRanges: ForestFloorIvyInstanceRange[] = [];
  const placementInstanceRangesByTree = Array.from(
    { length: treeCount },
    () => [] as ForestFloorIvyInstanceRange[],
  );
  const layerInstanceRanges: ForestFloorIvyLayerInstanceRange[] = [];
  const color = new THREE.Color();
  const tintWhite = new THREE.Color(0xffffff);
  let instanceOffset = 0;

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

    const placementStart = instanceOffset;
    for (let layerIndex = 0; layerIndex < layerPlans.length; layerIndex++) {
      const layer = layerPlans[layerIndex]!;
      const layerStart = instanceOffset;
      instanceOffset = appendIvyLayerLeaves({
        placement,
        placementIndex,
        layerIndex,
        layerPlans,
        terrain,
        seed,
        baseColor: color,
        instanceMatrices,
        tintValues,
        layerValues,
        runnerValues,
        rootPhaseValues,
        hingeValues,
        atlasRectValues,
        instanceOffset,
      });
      layerInstanceRanges.push({
        start: layerStart,
        count: instanceOffset - layerStart,
        placementIndex,
        layerIndex,
        kind: layer.spec.kind,
        tier: layer.spec.tier,
      });
    }

    const placementRange = {
      start: placementStart,
      count: instanceOffset - placementStart,
    };
    placementInstanceRanges.push(placementRange);
    placementInstanceRangesByTree[placement.sourceTreeIndex]?.push(placementRange);
  }

  if (instanceOffset !== instanceCount) {
    throw new Error(
      `Forest-floor ivy compiler wrote ${instanceOffset}/${instanceCount} leaf instances.`,
    );
  }

  const geometry = createForestFloorIvyLeafGeometry();
  geometry.setAttribute(
    'ivyLayer',
    new THREE.InstancedBufferAttribute(layerValues, 1),
  );
  geometry.setAttribute(
    'ivyRunner',
    new THREE.InstancedBufferAttribute(runnerValues, 1),
  );
  geometry.setAttribute(
    'aIvyRootPhase',
    new THREE.InstancedBufferAttribute(rootPhaseValues, 4),
  );
  geometry.setAttribute(
    'aIvyHinge',
    new THREE.InstancedBufferAttribute(hingeValues, 4),
  );
  geometry.setAttribute(
    'aIvyVisibility',
    new THREE.InstancedBufferAttribute(visibilityValues, 1),
  );
  geometry.setAttribute(
    'aIvyAtlasRect',
    new THREE.InstancedBufferAttribute(atlasRectValues, 4),
  );
  const tint = new THREE.InstancedBufferAttribute(tintValues, 3, true);
  geometry.setAttribute('aTint', tint);
  geometry.setAttribute('color', tint);
  return {
    geometry,
    instanceCount,
    instanceMatrices,
    placementInstanceRanges,
    placementInstanceRangesByTree,
    layerInstanceRanges,
  };
}

export function createForestFloorIvyLeafGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let row = 0; row < 3; row++) {
    const leafY = row * 0.5;
    for (let column = 0; column < 3; column++) {
      const leafX = column * 0.5 - 0.5;
      const midrib = Math.sin(leafY * Math.PI) * (column === 1 ? 0.07 : 0.018);
      positions.push(leafX, leafY, midrib);
      uvs.push(column * 0.5, leafY);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      const a = row * 3 + column;
      const b = a + 1;
      const c = a + 3;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createForestFloorIvyMesh(
  compiled: CompiledForestFloorIvyGeometry,
  material: THREE.Material,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    compiled.geometry,
    material,
    compiled.instanceCount,
  );
  (mesh.instanceMatrix.array as Float32Array).set(compiled.instanceMatrices);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.boundingBox?.expandByScalar(FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT);
  if (mesh.boundingSphere) {
    mesh.boundingSphere.radius += FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT;
  }
  return mesh;
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
