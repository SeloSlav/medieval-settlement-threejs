/** Matches CameraController default orbit distance at 100% zoom. */
export const BASELINE_CAMERA_DISTANCE = 88;

/** Close ground detail (dirt, grass tufts, reeds) reaches full strength at this zoom. */
export const CLOSE_GROUND_FULL_ZOOM_PERCENT = 400;

/** Close ground detail begins fading in above this zoom; below it the map stays meadow. */
export const CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 160;

/** World quarry map icons appear at this zoom and below. */
export const MAP_ICON_MAX_ZOOM_PERCENT = 50;

/** Map icons reach full opacity below this zoom. */
export const MAP_ICON_FADE_START_ZOOM_PERCENT = 45;

/** Dirt is fully active at this zoom and beyond. */
export const DIRT_REVEAL_ZOOM_PERCENT = CLOSE_GROUND_FULL_ZOOM_PERCENT;

/** Dirt begins fading in above this zoom; below it the map stays meadow. */
export const DIRT_FADE_START_ZOOM_PERCENT = CLOSE_GROUND_FADE_START_ZOOM_PERCENT;

/** Pow easing on the zoom gate (< 1 = detail ramps in gradually across the fade band). */
export const DIRT_BLEND_EASE = 0.72;

/** Orbit distances matching the 160% / 400% close-ground zoom band. */
export const TERRAIN_DIRT_CLOSE_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_REVEAL_ZOOM_PERCENT / 100);

export const TERRAIN_DIRT_FAR_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_FADE_START_ZOOM_PERCENT / 100);

/** Horizontal radius (world units) where close dirt is visible around the camera. */
export const DIRT_PROXIMITY_INNER = 26;

export const DIRT_PROXIMITY_OUTER = 78;

export const DIRT_PROXIMITY_INNER_SQ = DIRT_PROXIMITY_INNER * DIRT_PROXIMITY_INNER;

export const DIRT_PROXIMITY_OUTER_SQ = DIRT_PROXIMITY_OUTER * DIRT_PROXIMITY_OUTER;

/** Blade tufts use the same zoom band as close dirt terrain. */
export const GRASS_BLADE_REVEAL = {
  close: TERRAIN_DIRT_CLOSE_DISTANCE,
  far: TERRAIN_DIRT_FAR_DISTANCE,
} as const;

/** Horizontal radius where 3D grass tufts render — fades before dirt ends. */
export const GRASS_BLADE_NEAR_RADIUS = 62;

/** Tighter stream disc while walking in first person — enough cover, fewer chunks. */
export const GRASS_BLADE_NEAR_RADIUS_FIRST_PERSON = 46;

/** Slot columns/rows refreshed per frame when the stream recentres (orbit zoom). */
export const GRASS_STREAM_SLOTS_PER_FRAME = 14;

/** Lower per-frame budget while the first-person focus moves continuously. */
export const GRASS_STREAM_SLOTS_PER_FRAME_FIRST_PERSON = 6;

/** Max slots processed in one frame even during an initial fill burst. */
export const GRASS_STREAM_BURST_CAP = 36;

/** Spatial chunk size for streamed grass batches (larger = fewer pan hitches). */
export const GRASS_BLADE_CHUNK_SIZE = 8;

/** Target tufts scattered per chunk (organic placement, not a rigid grid). */
export const GRASS_TUFTS_PER_CHUNK = 96;

/** Extra scatter attempts budget per chunk. */
export const GRASS_TUFT_SCATTER_ATTEMPTS = GRASS_TUFTS_PER_CHUNK + 56;

/** Blade stalks in each tuft mesh (shared geometry). */
export const GRASS_BLADES_PER_TUFT = 9;

/** Visible grass radius plus preload margin (world chunks beyond the fade edge). */
export const GRASS_STREAM_CHUNK_RADIUS =
  Math.ceil(GRASS_BLADE_NEAR_RADIUS / GRASS_BLADE_CHUNK_SIZE) + 2;

export function grassStreamNearRadius(firstPersonActive: boolean): number {
  return firstPersonActive ? GRASS_BLADE_NEAR_RADIUS_FIRST_PERSON : GRASS_BLADE_NEAR_RADIUS;
}

/** Soft falloff band at the outer edge of the grass patch (world units). */
export const GRASS_EDGE_FADE_BAND = 24;

/** 0 below 160% zoom → 1 at 400% zoom; shared by dirt, grass tufts, and reeds. */
export function dirtZoomGate(cameraDistance: number): number {
  const t = smoothstep(TERRAIN_DIRT_CLOSE_DISTANCE, TERRAIN_DIRT_FAR_DISTANCE, cameraDistance);
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

/**
 * Reeds are alpha-tested cards, so a faint linear fade leaves only detached
 * opaque texels visible at overview scale. Delay their reveal until the cards
 * are large enough to read as plants, then use a steeper opacity curve.
 */
export const REED_LOD_VISIBILITY_THRESHOLD = 0.96;
export const REED_LOD_OPACITY_POWER = 2;

/**
 * Alpha-tested clumps turn into detached dark texels when the shared dirt gate
 * is still faint at overview scale. Keep the terrain's continuous dirt blend,
 * but delay the 3D clumps until their silhouettes read as grass.
 */
export const GRASS_BLADE_LOD_VISIBILITY_THRESHOLD = 0.96;
export const GRASS_BLADE_LOD_OPACITY_POWER = 1.35;

export function grassBladeRevealOpacity(cameraDistance: number): number {
  return dirtZoomGate(cameraDistance);
}

export function grassBladeLodOpacity(grassLod: number): number {
  const clampedLod = Math.max(0, Math.min(1, grassLod));
  const remapped = Math.max(
    0,
    Math.min(
      1,
      (clampedLod - GRASS_BLADE_LOD_VISIBILITY_THRESHOLD)
        / (1 - GRASS_BLADE_LOD_VISIBILITY_THRESHOLD),
    ),
  );
  return Math.pow(remapped, GRASS_BLADE_LOD_OPACITY_POWER);
}

export function reedRevealOpacity(cameraDistance: number): number {
  return dirtZoomGate(cameraDistance);
}

export function resolveReedLod(cameraDistance: number, firstPersonActive: boolean): number {
  if (firstPersonActive) return 1;
  return reedRevealOpacity(cameraDistance);
}

export function reedLodOpacity(reedLod: number): number {
  const clampedLod = Math.max(0, Math.min(1, reedLod));
  return Math.pow(clampedLod, REED_LOD_OPACITY_POWER);
}

export function isReedLodVisible(reedLod: number): boolean {
  return reedLod >= REED_LOD_VISIBILITY_THRESHOLD;
}

/** First-person mode always uses full close grass/dirt LOD around the player. */
export function resolveCloseGroundLod(
  cameraDistance: number,
  firstPersonActive: boolean,
): { grassOpacity: number; dirtGate: number } {
  if (firstPersonActive) {
    return { grassOpacity: 1, dirtGate: 1 };
  }
  const gate = dirtZoomGate(cameraDistance);
  return { grassOpacity: gate, dirtGate: gate };
}

export function isGrassBladeZoomActive(cameraDistance: number): boolean {
  return grassBladeLodOpacity(grassBladeRevealOpacity(cameraDistance)) > 0.02;
}

export function isReedZoomActive(cameraDistance: number): boolean {
  return isReedLodVisible(reedRevealOpacity(cameraDistance));
}

/** 0 above 50% zoom → 1 at 45% zoom and below. */
export function mapIconRevealOpacity(zoomPercent: number): number {
  if (zoomPercent > MAP_ICON_MAX_ZOOM_PERCENT) return 0;
  if (zoomPercent <= MAP_ICON_FADE_START_ZOOM_PERCENT) return 1;
  const t = (MAP_ICON_MAX_ZOOM_PERCENT - zoomPercent)
    / (MAP_ICON_MAX_ZOOM_PERCENT - MAP_ICON_FADE_START_ZOOM_PERCENT);
  return t * t * (3 - 2 * t);
}

export function isMapIconZoomActive(zoomPercent: number): boolean {
  return mapIconRevealOpacity(zoomPercent) > 0.02;
}

/** 1 near focus, 0 at outer radius — matches streamed grass tuft falloff. */
export function grassEdgeFadeFromFocusDistance(focusDist: number): number {
  const inner = GRASS_BLADE_NEAR_RADIUS - GRASS_EDGE_FADE_BAND;
  const outer = GRASS_BLADE_NEAR_RADIUS;
  const t = Math.max(0, Math.min(1, (focusDist - inner) / (outer - inner)));
  const smooth = t * t * (3 - 2 * t);
  return Math.pow(1 - smooth, 1.35);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
