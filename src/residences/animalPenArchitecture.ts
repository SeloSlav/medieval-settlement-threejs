import type { BackyardGardenKind } from '../generated/gameBalance.ts';

export const ANIMAL_PEN_KINDS = [
  'animal_pen',
  'chicken_pen',
  'goat_pen',
  'pig_pen',
] as const satisfies readonly BackyardGardenKind[];

export type AnimalPenKind = typeof ANIMAL_PEN_KINDS[number];
export type AnimalPenVisualSpecies = 'unstocked' | 'chickens' | 'goats' | 'pigs';
export type AnimalPenShelterTypology =
  | 'open-gable-stock-shelter'
  | 'raised-boarded-henhouse'
  | 'deep-eave-goat-shed'
  | 'low-walled-pigsty';
export type AnimalPenFixture =
  | 'water-trough'
  | 'nesting-boxes'
  | 'roost-ramp'
  | 'hay-rack'
  | 'milking-stand'
  | 'mud-wallow';

export type AnimalPenVisualPlan = {
  seed: number;
  species: AnimalPenVisualSpecies;
  typology: AnimalPenShelterTypology;
  footprint: { width: number; depth: number };
  enclosure: {
    owner: 'residence-perimeter';
  };
  shelter: {
    x: number;
    z: number;
    width: number;
    depth: number;
    foundationHeight: number;
    eaveHeight: number;
    ridgeHeight: number;
    frontOpeningWidth: number;
  };
  trough: {
    x: number;
    z: number;
    width: number;
    depth: number;
    wallHeight: number;
    bottomThickness: number;
    waterDepth: number;
    rimClearance: number;
  };
  fixtures: readonly AnimalPenFixture[];
  diagnostics: {
    shelterInsideFootprint: boolean;
    troughInsideFootprint: boolean;
    shelterTroughClearance: number;
  };
};

export function isAnimalPenKind(kind: BackyardGardenKind): kind is AnimalPenKind {
  return (ANIMAL_PEN_KINDS as readonly BackyardGardenKind[]).includes(kind);
}

/**
 * Produces the serializable architecture shared by completed pens and their
 * construction state. The residence plot owns the outer enclosure; this plan
 * owns only the animal house and its purpose-built fixtures.
 */
export function createAnimalPenVisualPlan(
  kind: AnimalPenKind,
  width: number,
  depth: number,
  seed: number,
): AnimalPenVisualPlan {
  const species: AnimalPenVisualSpecies = kind === 'chicken_pen'
    ? 'chickens'
    : kind === 'goat_pen'
      ? 'goats'
      : kind === 'pig_pen'
        ? 'pigs'
        : 'unstocked';
  const typology: AnimalPenShelterTypology = species === 'chickens'
    ? 'raised-boarded-henhouse'
    : species === 'goats'
      ? 'deep-eave-goat-shed'
      : species === 'pigs'
        ? 'low-walled-pigsty'
        : 'open-gable-stock-shelter';
  const shelterSpec = species === 'chickens'
    ? { width: 2.3, depth: 1.65, eave: 1.28, ridge: 1.86, opening: 0.7 }
    : species === 'goats'
      ? { width: 2.95, depth: 1.95, eave: 1.52, ridge: 2.22, opening: 1.7 }
      : species === 'pigs'
        ? { width: 2.78, depth: 1.9, eave: 1.28, ridge: 1.82, opening: 1.34 }
        : { width: 2.72, depth: 1.82, eave: 1.42, ridge: 2.08, opening: 1.62 };
  const shelterWidth = Math.min(shelterSpec.width, Math.max(1.85, width * 0.48));
  const shelterDepth = Math.min(shelterSpec.depth, Math.max(1.35, depth * 0.5));
  const shelterX = -width * 0.5 + shelterWidth * 0.5 + 0.18;
  const shelterZ = -depth * 0.5 + shelterDepth * 0.5 + 0.16;
  const troughWidth = Math.min(species === 'chickens' ? 1.18 : 1.55, width * 0.34);
  const troughDepth = species === 'chickens' ? 0.46 : 0.56;
  const troughX = width * 0.5 - troughWidth * 0.5 - 0.3;
  const troughZ = depth * 0.5 - troughDepth * 0.5 - 0.34;
  const troughWallHeight = species === 'chickens' ? 0.28 : 0.36;
  const troughBottomThickness = 0.075;
  const waterDepth = species === 'chickens' ? 0.045 : 0.065;
  const rimClearance = troughWallHeight - troughBottomThickness - waterDepth;
  const fixtures: readonly AnimalPenFixture[] = species === 'chickens'
    ? ['water-trough', 'nesting-boxes', 'roost-ramp']
    : species === 'goats'
      ? ['water-trough', 'hay-rack', 'milking-stand']
      : species === 'pigs'
        ? ['water-trough', 'mud-wallow']
        : ['water-trough', 'hay-rack'];
  const shelterRight = shelterX + shelterWidth * 0.5;
  const troughLeft = troughX - troughWidth * 0.5;

  return {
    seed,
    species,
    typology,
    footprint: { width, depth },
    enclosure: { owner: 'residence-perimeter' },
    shelter: {
      x: shelterX,
      z: shelterZ,
      width: shelterWidth,
      depth: shelterDepth,
      foundationHeight: 0.16,
      eaveHeight: shelterSpec.eave,
      ridgeHeight: shelterSpec.ridge,
      frontOpeningWidth: Math.min(shelterSpec.opening, shelterWidth * 0.72),
    },
    trough: {
      x: troughX,
      z: troughZ,
      width: troughWidth,
      depth: troughDepth,
      wallHeight: troughWallHeight,
      bottomThickness: troughBottomThickness,
      waterDepth,
      rimClearance,
    },
    fixtures,
    diagnostics: {
      shelterInsideFootprint:
        Math.abs(shelterX) + shelterWidth * 0.5 <= width * 0.5 + 1e-6
        && Math.abs(shelterZ) + shelterDepth * 0.5 <= depth * 0.5 + 1e-6,
      troughInsideFootprint:
        Math.abs(troughX) + troughWidth * 0.5 <= width * 0.5 + 1e-6
        && Math.abs(troughZ) + troughDepth * 0.5 <= depth * 0.5 + 1e-6,
      shelterTroughClearance: troughLeft - shelterRight,
    },
  };
}
