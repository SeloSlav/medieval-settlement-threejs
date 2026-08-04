import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CONSTRUCTION_MAX_BUILDERS,
  POPULATION_PER_RESIDENCE,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
  type StorageCaps,
} from '../generated/gameBalance.ts';
import type { MarketplaceTradeAvailability } from '../economy/marketplaceTrade.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { localCivicReceiptGold } from '../economy/civicReceipts.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  NAMED_FOOD_KINDS,
  NAMED_FOOD_LABELS,
  type NamedFoodKind,
} from '../economy/foodInventory.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import {
  residenceHasActiveProject,
  type BuildingKind,
  type BuildingState,
  type GameState,
} from './types.ts';
import {
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
} from '../logistics/firewoodLogistics.ts';

export { residenceNeedsStatus } from '../residences/residenceNeeds.ts';

export {
  formatFirewoodRunwayDays,
  GAME_DAY_SECONDS,
  POPULATION_PER_RESIDENCE,
  residenceFirewoodRunwayDays,
  residenceFirewoodRunwaySeconds,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
  STARTING_POPULATION,
};

export type { StorageCaps };

export type ResourceTotals = {
  timber: number;
  stone: number;
  firewood: number;
  water: number;
  food: number;
  gold: number;
  grain: number;
  barley: number;
  malt: number;
  flax: number;
  flour: number;
  ale: number;
  preservedFood: number;
  honey: number;
  wine: number;
  wool: number;
  cloth: number;
  ironwork: number;
  polearms: number;
  iron: number;
  clay: number;
  salt: number;
  charcoal: number;
  pottery: number;
  roofTiles: number;
  manure: number;
  remedies: number;
  bread: number;
  meat: number;
  fish: number;
  berries: number;
  mushrooms: number;
  milk: number;
  apples: number;
  cherries: number;
  vegetables: number;
  eggs: number;
  grapes: number;
  porridge: number;
  curedMeat: number;
  smokedFish: number;
  cheese: number;
  /** Compatibility stock from old saves; never produced by the new economy. */
  legacyFood: number;
  /** Compatibility cured stock from old saves; never produced by the new economy. */
  legacyPreservedFood: number;
};

export const FOOD_RESOURCE_KINDS = NAMED_FOOD_KINDS;
export type FoodResourceKind = NamedFoodKind;
export const FOOD_RESOURCE_LABELS = NAMED_FOOD_LABELS;

export const HUD_RESOURCE_KINDS = [
  'timber',
  'stone',
  'firewood',
  'water',
  'food',
  'gold',
  'grain',
  'barley',
  'malt',
  'flax',
  'flour',
  'ale',
  'preservedFood',
  'honey',
  'wine',
  'wool',
  'cloth',
  'ironwork',
  'polearms',
  'iron',
  'clay',
  'salt',
  'charcoal',
  'pottery',
  'roofTiles',
] as const satisfies readonly (keyof ResourceTotals)[];

export type HudResourceKind = (typeof HUD_RESOURCE_KINDS)[number];

export function isHudResourceKind(value: string): value is HudResourceKind {
  return (HUD_RESOURCE_KINDS as readonly string[]).includes(value);
}

export type PopulationStats = {
  total: number;
  assigned: number;
  cartAssigned: number;
  sick?: number;
  available: number;
  housingCapacity: number;
  housed: number;
  vacant: number;
};

export function buildingStorageCaps(kind: BuildingKind): StorageCaps {
  return BUILDING_STORAGE_CAPS[kind];
}

export function buildingAcceptsLabor(kind: BuildingKind): boolean {
  return BUILDING_DEFINITIONS[kind].acceptsLabor;
}

export function buildingMaxLabor(kind: BuildingKind): number {
  const definition = BUILDING_DEFINITIONS[kind];
  return definition.acceptsLabor ? definition.maxLabor : 0;
}

export function laborScaledInterval(baseInterval: number, assignedLabor: number): number {
  if (assignedLabor <= 0 || baseInterval <= 0) return baseInterval;
  return baseInterval / assignedLabor;
}

let cachedState: GameState | null = null;
let cachedTotals: ResourceTotals | null = null;
let cachedStoredTotals: ResourceTotals | null = null;

export function computeResourceTotals(state: GameState): ResourceTotals {
  if (cachedState === state && cachedTotals) {
    return cachedTotals;
  }

  // The player-resource row remains in the schema for old saves and policy
  // fields, but a physical settlement may only count goods held by a map
  // entity. The server materializes any migrated balance into a salvage pile.
  const ledger = state.physicalFoundingSiteEnabled === true
    ? null
    : state.stockpile;
  let timber = ledger?.timber ?? 0;
  let stone = ledger?.stone ?? 0;
  let firewood = ledger?.firewood ?? 0;
  let water = ledger?.water ?? 0;
  let legacyFood = ledger?.food ?? 0;
  let grain = ledger?.grain ?? 0;
  let barley = ledger?.barley ?? 0;
  let malt = ledger?.malt ?? 0;
  let flax = ledger?.flax ?? 0;
  let flour = ledger?.flour ?? 0;
  let ale = ledger?.ale ?? 0;
  let legacyPreservedFood = ledger?.preservedFood ?? 0;
  let honey = ledger?.honey ?? 0;
  let wine = ledger?.wine ?? 0;
  let wool = ledger?.wool ?? 0;
  let cloth = ledger?.cloth ?? 0;
  let ironwork = ledger?.ironwork ?? 0;
  let polearms = ledger?.polearms ?? 0;
  let iron = ledger?.iron ?? 0;
  let clay = ledger?.clay ?? 0;
  let salt = ledger?.salt ?? 0;
  let charcoal = ledger?.charcoal ?? 0;
  let pottery = ledger?.pottery ?? 0;
  let roofTiles = ledger?.roofTiles ?? 0;
  let manure = 0;
  let remedies = 0;
  let bread = ledger?.bread ?? 0;
  let meat = ledger?.meat ?? 0;
  let fish = ledger?.fish ?? 0;
  let berries = ledger?.berries ?? 0;
  let mushrooms = ledger?.mushrooms ?? 0;
  let milk = ledger?.milk ?? 0;
  let apples = ledger?.apples ?? 0;
  let cherries = ledger?.cherries ?? 0;
  let vegetables = ledger?.vegetables ?? 0;
  let eggs = ledger?.eggs ?? 0;
  let grapes = ledger?.grapes ?? 0;
  let porridge = ledger?.porridge ?? 0;
  let curedMeat = ledger?.curedMeat ?? 0;
  let smokedFish = ledger?.smokedFish ?? 0;
  let cheese = ledger?.cheese ?? 0;
  let gold = ledger?.gold ?? 0;
  let reservedTimber = 0;
  let reservedStone = 0;
  let reservedIronwork = 0;
  let reservedGold = 0;
  let reservedRoofTiles = 0;
  let reservedLegacyFood = 0;
  let reservedLegacyPreservedFood = 0;
  let reservedHoney = 0;
  let reservedBread = 0;
  let reservedMeat = 0;
  let reservedFish = 0;
  let reservedBerries = 0;
  let reservedMushrooms = 0;
  let reservedMilk = 0;
  let reservedApples = 0;
  let reservedCherries = 0;
  let reservedVegetables = 0;
  let reservedEggs = 0;
  let reservedGrapes = 0;
  let reservedPorridge = 0;
  let reservedCuredMeat = 0;
  let reservedSmokedFish = 0;
  let reservedCheese = 0;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
    water += building.water;
    legacyFood += building.food;
    grain += building.grain;
    barley += building.barley ?? 0;
    malt += building.malt ?? 0;
    flax += building.flax ?? 0;
    flour += building.flour;
    ale += building.ale;
    legacyPreservedFood += building.preservedFood;
    honey += building.honey;
    wine += building.wine;
    wool += building.wool ?? 0;
    cloth += building.cloth ?? 0;
    ironwork += building.ironwork ?? 0;
    polearms += building.polearms ?? 0;
    iron += building.iron ?? 0;
    clay += building.clay ?? 0;
    salt += building.salt ?? 0;
    charcoal += building.charcoal ?? 0;
    pottery += building.pottery ?? 0;
    roofTiles += building.roofTiles ?? 0;
    manure += building.manure ?? 0;
    remedies += building.remedies ?? 0;
    bread += building.bread ?? 0;
    meat += building.meat ?? 0;
    fish += building.fish ?? 0;
    berries += building.berries ?? 0;
    mushrooms += building.mushrooms ?? 0;
    milk += building.milk ?? 0;
    apples += building.apples ?? 0;
    cherries += building.cherries ?? 0;
    vegetables += building.vegetables ?? 0;
    eggs += building.eggs ?? 0;
    grapes += building.grapes ?? 0;
    porridge += building.porridge ?? 0;
    curedMeat += building.curedMeat ?? 0;
    smokedFish += building.smokedFish ?? 0;
    cheese += building.cheese ?? 0;
    if (
      building.kind === 'founders_camp'
      || building.kind === 'salvage_pile'
      || building.kind === 'town_hall'
    ) {
      gold += building.gold;
    }
    if (building.constructionComplete === false) {
      reservedTimber += Math.max(0, building.constructionReservedTimber);
      reservedStone += Math.max(0, building.constructionReservedStone);
      reservedIronwork += Math.max(0, building.constructionReservedIronwork ?? 0);
    }
  }

  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      reservedTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
      reservedStone += Math.max(0, residence.upgradeReservedStone ?? 0);
      reservedGold += Math.max(0, residence.upgradeReservedGold ?? 0);
      reservedRoofTiles += Math.max(0, residence.upgradeReservedRoofTiles ?? 0);
    }
    firewood += getNeedStock(residence.needs, 'firewood');
    water += getNeedStock(residence.needs, 'water');
    const pantryLegacyFood = Math.max(0, residence.food ?? 0);
    const pantryLegacyPreserved = Math.max(0, residence.preservedFood ?? 0);
    const pantryHoney = Math.max(0, residence.honey ?? 0);
    const pantryBread = Math.max(0, residence.bread ?? 0);
    const pantryMeat = Math.max(0, residence.meat ?? 0);
    const pantryFish = Math.max(0, residence.fish ?? 0);
    const pantryBerries = Math.max(0, residence.berries ?? 0);
    const pantryMushrooms = Math.max(0, residence.mushrooms ?? 0);
    const pantryMilk = Math.max(0, residence.milk ?? 0);
    const pantryApples = Math.max(0, residence.apples ?? 0);
    const pantryCherries = Math.max(0, residence.cherries ?? 0);
    const pantryVegetables = Math.max(0, residence.vegetables ?? 0);
    const pantryEggs = Math.max(0, residence.eggs ?? 0);
    const pantryGrapes = Math.max(0, residence.grapes ?? 0);
    const pantryPorridge = Math.max(0, residence.porridge ?? 0);
    const pantryCuredMeat = Math.max(0, residence.curedMeat ?? 0);
    const pantrySmokedFish = Math.max(0, residence.smokedFish ?? 0);
    const pantryCheese = Math.max(0, residence.cheese ?? 0);
    legacyFood += pantryLegacyFood;
    legacyPreservedFood += pantryLegacyPreserved;
    honey += pantryHoney;
    bread += pantryBread;
    meat += pantryMeat;
    fish += pantryFish;
    berries += pantryBerries;
    mushrooms += pantryMushrooms;
    milk += pantryMilk;
    apples += pantryApples;
    cherries += pantryCherries;
    vegetables += pantryVegetables;
    eggs += pantryEggs;
    grapes += pantryGrapes;
    porridge += pantryPorridge;
    curedMeat += pantryCuredMeat;
    smokedFish += pantrySmokedFish;
    cheese += pantryCheese;
    reservedLegacyFood += pantryLegacyFood;
    reservedLegacyPreservedFood += pantryLegacyPreserved;
    reservedHoney += pantryHoney;
    reservedBread += pantryBread;
    reservedMeat += pantryMeat;
    reservedFish += pantryFish;
    reservedBerries += pantryBerries;
    reservedMushrooms += pantryMushrooms;
    reservedMilk += pantryMilk;
    reservedApples += pantryApples;
    reservedCherries += pantryCherries;
    reservedVegetables += pantryVegetables;
    reservedEggs += pantryEggs;
    reservedGrapes += pantryGrapes;
    reservedPorridge += pantryPorridge;
    reservedCuredMeat += pantryCuredMeat;
    reservedSmokedFish += pantrySmokedFish;
    reservedCheese += pantryCheese;
    ale += getNeedStock(residence.needs, 'ale');
    cloth += getNeedStock(residence.needs, 'cloth');
    pottery += getNeedStock(residence.needs, 'pottery');
    remedies += Math.max(0, residence.remedyStock ?? 0);
  }

  const storedPreservedFood = legacyPreservedFood + curedMeat + smokedFish + cheese;
  const storedFood = legacyFood + bread + meat + fish + berries + mushrooms + milk
    + apples + cherries + vegetables + eggs + grapes + porridge
    + storedPreservedFood + honey;
  cachedStoredTotals = {
    timber: Math.max(0, timber),
    stone: Math.max(0, stone),
    firewood,
    water,
    food: storedFood,
    gold: Math.max(0, gold),
    grain,
    barley,
    malt,
    flax,
    flour,
    ale,
    preservedFood: storedPreservedFood,
    honey,
    wine,
    wool,
    cloth,
    ironwork,
    polearms,
    iron,
    clay,
    salt,
    charcoal,
    pottery,
    roofTiles,
    manure,
    remedies,
    bread,
    meat,
    fish,
    berries,
    mushrooms,
    milk,
    apples,
    cherries,
    vegetables,
    eggs,
    grapes,
    porridge,
    curedMeat,
    smokedFish,
    cheese,
    legacyFood,
    legacyPreservedFood,
  };
  const surplusLegacyFood = Math.max(0, legacyFood - reservedLegacyFood);
  const surplusLegacyPreservedFood = Math.max(
    0,
    legacyPreservedFood - reservedLegacyPreservedFood,
  );
  const surplusHoney = Math.max(0, honey - reservedHoney);
  const surplusBread = Math.max(0, bread - reservedBread);
  const surplusMeat = Math.max(0, meat - reservedMeat);
  const surplusFish = Math.max(0, fish - reservedFish);
  const surplusBerries = Math.max(0, berries - reservedBerries);
  const surplusMushrooms = Math.max(0, mushrooms - reservedMushrooms);
  const surplusMilk = Math.max(0, milk - reservedMilk);
  const surplusApples = Math.max(0, apples - reservedApples);
  const surplusCherries = Math.max(0, cherries - reservedCherries);
  const surplusVegetables = Math.max(0, vegetables - reservedVegetables);
  const surplusEggs = Math.max(0, eggs - reservedEggs);
  const surplusGrapes = Math.max(0, grapes - reservedGrapes);
  const surplusPorridge = Math.max(0, porridge - reservedPorridge);
  const surplusCuredMeat = Math.max(0, curedMeat - reservedCuredMeat);
  const surplusSmokedFish = Math.max(0, smokedFish - reservedSmokedFish);
  const surplusCheese = Math.max(0, cheese - reservedCheese);
  const surplusPreservedFood = surplusLegacyPreservedFood + surplusCuredMeat
    + surplusSmokedFish + surplusCheese;
  const surplusFood = surplusLegacyFood + surplusBread + surplusMeat + surplusFish
    + surplusBerries + surplusMushrooms + surplusMilk + surplusApples
    + surplusCherries + surplusVegetables + surplusEggs + surplusGrapes
    + surplusPorridge + surplusPreservedFood + surplusHoney;
  cachedTotals = {
    ...cachedStoredTotals,
    timber: Math.max(0, timber - reservedTimber),
    stone: Math.max(0, stone - reservedStone),
    ironwork: Math.max(0, ironwork - reservedIronwork),
    gold: Math.max(0, gold - reservedGold),
    roofTiles: Math.max(0, roofTiles - reservedRoofTiles),
    food: surplusFood,
    preservedFood: surplusPreservedFood,
    honey: surplusHoney,
    bread: surplusBread,
    meat: surplusMeat,
    fish: surplusFish,
    berries: surplusBerries,
    mushrooms: surplusMushrooms,
    milk: surplusMilk,
    apples: surplusApples,
    cherries: surplusCherries,
    vegetables: surplusVegetables,
    eggs: surplusEggs,
    grapes: surplusGrapes,
    porridge: surplusPorridge,
    curedMeat: surplusCuredMeat,
    smokedFish: surplusSmokedFish,
    cheese: surplusCheese,
    legacyFood: surplusLegacyFood,
    legacyPreservedFood: surplusLegacyPreservedFood,
  };
  cachedState = state;
  return cachedTotals;
}

/**
 * Every physical good presently stored in the settlement, including stock
 * already committed to active construction and household projects.
 */
export function computeStoredResourceTotals(state: GameState): ResourceTotals {
  if (cachedState !== state || !cachedStoredTotals) {
    computeResourceTotals(state);
  }
  return cachedStoredTotals!;
}

/**
 * Loaded goods are still owned and physically represented by their cart, but
 * they are not spendable at a store or destination until unloading. Keep this
 * ledger separate from `computeResourceTotals` so readable HUD feedback never
 * lets client affordability previews promise cargo that the server cannot use.
 */
export function computeInTransitResourceTotals(
  trips: Iterable<DeliveryTripState>,
): ResourceTotals {
  const totals = emptyResourceTotals();
  for (const trip of trips) {
    const amount = Number.isFinite(trip.amount) ? Math.max(0, trip.amount) : 0;
    if (amount <= 1e-6) continue;
    if (trip.cargoKind === 'food') {
      totals.legacyFood += amount;
    } else if (trip.cargoKind === 'preservedFood') {
      totals.legacyPreservedFood += amount;
    } else {
      totals[trip.cargoKind] += amount;
    }
  }
  totals.preservedFood = totals.legacyPreservedFood + totals.curedMeat
    + totals.smokedFish + totals.cheese;
  totals.food = totals.legacyFood + totals.bread + totals.meat + totals.fish
    + totals.berries + totals.mushrooms + totals.milk + totals.apples
    + totals.cherries + totals.vegetables + totals.eggs + totals.grapes
    + totals.porridge + totals.preservedFood + totals.honey;
  return totals;
}

/**
 * Market proceeds, local tolls, ferry fares, and monastery visitor gifts are
 * physically owned but remain unavailable until their cart reaches a civic
 * lockbox.
 */
export function computeGoldAwaitingCollection(
  buildings: Iterable<BuildingState>,
): number {
  let gold = 0;
  for (const building of buildings) {
    if (
      (building.kind === 'marketplace' || building.kind === 'trading_post')
      && building.constructionComplete !== false
      && Number.isFinite(building.gold)
    ) {
      gold += Math.max(0, building.gold);
      continue;
    }
    gold += localCivicReceiptGold(building);
  }
  return gold;
}

/** Gold already committed to local guard-company pay chests. */
export function computeGuardhousePayrollGold(
  buildings: Iterable<BuildingState>,
): number {
  let gold = 0;
  for (const building of buildings) {
    if (
      building.kind === 'guardhouse'
      && building.constructionComplete !== false
      && Number.isFinite(building.gold)
    ) {
      gold += Math.max(0, building.gold);
    }
  }
  return gold;
}

/**
 * Physical timber held at buildings after subtracting active construction
 * reservations backed by those stores. This mirrors the authoritative lodge
 * conversion check.
 */
export function computeUnreservedBuildingTimber(state: GameState): number {
  let timber = 0;
  let reserved = 0;
  for (const building of state.buildings.values()) {
    timber += building.timber;
    if (building.constructionComplete === false) {
      reserved += Math.max(
        0,
        building.constructionReservedTimber - building.constructionTreasuryTimber,
      );
    }
  }
  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      reserved += Math.max(0, residence.upgradeReservedTimber ?? 0);
    }
  }
  return Math.max(0, timber - reserved);
}

export type RoadConnectionQuery = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
) => boolean;

/**
 * Reports goods that can participate in this market's trade loop. Physical
 * saves use the number to decide whether a staging cart can complete the lot;
 * only inventory already at the market is consumed when the trade settles.
 * Legacy saves retain direct access to their compatibility ledger.
 */
export function computeMarketplaceTradeAvailability(
  state: GameState,
  marketplace: BuildingState,
  roadConnected: RoadConnectionQuery,
): MarketplaceTradeAvailability {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const includeLegacyLedger = state.physicalFoundingSiteEnabled !== true;
  let allBuildingTimber = 0;
  let allBuildingStone = 0;
  let allBuildingIronwork = 0;
  let accessibleTimber = 0;
  let accessibleStone = 0;
  let accessibleFirewood = 0;
  let accessibleFood = 0;
  let accessibleGrain = 0;
  let accessibleBarley = 0;
  let accessibleIronwork = 0;
  let accessibleIron = 0;
  let accessibleSalt = 0;
  let accessiblePottery = 0;
  let reservedBuildingTimber = 0;
  let reservedBuildingStone = 0;
  let reservedBuildingIronwork = 0;
  let reservedTreasuryTimber = 0;
  let reservedTreasuryStone = 0;
  let reservedTreasuryIronwork = 0;
  let reservedResidenceTimber = 0;
  let reservedResidenceStone = 0;

  for (const building of state.buildings.values()) {
    allBuildingTimber += building.timber;
    allBuildingStone += building.stone;
    allBuildingIronwork += building.ironwork ?? 0;
    if (building.constructionComplete === false) {
      reservedBuildingTimber += Math.max(
        0,
        building.constructionReservedTimber - building.constructionTreasuryTimber,
      );
      reservedBuildingStone += Math.max(
        0,
        building.constructionReservedStone - building.constructionTreasuryStone,
      );
      reservedBuildingIronwork += Math.max(
        0,
        (building.constructionReservedIronwork ?? 0)
          - (building.constructionTreasuryIronwork ?? 0),
      );
      reservedTreasuryTimber += building.constructionTreasuryTimber;
      reservedTreasuryStone += building.constructionTreasuryStone;
      reservedTreasuryIronwork += building.constructionTreasuryIronwork ?? 0;
      continue;
    }
    if (fireDisabled.has(building.id)) continue;

    const connected = building.id === marketplace.id
      || roadConnected(marketplace.x, marketplace.z, building.x, building.z);
    if (!connected) continue;
    accessibleTimber += building.timber;
    accessibleStone += building.stone;
    accessibleFirewood += building.firewood;
    accessibleFood += building.bread ?? 0;
    accessibleGrain += building.kind === 'granary'
      ? granaryExportableGrain(building.grain, building.granaryGrainReserve ?? 0)
      : building.grain;
    accessibleBarley += building.barley ?? 0;
    accessibleIronwork += building.ironwork ?? 0;
    accessibleIron += building.iron ?? 0;
    accessibleSalt += building.salt ?? 0;
    accessiblePottery += building.pottery ?? 0;
  }

  for (const residence of state.residences?.values() ?? []) {
    if (!residenceHasActiveProject(residence)) continue;
    reservedResidenceTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
    reservedResidenceStone += Math.max(0, residence.upgradeReservedStone ?? 0);
  }

  const unreservedBuildingTimber = Math.max(
    0,
    allBuildingTimber - reservedBuildingTimber - reservedResidenceTimber,
  );
  const unreservedBuildingStone = Math.max(
    0,
    allBuildingStone - reservedBuildingStone - reservedResidenceStone,
  );
  const unreservedBuildingIronwork = Math.max(
    0,
    allBuildingIronwork - reservedBuildingIronwork,
  );
  const ledgerTimber = includeLegacyLedger
    ? Math.max(0, state.stockpile.timber - reservedTreasuryTimber)
    : 0;
  const ledgerStone = includeLegacyLedger
    ? Math.max(0, state.stockpile.stone - reservedTreasuryStone)
    : 0;
  return {
    timber:
      ledgerTimber + Math.min(accessibleTimber, unreservedBuildingTimber),
    stone:
      ledgerStone + Math.min(accessibleStone, unreservedBuildingStone),
    gold: includeLegacyLedger
      ? computeResourceTotals(state).gold
      : Math.max(0, marketplace.gold),
    firewood: (includeLegacyLedger ? state.stockpile.firewood : 0) + accessibleFirewood,
    food: (includeLegacyLedger ? state.stockpile.bread : 0) + accessibleFood,
    grain: (includeLegacyLedger ? state.stockpile.grain : 0) + accessibleGrain,
    barley: (includeLegacyLedger ? (state.stockpile.barley ?? 0) : 0) + accessibleBarley,
    ironwork: (includeLegacyLedger
      ? Math.max(
          0,
          (state.stockpile.ironwork ?? 0) - reservedTreasuryIronwork,
        )
      : 0)
      + Math.min(accessibleIronwork, unreservedBuildingIronwork),
    iron: (includeLegacyLedger ? (state.stockpile.iron ?? 0) : 0) + accessibleIron,
    salt: (includeLegacyLedger ? (state.stockpile.salt ?? 0) : 0) + accessibleSalt,
    pottery: (includeLegacyLedger ? (state.stockpile.pottery ?? 0) : 0) + accessiblePottery,
  };
}

export function computePopulationStats(state: GameState): PopulationStats {
  let housed = 0;
  let housingCapacity = 0;
  let sick = 0;
  for (const residence of state.residences?.values() ?? []) {
    if (residence.abandoned || residence.tier === 0) continue;
    housed += residence.population;
    sick += Math.min(residence.population, residence.sickPopulation ?? 0);
    housingCapacity += residence.populationCapacity;
  }

  const legacyPopulationBonus = state.legacyUnhousedPopulationBonusEnabled
    ?? state.physicalFoundingSiteEnabled !== true;
  const total = legacyPopulationBonus
    ? STARTING_POPULATION + housed
    : Math.max(STARTING_POPULATION, housed);
  let buildingAssigned = 0;
  for (const building of state.buildings.values()) {
    buildingAssigned += building.assignedLabor;
  }
  let residenceUpgradeAssigned = 0;
  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      residenceUpgradeAssigned += Math.max(0, residence.upgradeAssignedLabor ?? 0);
    }
  }
  let cartAssigned = 0;
  for (const trip of state.deliveryTrips.values()) {
    cartAssigned += Math.max(0, trip.freeHaulerWorkers);
  }
  const assigned = buildingAssigned + residenceUpgradeAssigned + cartAssigned;

  return {
    total,
    assigned,
    cartAssigned,
    sick,
    available: Math.max(0, total - assigned - sick),
    housingCapacity,
    housed,
    vacant: Math.max(0, housingCapacity - housed),
  };
}

export function maxAssignableLabor(
  building: BuildingState,
  stats: PopulationStats,
): number {
  const assignedElsewhere = stats.assigned - building.assignedLabor;
  const fromPool = Math.max(0, stats.total - (stats.sick ?? 0) - assignedElsewhere);
  const buildingCap = building.constructionComplete !== false
    ? buildingMaxLabor(building.kind)
    : CONSTRUCTION_MAX_BUILDERS;
  return Math.min(fromPool, buildingCap);
}

function emptyResourceTotals(): ResourceTotals {
  return {
    timber: 0,
    stone: 0,
    firewood: 0,
    water: 0,
    food: 0,
    gold: 0,
    grain: 0,
    barley: 0,
    malt: 0,
    flax: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    roofTiles: 0,
    manure: 0,
    remedies: 0,
    bread: 0,
    meat: 0,
    fish: 0,
    berries: 0,
    mushrooms: 0,
    milk: 0,
    apples: 0,
    cherries: 0,
    vegetables: 0,
    eggs: 0,
    grapes: 0,
    porridge: 0,
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
    legacyFood: 0,
    legacyPreservedFood: 0,
  };
}
