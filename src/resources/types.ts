export const RESOURCE_KINDS = ['timber', 'stone', 'firewood', 'water', 'game', 'berries', 'mushrooms', 'fish', 'food', 'grain', 'barley', 'malt', 'flour', 'ale', 'preservedFood', 'honey', 'wine', 'wool', 'flax', 'cloth', 'ironwork', 'polearms', 'iron', 'clay', 'salt', 'charcoal', 'pottery', 'gold'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_NODE_KINDS = ['quarry', 'game', 'berries', 'mushrooms', 'fish'] as const;
export type ResourceNodeKind = (typeof RESOURCE_NODE_KINDS)[number];

export const TREE_PHASES = ['stump', 'growing', 'mature'] as const;
export type TreePhase = (typeof TREE_PHASES)[number];

import {
  BUILDING_KINDS,
  FARM_CROP_KINDS,
  type BuildingKind,
  type FarmCropKind,
} from '../generated/gameBalance.ts';
import type { ResidenceNeedsState } from '../residences/residenceNeedState.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';

export type { BuildingKind };
export { BUILDING_KINDS };

export const FARM_CROPS = FARM_CROP_KINDS;
export type FarmCrop = FarmCropKind;

export type ResourceNodeDefinition = {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  x: number;
  z: number;
  label: string;
  maxYield: number;
  pickRadius: number;
  quarryKind?: 'large' | 'small';
  isRich?: boolean;
};

export type ResourceNodeState = {
  nodeId: string;
  kind: ResourceNodeKind;
  resource: ResourceKind;
  remaining: number;
  maxYield: number;
  x: number;
  z: number;
  isRich?: boolean;
};

export type ForagingNodeState = Omit<ResourceNodeState, 'kind'> & {
  kind: Exclude<ResourceNodeKind, 'quarry'>;
};

export type TreeLayoutEntry = {
  id: string;
  layoutIndex: number;
  x: number;
  z: number;
  woodYield: number;
  form: 'narrow' | 'broad' | 'young' | 'midstory';
  species: string;
  scale: number;
};

export type TreeEntityState = {
  treeId: string;
  layoutIndex: number;
  phase: TreePhase;
  growthProgress: number;
};

export type BuildingState = {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  workRadius: number;
  actionCooldown: number;
  timber: number;
  firewood: number;
  stone: number;
  water: number;
  food: number;
  grain: number;
  barley?: number;
  malt?: number;
  flour: number;
  ale: number;
  preservedFood: number;
  honey: number;
  wine: number;
  wool?: number;
  flax?: number;
  cloth?: number;
  ironwork?: number;
  polearms?: number;
  iron?: number;
  clay?: number;
  salt?: number;
  charcoal?: number;
  pottery?: number;
  manure?: number;
  remedies?: number;
  gold: number;
  waterCapacity: number;
  assignedLabor: number;
  constructionComplete: boolean;
  constructionProgress: number;
  constructionRequiredTimber: number;
  constructionRequiredStone: number;
  constructionRequiredIronwork?: number;
  constructionDeliveredTimber: number;
  constructionDeliveredStone: number;
  constructionDeliveredIronwork?: number;
  constructionReservedTimber: number;
  constructionReservedStone: number;
  constructionReservedIronwork?: number;
  constructionTreasuryTimber: number;
  constructionTreasuryStone: number;
  constructionTreasuryIronwork?: number;
  storehouseAcceptsTimber: boolean;
  storehouseAcceptsStone: boolean;
  storehouseAcceptsFirewood: boolean;
  storehouseTimberTargetPercent?: number;
  storehouseStoneTargetPercent?: number;
  storehouseFirewoodTargetPercent?: number;
  processorOutputTargetPercent?: number;
  /** 0 auto, 1 wool first, 2 flax first; meaningful only for weavers. */
  weaverInputPolicy?: number;
  /** 0 household wares first, 1 preservation vessels first; potter kilns only. */
  potteryDispatchPolicy?: number;
  granaryAcceptsFreshFood?: boolean;
  granaryHouseholdsFirst?: boolean;
  granaryGrainReserve?: number;
  granaryFreshFoodTargetPercent?: number;
  constructionPriority?: number;
  woodcutterTimberReserve?: number;
  harvestReservePercent?: number;
  carpenterPolearmReserve?: number;
  /** Protected wheelwright repair kits; 0 disables accelerated cart service. */
  carpenterCartServiceTargetTrips?: number;
  guardhousePayPriority?: number;
  guardhouseFoodReserve?: number;
  /** Null/undefined keeps nearest-watch behavior; otherwise a server building id. */
  guardhouseMusterWatchtowerId?: string;
  marketplaceIronworkTarget?: number;
  marketplaceIronTarget?: number;
  marketplaceSaltTarget?: number;
  marketplaceGoldReserveTarget?: number;
  marketplaceSpecialtyExportPolicy?: number;
  marketplaceSeedGrainTarget?: number;
  marketplacePendingTradeCode?: number;
  foundingShelterActive?: boolean;
  chapelMonasteryTitheDue?: number;
  /** Source-held fares or gifts pledged to the civic treasury. */
  civicReceiptsGold?: number;
};

export function isBuildingOperational(building: BuildingState): boolean {
  return building.constructionComplete !== false;
}

export const FARM_FIELD_STAGES = ['ploughing', 'sowing', 'growing', 'harvesting'] as const;
export type FarmFieldStage = (typeof FARM_FIELD_STAGES)[number];

export type FarmFieldState = {
  id: string;
  farmsteadId: string;
  corners: [
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
  ];
  area: number;
  averageSlopeDegrees: number;
  moisture: number;
  fertility: number;
  crop: FarmCrop;
  nextCrop: FarmCrop;
  /** Third slot in an explicit A → B → C rotation; absent repeats `nextCrop`. */
  followingCrop?: FarmCrop | null;
  stage: FarmFieldStage;
  stageProgress: number;
  priority: number;
  harvestCount: number;
  lastYield: number;
  currentYield: number;
  /** Locked fraction of normal yield for the active harvest; absent means a normal harvest. */
  harvestYieldMultiplier?: number;
  /** Physical manure spread during this cycle's ploughing. */
  manureApplied?: number;
};

export const LIVESTOCK_SPECIES = ['cattle', 'sheep', 'swine'] as const;
export type LivestockSpecies = (typeof LIVESTOCK_SPECIES)[number];

export type PastureState = {
  id: string;
  farmsteadId: string;
  corners: FarmFieldState['corners'];
  area: number;
  averageSlopeDegrees: number;
  moisture: number;
};

export type GraveyardState = {
  id: string;
  chapelId: string;
  corners: FarmFieldState['corners'];
  area: number;
  averageSlopeDegrees: number;
  capacity: number;
  burials: number;
};

export type CorpseState = {
  id: string;
  residenceId: string;
  cause: 0 | 1;
  /** 0 awaiting collection, 1 empty cart outbound, 2 body inbound. */
  state: 0 | 1 | 2;
  /** Body position; remains at the home until collection. */
  x: number;
  z: number;
  cartX: number;
  cartZ: number;
  createdTick: number;
  chapelId: string | null;
  graveyardId: string | null;
};

export type LivestockHerdState = {
  buildingId: string;
  species: LivestockSpecies;
  headCount: number;
  health: number;
  breedingProgress: number;
  pastureCapacity: number;
  suppliedCapacity: number;
  lastFoodOutput: number;
  lastPreservedOutput: number;
  lastWoolGold: number;
  lastWoolOutput?: number;
  lastShearingYear?: number;
  breedingReserve: number;
  lastCulled: number;
  hayStock: number;
  lastHayOutput: number;
  haymakingPercent: number;
};

export type BurgageFrontageEdge = 0 | 1 | 2 | 3;

export type BurgageZoneState = {
  id: string;
  cornerA: { x: number; z: number };
  cornerB: { x: number; z: number };
  cornerC: { x: number; z: number };
  cornerD: { x: number; z: number };
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type ResidenceState = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
  population: number;
  populationCapacity: number;
  /** Tier zero is a physical cottage worksite; completed homes use tiers 1-3. */
  tier: 0 | 1 | 2 | 3;
  settlementTicks: number;
  needs: ResidenceNeedsState;
  abandoned: boolean;
  householdWealth: number;
  /** Last successful household-funded market dispatch; absent in older fixtures/saves. */
  lastHouseholdMarketTick?: number;
  /** Target tier while physical household improvement works are active. */
  upgradeTargetTier?: 0 | 1 | 2 | 3;
  upgradeProgress?: number;
  upgradeRequiredTimber?: number;
  upgradeRequiredStone?: number;
  upgradeRequiredGold?: number;
  upgradeDeliveredTimber?: number;
  upgradeDeliveredStone?: number;
  upgradeDeliveredGold?: number;
  upgradeReservedTimber?: number;
  upgradeReservedStone?: number;
  upgradeReservedGold?: number;
  upgradeAssignedLabor?: number;
  /** Shared construction priority: 0 hold, 1 low, 2 normal, 3 urgent. */
  upgradePriority?: number;
  /** Stable backyard-garden kind id while a physical improvement worksite is active. */
  backyardProjectKind?: number;
  /** Physical structural repair/rebuild work on a fire-disabled homestead. */
  fireRepairActive?: boolean;
  hungerTicks?: number;
  malnutrition?: number;
  sickPopulation?: number;
  illnessTicks?: number;
  remedyStock?: number;
  deathsTotal?: number;
  comfortDeficitTicks?: number;
  vacancyTicks?: number;
  /** 0 sound, 1 neglected, 2 dilapidated, 3 ruin. */
  condition?: 0 | 1 | 2 | 3;
  /** Physical material-and-builder project restoring a vacant structure. */
  decayRepairActive?: boolean;
};

export function residenceHasActiveProject(
  residence: Pick<
    ResidenceState,
    'tier' | 'upgradeTargetTier' | 'backyardProjectKind' | 'fireRepairActive' | 'decayRepairActive'
  >,
): boolean {
  return (residence.upgradeTargetTier ?? 0) > residence.tier
    || (residence.backyardProjectKind ?? 0) !== 0
    || residence.fireRepairActive === true
    || residence.decayRepairActive === true;
}

export type BackyardGardenState = {
  id: string;
  residenceId: string;
  kind: import('../generated/gameBalance.ts').BackyardGardenKind;
};

export type ResourceStockpile = Record<ResourceKind, number> & {
  gold: number;
  ironwork?: number;
  polearms?: number;
};

export type GameState = {
  seed: number;
  tick: number;
  physicalFoundingSiteEnabled?: boolean;
  legacyUnhousedPopulationBonusEnabled?: boolean;
  stockpile: ResourceStockpile;
  quarries: Map<string, ResourceNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  farmFields: Map<string, FarmFieldState>;
  pastures: Map<string, PastureState>;
  graveyards?: Map<string, GraveyardState>;
  corpses?: Map<string, CorpseState>;
  livestockHerds: Map<string, LivestockHerdState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  fireIncidents: Map<string, FireIncidentState>;
  nextBuildingId: number;
};

export type InspectableTarget =
  | {
      kind: 'quarry';
      definition: ResourceNodeDefinition;
      state: ResourceNodeState;
    }
  | {
      kind: 'foraging';
      definition: ResourceNodeDefinition;
      state: ForagingNodeState;
    }
  | {
      kind: 'building';
      building: BuildingState;
      matureTrees: number;
      stumpTrees: number;
      growingTrees: number;
    }
  | {
      kind: 'farm-field';
      field: FarmFieldState;
      farmstead: BuildingState | null;
    }
  | {
      kind: 'pasture';
      pasture: PastureState;
      farmstead: BuildingState | null;
      herd: LivestockHerdState | null;
    }
  | {
      kind: 'river';
      x: number;
      z: number;
      shoreDistance: number;
      onWater: boolean;
    }
  | {
      kind: 'residence';
      residence: ResidenceState;
      zone: BurgageZoneState;
      residenceCount: number;
    }
  | {
      kind: 'backyard';
      residence: ResidenceState;
      zone: BurgageZoneState;
      garden: BackyardGardenState | null;
    };

export function createEmptyStockpile(): ResourceStockpile {
  return { timber: 0, stone: 0, firewood: 0, water: 0, game: 0, berries: 0, mushrooms: 0, fish: 0, food: 0, grain: 0, barley: 0, malt: 0, flour: 0, ale: 0, preservedFood: 0, honey: 0, wine: 0, wool: 0, flax: 0, cloth: 0, ironwork: 0, polearms: 0, iron: 0, clay: 0, salt: 0, charcoal: 0, pottery: 0, gold: 0 };
}

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isBuildingKind(value: string): value is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(value);
}

export function isTreePhase(value: string): value is TreePhase {
  return (TREE_PHASES as readonly string[]).includes(value);
}
