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
import {
  ensureCattailEmergenceHeightMeters,
} from './RiverReedHeight.ts';
import { getStillWaterSurfaceY } from './RiverWaterLevel.ts';

type ReedPlacement = {
  x: number;
  z: number;
  heightMeters: number;
  waterDepthMeters: number;
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
/** Keep emergent stands in water deep enough to visibly cross the cards. */
const REED_MIN_WATER_DEPTH = 0.28;
/** Avoid populating deep channel/sea water where cattails would not establish. */
const REED_MAX_WATER_DEPTH = 1.45;
/**
 * The authored texture is a compact tuft. A broader card fan makes each
 * instance read as a loose, established cattail clump instead of a small
 * ornamental grass plug.
 */
const REED_CARD_QUADS = 5;
const REED_CARD_WIDTH = 0.94;
const REED_CARD_BASE_SPREAD = 0.26;
/** Draw just before the transparent water film so submerged stems are veiled by water. */
const REED_RENDER_ORDER = 1.2;
/**
 * Once the cutout is substantially visible, let it populate the depth buffer.
 * Water can then cover bed-level stems while failing depth against leaves and
 * seed heads that have genuinely emerged above the surface.
 */
const REED_DEPTH_WRITE_MIN_OPACITY = 0.45;

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
  const geometry = createCattailGeometry({
    quads: REED_CARD_QUADS,
    width: REED_CARD_WIDTH,
    baseSpread: REED_CARD_BASE_SPREAD,
  });
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
  mesh.renderOrder = REED_RENDER_ORDER;
  mesh.visible = false;
  mesh.count = placements.length;
  const waterlineFractions = placements.map((placement) => (
    placement.waterDepthMeters / Math.max(placement.heightMeters, 0.001)
  ));
  mesh.userData.cattailHabitat = {
    total: placements.length,
    submerged: placements.filter((placement) => placement.waterDepthMeters > 0).length,
    minWaterlineFraction: waterlineFractions.length > 0
      ? Math.min(...waterlineFractions)
      : 0,
    maxWaterlineFraction: waterlineFractions.length > 0
      ? Math.max(...waterlineFractions)
      : 0,
  };

  let instancesHidden = false;
  const hideAllInstances = (): void => {
    if (instancesHidden) return;
    for (let index = 0; index < placements.length; index++) {
      mesh.setMatrixAt(index, hiddenMatrix);
    }
    if (placements.length > 0) mesh.instanceMatrix.needsUpdate = true;
    instancesHidden = true;
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
      resolveReedBaseY(placement, terrain),
      placement.z,
    );
    resolveReedScaleVector(placement, fullScale);
    seedThreeGroundCoverWindVector(placement.yaw, fullScale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    mesh.setColorAt(index, composeColor);
  });

  hideAllInstances();

  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'River reeds';
  group.renderOrder = REED_RENDER_ORDER;
  group.add(mesh);

  let lastMaterialOpacity = Number.NaN;
  let lastFocusX = Number.NaN;
  let lastFocusZ = Number.NaN;
  let wasReedVisible = false;

  const refreshProximity = (focusX: number, focusZ: number): void => {
    if (placements.length === 0) return;

    instancesHidden = false;
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

    if (matrixDirty) mesh.instanceMatrix.needsUpdate = true;
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
        const useDepthWrite = reedOpacity >= REED_DEPTH_WRITE_MIN_OPACITY;
        if (
          material.transparent !== useTransparency
          || material.depthWrite !== useDepthWrite
        ) {
          material.transparent = useTransparency;
          material.depthWrite = useDepthWrite;
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
        becameVisible
        || !Number.isFinite(lastFocusX)
        || Math.hypot(focusX - lastFocusX, focusZ - lastFocusZ)
          >= (firstPersonActive ? 3.25 : 1.25);

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

function createReedPlacements(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
): ReedPlacement[] {
  const placements: ReedPlacement[] = [];
  const placementIndex = new SpatialHash2D<ReedPlacement>(1.2);
  const shoreNodes = collectShoreNodes(riverField);

  for (const node of shoreNodes) {
    // Seed broad, irregular stands with deliberate gaps instead of tracing
    // the entire shoreline with a tight dotted line.
    if (rng() > 0.48) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const clusterCount = 3 + Math.floor(rng() * 6);

    for (let i = 0; i < clusterCount; i++) {
      const along = (rng() - 0.5) * 6.8;
      const inward = 0.55 + Math.pow(rng(), 0.82) * 3.65;
      const px = node.x + tangentX * along - node.outwardX * inward;
      const pz = node.z + tangentZ * along - node.outwardZ * inward;

      if (!riverField.isRenderedWetAt(px, pz)) continue;
      if (placementIndex.hasPointWithin(px, pz, 0.72 + rng() * 0.38)) continue;

      const shore = riverField.sampleShoreDistance(px, pz);
      if (shore < REED_SHORE_MIN || shore > REED_SHORE_MAX) continue;
      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, px, pz);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;
      const placement = {
        x: px,
        z: pz,
        heightMeters: resolveSubmergedReedHeightMeters(shore, waterDepthMeters, rng),
        waterDepthMeters,
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

  appendGridReedPlacements(terrain, riverField, rng, placements, placementIndex);
  appendShallowReedFingers(terrain, riverField, rng, shoreNodes, placements, placementIndex);
  return placements;
}

function appendGridReedPlacements(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
  placements: ReedPlacement[],
  placementIndex: SpatialHash2D<ReedPlacement>,
): void {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    for (let gridX = 0; gridX < resolution; gridX++) {
      const i = gridZ * resolution + gridX;
      if (!riverField.isRenderedWetAtGrid(gridX, gridZ)) continue;

      const shore = riverField.shoreDistance[i];
      if (shore < 0.55 || shore > 4.8) continue;

      const wx = startX + gridX * stepX;
      const wz = startZ + gridZ * stepZ;
      const x = wx + (rng() - 0.5) * stepX * 0.62;
      const z = wz + (rng() - 0.5) * stepZ * 0.62;
      if (!riverField.isRenderedWetAt(x, z)) continue;

      const chance = THREE.MathUtils.clamp(0.22 + (1 - shore / 4.8) * 0.32, 0.18, 0.56);
      if (rng() > chance) continue;
      if (placementIndex.hasPointWithin(x, z, 0.76 + rng() * 0.42)) continue;
      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, x, z);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;

      const placement = {
        x,
        z,
        heightMeters: resolveSubmergedReedHeightMeters(shore, waterDepthMeters, rng),
        waterDepthMeters,
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
    if (rng() > 0.5) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const fingerLength = 1.8 + Math.pow(rng(), 0.7) * 5.2;
    const clusterCount = 3 + Math.floor(rng() * 6);

    for (let index = 0; index < clusterCount; index++) {
      const inward = 0.32 + Math.pow(rng(), 0.72) * fingerLength;
      const spread = 0.5 + inward * 0.24;
      const along = (rng() - 0.5) * spread * 2;
      const x = node.x + tangentX * along - node.outwardX * inward;
      const z = node.z + tangentZ * along - node.outwardZ * inward;
      if (!riverField.isRenderedWetAt(x, z)) continue;

      const wetShore = riverField.sampleShoreDistance(x, z);
      if (wetShore < 0.36 || wetShore > 5.7) continue;
      if (placementIndex.hasPointWithin(x, z, 0.7 + rng() * 0.4)) continue;

      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, x, z);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;
      const placement: ReedPlacement = {
        x,
        z,
        heightMeters: resolveSubmergedReedHeightMeters(wetShore, waterDepthMeters, rng),
        waterDepthMeters,
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
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
  edgeFade = 1,
): void {
  position.set(
    placement.x,
    resolveReedBaseY(placement, terrain),
    placement.z,
  );
  euler.set(placement.tiltX, placement.yaw, placement.tiltZ);
  quaternion.setFromEuler(euler);
  const fade = THREE.MathUtils.clamp(edgeFade, 0, 1);
  resolveReedScaleVector(placement, scaleVector, fade);
  matrix.compose(position, quaternion, scaleVector);
}

function resolveReedBaseY(
  placement: ReedPlacement,
  terrain: Terrain,
): number {
  return terrain.getHeightAt(placement.x, placement.z) + 0.03;
}

function resolveReedWaterDepthMeters(
  terrain: Terrain,
  riverField: RiverField,
  x: number,
  z: number,
): number {
  return Math.max(
    0,
    getStillWaterSurfaceY(terrain, riverField, x, z) - terrain.getHeightAt(x, z),
  );
}

function isCattailWaterDepth(waterDepthMeters: number): boolean {
  return waterDepthMeters >= REED_MIN_WATER_DEPTH
    && waterDepthMeters <= REED_MAX_WATER_DEPTH;
}

function resolveSubmergedReedHeightMeters(
  shore: number,
  waterDepthMeters: number,
  rng: () => number,
): number {
  return ensureCattailEmergenceHeightMeters(
    resolveReedHeightMeters(shore, rng),
    waterDepthMeters,
  );
}

function resolveReedScaleVector(
  placement: ReedPlacement,
  scaleVector: THREE.Vector3,
  fade = 1,
): THREE.Vector3 {
  const width = THREE.MathUtils.clamp(
    0.78 + placement.heightMeters * 0.2,
    0.92,
    1.42,
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
