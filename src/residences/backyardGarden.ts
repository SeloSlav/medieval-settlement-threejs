import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import { backyardGardenTaxPerDay } from '../economy/villageProjections.ts';

export type { BackyardGardenKind };
export { BACKYARD_GARDEN_KINDS, BACKYARD_GARDEN_DEFINITIONS, BACKYARD_GARDEN_COSTS } from '../generated/gameBalance.ts';
export {
  backyardGardenSalvageRefund,
  formatBackyardGardenCost,
  formatBackyardGardenSalvage,
  getBackyardGardenCost,
} from '../resources/buildingEconomy.ts';

export function backyardGardenLabel(kind: BackyardGardenKind): string {
  return BACKYARD_GARDEN_DEFINITIONS[kind].label;
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
