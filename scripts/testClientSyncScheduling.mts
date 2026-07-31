import assert from 'node:assert/strict';
import * as THREE from 'three';
import { syncSettlementWorld } from '../src/app/settlementWorldSync.ts';
import { SpacetimeSnapshotApplier } from '../src/app/spacetimeSnapshotApplier.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';
import { GameTableSync } from '../src/data/spacetimeTableSync/gameTableSync.ts';
import { syncWorldConfig } from '../src/data/spacetimeTableSync/syncWorldConfig.ts';
import { ForestManager } from '../src/props/ForestManager.ts';
import { createStubForestInstances } from '../src/props/forestInstanceStub.ts';
import { ForestVisualSync } from '../src/resources/ForestVisualSync.ts';
import type {
  BuildingState,
  GameState,
  LivestockHerdState,
} from '../src/resources/types.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { isOnRoadSurface } from '../src/roads/roadConnectivity.ts';
import { changedBuildingPadBounds } from '../src/terrain/TerrainBuildingPads.ts';

await testTableCallbackCoalescing();
testAuthoritativeTableSubscriptions();
testPlacementClearanceKeepsRoadWorkCached();
testRoadSurfaceSpatialIndexRespectsRoadWidths();
testTerrainPreviewOnlyResamplesChangedPads();
testSettlementSyncSkipsUnchangedDomains();
testForestPhaseUpdatesCommitOncePerBatch();
testTreeVisualSyncSkipsUnchangedSnapshots();
testWorldGenerationReferenceStaysStableAcrossTicks();
testQuantizedStockVisualSignatures();
const markerSignatureElapsed = testBuildingMarkerSignatureScale();

console.log(
  `client sync scheduling tests passed (${markerSignatureElapsed.toFixed(1)} ms for 100,000 dynamic building signatures)`,
);

function testAuthoritativeTableSubscriptions(): void {
  assert.ok(
    GAME_TABLE_SUBSCRIPTIONS.includes('market_state'),
    'regional market prices must be subscribed before the marketplace inspector can show them',
  );
  assert.equal(
    new Set(GAME_TABLE_SUBSCRIPTIONS).size,
    GAME_TABLE_SUBSCRIPTIONS.length,
    'authoritative table subscriptions should not contain duplicates',
  );
}

async function testTableCallbackCoalescing(): Promise<void> {
  let tableRebuilds = 0;
  let notifications = 0;
  const owner = { toHexString: () => 'owner' };
  const row = {
    id: 1n,
    owner,
    kind: 'lumber_mill',
    x: 1,
    z: 2,
    workRadius: 3,
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
    assignedLabor: 0n,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
  const callbacks: {
    insert?: (context: unknown, row: typeof row) => void;
    update?: (context: unknown, oldRow: typeof row, row: typeof row) => void;
    delete?: (context: unknown, row: typeof row) => void;
  } = {};
  const buildingTable = {
    iter: () => {
      tableRebuilds += 1;
      return [row];
    },
    onInsert: (callback: (context: unknown, row: typeof row) => void) => {
      callbacks.insert = callback;
    },
    onUpdate: (callback: (context: unknown, oldRow: typeof row, row: typeof row) => void) => {
      callbacks.update = callback;
    },
    onDelete: (callback: (context: unknown, row: typeof row) => void) => {
      callbacks.delete = callback;
    },
  };
  const state = {
    identityHex: 'owner',
    simTick: 0,
    worldGeneration: null,
    stockpile: {},
    economicActivityTaxRate: 0,
    parishPolicy: {},
    monasteryPolicy: {},
    marketState: {},
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
    roads: null,
  };

  const sync = new GameTableSync(
    state as ConstructorParameters<typeof GameTableSync>[0],
    () => {
      notifications += 1;
    },
  );
  sync.attachHandlers({
    db: { building: buildingTable },
  } as Parameters<GameTableSync['attachHandlers']>[0]);

  for (let index = 0; index < 100; index++) {
    callbacks.update?.(undefined, row, { ...row, actionCooldown: index });
  }
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(tableRebuilds, 0, 'row callbacks should not reread the whole table');
  assert.equal(notifications, 1, 'one table burst should notify app listeners once');
  assert.equal(state.buildings.size, 1);
  assert.equal(state.buildings.get('building-1')?.actionCooldown, 99);
}

function testPlacementClearanceKeepsRoadWorkCached(): void {
  const placements = Array.from({ length: 80 }, (_, index) => ({
    x: (index % 10) * 8 - 40,
    z: Math.floor(index / 10) * 8 - 32,
    form: index % 3 === 0 ? 'broad' as const : 'narrow' as const,
    species: 'scotsPine',
    scale: 1,
  }));
  const forestInstances = createStubForestInstances(placements);
  let roadPathReads = 0;
  const points = [
    new THREE.Vector3(-80, 0, 0),
    new THREE.Vector3(80, 0, 0),
  ];
  const edge = {
    width: 4,
    get sampledPath() {
      roadPathReads += 1;
      return points;
    },
    controlPoints: points,
  };
  const network = {
    edges: new Map([['road-1', edge]]),
  } as unknown as RoadNetwork;
  const manager = new ForestManager(
    new THREE.Group(),
    forestInstances,
    { group: new THREE.Group(), instances: [] },
    null,
    [],
    { getHeightAt: () => 0 } as never,
    () => {},
    {
      hideTree: () => {},
      showTree: () => {},
      commit: () => {},
      setShadows: () => {},
      dispose: () => {},
    },
  );

  manager.syncRoadClearance(network);
  assert.ok(roadPathReads > 0, 'road sync should evaluate road paths');
  roadPathReads = 0;
  manager.syncPlacementClearance({
    buildings: [{ kind: 'lumber_mill', x: 0, z: 0 }],
  });
  assert.equal(
    roadPathReads,
    0,
    'building placement should reuse the existing road-clearance result',
  );
}

function testRoadSurfaceSpatialIndexRespectsRoadWidths(): void {
  const network = new RoadNetwork();
  network.restore({
    nextNodeId: 5,
    nextEdgeId: 3,
    nodes: [
      { id: 'n1', position: [-10, 0, 0] },
      { id: 'n2', position: [10, 0, 0] },
      { id: 'n3', position: [-10, 0, 20] },
      { id: 'n4', position: [10, 0, 20] },
    ],
    edges: [
      {
        id: 'e1',
        startNodeId: 'n1',
        endNodeId: 'n2',
        width: 4,
        controlPoints: [[-10, 0, 0], [10, 0, 0]],
        sampledPath: [[-10, 0, 0], [10, 0, 0]],
        length: 20,
        revision: 1,
      },
      {
        id: 'e2',
        startNodeId: 'n3',
        endNodeId: 'n4',
        width: 10,
        controlPoints: [[-10, 0, 20], [10, 0, 20]],
        sampledPath: [[-10, 0, 20], [10, 0, 20]],
        length: 20,
        revision: 1,
      },
    ],
  });

  assert.equal(isOnRoadSurface(0, 2.1, network), true);
  assert.equal(isOnRoadSurface(0, 2.3, network), false);
  assert.equal(isOnRoadSurface(0, 25.1, network), true);
  assert.equal(isOnRoadSurface(0, 25.3, network), false);
}

function testTerrainPreviewOnlyResamplesChangedPads(): void {
  const existing = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
  const oldPreview = { minX: 10, maxX: 14, minZ: 10, maxZ: 14 };
  const newPreview = { minX: 12, maxX: 16, minZ: 14, maxZ: 18 };

  assert.deepEqual(
    changedBuildingPadBounds([existing, oldPreview], [existing, newPreview]),
    [oldPreview, newPreview],
    'preview movement should resample only the footprint it leaves and enters',
  );
  assert.deepEqual(
    changedBuildingPadBounds([existing], [existing]),
    [],
    'unchanged settlement pads should not be rebuilt',
  );
}

function testSettlementSyncSkipsUnchangedDomains(): void {
  const previous = emptyGameState();
  const current = {
    ...previous,
    tick: previous.tick + 1,
    buildings: new Map(previous.buildings),
  };
  const calls = {
    residences: 0,
    fields: 0,
    pastures: 0,
    livestock: 0,
    gardens: 0,
    deliveries: 0,
    villagers: 0,
  };
  const targets = {
    residenceMarkers: { syncResidences: () => { calls.residences += 1; } },
    farmFieldMarkers: { syncFields: () => { calls.fields += 1; } },
    pastureMarkers: { syncPastures: () => { calls.pastures += 1; } },
    livestockVisuals: { sync: () => { calls.livestock += 1; } },
    backyardGardenMarkers: { syncGardens: () => { calls.gardens += 1; } },
    deliveryAgents: {
      syncTrips: () => { calls.deliveries += 1; },
      applyTripStates: () => {},
    },
    villagers: { sync: () => { calls.villagers += 1; } },
    getHeightAt: () => 0,
    getRoadNetwork: () => null,
    getTreeRegistry: () => null,
  };

  syncSettlementWorld(targets as never, current, previous);
  assert.deepEqual(calls, {
    residences: 0,
    fields: 0,
    pastures: 0,
    livestock: 0,
    gardens: 0,
    deliveries: 0,
    villagers: 0,
  });

  const trip: DeliveryTripState = {
    id: 'delivery-1',
    buildingId: 'building-1',
    residenceId: 'residence-1',
    destinationKind: 'residence',
    targetBuildingId: null,
    cargoKind: 'firewood',
    amount: 6,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1.6,
    unloadSeconds: 4,
    unloadRemaining: 0,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 20,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
  const tripStarted = {
    ...current,
    tick: current.tick + 1,
    deliveryTrips: new Map([[trip.id, trip]]),
  };
  syncSettlementWorld(targets as never, tripStarted, current);
  assert.equal(calls.deliveries, 1);
  assert.equal(calls.villagers, 1, 'a new roster-backed cart crew should refresh workplace bodies');

  const movedTrip = {
    ...trip,
    x: 8,
    progress: 8,
  };
  const tripMoved = {
    ...tripStarted,
    tick: tripStarted.tick + 1,
    deliveryTrips: new Map([[trip.id, movedTrip]]),
  };
  syncSettlementWorld(targets as never, tripMoved, tripStarted);
  assert.equal(calls.deliveries, 2);
  assert.equal(
    calls.villagers,
    1,
    'cart heartbeat movement must not resync the full settlement crowd',
  );

  const freeCrewTrip = {
    ...movedTrip,
    freeHaulerWorkers: 1,
  };
  const tripCrewChanged = {
    ...tripMoved,
    tick: tripMoved.tick + 1,
    deliveryTrips: new Map([[trip.id, freeCrewTrip]]),
  };
  syncSettlementWorld(targets as never, tripCrewChanged, tripMoved);
  assert.equal(calls.deliveries, 3);
  assert.equal(
    calls.villagers,
    2,
    'changing whether a cart worker belongs to the workplace roster should refresh bodies',
  );

  const tripFinished = {
    ...tripCrewChanged,
    tick: tripCrewChanged.tick + 1,
    deliveryTrips: new Map<string, DeliveryTripState>(),
  };
  syncSettlementWorld(targets as never, tripFinished, tripCrewChanged);
  assert.equal(calls.deliveries, 4);
  assert.equal(calls.villagers, 3, 'returning cart workers should reappear at their workplaces');
}

function testTreeVisualSyncSkipsUnchangedSnapshots(): void {
  const first = emptyGameState();
  first.trees.set('tree-1', {
    treeId: 'tree-1',
    layoutIndex: 1,
    phase: 'mature',
    growthProgress: 1,
  });
  first.trees.set('tree-2', {
    treeId: 'tree-2',
    layoutIndex: 2,
    phase: 'mature',
    growthProgress: 1,
  });
  let syncAllCalls = 0;
  let syncLayoutCalls = 0;
  let removeLayoutCalls = 0;
  let removedLayouts: number[] = [];
  let syncTreeCalls = 0;
  let buildingSyncCalls = 0;
  let fenceSyncCalls = 0;
  let forestClearanceCalls = 0;
  let collisionInvalidations = 0;
  const deps = {
    sceneManager: null,
    buildingMarkers: {
      syncBuildings: () => {
        buildingSyncCalls += 1;
      },
    },
    terrainMinimap: null,
    burgageFencing: {
      syncZones: () => {
        fenceSyncCalls += 1;
      },
    },
    forestVisualSync: {
      syncAll: () => {
        syncAllCalls += 1;
      },
      syncAuthoritativeTreeLayouts: () => {
        syncLayoutCalls += 1;
      },
      removeTreeLayouts: (layoutIndices: Iterable<number>) => {
        removeLayoutCalls += 1;
        removedLayouts = [...layoutIndices];
      },
      syncTrees: () => {
        syncTreeCalls += 1;
      },
    },
    settlementWorld: {
      residenceMarkers: null,
      farmFieldMarkers: null,
      pastureMarkers: null,
      livestockVisuals: null,
      backyardGardenMarkers: null,
      deliveryAgents: null,
      villagers: null,
      getHeightAt: () => 0,
      getRoadNetwork: () => null,
      getTreeRegistry: () => null,
    },
    onForestClearanceChanged: () => {
      forestClearanceCalls += 1;
    },
    onFirstPersonCollisionChanged: () => {
      collisionInvalidations += 1;
    },
  };
  const applier = new SpacetimeSnapshotApplier();
  applier.apply(deps as never, first, null);
  assert.equal(syncAllCalls, 1);
  assert.equal(syncLayoutCalls, 0);
  assert.equal(buildingSyncCalls, 0);
  assert.equal(fenceSyncCalls, 1);
  assert.equal(forestClearanceCalls, 1);
  assert.equal(collisionInvalidations, 1);

  const tickOnly = { ...first, tick: 1 };
  applier.apply(deps as never, tickOnly, first);
  assert.equal(syncAllCalls, 1);
  assert.equal(syncTreeCalls, 0);
  assert.equal(buildingSyncCalls, 0);
  assert.equal(fenceSyncCalls, 1);
  assert.equal(forestClearanceCalls, 1);
  assert.equal(
    collisionInvalidations,
    1,
    'tick-only snapshots should not rebuild first-person static collision geometry',
  );

  const changedTrees = new Map(tickOnly.trees);
  changedTrees.set('tree-1', {
    ...changedTrees.get('tree-1')!,
    phase: 'stump',
    growthProgress: 0,
  });
  const treeChanged = { ...tickOnly, tick: 2, trees: changedTrees };
  applier.apply(deps as never, treeChanged, tickOnly);
  assert.equal(syncTreeCalls, 1);
  assert.equal(
    collisionInvalidations,
    1,
    'tree phases use the nearby tree registry and should not rebuild static geometry',
  );

  const changedBuildings = new Map(treeChanged.buildings);
  changedBuildings.set('building-1', {
    id: 'building-1',
    kind: 'lumber_mill',
    x: 0,
    z: 0,
    workRadius: 10,
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
    assignedLabor: 1,
    constructionComplete: false,
    constructionProgress: 0,
    constructionRequiredTimber: 20,
    constructionRequiredStone: 10,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 20,
    constructionReservedStone: 10,
    constructionTreasuryTimber: 20,
    constructionTreasuryStone: 10,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  });
  const buildingAdded = { ...treeChanged, tick: 3, buildings: changedBuildings };
  applier.apply(deps as never, buildingAdded, treeChanged);
  assert.equal(buildingSyncCalls, 1);
  assert.equal(collisionInvalidations, 2);

  const laborChanged = new Map(buildingAdded.buildings);
  laborChanged.set('building-1', {
    ...laborChanged.get('building-1')!,
    assignedLabor: 2,
  });
  applier.apply(
    deps as never,
    { ...buildingAdded, tick: 4, buildings: laborChanged },
    buildingAdded,
  );
  assert.equal(
    buildingSyncCalls,
    1,
    'labor-only updates should not rebuild building geometry or terrain pads',
  );
  assert.equal(
    collisionInvalidations,
    2,
    'labor-only updates should keep the first-person collision cache intact',
  );

  const progressChanged = new Map(laborChanged);
  progressChanged.set('building-1', {
    ...progressChanged.get('building-1')!,
    constructionProgress: 0.45,
    constructionDeliveredTimber: 12,
    constructionDeliveredStone: 5,
  });
  const constructionAdvanced = {
    ...buildingAdded,
    tick: 5,
    buildings: progressChanged,
  };
  applier.apply(deps as never, constructionAdvanced, {
    ...buildingAdded,
    tick: 4,
    buildings: laborChanged,
  });
  assert.equal(
    buildingSyncCalls,
    2,
    'construction stage changes should refresh the construction-site mesh',
  );

  const completedBuildings = new Map(progressChanged);
  completedBuildings.set('building-1', {
    ...completedBuildings.get('building-1')!,
    constructionComplete: true,
    constructionProgress: 1,
    constructionDeliveredTimber: 20,
    constructionDeliveredStone: 10,
    assignedLabor: 0,
  });
  const constructionCompleted = {
    ...constructionAdvanced,
    tick: 6,
    buildings: completedBuildings,
  };
  applier.apply(deps as never, constructionCompleted, constructionAdvanced);
  assert.equal(
    buildingSyncCalls,
    3,
    'construction completion should replace the site with the operational building mesh',
  );

  const timberChanged = new Map(completedBuildings);
  timberChanged.set('building-1', {
    ...timberChanged.get('building-1')!,
    timber: 8,
  });
  const timberStocked = { ...constructionCompleted, tick: 7, buildings: timberChanged };
  const collisionInvalidationsBeforeTimber = collisionInvalidations;
  applier.apply(deps as never, timberStocked, constructionCompleted);
  assert.equal(
    buildingSyncCalls,
    4,
    'lumber stock changes should refresh the mill stockpile without rebuilding terrain',
  );
  assert.equal(
    collisionInvalidations,
    collisionInvalidationsBeforeTimber,
    'stock-only building visuals must not invalidate first-person collision geometry',
  );

  const clearedTrees = new Map(timberStocked.trees);
  clearedTrees.delete('tree-1');
  const treeCleared = { ...timberStocked, tick: 8, trees: clearedTrees };
  applier.apply(deps as never, treeCleared, timberStocked);
  assert.equal(syncAllCalls, 1, 'tree deletion should not reapply every remaining tree');
  assert.equal(syncLayoutCalls, 0, 'tree deletion should not rescan the complete forest layout');
  assert.equal(removeLayoutCalls, 1, 'tree deletion should issue one incremental visual batch');
  assert.deepEqual(removedLayouts, [1]);
  assert.equal(syncTreeCalls, 1);
}

function testQuantizedStockVisualSignatures(): void {
  const lumber = {
    id: 'building-1',
    kind: 'lumber_mill',
    x: 0,
    z: 0,
    timber: 0,
    constructionComplete: true,
  } as BuildingState;
  const pastoral = {
    id: 'building-2',
    kind: 'pastoral_farmstead',
    x: 12,
    z: 0,
    timber: 0,
    constructionComplete: true,
  } as BuildingState;
  const buildings = new Map([
    [lumber.id, lumber],
    [pastoral.id, pastoral],
  ]);
  const emptyHerd = {
    buildingId: pastoral.id,
    hayStock: 0,
  } as LivestockHerdState;
  const emptySignatures = buildingMarkerSignatures(
    buildings,
    new Map([[pastoral.id, emptyHerd]]),
  );

  const stockedBuildings = new Map(buildings);
  stockedBuildings.set(lumber.id, { ...lumber, timber: 8 });
  const firstHayBundle = new Map([
    [pastoral.id, { ...emptyHerd, hayStock: 10 }],
  ]);
  const stockedSignatures = buildingMarkerSignatures(
    stockedBuildings,
    firstHayBundle,
  );
  assert.notEqual(stockedSignatures.visual, emptySignatures.visual);
  assert.equal(
    stockedSignatures.collider,
    emptySignatures.collider,
    'resource stock should change visual signatures without changing collision signatures',
  );

  const sameVisualLevel = buildingMarkerSignatures(
    new Map([
      [lumber.id, { ...lumber, timber: 9 }],
      [pastoral.id, pastoral],
    ]),
    new Map([[pastoral.id, { ...emptyHerd, hayStock: 20 }]]),
  );
  assert.equal(
    sameVisualLevel.visual,
    stockedSignatures.visual,
    'small stock changes inside one visible bundle should not resync building meshes',
  );

  const secondHayBundle = buildingMarkerSignatures(
    stockedBuildings,
    new Map([[pastoral.id, { ...emptyHerd, hayStock: 31 }]]),
  );
  assert.notEqual(secondHayBundle.visual, stockedSignatures.visual);
  assert.equal(secondHayBundle.collider, stockedSignatures.collider);
}

function testBuildingMarkerSignatureScale(): number {
  const buildings = new Map<string, BuildingState>();
  const herds = new Map<string, LivestockHerdState>();
  for (let index = 0; index < 100_000; index++) {
    const id = `building-${index}`;
    const pastoral = index % 2 === 0;
    buildings.set(id, {
      id,
      kind: pastoral ? 'pastoral_farmstead' : 'lumber_mill',
      x: index % 500,
      z: Math.floor(index / 500),
      timber: pastoral ? 0 : index % 241,
      constructionComplete: true,
    } as BuildingState);
    if (pastoral) {
      herds.set(id, {
        buildingId: id,
        hayStock: index % 241,
      } as LivestockHerdState);
    }
  }
  const started = performance.now();
  const signatures = buildingMarkerSignatures(buildings, herds);
  const elapsed = performance.now() - started;
  assert.ok(signatures.visual.length > signatures.collider.length);
  assert.ok(
    elapsed < 1_000,
    `100,000 dynamic building signatures took ${elapsed.toFixed(1)} ms`,
  );
  return elapsed;
}

function testForestPhaseUpdatesCommitOncePerBatch(): void {
  const placements = Array.from({ length: 64 }, (_, index) => ({
    x: index,
    z: 0,
    form: 'narrow' as const,
    species: 'scotsPine',
    scale: 1,
  }));
  const forestInstances = createStubForestInstances(placements);
  let commits = 0;
  const forestManager = new ForestManager(
    new THREE.Group(),
    forestInstances,
    { group: new THREE.Group(), instances: [] },
    null,
    [],
    {
      getHeightAt: () => 0,
    } as never,
    () => {},
    {
      hideTree: () => {},
      showTree: () => {},
      setShadows: () => {},
      commit: () => {
        commits += 1;
      },
    } as never,
  );
  const visualSync = new ForestVisualSync(forestManager);
  const trees = new Map(
    placements.map((_, layoutIndex) => [
      `tree-${layoutIndex}`,
      {
        treeId: `tree-${layoutIndex}`,
        layoutIndex,
        phase: 'mature' as const,
        growthProgress: 1,
      },
    ]),
  );

  visualSync.syncAll(trees);
  assert.equal(commits, 1, 'full forest sync should commit instance buffers once');

  visualSync.syncTrees(trees, [...trees.keys()]);
  assert.equal(commits, 1, 'unchanged tree phases should not recommit instance buffers');

  visualSync.removeTreeLayouts([1, 2]);
  assert.equal(commits, 2, 'an authoritative deletion batch should commit once');
  assert.equal(forestManager.isTreeLayoutActiveForCollision(1), false);
  assert.equal(forestManager.isTreeLayoutActiveForCollision(2), false);

  visualSync.syncTrees(trees, ['tree-1']);
  assert.equal(commits, 3, 'restoring an authoritative tree should commit once');
  assert.equal(forestManager.isTreeLayoutActiveForCollision(1), true);
}

function testWorldGenerationReferenceStaysStableAcrossTicks(): void {
  const state = {
    simTick: 0,
    worldGeneration: null,
  };
  const row = {
    id: 0,
    seed: 123n,
    nextBuildingId: 1n,
    simTick: 1n,
    mapSize: 1,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
    configured: false,
  };

  syncWorldConfig([row] as never, state as never);
  const firstGeneration = state.worldGeneration;
  syncWorldConfig([{ ...row, simTick: 2n }] as never, state as never);

  assert.equal(state.simTick, 2);
  assert.strictEqual(
    state.worldGeneration,
    firstGeneration,
    'simulation ticks should not replace unchanged world-generation settings',
  );
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      gold: 0,
    },
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
  };
}
