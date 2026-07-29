import { uniform } from 'three/tsl';

type ScalarTimeUniform = {
  value: number;
};

/**
 * Shared shader clock for world motion. SceneManager advances it with the
 * pause-aware world delta, so materials never fall back to wall-clock time.
 */
export const worldAnimationTime = uniform(0) as unknown as ScalarTimeUniform;

export function setWorldAnimationTime(seconds: number): void {
  worldAnimationTime.value = Math.max(0, seconds);
}
