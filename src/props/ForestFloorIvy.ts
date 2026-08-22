import * as THREE from 'three';
import { applyGroundCoverShadowPolicy } from '@seedthree/core/ground-cover-shadows.js';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import { mulberry32 } from '../utils/random.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';
import {
  addSeedThreeGroundCoverInstanceAttributes,
  createSeedThreeCardClumpGeometry,
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  seedThreeGroundCoverWindVector,
  type SeedThreeGroundCoverTextures,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';

export const FOREST_FLOOR_IVY_TEXTURE_PATH =
  '/assets/textures/vegetation/forest-floor-ivy-card.png';
export const FOREST_FLOOR_IVY_SEED = 0x1f1c0a7;
export const FOREST_FLOOR_IVY_MIN_BLEND = 0.24;

export type ForestFloorIvyPlacement = {
  x: number;
  z: number;
  sourceTreeIndex: number;
  scale: number;
  yaw: number;
  matrix: THREE.Matrix4;
};

export type ForestFloorIvyStats = {
  instances: number;
  trianglesPerInstance: number;
  drawCalls: number;
  seed: number;
};

export type ForestFloorIvyInstances = {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  placements: ForestFloorIvyPlacement[];
  placementIndicesByTree: number[][];
  textures: SeedThreeGroundCoverTextures;
  stats: ForestFloorIvyStats;
  setTreeActive: (treeIndex: number, active: boolean) => boolean;
  commit: () => void;
  dispose: () => void;
};

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
  const capacity = Math.max(1, placements.length);
  const geometry = createSeedThreeCardClumpGeometry({
    quads: 7,
    width: 3.15,
    // SeedThree's card tilt is measured away from vertical. These cards skim
    // the terrain instead of standing up like meadow grass.
    tiltMin: 1.12,
    tiltSpan: 0.34,
    heightMin: 1.45,
    heightSpan: 0.5,
    baseSpread: 0.65,
  });
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, capacity);
  const material = createSeedThreeGroundCoverMaterial(
    'SeedThree broad woodland ivy mats',
    textures,
    rendererBackend ?? 'webgl',
    [0.12, 0.22, 0.1],
    0.025,
  );
  material.alphaTest = 0.3;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'SeedThree broad low forest-floor ivy';
  mesh.count = placements.length;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  applyGroundCoverShadowPolicy(mesh, { terrainReceivesShadow: true });

  const placementIndicesByTree = trees.map(() => [] as number[]);
  const treeActive = trees.map(() => true);
  const color = new THREE.Color();
  const windScale = new THREE.Vector3();
  for (let index = 0; index < placements.length; index++) {
    const placement = placements[index]!;
    mesh.setMatrixAt(index, placement.matrix);
    placementIndicesByTree[placement.sourceTreeIndex]?.push(index);

    const tintSeed = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const hue = 0.285 + (tintSeed() - 0.5) * 0.024;
    const saturation = 0.32 + tintSeed() * 0.08;
    const lightness = 0.38 + (tintSeed() - 0.5) * 0.06;
    color.setHSL(hue, saturation, lightness).lerp(new THREE.Color(0xffffff), 0.34);
    attributes.tint.setXYZ(index, color.r, color.g, color.b);

    const rootY = terrain.getHeightAt(placement.x, placement.z) + 0.055;
    attributes.anchor.setXYZ(index, placement.x, rootY, placement.z);
    placement.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), windScale);
    const wind = seedThreeGroundCoverWindVector(placement.yaw, windScale);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
  }
  mesh.instanceMatrix.needsUpdate = true;
  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Live-tree forest-floor ivy coverage';
  group.add(mesh);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let matrixDirty = false;

  return {
    group,
    mesh,
    placements,
    placementIndicesByTree,
    textures,
    stats: {
      instances: placements.length,
      trianglesPerInstance: geometry.index
        ? geometry.index.count / 3
        : geometry.getAttribute('position').count / 3,
      drawCalls: placements.length > 0 ? 1 : 0,
      seed,
    },
    setTreeActive(treeIndex: number, active: boolean): boolean {
      if (treeActive[treeIndex] === active) return false;
      treeActive[treeIndex] = active;
      for (const placementIndex of placementIndicesByTree[treeIndex] ?? []) {
        mesh.setMatrixAt(
          placementIndex,
          active ? placements[placementIndex]!.matrix : hiddenMatrix,
        );
      }
      matrixDirty = true;
      return true;
    },
    commit(): void {
      if (!matrixDirty) return;
      mesh.instanceMatrix.needsUpdate = true;
      matrixDirty = false;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
      group.removeFromParent();
    },
  };
}

export function createForestFloorIvyPlacements(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  seed = FOREST_FLOOR_IVY_SEED,
  isBlockedAt?: (x: number, z: number) => boolean,
): ForestFloorIvyPlacement[] {
  const placements: ForestFloorIvyPlacement[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

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
      const radial = THREE.MathUtils.lerp(0.55, canopyRadius * 0.72 + 0.9, Math.sqrt(rng()));
      const x = tree.x + Math.cos(angle) * radial;
      const z = tree.z + Math.sin(angle) * radial;
      if (isBlockedAt?.(x, z)) continue;
      const localForestBlend = sampleForestBlend(terrain, x, z);
      if (localForestBlend < FOREST_FLOOR_IVY_MIN_BLEND * 0.72) continue;

      const yaw = rng() * Math.PI * 2;
      const authoredScale = THREE.MathUtils.lerp(0.92, 1.42, rng())
        * THREE.MathUtils.lerp(0.9, 1.14, localForestBlend);
      const y = terrain.getHeightAt(x, z) + 0.055;
      position.set(x, y, z);
      quaternion.setFromAxisAngle(yAxis, yaw);
      // Broad xz footprint with restrained vertical relief: forest cover,
      // never a rounded shrub or a second grass layer.
      scale.set(
        authoredScale * THREE.MathUtils.lerp(1, 1.24, rng()),
        authoredScale * THREE.MathUtils.lerp(0.46, 0.62, rng()),
        authoredScale * THREE.MathUtils.lerp(0.94, 1.18, rng()),
      );
      matrix.compose(position, quaternion, scale);
      placements.push({
        x,
        z,
        sourceTreeIndex: treeIndex,
        scale: authoredScale,
        yaw,
        matrix: matrix.clone(),
      });
    }
  }

  return placements;
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
