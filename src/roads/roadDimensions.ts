/** Logical width used by placement, navigation, snapping, and clearance. */
export const ROAD_WIDTH = 4.2;

/** Roads retain their logical footprint but render at two thirds of that width. */
export const ROAD_VISUAL_WIDTH_SCALE = 2 / 3;

/** Dry roads retain terrain clearance, with the feathered shoulder above the core. */
export const ROAD_VISUAL_CORE_Y_OFFSET = 0.055;
export const ROAD_VISUAL_SHOULDER_Y_OFFSET = 0.065;

/** Slim presentation-only paths from road-connected buildings to the road. */
export const BUILDING_ACCESS_SPUR_WIDTH = ROAD_WIDTH * ROAD_VISUAL_WIDTH_SCALE * 0.4;
/** Keeps overlapping spur/main-road triangles stable without clearing building pads. */
export const BUILDING_ACCESS_SPUR_Y_LIFT = 0.003;

/** Bridge clearance remains independent from the lower dry-road presentation. */
export const ROAD_BRIDGE_CORE_Y_OFFSET = 0.12;
export const ROAD_BRIDGE_SHOULDER_LIFT = 0.1;

export function roadVisualWidth(logicalWidth: number): number {
  return Math.max(0, logicalWidth) * ROAD_VISUAL_WIDTH_SCALE;
}
