export const BREWERY_RECIPE_ALE = 0;
export const BREWERY_RECIPE_CIDER_APPLES = 1;
export const BREWERY_RECIPE_MEAD = 2;
export const BREWERY_RECIPE_AUTO = 3;
export const BREWERY_RECIPE_CIDER_PEARS = 4;

export type BreweryRecipePolicy =
  | typeof BREWERY_RECIPE_ALE
  | typeof BREWERY_RECIPE_CIDER_APPLES
  | typeof BREWERY_RECIPE_MEAD
  | typeof BREWERY_RECIPE_AUTO
  | typeof BREWERY_RECIPE_CIDER_PEARS;

export type BreweryRecipeInput =
  | 'barley'
  | 'malt'
  | 'water'
  | 'firewood'
  | 'apples'
  | 'pears'
  | 'honey';

export const BREWERY_RECIPE_PRESETS = [
  {
    policy: BREWERY_RECIPE_ALE,
    label: 'Ale',
    hint: 'Malt barley, then brew it with water and firewood.',
  },
  {
    policy: BREWERY_RECIPE_CIDER_APPLES,
    label: 'Cider · apples',
    hint: 'Press 2 apples into 1 cider.',
  },
  {
    policy: BREWERY_RECIPE_CIDER_PEARS,
    label: 'Cider · pears',
    hint: 'Press 2 pears into 1 cider.',
  },
  {
    policy: BREWERY_RECIPE_MEAD,
    label: 'Mead',
    hint: 'Ferment 1 honey into 1 mead.',
  },
  {
    policy: BREWERY_RECIPE_AUTO,
    label: 'Auto',
    hint: 'Brew with the most plentiful ingredients on hand.',
  },
] as const;

export function normalizeBreweryRecipePolicy(
  policy: number | undefined,
): BreweryRecipePolicy {
  return policy === BREWERY_RECIPE_CIDER_APPLES
    || policy === BREWERY_RECIPE_MEAD
    || policy === BREWERY_RECIPE_AUTO
    || policy === BREWERY_RECIPE_CIDER_PEARS
    ? policy
    : BREWERY_RECIPE_ALE;
}

export function breweryRecipePolicyLabel(policy: number | undefined): string {
  const normalized = normalizeBreweryRecipePolicy(policy);
  return BREWERY_RECIPE_PRESETS.find((preset) => preset.policy === normalized)?.label ?? 'Ale';
}

/**
 * Recipe focus governs new supply requests, not physical storage. Auto may
 * stage every route; a focused Brewery requests only its selected recipe.
 */
export function breweryRecipeRequestsInput(
  policy: number | undefined,
  input: BreweryRecipeInput,
): boolean {
  const normalized = normalizeBreweryRecipePolicy(policy);
  if (normalized === BREWERY_RECIPE_AUTO) return true;
  switch (input) {
    case 'barley':
    case 'malt':
    case 'water':
    case 'firewood':
      return normalized === BREWERY_RECIPE_ALE;
    case 'apples':
      return normalized === BREWERY_RECIPE_CIDER_APPLES;
    case 'pears':
      return normalized === BREWERY_RECIPE_CIDER_PEARS;
    case 'honey':
      return normalized === BREWERY_RECIPE_MEAD;
  }
}

export type BreweryBeverageCommodity = 'ale' | 'cider' | 'mead';

export type BreweryRecipeInventory = {
  barley?: number;
  malt?: number;
  apples?: number;
  pears?: number;
  honey?: number;
};

export function selectedBreweryRecipePolicy(
  policy: number | undefined,
  inventory: BreweryRecipeInventory,
): Exclude<BreweryRecipePolicy, typeof BREWERY_RECIPE_AUTO> {
  const normalized = normalizeBreweryRecipePolicy(policy);
  if (normalized !== BREWERY_RECIPE_AUTO) return normalized;
  const candidates = [
    {
      policy: BREWERY_RECIPE_ALE,
      readiness: Math.max(
        Math.max(0, inventory.malt ?? 0) / BREWERY_MALT_PER_ALE_CYCLE,
        Math.max(0, inventory.barley ?? 0) / BREWERY_BARLEY_PER_MALT_CYCLE,
      ),
    },
    {
      policy: BREWERY_RECIPE_CIDER_APPLES,
      readiness: Math.max(0, inventory.apples ?? 0) / BREWERY_FRUIT_PER_CIDER_CYCLE,
    },
    {
      policy: BREWERY_RECIPE_CIDER_PEARS,
      readiness: Math.max(0, inventory.pears ?? 0) / BREWERY_FRUIT_PER_CIDER_CYCLE,
    },
    {
      policy: BREWERY_RECIPE_MEAD,
      readiness: Math.max(0, inventory.honey ?? 0) / BREWERY_HONEY_PER_MEAD_CYCLE,
    },
  ] as const;
  return candidates.reduce((best, candidate) =>
    candidate.readiness > best.readiness ? candidate : best,
  ).policy;
}

export function breweryPolicyOutput(
  policy: number | undefined,
  inventory: BreweryRecipeInventory = {},
): BreweryBeverageCommodity {
  switch (selectedBreweryRecipePolicy(policy, inventory)) {
    case BREWERY_RECIPE_CIDER_APPLES:
      return 'cider';
    case BREWERY_RECIPE_CIDER_PEARS:
      return 'cider';
    case BREWERY_RECIPE_MEAD:
      return 'mead';
    default:
      return 'ale';
  }
}
import {
  BREWERY_FRUIT_PER_CIDER_CYCLE,
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_HONEY_PER_MEAD_CYCLE,
  BREWERY_MALT_PER_ALE_CYCLE,
} from '../generated/gameBalance.ts';
