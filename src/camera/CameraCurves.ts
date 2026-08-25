import * as THREE from 'three';
import { ILLUSTRATED_MAP_DESK_MARGIN_RATIO } from '../map/illustratedMapDeskSurface.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';

/**
 * Close-zoom ground-eye rig tuning. The normal camera uses the classic
 * distance/pitch orbit; these constants only apply once zoomed in past
 * CLOSE_BLEND_START_DISTANCE.
 */

/** Minimum orbit distance below which the ground-eye rig begins blending in. */
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
/**
 * View the world-aligned paper map from its authored bottom edge. Canvas +Y
 * maps toward world +Z, so the reciprocal yaw would present the sheet rotated
 * 180 degrees at the default map handoff.
 */
export const RTS_ORBIT_YAW = Math.PI / 2;
export const RTS_ORBIT_PITCH = THREE.MathUtils.degToRad(68);

/** Every wheel detent advances one logarithmically even orbit-distance tier. */
export const CAMERA_ZOOM_STEP_MULTIPLIER = 1.18;

/** Established live-world overview retained as an exact navigation stop. */
export const LIVE_WORLD_OVERVIEW_ZOOM_PERCENT = 30;

/**
 * Outermost live-world view. This is one full wheel tier beyond the established
 * 30% overview; the following outward detent hands render ownership to paper.
 */
export const LIVE_WORLD_MIN_ZOOM_PERCENT = LIVE_WORLD_OVERVIEW_ZOOM_PERCENT
  / CAMERA_ZOOM_STEP_MULTIPLIER;

/**
 * Keep the physical paper and its table surround legible during map-only
 * orbiting. The live world deliberately retains its much lower 5-degree
 * elevation floor.
 */
export const ILLUSTRATED_MAP_MIN_PITCH = THREE.MathUtils.degToRad(45);

/**
 * The illustrated map owns one continuity stop at the live-world overview,
 * followed by two authored outward stops. Keeping the count explicit makes
 * wheel navigation predictable while the stop distances remain map-scaled.
 */
export const ILLUSTRATED_MAP_OUTWARD_ZOOM_TIER_COUNT = 2;

/**
 * Retain the original three-step geometric rhythm while omitting its distant
 * full-desk endpoint. This keeps the two useful regional stops exactly where
 * they were instead of redistributing them across the larger range.
 */
const ILLUSTRATED_MAP_FULL_FIT_SPACING_TIER_COUNT = 3;

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
 * Three illustrated-map stops: the unchanged live-world handoff and the two
 * existing regional overviews. The former full-map/desk endpoint is still
 * used only as a scale-aware spacing reference so these retained stops do not
 * move when the unnecessary final tier is omitted.
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
      return safeEntryDistance * Math.pow(
        totalRatio,
        tier / ILLUSTRATED_MAP_FULL_FIT_SPACING_TIER_COUNT,
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

/**
 * Pick a curve handoff far/high enough for a zero-start-tangent cubic Hermite
 * arc to join the ordinary orbit without reversing laterally or vertically.
 * The factor of three is the monotone cubic endpoint-slope limit.
 */
export function computeCloseCurveStartDistance(
  minDistance: number,
  orbitPitch: number,
  closeHeightFromTarget = CLOSE_HEIGHT_ABOVE_TERRAIN,
): number {
  const horizontalDirection = Math.max(Math.cos(orbitPitch), 0.0001);
  const verticalDirection = Math.max(Math.sin(orbitPitch), 0.0001);
  const monotoneHandoffDistance = (
    3 * CLOSE_BACK_DISTANCE - horizontalDirection * minDistance
  ) / (2 * horizontalDirection);
  const monotoneHeightHandoffDistance = (
    3 * closeHeightFromTarget - verticalDirection * minDistance
  ) / (2 * verticalDirection);
  return Math.max(
    CLOSE_BLEND_START_DISTANCE,
    minDistance,
    monotoneHandoffDistance,
    monotoneHeightHandoffDistance,
  );
}

/** 0 = full ground-eye pose, 1 = ordinary orbit handoff. */
export function evalCloseCurveProgress(
  distance: number,
  minDistance: number,
  startDistance: number,
): number {
  if (startDistance <= minDistance) return distance >= startDistance ? 1 : 0;
  return THREE.MathUtils.clamp(
    (distance - minDistance) / (startDistance - minDistance),
    0,
    1,
  );
}

/** 0 = classic orbit, 1 = full ground-eye rig. */
export function evalCloseBlendFromDistance(
  distance: number,
  minDistance: number,
  startDistance = CLOSE_BLEND_START_DISTANCE,
): number {
  return 1 - smoothstep01(
    evalCloseCurveProgress(distance, minDistance, startDistance),
  );
}
