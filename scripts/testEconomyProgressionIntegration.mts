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
import {
  CALENDAR_SECONDS_PER_DAY,
  CHAPEL_TIER2_UPGRADE_IRONWORK,
  CHAPEL_TIER2_UPGRADE_ROOF_TILES,
  CHAPEL_TIER2_UPGRADE_STONE,
  CHAPEL_TIER2_UPGRADE_TIMBER,
  CHAPEL_TIER3_UPGRADE_IRONWORK,
  CHAPEL_TIER3_UPGRADE_ROOF_TILES,
  CHAPEL_TIER3_UPGRADE_STONE,
  CHAPEL_TIER3_UPGRADE_TIMBER,
  NATURAL_TREE_MATURATION_DAYS,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  RESIDENCE_TIER4_GOLD_COST,
  RESIDENCE_TIER4_STONE_COST,
  RESIDENCE_TIER4_TIMBER_COST,
  RESIDENCE_SERVICE_WARNING_DAYS,
  RESIDENCE_TILE_ROOF_TILE_COST,
  SIM_TICK_SECONDS,
  TREE_REGROWTH_UPDATE_INTERVAL_SEC,
  type TradeResourceKind,
} from '../src/generated/gameBalance.ts';
import {
  foodMealValue,
  foodProgressionStatus,
  householdFoodPerDay,
} from '../src/economy/foodInventory.ts';
import {
  activeResidenceNeedKinds,
  requiredChapelTierForResidence,
  RESIDENCE_NEED_KIND_IDS,
} from '../src/residences/residenceNeedState.ts';
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
const FOUNDERS_COUNT = 10;
const TIER_TWO_GRAIN_BUFFER_DAYS = 7;
const TIER_TWO_GRAIN_IMPORT_TARGET = Math.ceil(
  householdFoodPerDay(FOUNDERS_COUNT) * TIER_TWO_GRAIN_BUFFER_DAYS,
);
const TIER_FOOD_IMPORT_TARGETS = {
  ryeBread: TIER_TWO_GRAIN_IMPORT_TARGET,
  meat: settlementFoodBufferTarget('meat'),
  fish: settlementFoodBufferTarget('fish'),
  milk: settlementFoodBufferTarget('milk'),
} as const;
const MAX_RESIDENCE_UPGRADE_TICKS = Math.ceil(
  3 * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
);
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
    await waitUntil(() => buildingByKind(connection, kind) != null, `${kind} worksite replication`);
    await assignConstructionBuilderWhenNeeded(connection, requiredBuilding(connection, kind));
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
    console.log(JSON.stringify({
      checkpoint: `${kind} construction`,
      startTick: startedTick,
      endTick: endedTick,
      tickDelta: endedTick - startedTick,
      realSeconds: constructionSeconds[kind],
    }));
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

  const recoveringTreesBeforeReforester = new Map(
    [...connection.db.tree_entity.iter()]
      .filter((row) => row.treeId.startsWith('economy-progression-tree-') && row.phase !== 'mature')
      .map((row) => [row.treeId, row.growthProgress]),
  );
  assert(
    recoveringTreesBeforeReforester.size > 0,
    'normal timber extraction must leave at least one physical tree available for managed regrowth',
  );
  const reforesterConstructionStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  await placeCompleteAndStaffBuilding(connection, 'reforester', 9_040, 14, 1);
  const managedRecoveryBaseline = new Map(
    [...connection.db.tree_entity.iter()]
      .filter((row) => recoveringTreesBeforeReforester.has(row.treeId) && row.phase !== 'mature')
      .map((row) => [row.treeId, row.growthProgress]),
  );
  assert(managedRecoveryBaseline.size > 0, 'reforester must retain at least one recovering tree in range');
  const reforesterRecoveryStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  const naturalGrowthPerUpdate = TREE_REGROWTH_UPDATE_INTERVAL_SEC
    / (NATURAL_TREE_MATURATION_DAYS * CALENDAR_SECONDS_PER_DAY);
  await waitUntil(
    () => [...connection.db.tree_entity.iter()].some((row) => {
      const baseline = managedRecoveryBaseline.get(row.treeId);
      return baseline != null && row.growthProgress - baseline > naturalGrowthPerUpdate + 1e-6;
    }),
    'staffed reforester advances a felled tree faster than natural succession',
    {
      timeoutMs: 90_000,
      describe: () => `${describeTreeRecovery(connection, managedRecoveryBaseline)}; naturalFiveSecondDelta=${naturalGrowthPerUpdate.toFixed(6)}`,
    },
  );
  const reforesterRecoveryObservedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  const reforesterManagedGrowthDelta = maxTreeGrowthDelta(connection, managedRecoveryBaseline);

  // The quarry has already proved local stone extraction and accumulated the
  // opening material buffer. Rotate that worker into services/building so the
  // renewable timber path remains staffed while one founder stays available
  // for a physical residence project or cart.
  await callReducer(connection, 'assignBuildingLabor', 'assign_building_labor', {
    buildingId: requiredBuilding(connection, 'stone_quarry').id,
    labor: 0,
  });
  await waitUntil(
    () => requiredBuilding(connection, 'stone_quarry').assignedLabor === 0,
    'quarry worker release for Tier-2 preparation',
  );

  // Building the service outlet before promotion is legitimate preparation;
  // its Tier-2 goods remain physically absent at the promotion click. The
  // grain import is also valid Tier-1 food, and recurring renewable timber and
  // firewood exports pay for it before the future ale/cloth rules are enabled.
  await placeCompleteAndStaffBuilding(connection, 'tavern', 9_020, 14, 1);
  const tradingPost = requiredBuilding(connection, 'trading_post');
  for (const [resource, reserve] of [
    ['timber', 36],
    ['stone', 28],
    ['firewood', 18],
  ] as const) {
    await setTradingPostRule(connection, tradingPost.id, resource, TRADE_MODE_EXPORT, reserve);
  }
  await setTradingPostRule(
    connection,
    tradingPost.id,
    'ryeBread',
    TRADE_MODE_IMPORT,
    TIER_TWO_GRAIN_IMPORT_TARGET,
  );

  await waitUntil(
    () => newResidences(connection, beforeResidenceIds)
      .reduce((total, row) => total + row.population, 0) >= FOUNDERS_COUNT,
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
  await waitUntil(
    () => tierTwoFoodPreparationReady(connection, promotionCandidate.id),
    'recurring grain staple and local foraged category prepared for Tier 2',
    {
      timeoutMs: 120_000,
      describe: () => describeTierFoodPreparation(connection, promotionCandidate.id, 2),
    },
  );
  assert.equal(totalPhysicalCommodity(connection, 'ale'), 0, 'Tier 2 ale must be absent before Tier 1 promotion');
  assert.equal(totalPhysicalCommodity(connection, 'cloth'), 0, 'Tier 2 cloth must be absent before Tier 1 promotion');

  const promotionStarted = performance.now();
  const promotionStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
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
  const promotionEndedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  constructionTicks.tier1ToTier2 = promotionEndedTick - promotionStartedTick;
  console.log(JSON.stringify({
    checkpoint: 'Tier 1 to Tier 2 residence promotion',
    startTick: promotionStartedTick,
    endTick: promotionEndedTick,
    tickDelta: constructionTicks.tier1ToTier2,
    gameDays: constructionTicks.tier1ToTier2 * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY,
    realSeconds: constructionSeconds.tier1ToTier2,
  }));
  assert(
    constructionTicks.tier1ToTier2 <= MAX_RESIDENCE_UPGRADE_TICKS,
    `Tier 1 to Tier 2 took ${constructionTicks.tier1ToTier2} ticks; expected at most ${MAX_RESIDENCE_UPGRADE_TICKS}`,
  );
  assert.equal(totalPhysicalCommodity(connection, 'ale'), 0, 'promotion must not invent future-tier ale');
  assert.equal(totalPhysicalCommodity(connection, 'cloth'), 0, 'promotion must not invent future-tier cloth');

  await setTradingPostRule(connection, tradingPost.id, 'ale', TRADE_MODE_IMPORT, 6);
  await setTradingPostRule(connection, tradingPost.id, 'cloth', TRADE_MODE_IMPORT, 6);
  const tierTwoNeedsActivatedTick = promotionEndedTick;
  await waitUntil(
    () => tierNeedRecoveryState(connection, promotionCandidate.id, 2).ready,
    'all newly active Tier-2 needs recover physically',
    {
      timeoutMs: 120_000,
      describe: () => tierNeedRecoveryState(connection, promotionCandidate.id, 2).description,
    },
  );
  const tierTwoNeedsRecoveredTick = Number(worldConfig(connection)?.simTick ?? 0n);
  const serviceWarningTicks = Math.ceil(
    RESIDENCE_SERVICE_WARNING_DAYS * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
  );
  assert(
    tierTwoNeedsRecoveredTick - tierTwoNeedsActivatedTick <= serviceWarningTicks,
    `Tier-2 needs recovered in ${tierTwoNeedsRecoveredTick - tierTwoNeedsActivatedTick} ticks, after the ${serviceWarningTicks}-tick warning window`,
  );
  console.log(JSON.stringify({
    checkpoint: 'Tier-2 active-need recovery',
    activatedTick: tierTwoNeedsActivatedTick,
    recoveredTick: tierTwoNeedsRecoveredTick,
    tickDelta: tierTwoNeedsRecoveredTick - tierTwoNeedsActivatedTick,
    warningTicks: serviceWarningTicks,
    ...tierNeedRecoveryState(connection, promotionCandidate.id, 2).evidence,
  }));

  await setTradingPostRule(
    connection,
    tradingPost.id,
    'ironwork',
    TRADE_MODE_IMPORT,
    CHAPEL_TIER2_UPGRADE_IRONWORK,
  );
  await setTradingPostRule(
    connection,
    tradingPost.id,
    'roofTiles',
    TRADE_MODE_IMPORT,
    CHAPEL_TIER2_UPGRADE_ROOF_TILES,
  );
  await assignLaborWhenAvailable(connection, requiredBuilding(connection, 'stone_quarry'), 1);
  await waitUntil(
    () => tierThreeTransitionFundingReady(connection)
      && tierNeedRecoveryState(connection, promotionCandidate.id, 2).ready,
    'Tier-3 project and post-promotion chapel funding while current Tier-2 needs remain met',
    {
      timeoutMs: 180_000,
      describe: () => `${describeProgressionFunding(connection)}; ${tierNeedRecoveryState(connection, promotionCandidate.id, 2).description}`,
    },
  );
  await callReducer(connection, 'assignBuildingLabor', 'assign_building_labor', {
    buildingId: requiredBuilding(connection, 'stone_quarry').id,
    labor: 0,
  });
  await waitUntil(
    () => requiredBuilding(connection, 'stone_quarry').assignedLabor === 0,
    'quarry labor release before Tier-3 project',
  );

  assert.equal(totalPhysicalCommodity(connection, 'shoes'), 0, 'Tier 3 shoes must be absent before Tier 2 promotion');
  const tierTwoPromotionStarted = performance.now();
  const tierTwoPromotionStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
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
  const tierTwoPromotionEndedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  constructionTicks.tier2ToTier3 = tierTwoPromotionEndedTick - tierTwoPromotionStartedTick;
  console.log(JSON.stringify({
    checkpoint: 'Tier 2 to Tier 3 residence promotion',
    startTick: tierTwoPromotionStartedTick,
    endTick: tierTwoPromotionEndedTick,
    tickDelta: constructionTicks.tier2ToTier3,
    gameDays: constructionTicks.tier2ToTier3 * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY,
    realSeconds: constructionSeconds.tier2ToTier3,
  }));
  assert(
    constructionTicks.tier2ToTier3 <= MAX_RESIDENCE_UPGRADE_TICKS,
    `Tier 2 to Tier 3 took ${constructionTicks.tier2ToTier3} ticks; expected at most ${MAX_RESIDENCE_UPGRADE_TICKS}`,
  );
  assert.equal(totalPhysicalCommodity(connection, 'shoes'), 0, 'promotion must not invent future-tier shoes');
  assert.equal(
    requiredBuilding(connection, 'chapel').chapelTier,
    1,
    'Tier 2 promotion must not require or create the future Tier-2 chapel',
  );

  // Tier-3 needs activate only after the project completes. Import food and
  // shoes through ordinary recurring rules, then fund the level-2 chapel from
  // physically stored materials. Imported food must coexist at one serving
  // outlet and is never credited by global aggregate alone.
  for (const [resource, target] of [
    ['shoes', 12],
    ['meat', TIER_FOOD_IMPORT_TARGETS.meat],
    ['fish', TIER_FOOD_IMPORT_TARGETS.fish],
  ] as const) {
    await setTradingPostRule(connection, tradingPost.id, resource, TRADE_MODE_IMPORT, target);
  }
  await waitUntil(
    () => chapelUpgradeFundingReady(connection, 2),
    'pre-staged physical materials for the level-2 chapel after Tier-3 completion',
    {
      timeoutMs: 30_000,
      describe: () => describeProgressionFunding(connection),
    },
  );
  await callReducer(connection, 'upgradeChapel', 'upgrade_chapel', {
    buildingId: requiredBuilding(connection, 'chapel').id,
  });
  await waitUntil(
    () => requiredBuilding(connection, 'chapel').chapelTier === 2,
    'level-2 chapel replication',
  );

  const tierThreeNeedsActivatedTick = tierTwoPromotionEndedTick;
  await waitUntil(
    () => tierNeedRecoveryState(connection, promotionCandidate.id, 3).ready,
    'all newly active Tier-3 needs recover physically',
    {
      timeoutMs: 240_000,
      describe: () => tierNeedRecoveryState(connection, promotionCandidate.id, 3).description,
    },
  );
  const tierThreeNeedsRecoveredTick = Number(worldConfig(connection)?.simTick ?? 0n);
  assert(
    tierThreeNeedsRecoveredTick - tierThreeNeedsActivatedTick <= serviceWarningTicks,
    `Tier-3 needs recovered in ${tierThreeNeedsRecoveredTick - tierThreeNeedsActivatedTick} ticks, after the ${serviceWarningTicks}-tick warning window`,
  );
  console.log(JSON.stringify({
    checkpoint: 'Tier-3 active-need recovery',
    activatedTick: tierThreeNeedsActivatedTick,
    recoveredTick: tierThreeNeedsRecoveredTick,
    tickDelta: tierThreeNeedsRecoveredTick - tierThreeNeedsActivatedTick,
    warningTicks: serviceWarningTicks,
    ...tierNeedRecoveryState(connection, promotionCandidate.id, 3).evidence,
  }));

  assert.equal(totalPhysicalCommodity(connection, 'preservedFood'), 0, 'Tier 4 preserved food must be absent before Tier 3 promotion');
  assert.equal(totalPhysicalCommodity(connection, 'pottery'), 0, 'Tier 4 pottery must be absent before Tier 3 promotion');
  assert.equal(totalPhysicalCommodity(connection, 'honey'), 0, 'Tier 4 honey luxury must be absent before Tier 3 promotion');
  assert.equal(totalPhysicalCommodity(connection, 'wine'), 0, 'Tier 4 wine luxury must be absent before Tier 3 promotion');
  assert.equal(
    requiredBuilding(connection, 'chapel').chapelTier,
    2,
    'Tier 3 promotion must use the current Tier-3 level-2 chapel standard',
  );

  // Build the normal physical funding buffer for Tier 4. Stone labor is
  // rotated back only while the buffer is short, then released before the
  // residence click so one builder/cart slot remains attainable.
  await setTradingPostRule(
    connection,
    tradingPost.id,
    'roofTiles',
    TRADE_MODE_IMPORT,
    RESIDENCE_TILE_ROOF_TILE_COST + CHAPEL_TIER3_UPGRADE_ROOF_TILES,
  );
  await setTradingPostRule(
    connection,
    tradingPost.id,
    'ironwork',
    TRADE_MODE_IMPORT,
    CHAPEL_TIER3_UPGRADE_IRONWORK,
  );
  await assignLaborWhenAvailable(connection, requiredBuilding(connection, 'stone_quarry'), 1);
  await waitUntil(
    () => tierFourTransitionFundingReady(connection)
      && tierNeedRecoveryState(connection, promotionCandidate.id, 3).ready,
    'Tier-4 project and post-promotion chapel funding while current Tier-3 needs remain met',
    {
      timeoutMs: 240_000,
      describe: () => `${describeProgressionFunding(connection)}; ${tierNeedRecoveryState(connection, promotionCandidate.id, 3).description}`,
    },
  );
  await callReducer(connection, 'assignBuildingLabor', 'assign_building_labor', {
    buildingId: requiredBuilding(connection, 'stone_quarry').id,
    labor: 0,
  });
  await waitUntil(
    () => requiredBuilding(connection, 'stone_quarry').assignedLabor === 0,
    'quarry labor release before Tier-4 project',
  );

  const tierThreePromotionStarted = performance.now();
  const tierThreePromotionStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  await callReducer(connection, 'upgradeResidence', 'upgrade_residence', {
    residenceId: promotionCandidate.id,
  });
  await waitUntil(
    () => residenceById(connection, promotionCandidate.id)?.tier === 4,
    'Tier 3 to Tier 4 residence promotion',
    {
      timeoutMs: 180_000,
      describe: () => describeResidenceWithNeeds(connection, promotionCandidate.id),
    },
  );
  constructionSeconds.tier3ToTier4 = roundSeconds(performance.now() - tierThreePromotionStarted);
  const tierThreePromotionEndedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  constructionTicks.tier3ToTier4 = tierThreePromotionEndedTick - tierThreePromotionStartedTick;
  console.log(JSON.stringify({
    checkpoint: 'Tier 3 to Tier 4 residence promotion',
    startTick: tierThreePromotionStartedTick,
    endTick: tierThreePromotionEndedTick,
    tickDelta: constructionTicks.tier3ToTier4,
    gameDays: constructionTicks.tier3ToTier4 * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY,
    realSeconds: constructionSeconds.tier3ToTier4,
  }));
  assert(
    constructionTicks.tier3ToTier4 <= MAX_RESIDENCE_UPGRADE_TICKS,
    `Tier 3 to Tier 4 took ${constructionTicks.tier3ToTier4} ticks; expected at most ${MAX_RESIDENCE_UPGRADE_TICKS}`,
  );
  for (const commodity of ['preservedFood', 'pottery', 'honey', 'wine'] as const) {
    assert.equal(
      totalPhysicalCommodity(connection, commodity),
      0,
      `Tier 3 promotion must not invent future-tier ${commodity}`,
    );
  }

  // Activate the Tier-4 supply graph only after construction. Milk completes
  // the split animal-produce slot; preserved food, pottery, and honey cover
  // the distinct future-tier service rows. The level-3 chapel consumes its
  // own physically accumulated material upgrade through the public reducer.
  for (const [resource, target] of [
    ['milk', TIER_FOOD_IMPORT_TARGETS.milk],
    ['preservedFood', TIER_TWO_GRAIN_IMPORT_TARGET],
    ['pottery', 12],
    ['honey', 12],
  ] as const) {
    await setTradingPostRule(connection, tradingPost.id, resource, TRADE_MODE_IMPORT, target);
  }
  await waitUntil(
    () => chapelUpgradeFundingReady(connection, 3),
    'pre-staged physical materials for the level-3 chapel after Tier-4 completion',
    {
      timeoutMs: 30_000,
      describe: () => describeProgressionFunding(connection),
    },
  );
  await callReducer(connection, 'upgradeChapel', 'upgrade_chapel', {
    buildingId: requiredBuilding(connection, 'chapel').id,
  });
  await waitUntil(
    () => requiredBuilding(connection, 'chapel').chapelTier === 3,
    'level-3 chapel replication',
  );

  const tierFourNeedsActivatedTick = tierThreePromotionEndedTick;
  await waitUntil(
    () => tierNeedRecoveryState(connection, promotionCandidate.id, 4).ready,
    'all newly active Tier-4 needs recover physically',
    {
      timeoutMs: 300_000,
      describe: () => tierNeedRecoveryState(connection, promotionCandidate.id, 4).description,
    },
  );
  const tierFourNeedsRecoveredTick = Number(worldConfig(connection)?.simTick ?? 0n);
  assert(
    tierFourNeedsRecoveredTick - tierFourNeedsActivatedTick <= serviceWarningTicks,
    `Tier-4 needs recovered in ${tierFourNeedsRecoveredTick - tierFourNeedsActivatedTick} ticks, after the ${serviceWarningTicks}-tick warning window`,
  );
  console.log(JSON.stringify({
    checkpoint: 'Tier-4 active-need recovery',
    activatedTick: tierFourNeedsActivatedTick,
    recoveredTick: tierFourNeedsRecoveredTick,
    tickDelta: tierFourNeedsRecoveredTick - tierFourNeedsActivatedTick,
    warningTicks: serviceWarningTicks,
    ...tierNeedRecoveryState(connection, promotionCandidate.id, 4).evidence,
  }));

  assertFiniteNonNegativeState(connection);
  const finalResidences = newResidences(connection, beforeResidenceIds);
  return {
    stage: 'fresh world through legitimate Tier 4 and physical new-need recovery',
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
      reforesterConstructionStartedTick,
      reforesterRecoveryStartedTick,
      reforesterRecoveryObservedTick,
      reforesterRecoveryTicks: reforesterRecoveryObservedTick - reforesterRecoveryStartedTick,
      naturalGrowthPerUpdate,
      reforesterManagedGrowthDelta,
    },
    futureTierGoodsAbsentAtPromotion: [
      'ale',
      'cloth',
      'shoes',
      'preservedFood',
      'pottery',
      'honey',
      'wine',
    ],
    remainingAuthoritativeStages: [
      'sustain the Tier-4 household through a complete seasonal cycle',
      'repeat fixed constrained/trade-fallback and seasonal-distance configurations',
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
  await waitUntil(() => buildingByKind(connection, kind) != null, `${kind} worksite replication`);
  await assignConstructionBuilderWhenNeeded(connection, requiredBuilding(connection, kind));
  await waitUntil(
    () => Boolean(buildingByKind(connection, kind)?.constructionComplete),
    `${kind} construction completion`,
    {
      timeoutMs: 180_000,
      describe: () => describeBuilding(buildingByKind(connection, kind)),
    },
  );
  if (labor > 0) {
    await assignLaborWhenAvailable(connection, requiredBuilding(connection, kind), labor);
  }
  await waitUntil(
    () => buildingByKind(connection, kind)?.assignedLabor === labor,
    `${kind} staffing replication`,
  );
}

async function assignConstructionBuilderWhenNeeded(
  connection: DbConnection,
  worksite: Building,
): Promise<void> {
  const current = buildingById(connection, worksite.id);
  if (!current || current.constructionComplete || current.assignedLabor > 0) return;
  const waitStarted = performance.now();
  const waitStartedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  await assignLaborWhenAvailable(connection, current, 1);
  await waitUntil(
    () => {
      const replicated = buildingById(connection, worksite.id);
      return Boolean(replicated?.constructionComplete || (replicated?.assignedLabor ?? 0) > 0);
    },
    `${current.kind} construction-builder assignment replication`,
  );
  const waitEndedTick = Number(worldConfig(connection)?.simTick ?? 0n);
  console.log(JSON.stringify({
    checkpoint: `${current.kind} construction builder remedy`,
    startTick: waitStartedTick,
    endTick: waitEndedTick,
    tickDelta: waitEndedTick - waitStartedTick,
    realSeconds: roundSeconds(performance.now() - waitStarted),
  }));
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

function settlementFoodBufferTarget(
  commodity: 'meat' | 'fish' | 'milk',
): number {
  return Math.ceil(
    householdFoodPerDay(FOUNDERS_COUNT)
      * TIER_TWO_GRAIN_BUFFER_DAYS
      / foodMealValue(commodity),
  );
}

type ProgressionMaterial = 'timber' | 'stone' | 'ironwork' | 'roofTiles';

function availableProgressionMaterial(
  connection: DbConnection,
  commodity: ProgressionMaterial,
): number {
  const buildings = [...connection.db.building.iter()];
  const ledger = [...connection.db.player_resources.iter()]
    .reduce((total, row) => total + row[commodity], 0);
  const stored = buildings.reduce((total, row) => total + row[commodity], ledger);
  const constructionReserved = buildings.reduce((total, row) => {
    if (row.constructionComplete) return total;
    if (commodity === 'timber') return total + row.constructionReservedTimber;
    if (commodity === 'stone') return total + row.constructionReservedStone;
    if (commodity === 'ironwork') return total + row.constructionReservedIronwork;
    return total + row.constructionReservedRoofTiles;
  }, 0);
  const residenceReserved = [...connection.db.residence.iter()].reduce((total, row) => {
    if (commodity === 'timber') return total + row.upgradeReservedTimber;
    if (commodity === 'stone') return total + row.upgradeReservedStone;
    if (commodity === 'roofTiles') return total + row.upgradeReservedRoofTiles;
    return total;
  }, 0);
  return Math.max(0, stored - constructionReserved - residenceReserved);
}

function progressionTreasuryGold(connection: DbConnection): number {
  const resources = [...connection.db.player_resources.iter()][0];
  const ledgerGold = resources && !resources.physicalFoundingSiteEnabled
    ? Math.max(0, resources.gold)
    : 0;
  const physicalGold = [...connection.db.building.iter()]
    .filter((building) => building.constructionComplete
      && ['founders_camp', 'salvage_pile', 'town_hall'].includes(building.kind))
    .reduce((total, building) => total + Math.max(0, building.gold), ledgerGold);
  const reserved = [...connection.db.residence.iter()]
    .reduce((total, residence) => total + Math.max(0, residence.upgradeReservedGold), 0);
  return Math.max(0, physicalGold - reserved);
}

function chapelUpgradeFundingReady(
  connection: DbConnection,
  targetTier: 2 | 3,
): boolean {
  const costs = targetTier === 2
    ? {
        timber: CHAPEL_TIER2_UPGRADE_TIMBER,
        stone: CHAPEL_TIER2_UPGRADE_STONE,
        ironwork: CHAPEL_TIER2_UPGRADE_IRONWORK,
        roofTiles: CHAPEL_TIER2_UPGRADE_ROOF_TILES,
      }
    : {
        timber: CHAPEL_TIER3_UPGRADE_TIMBER,
        stone: CHAPEL_TIER3_UPGRADE_STONE,
        ironwork: CHAPEL_TIER3_UPGRADE_IRONWORK,
        roofTiles: CHAPEL_TIER3_UPGRADE_ROOF_TILES,
      };
  return (Object.entries(costs) as [ProgressionMaterial, number][])
    .every(([commodity, required]) =>
      availableProgressionMaterial(connection, commodity) + 1e-6 >= required);
}

function tierThreeTransitionFundingReady(connection: DbConnection): boolean {
  return availableProgressionMaterial(connection, 'timber') + 1e-6
      >= RESIDENCE_TIER3_TIMBER_COST + CHAPEL_TIER2_UPGRADE_TIMBER
    && availableProgressionMaterial(connection, 'stone') + 1e-6
      >= RESIDENCE_TIER3_STONE_COST + CHAPEL_TIER2_UPGRADE_STONE
    && availableProgressionMaterial(connection, 'ironwork') + 1e-6
      >= CHAPEL_TIER2_UPGRADE_IRONWORK
    && availableProgressionMaterial(connection, 'roofTiles') + 1e-6
      >= CHAPEL_TIER2_UPGRADE_ROOF_TILES
    && progressionTreasuryGold(connection) + 1e-6 >= RESIDENCE_TIER3_GOLD_COST;
}

function tierFourTransitionFundingReady(connection: DbConnection): boolean {
  return availableProgressionMaterial(connection, 'timber') + 1e-6
      >= RESIDENCE_TIER4_TIMBER_COST + CHAPEL_TIER3_UPGRADE_TIMBER
    && availableProgressionMaterial(connection, 'stone') + 1e-6
      >= RESIDENCE_TIER4_STONE_COST + CHAPEL_TIER3_UPGRADE_STONE
    && availableProgressionMaterial(connection, 'ironwork') + 1e-6
      >= CHAPEL_TIER3_UPGRADE_IRONWORK
    && availableProgressionMaterial(connection, 'roofTiles') + 1e-6
      >= RESIDENCE_TILE_ROOF_TILE_COST + CHAPEL_TIER3_UPGRADE_ROOF_TILES
    && progressionTreasuryGold(connection) + 1e-6 >= RESIDENCE_TIER4_GOLD_COST;
}

function describeProgressionFunding(connection: DbConnection): string {
  return `funding[timber=${availableProgressionMaterial(connection, 'timber').toFixed(2)},stone=${availableProgressionMaterial(connection, 'stone').toFixed(2)},ironwork=${availableProgressionMaterial(connection, 'ironwork').toFixed(2)},roofTiles=${availableProgressionMaterial(connection, 'roofTiles').toFixed(2)},treasuryGold=${progressionTreasuryGold(connection).toFixed(2)}], chapelTier=${buildingByKind(connection, 'chapel')?.chapelTier ?? 'missing'}`;
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

function tierTwoFoodPreparationReady(
  connection: DbConnection,
  residenceId: bigint,
): boolean {
  const residence = residenceById(connection, residenceId);
  const marketplace = buildingByKind(connection, 'marketplace');
  if (!residence || !marketplace) return false;
  const household = foodProgressionStatus(residence, residence.population, 2);
  // This deterministic scenario has one Marketplace and a single connected
  // straight-road component. Keep the serving outlet's inventory whole: food
  // categories may not be combined across the household and Marketplace.
  const servingOutlet = foodProgressionStatus(marketplace, residence.population, 2);
  return household.ready || servingOutlet.ready;
}

function describeTierFoodPreparation(
  connection: DbConnection,
  residenceId: bigint,
  tier: 2 | 3 | 4,
): string {
  const residence = residenceById(connection, residenceId);
  const marketplace = buildingByKind(connection, 'marketplace');
  const post = buildingByKind(connection, 'trading_post');
  const granary = buildingByKind(connection, 'granary');
  if (!residence || !marketplace || !post || !granary) {
    return 'required pantry, serving outlet, trade post, or granary absent';
  }
  const household = foodProgressionStatus(residence, residence.population, tier);
  const servingOutlet = foodProgressionStatus(marketplace, residence.population, tier);
  const watchedFoodCargoKinds = new Set<number>([
    TRADE_RESOURCE_COMMODITY_CODES.ryeBread,
    TRADE_RESOURCE_COMMODITY_CODES.berries,
    TRADE_RESOURCE_COMMODITY_CODES.mushrooms,
    TRADE_RESOURCE_COMMODITY_CODES.meat,
    TRADE_RESOURCE_COMMODITY_CODES.fish,
    TRADE_RESOURCE_COMMODITY_CODES.milk,
    TRADE_RESOURCE_COMMODITY_CODES.preservedFood,
  ]);
  const foodTrips = [...connection.db.delivery_trip.iter()]
    .filter((trip) => watchedFoodCargoKinds.has(trip.cargoKind))
    .map((trip) => `#${trip.id}:${trip.buildingId}->${trip.targetBuildingId}/kind${trip.cargoKind}/${deliveryPhase(trip.phase)}/${trip.amount.toFixed(2)}`)
    .join(',');
  return `foodTier=${tier}, grainTarget=${TIER_TWO_GRAIN_IMPORT_TARGET} (${TIER_TWO_GRAIN_BUFFER_DAYS} settlement days); homeFood=${JSON.stringify(household)}; marketFood=${JSON.stringify(servingOutlet)}; home[pop=${residence.population},food=${residence.food.toFixed(2)},oats=${residence.oatGrain.toFixed(2)},ryeBread=${residence.ryeBread.toFixed(2)},maslinBread=${residence.maslinBread.toFixed(2)},berries=${residence.berries.toFixed(2)},mushrooms=${residence.mushrooms.toFixed(2)},meat=${residence.meat.toFixed(2)},fish=${residence.fish.toFixed(2)},milk=${residence.milk.toFixed(2)},aronia=${residence.aronia.toFixed(2)},rosehips=${residence.rosehips.toFixed(2)}], market[food=${marketplace.food.toFixed(2)},oats=${marketplace.oatGrain.toFixed(2)},ryeBread=${marketplace.ryeBread.toFixed(2)},maslinBread=${marketplace.maslinBread.toFixed(2)},berries=${marketplace.berries.toFixed(2)},mushrooms=${marketplace.mushrooms.toFixed(2)},meat=${marketplace.meat.toFixed(2)},fish=${marketplace.fish.toFixed(2)},milk=${marketplace.milk.toFixed(2)}], granary[food=${granary.food.toFixed(2)},oats=${granary.oatGrain.toFixed(2)},ryeBread=${granary.ryeBread.toFixed(2)},maslinBread=${granary.maslinBread.toFixed(2)},berries=${granary.berries.toFixed(2)},mushrooms=${granary.mushrooms.toFixed(2)},meat=${granary.meat.toFixed(2)},fish=${granary.fish.toFixed(2)},milk=${granary.milk.toFixed(2)}], post[gold=${post.gold.toFixed(2)},ryeBread=${post.ryeBread.toFixed(2)},meat=${post.meat.toFixed(2)},fish=${post.fish.toFixed(2)},milk=${post.milk.toFixed(2)}], foodTrips=${foodTrips || 'none'}`;
}

function tierNeedRecoveryState(
  connection: DbConnection,
  residenceId: bigint,
  tier: 2 | 3 | 4,
): {
  ready: boolean;
  description: string;
  evidence: Record<string, unknown>;
} {
  const activeNeedKinds = activeResidenceNeedKinds(tier);
  const activeNeedIds = activeNeedKinds.map((kind) => RESIDENCE_NEED_KIND_IDS[kind]);
  const needs = [...connection.db.residence_need.iter()]
    .filter((row) => row.residenceId === residenceId);
  const byKind = new Map(needs.map((row) => [row.needKind, row]));
  const missingNeedIds = activeNeedIds.filter((kind) => !byKind.has(kind));
  const deficitNeedIds = activeNeedIds.filter((kind) => (byKind.get(kind)?.deficitTicks ?? 1) > 0);
  const requiredFoodSlots = foodProgressionStatus({}, 1, tier).requiredSlots.length;
  const foodVarietyStock = byKind.get(RESIDENCE_NEED_KIND_IDS.foodVariety)?.stock ?? 0;
  const churchTier = byKind.get(RESIDENCE_NEED_KIND_IDS.church)?.stock ?? 0;
  const requiredChurchTier = requiredChapelTierForResidence(tier);
  const tavern = buildingByKind(connection, 'tavern');
  const marketplace = buildingByKind(connection, 'marketplace');
  const aleNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.ale)?.stock ?? 0;
  const clothNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.cloth)?.stock ?? 0;
  const shoesNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.shoes)?.stock ?? 0;
  const preservedNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.preservedFood)?.stock ?? 0;
  const potteryNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.pottery)?.stock ?? 0;
  const luxuryNeedStock = byKind.get(RESIDENCE_NEED_KIND_IDS.luxury)?.stock ?? 0;
  const aleOutletStock = tavern
    ? tavern.ale + tavern.cider + tavern.pearCider + tavern.mead
    : 0;
  const clothOutletStock = marketplace?.cloth ?? 0;
  const shoesOutletStock = marketplace?.shoes ?? 0;
  const preservedOutletStock = marketplace
    ? marketplace.preservedFood + marketplace.curedMeat + marketplace.smokedFish
      + marketplace.cheese + marketplace.aroniaJam + marketplace.rosehipJam
    : 0;
  const potteryOutletStock = marketplace?.pottery ?? 0;
  const luxuryOutletStock = marketplace
    ? marketplace.candles + marketplace.wine + marketplace.honey
    : 0;
  const physicalTierTwoNeedsReady = (aleNeedStock > 1e-6 || aleOutletStock > 1e-6)
    && (clothNeedStock > 1e-6 || clothOutletStock > 1e-6);
  const physicalTierThreeNeedsReady = tier < 3
    || shoesNeedStock > 1e-6
    || shoesOutletStock > 1e-6;
  const physicalTierFourNeedsReady = tier < 4
    || ((preservedNeedStock > 1e-6 || preservedOutletStock > 1e-6)
      && (potteryNeedStock > 1e-6 || potteryOutletStock > 1e-6)
      && (luxuryNeedStock > 1e-6 || luxuryOutletStock > 1e-6));
  const ready = missingNeedIds.length === 0
    && deficitNeedIds.length === 0
    && foodVarietyStock + 1e-6 >= requiredFoodSlots
    && churchTier + 1e-6 >= requiredChurchTier
    && physicalTierTwoNeedsReady
    && physicalTierThreeNeedsReady
    && physicalTierFourNeedsReady;
  const evidence = {
    tier,
    activeNeedKinds,
    activeNeedIds,
    missingNeedIds,
    deficitNeedIds,
    foodVarietyStock,
    requiredFoodSlots,
    churchTier,
    requiredChurchTier,
    aleNeedStock,
    aleOutletStock,
    clothNeedStock,
    clothOutletStock,
    shoesNeedStock,
    shoesOutletStock,
    preservedNeedStock,
    preservedOutletStock,
    potteryNeedStock,
    potteryOutletStock,
    luxuryNeedStock,
    luxuryOutletStock,
  };
  return {
    ready,
    description: `${JSON.stringify(evidence)}; ${describeResidenceWithNeeds(connection, residenceId)}; ${describeTierFoodPreparation(connection, residenceId, tier)}`,
    evidence,
  };
}

function describeTreeRecovery(
  connection: DbConnection,
  baseline: ReadonlyMap<string, number>,
): string {
  const tracked = [...connection.db.tree_entity.iter()]
    .filter((row) => baseline.has(row.treeId));
  const progressed = tracked.filter((row) =>
    row.growthProgress > (baseline.get(row.treeId) ?? row.growthProgress) + 1e-6,
  );
  const maxDelta = tracked.reduce(
    (maximum, row) => Math.max(maximum, row.growthProgress - (baseline.get(row.treeId) ?? 0)),
    0,
  );
  return `tracked=${tracked.length}, progressed=${progressed.length}, maxDelta=${maxDelta.toFixed(4)}, phases=${tracked.map((row) => `${row.treeId}:${row.phase}/${row.growthProgress.toFixed(3)}`).join(',')}`;
}

function maxTreeGrowthDelta(
  connection: DbConnection,
  baseline: ReadonlyMap<string, number>,
): number {
  return [...connection.db.tree_entity.iter()]
    .filter((row) => baseline.has(row.treeId))
    .reduce(
      (maximum, row) => Math.max(maximum, row.growthProgress - (baseline.get(row.treeId) ?? 0)),
      0,
    );
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
  type AuthoritativeTable = {
    iter(): Iterable<Record<string, unknown>>;
  };
  const tables: readonly (readonly [string, AuthoritativeTable])[] = [
    ['world_config', connection.db.world_config as unknown as AuthoritativeTable],
    ['player_resources', connection.db.player_resources as unknown as AuthoritativeTable],
    ['market_state', connection.db.market_state as unknown as AuthoritativeTable],
    ['trading_post_trade_rule', connection.db.trading_post_trade_rule as unknown as AuthoritativeTable],
    ['quarry', connection.db.quarry as unknown as AuthoritativeTable],
    ['foraging_node', connection.db.foraging_node as unknown as AuthoritativeTable],
    ['tree_entity', connection.db.tree_entity as unknown as AuthoritativeTable],
    ['building', connection.db.building as unknown as AuthoritativeTable],
    ['farm_field', connection.db.farm_field as unknown as AuthoritativeTable],
    ['pasture', connection.db.pasture as unknown as AuthoritativeTable],
    ['vineyard_parcel', connection.db.vineyard_parcel as unknown as AuthoritativeTable],
    ['graveyard', connection.db.graveyard as unknown as AuthoritativeTable],
    ['corpse', connection.db.corpse as unknown as AuthoritativeTable],
    ['pasture_herd', connection.db.pasture_herd as unknown as AuthoritativeTable],
    // Compatibility rows may exist only until save migration can materialize
    // them into a linked pasture. Keep auditing them, but do not treat this as
    // the active livestock table.
    ['legacy_livestock_herd', connection.db.livestock_herd as unknown as AuthoritativeTable],
    ['burgage_zone', connection.db.burgage_zone as unknown as AuthoritativeTable],
    ['residence', connection.db.residence as unknown as AuthoritativeTable],
    ['backyard_garden', connection.db.backyard_garden as unknown as AuthoritativeTable],
    ['residence_need', connection.db.residence_need as unknown as AuthoritativeTable],
    ['delivery_trip', connection.db.delivery_trip as unknown as AuthoritativeTable],
    ['fire_incident', connection.db.fire_incident as unknown as AuthoritativeTable],
    ['combat_agent', connection.db.combat_agent as unknown as AuthoritativeTable],
    ['active_raid', connection.db.active_raid as unknown as AuthoritativeTable],
    ['settlement_security', connection.db.settlement_security as unknown as AuthoritativeTable],
    ['road_network_state', connection.db.road_network_state as unknown as AuthoritativeTable],
  ];

  for (const [tableName, table] of tables) {
    let rowIndex = 0;
    for (const row of table.iter()) {
      for (const [field, value] of Object.entries(row)) {
        const label = `${tableName}[${rowIndex}].${field}`;
        if (typeof value === 'number') {
          assert(Number.isFinite(value), `${label} must be finite, got ${value}`);
          if (!signedAuthoritativeNumericField(field)) {
            assert(value >= -1e-6, `${label} must be non-negative, got ${value}`);
          }
        } else if (typeof value === 'bigint') {
          assert(value >= 0n, `${label} must be non-negative, got ${value}`);
        }
      }
      rowIndex += 1;
    }
  }
}

function signedAuthoritativeNumericField(field: string): boolean {
  // World/cart geometry is intentionally signed and is not an economy stock,
  // timer, capacity, reservation, rate, population, or progress value.
  return field === 'yaw'
    || field === 'raidApproachOffset'
    || field === 'x'
    || field === 'z'
    || /(?:X|Z|Ax|Az|Bx|Bz|Cx|Cz|Dx|Dz)$/.test(field);
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
