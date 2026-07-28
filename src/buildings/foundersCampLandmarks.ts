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

export const FOUNDERS_CAMP_BENCH_SEAT: FoundersCampSeatLandmark = {
  id: 'camp-bench-seat',
  behavior: 'sit',
  support: 'bench',
  supportPosition: { x: -1.9, z: -0.2 },
  // The authored sitting clip moves the hips slightly backward onto the
  // support. The wider plank catches the underside of the seated pose while
  // leaving the boots on clear ground in front of it.
  destination: { x: -1.9, z: -0.42 },
  approach: { x: -1.9, z: -0.9 },
  lookAt: { x: -1.9, z: -2 },
  surfaceHeight: FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
};

export const FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT: FoundersCampSeatLandmark = {
  id: 'fireside-stump-seat',
  behavior: 'rest',
  support: 'stump',
  // This support is behind the character root when they face the fire, so
  // the authored sitting motion settles the hips onto the stump.
  supportPosition: { x: 2.68, z: 0.69 },
  destination: { x: 2.45, z: 0.55 },
  lookAt: FOUNDERS_CAMPFIRE_POSITION,
  surfaceHeight: FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
};

export const FOUNDERS_CAMP_SEAT_LANDMARKS: readonly FoundersCampSeatLandmark[] = [
  FOUNDERS_CAMP_BENCH_SEAT,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
];
