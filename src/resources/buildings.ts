import type { BuildingKind } from './types.ts';

export type BuildingDefinition = {
  kind: BuildingKind;
  label: string;
  workRadius: number;
  pickRadius: number;
  harvestInterval: number;
  regrowRatePerSecond: number;
};

export const BUILDING_DEFINITIONS: Record<BuildingKind, BuildingDefinition> = {
  lumber_mill: {
    kind: 'lumber_mill',
    label: 'Lumber mill',
    workRadius: 210,
    pickRadius: 8,
    harvestInterval: 9,
    regrowRatePerSecond: 0,
  },
  reforester: {
    kind: 'reforester',
    label: 'Reforester',
    workRadius: 190,
    pickRadius: 8,
    harvestInterval: 0,
    regrowRatePerSecond: 0.014,
  },
  stone_quarry: {
    kind: 'stone_quarry',
    label: "Stonecutter's camp",
    workRadius: 55,
    pickRadius: 10,
    harvestInterval: 9,
    regrowRatePerSecond: 0,
  },
};

export function getBuildingDefinition(kind: BuildingKind): BuildingDefinition {
  return BUILDING_DEFINITIONS[kind];
}
