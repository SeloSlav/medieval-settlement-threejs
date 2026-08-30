import type { GameClock } from '../world/gameCalendar.ts';

export const CLERIC_AUTHORED_ANIMATION_NAMES = [
  'laugh_01',
  'sit',
  'flee_01',
  'greet_01',
  'look_around',
  'wait',
  'hit_to_body_01',
  'lift_heavy',
  'fall',
  'slash',
  'greet_04',
  'shovel',
  'agree',
  'dig',
  'bow',
  'standing_relax',
  'chop',
  'walk',
  'idle',
  'run',
] as const;

export type ClericAuthoredAnimationName =
  typeof CLERIC_AUTHORED_ANIMATION_NAMES[number];

export type ClericAnimationMode =
  | 'relax'
  | 'look'
  | 'wait'
  | 'laugh'
  | 'greet'
  | 'sermon'
  | 'agree'
  | 'bow'
  | 'carry'
  | 'hurt'
  | 'fall'
  | 'flee'
  | 'run';

export type ClericDuty =
  | 'interior_prayer'
  | 'interior_study'
  | 'churchyard_prayer'
  | 'parish_visit'
  | 'sermon_rehearsal'
  | 'cloister_prayer'
  | 'scriptorium'
  | 'infirmary_care'
  | 'hospitality'
  | 'brewing'
  | 'harvest'
  | 'soil_work'
  | 'pruning'
  | 'livestock_care'
  | 'ox_guidance';

const DUTY_ANIMATIONS: Readonly<Record<ClericDuty, readonly string[]>> = {
  interior_prayer: ['wait', 'bow', 'sit'],
  interior_study: ['sit', 'relax', 'look'],
  churchyard_prayer: ['bow', 'wait', 'look'],
  parish_visit: ['greet', 'agree', 'laugh', 'sermon'],
  sermon_rehearsal: ['sermon', 'agree', 'greet'],
  cloister_prayer: ['bow', 'wait', 'look', 'relax'],
  scriptorium: ['sit', 'look', 'relax'],
  infirmary_care: ['agree', 'greet', 'carry'],
  hospitality: ['greet', 'laugh', 'agree', 'sermon'],
  brewing: ['carry', 'tend'],
  harvest: ['gather', 'carry'],
  soil_work: ['mine', 'sow'],
  pruning: ['fight', 'chop'],
  // These reactions are deliberately rare but readable: livestock can jostle
  // a handler, trip them, or make them jump clear without inventing combat.
  livestock_care: ['tend', 'hurt', 'fall', 'flee'],
  ox_guidance: ['agree', 'sermon', 'carry'],
};

export function isClericWorkplaceKind(kind: string | null | undefined): boolean {
  return kind === 'chapel' || kind === 'monastery';
}

export function clericDutyAnimation(
  duty: ClericDuty | null | undefined,
  seed: number,
): string {
  const candidates = duty ? DUTY_ANIMATIONS[duty] : null;
  if (!candidates || candidates.length === 0) return clericIdleAnimation(seed);
  return candidates[Math.abs(Math.trunc(seed)) % candidates.length] ?? 'relax';
}

export function clericIdleAnimation(seed: number): 'idle' | 'relax' | 'look' | 'wait' {
  const candidates = ['idle', 'relax', 'look', 'wait'] as const;
  return candidates[Math.abs(Math.trunc(seed)) % candidates.length] ?? 'idle';
}

export function clericMassAnimation(
  phase: 'assembly' | 'service' | 'fellowship',
  seed: number,
): string {
  const candidates = phase === 'assembly'
    ? ['sermon', 'greet', 'bow', 'agree']
    : phase === 'service'
      ? ['bow', 'wait']
      : ['greet', 'laugh', 'agree', 'relax'];
  return candidates[Math.abs(Math.trunc(seed)) % candidates.length] ?? 'relax';
}

/**
 * Off-duty workers with no household harvest periodically step indoors instead
 * of occupying the doorway or front yard for an entire paused workday.
 */
export function isDaytimeHouseholdIndoorPause(
  personIdentity: string,
  clock: Pick<GameClock, 'hour' | 'minute'>,
): boolean {
  const hour = clock.hour + clock.minute / 60;
  if (hour < 8 || hour >= 19) return false;
  let hash = 2_166_136_261;
  for (let index = 0; index < personIdentity.length; index += 1) {
    hash ^= personIdentity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const stagger = (hash >>> 0) % 105 / 60;
  const cycle = ((hour - 8 + stagger) % 3.5 + 3.5) % 3.5;
  return cycle >= 2.45;
}
