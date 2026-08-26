export type MutableOxFollowPosition = {
  x: number;
  z: number;
};

/**
 * Moves a following ox on every frame that has a measurable target delta.
 * Exact terminal locking avoids both residual drift and the old 2.5 cm dead
 * zone that made a slowly moving target advance on alternating frames.
 */
export function advanceOxFollowPosition(
  position: MutableOxFollowPosition,
  targetX: number,
  targetZ: number,
  maxDistance: number,
): boolean {
  const dx = targetX - position.x;
  const dz = targetZ - position.z;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq <= 1e-12) return false;

  const distance = Math.sqrt(distanceSq);
  const step = Math.min(distance, Math.max(0, maxDistance));
  if (step <= 0) return false;
  if (step >= distance) {
    position.x = targetX;
    position.z = targetZ;
  } else {
    position.x += dx / distance * step;
    position.z += dz / distance * step;
  }
  return true;
}
