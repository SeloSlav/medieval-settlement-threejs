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
    grain: 0,
    flour: 0,
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
    getInboundSupplyTrip: () => null,
    hasRoadPathToBuildingKind: (ax, az, kind) =>
      buildings.some(
        (candidate) =>
          candidate.kind === kind
          && roadDistance(ax, az, candidate.x, candidate.z) != null,
      ),
  } as WorldQueries;
}

const granary = makeBuilding({
  id: 'granary-1',
  kind: 'granary',
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

const noWellQueries = stubWorldQueries([granary], connected);
const dryWellQueries = stubWorldQueries([granary, well], connected);
const readyGranary = makeBuilding({
  id: 'granary-2',
  kind: 'granary',
  x: 0,
  z: 0,
  assignedLabor: 2,
  flour: 3,
  firewood: 1,
  water: 2,
});
const readyWell = makeBuilding({
  id: 'well-2',
  kind: 'well',
  x: 10,
  z: 0,
  water: 5,
  assignedLabor: 1,
});
const readyQueries = stubWorldQueries([readyGranary, readyWell], connected);

assert.equal(
  getBuildingProcessorStatus(granary, noWellQueries)?.statusText,
  'Idle — needs a staffed, road-connected well to operate',
);
assert.equal(
  getBuildingProcessorStatus(granary, noWellQueries)?.statusState,
  'warning',
);

assert.equal(
  getBuildingProcessorStatus(granary, dryWellQueries)?.statusText,
  'Waiting for water — all linked wells are dry (2 needed)',
);

assert.equal(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.statusText,
  'Baking staple food',
);
assert.equal(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.statusState,
  'active',
);
assert.match(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 3 cycles staged · flour limits/,
);
assert.match(
  getBuildingProcessorStatus(readyGranary, readyQueries)?.waterDetailHtml ?? '',
  /Output room<\/span><span>85 cycles · food before 340 target/,
);

const brewery = makeBuilding({
  id: 'brewery-1',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  water: 2,
  grain: 0,
});
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.statusText ?? '',
  /Waiting for grain/,
);
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>0\.0 cycles on site \/ 3 cycles staged · grain limits/,
);
assert.match(
  getBuildingProcessorStatus(brewery, readyQueries)?.waterDetailHtml ?? '',
  /Output room<\/span><span>50 cycles · ale before 200 target/,
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
  'Output target reached — production paused',
  'a reached target should explain the deliberate pause before irrelevant input warnings',
);
assert.equal(
  getBuildingProcessorStatus(cappedBrewery, noWellQueries)?.statusState,
  'idle',
);
assert.match(
  getBuildingProcessorStatus(cappedBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /Output room<\/span><span>0\.0 cycles · ale before 50 target/,
);

const partialBrewery = makeBuilding({
  id: 'brewery-partial',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  grain: 0.25,
  water: 0.25,
  firewood: 0.25,
});
assert.equal(
  getBuildingProcessorStatus(partialBrewery, noWellQueries)?.statusText,
  'Brewing ale',
  'fractional on-site inputs should remain productive because the server scales partial batches',
);
assert.match(
  getBuildingProcessorStatus(partialBrewery, noWellQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>0\.1 cycles on site \/ 3 cycles staged · grain limits/,
);

const fuelStarvedBrewery = makeBuilding({
  id: 'brewery-no-fuel',
  kind: 'brewery',
  x: 0,
  z: 0,
  assignedLabor: 1,
  grain: 3,
  water: 2,
  firewood: 0,
});
assert.match(
  getBuildingProcessorStatus(fuelStarvedBrewery, noWellQueries)?.statusText ?? '',
  /Waiting for firewood/,
  'brewing must report its physical firing-fuel bottleneck',
);

const leanGranary = makeBuilding({
  id: 'granary-lean',
  kind: 'granary',
  x: 0,
  z: 0,
  assignedLabor: 2,
  processorOutputTargetPercent: 25,
  flour: 3,
  firewood: 1,
  water: 2,
});
assert.match(
  getBuildingProcessorStatus(leanGranary, readyQueries)?.waterDetailHtml ?? '',
  /On-site input buffer<\/span><span>1\.0 cycle on site \/ 1 cycle staged · flour limits/,
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

console.log('building processor status tests passed');
