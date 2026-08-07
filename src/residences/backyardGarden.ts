import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import { backyardGardenTaxPerDay } from '../economy/villageProjections.ts';

export type { BackyardGardenKind };
export { BACKYARD_GARDEN_KINDS, BACKYARD_GARDEN_DEFINITIONS, BACKYARD_GARDEN_COSTS } from '../generated/gameBalance.ts';

/** New-build choices. Hidden legacy kinds remain parseable for old saves. */
export const BACKYARD_GARDEN_PICKER_KINDS = BACKYARD_GARDEN_KINDS.filter(
  (kind) => !BACKYARD_GARDEN_DEFINITIONS[kind].hiddenFromPicker,
);
export {
  backyardGardenSalvageRefund,
  formatBackyardGardenCost,
  formatBackyardGardenSalvage,
  getBackyardGardenCost,
} from '../resources/buildingEconomy.ts';

export function backyardGardenLabel(kind: BackyardGardenKind): string {
  return BACKYARD_GARDEN_DEFINITIONS[kind].label;
}

export function backyardGardenProductSummary(kind: BackyardGardenKind): string {
  switch (kind) {
    case 'apple_orchard': return 'Apples · fruit category';
    case 'cherry_orchard': return 'Cherries · legacy fruit category';
    case 'vegetable_garden': return 'Vegetables · one category';
    case 'flower_garden': return 'Pollinator forage · no saleable good';
    case 'herb_garden': return 'Remedies · household first';
    case 'hen_yard': return 'Eggs · animal-produce category';
    case 'goat_pen': return 'Alternating milk and meat · low yield';
    case 'backyard_apiary': return 'Honey · small seasonal yield';
  }
}

export function backyardGardenKindFromId(id: number): BackyardGardenKind | null {
  const kind = BACKYARD_GARDEN_KINDS[id - 1];
  return kind ?? null;
}

export function isBackyardGardenKind(value: string): value is BackyardGardenKind {
  return (BACKYARD_GARDEN_KINDS as readonly string[]).includes(value);
}

/** Estimated treasury gold per in-game day from one occupied residence. */
export { backyardGardenTaxPerDay };
