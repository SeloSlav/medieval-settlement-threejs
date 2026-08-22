import * as THREE from 'three';
import { ILLUSTRATED_MAP_DESK_MARGIN_RATIO } from '../map/illustratedMapDeskSurface.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';

/**
 * Close-zoom ground-eye rig tuning. The normal camera uses the classic
 * distance/pitch orbit; these constants only apply once zoomed in past
 * CLOSE_BLEND_START_DISTANCE.
 */

/** Orbit distance below which the ground-eye rig begins blending in. */
export const CLOSE_BLEND_START_DISTANCE = 32;

export const CLOSE_BACK_DISTANCE = 13;
export const CLOSE_HEIGHT_ABOVE_TERRAIN = 4;
export const CLOSE_LOOK_AHEAD = 12;
export const CLOSE_LOOK_HEIGHT_OFFSET = 0.35;
export const CLOSE_PAN_SPEED_SCALE = 0.22;
export const CLOSE_FOV = 48;
export const DEFAULT_FOV = 54;

/** 100% zoom reference — keep in sync with grassLodMath BASELINE_CAMERA_DISTANCE. */
export const BASELINE_ORBIT_DISTANCE = 88;

/** Default strategic RTS orbit when the app loads and when leaving first-person. */
export const RTS_ORBIT_DISTANCE = 240;
export const RTS_ORBIT_PITCH = THREE.MathUtils.degToRad(68);

/**
 * The illustrated map owns one continuity stop at the live-world overview,
 * followed by three authored outward stops. Keeping the count explicit makes
 * wheel navigation predictable while the stop distances remain map-scaled.
 */
export const ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT = 3;

/** Keep the desk's terminal black edge slightly inside the viewport. */
export const ILLUSTRATED_MAP_VIEWPORT_PADDING = 1.04;

/** Conservative camera-to-opposite-corner padding for the map-only far plane. */
export const ILLUSTRATED_MAP_FAR_PLANE_PADDING = 1.06;

/** Minimum clearance between camera and sampled terrain height. */
export const MIN_CAMERA_TERRAIN_CLEARANCE = 1.8;

/** Orbit distance that fits the full terrain in view at the default RTS pitch/FOV. */
export function computeMaxOrbitDistance(
  bounds: TerrainBounds,
  fovDeg: number,
  pitchRad: number,
  margin = 1.35,
): number {
  const halfExtent = Math.max(
    (bounds.maxX - bounds.minX) * 0.5,
    (bounds.maxZ - bounds.minZ) * 0.5,
  );
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const sinPitch = Math.max(Math.sin(pitchRad), 0.15);
  return (halfExtent * margin) / (Math.tan(fovRad * 0.5) / sinPitch);
}

/**
 * Four illustrated-map stops: the unchanged live-world handoff, two regional
 * overviews, and a full-map/desk composition. Geometric spacing gives every
 * wheel step comparable visual weight across small, medium, and large maps.
 */
export type IllustratedMapCameraFrame = {
  aspect: number;
  yaw: number;
  pitch: number;
  targetX: number;
  targetZ: number;
};

/**
 * Solve the minimum orbit radius that contains every expanded desk corner in
 * the current perspective frustum. Unlike a top-down extent estimate, this
 * accounts for perspective depth, aspect, yaw, pitch, and an off-centre pan.
 */
export function computeIllustratedMapTerminalDistance(
  bounds: TerrainBounds,
  fovDeg: number,
  frame: IllustratedMapCameraFrame,
): number {
  const mapWidth = Math.max(0, bounds.maxX - bounds.minX);
  const mapDepth = Math.max(0, bounds.maxZ - bounds.minZ);
  const surroundMargin = Math.max(mapWidth, mapDepth)
    * ILLUSTRATED_MAP_DESK_MARGIN_RATIO;
  const minX = bounds.minX - surroundMargin;
  const maxX = bounds.maxX + surroundMargin;
  const minZ = bounds.minZ - surroundMargin;
  const maxZ = bounds.maxZ + surroundMargin;

  const safeAspect = Math.max(0.01, Math.abs(frame.aspect));
  const tanHalfVertical = Math.max(
    0.001,
    Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5),
  );
  const tanHalfHorizontal = tanHalfVertical * safeAspect;
  const cosPitch = Math.cos(frame.pitch);
  const sinPitch = Math.sin(frame.pitch);
  const cosYaw = Math.cos(frame.yaw);
  const sinYaw = Math.sin(frame.yaw);
  let requiredDistance = 0;

  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      const dx = x - frame.targetX;
      const dz = z - frame.targetZ;
      const yawForwardOffset = cosYaw * dx + sinYaw * dz;
      const orbitDepthOffset = cosPitch * yawForwardOffset;
      const cameraX = sinYaw * dx - cosYaw * dz;
      const cameraY = -sinPitch * yawForwardOffset;
      const horizontalFit = orbitDepthOffset
        + Math.abs(cameraX) / tanHalfHorizontal * ILLUSTRATED_MAP_VIEWPORT_PADDING;
      const verticalFit = orbitDepthOffset
        + Math.abs(cameraY) / tanHalfVertical * ILLUSTRATED_MAP_VIEWPORT_PADDING;
      requiredDistance = Math.max(requiredDistance, horizontalFit, verticalFit);
    }
  }

  return Math.max(0.001, requiredDistance);
}

export function computeIllustratedMapZoomStops(
  bounds: TerrainBounds,
  fovDeg: number,
  entryDistance: number,
  frame: IllustratedMapCameraFrame,
): readonly number[] {
  const safeEntryDistance = Math.max(0.001, entryDistance);
  const fitDistance = Math.max(
    safeEntryDistance,
    computeIllustratedMapTerminalDistance(
      bounds,
      fovDeg,
      frame,
    ),
  );
  const totalRatio = fitDistance / safeEntryDistance;

  return Array.from(
    { length: ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT + 1 },
    (_, tier) => {
      if (tier === 0) return safeEntryDistance;
      if (tier === ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT) return fitDistance;
      return safeEntryDistance * Math.pow(
        totalRatio,
        tier / ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT,
      );
    },
  );
}

/**
 * The target can be panned to one edge while the opposite map corner remains
 * visible. The triangle inequality therefore gives a safe, scale-aware far
 * envelope of orbit distance plus a surround-scaled terrain diagonal.
 */
export function computeIllustratedMapFarPlane(
  bounds: TerrainBounds,
  maxOrbitDistance: number,
  minimumFarPlane = 0,
): number {
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const depth = Math.max(0, bounds.maxZ - bounds.minZ);
  const fullDiagonal = Math.hypot(width, depth);
  const surroundDiagonalScale = 1 + ILLUSTRATED_MAP_DESK_MARGIN_RATIO * 2;
  return Math.max(
    minimumFarPlane,
    (Math.max(0, maxOrbitDistance) + fullDiagonal * surroundDiagonalScale)
      * ILLUSTRATED_MAP_FAR_PLANE_PADDING,
  );
}

function smoothstep01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0 = classic orbit, 1 = full ground-eye rig. */
export function evalCloseBlendFromDistance(distance: number, minDistance: number): number {
  const start = CLOSE_BLEND_START_DISTANCE;
  const end = minDistance;
  if (distance >= start) return 0;
  if (end >= start) return 1;
  return smoothstep01((start - distance) / (start - end));
}
