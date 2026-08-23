import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbConnection } from '../src/generated/index.ts';
import type { Building, DeliveryTrip } from '../src/generated/types.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';
import {
  TRADE_MODE_EXPORT,
  TRADE_MODE_IMPORT,
  TRADE_RESOURCE_COMMODITY_CODES,
} from '../src/economy/tradingPostTrade.ts';
import type { TradeResourceKind } from '../src/generated/gameBalance.ts';
import {
  DEFAULT_SPACETIME_URI,
  assertSpacetimeServerAvailable,
  callReducer,
  connectAndSubscribe,
  resolveSpacetimeExecutable,
  runCommand,
  waitUntil as waitUntilBase,
} from './lib/spacetimeIntegrationHarness.mts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const MODULE_PATH = join(PROJECT_ROOT, 'server');
const DATABASE_PREFIX = 'selo-economy-progression-';
const uri = process.env.SELO_ECONOMY_TEST_URI?.trim() || DEFAULT_SPACETIME_URI;
const suppliedDatabase = process.argv[2]?.trim()
  || process.env.SELO_ECONOMY_TEST_DB?.trim();
const ownsDatabase = !suppliedDatabase;
const databaseName = suppliedDatabase || disposableDatabaseName();
const keepDatabase = process.env.SELO_ECONOMY_KEEP_TEST_DB === '1';
const spacetime = resolveSpacetimeExecutable();
let connection: DbConnection | undefined;
let databasePublished = false;

validateDatabaseName(databaseName, ownsDatabase);
assert(existsSync(MODULE_PATH), `SpacetimeDB module path is missing: ${MODULE_PATH}`);

try {
  await assertSpacetimeServerAvailable(uri);
  if (ownsDatabase) {
    console.log(`Publishing disposable economy database ${databaseName}...`);
    await runCommand(
      spacetime,
      [
        'publish',
        '--no-config',
        '--server',
        uri,
        '--module-path',
        MODULE_PATH,
        databaseName,
        '--yes',
      ],
      { cwd: PROJECT_ROOT, env: spacetimeBuildEnvironment() },
    );
    databasePublished = true;
  }

  connection = await connectAndSubscribe(
    databaseName,
    GAME_TABLE_SUBSCRIPTIONS,
    uri,
  );
  const evidence = await runProgressionScenario(connection);
  console.log(JSON.stringify({ databaseName, ...evidence }, null, 2));
  console.log('authoritative economy progression integration passed');
} finally {
  try {
    connection?.disconnect();
  } catch {
    // Best-effort disconnect before deleting an isolated integration database.
  }
  if (databasePublished && !keepDatabase) {
    assert(
      databaseName.startsWith(DATABASE_PREFIX),
      `Refusing to delete non-disposable database ${databaseName}.`,
    );
    console.log(`Deleting disposable economy database ${databaseName}...`);
    await runCommand(
      spacetime,
      ['delete', '--no-config', '--server', uri, databaseName, '--yes'],
      { cwd: PROJECT_ROOT, quiet: true },
    );
  } else if (databasePublished) {
    console.log(`Kept disposable database ${databaseName} for inspection.`);
  }
}

async function runProgressionScenario(connection: DbConnection): Promise<Record<string, unknown>> {
  assert.equal(connection.db.building.count(), 0n, 'a disposable database must start without player buildings');

  await callReducer(connection, 'configureWorld', 'configure_world', {
    seed: 420_042n,
    mapSize: 1,
    topography: 50,
    hydrology: 65,
    forestDensity: 55,
    resourceAbundance: 50,
    resourceVariety: 50,
    conflictEnabled: false,
    enemyPressure: 0,
    severeWeatherEnabled: false,
    wellAquiferNetworksEnabled: false,
  });
  await waitUntil(
    () => Boolean(worldConfig(connection)?.configured),
    'configured world replication',
    {
      describe: () => {
        const config = worldConfig(connection);
        return config
          ? `configured=${config.configured}, seed=${config.seed}, tick=${config.simTick}`
          : 'world_config row absent';
      },
    },
  );

  // These reducers are the same one-time, client-authored world bootstrap used
  // by normal startup. No world stock is injected after the founding camp is
  // placed, and every later transition goes through an ordinary player reducer.
  await callReducer(connection, 'bootstrapTrees', 'bootstrap_trees', {
    trees: deterministicTrees(),
  });
  await callReducer(connection, 'bootstrapQuarries', 'bootstrap_quarries', {
    quarries: [{
      quarryId: 'quarry-economy-progression-stone',
      x: 8_925,
      z: 55,
      maxYield: 1_200,
      isRich: false,
    }],
  });
  await callReducer(connection, 'bootstrapForaging', 'bootstrap_foraging', {
    nodes: [
      {
        nodeId: 'economy-progression-berries',
        nodeKind: 'berries',
        x: 8_960,
        z: 55,
        maxYield: 600,
        anchorX: 8_960,
        anchorZ: 55,
      },
      {
        nodeId: 'economy-progression-mushrooms',
        nodeKind: 'mushrooms',
        x: 8_972,
        z: 58,
        maxYield: 420,
        anchorX: 8_972,
        anchorZ: 58,
      },
    ],
  });
  await waitUntil(
    () => connection.db.tree_entity.count() >= 24n
      && quarry(connection)?.remaining === 1_200
      && foragingNode(connection, 'economy-progression-berries')?.remaining === 600,
    'deterministic world bootstrap replication',
  );

  await callReducer(connection, 'syncRoadNetwork', 'sync_road_network', {
    snapshotJson: JSON.stringify(straightRoadSnapshot()),
  });
  await callReducer(connection, 'placeBuilding', 'place_building', {
    kind: 'founders_camp',
    x: 8_650,
    z: 14,
  });
  await waitUntil(() => buildingByKind(connection, 'founders_camp') != null, 'founders camp replication');

  const campAtFounding = requiredBuilding(connection, 'founders_camp');
  assert(Boolean(campAtFounding.constructionComplete));
  assert(Boolean(campAtFounding.foundingShelterActive));
  assert(campAtFounding.timber > 0 && campAtFounding.stone > 0 && campAtFounding.ryeBread > 0);
  const resources = [...connection.db.player_resources.iter()][0];
  assert(resources?.physicalFoundingSiteEnabled, 'normal founding placement must enable physical stores');
  assert.equal(resources?.timber, 0, 'starter timber must move into the physical camp');
  assert.equal(resources?.stone, 0, 'starter stone must move into the physical camp');

  let constructionTripsObserved = 0;
  const constructionTrace = instrumentConstructionPipeline(connection);
  connection.db.delivery_trip.onInsert((_context, row) => {
    if (row.destinationKind === 1 && row.targetBuildingId !== 0n) {
      constructionTripsObserved += 1;
    }
  });

  await callReducer(connection, 'setGameSpeed', 'set_game_speed', { speed: 8 });
  await waitUntil(() => worldConfig(connection)?.gameSpeed === 8, '8x speed replication');
  const tickBeforeEntry = Number(worldConfig(connection)?.simTick ?? 0n);
  await callReducer(connection, 'enterWorld', 'enter_world', {});
  await waitUntil(
    () => Number(worldConfig(connection)?.simTick ?? 0n) > tickBeforeEntry,
    'first authoritative simulation tick',
  );

  const constructionSeconds: Record<string, number> = {};
  const constructionTicks: Record<string, number> = {};
  const buildingPlans = [
    // Storage is intentionally the first ordinary worksite. This keeps the
    // bounded opening trace independent of time already spent on other sites
    // while retaining the same 135 m camp-to-site road route.
    ['village_storehouse', 8_785, 14],
    ['well', 8_680, 14],
    ['marketplace', 8_710, 14],
    ['chapel', 8_740, 14],
    ['granary', 8_820, 14],
    ['trading_post', 8_855, 14],
    ['lumber_mill', 8_890, 14],
    ['stone_quarry', 8_925, 14],
    ['foragers_shed', 8_960, 14],
    ['woodcutters_lodge', 8_990, 14],
  ] as const;

  for (const [kind, x, z] of buildingPlans) {
    const started = performance.now();
    const startedTick = Number(worldConfig(connection)?.simTick ?? 0n);
    await callReducer(connection, 'placeBuilding', 'place_building', { kind, x, z });
    await waitUntil(
      () => Boolean(buildingByKind(connection, kind)?.constructionComplete),
      `${kind} construction completion`,
      {
        // A site placed near the close of the workday may legitimately wait
        // through the night before its next eligible construction cycle.
        timeoutMs: 120_000,
        describe: () => `${describeBuilding(buildingByKind(connection, kind))}, tick=${worldConfig(connection)?.simTick}, speed=${worldConfig(connection)?.gameSpeed}; ${constructionTrace.describe(buildingByKind(connection, kind)?.id)}`,
      },
    );
    constructionSeconds[kind] = roundSeconds(performance.now() - started);
    const endedTick = Number(worldConfig(connection)?.simTick ?? 0n);
    constructionTicks[kind] = endedTick - startedTick;
    if (kind === 'village_storehouse') {
      console.log(JSON.stringify({
        checkpoint: 'village_storehouse construction',
        startTick: startedTick,
        endTick: endedTick,
        tickDelta: endedTick - startedTick,
        realSeconds: constructionSeconds[kind],
        ...constructionTrace.metrics(requiredBuilding(connection, kind).id),
      }));
    }
  }
  assert(
    constructionTripsObserved > 0,
    'at least one material cart must traverse the authoritative construction pipeline',
  );

  const beforeResidenceIds = new Set([...connection.db.residence.iter()].map((row) => row.id));
  const housingStarted = performance.now();
  await callReducer(connection, 'placeBurgageZone', 'place_burgage_zone', {
    cornerAx: 8_728,
    cornerAz: -4,
    cornerBx: 8_770,
    cornerBz: -4,
    cornerCx: 8_770,
    cornerCz: -28,
    cornerDx: 8_728,
    cornerDz: -28,
    frontageEdge: 0,
    plotCount: 3,
  });
  await waitUntil(
    () => newResidences(connection, beforeResidenceIds).length === 3,
    'three authoritative cottage worksites',
  );
  await waitUntil(
    () => newResidences(connection, beforeResidenceIds).every((row) => row.tier === 1),
    'three completed tier-one cottages',
    {
      timeoutMs: 180_000,
      describe: () => newResidences(connection, beforeResidenceIds)
        .map((row) => `${row.id}:tier=${row.tier},target=${row.upgradeTargetTier},progress=${row.upgradeProgress.toFixed(3)}`)
        .join('; '),
    },
  );
  constructionSeconds.tier1Housing = roundSeconds(performance.now() - housingStarted);

  const laborPlan = [
    // Keep two founders unassigned so physical carts never have to compete
    // with a 9/10 fully committed operating roster.
    ['lumber_mill', 1],
    ['stone_quarry', 1],
    ['foragers_shed', 1],
    ['woodcutters_lodge', 1],
    ['village_storehouse', 1],
    ['granary', 1],
    ['chapel', 1],
    ['trading_post', 1],
  ] as const;
  const laborAvailabilityWaitSeconds: Record<string, number> = {};
  for (const [kind, labor] of laborPlan) {
    const waitStarted = performance.now();
    await assignLaborWhenAvailable(connection, requiredBuilding(connection, kind), labor);
    laborAvailabilityWaitSeconds[kind] = roundSeconds(performance.now() - waitStarted);
  }
  await waitUntil(
    () => laborPlan.every(([kind, labor]) => buildingByKind(connection, kind)?.assignedLabor === labor),
    'authoritative staffing plan replication',
  );

  const stoneBefore = quarry(connection)?.remaining ?? 0;
  const berriesBefore = foragingNode(connection, 'economy-progression-berries')?.remaining ?? 0;
  const matureTreesBefore = matureTreeCount(connection);
  await waitUntil(
    () => (quarry(connection)?.remaining ?? stoneBefore) < stoneBefore
      && (foragingNode(connection, 'economy-progression-berries')?.remaining ?? berriesBefore) < berriesBefore
      && matureTreeCount(connection) < matureTreesBefore,
    'local timber, stone, and food extraction replacing starter dependence',
    {
      timeoutMs: 90_000,
      describe: () => `stone=${quarry(connection)?.remaining}/${stoneBefore}, berries=${foragingNode(connection, 'economy-progression-berries')?.remaining}/${berriesBefore}, matureTrees=${matureTreeCount(connection)}/${matureTreesBefore}`,
    },
  );

  await waitUntil(
    () => newResidences(connection, beforeResidenceIds)
      .reduce((total, row) => total + row.population, 0) >= 10,
    'all ten founders housed through normal settlement',
    {
      timeoutMs: 120_000,
      describe: () => describeFoundersHousing(connection, beforeResidenceIds),
    },
  );
  await waitUntil(
    () => !buildingByKind(connection, 'founders_camp')?.foundingShelterActive,
    'founders camp shelter retirement',
    { timeoutMs: 20_000 },
  );

  const promotionCandidate = newResidences(connection, beforeResidenceIds)
    .filter((row) => row.tier === 1 && row.population >= 3)
    .sort((a, b) => Number(a.id - b.id))[0];
  assert(promotionCandidate, 'at least one occupied tier-one residence must fund its own first promotion');
  assert.equal(totalPhysicalCommodity(connection, 'ale'), 0, 'Tier 2 ale must be absent before Tier 1 promotion');
  assert.equal(totalPhysicalCommodity(connection, 'cloth'), 0, 'Tier 2 cloth must be absent before Tier 1 promotion');

  const promotionStarted = performance.now();
  await callReducer(connection, 'upgradeResidence', 'upgrade_residence', {
    residenceId: promotionCandidate.id,
  });
  await waitUntil(
    () => residenceById(connection, promotionCandidate.id)?.tier === 2,
    'Tier 1 to Tier 2 residence promotion',
    {
      timeoutMs: 75_000,
      describe: () => describeResidence(residenceById(connection, promotionCandidate.id)),
    },
  );
  constructionSeconds.tier1ToTier2 = roundSeconds(performance.now() - promotionStarted);
  assert.equal(totalPhysicalCommodity(connection, 'ale'), 0, 'promotion must not invent future-tier ale');
  assert.equal(totalPhysicalCommodity(connection, 'cloth'), 0, 'promotion must not invent future-tier cloth');

  await placeCompleteAndStaffBuilding(connection, 'tavern', 9_020, 14, 1);
  const tradingPost = requiredBuilding(connection, 'trading_post');
  for (const [resource, reserve] of [
    ['timber', 36],
    ['stone', 28],
    ['firewood', 18],
    ['berries', 8],
    ['mushrooms', 8],
  ] as const) {
    await setTradingPostRule(connection, tradingPost.id, resource, TRADE_MODE_EXPORT, reserve);
  }
  await setTradingPostRule(connection, tradingPost.id, 'ale', TRADE_MODE_IMPORT, 12);
  await setTradingPostRule(connection, tradingPost.id, 'cloth', TRADE_MODE_IMPORT, 12);
  await waitUntil(
    () => (buildingByKind(connection, 'tavern')?.ale ?? 0) > 1e-6
      && (buildingByKind(connection, 'marketplace')?.cloth ?? 0) > 1e-6,
    'physical Tier-2 beverage and cloth service stock',
    {
      timeoutMs: 120_000,
      describe: () => `post[gold=${requiredBuilding(connection, 'trading_post').gold.toFixed(2)},ale=${requiredBuilding(connection, 'trading_post').ale.toFixed(2)},cloth=${requiredBuilding(connection, 'trading_post').cloth.toFixed(2)}], tavernAle=${requiredBuilding(connection, 'tavern').ale.toFixed(2)}, marketCloth=${requiredBuilding(connection, 'marketplace').cloth.toFixed(2)}`,
    },
  );

  assert.equal(totalPhysicalCommodity(connection, 'shoes'), 0, 'Tier 3 shoes must be absent before Tier 2 promotion');
  const tierTwoPromotionStarted = performance.now();
  await callReducer(connection, 'upgradeResidence', 'upgrade_residence', {
    residenceId: promotionCandidate.id,
  });
  await waitUntil(
    () => residenceById(connection, promotionCandidate.id)?.tier === 3,
    'Tier 2 to Tier 3 residence promotion',
    {
      timeoutMs: 120_000,
      describe: () => describeResidenceWithNeeds(connection, promotionCandidate.id),
    },
  );
  constructionSeconds.tier2ToTier3 = roundSeconds(performance.now() - tierTwoPromotionStarted);

  assertFiniteNonNegativeState(connection);
  const finalResidences = newResidences(connection, beforeResidenceIds);
  return {
    stage: 'fresh world through legitimate Tier 3',
    simTick: Number(worldConfig(connection)?.simTick ?? 0n),
    constructionSeconds,
    constructionTicks,
    constructionTripsObserved,
    laborAvailabilityWaitSeconds,
    population: finalResidences.reduce((total, row) => total + row.population, 0),
    tiers: finalResidences.map((row) => row.tier),
    extraction: {
      stoneUsed: stoneBefore - (quarry(connection)?.remaining ?? stoneBefore),
      berriesUsed: berriesBefore
        - (foragingNode(connection, 'economy-progression-berries')?.remaining ?? berriesBefore),
      treesHarvested: matureTreesBefore - matureTreeCount(connection),
    },
    futureTierGoodsAbsentAtPromotion: ['ale', 'cloth', 'shoes'],
    remainingAuthoritativeStages: [
      'satisfy Tier-3 shoes, expanded diet, and level-2 church needs',
      'prove Tier 3 -> Tier 4 succeeds while preserved food, pottery, and luxury are absent',
      'sustain the Tier-4 household through a complete seasonal cycle',
    ],
  };
}

async function placeCompleteAndStaffBuilding(
  connection: DbConnection,
  kind: string,
  x: number,
  z: number,
  labor: number,
): Promise<void> {
  await callReducer(connection, 'placeBuilding', 'place_building', { kind, x, z });
  await waitUntil(
    () => Boolean(buildingByKind(connection, kind)?.constructionComplete),
    `${kind} construction completion`,
    {
      timeoutMs: 180_000,
      describe: () => describeBuilding(buildingByKind(connection, kind)),
    },
  );
  await assignLaborWhenAvailable(connection, requiredBuilding(connection, kind), labor);
  await waitUntil(
    () => buildingByKind(connection, kind)?.assignedLabor === labor,
    `${kind} staffing replication`,
  );
}

async function setTradingPostRule(
  connection: DbConnection,
  buildingId: bigint,
  resource: TradeResourceKind,
  mode: 1 | 2,
  targetSurplus: number,
): Promise<void> {
  const commodityKind = TRADE_RESOURCE_COMMODITY_CODES[resource];
  await callReducer(connection, 'setTradingPostTradeRule', 'set_trading_post_trade_rule', {
    buildingId,
    commodityKind,
    mode,
    targetSurplus,
  });
  await waitUntil(
    () => [...connection.db.trading_post_trade_rule.iter()].some((rule) =>
      rule.buildingId === buildingId
      && rule.commodityKind === commodityKind
      && rule.mode === mode
      && Math.abs(rule.targetSurplus - targetSurplus) <= 1e-6),
    `${resource} trade-rule replication`,
  );
}

async function assignLaborWhenAvailable(
  connection: DbConnection,
  building: Building,
  labor: number,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastAvailabilityError: unknown;
  while (Date.now() < deadline) {
    const current = buildingById(connection, building.id);
    const additional = Math.max(0, labor - (current?.assignedLabor ?? 0));
    await waitUntil(
      () => currentLaborCounts(connection).available >= additional,
      `${building.kind} staffing labor availability`,
      {
        timeoutMs: Math.max(1, deadline - Date.now()),
        describe: () => {
          const counts = currentLaborCounts(connection);
          return `requested=${labor}, current=${buildingById(connection, building.id)?.assignedLabor ?? 0}, available=${counts.available}`;
        },
      },
    );
    try {
      await callReducer(connection, 'assignBuildingLabor', 'assign_building_labor', {
        buildingId: building.id,
        labor,
      });
      return;
    } catch (error) {
      if (!/workers? available/i.test(String(error))) throw error;
      // A simulation tick may commit a cart between the replicated availability
      // check and this normal reducer. Retry after the next truthful labor gap.
      lastAvailabilityError = error;
    }
  }
  throw new Error(`Timed out assigning ${labor} worker(s) to ${building.kind}.`, {
    cause: lastAvailabilityError,
  });
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    describe?: () => string;
  } = {},
): Promise<void> {
  const activeConnection = connection;
  const startTick = Number(activeConnection ? worldConfig(activeConnection)?.simTick ?? 0n : 0n);
  const startedAt = performance.now();
  await waitUntilBase(predicate, label, {
    ...options,
    describe: () => {
      const localDetail = options.describe?.();
      if (!activeConnection) return localDetail ?? 'database connection unavailable';
      const diagnostics = describeScenarioState(
        activeConnection,
        startTick,
        performance.now() - startedAt,
      );
      return localDetail ? `${localDetail}; ${diagnostics}` : diagnostics;
    },
  });
}

function worldConfig(connection: DbConnection) {
  return [...connection.db.world_config.iter()][0];
}

function buildingByKind(connection: DbConnection, kind: string) {
  return [...connection.db.building.iter()].find((row) => row.kind === kind);
}

function requiredBuilding(connection: DbConnection, kind: string) {
  const building = buildingByKind(connection, kind);
  assert(building, `missing authoritative ${kind} row`);
  return building;
}

function quarry(connection: DbConnection) {
  return [...connection.db.quarry.iter()]
    .find((row) => row.quarryId === 'quarry-economy-progression-stone');
}

function foragingNode(connection: DbConnection, nodeId: string) {
  return [...connection.db.foraging_node.iter()].find((row) => row.nodeId === nodeId);
}

function residenceById(connection: DbConnection, residenceId: bigint) {
  return [...connection.db.residence.iter()].find((row) => row.id === residenceId);
}

function newResidences(connection: DbConnection, beforeIds: ReadonlySet<bigint>) {
  return [...connection.db.residence.iter()].filter((row) => !beforeIds.has(row.id));
}

function matureTreeCount(connection: DbConnection): number {
  return [...connection.db.tree_entity.iter()]
    .filter((row) => row.treeId.startsWith('economy-progression-tree-') && row.phase === 'mature')
    .length;
}

function totalPhysicalCommodity(
  connection: DbConnection,
  commodity: 'ale' | 'cloth' | 'shoes' | 'preservedFood' | 'pottery' | 'honey' | 'wine',
): number {
  const buildingStock = [...connection.db.building.iter()]
    .reduce((total, row) => total + row[commodity], 0);
  const resourceStock = [...connection.db.player_resources.iter()]
    .reduce((total, row) => total + row[commodity], 0);
  const cargoKind = TRADE_RESOURCE_COMMODITY_CODES[commodity];
  const cartStock = [...connection.db.delivery_trip.iter()]
    .filter((row) => row.cargoKind === cargoKind)
    .reduce((total, row) => total + row.amount, 0);
  return buildingStock + resourceStock + cartStock;
}

function describeResidenceWithNeeds(connection: DbConnection, residenceId: bigint): string {
  const residence = residenceById(connection, residenceId);
  const needs = [...connection.db.residence_need.iter()]
    .filter((need) => need.residenceId === residenceId)
    .map((need) => `${need.needKind}=${need.stock.toFixed(2)}/def${need.deficitTicks}`)
    .join(',');
  return `${describeResidence(residence)}; needs[${needs}]`;
}

function assertFiniteNonNegativeState(connection: DbConnection): void {
  for (const building of connection.db.building.iter()) {
    assertFiniteNonNegative(`building ${building.id} constructionProgress`, building.constructionProgress);
    assertFiniteNonNegative(`building ${building.id} timber`, building.timber);
    assertFiniteNonNegative(`building ${building.id} stone`, building.stone);
    assertFiniteNonNegative(`building ${building.id} firewood`, building.firewood);
    assertFiniteNonNegative(`building ${building.id} food`, building.food);
    assertFiniteNonNegative(`building ${building.id} assignedLabor`, building.assignedLabor);
  }
  for (const residence of connection.db.residence.iter()) {
    assertFiniteNonNegative(`residence ${residence.id} population`, residence.population);
    assertFiniteNonNegative(`residence ${residence.id} upgradeProgress`, residence.upgradeProgress);
    assertFiniteNonNegative(`residence ${residence.id} householdWealth`, residence.householdWealth);
    assertFiniteNonNegative(`residence ${residence.id} food`, residence.food);
  }
  for (const need of connection.db.residence_need.iter()) {
    assertFiniteNonNegative(`need ${need.id} stock`, need.stock);
    assertFiniteNonNegative(`need ${need.id} deficitTicks`, need.deficitTicks);
  }
  for (const trip of connection.db.delivery_trip.iter()) {
    assertFiniteNonNegative(`trip ${trip.id} amount`, trip.amount);
    assertFiniteNonNegative(`trip ${trip.id} progress`, trip.progress);
  }
}

function describeScenarioState(
  connection: DbConnection,
  startTick: number,
  elapsedMs: number,
): string {
  const config = worldConfig(connection);
  const tick = Number(config?.simTick ?? 0n);
  const labor = currentLaborCounts(connection);
  const trips = [...connection.db.delivery_trip.iter()]
    .map((trip) => {
      const origin = buildingById(connection, trip.buildingId);
      const labor = buildingById(connection, trip.laborBuildingId);
      const target = trip.destinationKind === 0
        ? `residence:${trip.residenceId}`
        : `${buildingById(connection, trip.targetBuildingId)?.kind ?? 'building'}:${trip.targetBuildingId}`;
      return `#${trip.id} origin=${origin?.kind ?? 'treasury'}:${trip.buildingId}`
        + ` labor=${labor?.kind ?? (trip.laborBuildingId === 0n ? 'free' : 'building')}:${trip.laborBuildingId}`
        + ` target=${target} phase=${deliveryPhase(trip.phase)}`
        + ` workers=${trip.deliveryWorkers} free=${trip.freeHaulerWorkers}`
        + ` cargo=${trip.cargoKind}/${trip.amount.toFixed(1)}`;
    })
    .join(' | ');
  return [
    `clock=tick ${tick} (+${tick - startTick} in ${(elapsedMs / 1_000).toFixed(1)}s real), speed=${config?.gameSpeed ?? 'n/a'}`,
    `labor=population ${labor.population}, assigned ${labor.assigned} (buildings ${labor.assignedBuildings}, residences ${labor.assignedResidences}), free-haulers ${labor.freeHaulers}, available ${labor.available}`,
    `stocks=${describeRelevantStocks(connection)}`,
    `active-trips=${trips || 'none'}`,
  ].join('; ');
}

type LaborCounts = {
  population: number;
  assigned: number;
  assignedBuildings: number;
  assignedResidences: number;
  freeHaulers: number;
  available: number;
};

function currentLaborCounts(connection: DbConnection): LaborCounts {
  const residencePopulation = [...connection.db.residence.iter()]
    .filter((row) => !row.abandoned)
    .reduce((total, row) => total + Math.max(0, row.population - row.sickPopulation), 0);
  const resources = [...connection.db.player_resources.iter()][0];
  const population = resources?.legacyUnhousedPopulationBonusEnabled
    ? 10 + residencePopulation
    : Math.max(10, residencePopulation);
  const assignedBuildings = [...connection.db.building.iter()]
    .reduce((total, row) => total + row.assignedLabor, 0);
  const assignedResidences = [...connection.db.residence.iter()]
    .filter((row) => row.upgradeTargetTier > row.tier
      || row.backyardProjectKind > 0
      || row.fireRepairActive
      || row.decayRepairActive
      || row.roofTileRetrofitActive)
    .reduce((total, row) => total + Math.min(1, row.upgradeAssignedLabor), 0);
  const freeHaulers = [...connection.db.delivery_trip.iter()]
    .reduce((total, row) => total + row.freeHaulerWorkers, 0);
  const assigned = assignedBuildings + assignedResidences;
  return {
    population,
    assigned,
    assignedBuildings,
    assignedResidences,
    freeHaulers,
    available: Math.max(0, population - assigned - freeHaulers),
  };
}

type TripMoment = {
  tick: number;
  realMs: number;
  labor: LaborCounts;
};

type ConstructionTripTrace = {
  id: bigint;
  targetBuildingId: bigint;
  cargoKind: number;
  amountAtDispatch: number;
  pathDistance: number;
  workers: number;
  originBuildingId: bigint;
  laborBuildingId: bigint;
  dispatched: TripMoment;
  unloading?: TripMoment;
  emptied?: TripMoment;
  returned?: TripMoment;
  sourceStockAtDispatch: string;
};

type ConstructionLedgerTrace = {
  tick: number;
  realMs: number;
  progress: number;
  labor: number;
  deliveredTimber: number;
  reservedTimber: number;
  deliveredStone: number;
  reservedStone: number;
};

function instrumentConstructionPipeline(connection: DbConnection): {
  describe: (siteId: bigint | undefined) => string;
  metrics: (siteId: bigint | undefined) => Record<string, unknown>;
} {
  const startedAt = performance.now();
  const trips = new Map<bigint, ConstructionTripTrace>();
  const ledgers = new Map<bigint, ConstructionLedgerTrace[]>();
  const peakApproachingBySite = new Map<bigint, number>();

  const moment = (): TripMoment => ({
    tick: Number(worldConfig(connection)?.simTick ?? 0n),
    realMs: performance.now() - startedAt,
    labor: currentLaborCounts(connection),
  });
  const stockAtSource = (row: DeliveryTrip): string => {
    const source = buildingById(connection, row.buildingId);
    return source
      ? `timber=${source.timber.toFixed(1)},stone=${source.stone.toFixed(1)}`
      : 'source row absent';
  };

  connection.db.delivery_trip.onInsert((_context, row) => {
    if (row.destinationKind !== 1 || row.targetBuildingId === 0n) return;
    trips.set(row.id, {
      id: row.id,
      targetBuildingId: row.targetBuildingId,
      cargoKind: row.cargoKind,
      amountAtDispatch: row.amount,
      pathDistance: row.pathDistance,
      workers: row.deliveryWorkers,
      originBuildingId: row.buildingId,
      laborBuildingId: row.laborBuildingId,
      dispatched: moment(),
      sourceStockAtDispatch: stockAtSource(row),
    });
    const approaching = [...trips.values()].filter((trace) =>
      trace.targetBuildingId === row.targetBuildingId && trace.emptied == null,
    ).length;
    peakApproachingBySite.set(
      row.targetBuildingId,
      Math.max(peakApproachingBySite.get(row.targetBuildingId) ?? 0, approaching),
    );
  });
  connection.db.delivery_trip.onUpdate((_context, oldRow, row) => {
    const trace = trips.get(row.id);
    if (!trace) return;
    if (!trace.unloading && oldRow.phase !== 1 && row.phase === 1) {
      trace.unloading = moment();
    }
    if (!trace.emptied && oldRow.amount > 1e-6 && row.amount <= 1e-6) {
      trace.emptied = moment();
    }
  });
  connection.db.delivery_trip.onDelete((_context, row) => {
    const trace = trips.get(row.id);
    if (trace) trace.returned = moment();
  });
  connection.db.building.onInsert((_context, row) => {
    if (!row.constructionComplete) recordLedger(row);
  });
  connection.db.building.onUpdate((_context, oldRow, row) => {
    if (row.constructionComplete && oldRow.constructionComplete) return;
    const materialChanged = oldRow.constructionDeliveredTimber !== row.constructionDeliveredTimber
      || oldRow.constructionReservedTimber !== row.constructionReservedTimber
      || oldRow.constructionDeliveredStone !== row.constructionDeliveredStone
      || oldRow.constructionReservedStone !== row.constructionReservedStone
      || oldRow.assignedLabor !== row.assignedLabor
      || oldRow.constructionComplete !== row.constructionComplete;
    const oldBucket = Math.floor(oldRow.constructionProgress * 10 + 1e-6);
    const newBucket = Math.floor(row.constructionProgress * 10 + 1e-6);
    if (materialChanged || oldBucket !== newBucket) recordLedger(row);
  });

  function recordLedger(row: Building): void {
    const history = ledgers.get(row.id) ?? [];
    history.push({
      tick: Number(worldConfig(connection)?.simTick ?? 0n),
      realMs: performance.now() - startedAt,
      progress: row.constructionProgress,
      labor: row.assignedLabor,
      deliveredTimber: row.constructionDeliveredTimber,
      reservedTimber: row.constructionReservedTimber,
      deliveredStone: row.constructionDeliveredStone,
      reservedStone: row.constructionReservedStone,
    });
    ledgers.set(row.id, history);
  }

  return {
    describe(siteId) {
      if (siteId == null) return 'construction-trace=site row absent';
      const siteTrips = [...trips.values()]
        .filter((trace) => trace.targetBuildingId === siteId)
        .sort((a, b) => a.dispatched.tick - b.dispatched.tick);
      const lifecycle = siteTrips.map((trace) => {
        const outboundTicks = trace.unloading
          ? trace.unloading.tick - trace.dispatched.tick
          : undefined;
        const unloadTicks = trace.unloading && trace.emptied
          ? trace.emptied.tick - trace.unloading.tick
          : undefined;
        const returnTicks = trace.emptied && trace.returned
          ? trace.returned.tick - trace.emptied.tick
          : undefined;
        return `#${trace.id} cargo=${trace.cargoKind}/${trace.amountAtDispatch.toFixed(1)}`
          + ` route=${trace.pathDistance.toFixed(1)}m workers=${trace.workers}`
          + ` origin=${trace.originBuildingId} labor=${trace.laborBuildingId || 'free'}`
          + ` dispatch=t${trace.dispatched.tick}/${(trace.dispatched.realMs / 1_000).toFixed(1)}s`
          + ` outbound=${outboundTicks ?? 'active'}t`
          + ` unload=${unloadTicks ?? (trace.unloading ? 'active' : 'pending')}t`
          + ` return=${returnTicks ?? (trace.emptied ? 'active' : 'pending')}t`
          + ` source[${trace.sourceStockAtDispatch}]`
          + ` labor[p=${trace.dispatched.labor.population},assigned=${trace.dispatched.labor.assigned},haulers=${trace.dispatched.labor.freeHaulers},available=${trace.dispatched.labor.available}]`;
      }).join(' | ');
      const dispatchGaps = constructionDispatchGaps(siteTrips);
      const history = ledgers.get(siteId) ?? [];
      const ledger = history.map((event) =>
        `t${event.tick}/${(event.realMs / 1_000).toFixed(1)}s:`
        + `p${event.progress.toFixed(2)},labor${event.labor},`
        + `T${event.deliveredTimber.toFixed(0)}/${event.reservedTimber.toFixed(0)},`
        + `S${event.deliveredStone.toFixed(0)}/${event.reservedStone.toFixed(0)}`,
      ).join(' > ');
      return `construction-trace peak-approaching=${peakApproachingBySite.get(siteId) ?? 0}; trips=[${lifecycle || 'none'}]; dispatch-gaps=[${dispatchGaps || 'none'}]; ledger=[${ledger || 'none'}]`;
    },
    metrics(siteId) {
      if (siteId == null) return { peakApproachingConstructionCarts: 0, tripCount: 0 };
      const siteTrips = [...trips.values()].filter((trace) => trace.targetBuildingId === siteId);
      return {
        peakApproachingConstructionCarts: peakApproachingBySite.get(siteId) ?? 0,
        tripCount: siteTrips.length,
        routeDistancesMeters: [...new Set(siteTrips.map((trace) => trace.pathDistance))],
        cartPayloads: siteTrips.map((trace) => ({
          cargoKind: trace.cargoKind,
          amount: trace.amountAtDispatch,
        })),
      };
    },
  };
}

function constructionDispatchGaps(trips: readonly ConstructionTripTrace[]): string {
  const byCargo = new Map<number, ConstructionTripTrace[]>();
  for (const trip of trips) {
    const group = byCargo.get(trip.cargoKind) ?? [];
    group.push(trip);
    byCargo.set(trip.cargoKind, group);
  }
  const gaps: string[] = [];
  for (const [cargo, group] of byCargo) {
    group.sort((a, b) => a.dispatched.tick - b.dispatched.tick);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const next = group[index];
      const anchor = previous.emptied ?? previous.unloading ?? previous.dispatched;
      gaps.push(`cargo${cargo} #${previous.id}->#${next.id}: ${next.dispatched.tick - anchor.tick}t/${((next.dispatched.realMs - anchor.realMs) / 1_000).toFixed(1)}s after ${previous.emptied ? 'empty' : previous.unloading ? 'arrival' : 'dispatch'}`);
    }
  }
  return gaps.join(' | ');
}

function buildingById(connection: DbConnection, buildingId: bigint) {
  if (buildingId === 0n) return undefined;
  return [...connection.db.building.iter()].find((row) => row.id === buildingId);
}

function describeRelevantStocks(connection: DbConnection): string {
  const commodities = [
    'timber',
    'stone',
    'firewood',
    'water',
    'food',
    'gold',
    'ale',
    'cloth',
    'shoes',
    'preservedFood',
    'pottery',
  ] as const;
  const buildings = [...connection.db.building.iter()] as Array<Record<string, unknown>>;
  const resources = [...connection.db.player_resources.iter()] as Array<Record<string, unknown>>;
  const residences = [...connection.db.residence.iter()] as Array<Record<string, unknown>>;
  return commodities
    .map((commodity) => {
      const buildingStock = buildings.reduce((sum, row) => sum + numeric(row[commodity]), 0);
      const resourceStock = resources.reduce((sum, row) => sum + numeric(row[commodity]), 0);
      const residenceStock = residences.reduce((sum, row) => sum + numeric(row[commodity]), 0);
      return `${commodity}=${(buildingStock + resourceStock + residenceStock).toFixed(1)}`;
    })
    .join(',');
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function deliveryPhase(phase: number): string {
  return ['outbound', 'unloading', 'inbound'][phase] ?? `unknown-${phase}`;
}

function assertFiniteNonNegative(label: string, value: number): void {
  assert(Number.isFinite(value), `${label} must remain finite (received ${value})`);
  assert(value >= 0, `${label} must remain non-negative (received ${value})`);
}

function deterministicTrees() {
  return Array.from({ length: 24 }, (_, index) => ({
    treeId: `economy-progression-tree-${index}`,
    layoutIndex: 1_000_000 + index,
    woodYield: 14,
    x: 8_865 + (index % 6) * 10,
    z: 48 + Math.floor(index / 6) * 9,
  }));
}

function straightRoadSnapshot() {
  return {
    nextNodeId: 3,
    nextEdgeId: 2,
    nodes: [
      { id: 'n1', position: [8_600, 0, 0] },
      { id: 'n2', position: [9_120, 0, 0] },
    ],
    edges: [{
      id: 'e1',
      startNodeId: 'n1',
      endNodeId: 'n2',
      width: 4.2,
      controlPoints: [[8_600, 0, 0], [9_120, 0, 0]],
      sampledPath: [[8_600, 0, 0], [9_120, 0, 0]],
      length: 520,
      revision: 1,
    }],
  };
}

function describeBuilding(building: ReturnType<typeof buildingByKind>): string {
  if (!building) return 'row not replicated';
  return `id=${building.id}, complete=${building.constructionComplete}, progress=${building.constructionProgress.toFixed(3)}, delivered=${building.constructionDeliveredTimber.toFixed(1)}/${building.constructionRequiredTimber.toFixed(1)} timber + ${building.constructionDeliveredStone.toFixed(1)}/${building.constructionRequiredStone.toFixed(1)} stone, labor=${building.assignedLabor}`;
}

function describeResidence(residence: ReturnType<typeof residenceById>): string {
  if (!residence) return 'row not replicated';
  return `tier=${residence.tier}, target=${residence.upgradeTargetTier}, progress=${residence.upgradeProgress.toFixed(3)}, delivered=${residence.upgradeDeliveredTimber.toFixed(1)}/${residence.upgradeRequiredTimber.toFixed(1)} timber + ${residence.upgradeDeliveredStone.toFixed(1)}/${residence.upgradeRequiredStone.toFixed(1)} stone, labor=${residence.upgradeAssignedLabor}`;
}

function describeFoundersHousing(
  connection: DbConnection,
  beforeResidenceIds: ReadonlySet<bigint>,
): string {
  const needLabel = new Map<number, string>([
    [0, 'firewood'],
    [1, 'water'],
    [2, 'food'],
  ]);
  const residences = newResidences(connection, beforeResidenceIds)
    .map((row) => {
      const needs = [...connection.db.residence_need.iter()]
        .filter((need) => need.residenceId === row.id && needLabel.has(need.needKind))
        .map((need) => `${needLabel.get(need.needKind)}=${need.stock.toFixed(3)}/def${need.deficitTicks}`)
        .join(',');
      return `${row.id}@(${row.x.toFixed(1)},${row.z.toFixed(1)}):pop=${row.population}/${row.populationCapacity}`
        + ` settle=${row.settlementTicks} hunger=${row.hungerTicks}`
        + ` pantry[food=${row.food.toFixed(2)},ryeBread=${row.ryeBread.toFixed(2)},berries=${row.berries.toFixed(2)},mushrooms=${row.mushrooms.toFixed(2)}]`
        + ` needs[${needs}]`;
    })
    .join(' | ');
  const serviceKinds = ['founders_camp', 'marketplace', 'granary', 'well', 'foragers_shed'] as const;
  const services = serviceKinds.map((kind) => {
    const row = buildingByKind(connection, kind);
    if (!row) return `${kind}=absent`;
    return `${kind}#${row.id}@(${row.x.toFixed(1)},${row.z.toFixed(1)})`
      + `[labor=${row.assignedLabor},firewood=${row.firewood.toFixed(2)},water=${row.water.toFixed(2)},food=${row.food.toFixed(2)},ryeBread=${row.ryeBread.toFixed(2)},berries=${row.berries.toFixed(2)},mushrooms=${row.mushrooms.toFixed(2)}`
      + `${kind === 'founders_camp' ? `,shelter=${row.foundingShelterActive}` : ''}]`;
  }).join(' | ');
  return `residences=${residences}; services=${services}`;
}

function roundSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

function disposableDatabaseName(): string {
  const time = Date.now().toString(36);
  const processPart = Math.max(0, process.pid).toString(36);
  return `${DATABASE_PREFIX}${time}-${processPart}`;
}

function validateDatabaseName(databaseName: string, generated: boolean): void {
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(databaseName),
    `Invalid SpacetimeDB database name: ${databaseName}`,
  );
  if (generated) {
    assert(databaseName.startsWith(DATABASE_PREFIX));
  }
}

function spacetimeBuildEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!process.env.LOCALAPPDATA) return env;
  const binaryen = join(
    process.env.LOCALAPPDATA,
    'Programs',
    'Binaryen',
    'binaryen-version_126',
    'bin',
  );
  if (existsSync(join(binaryen, 'wasm-opt.exe'))) {
    env.Path = `${binaryen};${env.Path ?? ''}`;
  }
  return env;
}
