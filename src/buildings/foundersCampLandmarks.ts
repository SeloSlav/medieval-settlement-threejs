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

export const FOUNDERS_CAMP_BENCH = {
  center: { x: -1.9, z: -0.2 },
  yaw: Math.PI * 0.5,
  length: 2.4,
  depth: 0.54,
  seatOffsets: [-0.72, 0, 0.72],
  legOffsets: [-0.82, 0.82],
} as const;

const SEATED_OCCUPANT_FRONT_CLEARANCE = 0.01;
const BENCH_APPROACH_FRONT_CLEARANCE = 0.48;
const STUMP_OCCUPANT_SUPPORT_GAP = FOUNDERS_CAMP_STUMP_TOP_RADIUS
  + SEATED_OCCUPANT_FRONT_CLEARANCE;

function keepDistanceFrom(
  point: FoundersCampLandmarkPoint,
  target: FoundersCampLandmarkPoint,
  distance: number,
): FoundersCampLandmarkPoint {
  const deltaX = point.x - target.x;
  const deltaZ = point.z - target.z;
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= distance) return point;
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
    // The character root remains just beyond the front edge while the sitting
    // clip settles the hips backward onto the shared plank.
    destination: benchPoint(
      along,
      FOUNDERS_CAMP_BENCH.depth / 2 + SEATED_OCCUPANT_FRONT_CLEARANCE,
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
  // kept just outside the stump footprint to leave the bent legs clear.
  supportPosition: { x: 2.68, z: 0.2 },
  destination: keepDistanceFrom(
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
  destination: keepDistanceFrom(
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
