import type { PointXZ } from '../utils/pathGeometry.ts';

export const HUNTING_DRAW_SECONDS = 2.8;
export const HUNTING_RECOVERY_SECONDS = 0.45;
export const HUNTING_SHOT_SECONDS = HUNTING_DRAW_SECONDS + HUNTING_RECOVERY_SECONDS;
export const HUNTING_WALK_BETWEEN_SHOTS = 8;

/** Live presentation targets; hunting never changes authoritative game stock. */
export type HuntingTarget = PointXZ & {
  id: string;
  nodeId: string;
  y: number;
  active: boolean;
};

export type HuntingTargetQuery = PointXZ & {
  nodeId: string;
  areaX: number;
  areaZ: number;
  areaRadius: number;
  preferredId?: string;
};

export function findHuntingTarget(
  targets: Iterable<HuntingTarget>,
  query: HuntingTargetQuery,
): HuntingTarget | null {
  let nearest: HuntingTarget | null = null;
  let nearestDistanceSq = 36 * 36;
  for (const target of targets) {
    if (!target.active || target.nodeId !== query.nodeId) continue;
    const areaDistanceSq = (target.x - query.areaX) ** 2 + (target.z - query.areaZ) ** 2;
    if (areaDistanceSq > query.areaRadius ** 2) continue;
    const distanceSq = (target.x - query.x) ** 2 + (target.z - query.z) ** 2;
    // Leave room for the full bow draw, and never fall back to a melee weapon.
    if (distanceSq < 4 * 4 || distanceSq > 36 * 36) continue;
    if (target.id === query.preferredId) return target;
    if (distanceSq <= nearestDistanceSq) {
      nearest = target;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest;
}

/** A single cooldown wrap releases the arrow, followed by a short recovery. */
export function huntingShotCooldown(remainingSeconds: number): number {
  const remaining = Math.max(0, Math.min(HUNTING_SHOT_SECONDS, remainingSeconds));
  return remaining > HUNTING_RECOVERY_SECONDS
    ? remaining - HUNTING_RECOVERY_SECONDS
    : HUNTING_DRAW_SECONDS + remaining - HUNTING_RECOVERY_SECONDS;
}
