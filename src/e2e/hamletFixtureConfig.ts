import * as THREE from 'three';

export const HAMLET_FIXTURE_ID = 'gorski-kotar-parish-lane-1550';
export const HAMLET_FIXTURE_SEED = 0x1550_09a3;
export const HAMLET_RESIDENCE_ROOF = 'brown' as const;

export const HAMLET_VIEW_IDS = [
  'strategic',
  'settlement',
  'postcard',
  'road-eye',
  'chapel',
  'residence',
  'forest',
] as const;

export type HamletViewId = (typeof HAMLET_VIEW_IDS)[number];

export type HamletViewSpec = {
  id: HamletViewId;
  label: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
  firstPerson: boolean;
};

export const HAMLET_RESIDENCE_VIEW_SUBJECT = Object.freeze({
  id: 'west-lane-south-residence-1',
  residenceIndex: 11,
  position: [-22.296739234902255, 0.720684, 35.90355719828845] as const,
  yaw: -2.3996453855838755,
});

export const HAMLET_RESIDENCE_VIEW_NEAREST_NEIGHBOR = Object.freeze({
  id: 'west-lane-south-residence-0',
  residenceIndex: 10,
  position: [-10.296739234902253, 0.608888, 24.90355719828845] as const,
  yaw: -2.3996453855838755,
});

export const HAMLET_RESIDENCE_VIEW_SUBJECT_ID =
  HAMLET_RESIDENCE_VIEW_SUBJECT.id;

export const HAMLET_VIEW_SPECS: readonly HamletViewSpec[] = [
  { id: 'strategic', label: 'Strategic', position: [108, 126, -116], target: [0, 3, 4], fov: 39, firstPerson: false },
  { id: 'settlement', label: 'Settlement', position: [67, 67, -73], target: [-1, 3.3, 1], fov: 41, firstPerson: false },
  { id: 'postcard', label: 'Postcard', position: [47, 27, -54], target: [-5, 4.8, 7], fov: 39, firstPerson: false },
  { id: 'road-eye', label: 'Road eye', position: [1.4, 2.45, -59], target: [0, 2.3, -7], fov: 54, firstPerson: true },
  { id: 'chapel', label: 'Chapel', position: [12, 8, 4], target: [-10.5, 5.4, 23], fov: 43, firstPerson: true },
  // Clean, slightly elevated three-quarter judge: close enough to read the
  // shingle planes and work yard, with the neighboring plot fully off-frame.
  { id: 'residence', label: 'Residence', position: [-25.2, 3, 23], target: [-22.3, 3.5, 35.9], fov: 43, firstPerson: true },
  { id: 'forest', label: 'Forest edge', position: [48, 12.5, 34], target: [65, 8.3, 58], fov: 50, firstPerson: true },
] as const;

export const HAMLET_MOTION_ROUTE_ID = 'gorski-kotar-lod-traverse-v1';
export const HAMLET_LOD_DISTANCE_TOLERANCE_METERS = 0.01;

export type HamletMotionKeyframe = {
  id:
    | 'strategic-start'
    | 'strategic-settled'
    | 'settlement-inbound'
    | 'road-eye-arrival'
    | 'road-eye-settled'
    | 'settlement-outbound'
    | 'strategic-return';
  timeMs: number;
  distanceMeters: 240 | 88 | 4;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  orientation: readonly [number, number, number, number];
  fov: number;
};

export const HAMLET_MOTION_ROUTE = {
  id: HAMLET_MOTION_ROUTE_ID,
  label: 'Strategic to road-eye LOD traverse',
  durationMs: 21_000,
  interpolation: 'world-space-position-target-look-at' as const,
  easing: 'smootherstep' as const,
  settledStartPredicate: {
    id: 'fixture-ready-two-stable-frames' as const,
    fixtureReady: true,
    detailedTexturesReady: true,
    minimumRenderedFrames: 2,
    motionInactive: true,
  },
  lodBands: {
    forest: {
      id: 'seedthree-overview-to-near',
      nearDistanceMeters: 108,
    },
    groundcover: {
      id: 'close-ground-dirt-and-cover',
      transitionStartMeters: 44,
      fullDetailMeters: 22,
    },
    building: {
      id: 'building-review-distance',
      settlementMeters: 88,
      roadEyeMeters: 4,
    },
  },
  keyframes: [
    {
      id: 'strategic-start',
      timeMs: 0,
      distanceMeters: 240,
      position: [128.158569, 148.921039, -138.211756],
      target: [0, 3.2, 3],
      orientation: [-0.11544281, 0.88366516, 0.29897719, 0.34120592],
      fov: 39,
    },
    {
      id: 'strategic-settled',
      timeMs: 1_000,
      distanceMeters: 240,
      position: [128.158569, 148.921039, -138.211756],
      target: [0, 3.2, 3],
      orientation: [-0.11544281, 0.88366516, 0.29897719, 0.34120592],
      fov: 39,
    },
    {
      id: 'settlement-inbound',
      timeMs: 6_000,
      distanceMeters: 88,
      position: [49.268962, 50.364114, -53.704459],
      target: [-1, 3.2, 1],
      orientation: [-0.10132625, 0.89473671, 0.2600192, 0.34866779],
      fov: 41,
    },
    {
      id: 'road-eye-arrival',
      timeMs: 11_000,
      distanceMeters: 4,
      position: [0.800015, 2.400004, -35.914074],
      target: [0, 2.2, -32],
      orientation: [-0.00251679, 0.99461193, 0.02488133, 0.10060658],
      fov: 54,
    },
    {
      id: 'road-eye-settled',
      timeMs: 12_500,
      distanceMeters: 4,
      position: [0.800015, 2.400004, -35.914074],
      target: [0, 2.2, -32],
      orientation: [-0.00251679, 0.99461193, 0.02488133, 0.10060658],
      fov: 54,
    },
    {
      id: 'settlement-outbound',
      timeMs: 16_000,
      distanceMeters: 88,
      position: [49.268962, 50.364114, -53.704459],
      target: [-1, 3.2, 1],
      orientation: [-0.10132625, 0.89473671, 0.2600192, 0.34866779],
      fov: 41,
    },
    {
      id: 'strategic-return',
      timeMs: 21_000,
      distanceMeters: 240,
      position: [128.158569, 148.921039, -138.211756],
      target: [0, 3.2, 3],
      orientation: [-0.11544281, 0.88366516, 0.29897719, 0.34120592],
      fov: 39,
    },
  ] satisfies readonly HamletMotionKeyframe[],
} as const;

export type HamletMotionSample = {
  elapsedMs: number;
  segmentIndex: number;
  from: HamletMotionKeyframe;
  to: HamletMotionKeyframe;
  position: THREE.Vector3;
  target: THREE.Vector3;
  orientation: THREE.Quaternion;
  distanceMeters: number;
  fov: number;
};

export type HamletBuildingLodBand = 'strategic' | 'settlement' | 'road-eye';

export function resolveHamletBuildingLodBand(
  distanceMeters: number,
): HamletBuildingLodBand {
  const { building } = HAMLET_MOTION_ROUTE.lodBands;
  if (
    distanceMeters
    <= building.roadEyeMeters + HAMLET_LOD_DISTANCE_TOLERANCE_METERS
  ) {
    return 'road-eye';
  }
  if (
    distanceMeters
    <= building.settlementMeters + HAMLET_LOD_DISTANCE_TOLERANCE_METERS
  ) {
    return 'settlement';
  }
  return 'strategic';
}

export type HamletVisualReadiness = {
  fixtureReady: boolean;
  detailedTexturesReady: boolean;
  skyRuntimeReady: boolean;
  forestRuntimeReady: boolean;
  groundcoverRuntimeReady: boolean;
};

export function resolveHamletFullVisualSystemsReady(
  readiness: HamletVisualReadiness,
): boolean {
  return readiness.fixtureReady
    && readiness.detailedTexturesReady
    && readiness.skyRuntimeReady
    && readiness.forestRuntimeReady
    && readiness.groundcoverRuntimeReady;
}

/**
 * Interpolates the authored world-space position and target, then derives the
 * camera quaternion and distance telemetry from that same geometry. This
 * keeps the visible aim, published target, and LOD distance mutually truthful.
 */
export function sampleHamletMotionRoute(elapsedMs: number): HamletMotionSample {
  const clamped = THREE.MathUtils.clamp(elapsedMs, 0, HAMLET_MOTION_ROUTE.durationMs);
  const keyframes = HAMLET_MOTION_ROUTE.keyframes;
  let segmentIndex = Math.max(0, keyframes.length - 2);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    if (clamped <= keyframes[index + 1]!.timeMs) {
      segmentIndex = index;
      break;
    }
  }
  const from = keyframes[segmentIndex]!;
  const to = keyframes[segmentIndex + 1]!;
  const segmentDuration = Math.max(1, to.timeMs - from.timeMs);
  const rawT = THREE.MathUtils.clamp((clamped - from.timeMs) / segmentDuration, 0, 1);
  const t = smootherstep(rawT);
  const position = new THREE.Vector3(...from.position).lerp(
    new THREE.Vector3(...to.position),
    t,
  );
  const target = new THREE.Vector3(...from.target).lerp(
    new THREE.Vector3(...to.target),
    t,
  );
  const orientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
  );
  return {
    elapsedMs: clamped,
    segmentIndex,
    from,
    to,
    position,
    target,
    orientation,
    distanceMeters: position.distanceTo(target),
    fov: THREE.MathUtils.lerp(from.fov, to.fov, t),
  };
}

function smootherstep(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export type HamletRoadArm = {
  id: 'stem' | 'west-arm' | 'east-arm';
  points: readonly (readonly [number, number])[];
};

export const HAMLET_ROAD_ARMS: readonly HamletRoadArm[] = [
  { id: 'stem', points: [[0, 0], [-1.5, -18], [0.4, -38], [0, -70]] },
  { id: 'west-arm', points: [[0, 0], [-12, 11], [-29, 28], [-53, 47]] },
  { id: 'east-arm', points: [[0, 0], [13, 12], [31, 29], [54, 47]] },
] as const;

export type HamletZoneSpec = {
  id: string;
  axisStart: readonly [number, number];
  axisEnd: readonly [number, number];
  side: -1 | 1;
  frontageOffset: number;
  depth: number;
  plotCount: number;
};

export const HAMLET_ZONE_SPECS: readonly HamletZoneSpec[] = [
  { id: 'stem-west', axisStart: [0, -55], axisEnd: [0, -15], side: 1, frontageOffset: 4.2, depth: 18, plotCount: 4 },
  { id: 'stem-east', axisStart: [0, -17], axisEnd: [0, -52], side: 1, frontageOffset: 4.2, depth: 18, plotCount: 3 },
  { id: 'west-lane-north', axisStart: [-9, 8], axisEnd: [-39, 36], side: 1, frontageOffset: 4.2, depth: 17, plotCount: 3 },
  { id: 'west-lane-south', axisStart: [-12, 11], axisEnd: [-36, 33], side: -1, frontageOffset: 4.2, depth: 15, plotCount: 2 },
  { id: 'east-lane-south', axisStart: [9, 8], axisEnd: [39, 36], side: -1, frontageOffset: 4.2, depth: 17, plotCount: 3 },
  { id: 'east-lane-north', axisStart: [12, 11], axisEnd: [36, 33], side: 1, frontageOffset: 4.2, depth: 15, plotCount: 2 },
] as const;

export type HamletFieldSpec = {
  id: string;
  crop: 'rye' | 'oats' | 'barley' | 'flax' | 'fallow';
  stage: 'ploughing' | 'sowing' | 'growing' | 'harvesting';
  stageProgress: number;
  corners: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
};

export const HAMLET_FIELD_SPECS: readonly HamletFieldSpec[] = [
  { id: 'west-rye', crop: 'rye', stage: 'growing', stageProgress: 0.86, corners: [[-45, -54], [-27, -52], [-26, -20], [-44, -18]] },
  { id: 'east-oats', crop: 'oats', stage: 'growing', stageProgress: 0.78, corners: [[27, -49], [44, -47], [43, -22], [27, -20]] },
  { id: 'west-flax', crop: 'flax', stage: 'growing', stageProgress: 0.9, corners: [[-50, 5], [-41, 15], [-54, 29], [-63, 18]] },
  { id: 'east-fallow', crop: 'fallow', stage: 'ploughing', stageProgress: 0.72, corners: [[40, 11], [51, 22], [61, 11], [50, 1]] },
] as const;

export const HAMLET_LANDMARKS = [
  { id: 'parish-chapel', kind: 'chapel', position: [-10.5, 23], yaw: -2.38 },
  { id: 'village-well', kind: 'well', position: [5.5, -6], yaw: -0.35 },
  { id: 'trade-loggia', kind: 'marketplace', position: [12, 24], yaw: 2.43 },
] as const;
