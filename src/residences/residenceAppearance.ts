import {
  type ResidenceFacadeColor,
} from '../buildings/buildingMaterials.ts';
import { mulberry32, pick } from '../utils/random.ts';
import {
  ROOF_TONE_VARIANTS,
  type BuildingRoofTone,
} from '../buildings/buildingRoofTones.ts';

export type FacadeColor = ResidenceFacadeColor;
export type RoofColor = 'brown';
export type ResidenceArchetype = 'stone_portal' | 'timber_balcony' | 'working_lean_to';
export type ResidenceTrimColor = 'wood' | 'red' | 'blue' | 'green';
export type ResidenceRoofTone = BuildingRoofTone;
export type ResidenceFootprintProfile = 'narrow-deep' | 'balanced' | 'broad-shallow';
export type TierOneWallFinish = 'earthy-daub' | 'fieldstone' | 'weathered-timber';
export type TierOneWallFace = 'front' | 'rear' | 'left' | 'right';
export type TierOneWallPlan = Readonly<Record<TierOneWallFace, TierOneWallFinish>>;
export type TierThreeFeature = 'offset-dormer' | 'covered-gallery' | 'twin-annex';
export type TierFourGablePosition = -1 | 0 | 1;
export type TierTwoUpperFinish = 'boarded' | 'limewashed';

export type ResidenceAppearance = {
  facade: FacadeColor;
  roof: RoofColor;
  roofTone: ResidenceRoofTone;
  archetype: ResidenceArchetype;
  entrySide: -1 | 1;
  trim: ResidenceTrimColor;
  footprint: ResidenceFootprintProfile;
  tierOneWalls: TierOneWallPlan;
  tierThreeFeature: TierThreeFeature;
  tierFourGablePosition: TierFourGablePosition;
  tierTwoUpperFinish: TierTwoUpperFinish;
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

const FOOTPRINT_PROFILES: readonly ResidenceFootprintProfile[] = [
  'narrow-deep',
  'balanced',
  'balanced',
  'broad-shallow',
] as const;

// Every rough cottage uses all three local construction systems, with one or
// two full fieldstone walls. The presets are deliberate assemblies rather
// than independent face rolls, so no seed can produce four stone walls or an
// implausibly uniform starter house.
const TIER_ONE_WALL_PLANS: readonly TierOneWallPlan[] = [
  { front: 'earthy-daub', rear: 'fieldstone', left: 'weathered-timber', right: 'earthy-daub' },
  { front: 'fieldstone', rear: 'weathered-timber', left: 'earthy-daub', right: 'fieldstone' },
  { front: 'weathered-timber', rear: 'earthy-daub', left: 'fieldstone', right: 'weathered-timber' },
  { front: 'earthy-daub', rear: 'weathered-timber', left: 'fieldstone', right: 'earthy-daub' },
  { front: 'weathered-timber', rear: 'fieldstone', left: 'earthy-daub', right: 'fieldstone' },
] as const;

const TIER_THREE_FEATURES: readonly TierThreeFeature[] = [
  'offset-dormer',
  'covered-gallery',
  'twin-annex',
] as const;

const TIER_FOUR_GABLE_POSITIONS: readonly TierFourGablePosition[] = [
  -1,
  0,
  0,
  1,
] as const;

export function pickResidenceAppearance(seed: number): ResidenceAppearance {
  const rng = mulberry32(seed);
  const facade = pick(FACADE_COLORS, rng);
  // Reuse the old reserved roof roll so the established archetype, entry, and
  // trim sequence remains stable while roofs gain a bounded earthy tone.
  const roofTone = pick(ROOF_TONE_VARIANTS, rng);
  const roof: RoofColor = 'brown';
  const archetype = pick(ARCHETYPES, rng);
  const entrySide = pick(ENTRY_SIDES, rng);
  const trim = pick(TRIM_COLORS, rng);
  const footprint = pick(FOOTPRINT_PROFILES, rng);
  const tierOneWalls = pick(TIER_ONE_WALL_PLANS, rng);
  const tierThreeFeature = pick(TIER_THREE_FEATURES, rng);
  const tierFourGablePosition = pick(TIER_FOUR_GABLE_POSITIONS, rng);
  const tierTwoUpperFinish = pick(['boarded', 'boarded', 'limewashed'] as const, rng);
  return {
    facade,
    roof,
    roofTone,
    archetype,
    entrySide,
    trim,
    footprint,
    tierOneWalls,
    tierThreeFeature,
    tierFourGablePosition,
    tierTwoUpperFinish,
  };
}

export function residenceGroundDoorLocalX(
  appearance: Pick<ResidenceAppearance, 'archetype' | 'entrySide'>,
): number {
  return appearance.entrySide * (appearance.archetype === 'working_lean_to' ? 1.18 : 1.38);
}
