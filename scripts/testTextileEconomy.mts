import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  canStoreFullSheepClip,
  projectedSheepFleece,
  sheepFleeceOutput,
} from '../src/economy/livestockPolicy.ts';
import {
  computeSettlementTextilePlan,
  textileChainBalanceLabel,
} from '../src/economy/settlementTextiles.ts';
import {
  BUILDING_STORAGE_CAPS,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_SHEARING_START_MONTH,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  TEXTILE_TRANSFER_PER_TRIP,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
} from '../src/logistics/deliveryTrips.ts';
import {
  createDefaultNeeds,
  needKindFromId,
} from '../src/residences/residenceNeedState.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import { getBuildingProcessorStatus } from '../src/resources/inspector/buildingProcessorStatus.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type LivestockHerdState,
  type ResidenceState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import {
  BUILD_MENU_ENTRIES,
  RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
} from '../src/ui/buildMenuCards.ts';

function weaver(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'weaver-1',
    kind: 'weaver',
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionComplete: true,
    ...partial,
  };
}

assert.equal(SHEEP_SHEARING_START_MONTH, 6);
assert.equal(SHEEP_SHEARING_END_MONTH, 7);
assert.equal(SHEEP_WOOL_PER_SHEARING_PER_HEAD, 3);
assert.equal(WEAVER_WOOL_PER_CYCLE, 3);
assert.equal(WEAVER_CLOTH_PER_CYCLE, 2);
assert.equal(TEXTILE_TRANSFER_PER_TRIP, 12);
assert.equal(SPECIALTY_EXPORT_GOLD_PER_CLOTH, 1.5);
assert.equal(RESIDENCE_CLOTH_CAPACITY, 8);
assert.equal(RESIDENCE_CLOTH_PER_PERSON_PER_SEC, 0.00018);
assert.equal(BUILDING_STORAGE_CAPS.pastoral_farmstead.wool, 120);
assert.equal(BUILDING_STORAGE_CAPS.weaver.wool, 90);
assert.equal(BUILDING_STORAGE_CAPS.weaver.cloth, 90);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.cloth, 120);
assert.equal(sheepFleeceOutput(4.5), 13.5);
assert.equal(
  projectedSheepFleece({
    headCount: 6,
    suppliedCapacity: 5,
    health: 0.8,
  }),
  12,
);
assert.equal(canStoreFullSheepClip(18, 18), true);
assert.equal(canStoreFullSheepClip(18, 17.99), false);

const definition = getBuildingDefinition('weaver');
assert.equal(definition.maxLabor, 2);
assert.equal(definition.requiresRoad, true);
assert.equal(definition.facesRoad, true);
assert.ok(RURAL_INDUSTRY_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.ok(BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'weaver'));
assert.match(renderBuildMenuCards(), /weaver\.webp/);

assert.equal(cargoKindFromId(13), 'wool');
assert.equal(cargoKindFromId(14), 'cloth');
assert.equal(cargoKindLabel('wool'), 'Wool');
assert.equal(cargoKindLabel('cloth'), 'Cloth');
assert.equal(needKindFromId(14), 'cloth');
assert.equal(createDefaultNeeds().cloth.stock, 0);

const worldQueries = {} as WorldQueries;
assert.match(
  getBuildingProcessorStatus(weaver(), worldQueries)?.statusText ?? '',
  /Waiting for wool/,
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({ wool: WEAVER_WOOL_PER_CYCLE }),
    worldQueries,
  )?.statusText,
  'Weaving wool into cloth',
);
assert.equal(
  getBuildingProcessorStatus(
    weaver({ wool: WEAVER_WOOL_PER_CYCLE, cloth: BUILDING_STORAGE_CAPS.weaver.cloth }),
    worldQueries,
  )?.statusText,
  'Output target reached — production paused',
);

const emptyVisual = buildingMarkerSignatures(
  new Map([['weaver-1', weaver()]]),
).visual;
const firstBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 1 })]]),
).visual;
const sameBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 2 })]]),
).visual;
const firstClothBundle = buildingMarkerSignatures(
  new Map([['weaver-1', weaver({ wool: 2, cloth: 1 })]]),
).visual;
assert.notEqual(firstBundle, emptyVisual);
assert.equal(
  sameBundle,
  firstBundle,
  'small textile stock changes inside one bundle must not rebuild the workshop mesh',
);
assert.notEqual(firstClothBundle, sameBundle);

const textileState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  livestockHerds: new Map<string, LivestockHerdState>(),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map<string, import('../src/logistics/deliveryTrips.ts').DeliveryTripState>(),
};
textileState.stockpile.wool = 2;
textileState.stockpile.cloth = 1;
const storageBlockedHolding = weaver({
  id: 'sheep-storage-blocked',
  kind: 'pastoral_farmstead',
  assignedLabor: 1,
  wool: 110,
});
const readyHolding = weaver({
  id: 'sheep-ready',
  kind: 'pastoral_farmstead',
  assignedLabor: 1,
  wool: 0,
});
const unstaffedHolding = weaver({
  id: 'sheep-unstaffed',
  kind: 'pastoral_farmstead',
  assignedLabor: 0,
  wool: 0,
});
const staffedWeaver = weaver({ wool: 4, cloth: 5 });
textileState.buildings.set(storageBlockedHolding.id, storageBlockedHolding);
textileState.buildings.set(readyHolding.id, readyHolding);
textileState.buildings.set(unstaffedHolding.id, unstaffedHolding);
textileState.buildings.set(staffedWeaver.id, staffedWeaver);
textileState.livestockHerds.set(
  storageBlockedHolding.id,
  sheepHerd(storageBlockedHolding.id),
);
textileState.livestockHerds.set(
  readyHolding.id,
  sheepHerd(readyHolding.id, { lastShearingYear: 2, lastWoolOutput: 15 }),
);
textileState.livestockHerds.set(
  unstaffedHolding.id,
  sheepHerd(unstaffedHolding.id),
);
const prosperousHome = textileResidence('prosperous-home', 5, 3);
prosperousHome.needs.cloth = { stock: 3, deficitTicks: 0 };
textileState.residences.set(prosperousHome.id, prosperousHome);
textileState.deliveryTrips.set(
  'wool-cart',
  textileTrip('wool-cart', 'wool', 6, 'outbound'),
);
textileState.deliveryTrips.set(
  'cloth-cart',
  textileTrip('cloth-cart', 'cloth', 2, 'unloading'),
);
textileState.deliveryTrips.set(
  'returning-cloth-cart',
  textileTrip('returning-cloth-cart', 'cloth', 99, 'inbound'),
);

const annualTextiles = computeSettlementTextilePlan({
  state: textileState,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 1,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.05,
  },
});
assert.equal(annualTextiles.sheepHoldings, 3);
assert.equal(annualTextiles.staffedSheepHoldings, 2);
assert.equal(annualTextiles.sheepHeadCount, 18);
assert.equal(annualTextiles.shornHoldings, 1);
assert.equal(annualTextiles.pendingHoldings, 2);
assert.equal(annualTextiles.readyPendingHoldings, 0);
assert.equal(annualTextiles.storageBlockedHoldings, 1);
assert.equal(annualTextiles.staffingBlockedHoldings, 1);
assert.equal(annualTextiles.projectedAnnualWool, 51);
assert.equal(annualTextiles.securedAnnualWool, 15);
assert.equal(annualTextiles.annualWoolAtRisk, 36);
assert.equal(annualTextiles.firstAttentionBuildingId, storageBlockedHolding.id);
assert.equal(annualTextiles.firstAttentionKind, 'storage');
assert.equal(annualTextiles.woolInTransit, 6);
assert.equal(annualTextiles.woolStock, 122);
assert.equal(annualTextiles.clothInTransit, 2);
assert.equal(annualTextiles.clothStock, 11);
assert.equal(annualTextiles.annualClothPotential, 34);
assert.equal(annualTextiles.annualHouseholdClothDemand, 6);
assert.equal(annualTextiles.annualClothBalance, 28);
assert.match(textileChainBalanceLabel(annualTextiles), /covered/);

const missedTextiles = computeSettlementTextilePlan({
  state: textileState,
  clock: { month: 8, year: 2 },
  production: {
    clothWoolPerDay: 1,
    clothOutputPerDay: 2 / 3,
    clothDemandPerDay: 0.5,
  },
});
assert.equal(missedTextiles.missedHoldings, 2);
assert.equal(missedTextiles.pendingHoldings, 0);
assert.equal(missedTextiles.securedAnnualWool, 15);
assert.match(textileChainBalanceLabel(missedTextiles), /Fleece-limited/);

const perfTextiles = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  livestockHerds: new Map<string, LivestockHerdState>(),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map<string, import('../src/logistics/deliveryTrips.ts').DeliveryTripState>(),
};
for (let index = 0; index < 100_000; index += 1) {
  const id = `sheep-${index}`;
  perfTextiles.buildings.set(
    id,
    weaver({ id, kind: 'pastoral_farmstead', wool: index % 2 === 0 ? 0 : 110 }),
  );
  perfTextiles.livestockHerds.set(id, sheepHerd(id));
}
const textilePerfStarted = performance.now();
const largeTextilePlan = computeSettlementTextilePlan({
  state: perfTextiles,
  clock: { month: 6, year: 2 },
  production: {
    clothWoolPerDay: 100_000,
    clothOutputPerDay: 200_000 / 3,
    clothDemandPerDay: 1,
  },
});
const textilePerfElapsedMs = performance.now() - textilePerfStarted;
assert.equal(largeTextilePlan.sheepHoldings, 100_000);
assert.equal(largeTextilePlan.storageBlockedHoldings, 50_000);
assert.equal(largeTextilePlan.readyPendingHoldings, 50_000);
assert.ok(
  textilePerfElapsedMs < 350,
  `100,000-holding textile plan took ${textilePerfElapsedMs.toFixed(1)} ms`,
);

const livestockSimulation = readFileSync('server/src/simulation/livestock.rs', 'utf8');
const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const marketplaceCaravan = readFileSync(
  'server/src/simulation/marketplace_caravan.rs',
  'utf8',
);
const commodities = readFileSync('server/src/economy/commodities.rs', 'utf8');
const residenceNeedState = readFileSync(
  'server/src/simulation/residence_needs/state.rs',
  'utf8',
);
assert.match(livestockSimulation, /herd\.last_shearing_year != clock\.year/);
assert.match(livestockSimulation, /can_store_full_sheep_clip/);
assert.match(livestockSimulation, /deposit_building_commodity\(building, CommodityKind::Wool/);
assert.match(livestockSimulation, /CommodityKind::Wool,[\s\S]{0,120}&\["weaver"\]/);
assert.doesNotMatch(livestockSimulation, /credit_treasury_gold/);
assert.match(expandedEconomy, /pub fn step_weaver/);
assert.match(
  expandedEconomy,
  /CommodityKind::Wool, WEAVER_WOOL_PER_CYCLE[\s\S]*CommodityKind::Cloth, WEAVER_CLOTH_PER_CYCLE/,
);
assert.match(expandedEconomy, /CommodityKind::Cloth,[\s\S]{0,120}&\["marketplace"\]/);
assert.match(
  expandedEconomy,
  /step_weaver[\s\S]*dispatch_need\([\s\S]*ResidenceNeedKind::Cloth[\s\S]*dispatch_to_building\(/,
  'weavers must dispatch to claimed homes before exporting remaining cloth',
);
assert.match(
  expandedEconomy,
  /starting_cloth <= 1e-6[\s\S]*ctx\.db\.building\(\)\.id\(\)\.update\(weaver\.clone\(\)\)[\s\S]*invalidate_specialty_claims[\s\S]*ResidenceNeedKind::Cloth/,
  'the first woven batch must be visible when household territory claims are built',
);
assert.match(marketplaceCaravan, /CommodityKind::Cloth, SPECIALTY_EXPORT_GOLD_PER_CLOTH/);
assert.match(commodities, /Self::Wool => 13/);
assert.match(commodities, /Self::Cloth => 14/);
assert.match(
  residenceNeedState,
  /missing_cloth[\s\S]*legacy_tier >= 3[\s\S]*RESIDENCE_CLOTH_CAPACITY/,
  'only legacy tier-3 homes should receive the one-time textile transition buffer',
);

const townHallRenderer = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallRenderer, /Annual wool clip/);
assert.match(townHallRenderer, /Shearing readiness/);
assert.match(townHallRenderer, /Textile stores/);
assert.match(townHallRenderer, /Textile chain/);
assert.match(townHallRenderer, /first loft without full-clip room/);

console.log(
  `textile economy tests passed (${textilePerfElapsedMs.toFixed(1)} ms for 100,000 holdings)`,
);

function sheepHerd(
  buildingId: string,
  partial: Partial<LivestockHerdState> = {},
): LivestockHerdState {
  return {
    buildingId,
    species: 'sheep',
    headCount: 6,
    health: 1,
    breedingProgress: 0,
    pastureCapacity: 6,
    suppliedCapacity: 6,
    lastFoodOutput: 0,
    lastPreservedOutput: 0,
    lastWoolGold: 0,
    lastWoolOutput: 0,
    lastShearingYear: 1,
    breedingReserve: 12,
    lastCulled: 0,
    hayStock: 0,
    lastHayOutput: 0,
    haymakingPercent: 0,
    ...partial,
  };
}

function textileResidence(
  id: string,
  population: number,
  tier: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

function textileTrip(
  id: string,
  cargoKind: 'wool' | 'cloth',
  amount: number,
  phase: 'outbound' | 'unloading' | 'inbound',
): import('../src/logistics/deliveryTrips.ts').DeliveryTripState {
  return {
    id,
    buildingId: 'origin',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'target',
    cargoKind,
    amount,
    phase,
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    pathDistance: 1,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}
