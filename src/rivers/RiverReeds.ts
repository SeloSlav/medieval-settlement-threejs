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
  widthScaleX: number;
  widthScaleZ: number;
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
/** Full close-up opacity is required for a stable alpha-hashed cutout. */
const REED_PEAK_OPACITY = 1;
const REED_SHORE_MIN = 0.55;
const REED_SHORE_MAX = 4.8;
/** Keep emergent stands in water deep enough to visibly cross the cards. */
const REED_MIN_WATER_DEPTH = 0.28;
/** Avoid populating deep channel/sea water where cattails would not establish. */
const REED_MAX_WATER_DEPTH = 1.45;
/** Macro patches leave broad stretches of shoreline open instead of uniformly planted. */
const REED_STAND_CHANCE_MIN = 0.1;
const REED_STAND_CHANCE_MAX = 0.34;
const REED_FINGER_CHANCE_MIN = 0.08;
const REED_FINGER_CHANCE_MAX = 0.27;
/** Individual clumps retain cattail proportions while spanning young to robust footprints. */
const REED_WIDTH_SCALE_MIN = 0.62;
const REED_WIDTH_SCALE_MAX = 1.38;
const REED_HEIGHT_MIN_METERS = 0.62;
const REED_HEIGHT_MAX_METERS = 3.35;
/**
 * The authored texture is a compact tuft. A broader card fan makes each
 * instance read as a loose, established cattail clump instead of a small
 * ornamental grass plug.
 */
const REED_CARD_QUADS = 5;
const REED_CARD_WIDTH = 0.94;
const REED_CARD_BASE_SPREAD = 0.26;
/** Stable ordering within the opaque cutout list; water renders in the later transmission pass. */
const REED_RENDER_ORDER = 1.2;
/**
 * Cattails cannot use transparent blending: transmissive water is rendered in
 * its own pass before the transparent list, regardless of renderOrder. Keeping
 * the cards alpha-hashed and depth-writing puts them in the opaque pass first.
 * The later water surface then passes depth over bed-level stems and fails
 * against leaves and seed heads that have genuinely emerged above it.
 */
const REED_USES_OPAQUE_CUTOUT_PASS = true;

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
  material.transparent = false;
  material.opacity = 0;
  material.alphaTest = 0.32;
  material.alphaHash = REED_USES_OPAQUE_CUTOUT_PASS;
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
    // Broad seeded patches determine whether this section supports a stand at
    // all. The local roll then breaks up repeated silhouettes within a patch.
    const patchPresence = cattailPatchPresence(node.x, node.z);
    const standChance = THREE.MathUtils.lerp(
      REED_STAND_CHANCE_MIN,
      REED_STAND_CHANCE_MAX,
      patchPresence,
    );
    if (rng() > standChance) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const clusterCount = sampleReedClusterCount(rng, 1, 6);
    const standVigor = THREE.MathUtils.lerp(
      0.78,
      1.22,
      patchPresence * 0.68 + rng() * 0.32,
    );

    for (let i = 0; i < clusterCount; i++) {
      const along = (rng() - 0.5) * 6.8;
      const inward = 0.55 + Math.pow(rng(), 0.82) * 3.65;
      const px = node.x + tangentX * along - node.outwardX * inward;
      const pz = node.z + tangentZ * along - node.outwardZ * inward;

      if (!riverField.isRenderedWetAt(px, pz)) continue;
      if (placementIndex.hasPointWithin(px, pz, 0.78 + Math.pow(rng(), 0.7) * 0.62)) continue;

      const shore = riverField.sampleShoreDistance(px, pz);
      if (shore < REED_SHORE_MIN || shore > REED_SHORE_MAX) continue;
      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, px, pz);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;
      const size = sampleReedSizeVariation(rng, standVigor);
      const placement: ReedPlacement = {
        x: px,
        z: pz,
        heightMeters: resolveSubmergedReedHeightMeters(
          shore,
          waterDepthMeters,
          rng,
          size.heightScale,
        ),
        waterDepthMeters,
        widthScaleX: size.widthScaleX,
        widthScaleZ: size.widthScaleZ,
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

      const patchPresence = cattailPatchPresence(x, z);
      const shoreAffinity = THREE.MathUtils.clamp(1 - shore / REED_SHORE_MAX, 0, 1);
      const chance = THREE.MathUtils.lerp(0.018, 0.13, shoreAffinity)
        * THREE.MathUtils.lerp(0.18, 1, patchPresence);
      if (rng() > chance) continue;
      if (placementIndex.hasPointWithin(x, z, 0.82 + rng() * 0.55)) continue;
      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, x, z);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;

      const standVigor = THREE.MathUtils.lerp(0.8, 1.18, patchPresence);
      const size = sampleReedSizeVariation(rng, standVigor);
      const placement: ReedPlacement = {
        x,
        z,
        heightMeters: resolveSubmergedReedHeightMeters(
          shore,
          waterDepthMeters,
          rng,
          size.heightScale,
        ),
        waterDepthMeters,
        widthScaleX: size.widthScaleX,
        widthScaleZ: size.widthScaleZ,
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
    const patchPresence = cattailPatchPresence(node.x + 11.3, node.z - 7.1);
    const fingerChance = THREE.MathUtils.lerp(
      REED_FINGER_CHANCE_MIN,
      REED_FINGER_CHANCE_MAX,
      patchPresence,
    );
    if (rng() > fingerChance) continue;

    const tangentX = -node.outwardZ;
    const tangentZ = node.outwardX;
    const fingerLength = 1.8 + Math.pow(rng(), 0.7) * 5.2;
    const clusterCount = sampleReedClusterCount(rng, 1, 5);
    const standVigor = THREE.MathUtils.lerp(
      0.76,
      1.2,
      patchPresence * 0.72 + rng() * 0.28,
    );

    for (let index = 0; index < clusterCount; index++) {
      const inward = 0.32 + Math.pow(rng(), 0.72) * fingerLength;
      const spread = 0.5 + inward * 0.24;
      const along = (rng() - 0.5) * spread * 2;
      const x = node.x + tangentX * along - node.outwardX * inward;
      const z = node.z + tangentZ * along - node.outwardZ * inward;
      if (!riverField.isRenderedWetAt(x, z)) continue;

      const wetShore = riverField.sampleShoreDistance(x, z);
      if (wetShore < 0.36 || wetShore > 5.7) continue;
      if (placementIndex.hasPointWithin(x, z, 0.76 + rng() * 0.58)) continue;

      const waterDepthMeters = resolveReedWaterDepthMeters(terrain, riverField, x, z);
      if (!isCattailWaterDepth(waterDepthMeters)) continue;
      const size = sampleReedSizeVariation(rng, standVigor);
      const placement: ReedPlacement = {
        x,
        z,
        heightMeters: resolveSubmergedReedHeightMeters(
          wetShore,
          waterDepthMeters,
          rng,
          size.heightScale,
        ),
        waterDepthMeters,
        widthScaleX: size.widthScaleX,
        widthScaleZ: size.widthScaleZ,
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
  heightScale: number,
): number {
  const variedHeight = THREE.MathUtils.clamp(
    resolveReedHeightMeters(shore, rng) * heightScale,
    REED_HEIGHT_MIN_METERS,
    REED_HEIGHT_MAX_METERS,
  );
  return ensureCattailEmergenceHeightMeters(
    variedHeight,
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
  );
  const height = (placement.heightMeters / CATTAIL_CARD_REFERENCE_HEIGHT) * fade;
  return scaleVector.set(
    width * placement.widthScaleX * fade,
    height,
    width * placement.widthScaleZ * fade,
  );
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

function sampleReedClusterCount(
  rng: () => number,
  minCount: number,
  maxCount: number,
): number {
  const span = Math.max(0, maxCount - minCount + 1);
  const biasedRoll = Math.pow(THREE.MathUtils.clamp(rng(), 0, 0.999999), 1.5);
  return minCount + Math.floor(biasedRoll * span);
}

function sampleReedSizeVariation(
  rng: () => number,
  standVigor: number,
): { heightScale: number; widthScaleX: number; widthScaleZ: number } {
  const vigor = THREE.MathUtils.clamp(standVigor, 0.72, 1.28);
  const footprint = THREE.MathUtils.lerp(
    REED_WIDTH_SCALE_MIN,
    REED_WIDTH_SCALE_MAX,
    Math.pow(rng(), 0.86),
  ) * THREE.MathUtils.lerp(0.9, 1.1, (vigor - 0.72) / 0.56);
  return {
    heightScale: vigor * THREE.MathUtils.lerp(0.86, 1.14, rng()),
    widthScaleX: footprint * THREE.MathUtils.lerp(0.84, 1.16, rng()),
    widthScaleZ: footprint * THREE.MathUtils.lerp(0.84, 1.16, rng()),
  };
}

function cattailPatchPresence(x: number, z: number): number {
  const broad = valueNoise2D(x * 0.034 + 31.7, z * 0.034 - 19.1);
  const detail = valueNoise2D(x * 0.081 - 7.4, z * 0.081 + 43.8);
  return smoothstep(0.28, 0.76, broad * 0.72 + detail * 0.28);
}

function hashNoise2D(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2D(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const ux = tx * tx * (3 - 2 * tx);
  const uz = tz * tz * (3 - 2 * tz);
  const top = THREE.MathUtils.lerp(hashNoise2D(x0, z0), hashNoise2D(x0 + 1, z0), ux);
  const bottom = THREE.MathUtils.lerp(hashNoise2D(x0, z0 + 1), hashNoise2D(x0 + 1, z0 + 1), ux);
  return THREE.MathUtils.lerp(top, bottom, uz);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
