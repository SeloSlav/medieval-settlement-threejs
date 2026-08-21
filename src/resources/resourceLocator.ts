import { localCivicReceiptGold } from '../economy/civicReceipts.ts';
import {
  edibleFoodStock,
  isEdibleFoodCargo,
  isPreservedFoodCargo,
  preservedFoodStock,
} from '../economy/foodInventory.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import {
  getNeedStock,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import { getBuildingDefinition } from './buildings.ts';
import type { HudResourceKind } from './resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from './types.ts';
import { formatResourceUnits } from './resourceUnits.ts';

const EPSILON = 1e-6;

const RESOURCE_LABELS: Record<HudResourceKind, string> = {
  timber: 'Timber',
  stone: 'Stone',
  firewood: 'Firewood',
  water: 'Water',
  food: 'Food',
  gold: 'Civic gold',
  ryeGrain: 'Rye grain',
  oatGrain: 'Oats',
  maslinGrain: 'Maslin grain',
  barley: 'Barley',
  malt: 'Malt',
  flax: 'Flax fibre',
  ryeFlour: 'Rye flour',
  maslinFlour: 'Maslin flour',
  ale: 'Ale',
  cider: 'Apple cider',
  pearCider: 'Pear cider',
  mead: 'Mead',
  preservedFood: 'Preserved staples',
  honey: 'Honey',
  wine: 'Wine',
  wool: 'Wool',
  cloth: 'Cloth',
  hides: 'Untanned hides',
  leather: 'Leather',
  shoes: 'Shoes',
  ironwork: 'Ironwork',
  polearms: 'Polearms',
  iron: 'Iron',
  clay: 'Clay',
  salt: 'Salt',
  charcoal: 'Charcoal',
  pottery: 'Pottery',
  roofTiles: 'Fired roof tiles',
};

const RESIDENCE_NEED_RESOURCES = new Set<ResidenceNeedKind>([
  'firewood',
  'water',
  'food',
  'ale',
  'preservedFood',
  'cloth',
  'shoes',
  'pottery',
]);

const CIVIC_TREASURY_KINDS = new Set<BuildingState['kind']>([
  'founders_camp',
  'salvage_pile',
  'town_hall',
]);

export type PhysicalResourceLocation =
  | {
      kind: 'building';
      id: string;
      x: number;
      z: number;
      amount: number;
      label: string;
      detail: string;
    }
  | {
      kind: 'residence';
      id: string;
      x: number;
      z: number;
      amount: number;
      label: string;
      detail: string;
    }
  | {
      kind: 'delivery';
      id: string;
      x: number;
      z: number;
      amount: number;
      label: string;
      detail: string;
    }
  | {
      kind: 'legacy-ledger';
      id: 'legacy-ledger';
      amount: number;
      label: string;
      detail: string;
    };

type LocatedStore = Exclude<PhysicalResourceLocation, { kind: 'delivery' | 'legacy-ledger' }>;

export function resourceDisplayLabel(resource: HudResourceKind): string {
  return RESOURCE_LABELS[resource];
}

export function formatLocatedResourceAmount(amount: number): string {
  return formatResourceUnits(amount);
}

/**
 * Finds the map entities which physically hold a headline HUD commodity.
 *
 * This deliberately runs only when the player activates a HUD row. The normal
 * simulation/HUD update path remains allocation-free even in very large towns.
 * Stored holdings are ordered largest-first; loaded carts follow them so repeat
 * activation gives a useful, deterministic tour of the supply chain.
 */
export function locatePhysicalResource(
  state: GameState,
  resource: HudResourceKind,
): PhysicalResourceLocation[] {
  const stores: LocatedStore[] = [];
  const deliveries: Extract<PhysicalResourceLocation, { kind: 'delivery' }>[] = [];

  for (const building of state.buildings.values()) {
    const holding = buildingResourceHolding(building, resource);
    if (holding.amount <= EPSILON) continue;
    stores.push({
      kind: 'building',
      id: building.id,
      x: building.x,
      z: building.z,
      amount: holding.amount,
      label: getBuildingDefinition(building.kind).label,
      detail: holding.detail,
    });
  }

  if (RESIDENCE_NEED_RESOURCES.has(resource as ResidenceNeedKind)) {
    const need = resource as ResidenceNeedKind;
    for (const residence of state.residences.values()) {
      const amount = resource === 'food'
        ? residence.foodInventoryMigrated === true
          ? edibleFoodStock(residence)
          : Math.max(
              edibleFoodStock(residence),
              finitePositive(getNeedStock(residence.needs, 'food')),
            )
        : resource === 'preservedFood'
          ? residence.foodInventoryMigrated === true
            ? preservedFoodStock(residence)
            : Math.max(
                preservedFoodStock(residence),
                finitePositive(getNeedStock(residence.needs, 'preservedFood')),
              )
          : finitePositive(getNeedStock(residence.needs, need));
      if (amount <= EPSILON) continue;
      stores.push(residenceLocation(residence, amount));
    }
  }

  for (const trip of state.deliveryTrips.values()) {
    const matches = resource === 'food'
      ? isEdibleFoodCargo(trip.cargoKind)
      : resource === 'preservedFood'
        ? isPreservedFoodCargo(trip.cargoKind)
        : trip.cargoKind === resource;
    if (!matches) continue;
    const amount = finitePositive(trip.amount);
    if (amount <= EPSILON) continue;
    const source = state.buildings.get(trip.buildingId);
    deliveries.push({
      kind: 'delivery',
      id: trip.id,
      x: trip.x,
      z: trip.z,
      amount,
      label: 'Loaded handcart',
      detail: source
        ? `${tripPhaseLabel(trip.phase)} from ${getBuildingDefinition(source.kind).label}`
        : `${tripPhaseLabel(trip.phase)} delivery`,
    });
  }

  stores.sort(compareStoredLocations);
  deliveries.sort(
    (a, b) => b.amount - a.amount || compareStableEntityIds(a.id, b.id),
  );

  const locations: PhysicalResourceLocation[] = [...stores, ...deliveries];
  if (state.physicalFoundingSiteEnabled !== true) {
    const ledgerAmount = resource === 'food'
      ? edibleFoodStock(state.stockpile)
      : resource === 'preservedFood'
        ? preservedFoodStock(state.stockpile)
        : finitePositive(state.stockpile[resource] ?? 0);
    if (ledgerAmount > EPSILON) {
      locations.push({
        kind: 'legacy-ledger',
        id: 'legacy-ledger',
        amount: ledgerAmount,
        label: 'Legacy settlement ledger',
        detail: 'materializes at a recovery pile when this save enters the physical economy',
      });
    }
  }
  return locations;
}

function buildingResourceHolding(
  building: BuildingState,
  resource: HudResourceKind,
): { amount: number; detail: string } {
  if (resource === 'food') {
    return {
      amount: edibleFoodStock(building),
      detail: building.constructionComplete === false
        ? 'meals held at this construction site'
        : 'named food commodities stored on site',
    };
  }
  if (resource === 'preservedFood') {
    return {
      amount: preservedFoodStock(building),
      detail: building.constructionComplete === false
        ? 'preserved provisions held at this construction site'
        : 'preserved staples stored on site',
    };
  }
  if (resource !== 'gold') {
    return {
      amount: finitePositive(building[resource] ?? 0),
      detail: building.constructionComplete === false
        ? 'held at this construction site'
        : 'stored on site',
    };
  }

  if (CIVIC_TREASURY_KINDS.has(building.kind)) {
    return {
      amount: finitePositive(building.gold),
      detail: building.kind === 'town_hall'
        ? 'secured in the Town Hall treasury'
        : 'secured in the settlement lockbox',
    };
  }
  if (building.kind === 'marketplace' || building.kind === 'trading_post') {
    return {
      amount: finitePositive(building.gold),
      detail: 'market receipts awaiting treasury collection',
    };
  }
  if (building.kind === 'guardhouse') {
    return {
      amount: finitePositive(building.gold),
      detail: 'reserved in the company pay chest',
    };
  }
  const receipts = localCivicReceiptGold(building);
  return {
    amount: receipts,
    detail: 'local receipts awaiting treasury collection',
  };
}

function residenceLocation(
  residence: ResidenceState,
  amount: number,
): LocatedStore {
  return {
    kind: 'residence',
    id: residence.id,
    x: residence.x,
    z: residence.z,
    amount,
    label: `Household · parcel ${residence.parcelIndex + 1}`,
    detail: 'stored in the household buffer',
  };
}

function compareStoredLocations(a: LocatedStore, b: LocatedStore): number {
  return b.amount - a.amount
    || (a.kind === b.kind ? 0 : a.kind === 'building' ? -1 : 1)
    || compareStableEntityIds(a.id, b.id);
}

function finitePositive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function tripPhaseLabel(phase: 'outbound' | 'unloading' | 'inbound'): string {
  if (phase === 'unloading') return 'unloading';
  if (phase === 'inbound') return 'returning';
  return 'travelling';
}
