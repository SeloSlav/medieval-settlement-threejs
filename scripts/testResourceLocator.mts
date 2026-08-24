import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
  formatLocatedResourceAmount,
  locatePhysicalResource,
  resourceDisplayLabel,
} from '../src/resources/resourceLocator.ts';
import {
  computeInTransitResourceTotals,
  computeResourceTotals,
  computeStoredResourceTotals,
  HUD_RESOURCE_KINDS,
} from '../src/resources/resourceTotals.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResidenceState,
} from '../src/resources/types.ts';

function building(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'building-1',
    kind: 'village_storehouse',
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
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 0,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    ...partial,
  };
}

function residence(partial: Partial<ResidenceState> = {}): ResidenceState {
  return {
    id: 'residence-1',
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 10,
    z: 20,
    yaw: 0,
    population: 4,
    populationCapacity: 5,
    tier: 2,
    settlementTicks: 1,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
    ...partial,
  };
}

function gameState(partial: Partial<GameState> = {}): GameState {
  return {
    seed: 1,
    tick: 0,
    physicalFoundingSiteEnabled: true,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
    ...partial,
  };
}

const household = residence({
  parcelIndex: 3,
  householdWealth: 80,
  needs: {
    ...createDefaultNeeds(),
    food: { stock: 10, deficitTicks: 0 },
  },
});
const physicalFoodState = gameState({
  buildings: new Map([
    ['small-granary', building({
      id: 'small-granary',
      kind: 'granary',
      x: 5,
      z: 6,
      food: 8,
    })],
    ['large-granary', building({
      id: 'large-granary',
      kind: 'granary',
      x: 15,
      z: 16,
      food: 25,
    })],
  ]),
  residences: new Map([[household.id, household]]),
  deliveryTrips: new Map([['cart-1', {
    id: 'cart-1',
    buildingId: 'large-granary',
    residenceId: household.id,
    destinationKind: 'residence',
    targetBuildingId: null,
    cargoKind: 'food',
    amount: 99,
    phase: 'outbound',
    x: 12,
    z: 14,
    progress: 0.5,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 20,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  }]]),
});

const foodLocations = locatePhysicalResource(physicalFoodState, 'food');
assert.deepEqual(
  foodLocations.map((location) => [location.kind, location.id, location.amount]),
  [
    ['building', 'large-granary', 25],
    ['residence', 'residence-1', 10],
    ['building', 'small-granary', 8],
    ['delivery', 'cart-1', 99],
  ],
  'stored holdings should be largest-first, with loaded carts after stores',
);
assert.equal(foodLocations[0]?.label, 'Village granary');
assert.equal(foodLocations[1]?.label, 'Household · parcel 4');
assert.match(foodLocations[3]?.detail ?? '', /travelling from Village granary/);

household.needs.pottery.stock = 3;
const potteryLocations = locatePhysicalResource(physicalFoodState, 'pottery');
assert.deepEqual(
  potteryLocations.map((location) => [location.kind, location.id, location.amount]),
  [['residence', household.id, 3]],
  'household wares must remain physically discoverable after kiln delivery',
);

const goldBuildings = [
  building({ id: 'town-1', kind: 'town_hall', gold: 12 }),
  building({ id: 'market-1', kind: 'marketplace', gold: 5 }),
  building({ id: 'guard-1', kind: 'guardhouse', gold: 4 }),
  building({
    id: 'monastery-1',
    kind: 'monastery',
    gold: 10,
    civicReceiptsGold: 3,
  }),
  building({ id: 'chapel-1', kind: 'chapel', gold: 100 }),
];
const goldState = gameState({
  buildings: new Map(goldBuildings.map((entry) => [entry.id, entry])),
  residences: new Map([[household.id, household]]),
  deliveryTrips: new Map([['gold-cart', {
    ...physicalFoodState.deliveryTrips.get('cart-1')!,
    id: 'gold-cart',
    cargoKind: 'gold',
    amount: 30,
  }]]),
});
const goldLocations = locatePhysicalResource(goldState, 'gold');
assert.deepEqual(
  goldLocations.map((location) => [location.kind, location.id, location.amount]),
  [
    ['building', 'town-1', 12],
    ['building', 'market-1', 5],
    ['building', 'guard-1', 4],
    ['building', 'monastery-1', 3],
    ['delivery', 'gold-cart', 30],
  ],
);
assert.ok(
  !goldLocations.some((location) => location.id === 'chapel-1'),
  'parish funds must remain separate from civic treasury gold',
);
assert.ok(
  !goldLocations.some((location) => location.kind === 'residence'),
  'private household wealth must not be reported as civic gold',
);

const legacyStockpile = createEmptyStockpile();
legacyStockpile.flax = 7;
assert.deepEqual(
  locatePhysicalResource(gameState({
    physicalFoundingSiteEnabled: false,
    stockpile: legacyStockpile,
  }), 'flax').map((location) => [location.kind, location.amount]),
  [['legacy-ledger', 7]],
);
assert.deepEqual(
  locatePhysicalResource(gameState({ stockpile: legacyStockpile }), 'flax'),
  [],
  'physical saves must never expose compatibility-ledger goods as map stock',
);

const westTownStore = Object.assign(building({
  id: 'west-town-store',
  x: -240,
  timber: 30,
  stone: 4,
}), { settlementId: 'settlement-west' });
const eastTownStore = Object.assign(building({
  id: 'east-town-store',
  x: 240,
  timber: 10,
  stone: 11,
}), { settlementId: 'settlement-east' });
const eastTownProject = Object.assign(building({
  id: 'east-town-project',
  kind: 'well',
  x: 250,
  constructionComplete: false,
  constructionReservedTimber: 7,
}), { settlementId: 'settlement-east' });
const interTownCart = {
  ...physicalFoodState.deliveryTrips.get('cart-1')!,
  id: 'inter-town-timber',
  buildingId: westTownStore.id,
  targetBuildingId: eastTownStore.id,
  cargoKind: 'timber' as const,
  amount: 5,
};
const integratedRealmState = gameState({
  buildings: new Map([
    [westTownStore.id, westTownStore],
    [eastTownStore.id, eastTownStore],
    [eastTownProject.id, eastTownProject],
  ]),
  deliveryTrips: new Map([[interTownCart.id, interTownCart]]),
});
assert.deepEqual(
  {
    timber: computeStoredResourceTotals(integratedRealmState).timber,
    stone: computeStoredResourceTotals(integratedRealmState).stone,
  },
  { timber: 40, stone: 15 },
  'the lord-facing Total ledger must sum physical stores in every on-map town',
);
assert.equal(
  computeResourceTotals(integratedRealmState).timber,
  33,
  'the lord-facing Surplus ledger must reserve projects realm-wide without switching town scope',
);
assert.equal(
  computeInTransitResourceTotals(integratedRealmState.deliveryTrips.values()).timber,
  5,
  'an inter-town cart remains one realm-owned in-transit holding, not a trade between sub-economies',
);
assert.deepEqual(
  locatePhysicalResource(integratedRealmState, 'stone')
    .map((location) => location.id),
  [eastTownStore.id, westTownStore.id],
  'the default resource locator must remain an all-holdings view across town identities',
);

assert.equal(resourceDisplayLabel('gold'), 'Civic gold');
assert.equal(resourceDisplayLabel('preservedFood'), 'Preserved staples');
assert.equal(formatLocatedResourceAmount(12), '12');
assert.equal(formatLocatedResourceAmount(12.25), '12');

const settlementHudSource = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
for (const resource of HUD_RESOURCE_KINDS) {
  assert.match(
    settlementHudSource,
    new RegExp(`data-resource=["']${resource}["']`),
    `HUD locator row missing for ${resource}`,
  );
  assert.match(
    settlementHudSource,
    new RegExp(`data-stockpile=["']${resource}["']`),
    `HUD stock value missing for ${resource}`,
  );
  assert.match(
    settlementHudSource,
    new RegExp(`data-stockpile-transit=["']${resource}["']`),
    `HUD transit value missing for ${resource}`,
  );
}

const polishedGameUiSource = readFileSync(
  new URL('../src/ui/polishedGameUi.css', import.meta.url),
  'utf8',
);
assert.match(
  polishedGameUiSource,
  /\.settlement-hud__stores:not\(\.has-stock\)[\s\S]*?opacity:\s*0\.48/,
  'the combined stores icon must use the same empty opacity as zero-value resources',
);

const manyBuildings = new Map<string, BuildingState>();
for (let index = 0; index < 100_000; index += 1) {
  const id = `building-${index}`;
  manyBuildings.set(id, building({
    id,
    timber: index % 1_000 === 0 ? index / 1_000 + 1 : 0,
  }));
}
const largeState = gameState({ buildings: manyBuildings });
const start = performance.now();
const largeLocations = locatePhysicalResource(largeState, 'timber');
const elapsedMs = performance.now() - start;
assert.equal(largeLocations.length, 100);
assert.equal(largeLocations[0]?.amount, 100);
assert.ok(
  elapsedMs < 250,
  `100k-entity on-demand resource scan took ${elapsedMs.toFixed(1)}ms`,
);

console.log(
  `Resource locator tests passed (${HUD_RESOURCE_KINDS.length} commodities; `
    + `100k scan ${elapsedMs.toFixed(1)}ms).`,
);
