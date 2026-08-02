import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';

const SHADOW_CORNER = new THREE.Vector3();
const SHADOW_VIEW = new THREE.Vector3();
const SHADOW_TARGET = new THREE.Vector3();
const SHADOW_VIEW_FORWARD = new THREE.Vector3();
const SHADOW_SUN_OFFSET = new THREE.Vector3();
const SHADOW_SAMPLE_COORDS = new Float64Array(64 * 3);
const SHADOW_VIEW_BOUNDS: ViewBounds = {
  minCamX: 0,
  maxCamX: 0,
  minCamY: 0,
  maxCamY: 0,
  minCamZ: 0,
  maxCamZ: 0,
};

/** Max instanced pine height at largest scale and broad form. */
const MAX_TREE_HEIGHT = 48;
/** Broad-tree canopy can extend this far past its trunk on XZ. */
const MAX_CANOPY_RADIUS = 12;
const LIGHT_DISTANCE = 180;
const DEPTH_PAD = 30;
const MIN_VIEW_SHADOW_EXTENT = 72;

type FitDirectionalShadowOptions = {
  bounds: TerrainBounds;
  sunOffsetDir: THREE.Vector3;
  maxHeight?: number;
  horizontalMargin?: number;
  padding?: number;
};

export function computeViewShadowBounds(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  viewDistance: number,
  padding = 1.3,
  result?: TerrainBounds,
): TerrainBounds {
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const halfHeight = Math.tan(fovRad * 0.5) * viewDistance;
  const halfWidth = halfHeight * camera.aspect;
  const extentX = Math.max(MIN_VIEW_SHADOW_EXTENT, halfWidth * padding);
  const extentZ = Math.max(MIN_VIEW_SHADOW_EXTENT, halfHeight * padding);
  const bounds = result ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  bounds.minX = target.x - extentX;
  bounds.maxX = target.x + extentX;
  bounds.minZ = target.z - extentZ;
  bounds.maxZ = target.z + extentZ;
  return bounds;
}

export function intersectTerrainBounds(
  a: TerrainBounds,
  b: TerrainBounds,
  result?: TerrainBounds,
): TerrainBounds {
  const bounds = result ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  bounds.minX = Math.max(a.minX, b.minX);
  bounds.maxX = Math.min(a.maxX, b.maxX);
  bounds.minZ = Math.max(a.minZ, b.minZ);
  bounds.maxZ = Math.min(a.maxZ, b.maxZ);
  return bounds;
}

type ViewBounds = {
  minCamX: number;
  maxCamX: number;
  minCamY: number;
  maxCamY: number;
  minCamZ: number;
  maxCamZ: number;
};

export function fitDirectionalLightShadow(
  light: THREE.DirectionalLight,
  options: FitDirectionalShadowOptions,
): void {
  const {
    bounds,
    sunOffsetDir,
    maxHeight = MAX_TREE_HEIGHT,
    horizontalMargin = MAX_CANOPY_RADIUS,
    padding = 0.08,
  } = options;
  const minX = bounds.minX - horizontalMargin;
  const maxX = bounds.maxX + horizontalMargin;
  const minZ = bounds.minZ - horizontalMargin;
  const maxZ = bounds.maxZ + horizontalMargin;
  const sampleCoords = buildShadowSampleCoords(minX, maxX, minZ, maxZ, maxHeight);
  const normalizedSunOffset = SHADOW_SUN_OFFSET.copy(sunOffsetDir).normalize();

  SHADOW_TARGET.set((bounds.minX + bounds.maxX) * 0.5, 0, (bounds.minZ + bounds.maxZ) * 0.5);
  light.target.position.copy(SHADOW_TARGET);
  syncLightPosition(light, SHADOW_TARGET, normalizedSunOffset);

  const shadowCam = light.shadow.camera;
  syncShadowCameraFromLight(light, shadowCam);

  let viewBounds = measureViewBounds(shadowCam, sampleCoords);
  if (viewBounds.maxCamZ > -1) {
    light.target.getWorldPosition(SHADOW_VIEW_FORWARD);
    SHADOW_VIEW_FORWARD.sub(shadowCam.position).normalize();
    SHADOW_TARGET.copy(light.target.position).addScaledVector(
      SHADOW_VIEW_FORWARD,
      -(viewBounds.maxCamZ + DEPTH_PAD),
    );
    light.target.position.copy(SHADOW_TARGET);
    syncLightPosition(light, SHADOW_TARGET, normalizedSunOffset);
    syncShadowCameraFromLight(light, shadowCam);
    viewBounds = measureViewBounds(shadowCam, sampleCoords);
  }

  const frustumWidth = viewBounds.maxCamX - viewBounds.minCamX;
  const frustumHeight = viewBounds.maxCamY - viewBounds.minCamY;
  const padX = frustumWidth * padding;
  const padY = frustumHeight * padding;

  shadowCam.left = viewBounds.minCamX - padX;
  shadowCam.right = viewBounds.maxCamX + padX;
  shadowCam.top = viewBounds.maxCamY + padY;
  shadowCam.bottom = viewBounds.minCamY - padY;
  shadowCam.near = Math.max(0.1, -viewBounds.maxCamZ - DEPTH_PAD);
  shadowCam.far = -viewBounds.minCamZ + DEPTH_PAD;
  snapDirectionalShadowFrustumToTexels(light, shadowCam);
  shadowCam.updateProjectionMatrix();
}

/** Prevent shadow swimming when the ortho frustum recenters on pan/zoom. */
function snapDirectionalShadowFrustumToTexels(
  light: THREE.DirectionalLight,
  shadowCam: THREE.OrthographicCamera,
): void {
  const mapSize = light.shadow.mapSize.width;
  const width = shadowCam.right - shadowCam.left;
  const height = shadowCam.top - shadowCam.bottom;
  if (!(mapSize > 0 && width > 0 && height > 0)) return;

  const texelW = width / mapSize;
  const texelH = height / mapSize;
  const centerX = (shadowCam.left + shadowCam.right) * 0.5;
  const centerY = (shadowCam.bottom + shadowCam.top) * 0.5;
  const snappedX = Math.round(centerX / texelW) * texelW;
  const snappedY = Math.round(centerY / texelH) * texelH;
  const halfW = width * 0.5;
  const halfH = height * 0.5;

  shadowCam.left = snappedX - halfW;
  shadowCam.right = snappedX + halfW;
  shadowCam.bottom = snappedY - halfH;
  shadowCam.top = snappedY + halfH;
}

function buildShadowSampleCoords(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxHeight: number,
): Float64Array {
  const sampleCoords = SHADOW_SAMPLE_COORDS;
  let offset = 0;
  offset = writeShadowSample(offset, minX, 0, minZ);
  offset = writeShadowSample(offset, minX, 0, maxZ);
  offset = writeShadowSample(offset, minX, maxHeight, minZ);
  offset = writeShadowSample(offset, minX, maxHeight, maxZ);
  offset = writeShadowSample(offset, maxX, 0, minZ);
  offset = writeShadowSample(offset, maxX, 0, maxZ);
  offset = writeShadowSample(offset, maxX, maxHeight, minZ);
  offset = writeShadowSample(offset, maxX, maxHeight, maxZ);

  const edgeSteps = 6;
  for (let i = 0; i <= edgeSteps; i++) {
    const t = i / edgeSteps;
    const x = THREE.MathUtils.lerp(minX, maxX, t);
    const z = THREE.MathUtils.lerp(minZ, maxZ, t);
    offset = writeShadowSample(offset, x, 0, minZ);
    offset = writeShadowSample(offset, x, maxHeight, minZ);
    offset = writeShadowSample(offset, x, 0, maxZ);
    offset = writeShadowSample(offset, x, maxHeight, maxZ);
    offset = writeShadowSample(offset, minX, 0, z);
    offset = writeShadowSample(offset, minX, maxHeight, z);
    offset = writeShadowSample(offset, maxX, 0, z);
    offset = writeShadowSample(offset, maxX, maxHeight, z);
  }

  return sampleCoords;
}

function writeShadowSample(
  offset: number,
  x: number,
  y: number,
  z: number,
): number {
  SHADOW_SAMPLE_COORDS[offset] = x;
  SHADOW_SAMPLE_COORDS[offset + 1] = y;
  SHADOW_SAMPLE_COORDS[offset + 2] = z;
  return offset + 3;
}

function syncLightPosition(
  light: THREE.DirectionalLight,
  target: THREE.Vector3,
  sunOffsetDir: THREE.Vector3,
): void {
  light.position.copy(target).addScaledVector(sunOffsetDir, LIGHT_DISTANCE);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
}

/** Re-align the shadow ortho camera after the sun light pose changes. */
export function updateDirectionalShadowCameraMatrices(light: THREE.DirectionalLight): void {
  syncShadowCameraFromLight(light, light.shadow.camera);
  light.shadow.needsUpdate = true;
}

function syncShadowCameraFromLight(
  light: THREE.DirectionalLight,
  shadowCam: THREE.OrthographicCamera,
): void {
  shadowCam.position.setFromMatrixPosition(light.matrixWorld);
  light.target.getWorldPosition(SHADOW_TARGET);
  shadowCam.lookAt(SHADOW_TARGET);
  shadowCam.updateMatrixWorld();
}

function measureViewBounds(
  shadowCam: THREE.OrthographicCamera,
  sampleCoords: Float64Array,
): ViewBounds {
  let minCamX = Infinity;
  let maxCamX = -Infinity;
  let minCamY = Infinity;
  let maxCamY = -Infinity;
  let minCamZ = Infinity;
  let maxCamZ = -Infinity;

  for (let offset = 0; offset < sampleCoords.length; offset += 3) {
    SHADOW_CORNER.set(
      sampleCoords[offset]!,
      sampleCoords[offset + 1]!,
      sampleCoords[offset + 2]!,
    );
    SHADOW_VIEW.copy(SHADOW_CORNER).applyMatrix4(shadowCam.matrixWorldInverse);
    minCamX = Math.min(minCamX, SHADOW_VIEW.x);
    maxCamX = Math.max(maxCamX, SHADOW_VIEW.x);
    minCamY = Math.min(minCamY, SHADOW_VIEW.y);
    maxCamY = Math.max(maxCamY, SHADOW_VIEW.y);
    minCamZ = Math.min(minCamZ, SHADOW_VIEW.z);
    maxCamZ = Math.max(maxCamZ, SHADOW_VIEW.z);
  }

  SHADOW_VIEW_BOUNDS.minCamX = minCamX;
  SHADOW_VIEW_BOUNDS.maxCamX = maxCamX;
  SHADOW_VIEW_BOUNDS.minCamY = minCamY;
  SHADOW_VIEW_BOUNDS.maxCamY = maxCamY;
  SHADOW_VIEW_BOUNDS.minCamZ = minCamZ;
  SHADOW_VIEW_BOUNDS.maxCamZ = maxCamZ;
  return SHADOW_VIEW_BOUNDS;
}
