import {
  type ResidenceFacadeColor,
} from '../buildings/buildingMaterials.ts';
import { mulberry32, pick } from '../utils/random.ts';

export type FacadeColor = ResidenceFacadeColor;
export type RoofColor = 'brown';
export type ResidenceArchetype = 'stone_portal' | 'timber_balcony' | 'working_lean_to';
export type ResidenceTrimColor = 'wood' | 'red' | 'blue' | 'green';

export type ResidenceAppearance = {
  facade: FacadeColor;
  roof: RoofColor;
  archetype: ResidenceArchetype;
  entrySide: -1 | 1;
  trim: ResidenceTrimColor;
};

const FACADE_COLORS: readonly FacadeColor[] = [
  'white',
  'yellow',
  'grey',
  'lightOrange',
  'orange',
] as const;

const ARCHETYPES: readonly ResidenceArchetype[] = [
  'stone_portal',
  'stone_portal',
  'timber_balcony',
  'timber_balcony',
  'working_lean_to',
] as const;

const TRIM_COLORS: readonly ResidenceTrimColor[] = [
  'wood',
  'wood',
  'red',
  'blue',
  'green',
] as const;

const ENTRY_SIDES = [-1, 1] as const;

export function pickResidenceAppearance(seed: number): ResidenceAppearance {
  const rng = mulberry32(seed);
  const facade = pick(FACADE_COLORS, rng);
  // Keep the established seeded construction sequence stable. The completed
  // roof covering is authoritative per-residence state, not a random roll.
  rng();
  const roof: RoofColor = 'brown';
  const archetype = pick(ARCHETYPES, rng);
  const entrySide = pick(ENTRY_SIDES, rng);
  const trim = pick(TRIM_COLORS, rng);
  return { facade, roof, archetype, entrySide, trim };
}

export function residenceGroundDoorLocalX(
  appearance: Pick<ResidenceAppearance, 'archetype' | 'entrySide'>,
): number {
  return appearance.entrySide * (appearance.archetype === 'working_lean_to' ? 1.18 : 1.38);
}
