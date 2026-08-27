import {
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../generated/gameBalance.ts';

export const SMOKEHOUSE_RECIPE_AUTO = 0;
export const SMOKEHOUSE_RECIPE_CURED_MEAT = 1;
export const SMOKEHOUSE_RECIPE_SMOKED_FISH = 2;
export const SMOKEHOUSE_RECIPE_CHEESE = 3;

export type SmokehouseRecipePolicy =
  | typeof SMOKEHOUSE_RECIPE_AUTO
  | typeof SMOKEHOUSE_RECIPE_CURED_MEAT
  | typeof SMOKEHOUSE_RECIPE_SMOKED_FISH
  | typeof SMOKEHOUSE_RECIPE_CHEESE;

export type SmokehouseRecipeInput = 'meat' | 'fish' | 'milk';
export type SmokehouseRecipeOutput = 'curedMeat' | 'smokedFish' | 'cheese';
export type SmokehouseRecipeInventory = {
  meat?: number;
  fish?: number;
  milk?: number;
};

export const SMOKEHOUSE_RECIPE_PRESETS = [
  { policy: SMOKEHOUSE_RECIPE_AUTO, label: 'Auto' },
  { policy: SMOKEHOUSE_RECIPE_CURED_MEAT, label: 'Cured meat' },
  { policy: SMOKEHOUSE_RECIPE_SMOKED_FISH, label: 'Smoked fish' },
  { policy: SMOKEHOUSE_RECIPE_CHEESE, label: 'Cheese' },
] as const;

export function normalizeSmokehouseRecipePolicy(
  policy: number | undefined,
): SmokehouseRecipePolicy {
  return policy === SMOKEHOUSE_RECIPE_CURED_MEAT
    || policy === SMOKEHOUSE_RECIPE_SMOKED_FISH
    || policy === SMOKEHOUSE_RECIPE_CHEESE
    ? policy
    : SMOKEHOUSE_RECIPE_AUTO;
}

export function smokehouseRecipePolicyLabel(policy: number | undefined): string {
  const normalized = normalizeSmokehouseRecipePolicy(policy);
  return SMOKEHOUSE_RECIPE_PRESETS.find((preset) => preset.policy === normalized)?.label
    ?? 'Auto';
}

export function selectedSmokehouseRecipePolicy(
  policy: number | undefined,
  inventory: SmokehouseRecipeInventory,
): Exclude<SmokehouseRecipePolicy, typeof SMOKEHOUSE_RECIPE_AUTO> {
  const normalized = normalizeSmokehouseRecipePolicy(policy);
  if (normalized !== SMOKEHOUSE_RECIPE_AUTO) return normalized;
  if (Math.max(0, inventory.meat ?? 0) >= SMOKEHOUSE_FOOD_PER_CYCLE) {
    return SMOKEHOUSE_RECIPE_CURED_MEAT;
  }
  if (Math.max(0, inventory.fish ?? 0) >= SMOKEHOUSE_FOOD_PER_CYCLE) {
    return SMOKEHOUSE_RECIPE_SMOKED_FISH;
  }
  if (Math.max(0, inventory.milk ?? 0) >= SMOKEHOUSE_FOOD_PER_CYCLE) {
    return SMOKEHOUSE_RECIPE_CHEESE;
  }
  return SMOKEHOUSE_RECIPE_CURED_MEAT;
}

export function smokehouseRecipeInput(
  policy: Exclude<SmokehouseRecipePolicy, typeof SMOKEHOUSE_RECIPE_AUTO>,
): SmokehouseRecipeInput {
  if (policy === SMOKEHOUSE_RECIPE_SMOKED_FISH) return 'fish';
  if (policy === SMOKEHOUSE_RECIPE_CHEESE) return 'milk';
  return 'meat';
}

export function smokehouseRecipeOutput(
  policy: Exclude<SmokehouseRecipePolicy, typeof SMOKEHOUSE_RECIPE_AUTO>,
): SmokehouseRecipeOutput {
  if (policy === SMOKEHOUSE_RECIPE_SMOKED_FISH) return 'smokedFish';
  if (policy === SMOKEHOUSE_RECIPE_CHEESE) return 'cheese';
  return 'curedMeat';
}

export function smokehouseRecipeConversion(
  policy: Exclude<SmokehouseRecipePolicy, typeof SMOKEHOUSE_RECIPE_AUTO>,
): string {
  const input = smokehouseRecipeInput(policy);
  const output = smokehouseRecipeOutput(policy);
  const inputLabel = input === 'meat' ? 'meat' : input;
  const outputLabel = output === 'curedMeat'
    ? 'cured meat'
    : output === 'smokedFish'
      ? 'smoked fish'
      : 'cheese';
  return `${SMOKEHOUSE_FOOD_PER_CYCLE} ${inputLabel} + ${SMOKEHOUSE_FIREWOOD_PER_CYCLE} firewood + ${SMOKEHOUSE_SALT_PER_CYCLE} salt → ${SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE} ${outputLabel}`;
}
