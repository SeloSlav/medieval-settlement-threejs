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
export const ANIMAL_PEN_SPECIALIZATION_KINDS = BACKYARD_GARDEN_KINDS.filter(
  (kind) => BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'animal_pen',
);
export const VEGETABLE_GARDEN_SPECIALIZATION_KINDS = BACKYARD_GARDEN_KINDS.filter(
  (kind) => BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'vegetable_garden',
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
    case 'vegetable_garden': return 'Prepared vegetable beds · choose one seed crop after construction';
    case 'cabbage_garden': return 'Cabbages · slow, costly, high-yield summer-to-autumn crop';
    case 'carrot_garden': return 'Carrots · balanced maturity, cost, season, and yield';
    case 'beetroot_garden': return 'Beetroot · cheapest, fastest early crop with lower yield';
    case 'flower_garden': return 'Pollinator forage · no saleable good';
    case 'herb_garden': return 'Remedies · household first';
    case 'animal_pen': return 'Completed livestock enclosure · choose chickens, goats, or pigs';
    case 'chicken_pen': return 'Eggs on short intervals · seasonal chicken culls for meat';
    case 'goat_pen': return 'Milk on short intervals · occasional meat and hides';
    case 'pig_pen': return 'Pork-only finishing cycle · large autumn harvest';
    case 'backyard_apiary': return 'Honey · small seasonal yield';
  }
}

export function isOrchardSpecialization(
  kind: BackyardGardenKind,
): boolean {
  return BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'orchard';
}

export function isAnimalPenSpecialization(
  kind: BackyardGardenKind,
): boolean {
  return BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'animal_pen';
}

export function isVegetableGardenSpecialization(
  kind: BackyardGardenKind,
): boolean {
  return BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf === 'vegetable_garden';
}

/** Planting projects skip the fixture/scaffold construction presentation. */
export function isPlantableBackyardGardenKind(kind: BackyardGardenKind): boolean {
  return kind === 'orchard'
    || kind === 'vegetable_garden'
    || kind === 'flower_garden'
    || kind === 'herb_garden'
    || isOrchardSpecialization(kind)
    || isVegetableGardenSpecialization(kind);
}

/**
 * Only bed-grown plants replace the natural yard surface. Tree orchards grow
 * directly from grass, while the unselected orchard shell remains invisible.
 */
export function backyardGardenUsesCultivatedSoil(kind: BackyardGardenKind): boolean {
  return kind === 'aronia_orchard'
    || kind === 'rosehip_orchard'
    || kind === 'vegetable_garden'
    || kind === 'flower_garden'
    || kind === 'herb_garden'
    || isVegetableGardenSpecialization(kind);
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
