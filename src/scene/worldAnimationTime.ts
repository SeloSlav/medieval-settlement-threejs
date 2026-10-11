import { frameGroup, uniform } from 'three/tsl';

type ScalarTimeUniform = {
  value: number;
};

/**
 * Shared shader clock for world motion. SceneManager advances it with the
 * pause-aware world delta, so materials never fall back to wall-clock time.
 */
// Every wind/water material reads the same clock. Keep it out of per-object
// uniform buffers so advancing time does not reupload every static object.
export const worldAnimationTime = (uniform(0) as unknown as {
  setGroup(group: unknown): ScalarTimeUniform;
}).setGroup(frameGroup);

export function setWorldAnimationTime(seconds: number): void {
  worldAnimationTime.value = Math.max(0, seconds);
}
