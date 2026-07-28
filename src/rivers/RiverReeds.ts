import * as THREE from 'three';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import {
  CATTAIL_CARD_REFERENCE_HEIGHT,
  CATTAIL_TEXTURE_FILES,
  createCattailGeometry,
  sampleCattailHeightMeters,
} from '@seedthree/core/cattails.js';
import {
  grassEdgeFadeFromFocusDistance,
  isReedLodVisible,
  reedLodOpacity,
  resolveReedLod,
} from '../grass/grassLodMath.ts';
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

const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
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
  const placements = createReedPlacements(riverField, rng);
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
  material.opacity = 0;
  material.alphaTest = 0.32;
  material.depthWrite = true;
  const capacity = Math.max(placements.length, 1);
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, capacity);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'SeedThree river cattail cards';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.visible = false;
  mesh.count = placements.length;

  const hideAllInstances = (): void => {
    for (let index = 0; index < placements.length; index++) {
      mesh.setMatrixAt(index, hiddenMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const fullScale = new THREE.Vector3();
  const wind = new THREE.Vector3();
  placements.forEach((placement, index) => {
    composeColor.setHSL(placement.hue, placement.sat, placement.light);
    composeColor.lerp(new THREE.Color(0xffffff), 0.55);
    attributes.tint.setXYZ(index, composeColor.r, composeColor.g, composeColor.b);
    attributes.anchor.setXYZ(
      index,
      placement.x,
      terrain.getHeightAt(placement.x, placement.z) + 0.03,
      placement.z,
    );
    resolveReedScaleVector(placement, fullScale);
    seedThreeGroundCoverWindVector(placement.yaw, fullScale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    mesh.setColorAt(index, composeColor);
  });

  hideAllInstances();

  mesh.instanceMatrix.needsUpdate = true;
  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'River reeds';
  group.renderOrder = 12;
  group.add(mesh);

  let lastMaterialOpacity = Number.NaN;
  let lastFocusX = Number.NaN;
  let lastFocusZ = Number.NaN;
  let wasReedVisible = false;

  const refreshProximity = (focusX: number, focusZ: number): void => {
    if (placements.length === 0) return;

    let matrixDirty = false;
    placements.forEach((placement, index) => {
      const focusDist = Math.hypot(placement.x - focusX, placement.z - focusZ);
      const edgeFade = grassEdgeFadeFromFocusDistance(focusDist);
      if (edgeFade <= 0.02) {
        mesh.setMatrixAt(index, hiddenMatrix);
        matrixDirty = true;
        return;
      }

      composeReedMatrix(
        placement,
        terrain,
        composeMatrix,
        composeQuaternion,
        composePosition,
        composeScale,
        composeEuler,
        edgeFade,
      );
      mesh.setMatrixAt(index, composeMatrix);
      matrixDirty = true;
    });

    if (matrixDirty) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    group,
    updateCameraState(
      cameraPosition: THREE.Vector3,
      cameraTarget: THREE.Vector3,
      cameraDistance: number,
      firstPersonActive = false,
    ) {
      const reedLod = resolveReedLod(cameraDistance, firstPersonActive);
      const reedOpacity = reedLodOpacity(reedLod) * REED_PEAK_OPACITY;
      const reedZoomVisible = isReedLodVisible(reedLod) && placements.length > 0;

      if (!Number.isFinite(lastMaterialOpacity) || Math.abs(reedOpacity - lastMaterialOpacity) > 0.008) {
        lastMaterialOpacity = reedOpacity;
        material.opacity = reedOpacity;
        const useTransparency = reedOpacity < 0.995;
        if (material.transparent !== useTransparency) {
          material.transparent = useTransparency;
          material.depthWrite = !useTransparency;
          material.needsUpdate = true;
        }
      }

      mesh.visible = reedZoomVisible;
      if (!reedZoomVisible) {
        wasReedVisible = false;
        lastFocusX = Number.NaN;
        lastFocusZ = Number.NaN;
        hideAllInstances();
        return;
      }

      const focusX = firstPersonActive ? cameraPosition.x : cameraTarget.x;
      const focusZ = firstPersonActive ? cameraPosition.z : cameraTarget.z;
      const becameVisible = !wasReedVisible;
      wasReedVisible = true;

      const focusMoved =
        becameVisible ||
        !Number.isFinite(lastFocusX) ||
        Math.hypot(focusX - lastFocusX, focusZ - lastFocusZ) >=
          (firstPersonActive ? 3.25 : 1.25);

      if (focusMoved) {
        refreshProximity(focusX, focusZ);
        lastFocusX = focusX;
        lastFocusZ = focusZ;
      }
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      disposeSeedThreeGroundCoverTextures(textures);
    },
  };
}

function createReedPlacements(riverField: RiverField, rng: () => number): ReedPlacement[] {
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
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
  edgeFade = 1,
): void {
  const y = terrain.getHeightAt(placement.x, placement.z);
  position.set(placement.x, y + 0.03, placement.z);
  euler.set(placement.tiltX, placement.yaw, placement.tiltZ);
  quaternion.setFromEuler(euler);
  const fade = THREE.MathUtils.clamp(edgeFade, 0, 1);
  resolveReedScaleVector(placement, scaleVector, fade);
  matrix.compose(position, quaternion, scaleVector);
}

function resolveReedScaleVector(
  placement: ReedPlacement,
  scaleVector: THREE.Vector3,
  fade = 1,
): THREE.Vector3 {
  const width = THREE.MathUtils.clamp(
    0.5 + placement.heightMeters * 0.14,
    0.6,
    0.94,
  ) * fade;
  const height = (placement.heightMeters / CATTAIL_CARD_REFERENCE_HEIGHT) * fade;
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
