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
  TRADE_RESOURCE_KINDS,
  type StorageCaps,
  type TradeResourceKind,
} from '../generated/gameBalance.ts';
import type { MarketplaceTradeAvailability } from '../economy/marketplaceTrade.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { livestockHoldingProtectsFeedOats } from '../economy/livestockFeedPolicy.ts';
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { localCivicReceiptGold } from '../economy/civicReceipts.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  NAMED_FOOD_KINDS,
  NAMED_FOOD_LABELS,
  foodMealValue,
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
  ryeSheaves: number;
  oatSheaves: number;
  barleySheaves: number;
  maslinSheaves: number;
  ryeGrain: number;
  oatGrain: number;
  animalFeed: number;
  maslinGrain: number;
  barley: number;
  malt: number;
  flax: number;
  ryeFlour: number;
  maslinFlour: number;
  ale: number;
  cider: number;
  pearCider: number;
  mead: number;
  preservedFood: number;
  honey: number;
  wax: number;
  candles: number;
  wine: number;
  wool: number;
  yarn: number;
  linen: number;
  cloth: number;
  pelts: number;
  hides: number;
  leather: number;
  shoes: number;
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
  ryeBread: number;
  maslinBread: number;
  meat: number;
  fish: number;
  berries: number;
  mushrooms: number;
  milk: number;
  apples: number;
  pears: number;
  cherries: number;
  aronia: number;
  rosehips: number;
  vegetables: number;
  cabbage: number;
  carrots: number;
  beetroot: number;
  eggs: number;
  grapes: number;
  curedMeat: number;
  smokedFish: number;
  cheese: number;
  aroniaJam: number;
  rosehipJam: number;
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
  'ryeGrain',
  'oatGrain',
  'animalFeed',
  'maslinGrain',
  'barley',
  'malt',
  'flax',
  'ryeFlour',
  'maslinFlour',
  'ale',
  'cider',
  'pearCider',
  'mead',
  'preservedFood',
  'honey',
  'wax',
  'candles',
  'wine',
  'wool',
  'yarn',
  'linen',
  'cloth',
  'pelts',
  'hides',
  'leather',
  'shoes',
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
  /** Residents explicitly rostered to completed workplaces. */
  assigned: number;
  /** Reserve labor currently building, improving homes, or hauling. */
  flexibleAssigned: number;
  cartAssigned: number;
  sick?: number;
  /** Healthy residents not rostered to a completed workplace. */
  available: number;
  /** Reserve labor not currently carrying out a temporary task. */
  idle: number;
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
  const stockedLivestockBuildings = new Set(
    [...state.livestockHerds.values()]
      .filter((herd) => herd.headCount > 0)
      .map((herd) => herd.buildingId),
  );

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
  let ryeSheaves = ledger?.ryeSheaves ?? 0;
  let oatSheaves = ledger?.oatSheaves ?? 0;
  let barleySheaves = ledger?.barleySheaves ?? 0;
  let maslinSheaves = ledger?.maslinSheaves ?? 0;
  let ryeGrain = ledger?.ryeGrain ?? 0;
  let oatGrain = ledger?.oatGrain ?? 0;
  let animalFeed = ledger?.animalFeed ?? 0;
  let maslinGrain = ledger?.maslinGrain ?? 0;
  let barley = ledger?.barley ?? 0;
  let malt = ledger?.malt ?? 0;
  let flax = ledger?.flax ?? 0;
  let ryeFlour = ledger?.ryeFlour ?? 0;
  let maslinFlour = ledger?.maslinFlour ?? 0;
  let ale = ledger?.ale ?? 0;
  let cider = ledger?.cider ?? 0;
  let pearCider = ledger?.pearCider ?? 0;
  let mead = ledger?.mead ?? 0;
  let legacyPreservedFood = ledger?.preservedFood ?? 0;
  let honey = ledger?.honey ?? 0;
  let wax = ledger?.wax ?? 0;
  let candles = ledger?.candles ?? 0;
  let wine = ledger?.wine ?? 0;
  let wool = ledger?.wool ?? 0;
  let yarn = ledger?.yarn ?? 0;
  let linen = ledger?.linen ?? 0;
  let cloth = ledger?.cloth ?? 0;
  let pelts = ledger?.pelts ?? 0;
  let hides = ledger?.hides ?? 0;
  let leather = ledger?.leather ?? 0;
  let shoes = ledger?.shoes ?? 0;
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
  let ryeBread = ledger?.ryeBread ?? 0;
  let maslinBread = ledger?.maslinBread ?? 0;
  let meat = ledger?.meat ?? 0;
  let fish = ledger?.fish ?? 0;
  let berries = ledger?.berries ?? 0;
  let mushrooms = ledger?.mushrooms ?? 0;
  let milk = ledger?.milk ?? 0;
  let apples = ledger?.apples ?? 0;
  let pears = ledger?.pears ?? 0;
  let cherries = ledger?.cherries ?? 0;
  let aronia = ledger?.aronia ?? 0;
  let rosehips = ledger?.rosehips ?? 0;
  let vegetables = ledger?.vegetables ?? 0;
  let cabbage = ledger?.cabbage ?? 0;
  let carrots = ledger?.carrots ?? 0;
  let beetroot = ledger?.beetroot ?? 0;
  let eggs = ledger?.eggs ?? 0;
  let grapes = ledger?.grapes ?? 0;
  let curedMeat = ledger?.curedMeat ?? 0;
  let smokedFish = ledger?.smokedFish ?? 0;
  let cheese = ledger?.cheese ?? 0;
  let aroniaJam = ledger?.aroniaJam ?? 0;
  let rosehipJam = ledger?.rosehipJam ?? 0;
  let gold = ledger?.gold ?? 0;
  let reservedTimber = 0;
  let reservedStone = 0;
  let reservedFirewood = 0;
  let reservedWater = 0;
  let reservedAle = 0;
  let reservedCloth = 0;
  let reservedShoes = 0;
  let reservedPottery = 0;
  let reservedRemedies = 0;
  let reservedIronwork = 0;
  let reservedGold = 0;
  let reservedRoofTiles = 0;
  let reservedLegacyPreservedFood = 0;
  let reservedOatGrain = 0;
  let reservedHoney = 0;
  let reservedRyeBread = 0;
  let reservedMaslinBread = 0;
  let reservedMeat = 0;
  let reservedFish = 0;
  let reservedBerries = 0;
  let reservedMushrooms = 0;
  let reservedMilk = 0;
  let reservedApples = 0;
  let reservedPears = 0;
  let reservedCherries = 0;
  let reservedAronia = 0;
  let reservedRosehips = 0;
  let reservedVegetables = 0;
  let reservedCabbage = 0;
  let reservedCarrots = 0;
  let reservedBeetroot = 0;
  let reservedEggs = 0;
  let reservedGrapes = 0;
  let reservedCuredMeat = 0;
  let reservedSmokedFish = 0;
  let reservedCheese = 0;
  let reservedAroniaJam = 0;
  let reservedRosehipJam = 0;

  for (const building of state.buildings.values()) {
    timber += building.timber;
    stone += building.stone;
    firewood += building.firewood;
    water += building.water;
    ryeSheaves += building.ryeSheaves ?? 0;
    oatSheaves += building.oatSheaves ?? 0;
    barleySheaves += building.barleySheaves ?? 0;
    maslinSheaves += building.maslinSheaves ?? 0;
    ryeGrain += building.ryeGrain ?? 0;
    const buildingOatGrain = building.oatGrain ?? 0;
    oatGrain += buildingOatGrain;
    animalFeed += building.animalFeed ?? 0;
    if (livestockHoldingProtectsFeedOats(
      building.kind,
      stockedLivestockBuildings.has(building.id),
    )) {
      reservedOatGrain += Math.max(0, buildingOatGrain);
    }
    maslinGrain += building.maslinGrain ?? 0;
    barley += building.barley ?? 0;
    malt += building.malt ?? 0;
    flax += building.flax ?? 0;
    ryeFlour += building.ryeFlour ?? 0;
    maslinFlour += building.maslinFlour ?? 0;
    ale += building.ale;
    cider += building.cider ?? 0;
    pearCider += building.pearCider ?? 0;
    mead += building.mead ?? 0;
    legacyPreservedFood += building.preservedFood;
    honey += building.honey;
    wax += building.wax ?? 0;
    candles += building.candles ?? 0;
    wine += building.wine;
    wool += building.wool ?? 0;
    yarn += building.yarn ?? 0;
    linen += building.linen ?? 0;
    cloth += building.cloth ?? 0;
    pelts += building.pelts ?? 0;
    hides += building.hides ?? 0;
    leather += building.leather ?? 0;
    shoes += building.shoes ?? 0;
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
    ryeBread += building.ryeBread ?? 0;
    maslinBread += building.maslinBread ?? 0;
    meat += building.meat ?? 0;
    fish += building.fish ?? 0;
    berries += building.berries ?? 0;
    mushrooms += building.mushrooms ?? 0;
    milk += building.milk ?? 0;
    apples += building.apples ?? 0;
    pears += building.pears ?? 0;
    cherries += building.cherries ?? 0;
    aronia += building.aronia ?? 0;
    rosehips += building.rosehips ?? 0;
    vegetables += building.vegetables ?? 0;
    cabbage += building.cabbage ?? 0;
    carrots += building.carrots ?? 0;
    beetroot += building.beetroot ?? 0;
    eggs += building.eggs ?? 0;
    grapes += building.grapes ?? 0;
    curedMeat += building.curedMeat ?? 0;
    smokedFish += building.smokedFish ?? 0;
    cheese += building.cheese ?? 0;
    aroniaJam += building.aroniaJam ?? 0;
    rosehipJam += building.rosehipJam ?? 0;
    // Monastery provisions belong to the enclosed estate economy. Keep them in
    // the physical-storage ledger for inspection, but never advertise them as
    // food available to the town's household provisioning plan.
    if (building.kind === 'monastery') {
      reservedLegacyPreservedFood += Math.max(0, building.preservedFood ?? 0);
      reservedOatGrain += Math.max(0, building.oatGrain ?? 0);
      reservedHoney += Math.max(0, building.honey ?? 0);
      reservedRyeBread += Math.max(0, building.ryeBread ?? 0);
      reservedMaslinBread += Math.max(0, building.maslinBread ?? 0);
      reservedMeat += Math.max(0, building.meat ?? 0);
      reservedFish += Math.max(0, building.fish ?? 0);
      reservedBerries += Math.max(0, building.berries ?? 0);
      reservedMushrooms += Math.max(0, building.mushrooms ?? 0);
      reservedMilk += Math.max(0, building.milk ?? 0);
      reservedApples += Math.max(0, building.apples ?? 0);
      reservedPears += Math.max(0, building.pears ?? 0);
      reservedCherries += Math.max(0, building.cherries ?? 0);
      reservedAronia += Math.max(0, building.aronia ?? 0);
      reservedRosehips += Math.max(0, building.rosehips ?? 0);
      reservedVegetables += Math.max(0, building.vegetables ?? 0);
      reservedCabbage += Math.max(0, building.cabbage ?? 0);
      reservedCarrots += Math.max(0, building.carrots ?? 0);
      reservedBeetroot += Math.max(0, building.beetroot ?? 0);
      reservedEggs += Math.max(0, building.eggs ?? 0);
      reservedGrapes += Math.max(0, building.grapes ?? 0);
      reservedCuredMeat += Math.max(0, building.curedMeat ?? 0);
      reservedSmokedFish += Math.max(0, building.smokedFish ?? 0);
      reservedCheese += Math.max(0, building.cheese ?? 0);
      reservedAroniaJam += Math.max(0, building.aroniaJam ?? 0);
      reservedRosehipJam += Math.max(0, building.rosehipJam ?? 0);
    }
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
      reservedRoofTiles += Math.max(0, building.constructionReservedRoofTiles ?? 0);
    }
  }

  for (const garden of state.backyardGardens.values()) {
    wax += garden.waxStock ?? 0;
  }

  for (const residence of state.residences?.values() ?? []) {
    if (residenceHasActiveProject(residence)) {
      reservedTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
      reservedStone += Math.max(0, residence.upgradeReservedStone ?? 0);
      reservedGold += Math.max(0, residence.upgradeReservedGold ?? 0);
      reservedRoofTiles += Math.max(0, residence.upgradeReservedRoofTiles ?? 0);
    }
    const householdFirewood = Math.max(0, getNeedStock(residence.needs, 'firewood'));
    const householdWater = Math.max(0, getNeedStock(residence.needs, 'water'));
    firewood += householdFirewood;
    water += householdWater;
    reservedFirewood += householdFirewood;
    reservedWater += householdWater;
    const pantryLegacyPreserved = Math.max(0, residence.preservedFood ?? 0);
    const pantryOatGrain = Math.max(0, residence.oatGrain ?? 0);
    const pantryHoney = Math.max(0, residence.honey ?? 0);
    const pantryRyeBread = Math.max(0, residence.ryeBread ?? 0);
    const pantryMaslinBread = Math.max(0, residence.maslinBread ?? 0);
    const pantryMeat = Math.max(0, residence.meat ?? 0);
    const pantryFish = Math.max(0, residence.fish ?? 0);
    const pantryBerries = Math.max(0, residence.berries ?? 0);
    const pantryMushrooms = Math.max(0, residence.mushrooms ?? 0);
    const pantryMilk = Math.max(0, residence.milk ?? 0);
    const pantryApples = Math.max(0, residence.apples ?? 0);
    const pantryPears = Math.max(0, residence.pears ?? 0);
    const pantryCherries = Math.max(0, residence.cherries ?? 0);
    const pantryAronia = Math.max(0, residence.aronia ?? 0);
    const pantryRosehips = Math.max(0, residence.rosehips ?? 0);
    const pantryVegetables = Math.max(0, residence.vegetables ?? 0);
    const pantryCabbage = Math.max(0, residence.cabbage ?? 0);
    const pantryCarrots = Math.max(0, residence.carrots ?? 0);
    const pantryBeetroot = Math.max(0, residence.beetroot ?? 0);
    const pantryEggs = Math.max(0, residence.eggs ?? 0);
    const pantryGrapes = Math.max(0, residence.grapes ?? 0);
    const pantryCuredMeat = Math.max(0, residence.curedMeat ?? 0);
    const pantrySmokedFish = Math.max(0, residence.smokedFish ?? 0);
    const pantryCheese = Math.max(0, residence.cheese ?? 0);
    const pantryAroniaJam = Math.max(0, residence.aroniaJam ?? 0);
    const pantryRosehipJam = Math.max(0, residence.rosehipJam ?? 0);
    legacyPreservedFood += pantryLegacyPreserved;
    oatGrain += pantryOatGrain;
    honey += pantryHoney;
    ryeBread += pantryRyeBread;
    maslinBread += pantryMaslinBread;
    meat += pantryMeat;
    fish += pantryFish;
    berries += pantryBerries;
    mushrooms += pantryMushrooms;
    milk += pantryMilk;
    apples += pantryApples;
    pears += pantryPears;
    cherries += pantryCherries;
    aronia += pantryAronia;
    rosehips += pantryRosehips;
    vegetables += pantryVegetables;
    cabbage += pantryCabbage;
    carrots += pantryCarrots;
    beetroot += pantryBeetroot;
    eggs += pantryEggs;
    grapes += pantryGrapes;
    curedMeat += pantryCuredMeat;
    smokedFish += pantrySmokedFish;
    cheese += pantryCheese;
    aroniaJam += pantryAroniaJam;
    rosehipJam += pantryRosehipJam;
    reservedLegacyPreservedFood += pantryLegacyPreserved;
    reservedOatGrain += pantryOatGrain;
    reservedHoney += pantryHoney;
    reservedRyeBread += pantryRyeBread;
    reservedMaslinBread += pantryMaslinBread;
    reservedMeat += pantryMeat;
    reservedFish += pantryFish;
    reservedBerries += pantryBerries;
    reservedMushrooms += pantryMushrooms;
    reservedMilk += pantryMilk;
    reservedApples += pantryApples;
    reservedPears += pantryPears;
    reservedCherries += pantryCherries;
    reservedAronia += pantryAronia;
    reservedRosehips += pantryRosehips;
    reservedVegetables += pantryVegetables;
    reservedCabbage += pantryCabbage;
    reservedCarrots += pantryCarrots;
    reservedBeetroot += pantryBeetroot;
    reservedEggs += pantryEggs;
    reservedGrapes += pantryGrapes;
    reservedCuredMeat += pantryCuredMeat;
    reservedSmokedFish += pantrySmokedFish;
    reservedCheese += pantryCheese;
    reservedAroniaJam += pantryAroniaJam;
    reservedRosehipJam += pantryRosehipJam;
    const householdAle = Math.max(0, getNeedStock(residence.needs, 'ale'));
    const householdCloth = Math.max(0, getNeedStock(residence.needs, 'cloth'));
    const householdShoes = Math.max(0, getNeedStock(residence.needs, 'shoes'));
    const householdPottery = Math.max(0, getNeedStock(residence.needs, 'pottery'));
    const householdRemedies = Math.max(0, residence.remedyStock ?? 0);
    ale += householdAle;
    cloth += householdCloth;
    shoes += householdShoes;
    pottery += householdPottery;
    remedies += householdRemedies;
    reservedAle += householdAle;
    reservedCloth += householdCloth;
    reservedShoes += householdShoes;
    reservedPottery += householdPottery;
    reservedRemedies += householdRemedies;
  }

  const storedPreservedFood = legacyPreservedFood * foodMealValue('preservedFood')
    + curedMeat * foodMealValue('curedMeat')
    + smokedFish * foodMealValue('smokedFish')
    + cheese * foodMealValue('cheese')
    + aroniaJam * foodMealValue('aroniaJam')
    + rosehipJam * foodMealValue('rosehipJam');
  const storedFood = oatGrain * foodMealValue('oatGrain')
    + ryeBread * foodMealValue('ryeBread')
    + maslinBread * foodMealValue('maslinBread')
    + meat * foodMealValue('meat')
    + fish * foodMealValue('fish')
    + berries * foodMealValue('berries')
    + mushrooms * foodMealValue('mushrooms')
    + milk * foodMealValue('milk')
    + apples * foodMealValue('apples')
    + pears * foodMealValue('pears')
    + cherries * foodMealValue('cherries')
    + aronia * foodMealValue('aronia')
    + rosehips * foodMealValue('rosehips')
    + vegetables * foodMealValue('vegetables')
    + cabbage * foodMealValue('cabbage')
    + carrots * foodMealValue('carrots')
    + beetroot * foodMealValue('beetroot')
    + eggs * foodMealValue('eggs')
    + grapes * foodMealValue('grapes')
    + storedPreservedFood
    + honey * foodMealValue('honey');
  cachedStoredTotals = {
    timber: Math.max(0, timber),
    stone: Math.max(0, stone),
    firewood,
    water,
    food: storedFood,
    gold: Math.max(0, gold),
    ryeSheaves,
    oatSheaves,
    barleySheaves,
    maslinSheaves,
    ryeGrain,
    oatGrain,
    animalFeed,
    maslinGrain,
    barley,
    malt,
    flax,
    ryeFlour,
    maslinFlour,
    ale,
    cider,
    pearCider,
    mead,
    preservedFood: storedPreservedFood,
    honey,
    wax,
    candles,
    wine,
    wool,
    yarn,
    linen,
    cloth,
    pelts,
    hides,
    leather,
    shoes,
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
    ryeBread,
    maslinBread,
    meat,
    fish,
    berries,
    mushrooms,
    milk,
    apples,
    pears,
    cherries,
    aronia,
    rosehips,
    vegetables,
    cabbage,
    carrots,
    beetroot,
    eggs,
    grapes,
    curedMeat,
    smokedFish,
    cheese,
    aroniaJam,
    rosehipJam,
    legacyPreservedFood,
  };
  const surplusLegacyPreservedFood = Math.max(
    0,
    legacyPreservedFood - reservedLegacyPreservedFood,
  );
  const surplusOatGrain = Math.max(0, oatGrain - reservedOatGrain);
  const surplusHoney = Math.max(0, honey - reservedHoney);
  const surplusRyeBread = Math.max(0, ryeBread - reservedRyeBread);
  const surplusMaslinBread = Math.max(0, maslinBread - reservedMaslinBread);
  const surplusMeat = Math.max(0, meat - reservedMeat);
  const surplusFish = Math.max(0, fish - reservedFish);
  const surplusBerries = Math.max(0, berries - reservedBerries);
  const surplusMushrooms = Math.max(0, mushrooms - reservedMushrooms);
  const surplusMilk = Math.max(0, milk - reservedMilk);
  const surplusApples = Math.max(0, apples - reservedApples);
  const surplusPears = Math.max(0, pears - reservedPears);
  const surplusCherries = Math.max(0, cherries - reservedCherries);
  const surplusAronia = Math.max(0, aronia - reservedAronia);
  const surplusRosehips = Math.max(0, rosehips - reservedRosehips);
  const surplusVegetables = Math.max(0, vegetables - reservedVegetables);
  const surplusCabbage = Math.max(0, cabbage - reservedCabbage);
  const surplusCarrots = Math.max(0, carrots - reservedCarrots);
  const surplusBeetroot = Math.max(0, beetroot - reservedBeetroot);
  const surplusEggs = Math.max(0, eggs - reservedEggs);
  const surplusGrapes = Math.max(0, grapes - reservedGrapes);
  const surplusCuredMeat = Math.max(0, curedMeat - reservedCuredMeat);
  const surplusSmokedFish = Math.max(0, smokedFish - reservedSmokedFish);
  const surplusCheese = Math.max(0, cheese - reservedCheese);
  const surplusAroniaJam = Math.max(0, aroniaJam - reservedAroniaJam);
  const surplusRosehipJam = Math.max(0, rosehipJam - reservedRosehipJam);
  const surplusPreservedFood = surplusLegacyPreservedFood * foodMealValue('preservedFood')
    + surplusCuredMeat * foodMealValue('curedMeat')
    + surplusSmokedFish * foodMealValue('smokedFish')
    + surplusCheese * foodMealValue('cheese')
    + surplusAroniaJam * foodMealValue('aroniaJam')
    + surplusRosehipJam * foodMealValue('rosehipJam');
  const surplusFood = surplusOatGrain * foodMealValue('oatGrain')
    + surplusRyeBread * foodMealValue('ryeBread')
    + surplusMaslinBread * foodMealValue('maslinBread')
    + surplusMeat * foodMealValue('meat')
    + surplusFish * foodMealValue('fish')
    + surplusBerries * foodMealValue('berries')
    + surplusMushrooms * foodMealValue('mushrooms')
    + surplusMilk * foodMealValue('milk')
    + surplusApples * foodMealValue('apples')
    + surplusPears * foodMealValue('pears')
    + surplusCherries * foodMealValue('cherries')
    + surplusAronia * foodMealValue('aronia')
    + surplusRosehips * foodMealValue('rosehips')
    + surplusVegetables * foodMealValue('vegetables')
    + surplusCabbage * foodMealValue('cabbage')
    + surplusCarrots * foodMealValue('carrots')
    + surplusBeetroot * foodMealValue('beetroot')
    + surplusEggs * foodMealValue('eggs')
    + surplusGrapes * foodMealValue('grapes')
    + surplusPreservedFood
    + surplusHoney * foodMealValue('honey');
  cachedTotals = {
    ...cachedStoredTotals,
    timber: Math.max(0, timber - reservedTimber),
    stone: Math.max(0, stone - reservedStone),
    firewood: Math.max(0, firewood - reservedFirewood),
    water: Math.max(0, water - reservedWater),
    ale: Math.max(0, ale - reservedAle),
    cloth: Math.max(0, cloth - reservedCloth),
    shoes: Math.max(0, shoes - reservedShoes),
    pottery: Math.max(0, pottery - reservedPottery),
    remedies: Math.max(0, remedies - reservedRemedies),
    ironwork: Math.max(0, ironwork - reservedIronwork),
    gold: Math.max(0, gold - reservedGold),
    roofTiles: Math.max(0, roofTiles - reservedRoofTiles),
    food: surplusFood,
    oatGrain: surplusOatGrain,
    preservedFood: surplusPreservedFood,
    honey: surplusHoney,
    ryeBread: surplusRyeBread,
    maslinBread: surplusMaslinBread,
    meat: surplusMeat,
    fish: surplusFish,
    berries: surplusBerries,
    mushrooms: surplusMushrooms,
    milk: surplusMilk,
    apples: surplusApples,
    pears: surplusPears,
    cherries: surplusCherries,
    aronia: surplusAronia,
    rosehips: surplusRosehips,
    vegetables: surplusVegetables,
    cabbage: surplusCabbage,
    carrots: surplusCarrots,
    beetroot: surplusBeetroot,
    eggs: surplusEggs,
    grapes: surplusGrapes,
    curedMeat: surplusCuredMeat,
    smokedFish: surplusSmokedFish,
    cheese: surplusCheese,
    aroniaJam: surplusAroniaJam,
    rosehipJam: surplusRosehipJam,
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
    if (trip.cargoKind === 'preservedFood') {
      totals.legacyPreservedFood += amount;
    } else {
      totals[trip.cargoKind] += amount;
    }
  }
  totals.preservedFood = totals.legacyPreservedFood * foodMealValue('preservedFood')
    + totals.curedMeat * foodMealValue('curedMeat')
    + totals.smokedFish * foodMealValue('smokedFish')
    + totals.cheese * foodMealValue('cheese')
    + totals.aroniaJam * foodMealValue('aroniaJam')
    + totals.rosehipJam * foodMealValue('rosehipJam');
  totals.food = totals.oatGrain * foodMealValue('oatGrain')
    + totals.ryeBread * foodMealValue('ryeBread')
    + totals.maslinBread * foodMealValue('maslinBread')
    + totals.meat * foodMealValue('meat')
    + totals.fish * foodMealValue('fish')
    + totals.berries * foodMealValue('berries')
    + totals.mushrooms * foodMealValue('mushrooms')
    + totals.milk * foodMealValue('milk')
    + totals.apples * foodMealValue('apples')
    + totals.pears * foodMealValue('pears')
    + totals.cherries * foodMealValue('cherries')
    + totals.aronia * foodMealValue('aronia')
    + totals.rosehips * foodMealValue('rosehips')
    + totals.vegetables * foodMealValue('vegetables')
    + totals.cabbage * foodMealValue('cabbage')
    + totals.carrots * foodMealValue('carrots')
    + totals.beetroot * foodMealValue('beetroot')
    + totals.eggs * foodMealValue('eggs')
    + totals.grapes * foodMealValue('grapes')
    + totals.preservedFood
    + totals.honey * foodMealValue('honey');
  return totals;
}

/**
 * Market proceeds, local tolls, and monastery visitor gifts are
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
  const stockedLivestockBuildings = new Set(
    [...state.livestockHerds.values()]
      .filter((herd) => herd.headCount > 0)
      .map((herd) => herd.buildingId),
  );
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const includeLegacyLedger = state.physicalFoundingSiteEnabled !== true;
  const availability = Object.fromEntries(
    [...TRADE_RESOURCE_KINDS, 'gold'].map((resource) => [resource, 0]),
  ) as MarketplaceTradeAvailability;
  let allBuildingTimber = 0;
  let allBuildingStone = 0;
  let allBuildingIronwork = 0;
  let allBuildingRoofTiles = 0;
  let reservedBuildingTimber = 0;
  let reservedBuildingStone = 0;
  let reservedBuildingIronwork = 0;
  let reservedBuildingRoofTiles = 0;
  let reservedTreasuryTimber = 0;
  let reservedTreasuryStone = 0;
  let reservedTreasuryIronwork = 0;
  let reservedTreasuryRoofTiles = 0;
  let reservedResidenceTimber = 0;
  let reservedResidenceStone = 0;
  let reservedResidenceRoofTiles = 0;

  for (const building of state.buildings.values()) {
    allBuildingTimber += building.timber;
    allBuildingStone += building.stone;
    allBuildingIronwork += building.ironwork ?? 0;
    allBuildingRoofTiles += building.roofTiles ?? 0;
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
      reservedBuildingRoofTiles += Math.max(
        0,
        (building.constructionReservedRoofTiles ?? 0)
          - (building.constructionTreasuryRoofTiles ?? 0),
      );
      reservedTreasuryTimber += building.constructionTreasuryTimber;
      reservedTreasuryStone += building.constructionTreasuryStone;
      reservedTreasuryIronwork += building.constructionTreasuryIronwork ?? 0;
      reservedTreasuryRoofTiles += building.constructionTreasuryRoofTiles ?? 0;
      continue;
    }
    if (fireDisabled.has(building.id)) continue;

    const connected = building.id === marketplace.id
      || roadConnected(marketplace.x, marketplace.z, building.x, building.z);
    if (!connected) continue;
    for (const resource of TRADE_RESOURCE_KINDS) {
      let stock = tradeResourceBuildingStock(building, resource);
      if (resource === 'oatGrain' && livestockHoldingProtectsFeedOats(
        building.kind,
        stockedLivestockBuildings.has(building.id),
      )) {
        // Trade availability is expressed in physical commodity units. Oats
        // convert to meals only in the separate food total, so protect every
        // staged oat here rather than applying their 0.5 meal value.
        stock = 0;
      } else if (
        (resource === 'ryeGrain' || resource === 'oatGrain' || resource === 'maslinGrain')
        && building.kind === 'granary'
      ) {
        stock = granaryExportableGrain(stock, building.granaryGrainReserve ?? 0);
      }
      availability[resource] += Math.max(0, stock);
    }
  }

  for (const residence of state.residences?.values() ?? []) {
    if (!residenceHasActiveProject(residence)) continue;
    reservedResidenceTimber += Math.max(0, residence.upgradeReservedTimber ?? 0);
    reservedResidenceStone += Math.max(0, residence.upgradeReservedStone ?? 0);
    reservedResidenceRoofTiles += Math.max(0, residence.upgradeReservedRoofTiles ?? 0);
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
  const unreservedBuildingRoofTiles = Math.max(
    0,
    allBuildingRoofTiles - reservedBuildingRoofTiles - reservedResidenceRoofTiles,
  );
  const ledgerTimber = includeLegacyLedger
    ? Math.max(0, state.stockpile.timber - reservedTreasuryTimber)
    : 0;
  const ledgerStone = includeLegacyLedger
    ? Math.max(0, state.stockpile.stone - reservedTreasuryStone)
    : 0;
  availability.timber = ledgerTimber + Math.min(availability.timber, unreservedBuildingTimber);
  availability.stone = ledgerStone + Math.min(availability.stone, unreservedBuildingStone);
  availability.ironwork = (includeLegacyLedger
    ? Math.max(0, (state.stockpile.ironwork ?? 0) - reservedTreasuryIronwork)
    : 0) + Math.min(availability.ironwork, unreservedBuildingIronwork);
  availability.roofTiles = (includeLegacyLedger
    ? Math.max(0, (state.stockpile.roofTiles ?? 0) - reservedTreasuryRoofTiles)
    : 0) + Math.min(availability.roofTiles, unreservedBuildingRoofTiles);
  if (includeLegacyLedger) {
    for (const resource of TRADE_RESOURCE_KINDS) {
      if (
        resource === 'timber'
        || resource === 'stone'
        || resource === 'ironwork'
        || resource === 'roofTiles'
      ) continue;
      availability[resource] += tradeResourceLedgerStock(state, resource);
    }
  }
  availability.gold = includeLegacyLedger
    ? computeResourceTotals(state).gold
    : Math.max(0, marketplace.gold);
  return availability;
}

function tradeResourceBuildingStock(
  building: BuildingState,
  resource: TradeResourceKind,
): number {
  return (building as unknown as Partial<Record<TradeResourceKind, number>>)[resource] ?? 0;
}

function tradeResourceLedgerStock(
  state: GameState,
  resource: TradeResourceKind,
): number {
  if (resource === 'manure' || resource === 'remedies') return 0;
  return Math.max(
    0,
    (state.stockpile as unknown as Partial<Record<TradeResourceKind, number>>)[resource] ?? 0,
  );
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

  const settlements = state.settlements?.values();
  const hasSettlementRows = (state.settlements?.size ?? 0) > 0;
  const total = hasSettlementRows
    ? housed + [...settlements!].reduce(
        (sum, settlement) => sum + (settlement.active ? settlement.unhousedFounders : 0),
        0,
      )
    : (state.legacyUnhousedPopulationBonusEnabled
        ?? state.physicalFoundingSiteEnabled !== true)
      ? STARTING_POPULATION + housed
      : Math.max(STARTING_POPULATION, housed);
  let workplaceAssigned = 0;
  let constructionAssigned = 0;
  for (const building of state.buildings.values()) {
    if (building.constructionComplete === false) {
      constructionAssigned += Math.max(0, building.assignedLabor);
    } else {
      workplaceAssigned += Math.max(0, building.assignedLabor);
    }
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
  const flexibleAssigned = constructionAssigned + residenceUpgradeAssigned + cartAssigned;
  const healthy = Math.max(0, total - sick);
  const available = Math.max(0, healthy - workplaceAssigned);

  return {
    total,
    assigned: workplaceAssigned,
    flexibleAssigned,
    cartAssigned,
    sick,
    available,
    idle: Math.max(0, available - flexibleAssigned),
    housingCapacity,
    housed,
    vacant: Math.max(0, housingCapacity - housed),
  };
}

export function maxAssignableLabor(
  building: BuildingState,
  stats: PopulationStats,
): number {
  const healthy = Math.max(0, stats.total - (stats.sick ?? 0));
  const committedElsewhere = building.constructionComplete !== false
    ? stats.assigned - building.assignedLabor
    : stats.assigned + stats.flexibleAssigned - building.assignedLabor;
  const fromPool = Math.max(0, healthy - committedElsewhere);
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
    ryeSheaves: 0,
    oatSheaves: 0,
    barleySheaves: 0,
    maslinSheaves: 0,
    ryeGrain: 0,
    oatGrain: 0,
    animalFeed: 0,
    maslinGrain: 0,
    barley: 0,
    malt: 0,
    flax: 0,
    ryeFlour: 0,
    maslinFlour: 0,
    ale: 0,
    cider: 0,
    pearCider: 0,
    mead: 0,
    preservedFood: 0,
    honey: 0,
    wax: 0,
    candles: 0,
    wine: 0,
    wool: 0,
    yarn: 0,
    linen: 0,
    cloth: 0,
    pelts: 0,
    hides: 0,
    leather: 0,
    shoes: 0,
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
    ryeBread: 0,
    maslinBread: 0,
    meat: 0,
    fish: 0,
    berries: 0,
    mushrooms: 0,
    milk: 0,
    apples: 0,
    pears: 0,
    cherries: 0,
    aronia: 0,
    rosehips: 0,
    vegetables: 0,
    cabbage: 0,
    carrots: 0,
    beetroot: 0,
    eggs: 0,
    grapes: 0,
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
    aroniaJam: 0,
    rosehipJam: 0,
    legacyPreservedFood: 0,
  };
}
