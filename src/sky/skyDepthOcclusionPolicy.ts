/** Sky depth chosen beyond every authored opaque world surface, but inside camera far=2600. */
export const SKY_DEPTH_OCCLUSION_RADIUS = 2_500;

/** Opaque render ordering is ascending; this keeps the sky after world opaques and before transparents. */
export const SKY_OPAQUE_LAST_RENDER_ORDER = 1_000;

/** Conservative authored vertical envelope for terrain, structures, vegetation, and orbit height. */
export const WORLD_OPAQUE_VERTICAL_ENVELOPE = 384;

export function maximumOpaqueWorldDistanceFromCamera(options: {
  terrainSize: number;
  playableSize: number;
  maxOrbitDistance: number;
  verticalEnvelope?: number;
}): number {
  const terrainHalf = Math.max(0, options.terrainSize) * 0.5;
  const playableHalf = Math.max(0, options.playableSize) * 0.5;
  // The camera target is clamped to the playable square. Adding the complete
  // orbit distance (rather than its horizontal projection) is conservative for
  // every pitch/yaw and every opposite terrain corner.
  const horizontalReach = Math.SQRT2 * (terrainHalf + playableHalf)
    + Math.max(0, options.maxOrbitDistance);
  return Math.hypot(
    horizontalReach,
    Math.max(0, options.verticalEnvelope ?? WORLD_OPAQUE_VERTICAL_ENVELOPE),
  );
}
