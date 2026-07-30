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

export const HAMLET_VIEW_SPECS: readonly HamletViewSpec[] = [
  { id: 'strategic', label: 'Strategic', position: [108, 126, -116], target: [0, 3, 4], fov: 39, firstPerson: false },
  { id: 'settlement', label: 'Settlement', position: [67, 67, -73], target: [-1, 3.3, 1], fov: 41, firstPerson: false },
  { id: 'postcard', label: 'Postcard', position: [47, 27, -54], target: [-5, 4.8, 7], fov: 39, firstPerson: false },
  { id: 'road-eye', label: 'Road eye', position: [1.4, 2.45, -59], target: [0, 2.3, -7], fov: 54, firstPerson: true },
  { id: 'chapel', label: 'Chapel', position: [12, 8, 4], target: [-10.5, 5.4, 23], fov: 43, firstPerson: true },
  { id: 'residence', label: 'Residence', position: [7, 4.7, -35], target: [-8.8, 2.8, -34], fov: 46, firstPerson: true },
  { id: 'forest', label: 'Forest edge', position: [48, 12.5, 34], target: [65, 8.3, 58], fov: 50, firstPerson: true },
] as const;

export const HAMLET_MOTION_ROUTE_ID = 'gorski-kotar-lod-traverse-v1';

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
  interpolation: 'world-space-position-target-quaternion' as const,
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
  { id: 'stem-west', axisStart: [0, -52], axisEnd: [0, -17], side: 1, frontageOffset: 4.2, depth: 19, plotCount: 3 },
  { id: 'stem-east', axisStart: [0, -18], axisEnd: [0, -48], side: 1, frontageOffset: 4.2, depth: 19, plotCount: 2 },
  { id: 'west-lane', axisStart: [-10, 9], axisEnd: [-38, 35], side: 1, frontageOffset: 4.2, depth: 18, plotCount: 2 },
  { id: 'east-lane', axisStart: [10, 9], axisEnd: [38, 35], side: -1, frontageOffset: 4.2, depth: 18, plotCount: 2 },
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
