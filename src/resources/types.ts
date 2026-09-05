export const RESOURCE_KINDS = ['timber', 'stone', 'firewood', 'water', 'game', 'berries', 'mushrooms', 'fish', 'ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves', 'ryeGrain', 'oatGrain', 'maslinGrain', 'barley', 'malt', 'ryeFlour', 'maslinFlour', 'ale', 'cider', 'mead', 'honey', 'wax', 'candles', 'wine', 'wool', 'flax', 'yarn', 'linen', 'cloth', 'pelts', 'hides', 'leather', 'shoes', 'ironwork', 'polearms', 'sidearms', 'shields', 'bows', 'crossbows', 'paddedArmor', 'mailArmor', 'ammunition', 'iron', 'clay', 'salt', 'charcoal', 'pottery', 'manure', 'remedies', 'roofTiles', 'gold', 'ryeBread', 'maslinBread', 'meat', 'milk', 'apples', 'pears', 'cherries', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot', 'eggs', 'grapes', 'curedMeat', 'smokedFish', 'cheese', 'jam', 'animalFeed'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_NODE_KINDS = ['quarry', 'game', 'berries', 'mushrooms', 'fish'] as const;
export type ResourceNodeKind = (typeof RESOURCE_NODE_KINDS)[number];

export const TREE_PHASES = ['stump', 'growing', 'mature', 'falling', 'fallen', 'logs'] as const;
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

export type TimberLogState = { x: number; z: number; health: number; maxHealth: number; firewood: number };
export type TreeEntityState = {
  treeId: string;
  layoutIndex: number;
  phase: TreePhase;
  growthProgress: number;
  harvestProgress?: number;
  workBuildingId?: string | null;
  logs?: readonly TimberLogState[];
};

/**
 * A durable civic community inside the player's one realm-wide economy.
 * Goods never belong to this row: they remain physical on buildings, homes,
 * and carts and are only broken down by settlement for local diagnostics.
 */
export type SettlementState = {
  id: string;
  name: string;
  anchorX: number;
  anchorZ: number;
  foundingCampId?: string;
  founderPopulation: number;
  unhousedFounders: number;
  active: boolean;
  townHallId?: string;
  createdTick: number;
  economicActivityTaxRate: number;
  pantrySafeguardPolicy: 0 | 1 | 2;
  landLevyRate: number;
  importDutyRate: number;
  exportDutyRate: number;
  seasonalLaborStewardEnabled: boolean;
  constructionLaborStewardEnabled: boolean;
  productionLaborStewardEnabled: boolean;
  laborStewardReserve: number;
  landLevyAssessedTotal: number;
  landLevyCollectedTotal: number;
  importDutyCollectedTotal: number;
  exportDutyCollectedTotal: number;
};

export type TreeWorkArea = {
  x: number;
  z: number;
  radius: number;
};

export type BuildingState = {
  id: string;
  /** Sticky civic membership; absent only for legacy or neutral structures. */
  settlementId?: string;
  kind: BuildingKind;
  x: number;
  z: number;
  /** Immutable orientation captured when the site was placed; absent only on legacy rows. */
  yaw?: number;
  workRadius: number;
  /** Optional player-authored forestry circle; absent restores the default building extent. */
  treeWorkArea?: TreeWorkArea;
  actionCooldown: number;
  timber: number;
  firewood: number;
  stone: number;
  water: number;
  /** Retired save-schema tombstone; runtime migration moves any value to rye bread. */
  food: number;
  ryeSheaves?: number;
  oatSheaves?: number;
  barleySheaves?: number;
  maslinSheaves?: number;
  ryeGrain?: number;
  oatGrain?: number;
  animalFeed?: number;
  maslinGrain?: number;
  barley?: number;
  malt?: number;
  ryeFlour?: number;
  maslinFlour?: number;
  ale: number;
  cider?: number;
  mead?: number;
  honey: number;
  /** Additive candle-chain inventories; absent only while legacy bindings are active. */
  wax?: number;
  candles?: number;
  wine: number;
  wool?: number;
  flax?: number;
  yarn?: number;
  linen?: number;
  cloth?: number;
  pelts?: number;
  hides?: number;
  leather?: number;
  shoes?: number;
  ironwork?: number;
  polearms?: number;
  sidearms?: number;
  shields?: number;
  bows?: number;
  crossbows?: number;
  paddedArmor?: number;
  mailArmor?: number;
  ammunition?: number;
  iron?: number;
  clay?: number;
  salt?: number;
  charcoal?: number;
  pottery?: number;
  roofTiles?: number;
  manure?: number;
  remedies?: number;
  ryeBread?: number;
  maslinBread?: number;
  meat?: number;
  fish?: number;
  berries?: number;
  mushrooms?: number;
  milk?: number;
  apples?: number;
  pears?: number;
  cherries?: number;
  aronia?: number;
  rosehips?: number;
  cabbage?: number;
  carrots?: number;
  beetroot?: number;
  eggs?: number;
  grapes?: number;
  curedMeat?: number;
  smokedFish?: number;
  cheese?: number;
  jam?: number;
  gold: number;
  waterCapacity: number;
  assignedLabor: number;
  constructionComplete: boolean;
  /** Non-destructive fire repair uses construction labor without replacing the finished mesh. */
  fireRepairActive?: boolean;
  constructionProgress: number;
  constructionRequiredTimber: number;
  constructionRequiredStone: number;
  constructionRequiredIronwork?: number;
  constructionRequiredRoofTiles?: number;
  constructionDeliveredTimber: number;
  constructionDeliveredStone: number;
  constructionDeliveredIronwork?: number;
  constructionDeliveredRoofTiles?: number;
  constructionReservedTimber: number;
  constructionReservedStone: number;
  constructionReservedIronwork?: number;
  constructionReservedRoofTiles?: number;
  constructionTreasuryTimber: number;
  constructionTreasuryStone: number;
  constructionTreasuryIronwork?: number;
  constructionTreasuryRoofTiles?: number;
  storehouseAcceptsTimber: boolean;
  storehouseAcceptsStone: boolean;
  storehouseAcceptsFirewood: boolean;
  storehouseAcceptsCharcoal?: boolean;
  /** Additive raw-material intake gates; missing legacy values mean enabled. */
  storehouseAcceptsIron?: boolean;
  storehouseAcceptsClay?: boolean;
  storehouseAcceptsSalt?: boolean;
  storehouseTimberTargetPercent?: number;
  storehouseStoneTargetPercent?: number;
  storehouseFirewoodTargetPercent?: number;
  storehouseCharcoalTargetPercent?: number;
  storehouseIronTargetPercent?: number;
  storehouseClayTargetPercent?: number;
  storehouseSaltTargetPercent?: number;
  processorOutputTargetPercent?: number;
  /** 0 pauses, 50 is normal production, and 100 doubles normal production. */
  productionRatePercent?: number;
  /** Dedicated pastoral holding milk allocation; 0/missing reads the legacy field. */
  milkUsePolicy?: number;
  /** 0 ale, 1 cider from apples, 2 mead, 3 automatic, 4 cider from pears. */
  breweryRecipePolicy?: number;
  /** 0 automatic, 1 cured meat, 2 smoked fish, 3 cheese. */
  smokehouseRecipePolicy?: number;
  /** 1 fields first, 2 demand-aware automatic, 3 thresh before non-harvest fieldwork. */
  threshingPriority?: number;
  /** Generic textile route preference: 0 auto, 1 first route, 2 second route. */
  weaverInputPolicy?: number;
  /** 0 household/preserving vessels, 1 fired roof tiles; potter kilns only. */
  potterFiringPolicy?: number;
  granaryAcceptsFreshFood?: boolean;
  granaryHouseholdsFirst?: boolean;
  granaryGrainReserve?: number;
  granaryFreshFoodTargetPercent?: number;
  /** Stable CommodityKind bitset controlling new Storehouse/Granary intake. */
  storageAcceptanceMask?: string;
  /** Companion bitset for append-only CommodityKind ids 64-127. */
  storageAcceptanceMaskHigh?: string;
  constructionPriority?: number;
  woodcutterTimberReserve?: number;
  harvestReservePercent?: number;
  carpenterPolearmReserve?: number;
  /** Protected wheelwright repair kits; 0 disables accelerated cart service. */
  carpenterCartServiceTargetTrips?: number;
  /** Null/undefined keeps nearest-watch behavior; otherwise a server building id. */
  guardhouseMusterWatchtowerId?: string;
  marketplaceIronworkTarget?: number;
  marketplaceIronTarget?: number;
  marketplaceSaltTarget?: number;
  marketplaceGoldReserveTarget?: number;
  marketplaceSpecialtyExportPolicy?: number;
  /** Independent Trading Post policy for ale and wine. */
  marketplaceDrinkExportPolicy?: number;
  /** Independent Trading Post policy for honey and cheese. */
  marketplaceProvisionExportPolicy?: number;
  /** Independent Trading Post policy for cloth and pottery. */
  marketplaceWaresExportPolicy?: number;
  marketplaceSeedGrainTarget?: number;
  marketplacePendingTradeCode?: number;
  foundingShelterActive?: boolean;
  chapelMonasteryTitheDue?: number;
  /** 1 small timber, 2 small stone, 3 large stone; legacy rows default to 3. */
  chapelTier?: 1 | 2 | 3;
  /** Source-held fares or gifts pledged to the civic treasury. */
  civicReceiptsGold?: number;
  /** Private automatic-export proceeds awaiting distribution to producer households. */
  privateExportProceedsGold?: number;
  vineyardFermentingGrapes?: number;
  vineyardFermentationProgress?: number;
  /** 0 conservative, 1 balanced, 2 extractive. */
  apiaryHarvestPolicy?: number;
  apiaryColonyHealth?: number;
  apiaryLastWinterYear?: number;
  apiaryForageScore?: number;
  /** Successful honey cycles accumulated toward the next infrequent wax harvest. */
  apiaryWaxCycleProgress?: number;
  /** Whole Spring/Summer hive yield awaiting Autumn extraction. */
  apiaryAccumulatedHoney?: number;
  /** 0 apples, 1 grapevines; meaningful only for monasteries. */
  monasteryOrchardPlanting?: 0 | 1;
  /** 0 kitchen vegetables, 1 brewing barley; meaningful only for monasteries. */
  monasteryCroftPlanting?: 0 | 1;
  /** Infirmary 1, scriptorium 2, guesthouse 4, estate workshop 8. */
  monasteryExtensions?: number;
  /** One extension bit reserved for autonomous construction; 0 means awaiting a choice. */
  monasteryNextExtension?: number;
  monasteryOrchardPlantedYear?: number;
  /** 0 newly replanted, 1 young rows, 2 mature rows. */
  monasteryOrchardMaturity?: 0 | 1 | 2;
  monasteryCroftChoiceYear?: number;
  monasteryServiceFunding?: number;
  monasteryLastServiceDay?: bigint;
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

export const LIVESTOCK_SPECIES = ['cattle', 'sheep', 'swine', 'horses'] as const;
export type LivestockSpecies = (typeof LIVESTOCK_SPECIES)[number];

export type PastureState = {
  id: string;
  farmsteadId: string;
  corners: FarmFieldState['corners'];
  area: number;
  averageSlopeDegrees: number;
  moisture: number;
};

export type VineyardParcelState = {
  /** Stable parcel id; any number of parcels may share one monastery. */
  id: string;
  monasteryId: string;
  corners: FarmFieldState['corners'];
  area: number;
  averageSlopeDegrees: number;
  moisture: number;
  southExposure: number;
  siteSuitability: number;
  shapeEfficiency: number;
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
  /** 0 starvation, 1 illness, 2 winter exposure, 3 violence. */
  cause: 0 | 1 | 2 | 3;
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
  /** Owning grazing parcel; livestock herds are independently managed per pasture. */
  pastureId: string;
  /** Linked pastoral farmstead or swineherd that supplies labor, water, and stores. */
  buildingId: string;
  species: LivestockSpecies;
  /** Total owned animals; horse companies keep their pasture place reserved while away. */
  headCount: number;
  /** Animals physically inside this pasture now. */
  presentHeadCount: number;
  health: number;
  /** Whole units are confirmed spring offspring; the fraction is conception progress. */
  breedingProgress: number;
  pastureCapacity: number;
  suppliedCapacity: number;
  lastFoodOutput: number;
  lastPreservedOutput: number;
  lastWoolGold: number;
  lastWoolOutput?: number;
  lastShearingYear?: number;
  /** One-based absolute month of the most recent cattle milking round. */
  lastMilkingPeriod?: number;
  breedingReserve: number;
  lastCulled: number;
  hayStock: number;
  lastHayOutput: number;
  haymakingPercent: number;
};

export type StableOxState = {
  /** Durable purchased-animal identity. */
  id: string;
  stableId: string;
  /** Zero-based authored resting bay within the stable. */
  slot: number;
  /** Persistent workplace posting; null keeps this ox in the automatic assistance pool. */
  assignedBuildingId: string | null;
};

export type CavalryHorseState = {
  id: string;
  pastureId: string | null;
  slot: number;
  atPasture: boolean;
  assignedCompanyId: string | null;
  assignedCombatAgentId: string | null;
};

export type BurgageFrontageEdge = 0 | 1 | 2 | 3;

export type BurgageZoneState = {
  id: string;
  /** Sticky community chosen when the parcel was laid out. */
  settlementId?: string;
  cornerA: { x: number; z: number };
  cornerB: { x: number; z: number };
  cornerC: { x: number; z: number };
  cornerD: { x: number; z: number };
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type ResidenceState = {
  id: string;
  /** Durable home community; reach visuals never silently transfer it. */
  settlementId?: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
  population: number;
  populationCapacity: number;
  /** Tier zero is a physical cottage worksite; completed homes use tiers 1-4. */
  tier: 0 | 1 | 2 | 3 | 4;
  settlementTicks: number;
  needs: ResidenceNeedsState;
  /** Retired save-schema tombstone; runtime migration moves any value to rye bread. */
  food?: number;
  /** Physical household pantry. `needs.food` is only the derived meal total. */
  honey?: number;
  oatGrain?: number;
  ryeBread?: number;
  maslinBread?: number;
  meat?: number;
  fish?: number;
  berries?: number;
  mushrooms?: number;
  milk?: number;
  apples?: number;
  pears?: number;
  cherries?: number;
  aronia?: number;
  rosehips?: number;
  cabbage?: number;
  carrots?: number;
  beetroot?: number;
  eggs?: number;
  grapes?: number;
  curedMeat?: number;
  smokedFish?: number;
  cheese?: number;
  jam?: number;
  foodInventoryMigrated?: boolean;
  /** Deprecated replicated save field. Runtime homes are never abandoned. */
  abandoned: boolean;
  householdWealth: number;
  /** Last successful household-funded market dispatch; absent in older fixtures/saves. */
  lastHouseholdMarketTick?: number;
  /** Day marker for the latest safe optional purchase. */
  lastDiscretionaryMarketDay?: number;
  /** Target tier while physical household improvement works are active. */
  upgradeTargetTier?: 0 | 1 | 2 | 3 | 4;
  upgradeProgress?: number;
  upgradeRequiredTimber?: number;
  upgradeRequiredStone?: number;
  upgradeRequiredGold?: number;
  upgradeRequiredRoofTiles?: number;
  upgradeDeliveredTimber?: number;
  upgradeDeliveredStone?: number;
  upgradeDeliveredGold?: number;
  upgradeDeliveredRoofTiles?: number;
  upgradeReservedTimber?: number;
  upgradeReservedStone?: number;
  upgradeReservedGold?: number;
  upgradeReservedRoofTiles?: number;
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
  /** Deprecated save-compatibility field from the removed vacancy-decay system. */
  decayRepairActive?: boolean;
  /** Completed local fired-clay roof; absent legacy rows remain shingle-roofed. */
  tiledRoof?: boolean;
  /** Physical tile-and-timber residence project. */
  roofTileRetrofitActive?: boolean;
  /** Permanent tier-1 backyard specialization; residents leave general labor. */
  smallholding?: boolean;
};

export function residenceHasActiveProject(
  residence: Pick<
    ResidenceState,
    'tier' | 'upgradeTargetTier' | 'backyardProjectKind' | 'fireRepairActive' | 'decayRepairActive' | 'roofTileRetrofitActive'
  >,
): boolean {
  return (residence.upgradeTargetTier ?? 0) > residence.tier
    || (residence.backyardProjectKind ?? 0) !== 0
    || residence.fireRepairActive === true
    || residence.decayRepairActive === true
    || residence.roofTileRetrofitActive === true;
}

export type BackyardGardenState = {
  id: string;
  residenceId: string;
  kind: import('../generated/gameBalance.ts').BackyardGardenKind;
  firstHarvestDay: number;
  lastPrimaryProductionDay: number;
  lastSecondaryProductionDay: number;
  hideStock: number;
  waxStock?: number;
  flowerLuxuryUpgraded: boolean;
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
  settlements: Map<string, SettlementState>;
  tradingPostTradeRules?: Map<string, import('../economy/tradingPostTrade.ts').TradingPostTradeRuleState>;
  farmFields: Map<string, FarmFieldState>;
  pastures: Map<string, PastureState>;
  vineyardParcels?: Map<string, VineyardParcelState>;
  graveyards?: Map<string, GraveyardState>;
  corpses?: Map<string, CorpseState>;
  livestockHerds: Map<string, LivestockHerdState>;
  stableOxen: Map<string, StableOxState>;
  cavalryHorses: Map<string, CavalryHorseState>;
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
      kind: 'graveyard';
      graveyard: GraveyardState;
      chapel: BuildingState | null;
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
  return Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind, 0])) as ResourceStockpile;
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
