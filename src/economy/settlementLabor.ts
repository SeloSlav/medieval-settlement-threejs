import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CONSTRUCTION_MAX_BUILDERS,
  type BuildingKind,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import {
  CONSTRUCTION_PRIORITY_HOLD,
  normalizeConstructionPriority,
} from '../logistics/constructionPriority.ts';
import type { GameState } from '../resources/types.ts';
import type { PopulationStats } from '../resources/resourceTotals.ts';
import {
  computeSettlementHaulagePlan,
  type SettlementHaulagePlan,
} from './settlementHaulage.ts';
import {
  STOREHOUSE_COMMODITIES,
  storehouseAcceptsCommodity,
  storehouseCollectionHeadroom,
  storehouseCommodityTarget,
  storehouseCommodityTargetPercent,
  type StorehouseCommodity,
} from './storehousePolicy.ts';

export const LABOR_SECTORS = [
  'provisions',
  'materials',
  'logistics',
  'civic',
  'defense',
] as const;

export type LaborSector = (typeof LABOR_SECTORS)[number];

export const LABOR_SECTOR_LABELS: Record<LaborSector, string> = {
  provisions: 'Provisions',
  materials: 'Materials & craft',
  logistics: 'Trade & haulage',
  civic: 'Civic & faith',
  defense: 'Defense',
};

const BUILDING_LABOR_SECTORS: Record<BuildingKind, LaborSector> = {
  founders_camp: 'logistics',
  salvage_pile: 'logistics',
  remote_work_camp: 'logistics',
  lumber_mill: 'materials',
  reforester: 'materials',
  stone_quarry: 'materials',
  large_quarry: 'materials',
  mine: 'materials',
  clay_pit: 'materials',
  charcoal_burner: 'materials',
  smithy: 'materials',
  potter_kiln: 'materials',
  woodcutters_lodge: 'provisions',
  well: 'provisions',
  stable: 'logistics',
  hunters_hall: 'provisions',
  foragers_shed: 'provisions',
  fishing_camp: 'provisions',
  chapel: 'civic',
  wayside_shrine: 'civic',
  marketplace: 'logistics',
  trading_post: 'logistics',
  town_hall: 'civic',
  village_storehouse: 'logistics',
  watchtower: 'defense',
  guardhouse: 'defense',
  palisaded_refuge: 'defense',
  threshing_barn: 'provisions',
  monastery: 'civic',
  brewery: 'provisions',
  tavern: 'provisions',
  smokehouse: 'provisions',
  granary: 'logistics',
  bakery: 'provisions',
  apiary: 'provisions',
  watermill: 'provisions',
  windmill: 'provisions',
  carpenter: 'materials',
  weaver: 'materials',
  tannery: 'materials',
  cobbler: 'materials',
  pastoral_farmstead: 'provisions',
  swineherd: 'provisions',
};

export type LaborSectorPlan = {
  assigned: number;
  capacity: number;
  worksites: number;
  unstaffedWorksites: number;
};

export type SettlementLaborPlan = {
  permanentAssigned: number;
  permanentCapacity: number;
  openPermanentPosts: number;
  unstaffedWorksites: number;
  firstUnstaffedBuildingId: string | null;
  constructionAssigned: number;
  constructionCapacity: number;
  activeConstructionSites: number;
  heldConstructionSites: number;
  activeCartTrips: number;
  cartCrewWorkers: number;
  haulage: SettlementHaulagePlan;
  sectors: Record<LaborSector, LaborSectorPlan>;
  populationAtFullHousing: number;
  futurePermanentPostShortfall: number;
  futureFreeLaborAfterFullStaffing: number;
  storehouseNetwork: StorehouseNetworkPlan;
};

export type StorehouseCommodityNetworkPlan = {
  acceptingDepots: number;
  staffedAcceptingDepots: number;
  targetStock: number;
  stockTowardTarget: number;
  collectionHeadroom: number;
  stockAboveTarget: number;
};

export type StorehouseNetworkPlan = {
  completedDepots: number;
  staffedDepots: number;
  commodities: Record<StorehouseCommodity, StorehouseCommodityNetworkPlan>;
};

function emptySectorPlan(): Record<LaborSector, LaborSectorPlan> {
  return {
    provisions: { assigned: 0, capacity: 0, worksites: 0, unstaffedWorksites: 0 },
    materials: { assigned: 0, capacity: 0, worksites: 0, unstaffedWorksites: 0 },
    logistics: { assigned: 0, capacity: 0, worksites: 0, unstaffedWorksites: 0 },
    civic: { assigned: 0, capacity: 0, worksites: 0, unstaffedWorksites: 0 },
    defense: { assigned: 0, capacity: 0, worksites: 0, unstaffedWorksites: 0 },
  };
}

function emptyStorehouseNetwork(): StorehouseNetworkPlan {
  const emptyCommodity = (): StorehouseCommodityNetworkPlan => ({
    acceptingDepots: 0,
    staffedAcceptingDepots: 0,
    targetStock: 0,
    stockTowardTarget: 0,
    collectionHeadroom: 0,
    stockAboveTarget: 0,
  });
  return {
    completedDepots: 0,
    staffedDepots: 0,
    commodities: {
      timber: emptyCommodity(),
      stone: emptyCommodity(),
      firewood: emptyCommodity(),
      charcoal: emptyCommodity(),
      iron: emptyCommodity(),
      clay: emptyCommodity(),
      salt: emptyCommodity(),
    },
  };
}

export function computeSettlementLaborPlan(input: {
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>;
  population: Pick<PopulationStats, 'total'>;
  vacantHousingSlots: number;
  excludeNavigationBuildingId?: string;
}): SettlementLaborPlan {
  const sectors = emptySectorPlan();
  let permanentAssigned = 0;
  let permanentCapacity = 0;
  let unstaffedWorksites = 0;
  let firstUnstaffedBuildingId: string | null = null;
  let constructionAssigned = 0;
  let constructionCapacity = 0;
  let activeConstructionSites = 0;
  let heldConstructionSites = 0;
  const storehouseNetwork = emptyStorehouseNetwork();

  for (const building of input.state.buildings.values()) {
    if (building.constructionComplete === false) {
      if (
        normalizeConstructionPriority(building.constructionPriority)
        === CONSTRUCTION_PRIORITY_HOLD
      ) {
        heldConstructionSites += 1;
        continue;
      }
      activeConstructionSites += 1;
      constructionAssigned += Math.max(0, building.assignedLabor);
      constructionCapacity += CONSTRUCTION_MAX_BUILDERS;
      continue;
    }

    if (building.kind === 'village_storehouse') {
      storehouseNetwork.completedDepots += 1;
      if (building.assignedLabor > 0) {
        storehouseNetwork.staffedDepots += 1;
      }
      for (const commodity of STOREHOUSE_COMMODITIES) {
        if (!storehouseAcceptsCommodity(building, commodity)) continue;
        const network = storehouseNetwork.commodities[commodity];
        const target = storehouseCommodityTarget(building, commodity);
        const stock = Math.max(0, building[commodity] ?? 0);
        const capacity = BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0;
        const percent = storehouseCommodityTargetPercent(building, commodity);
        network.acceptingDepots += 1;
        if (building.assignedLabor > 0) {
          network.staffedAcceptingDepots += 1;
        }
        network.targetStock += target;
        network.stockTowardTarget += Math.min(stock, target);
        network.collectionHeadroom += storehouseCollectionHeadroom(
          stock,
          capacity,
          percent,
        );
        network.stockAboveTarget += Math.max(0, stock - target);
      }
    }

    const definition = BUILDING_DEFINITIONS[building.kind];
    if (!definition.acceptsLabor || definition.maxLabor <= 0) continue;

    const capacity = definition.maxLabor;
    const assigned = Math.max(0, building.assignedLabor);
    const sector = sectors[BUILDING_LABOR_SECTORS[building.kind]];
    sector.assigned += assigned;
    sector.capacity += capacity;
    sector.worksites += 1;
    permanentAssigned += assigned;
    permanentCapacity += capacity;
    if (assigned > 0) continue;
    sector.unstaffedWorksites += 1;
    unstaffedWorksites += 1;
    if (building.id === input.excludeNavigationBuildingId) continue;
    if (
      firstUnstaffedBuildingId === null
      || compareStableEntityIds(building.id, firstUnstaffedBuildingId) < 0
    ) {
      firstUnstaffedBuildingId = building.id;
    }
  }

  const haulage = computeSettlementHaulagePlan(input.state.deliveryTrips.values());

  const populationAtFullHousing = Math.max(
    0,
    input.population.total + Math.max(0, input.vacantHousingSlots),
  );
  const futureLaborBalance = populationAtFullHousing - permanentCapacity;

  return {
    permanentAssigned,
    permanentCapacity,
    openPermanentPosts: Math.max(0, permanentCapacity - permanentAssigned),
    unstaffedWorksites,
    firstUnstaffedBuildingId,
    constructionAssigned,
    constructionCapacity,
    activeConstructionSites,
    heldConstructionSites,
    activeCartTrips: haulage.activeTrips,
    cartCrewWorkers: haulage.deliveryWorkers,
    haulage,
    sectors,
    populationAtFullHousing,
    futurePermanentPostShortfall: Math.max(0, -futureLaborBalance),
    futureFreeLaborAfterFullStaffing: Math.max(0, futureLaborBalance),
    storehouseNetwork,
  };
}
