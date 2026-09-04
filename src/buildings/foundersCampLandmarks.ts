export type FoundersCampLandmarkPoint = Readonly<{
  x: number;
  z: number;
}>;

export type FoundersCampSeatLandmark = Readonly<{
  id: string;
  behavior: 'sit' | 'rest';
  support: 'bench' | 'stump';
  supportPosition: FoundersCampLandmarkPoint;
  destination: FoundersCampLandmarkPoint;
  approach?: FoundersCampLandmarkPoint;
  lookAt: FoundersCampLandmarkPoint;
  surfaceHeight: number;
}>;

export const FOUNDERS_CAMPFIRE_POSITION: FoundersCampLandmarkPoint = {
  x: 0.55,
  z: -0.6,
};

/**
 * Both physical supports meet the authored villager sitting pose at this
 * height. Keeping the surface shared prevents the bench, stump, and character
 * roots from drifting apart when any one of them is adjusted.
 */
export const FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT = 0.395;
export const FOUNDERS_CAMP_STUMP_TOP_RADIUS = 0.38;
/**
 * The sitting clip carries the pelvis forward of the character root. Move the
 * invisible root this far back from each support's front edge so the rendered
 * hips land near the middle of the seat.
 */
export const FOUNDERS_CAMP_SEATED_ROOT_BACKSHIFT = 0.36;

export const FOUNDERS_CAMP_BENCH = {
  center: { x: -1.9, z: -0.2 },
  yaw: Math.PI * 0.5,
  length: 2.4,
  depth: 0.54,
  seatOffsets: [-0.72, 0, 0.72],
  legOffsets: [-0.82, 0.82],
} as const;

const BENCH_APPROACH_FRONT_CLEARANCE = 0.48;
const STUMP_OCCUPANT_SUPPORT_GAP = FOUNDERS_CAMP_STUMP_TOP_RADIUS
  - FOUNDERS_CAMP_SEATED_ROOT_BACKSHIFT;

function placeAlongSupportAxis(
  point: FoundersCampLandmarkPoint,
  target: FoundersCampLandmarkPoint,
  distance: number,
): FoundersCampLandmarkPoint {
  const deltaX = point.x - target.x;
  const deltaZ = point.z - target.z;
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= 1e-9) return target;
  return {
    x: target.x + deltaX / length * distance,
    z: target.z + deltaZ / length * distance,
  };
}

function benchPoint(along: number, forward: number): FoundersCampLandmarkPoint {
  const cosYaw = Math.cos(FOUNDERS_CAMP_BENCH.yaw);
  const sinYaw = Math.sin(FOUNDERS_CAMP_BENCH.yaw);
  return {
    x: FOUNDERS_CAMP_BENCH.center.x + cosYaw * along + sinYaw * forward,
    z: FOUNDERS_CAMP_BENCH.center.z - sinYaw * along + cosYaw * forward,
  };
}

function benchSeatLandmark(id: string, along: number): FoundersCampSeatLandmark {
  return {
    id,
    behavior: 'sit',
    support: 'bench',
    supportPosition: benchPoint(along, 0),
    // The root sits behind the plank center to counter the clip's forward
    // pelvis offset; the visible hips then settle onto the middle of the seat.
    destination: benchPoint(
      along,
      FOUNDERS_CAMP_BENCH.depth / 2 - FOUNDERS_CAMP_SEATED_ROOT_BACKSHIFT,
    ),
    approach: benchPoint(
      along,
      FOUNDERS_CAMP_BENCH.depth / 2 + BENCH_APPROACH_FRONT_CLEARANCE,
    ),
    lookAt: FOUNDERS_CAMPFIRE_POSITION,
    surfaceHeight: FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
  };
}

export const FOUNDERS_CAMP_BENCH_SEATS: readonly FoundersCampSeatLandmark[] = [
  benchSeatLandmark('camp-bench-seat-left', FOUNDERS_CAMP_BENCH.seatOffsets[0]),
  benchSeatLandmark('camp-bench-seat', FOUNDERS_CAMP_BENCH.seatOffsets[1]),
  benchSeatLandmark('camp-bench-seat-right', FOUNDERS_CAMP_BENCH.seatOffsets[2]),
];

/** Central seat used by single-seat callers and handoff checks. */
export const FOUNDERS_CAMP_BENCH_SEAT = FOUNDERS_CAMP_BENCH_SEATS[1]!;

export const FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT: FoundersCampSeatLandmark = {
  id: 'fireside-stump-seat',
  behavior: 'rest',
  support: 'stump',
  // This support is behind the character root when they face the fire, so
  // the authored sitting motion settles the hips onto the stump. The root is
  // place the root behind the stump center so the visible hips settle on top.
  supportPosition: { x: 2.68, z: 0.2 },
  destination: placeAlongSupportAxis(
    { x: 2.32, z: 0 },
    { x: 2.68, z: 0.2 },
    STUMP_OCCUPANT_SUPPORT_GAP,
  ),
  lookAt: FOUNDERS_CAMPFIRE_POSITION,
  surfaceHeight: FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
};

export const FOUNDERS_CAMP_WORKYARD_STUMP_SEAT: FoundersCampSeatLandmark = {
  id: 'workyard-stump-seat',
  behavior: 'rest',
  support: 'stump',
  supportPosition: { x: -4.48, z: -1.2 },
  destination: placeAlongSupportAxis(
    { x: -4, z: -1.14 },
    { x: -4.48, z: -1.2 },
    STUMP_OCCUPANT_SUPPORT_GAP,
  ),
  approach: { x: -3.5, z: -1.08 },
  lookAt: FOUNDERS_CAMPFIRE_POSITION,
  surfaceHeight: FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
};

export const FOUNDERS_CAMP_SEAT_LANDMARKS: readonly FoundersCampSeatLandmark[] = [
  FOUNDERS_CAMP_BENCH_SEAT,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
  FOUNDERS_CAMP_WORKYARD_STUMP_SEAT,
  FOUNDERS_CAMP_BENCH_SEATS[0]!,
  FOUNDERS_CAMP_BENCH_SEATS[2]!,
];
