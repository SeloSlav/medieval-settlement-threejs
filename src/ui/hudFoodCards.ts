import { FLOUR_KINDS, GRAIN_SHEAF_KINDS, type GrainSheafKind, type FlourKind } from '../economy/cropGoods.ts';
import {
  FOOD_CATEGORY_LABELS, FOOD_MEAL_VALUES, foodCategory,
  FRESH_FOOD_KINDS, PRESERVED_FOOD_KINDS, type FoodInventoryKind,
} from '../economy/foodInventory.ts';
import { resourceCostLabel } from './resourceCost.ts';
import { RESOURCE_DESCRIPTIONS, foodResourceTooltip } from './resourceDescriptions.ts';

export type HudFoodResourceKind = FoodInventoryKind | GrainSheafKind | FlourKind
  | 'ryeGrain' | 'maslinGrain' | 'barley' | 'malt';

type HudFoodGroup = Readonly<{
  id: string;
  label: string;
  kinds: readonly HudFoodResourceKind[];
}>;

const edibleKinds = [...FRESH_FOOD_KINDS, ...PRESERVED_FOOD_KINDS, 'honey'] as const;

/** Include the whole food chain without treating unprocessed crops as meals. */
export const HUD_FOOD_GROUPS: readonly HudFoodGroup[] = [
  { id: 'sheaves', label: 'Sheaves', kinds: GRAIN_SHEAF_KINDS },
  { id: 'rawGrains', label: 'Grains & malt', kinds: ['ryeGrain', 'oatGrain', 'maslinGrain', 'barley', 'malt'] },
  { id: 'flour', label: 'Flour', kinds: FLOUR_KINDS },
  ...Object.entries(FOOD_CATEGORY_LABELS).map(([id, label]) => ({
    id,
    label: id === 'grains' ? 'Bread & staples' : label,
    kinds: edibleKinds.filter(kind => kind !== 'oatGrain' && foodCategory(kind) === id),
  })),
];

export const HUD_FOOD_RESOURCE_KINDS = HUD_FOOD_GROUPS.flatMap(group => group.kinds);

export function hudFoodResourceLabel(kind: HudFoodResourceKind): string {
  const label = resourceCostLabel(kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function hudFoodResourceTooltip(kind: HudFoodResourceKind): string {
  return Object.hasOwn(FOOD_MEAL_VALUES, kind)
    ? foodResourceTooltip(kind as FoodInventoryKind)
    : RESOURCE_DESCRIPTIONS[kind];
}
