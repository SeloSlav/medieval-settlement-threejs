import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import { backyardGardenTaxPerDay } from '../economy/villageProjections.ts';

export type { BackyardGardenKind };
export { BACKYARD_GARDEN_KINDS, BACKYARD_GARDEN_DEFINITIONS, BACKYARD_GARDEN_COSTS } from '../generated/gameBalance.ts';

/** New-build choices. Orchard specializations are selected only after construction. */
export const BACKYARD_GARDEN_PICKER_KINDS = BACKYARD_GARDEN_KINDS.filter(
  (kind) => !BACKYARD_GARDEN_DEFINITIONS[kind].hiddenFromPicker,
).sort((left, right) => (
  left === 'orchard' ? -1 : right === 'orchard' ? 1 : 0
));

export const ORCHARD_SPECIALIZATION_KINDS = BACKYARD_GARDEN_KINDS.filter(
  (kind) => BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'orchard',
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
    case 'apple_orchard': return 'Apples · dependable September crop';
    case 'cherry_orchard': return 'Cherries · early June crop';
    case 'pear_orchard': return 'Pears · long-maturing, efficient autumn crop';
    case 'aronia_orchard': return 'Aronia berries · early preserves crop';
    case 'rosehip_orchard': return 'Rosehips · late, jam-rich preserves crop';
    case 'orchard': return 'Prepared orchard · choose trees or fruiting bushes after construction';
    case 'vegetable_garden': return 'Vegetables · one category';
    case 'flower_garden': return 'Pollinator forage · no saleable good';
    case 'herb_garden': return 'Remedies · household first';
    case 'hen_yard': return 'Eggs · animal-produce category';
    case 'goat_pen': return 'Alternating milk and meat · low yield';
    case 'backyard_apiary': return 'Honey · small seasonal yield';
  }
}

export function isOrchardSpecialization(
  kind: BackyardGardenKind,
): boolean {
  return BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'orchard';
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
