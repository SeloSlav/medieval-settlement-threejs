import assert from 'node:assert/strict';
import { buildSettlementPeopleView } from '../src/ui/settlementPeople.ts';

const building = (
  id: string,
  assignedLabor: number,
  constructionComplete: boolean,
) => ({ id, assignedLabor, constructionComplete, kind: 'lumber_mill' });

const residence = (
  id: string,
  population: number,
  populationCapacity: number,
  upgradeAssignedLabor = 0,
) => ({
  id,
  tier: 1,
  abandoned: false,
  population,
  populationCapacity,
  upgradeAssignedLabor,
  upgradeTargetTier: upgradeAssignedLabor > 0 ? 2 : 0,
});

const state = {
  buildings: new Map([
    ['building-1', building('building-1', 3, true)],
    ['building-2', building('building-2', 2, false)],
  ]),
  residences: new Map([
    ['residence-1', residence('residence-1', 3, 4)],
    ['residence-2', residence('residence-2', 0, 4, 1)],
  ]),
  deliveryTrips: new Map([
    ['trip-1', { freeHaulerWorkers: 1 }],
  ]),
  settlements: new Map([
    ['settlement-1', { active: true, unhousedFounders: 5 }],
  ]),
} as any;

const view = buildSettlementPeopleView(state, true);
assert.deepEqual(
  {
    total: view.total,
    available: view.available,
    assigned: view.assigned,
    builders: view.builders,
    workplaceWorkers: view.workplaceWorkers,
    homeProjectWorkers: view.homeProjectWorkers,
    haulers: view.haulers,
  },
  {
    total: 8,
    available: 1,
    assigned: 7,
    builders: 2,
    workplaceWorkers: 3,
    homeProjectWorkers: 1,
    haulers: 1,
  },
);
assert.deepEqual(
  {
    homes: view.homes,
    occupiedHomes: view.occupiedHomes,
    openHomes: view.openHomes,
    emptyHomes: view.emptyHomes,
    housed: view.housed,
    unhoused: view.unhoused,
    housingCapacity: view.housingCapacity,
    vacantPlaces: view.vacantPlaces,
  },
  {
    homes: 2,
    occupiedHomes: 1,
    openHomes: 2,
    emptyHomes: 1,
    housed: 3,
    unhoused: 5,
    housingCapacity: 8,
    vacantPlaces: 5,
  },
);
assert.match(view.migrationLabel, /5 founders rehouse before new migrants/);
assert.equal(
  buildSettlementPeopleView(state, false).signature,
  '__people-unfounded__',
);

console.log('settlement labor, living-space, and migration view-model tests passed');
