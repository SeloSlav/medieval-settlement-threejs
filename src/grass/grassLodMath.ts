/** Matches CameraController default orbit distance at 100% zoom. */
export const BASELINE_CAMERA_DISTANCE = 88;

/** SeedThree grass, wildflowers, and reeds reach full strength here. */
export const CLOSE_GROUND_FULL_ZOOM_PERCENT = 400;

/**
 * Close vegetation starts fading in above 200% and reaches full strength at
 * 400%. Grass, wildflowers, and cattails all consume this same gate.
 */
export const CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 200;

/** World quarry map icons appear at this zoom and below. */
export const MAP_ICON_MAX_ZOOM_PERCENT = 50;

/** Map icons reach full opacity below this zoom. */
export const MAP_ICON_FADE_START_ZOOM_PERCENT = 45;

/** Brown soil is fully active only at a much closer, ground-level zoom. */
export const DIRT_REVEAL_ZOOM_PERCENT = 650;

/**
 * Brown soil begins shortly after SeedThree groundcover reaches full opacity.
 * This keeps the meadow intact until the authored grass is visually complete.
 */
export const DIRT_FADE_START_ZOOM_PERCENT = 425;

/** Pow easing on the zoom gate (< 1 = detail ramps in gradually across the fade band). */
export const DIRT_BLEND_EASE = 0.72;

/** Orbit distances matching the 425% / 650% brown-soil zoom band. */
export const TERRAIN_DIRT_CLOSE_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_REVEAL_ZOOM_PERCENT / 100);

export const TERRAIN_DIRT_FAR_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (DIRT_FADE_START_ZOOM_PERCENT / 100);

/** Orbit distances matching the 200% / 400% close-vegetation zoom band. */
export const CLOSE_GROUND_FULL_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FULL_ZOOM_PERCENT / 100);

export const CLOSE_GROUND_FADE_START_DISTANCE =
  BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FADE_START_ZOOM_PERCENT / 100);

/** Horizontal radius (world units) where close dirt is visible around the camera. */
export const DIRT_PROXIMITY_INNER = 26;

export const DIRT_PROXIMITY_OUTER = 78;

export const DIRT_PROXIMITY_INNER_SQ = DIRT_PROXIMITY_INNER * DIRT_PROXIMITY_INNER;

export const DIRT_PROXIMITY_OUTER_SQ = DIRT_PROXIMITY_OUTER * DIRT_PROXIMITY_OUTER;

/** SeedThree grass, wildflowers, and cattails share the close-ground zoom band. */
export const GRASS_BLADE_REVEAL = {
  close: CLOSE_GROUND_FULL_DISTANCE,
  far: CLOSE_GROUND_FADE_START_DISTANCE,
} as const;

/** Horizontal radius where 3D grass tufts render — fades before dirt ends. */
export const GRASS_BLADE_NEAR_RADIUS = 62;

/** Tighter stream disc while walking in first person — enough cover, fewer chunks. */
export const GRASS_BLADE_NEAR_RADIUS_FIRST_PERSON = 46;

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

/** Brown-soil transition: 0 at 425% zoom, 1 at 650%. */
export function dirtZoomGate(cameraDistance: number): number {
  const t = smoothstep(TERRAIN_DIRT_CLOSE_DISTANCE, TERRAIN_DIRT_FAR_DISTANCE, cameraDistance);
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

/** SeedThree vegetation transition: 0 at 200% zoom, 1 at 400%. */
export function closeGroundVegetationGate(cameraDistance: number): number {
  const t = smoothstep(
    CLOSE_GROUND_FULL_DISTANCE,
    CLOSE_GROUND_FADE_START_DISTANCE,
    cameraDistance,
  );
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

/**
 * Cattails enter with the other close vegetation immediately above 200%.
 * Their steeper opacity curve keeps the alpha-tested cards subtle at the
 * beginning of the shared transition.
 */
export const REED_LOD_VISIBILITY_THRESHOLD = 0;
export const REED_LOD_OPACITY_POWER = 2;

/**
 * SeedThree grass blades use the wider close-vegetation transition. The eased
 * opacity keeps their alpha-tested cards subtle at the beginning of the blend.
 */
export const GRASS_BLADE_LOD_VISIBILITY_THRESHOLD = 0;
export const GRASS_BLADE_LOD_OPACITY_POWER = 1.35;

/**
 * Keep the streamed meshes alive across a very small opacity dead-band.
 * Entering and leaving the 200% boundary therefore cannot alternate the
 * entire groundcover submission when the camera hovers on the threshold.
 */
export const GRASS_BLADE_VISIBILITY_ENTER_OPACITY = 0.003;
export const GRASS_BLADE_VISIBILITY_EXIT_OPACITY = 0.0005;

export function grassBladeRevealOpacity(cameraDistance: number): number {
  return closeGroundVegetationGate(cameraDistance);
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
  return closeGroundVegetationGate(cameraDistance);
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
  return reedLod > REED_LOD_VISIBILITY_THRESHOLD;
}

/** First-person mode always uses full close grass/dirt LOD around the player. */
export function resolveCloseGroundLod(
  cameraDistance: number,
  firstPersonActive: boolean,
): { grassOpacity: number; dirtGate: number } {
  if (firstPersonActive) {
    return { grassOpacity: 1, dirtGate: 1 };
  }
  return {
    grassOpacity: closeGroundVegetationGate(cameraDistance),
    dirtGate: dirtZoomGate(cameraDistance),
  };
}

export function isGrassBladeZoomActive(cameraDistance: number): boolean {
  return grassBladeLodOpacity(grassBladeRevealOpacity(cameraDistance)) > 0;
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
