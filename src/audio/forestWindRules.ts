import { CLOSE_BLEND_START_DISTANCE } from '../camera/CameraCurves.ts';

/** Radius around the listener used to decide whether they are under a canopy. */
export const FOREST_WIND_SAMPLE_RADIUS = 28;

/** A close RTS view is fully immersed a little before the ground-eye rig finishes. */
export const FOREST_WIND_FULL_RTS_DISTANCE = 22;

/** Forest wind is absent from ordinary strategic and overview views. */
export const FOREST_WIND_SILENT_RTS_DISTANCE = CLOSE_BLEND_START_DISTANCE + 16;

/** First person retains a faint open-ground breeze even outside the forest. */
export const FOREST_WIND_FIRST_PERSON_FLOOR = 0.3;

export type ForestWindContext = {
  canopyCover: number;
  orbitDistance: number;
  firstPersonActive: boolean;
};

/**
 * Resolve the target mix for SeedThree's temperate wind loop.
 *
 * RTS mode requires both a close camera and real nearby canopy. First person
 * always keeps a quiet breeze, then grows to the full leafy bed under trees.
 */
export function forestWindTargetMix(context: ForestWindContext): number {
  const canopyMix = smoothstep(0.08, 0.72, context.canopyCover);
  if (context.firstPersonActive) {
    return lerp(FOREST_WIND_FIRST_PERSON_FLOOR, 1, canopyMix);
  }

  const closeMix = 1 - smoothstep(
    FOREST_WIND_FULL_RTS_DISTANCE,
    FOREST_WIND_SILENT_RTS_DISTANCE,
    context.orbitDistance,
  );
  return canopyMix * closeMix;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
