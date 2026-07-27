import {
  RESIDENCE_TIER2_CAPACITY,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_CAPACITY,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
} from '../generated/gameBalance.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';

export type ResidenceUpgradeServiceKind =
  | 'firewood'
  | 'water'
  | 'preservedFood'
  | 'ale'
  | 'cloth';

export type ResidenceUpgradeServiceInput = {
  supplier: BuildingState | null;
  stocked: boolean;
};

export type ResidenceUpgradeServices = Record<
  ResidenceUpgradeServiceKind,
  ResidenceUpgradeServiceInput
>;

export type ResidenceUpgradeServiceCheck = ResidenceUpgradeServiceInput & {
  kind: ResidenceUpgradeServiceKind;
  label: string;
  ready: boolean;
};

export type ResidenceUpgradeResourceCheck = {
  kind: 'timber' | 'stone' | 'gold';
  label: string;
  available: number;
  required: number;
  shortfall: number;
  ready: boolean;
};

export type ResidenceUpgradePlan = {
  nextTier: 2 | 3;
  populationCapacity: number;
  addedCapacity: number;
  addedNeeds: string;
  occupied: boolean;
  services: ResidenceUpgradeServiceCheck[];
  resources: ResidenceUpgradeResourceCheck[];
  blockers: string[];
  ready: boolean;
};

export type ResidenceUpgradeContext = {
  fireDisabled?: boolean;
};

type UpgradeDefinition = {
  nextTier: 2 | 3;
  populationCapacity: number;
  timber: number;
  stone: number;
  gold: number;
  serviceKinds: ResidenceUpgradeServiceKind[];
  addedNeeds: string;
};

function definitionForTier(tier: ResidenceState['tier']): UpgradeDefinition | null {
  if (tier === 1) {
    return {
      nextTier: 2,
      populationCapacity: RESIDENCE_TIER2_CAPACITY,
      timber: RESIDENCE_TIER2_TIMBER_COST,
      stone: RESIDENCE_TIER2_STONE_COST,
      gold: RESIDENCE_TIER2_GOLD_COST,
      serviceKinds: ['firewood', 'water'],
      addedNeeds: 'Adds firewood and water needs',
    };
  }
  if (tier === 2) {
    return {
      nextTier: 3,
      populationCapacity: RESIDENCE_TIER3_CAPACITY,
      timber: RESIDENCE_TIER3_TIMBER_COST,
      stone: RESIDENCE_TIER3_STONE_COST,
      gold: RESIDENCE_TIER3_GOLD_COST,
      serviceKinds: ['preservedFood', 'ale', 'cloth'],
      addedNeeds: 'Adds preserved food, ale, and household textiles',
    };
  }
  return null;
}

const SERVICE_LABELS: Record<ResidenceUpgradeServiceKind, string> = {
  firewood: 'Firewood',
  water: 'Water',
  preservedFood: 'Preserved food',
  ale: 'Ale',
  cloth: 'Cloth',
};

export function evaluateResidenceUpgrade(
  residence: ResidenceState,
  totals: Pick<ResourceTotals, 'timber' | 'stone' | 'gold'>,
  serviceInputs: ResidenceUpgradeServices,
  context: ResidenceUpgradeContext = {},
): ResidenceUpgradePlan | null {
  const definition = definitionForTier(residence.tier);
  if (!definition) return null;

  const services = definition.serviceKinds.map((kind): ResidenceUpgradeServiceCheck => {
    const input = serviceInputs[kind];
    return {
      kind,
      label: SERVICE_LABELS[kind],
      supplier: input.supplier,
      stocked: input.stocked,
      ready: input.supplier != null,
    };
  });
  const requiredResources = [
    ['timber', 'Timber', totals.timber, definition.timber],
    ['stone', 'Stone', totals.stone, definition.stone],
    ['gold', 'Gold', totals.gold, definition.gold],
  ] as const;
  const resources = requiredResources.map(
    ([kind, label, available, required]): ResidenceUpgradeResourceCheck => ({
      kind,
      label,
      available: Math.max(0, available),
      required,
      shortfall: Math.max(0, required - available),
      ready: available + 1e-6 >= required,
    }),
  );
  const occupied = !residence.abandoned && residence.population > 0;
  const blockers = [
    ...(!occupied ? ['occupied household required'] : []),
    ...(context.fireDisabled ? ['repair fire damage before upgrading'] : []),
    ...services.filter((service) => !service.ready).map(
      (service) => `${service.label.toLowerCase()} route missing`,
    ),
    ...resources.filter((resource) => !resource.ready).map(
      (resource) => `${formatAmount(resource.shortfall)} ${resource.label.toLowerCase()} short`,
    ),
  ];

  return {
    nextTier: definition.nextTier,
    populationCapacity: definition.populationCapacity,
    addedCapacity: Math.max(0, definition.populationCapacity - residence.populationCapacity),
    addedNeeds: definition.addedNeeds,
    occupied,
    services,
    resources,
    blockers,
    ready: blockers.length === 0,
  };
}

function formatAmount(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
}
