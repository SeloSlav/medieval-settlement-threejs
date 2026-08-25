import type {
  FootstepEvent,
  FootstepSurface,
} from './audioCatalog.ts';

export type FootstepPlaybackTuning = {
  gain: number;
  playbackRate: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deterministicUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export type FootstepVariant = 1 | 2 | 3;

/**
 * Creates one deterministic shuffled bag containing every authored take.
 * Its first take is swapped when necessary to prevent a repeat at the join.
 */
export function buildFootstepVariantBag(
  surface: FootstepSurface,
  bagSequence: number,
  previousVariant: number,
): FootstepVariant[] {
  const variants: FootstepVariant[] = [1, 2, 3];
  for (let index = variants.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      deterministicUnit(`${surface}:bag:${bagSequence}:${index}`) * (index + 1),
    );
    [variants[index], variants[swapIndex]] = [variants[swapIndex], variants[index]];
  }
  if (variants[0] === previousVariant) {
    const swapIndex = 1 + Math.floor(
      deterministicUnit(`${surface}:join:${bagSequence}`) * 2,
    );
    [variants[0], variants[swapIndex]] = [variants[swapIndex], variants[0]];
  }
  return variants;
}

/**
 * Gives each contact a small shoe-side identity and seeded micro-variation.
 * Sprint contacts are quicker/heavier; crouch contacts remain close and quiet.
 */
export function resolveFootstepPlaybackTuning(
  event: FootstepEvent,
  sequence: number,
): FootstepPlaybackTuning {
  const speed = clamp(event.speedRatio, 0, 1);
  let gain: number;
  let playbackRate: number;

  switch (event.gait) {
    case 'crouch':
      gain = 0.58 + speed * 0.13;
      playbackRate = 0.955 + speed * 0.018;
      break;
    case 'sprint':
      gain = 1.06 + speed * 0.18;
      playbackRate = 1.025 + speed * 0.045;
      break;
    case 'landing':
      gain = 1.13 + speed * 0.13;
      playbackRate = 0.95 + speed * 0.025;
      break;
    default:
      gain = 0.84 + speed * 0.16;
      playbackRate = 0.975 + speed * 0.025;
      break;
  }

  const surfaceGain = event.surface === 'water'
    ? 1.08
    : event.surface === 'forest'
      ? 0.96
      : event.surface === 'grass'
        ? 0.94
        : 1;
  const surfaceRate = event.surface === 'water'
    ? -0.018
    : event.surface === 'forest'
      ? -0.01
      : event.surface === 'dirt'
        ? 0.006
        : 0;
  const sideGain = event.side === 'left' ? 0.985 : 1.015;
  const sideRate = event.side === 'left' ? -0.006 : 0.006;
  const seed = `${event.surface}:${event.gait}:${event.side}:${sequence}`;
  const gainJitter = 0.94 + deterministicUnit(`${seed}:gain`) * 0.12;
  const rateJitter = -0.022 + deterministicUnit(`${seed}:pitch`) * 0.044;

  return {
    gain: clamp(gain * surfaceGain * sideGain * gainJitter, 0.45, 1.35),
    playbackRate: clamp(
      playbackRate + surfaceRate + sideRate + rateJitter,
      0.92,
      1.12,
    ),
  };
}
