import assert from 'node:assert/strict';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
  findServingChapel,
  hasRoadPathToBuildingKind,
  isResidenceConnectedToChapel,
  isResidenceConnectedToMarketplace,
} from '../src/logistics/landmarkAccess.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { BuildingState, GameState, ResidenceState } from '../src/resources/types.ts';
import { WorldQueries } from '../src/resources/WorldQueries.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';

function residence(overrides: Partial<ResidenceState> = {}): ResidenceState {
  return {
    id: 'res-1',
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 10,
    z: 10,
    yaw: 0,
    population: 3,
    populationCapacity: 3,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
    ...overrides,
  };
}

function building(overrides: Partial<BuildingState>): BuildingState {
  return {
    id: 'building-1',
    kind: 'marketplace',
    x: 20,
    z: 10,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    ...overrides,
  };
}

const marketplace = building({ id: 'b-market', kind: 'marketplace', x: 20, z: 10 });
const staffedGranary = building({ id: 'b-granary', kind: 'granary', x: 22, z: 10, assignedLabor: 1 });
const staffedStorehouse = building({ id: 'b-storehouse', kind: 'village_storehouse', x: 18, z: 10, assignedLabor: 1 });
const staffedChapel = building({ id: 'b-chapel', kind: 'chapel', x: 10, z: 20, assignedLabor: 1 });
const idleChapel = building({ id: 'b-chapel-idle', kind: 'chapel', x: 30, z: 30, assignedLabor: 0 });
const monastery = building({ id: 'b-monastery', kind: 'monastery', x: 15, z: 15 });
const home = residence();

const connectedProbe = (ax: number, az: number, bx: number, bz: number): number | null => {
  const connected =
    (ax === home.x && az === home.z && bx === marketplace.x && bz === marketplace.z)
    || (ax === staffedGranary.x && az === staffedGranary.z && bx === marketplace.x && bz === marketplace.z)
    || (ax === staffedStorehouse.x && az === staffedStorehouse.z && bx === marketplace.x && bz === marketplace.z)
    || (ax === home.x && az === home.z && bx === staffedChapel.x && bz === staffedChapel.z);
  return connected ? 12 : null;
};

const buildings = [marketplace, staffedGranary, staffedStorehouse, staffedChapel, idleChapel];

assert.equal(
  isResidenceConnectedToMarketplace(home, buildings, connectedProbe),
  true,
);
assert.equal(
  isResidenceConnectedToMarketplace(home, buildings, connectedProbe, 'goods'),
  true,
);
assert.equal(
  isResidenceConnectedToMarketplace(home, [marketplace], connectedProbe),
  false,
  'an empty market square cannot accept backyard food without a granary stall worker',
);
assert.equal(
  isResidenceConnectedToChapel(home, buildings, connectedProbe),
  true,
);
assert.equal(findServingChapel(home, buildings, connectedProbe)?.id, staffedChapel.id);

const disconnectedProbe = () => null;
assert.equal(isResidenceConnectedToMarketplace(home, buildings, disconnectedProbe), false);
assert.equal(isResidenceConnectedToChapel(home, buildings, disconnectedProbe), false);

assert.equal(
  hasRoadPathToBuildingKind(buildings, home.x, home.z, 'chapel', () => 1, true),
  true,
);
assert.equal(
  hasRoadPathToBuildingKind([idleChapel], home.x, home.z, 'chapel', () => 1, true),
  false,
);

class StubWorldQueries extends WorldQueries {
  private readonly connected: boolean;

  constructor(connected: boolean, state: GameState) {
    super({
      terrain: { getHeightAt: () => 0 } as never,
      riverField: {
        isRenderedWetAt: () => false,
        sampleShoreDistance: () => 999,
      } as never,
      registry: {
        findNearestQuarry: () => null,
        findNearestForagingNode: () => null,
      } as never,
      getGameState: () => state,
      getRoadNetwork: () => new RoadNetwork(),
      getTreeRegistry: () => null,
    });
    this.connected = connected;
  }

  override getRoadPathDistance(): number | null {
    return this.connected ? 10 : null;
  }
}

const gameState = {
  buildings: new Map([...buildings, monastery].map((entry) => [entry.id, entry])),
  residences: new Map([[home.id, home]]),
  fireIncidents: new Map(),
} as unknown as GameState;

const connectedQueries = new StubWorldQueries(true, gameState);
assert.equal(connectedQueries.isResidenceConnectedToMarketplace(home), true);
assert.equal(connectedQueries.isResidenceConnectedToMarketplace(home, 'goods'), true);
assert.equal(connectedQueries.getServingChapelForResidence(home)?.id, staffedChapel.id);
assert.equal(connectedQueries.isResidenceConnectedToChapel(home), true);
assert.equal(connectedQueries.isResidenceInMonasteryCoverage(home), true);

const disconnectedQueries = new StubWorldQueries(false, gameState);
assert.equal(disconnectedQueries.isResidenceConnectedToMarketplace(home), false);
assert.equal(disconnectedQueries.getServingChapelForResidence(home), null);

const chapelFire: FireIncidentState = {
  id: 'fire-chapel',
  targetKind: 'building',
  targetId: staffedChapel.id,
  x: staffedChapel.x,
  z: staffedChapel.z,
  ignitionSource: 'accident',
  status: 'burning',
  intensity: 0.5,
  damage: 0.2,
  waterDelivered: 0,
  requiredWater: 8,
  extinguishChance: 0,
  startedTick: 1,
  lastWaterTick: 0,
  resolvedTick: 0,
  responseWellId: null,
};
const fireDisabledState = {
  ...gameState,
  fireIncidents: new Map([[chapelFire.id, chapelFire]]),
} as GameState;
const fireDisabledQueries = new StubWorldQueries(true, fireDisabledState);
assert.equal(
  fireDisabledQueries.getServingChapelForResidence(home),
  null,
  'a fire-disabled chapel must not claim parish coverage in the client',
);

const monasteryFire: FireIncidentState = {
  ...chapelFire,
  id: 'fire-monastery',
  targetId: monastery.id,
  x: monastery.x,
  z: monastery.z,
};
const monasteryFireState = {
  ...gameState,
  fireIncidents: new Map([[monasteryFire.id, monasteryFire]]),
} as GameState;
const monasteryFireQueries = new StubWorldQueries(true, monasteryFireState);
assert.equal(
  monasteryFireQueries.isResidenceInMonasteryCoverage(home),
  false,
  'a fire-disabled monastery must immediately release its community territory',
);

const residenceFire: FireIncidentState = {
  ...chapelFire,
  id: 'fire-residence',
  targetKind: 'residence',
  targetId: home.id,
  x: home.x,
  z: home.z,
};
const residenceFireState = {
  ...gameState,
  fireIncidents: new Map([[residenceFire.id, residenceFire]]),
} as GameState;
const residenceFireQueries = new StubWorldQueries(true, residenceFireState);
assert.equal(
  residenceFireQueries.getServingChapelForResidence(home),
  null,
  'a fire-disabled household must leave the parish tithe territory',
);
assert.equal(
  residenceFireQueries.isResidenceInMonasteryCoverage(home),
  false,
  'a fire-disabled household must not retain monastery community coverage',
);

console.log('landmark access parity tests passed');
