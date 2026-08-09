import * as THREE from 'three';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import {
  CATTAIL_CARD_REFERENCE_HEIGHT,
  CATTAIL_TEXTURE_FILES,
  createCattailGeometry,
  sampleCattailHeightMeters,
} from '@seedthree/core/cattails.js';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  addSeedThreeGroundCoverInstanceAttributes,
  createSeedThreeGroundCoverMaterial,
  disposeSeedThreeGroundCoverTextures,
  loadSeedThreeGroundCoverTextures,
  seedThreeGroundCoverWindVector,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import { seedThreeLeafUrl } from '../vegetation/seedthree/seedThreeTextures.ts';
import type { RiverField } from './RiverField.ts';
import { getStillWaterSurfaceY } from './RiverWaterLevel.ts';

type ReedPlacement = {
  x: number;
  z: number;
  heightMeters: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  hue: number;
  sat: number;
  light: number;
};

type ShoreNode = {
  x: number;
  z: number;
  outwardX: number;
  outwardZ: number;
};

export type RiverReedField = {
  group: THREE.Group;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
  dispose: () => void;
};

const composeMatrix = new THREE.Matrix4();
const composeQuaternion = new THREE.Quaternion();
const composePosition = new THREE.Vector3();
const composeScale = new THREE.Vector3();
const composeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const composeColor = new THREE.Color();
/** Caps peak reed opacity so shoreline tufts stay muted against meadow grass. */
const REED_PEAK_OPACITY = 0.9;
const REED_SHORE_MIN = 0.55;
const REED_SHORE_MAX = 4.8;

export async function createRiverReeds(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
): Promise<RiverReedField> {
  const placements = createReedPlacements(terrain, riverField, rng);
  const textures = await loadSeedThreeGroundCoverTextures({
    albedo: seedThreeLeafUrl(CATTAIL_TEXTURE_FILES.albedo)
      ?? '/assets/textures/vegetation/cattail_reed_card.png',
    normal: seedThreeLeafUrl(CATTAIL_TEXTURE_FILES.normal),
    roughness: seedThreeLeafUrl(CATTAIL_TEXTURE_FILES.roughness),
    translucency: seedThreeLeafUrl(CATTAIL_TEXTURE_FILES.translucency),
  }, maxAnisotropy);
  const geometry = createCattailGeometry();
  const material = createSeedThreeGroundCoverMaterial(
    'SeedThree cattail reeds',
    textures,
    rendererBackend,
    [0.28, 0.42, 0.13],
    0.22,
  );
  material.transparent = true;
  material.opacity = REED_PEAK_OPACITY;
  material.alphaTest = 0.32;
  material.depthWrite = false;
  const capacity = Math.max(placements.length, 1);
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, capacity);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'SeedThree river cattail cards';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.visible = placements.length > 0;
  mesh.count = placements.length;

  const fullScale = new THREE.Vector3();
  const wind = new THREE.Vector3();
  placements.forEach((placement, index) => {
    composeColor.setHSL(placement.hue, placement.sat, placement.light);
    composeColor.lerp(new THREE.Color(0xffffff), 0.55);
    attributes.tint.setXYZ(index, composeColor.r, composeColor.g, composeColor.b);
    attributes.anchor.setXYZ(
      index,
      placement.x,
      resolveReedBaseY(placement, terrain),
      placement.z,
    );
    resolveReedScaleVector(placement, fullScale);
    seedThreeGroundCoverWindVector(placement.yaw, fullScale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    mesh.setColorAt(index, composeColor);
    composeReedMatrix(
      placement,
      terrain,
      riverField,
      composeMatrix,
      composeQuaternion,
      composePosition,
      composeScale,
      composeEuler,
    );
    mesh.setMatrixAt(index, composeMatrix);
  });

  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'River reeds';
  group.renderOrder = 12;
  group.add(mesh);

  return {
    group,
    updateCameraState: () => {},
    dispose: () => {
      geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
    },
  };
}

function createReedPlacements(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
): ReedPlacement[] {
  const placements: ReedPlacement[] = [];
  const placementIndex = new SpatialHash2D<ReedPlacement>(0.6);
  const shoreNodes = collectShoreNodes(riverField);

  for (const node of shoreNodes) {
    if (rng() > 0.82) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const clusterCount = 2 + Math.floor(rng() * 4);

    for (let i = 0; i < clusterCount; i++) {
      const along = (rng() - 0.5) * 2.4;
      const outward = 0.15 + rng() * 1.35;
      const px = node.x + tangentX * along + node.outwardX * outward;
      const pz = node.z + tangentZ * along + node.outwardZ * outward;

      if (riverField.isRenderedWetAt(px, pz)) continue;
      if (!riverField.isGrassBlockedAt(px, pz)) continue;
      if (placementIndex.hasPointWithin(px, pz, 0.34 + rng() * 0.22)) continue;

      const shore = riverField.sampleShoreDistance(px, pz);
      const placement = {
        x: px,
        z: pz,
        heightMeters: resolveReedHeightMeters(shore, rng),
        yaw: rng() * Math.PI * 2,
        tiltX: (rng() - 0.5) * 0.14,
        tiltZ: (rng() - 0.5) * 0.12,
        hue: 0.24 + (rng() - 0.5) * 0.03,
        sat: 0.34 + rng() * 0.1,
        light: 0.3 + rng() * 0.07,
      };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }

  appendGridReedPlacements(riverField, rng, placements, placementIndex);
  appendShallowReedFingers(terrain, riverField, rng, shoreNodes, placements, placementIndex);
  return placements;
}

function appendGridReedPlacements(
  riverField: RiverField,
  rng: () => number,
  placements: ReedPlacement[],
  placementIndex: SpatialHash2D<ReedPlacement>,
): void {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    for (let gridX = 0; gridX < resolution; gridX++) {
      const i = gridZ * resolution + gridX;
      if (riverField.riverMask[i] >= 0.48) continue;

      const shore = riverField.shoreDistance[i];
      if (shore < 0.55 || shore > 4.8) continue;

      const wx = startX + gridX * stepX;
      const wz = startZ + gridZ * stepZ;
      const x = wx + (rng() - 0.5) * stepX * 0.62;
      const z = wz + (rng() - 0.5) * stepZ * 0.62;
      if (riverField.isRenderedWetAt(x, z)) continue;
      if (!riverField.isGrassBlockedAt(x, z)) continue;

      const chance = THREE.MathUtils.clamp(0.42 + (1 - shore / 4.8) * 0.38, 0.2, 0.9);
      if (rng() > chance) continue;
      if (placementIndex.hasPointWithin(x, z, 0.38 + rng() * 0.24)) continue;

      const placement = {
        x,
        z,
        heightMeters: resolveReedHeightMeters(shore, rng),
        yaw: rng() * Math.PI * 2,
        tiltX: (rng() - 0.5) * 0.12,
        tiltZ: (rng() - 0.5) * 0.1,
        hue: 0.24 + (rng() - 0.5) * 0.03,
        sat: 0.34 + rng() * 0.1,
        light: 0.3 + rng() * 0.07,
      };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }
}

function appendShallowReedFingers(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
  shoreNodes: ShoreNode[],
  placements: ReedPlacement[],
  placementIndex: SpatialHash2D<ReedPlacement>,
): void {
  for (const node of shoreNodes) {
    if (rng() > 0.36) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const fingerLength = 1.4 + Math.pow(rng(), 0.7) * 4.2;
    const clusterCount = 2 + Math.floor(rng() * 5);

    for (let index = 0; index < clusterCount; index++) {
      const inward = 0.32 + Math.pow(rng(), 0.72) * fingerLength;
      const spread = 0.24 + inward * 0.12;
      const along = (rng() - 0.5) * spread * 2;
      const x = node.x + tangentX * along - node.outwardX * inward;
      const z = node.z + tangentZ * along - node.outwardZ * inward;
      if (!riverField.isRenderedWetAt(x, z)) continue;

      const wetShore = riverField.sampleShoreDistance(x, z);
      if (wetShore < 0.36 || wetShore > 5.7) continue;
      if (placementIndex.hasPointWithin(x, z, 0.32 + rng() * 0.2)) continue;

      const waterDepthMeters = Math.max(
        0,
        getStillWaterSurfaceY(terrain, riverField, x, z) - terrain.getHeightAt(x, z),
      );
      const placement: ReedPlacement = {
        x,
        z,
        // These specimens are rooted on the riverbed. Add the local water
        // depth so their above-water silhouette remains as tall as a bank reed.
        heightMeters: resolveReedHeightMeters(wetShore, rng) + waterDepthMeters,
        yaw: rng() * Math.PI * 2,
        tiltX: (rng() - 0.5) * 0.12,
        tiltZ: (rng() - 0.5) * 0.1,
        hue: 0.235 + (rng() - 0.5) * 0.035,
        sat: 0.34 + rng() * 0.12,
        light: 0.28 + rng() * 0.08,
      };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }
}

function collectShoreNodes(riverField: RiverField): ShoreNode[] {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;
  const nodes: ShoreNode[] = [];

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      if (riverField.isRenderedWetAtGrid(ix, iz)) continue;

      let outwardX = 0;
      let outwardZ = 0;
      let wetNeighbors = 0;
      const neighborDirs: Array<[number, number, number, number]> = [
        [1, 0, -1, 0],
        [-1, 0, 1, 0],
        [0, 1, 0, -1],
        [0, -1, 0, 1],
      ];

      for (const [dx, dz, ox, oz] of neighborDirs) {
        if (!riverField.isRenderedWetAtGrid(ix + dx, iz + dz)) continue;
        outwardX += ox;
        outwardZ += oz;
        wetNeighbors += 1;
      }
      if (wetNeighbors === 0) continue;

      const len = Math.hypot(outwardX, outwardZ) || 1;
      nodes.push({
        x: startX + ix * stepX,
        z: startZ + iz * stepZ,
        outwardX: outwardX / len,
        outwardZ: outwardZ / len,
      });
    }
  }

  return nodes;
}

function composeReedMatrix(
  placement: ReedPlacement,
  terrain: Terrain,
  riverField: RiverField,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
): void {
  position.set(
    placement.x,
    resolveReedBaseY(placement, terrain),
    placement.z,
  );
  euler.set(placement.tiltX, placement.yaw, placement.tiltZ);
  quaternion.setFromEuler(euler);
  resolveReedScaleVector(placement, scaleVector);
  matrix.compose(position, quaternion, scaleVector);
}

function resolveReedBaseY(
  placement: ReedPlacement,
  terrain: Terrain,
): number {
  return terrain.getHeightAt(placement.x, placement.z) + 0.03;
}

function resolveReedScaleVector(
  placement: ReedPlacement,
  scaleVector: THREE.Vector3,
): THREE.Vector3 {
  const width = THREE.MathUtils.clamp(
    0.5 + placement.heightMeters * 0.14,
    0.6,
    0.94,
  );
  const height = placement.heightMeters / CATTAIL_CARD_REFERENCE_HEIGHT;
  return scaleVector.set(width, height, width);
}

/**
 * SeedThree owns the physical cattail height cohorts; the river habitat only
 * supplies normalized wet-edge proximity. This keeps the visible population
 * in real metres instead of an ambiguous ground-cover scale.
 */
function resolveReedHeightMeters(shore: number, rng: () => number): number {
  const shoreT = THREE.MathUtils.clamp((shore - REED_SHORE_MIN) / (REED_SHORE_MAX - REED_SHORE_MIN), 0, 1);
  return sampleCattailHeightMeters(1 - shoreT, rng);
}
