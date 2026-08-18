/** Matches CameraController default orbit distance at 100% zoom. */
export const BASELINE_CAMERA_DISTANCE = 88;

/** SeedThree grass, wildflowers, cattails, and lily pads reach full strength here. */
export const CLOSE_GROUND_FULL_ZOOM_PERCENT = 400;

/**
 * Close vegetation starts fading in above 200% and reaches full strength at
 * 400%. Grass, wildflowers, cattails, and lily pads consume this shared gate.
 */
export const CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 200;

/** World quarry map icons appear at this zoom and below. */
export const MAP_ICON_MAX_ZOOM_PERCENT = 50;

/** Map icons reach full opacity below this zoom. */
export const MAP_ICON_FADE_START_ZOOM_PERCENT = 45;

/** Brown soil is fully active only at a much closer, ground-level zoom. */
export const DIRT_REVEAL_ZOOM_PERCENT = 650;

/** Brown soil starts its gradual handoff alongside close ground vegetation. */
export const DIRT_FADE_START_ZOOM_PERCENT = CLOSE_GROUND_FADE_START_ZOOM_PERCENT;

/** Pow easing on the zoom gate (< 1 = detail ramps in gradually across the fade band). */
export const DIRT_BLEND_EASE = 0.72;

/** Orbit distances matching the 200% / 650% brown-soil zoom band. */
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

/** SeedThree grass, wildflowers, cattails, and lily pads share this zoom band. */
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

/**
 * Target full-size tufts scattered per chunk. Together with the 70% micro
 * underfill in GrassBladeField this resolves to roughly 2.35x the former
 * close-meadow population without changing the streamed radius.
 */
export const GRASS_TUFTS_PER_CHUNK = 192;

/** Dense woodland keeps isolated tufts without recreating a meadow carpet. */
export const FOREST_GRASS_RENDER_DENSITY_MULTIPLIER = 0.25;

export function grassTuftTargetForForestBlend(
  baseTarget: number,
  forestBlend: number,
): number {
  const blend = Math.max(0, Math.min(1, forestBlend));
  const densityMultiplier = 1 + (
    FOREST_GRASS_RENDER_DENSITY_MULTIPLIER - 1
  ) * blend;
  return Math.max(1, Math.round(baseTarget * densityMultiplier));
}

export function grassMicroTuftTargetForForestBlend(
  tuftTarget: number,
  forestBlend: number,
): number {
  const blend = Math.max(0, Math.min(1, forestBlend));
  return Math.floor(tuftTarget * 0.7 * (1 - blend));
}

/** Extra scatter attempts budget per chunk. */
export const GRASS_TUFT_SCATTER_ATTEMPTS = Math.ceil(GRASS_TUFTS_PER_CHUNK * 1.8);

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

/** Brown-soil transition: 0 at 200% zoom, 1 at 650%. */
export function dirtZoomGate(cameraDistance: number): number {
  const t = smoothstep(TERRAIN_DIRT_CLOSE_DISTANCE, TERRAIN_DIRT_FAR_DISTANCE, cameraDistance);
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

/** Close-ground vegetation transition: 0 at 200% zoom, 1 at 400%. */
export function closeGroundVegetationGate(cameraDistance: number): number {
  const t = smoothstep(
    CLOSE_GROUND_FULL_DISTANCE,
    CLOSE_GROUND_FADE_START_DISTANCE,
    cameraDistance,
  );
  return Math.pow(1 - t, DIRT_BLEND_EASE);
}

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

/** Cattail cards use the exact same reveal curve as ground grass blades. */
export function reedRevealOpacity(cameraDistance: number): number {
  return grassBladeLodOpacity(grassBladeRevealOpacity(cameraDistance));
}

export function resolveReedLod(cameraDistance: number, firstPersonActive: boolean): number {
  if (firstPersonActive) return 1;
  return reedRevealOpacity(cameraDistance);
}

export function reedLodOpacity(reedLod: number): number {
  return Math.max(0, Math.min(1, reedLod));
}

export function isReedLodVisible(reedLod: number): boolean {
  return reedLod > 0;
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
