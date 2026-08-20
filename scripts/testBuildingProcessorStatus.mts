import assert from 'node:assert/strict';
import type { BuildingState, GameState } from '../src/resources/types.ts';
import { createEmptyStockpile } from '../src/resources/types.ts';
import { getBuildingProcessorStatus } from '../src/resources/inspector/buildingProcessorStatus.ts';
import { WorldQueries } from '../src/resources/WorldQueries.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';

function emptyGameState(buildings: BuildingState[]): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(buildings.map((building) => [building.id, building])),
    farmFields: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    nextBuildingId: 1,
  };
}

function makeBuilding(partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'>): BuildingState {
  return {
    workRadius: 40,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    ryeGrain: 0,
    oatGrain: 0,
    maslinGrain: 0,
    barley: 0,
    malt: 0,
    ryeFlour: 0,
    maslinFlour: 0,
    ryeBread: 0,
    maslinBread: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    ...partial,
  };
}

function stubWorldQueries(
  buildings: BuildingState[],
  roadDistance: (ax: number, az: number, bx: number, bz: number) => number | null,
): WorldQueries {
  const gameState = emptyGameState(buildings);
  const network = {} as RoadNetwork;
  return {
    getGameState: () => gameState,
    getRoadNetwork: () => network,
    getRoadNetworkSnapshot: () => network,
    getRoadConnectedWells: (building: BuildingState) =>
      buildings.filter(
        (candidate) =>
          candidate.kind === 'well'
          && roadDistance(building.x, building.z, candidate.x, candidate.z) != null,
      ),
    getRoadPathDistance: roadDistance,
    getLocalDeliveryDistance: roadDistance,
    getInboundSupplyTrip: () => null,
    hasRoadPathToBuildingKind: (ax, az, kind) =>
      buildings.some(
        (candidate) =>
          candidate.kind === kind
          && roadDistance(ax, az, candidate.x, candidate.z) != null,
      ),
  } as WorldQueries;
}

const bakery = makeBuilding({
  id: 'bakery-1',
  kind: 'bakery',
  x: 0,
  z: 0,
  assignedLabor: 2,
});

const well = makeBuilding({
  id: 'well-1',
  kind: 'well',
  x: 10,
  z: 0,
  water: 0,
  assignedLabor: 1,
});

const connected = (_ax: number, _az: number, bx: number, bz: number) =>
  bx === 10 && bz === 0 ? 12 : null;

const noWellQueries = stubWorldQueries([bakery], connected);
const dryWellQueries = stubWorldQueries([bakery, well], connected);
const readyBakery = makeBuilding({
  id: 'bakery-2',
  kind: 'bakery',
  x: 0,
  z: 0,
  assignedLabor: 2,
  ryeFlour: 3,
  firewood: 1,
  water: 2,
});
const readyWell = makeBuilding({
  id: 'well-2',
  kind: 'well',
  x: 10,
  z: 0,
  water: 5,
  assignedLabor: 0,
});
const readyQueries = stubWorldQueries([readyBakery, readyWell], connected);

const unstaffedMonastery = makeBuilding({
  id: 'monastery-unstaffed',
  kind: 'monastery',
  x: 0,
  z: 0,
  assignedLabor: 0,
});
assert.equal(
  getBuildingProcessorStatus(unstaffedMonastery, noWellQueries)?.statusText,
  'Dormant - assign residents to become monks',
);

assert.equal(
  getBuildingProcessorStatus(bakery, noWellQueries)?.statusText,
  'Idle — needs a road-linked well to operate',
);
assert.equal(
  getBuildingProcessorStatus(bakery, noWellQueries)?.statusState,
  'warning',
);

assert.equal(
  getBuildingProcessorStatus(bakery, dryWellQueries)?.statusText,
  'Waiting for water — all linked wells are dry (2 needed)',
);

assert.equal(
  getBuildingProcessorStatus(readyBakery, readyQueries)?.statusText,
  'Baking rye bread',
);
assert.equal(
  getBuildingProcessorStatus(readyBakery, readyQueries)?.statusState,
  'active',
);
assert.match(
  getBuildingProcessorStatus(readyBakery, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 3 cycles staged · rye flour limits/,
);
assert.match(
  getBuildingProcessorStatus(readyBakery, readyQueries)?.waterDetailHtml ?? '',
  /Output room<\/span><span>25 cycles · rye bread before 100 target/,
);

const smithy = makeBuilding({
  id: 'smithy-1',
  kind: 'smithy',
  x: 0,
  z: 0,
  assignedLabor: 1,
  iron: 2,
  charcoal: 1,
});
assert.equal(
  getBuildingProcessorStatus(smithy, noWellQueries)?.statusText,
  'Idle — needs a road-linked well to operate',
);
assert.equal(
  getBuildingProcessorStatus(smithy, readyQueries)?.statusText,
  'Waiting for well cart — 0 / 1 stored',
);
smithy.water = 1;
assert.equal(
  getBuildingProcessorStatus(smithy, readyQueries)?.statusText,
  'Smelting the iron charge, consolidating the bloom, and forging ironwork',
);
assert.match(
  getBuildingProcessorStatus(smithy, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 3 cycles staged · iron charge limits/,
);

const potter = makeBuilding({
  id: 'potter-1',
  kind: 'potter_kiln',
  x: 0,
  z: 0,
  assignedLabor: 1,
  clay: 3,
  firewood: 1,
});
assert.equal(
  getBuildingProcessorStatus(potter, noWellQueries)?.statusText,
  'Idle — needs a road-linked well to operate',
);
assert.equal(
  getBuildingProcessorStatus(potter, readyQueries)?.statusText,
  'Waiting for well cart — 0 / 1 stored',
);
potter.water = 1;
assert.equal(
  getBuildingProcessorStatus(potter, readyQueries)?.statusText,
  'Firing household and preserving vessels',
);
assert.match(
  getBuildingProcessorStatus(potter, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 3 cycles staged · clay limits/,
);

const brewery = makeBuilding({
  id: 'brewery-1',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  water: 2,
  barley: 0,
});
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.statusText ?? '',
  /Waiting for malt/,
);
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.waterDetailHtml ?? '',
  /Current brewing step<\/span><span>Brewing malt into ale · 0\.0 cycles · malt limits/,
);
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.waterDetailHtml ?? '',
  /Ale output room<\/span><span>50 cycles · ale before 200 target/,
);

const ciderBrewery = makeBuilding({
  id: 'brewery-cider',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  breweryRecipePolicy: 1,
  apples: 4,
  water: 0,
  firewood: 0,
});
assert.equal(
  getBuildingProcessorStatus(ciderBrewery, noWellQueries)?.statusText,
  'Pressing apples into cider',
);
assert.match(
  getBuildingProcessorStatus(ciderBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /Cider recipe<\/span><span>4 apples → 1 cider/,
);

const meadBrewery = makeBuilding({
  id: 'brewery-mead',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  breweryRecipePolicy: 2,
  honey: 1,
  water: 0,
  firewood: 0,
});
assert.equal(
  getBuildingProcessorStatus(meadBrewery, noWellQueries)?.statusText,
  'Fermenting honey into mead',
);
assert.match(
  getBuildingProcessorStatus(meadBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /Mead recipe<\/span><span>1 honey → 1 mead/,
);

const tavern = makeBuilding({
  id: 'tavern-1',
  kind: 'tavern',
  x: 0,
  z: 0,
  assignedLabor: 1,
  ale: 0,
  cider: 6,
  mead: 0,
});
assert.equal(
  getBuildingProcessorStatus(tavern, noWellQueries)?.statusText,
  'Serving beverages to connected households',
);
assert.match(
  getBuildingProcessorStatus(tavern, noWellQueries)?.waterDetailHtml ?? '',
  /6 total · 0 ale · 6 cider · 0 mead/,
);

const cappedBrewery = makeBuilding({
  id: 'brewery-capped',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  processorOutputTargetPercent: 25,
  ale: 50,
});
assert.equal(
  getBuildingProcessorStatus(cappedBrewery, noWellQueries)?.statusText,
  'Ale target reached — malting and brewing paused',
  'a reached target should explain the deliberate pause before irrelevant input warnings',
);
assert.equal(
  getBuildingProcessorStatus(cappedBrewery, noWellQueries)?.statusState,
  'idle',
);
assert.match(
  getBuildingProcessorStatus(cappedBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /Ale output room<\/span><span>0\.0 cycles · ale before 50 target/,
);

const recalledCappedBrewery = {
  ...cappedBrewery,
  id: 'brewery-capped-recalled',
  assignedLabor: 0,
};
assert.equal(
  getBuildingProcessorStatus(recalledCappedBrewery, noWellQueries)?.statusText,
  'Ale target reached — malting and brewing paused',
  'a released crew must not hide the output ceiling that prevents useful work',
);

const recalledCappedClayPit = makeBuilding({
  id: 'clay-pit-capped-recalled',
  kind: 'clay_pit',
  x: 0,
  z: 0,
  assignedLabor: 0,
  processorOutputTargetPercent: 25,
  clay: 45,
});
assert.equal(
  getBuildingProcessorStatus(recalledCappedClayPit, noWellQueries)?.statusText,
  'Output target reached — production paused',
  'a target-held clay yard should ask for cart headroom rather than more diggers',
);

const recalledCappedWeaver = makeBuilding({
  id: 'weaver-capped-recalled',
  kind: 'weaver',
  x: 0,
  z: 0,
  assignedLabor: 0,
  processorOutputTargetPercent: 25,
  cloth: 22.5,
});
assert.equal(
  getBuildingProcessorStatus(recalledCappedWeaver, noWellQueries)?.statusText,
  'Cloth target reached - weaving paused',
  'processor target feedback should survive labor-steward recall',
);

const recalledFullLumberMill = makeBuilding({
  id: 'lumber-full-recalled',
  kind: 'lumber_mill',
  x: 0,
  z: 0,
  assignedLabor: 0,
  timber: 240,
});
assert.match(
  getBuildingProcessorStatus(
    recalledFullLumberMill,
    noWellQueries,
    { matureTrees: 12 },
  )?.statusText ?? '',
  /Storage full/,
  'a full timber yard should ask for hauling space rather than a new crew',
);

const partialBrewery = makeBuilding({
  id: 'brewery-partial',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  barley: 0.25,
  water: 0.25,
  firewood: 0.25,
});
assert.equal(
  getBuildingProcessorStatus(partialBrewery, noWellQueries)?.statusText,
  'Floor-malting barley',
  'fractional on-site inputs should remain productive because the server scales partial batches',
);
assert.match(
  getBuildingProcessorStatus(partialBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /Current brewing step<\/span><span>Floor-malting barley · 0\.1 cycles · barley limits/,
);

const fuelStarvedBrewery = makeBuilding({
  id: 'brewery-no-fuel',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  barley: 3,
  water: 2,
  firewood: 0,
});
assert.match(
  getBuildingProcessorStatus(fuelStarvedBrewery, noWellQueries)?.statusText ?? '',
  /Waiting for firewood/,
  'brewing must report its physical firing-fuel bottleneck',
);

const leanBakery = makeBuilding({
  id: 'bakery-lean',
  kind: 'bakery',
  x: 0,
  z: 0,
  assignedLabor: 2,
  processorOutputTargetPercent: 25,
  ryeFlour: 3,
  firewood: 1,
  water: 2,
});
assert.match(
  getBuildingProcessorStatus(leanBakery, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 1 cycle staged · rye flour limits/,
  'the inspector should expose the selected input staging depth, not only output capacity',
);

const apiary = makeBuilding({
  id: 'apiary-1',
  kind: 'apiary',
  x: 0,
  z: 0,
  assignedLabor: 1,
});
assert.match(
  getBuildingProcessorStatus(apiary, noWellQueries, { month: 1 })?.statusText ?? '',
  /resumes in April/,
);
assert.equal(
  getBuildingProcessorStatus(apiary, noWellQueries, { month: 1 })?.statusState,
  'idle',
);
assert.match(
  getBuildingProcessorStatus(apiary, noWellQueries, { month: 4 })?.statusText ?? '',
  /Gathering honey/,
);
const fullApiary = makeBuilding({
  id: 'apiary-full',
  kind: 'apiary',
  x: 0,
  z: 0,
  assignedLabor: 1,
  honey: 139,
});
assert.equal(
  getBuildingProcessorStatus(fullApiary, noWellQueries, { month: 4 })?.statusText,
  'Seasonal work waiting - honey store needs 2 more room',
);
assert.equal(
  getBuildingProcessorStatus(fullApiary, noWellQueries, { month: 4 })?.statusState,
  'warning',
);

assert.match(
  getBuildingProcessorStatus(
    { ...apiary, id: 'apiary-winter-recalled', assignedLabor: 0 },
    noWellQueries,
    { month: 1 },
  )?.statusText ?? '',
  /resumes in April/,
  'an out-of-season holding should explain the calendar before suggesting labor',
);
assert.equal(
  getBuildingProcessorStatus(
    { ...fullApiary, id: 'apiary-full-recalled', assignedLabor: 0 },
    noWellQueries,
    { month: 4 },
  )?.statusText,
  'Seasonal work waiting - honey store needs 2 more room',
  'a released seasonal crew must not hide a full physical output store',
);

const vineyard = makeBuilding({
  id: 'vineyard-1',
  kind: 'vineyard',
  x: 0,
  z: 0,
  assignedLabor: 1,
});
assert.match(
  getBuildingProcessorStatus(vineyard, noWellQueries, { month: 8 })?.statusText ?? '',
  /next harvest September/,
);
assert.equal(
  getBuildingProcessorStatus(vineyard, noWellQueries, { month: 9 })?.statusState,
  'active',
);
const fullVineyardFood = makeBuilding({
  id: 'vineyard-food-full',
  kind: 'vineyard',
  x: 0,
  z: 0,
  assignedLabor: 1,
  grapes: 40,
});
assert.equal(
  getBuildingProcessorStatus(fullVineyardFood, noWellQueries, { month: 9 })?.statusText,
  'Seasonal work waiting - grapes store needs 4 more room',
);

console.log('building processor status tests passed');
