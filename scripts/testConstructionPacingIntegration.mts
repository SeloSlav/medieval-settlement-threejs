import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import type { DbConnection } from '../src/generated/index.ts';
import type { Building, DeliveryTrip } from '../src/generated/types.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';
import {
  CALENDAR_SECONDS_PER_DAY,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  DEFAULT_SPACETIME_URI,
  assertSpacetimeServerAvailable,
  callReducer,
  connectAndSubscribe,
  resolveSpacetimeExecutable,
  runCommand,
  waitUntil,
} from './lib/spacetimeIntegrationHarness.mts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const MODULE_PATH = join(PROJECT_ROOT, 'server');
const DATABASE_PREFIX = 'selo-construction-benchmark-';
const uri = process.env.SELO_CONSTRUCTION_BENCHMARK_URI?.trim() || DEFAULT_SPACETIME_URI;
const cliArgs = process.argv.slice(2);
const suppliedDatabase = cliArgs.find((value) => !value.startsWith('--'))?.trim()
  || process.env.SELO_CONSTRUCTION_BENCHMARK_DB?.trim();
const ownsDatabase = !suppliedDatabase;
const databaseName = suppliedDatabase || disposableDatabaseName();
const keepDatabase = process.env.SELO_CONSTRUCTION_BENCHMARK_KEEP_DB === '1';
const repetitions = boundedInteger(
  cliValue('samples') ?? process.env.SELO_CONSTRUCTION_BENCHMARK_SAMPLES,
  3,
  1,
  12,
);
const maxSampleSimSeconds = boundedInteger(
  cliValue('timeout-sim-seconds')
    ?? process.env.SELO_CONSTRUCTION_BENCHMARK_TIMEOUT_SIM_SECONDS,
  900,
  120,
  2_400,
);
const spacetime = resolveSpacetimeExecutable();

const SPEEDS = [8, 4, 1] as const;
const ROUTES = [
  { id: 'near', alongRoadMeters: 40 },
  { id: 'medium', alongRoadMeters: 120 },
  { id: 'far', alongRoadMeters: 220 },
] as const;
const PROJECTS = [
  { kind: 'well', class: 'core-service', z: 14, nearGateDays: 1 },
  { kind: 'village_storehouse', class: 'ordinary', z: -16, nearGateDays: 2 },
] as const;

type Speed = (typeof SPEEDS)[number];
type RouteCase = (typeof ROUTES)[number];
type ProjectCase = (typeof PROJECTS)[number];

const selectedSpeeds = selectCases(
  SPEEDS,
  cliValue('speeds') ?? process.env.SELO_CONSTRUCTION_BENCHMARK_SPEEDS,
  (speed) => String(speed),
  'speed',
);
const selectedRoutes = selectCases(
  ROUTES,
  cliValue('routes') ?? process.env.SELO_CONSTRUCTION_BENCHMARK_ROUTES,
  (route) => route.id,
  'route',
);

type Moment = {
  tick: number;
  realMs: number;
};

type LedgerEvent = Moment & {
  progress: number;
  labor: number;
  deliveredTimber: number;
  deliveredStone: number;
  deliveredIronwork: number;
  deliveredRoofTiles: number;
};

type TripTrace = {
  id: bigint;
  cargoKind: number;
  amountAtDispatch: number;
  pathDistance: number;
  deliveryWorkers: number;
  phase: number;
  currentAmount: number;
  dispatched: Moment;
  arrived?: Moment;
  unloaded?: Moment;
  returned?: Moment;
};

type SiteTrace = {
  key: string;
  repetition: number;
  seed: bigint;
  speed: Speed;
  route: RouteCase;
  project: ProjectCase;
  click: Moment;
  inserted?: Moment;
  siteId?: bigint;
  firstDispatch?: Moment;
  materialReady?: Moment;
  firstWork?: Moment;
  firstWorkAfterMaterialReady?: Moment;
  completion?: Moment;
  finalRow?: Building;
  trips: Map<bigint, TripTrace>;
  ledger: LedgerEvent[];
  peakActiveCarts: number;
  peakApproachingCarts: number;
};

type SiteResult = {
  key: string;
  repetition: number;
  seed: string;
  speed: Speed;
  route: RouteCase['id'];
  project: ProjectCase['kind'];
  projectClass: ProjectCase['class'];
  clickTick: number;
  completionTick: number;
  clickToCompletionTicks: number;
  clickToCompletionSimSeconds: number;
  clickToCompletionRealSeconds: number;
  clickToDispatchTicks: number | null;
  clickToDispatchRealSeconds: number | null;
  dispatchToFirstArrivalTicks: number | null;
  dispatchToFirstArrivalRealSeconds: number | null;
  firstArrivalToUnloadTicks: number | null;
  firstArrivalToUnloadRealSeconds: number | null;
  clickToMaterialReadyTicks: number | null;
  clickToMaterialReadyRealSeconds: number | null;
  materialReadyToWorkTicks: number | null;
  materialReadyToWorkRealSeconds: number | null;
  clickToFirstWorkTicks: number | null;
  clickToFirstWorkRealSeconds: number | null;
  firstWorkToCompletionTicks: number | null;
  firstWorkToCompletionRealSeconds: number | null;
  materialReadyToCompletionTicks: number | null;
  materialReadyToCompletionRealSeconds: number | null;
  routeMetersMin: number | null;
  routeMetersP50: number | null;
  routeMetersMax: number | null;
  tripCount: number;
  peakActiveCarts: number;
  peakApproachingCarts: number;
  meanTravelTicks: number | null;
  meanUnloadTicks: number | null;
  cargoLoads: Array<{ cargoKind: number; amount: number }>;
  atomicCompletion: boolean;
  gateMisses: string[];
};

type FailureResult = {
  repetition: number;
  seed: string;
  speed: Speed;
  route: RouteCase['id'];
  message: string;
  diagnostics: string;
};

validateDatabaseName(databaseName, ownsDatabase);
assert(existsSync(MODULE_PATH), `SpacetimeDB module path is missing: ${MODULE_PATH}`);

let connection: DbConnection | undefined;
let databasePublished = false;
const results: SiteResult[] = [];
const failures: FailureResult[] = [];

async function main(): Promise<void> {
try {
  await assertSpacetimeServerAvailable(uri);
  if (ownsDatabase) {
    console.log(`Publishing disposable construction benchmark database ${databaseName}...`);
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

  connection = await connectAndSubscribe(databaseName, GAME_TABLE_SUBSCRIPTIONS, uri);
  const observer = new ConstructionBenchmarkObserver(connection);
  let aborted = false;

  for (const speed of selectedSpeeds) {
    if (aborted) break;
    for (const route of selectedRoutes) {
      if (aborted) break;
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        if (aborted) break;
        const seed = BigInt(530_000 + speed * 1_000 + route.alongRoadMeters + repetition);
        await prepareFreshWorld(connection, speed, seed, repetition);
        observer.beginRun();
        const runStarted = performance.now();

        try {
          const traces: SiteTrace[] = [];
          for (const project of PROJECTS) {
            const trace = observer.expectPlacement({
              repetition,
              seed,
              speed,
              route,
              project,
            });
            traces.push(trace);
            await callReducer(connection, 'placeBuilding', 'place_building', {
              kind: project.kind,
              x: 8_650 + route.alongRoadMeters,
              z: project.z,
            });
            await waitUntil(
              () => trace.siteId != null,
              `${trace.key} site insertion`,
              { timeoutMs: 5_000, describe: () => observer.describe(trace) },
            );
          }

          await waitForPairedCompletion(
            connection,
            traces,
            `${route.id}/${speed}x/repetition-${repetition} paired atomic completion`,
            sampleTimeoutMs(speed),
          );

          const runResults = traces.map((trace) => observer.result(trace));
          results.push(...runResults);
          console.log(JSON.stringify({
            checkpoint: 'construction-pacing-sample',
            repetition,
            sampleCount: repetitions,
            seed: seed.toString(),
            speed,
            route: route.id,
            elapsedRealSeconds: round((performance.now() - runStarted) / 1_000),
            projects: runResults.map(compactSampleLog),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const diagnostics = observer.describeRun();
          failures.push({
            repetition,
            seed: seed.toString(),
            speed,
            route: route.id,
            message,
            diagnostics,
          });
          console.error(JSON.stringify({
            checkpoint: 'construction-pacing-failure',
            repetition,
            seed: seed.toString(),
            speed,
            route: route.id,
            message,
            diagnostics,
          }));
          // One truthful timeout is enough to invalidate percentile coverage;
          // avoid spending further minutes pretending the remaining matrix is valid.
          aborted = true;
        } finally {
          observer.endRun();
        }
      }
    }
  }

  const summaries = summarizeResults(results);
  const evidence = {
    databaseName,
    contract: {
      publicActionsOnly: [
        'reset_world',
        'configure_world',
        'bootstrap_trees',
        'bootstrap_quarries',
        'bootstrap_foraging',
        'sync_road_network',
        'place_building',
        'set_game_speed',
        'enter_world',
      ],
      noDirectStockOrTableMutation: true,
      pairedProjects: PROJECTS.map(({ kind, class: projectClass }) => ({ kind, projectClass })),
      pairingTradeoff: 'Well and Village Storehouse are clicked back-to-back in each fresh world. This halves benchmark runtime and deliberately measures realistic shared cart/builder contention; it is not an isolated-project lower bound.',
      percentileMethod: 'nearest-rank; with the default three deterministic repetitions P95 is the observed worst sample',
      assertionPolicy: 'Missing/invalid authoritative transitions, non-atomic completion, absent carts/routes, and observation-ceiling failures are fatal. Product pacing-gate misses are emitted as evidence and intentionally remain non-fatal until the tuning checkpoint.',
      observationCeiling: '900 simulated seconds by default, enforced from the authoritative sim tick equally at every speed; the derived wall timeout adds 30 seconds only as a paused-server safety guard',
      repetitions,
      selectedSpeeds,
      selectedRoutes: selectedRoutes.map((route) => route.id),
      expectedCompletedSamples: selectedSpeeds.length * selectedRoutes.length * PROJECTS.length * repetitions,
      maxSampleSimSeconds,
      maxSampleRealSecondsBySpeed: Object.fromEntries(
        selectedSpeeds.map((speed) => [speed, round(sampleTimeoutMs(speed) / 1_000)]),
      ),
    },
    summaries,
    gateMisses: results.flatMap((result) =>
      result.gateMisses.map((message) => ({ key: result.key, message })),
    ),
    failures,
    samples: results,
  };
  console.log(JSON.stringify(evidence, null, 2));

  const expectedResults = selectedSpeeds.length * selectedRoutes.length * PROJECTS.length * repetitions;
  assert.equal(failures.length, 0, `construction benchmark failures:\n${formatFailures(failures)}`);
  assert.equal(
    results.length,
    expectedResults,
    `expected ${expectedResults} completed construction samples, received ${results.length}`,
  );
  for (const result of results) {
    assert(result.atomicCompletion, `${result.key} did not finish atomically`);
    assert(result.tripCount > 0, `${result.key} completed without a physical construction cart`);
    assert(result.routeMetersMin != null && result.routeMetersMin > 0, `${result.key} has no route length`);
    assertFiniteNonNegative(`${result.key} real completion`, result.clickToCompletionRealSeconds);
    assertFiniteNonNegative(`${result.key} sim completion`, result.clickToCompletionSimSeconds);
  }
  console.log(
    `authoritative construction pacing benchmark passed (${results.length} project samples; ${repetitions} repetitions per route/speed/project cell)`,
  );
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
    console.log(`Deleting disposable construction benchmark database ${databaseName}...`);
    await runCommand(
      spacetime,
      ['delete', '--no-config', '--server', uri, databaseName, '--yes'],
      { cwd: PROJECT_ROOT, quiet: true },
    );
  } else if (databasePublished) {
    console.log(`Kept disposable database ${databaseName} for inspection.`);
  }
}
}

class ConstructionBenchmarkObserver {
  private active: SiteTrace[] = [];

  constructor(private readonly connection: DbConnection) {
    connection.db.building.onInsert((_context, row) => this.onBuildingInsert(row));
    connection.db.building.onUpdate((_context, oldRow, row) => this.onBuildingUpdate(oldRow, row));
    connection.db.delivery_trip.onInsert((_context, row) => this.onTripInsert(row));
    connection.db.delivery_trip.onUpdate((_context, oldRow, row) => this.onTripUpdate(oldRow, row));
    connection.db.delivery_trip.onDelete((_context, row) => this.onTripDelete(row));
  }

  beginRun(): void {
    assert.equal(this.active.length, 0, 'previous construction benchmark run is still active');
  }

  expectPlacement(input: {
    repetition: number;
    seed: bigint;
    speed: Speed;
    route: RouteCase;
    project: ProjectCase;
  }): SiteTrace {
    const trace: SiteTrace = {
      key: `${input.project.kind}/${input.route.id}/${input.speed}x/r${input.repetition}`,
      ...input,
      click: this.moment(),
      trips: new Map(),
      ledger: [],
      peakActiveCarts: 0,
      peakApproachingCarts: 0,
    };
    this.active.push(trace);
    return trace;
  }

  endRun(): void {
    this.active = [];
  }

  describeRun(): string {
    const camp = buildingByKind(this.connection, 'founders_camp');
    const source = camp
      ? `source-camp(T=${camp.timber.toFixed(1)},S=${camp.stone.toFixed(1)},labor=${camp.assignedLabor})`
      : 'source-camp=missing';
    return `${source}; ${this.active.map((trace) => this.describe(trace)).join(' || ') || 'no active sites'}`;
  }

  describe(trace: SiteTrace): string {
    const row = trace.siteId == null ? undefined : buildingById(this.connection, trace.siteId);
    const trips = [...trace.trips.values()].map((trip) =>
      `#${trip.id} cargo=${trip.cargoKind}/${trip.currentAmount.toFixed(1)}`
      + ` phase=${trip.phase} route=${trip.pathDistance.toFixed(1)}m`,
    ).join(' | ');
    const config = worldConfig(this.connection);
    return `${trace.key}: tick=${config?.simTick ?? 'missing'}, speed=${config?.gameSpeed ?? 'missing'}, `
      + `${row ? describeBuilding(row) : 'site row absent'}, `
      + `${row ? `reserved(T=${row.constructionReservedTimber.toFixed(1)},S=${row.constructionReservedStone.toFixed(1)}), ` : ''}`
      + `peak-active=${trace.peakActiveCarts}, peak-approaching=${trace.peakApproachingCarts}, `
      + `trips=[${trips || 'none'}]`;
  }

  result(trace: SiteTrace): SiteResult {
    assert(trace.siteId != null, `${trace.key} never inserted`);
    const finalRow = trace.finalRow ?? buildingById(this.connection, trace.siteId);
    assert(finalRow, `${trace.key} final row is missing`);
    assert(trace.completion, `${trace.key} completion moment is missing`);

    const trips = [...trace.trips.values()];
    const routes = trips.map((trip) => trip.pathDistance).filter(Number.isFinite);
    const travelTicks = trips
      .filter((trip) => trip.arrived)
      .map((trip) => trip.arrived!.tick - trip.dispatched.tick);
    const unloadTicks = trips
      .filter((trip) => trip.arrived && trip.unloaded)
      .map((trip) => trip.unloaded!.tick - trip.arrived!.tick);
    const firstArrival = earliestMoment(trips.map((trip) => trip.arrived));
    const firstUnload = earliestMoment(trips.map((trip) => trip.unloaded));
    const materialWork = trace.firstWorkAfterMaterialReady;
    const clickToCompletionTicks = trace.completion.tick - trace.click.tick;
    const clickToCompletionSimSeconds = clickToCompletionTicks * SIM_TICK_SECONDS;
    const atomicCompletion = Boolean(finalRow.constructionComplete)
      && finalRow.constructionProgress >= 1 - 1e-6
      && constructionMaterialsReady(finalRow);
    const gateMisses: string[] = [];

    if (!trace.firstDispatch) {
      gateMisses.push('no stocked-source construction dispatch was observed');
    } else if (trace.firstDispatch.tick - trace.click.tick > 5) {
      gateMisses.push(
        `first dispatch took ${trace.firstDispatch.tick - trace.click.tick} ticks (>5 ticks / one simulation second)`,
      );
    }
    if (!atomicCompletion) gateMisses.push('completion was not atomic with delivered material and progress');
    if (trace.route.id === 'near') {
      const gateSeconds = trace.project.nearGateDays * CALENDAR_SECONDS_PER_DAY;
      if (clickToCompletionSimSeconds > gateSeconds + 1e-6) {
        gateMisses.push(
          `near ${trace.project.class} completion took ${round(clickToCompletionSimSeconds)} sim seconds (> ${gateSeconds})`,
        );
      }
    }

    return {
      key: trace.key,
      repetition: trace.repetition,
      seed: trace.seed.toString(),
      speed: trace.speed,
      route: trace.route.id,
      project: trace.project.kind,
      projectClass: trace.project.class,
      clickTick: trace.click.tick,
      completionTick: trace.completion.tick,
      clickToCompletionTicks,
      clickToCompletionSimSeconds: round(clickToCompletionSimSeconds),
      clickToCompletionRealSeconds: secondsBetween(trace.click, trace.completion),
      clickToDispatchTicks: ticksBetween(trace.click, trace.firstDispatch),
      clickToDispatchRealSeconds: secondsBetween(trace.click, trace.firstDispatch),
      dispatchToFirstArrivalTicks: ticksBetween(trace.firstDispatch, firstArrival),
      dispatchToFirstArrivalRealSeconds: secondsBetween(trace.firstDispatch, firstArrival),
      firstArrivalToUnloadTicks: ticksBetween(firstArrival, firstUnload),
      firstArrivalToUnloadRealSeconds: secondsBetween(firstArrival, firstUnload),
      clickToMaterialReadyTicks: ticksBetween(trace.click, trace.materialReady),
      clickToMaterialReadyRealSeconds: secondsBetween(trace.click, trace.materialReady),
      materialReadyToWorkTicks: ticksBetween(trace.materialReady, materialWork),
      materialReadyToWorkRealSeconds: secondsBetween(trace.materialReady, materialWork),
      clickToFirstWorkTicks: ticksBetween(trace.click, trace.firstWork),
      clickToFirstWorkRealSeconds: secondsBetween(trace.click, trace.firstWork),
      firstWorkToCompletionTicks: ticksBetween(trace.firstWork, trace.completion),
      firstWorkToCompletionRealSeconds: secondsBetween(trace.firstWork, trace.completion),
      materialReadyToCompletionTicks: ticksBetween(trace.materialReady, trace.completion),
      materialReadyToCompletionRealSeconds: secondsBetween(trace.materialReady, trace.completion),
      routeMetersMin: routes.length > 0 ? round(Math.min(...routes)) : null,
      routeMetersP50: percentile(routes, 0.5),
      routeMetersMax: routes.length > 0 ? round(Math.max(...routes)) : null,
      tripCount: trips.length,
      peakActiveCarts: trace.peakActiveCarts,
      peakApproachingCarts: trace.peakApproachingCarts,
      meanTravelTicks: mean(travelTicks),
      meanUnloadTicks: mean(unloadTicks),
      cargoLoads: trips.map((trip) => ({
        cargoKind: trip.cargoKind,
        amount: round(trip.amountAtDispatch),
      })),
      atomicCompletion,
      gateMisses,
    };
  }

  private onBuildingInsert(row: Building): void {
    if (row.constructionComplete) return;
    const trace = this.active.find((candidate) =>
      candidate.siteId == null && candidate.project.kind === row.kind,
    );
    if (!trace) return;
    trace.siteId = row.id;
    trace.inserted = this.moment();
    this.recordBuilding(trace, row);
  }

  private onBuildingUpdate(oldRow: Building, row: Building): void {
    const trace = this.active.find((candidate) => candidate.siteId === row.id);
    if (!trace) return;
    const moment = this.moment();
    if (!trace.materialReady && constructionMaterialsReady(row)) {
      trace.materialReady = moment;
    }
    if (row.constructionProgress > oldRow.constructionProgress + 1e-9) {
      trace.firstWork ??= moment;
      if (trace.materialReady) trace.firstWorkAfterMaterialReady ??= moment;
    }
    if (!oldRow.constructionComplete && row.constructionComplete) {
      trace.completion = moment;
      trace.finalRow = row;
      trace.firstWorkAfterMaterialReady ??= trace.materialReady ? moment : undefined;
    }
    if (buildingTraceChanged(oldRow, row)) this.recordBuilding(trace, row, moment);
  }

  private onTripInsert(row: DeliveryTrip): void {
    if (row.destinationKind !== 1 || row.targetBuildingId === 0n) return;
    const trace = this.active.find((candidate) => candidate.siteId === row.targetBuildingId);
    if (!trace) return;
    const dispatched = this.moment();
    trace.firstDispatch ??= dispatched;
    trace.trips.set(row.id, {
      id: row.id,
      cargoKind: row.cargoKind,
      amountAtDispatch: row.amount,
      pathDistance: row.pathDistance,
      deliveryWorkers: row.deliveryWorkers,
      phase: row.phase,
      currentAmount: row.amount,
      dispatched,
    });
    this.refreshCartPeaks(trace);
  }

  private onTripUpdate(oldRow: DeliveryTrip, row: DeliveryTrip): void {
    const trace = this.active.find((candidate) => candidate.trips.has(row.id));
    const trip = trace?.trips.get(row.id);
    if (!trace || !trip) return;
    const moment = this.moment();
    if (!trip.arrived && oldRow.phase !== 1 && row.phase === 1) trip.arrived = moment;
    if (!trip.unloaded && oldRow.amount > 1e-6 && row.amount <= 1e-6) trip.unloaded = moment;
    trip.phase = row.phase;
    trip.currentAmount = row.amount;
    this.refreshCartPeaks(trace);
  }

  private onTripDelete(row: DeliveryTrip): void {
    const trace = this.active.find((candidate) => candidate.trips.has(row.id));
    const trip = trace?.trips.get(row.id);
    if (!trace || !trip) return;
    trip.returned = this.moment();
    trip.currentAmount = 0;
    trip.phase = 3;
    this.refreshCartPeaks(trace);
  }

  private recordBuilding(trace: SiteTrace, row: Building, moment = this.moment()): void {
    trace.ledger.push({
      ...moment,
      progress: row.constructionProgress,
      labor: row.assignedLabor,
      deliveredTimber: row.constructionDeliveredTimber,
      deliveredStone: row.constructionDeliveredStone,
      deliveredIronwork: row.constructionDeliveredIronwork,
      deliveredRoofTiles: row.constructionDeliveredRoofTiles,
    });
  }

  private refreshCartPeaks(trace: SiteTrace): void {
    const trips = [...trace.trips.values()];
    const active = trips.filter((trip) => !trip.returned).length;
    const approaching = trips.filter((trip) => !trip.unloaded).length;
    trace.peakActiveCarts = Math.max(trace.peakActiveCarts, active);
    trace.peakApproachingCarts = Math.max(trace.peakApproachingCarts, approaching);
  }

  private moment(): Moment {
    return {
      tick: Number(worldConfig(this.connection)?.simTick ?? 0n),
      realMs: performance.now(),
    };
  }
}

async function prepareFreshWorld(
  connection: DbConnection,
  speed: Speed,
  seed: bigint,
  repetition: number,
): Promise<void> {
  await callReducer(connection, 'resetWorld', 'reset_world', {});
  await waitUntil(
    () => {
      const config = worldConfig(connection);
      return Boolean(config && !config.configured && config.simTick === 0n)
        && connection.db.building.count() === 0n
        && connection.db.delivery_trip.count() === 0n
        && connection.db.tree_entity.count() === 0n;
    },
    'fresh construction benchmark reset replication',
    { timeoutMs: 10_000, describe: () => describeWorld(connection) },
  );

  await callReducer(connection, 'configureWorld', 'configure_world', {
    seed,
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
    'construction benchmark world configuration',
    { describe: () => describeWorld(connection) },
  );

  await callReducer(connection, 'bootstrapTrees', 'bootstrap_trees', {
    trees: deterministicTrees(repetition),
  });
  await callReducer(connection, 'bootstrapQuarries', 'bootstrap_quarries', {
    quarries: [{
      quarryId: `construction-benchmark-quarry-${repetition}`,
      x: 9_060,
      z: 90,
      maxYield: 1_200,
      isRich: false,
    }],
  });
  await callReducer(connection, 'bootstrapForaging', 'bootstrap_foraging', {
    nodes: [{
      nodeId: `construction-benchmark-berries-${repetition}`,
      nodeKind: 'berries',
      x: 9_020,
      z: 92,
      maxYield: 300,
      anchorX: 9_020,
      anchorZ: 92,
    }],
  });
  await waitUntil(
    () => connection.db.tree_entity.count() === 8n
      && connection.db.quarry.count() === 1n
      && connection.db.foraging_node.count() === 1n,
    'construction benchmark public world bootstrap',
    { describe: () => describeWorld(connection) },
  );

  await callReducer(connection, 'syncRoadNetwork', 'sync_road_network', {
    snapshotJson: JSON.stringify(straightRoadSnapshot()),
  });
  await callReducer(connection, 'placeBuilding', 'place_building', {
    kind: 'founders_camp',
    x: 8_650,
    z: 14,
  });
  await waitUntil(
    () => {
      const camp = buildingByKind(connection, 'founders_camp');
      return Boolean(camp?.constructionComplete && camp.timber > 0 && camp.stone > 0);
    },
    'physical Founders Camp stock',
    { describe: () => describeWorld(connection) },
  );

  const resources = [...connection.db.player_resources.iter()][0];
  assert(resources?.physicalFoundingSiteEnabled);
  assert.equal(resources.timber, 0);
  assert.equal(resources.stone, 0);

  await callReducer(connection, 'setGameSpeed', 'set_game_speed', { speed });
  await waitUntil(
    () => worldConfig(connection)?.gameSpeed === speed,
    `${speed}x construction benchmark speed`,
  );
  const beforeEnterTick = Number(worldConfig(connection)?.simTick ?? 0n);
  await callReducer(connection, 'enterWorld', 'enter_world', {});
  await waitUntil(
    () => Number(worldConfig(connection)?.simTick ?? 0n) > beforeEnterTick,
    'construction benchmark authoritative clock start',
    { timeoutMs: 10_000, describe: () => describeWorld(connection) },
  );
}

async function waitForPairedCompletion(
  connection: DbConnection,
  traces: readonly SiteTrace[],
  label: string,
  wallTimeoutMs: number,
): Promise<void> {
  const startTick = Math.min(...traces.map((trace) => trace.click.tick));
  const maxTicks = Math.ceil(maxSampleSimSeconds / SIM_TICK_SECONDS);
  const wallDeadline = Date.now() + wallTimeoutMs;
  while (Date.now() < wallDeadline) {
    if (traces.every((trace) => trace.completion != null)) return;
    const currentTick = Number(worldConfig(connection)?.simTick ?? startTick);
    if (currentTick - startTick > maxTicks) {
      throw new Error(
        `${label} exceeded ${maxSampleSimSeconds} simulated seconds `
        + `(${maxTicks} ticks) without atomic completion`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} exceeded its ${round(wallTimeoutMs / 1_000)} second wall-clock safety timeout`);
}

function summarizeResults(results: readonly SiteResult[]) {
  const groups = new Map<string, SiteResult[]>();
  for (const result of results) {
    const key = `${result.project}/${result.route}/${result.speed}x`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, group]) => ({
      key,
      samples: group.length,
      clickToCompletionRealSeconds: percentilePair(group.map((row) => row.clickToCompletionRealSeconds)),
      clickToCompletionSimSeconds: percentilePair(group.map((row) => row.clickToCompletionSimSeconds)),
      clickToDispatchTicks: percentilePair(group.map((row) => row.clickToDispatchTicks)),
      dispatchToFirstArrivalTicks: percentilePair(group.map((row) => row.dispatchToFirstArrivalTicks)),
      firstArrivalToUnloadTicks: percentilePair(group.map((row) => row.firstArrivalToUnloadTicks)),
      clickToMaterialReadyTicks: percentilePair(group.map((row) => row.clickToMaterialReadyTicks)),
      materialReadyToWorkTicks: percentilePair(group.map((row) => row.materialReadyToWorkTicks)),
      firstWorkToCompletionTicks: percentilePair(group.map((row) => row.firstWorkToCompletionTicks)),
      materialReadyToCompletionTicks: percentilePair(group.map((row) => row.materialReadyToCompletionTicks)),
      routeMeters: percentilePair(group.map((row) => row.routeMetersP50)),
      tripCount: percentilePair(group.map((row) => row.tripCount)),
      peakActiveCarts: percentilePair(group.map((row) => row.peakActiveCarts)),
      peakApproachingCarts: percentilePair(group.map((row) => row.peakApproachingCarts)),
      gateMisses: group.flatMap((row) => row.gateMisses),
    }),
  );
}

function compactSampleLog(result: SiteResult) {
  return {
    project: result.project,
    ticks: result.clickToCompletionTicks,
    simSeconds: result.clickToCompletionSimSeconds,
    realSeconds: result.clickToCompletionRealSeconds,
    dispatchTicks: result.clickToDispatchTicks,
    routeMeters: result.routeMetersP50,
    travelTicks: result.meanTravelTicks,
    unloadTicks: result.meanUnloadTicks,
    materialReadyTicks: result.clickToMaterialReadyTicks,
    workTicks: result.firstWorkToCompletionTicks,
    trips: result.tripCount,
    peakCarts: result.peakActiveCarts,
    gateMisses: result.gateMisses,
  };
}

function constructionMaterialsReady(row: Building): boolean {
  return row.constructionDeliveredTimber + 1e-6 >= row.constructionRequiredTimber
    && row.constructionDeliveredStone + 1e-6 >= row.constructionRequiredStone
    && row.constructionDeliveredIronwork + 1e-6 >= row.constructionRequiredIronwork
    && row.constructionDeliveredRoofTiles + 1e-6 >= row.constructionRequiredRoofTiles;
}

function buildingTraceChanged(oldRow: Building, row: Building): boolean {
  return oldRow.constructionProgress !== row.constructionProgress
    || oldRow.assignedLabor !== row.assignedLabor
    || oldRow.constructionDeliveredTimber !== row.constructionDeliveredTimber
    || oldRow.constructionDeliveredStone !== row.constructionDeliveredStone
    || oldRow.constructionDeliveredIronwork !== row.constructionDeliveredIronwork
    || oldRow.constructionDeliveredRoofTiles !== row.constructionDeliveredRoofTiles
    || oldRow.constructionComplete !== row.constructionComplete;
}

function describeBuilding(row: Building): string {
  return `id=${row.id},complete=${row.constructionComplete},progress=${row.constructionProgress.toFixed(3)},`
    + `labor=${row.assignedLabor},T=${row.constructionDeliveredTimber.toFixed(1)}/${row.constructionRequiredTimber.toFixed(1)},`
    + `S=${row.constructionDeliveredStone.toFixed(1)}/${row.constructionRequiredStone.toFixed(1)},`
    + `I=${row.constructionDeliveredIronwork.toFixed(1)}/${row.constructionRequiredIronwork.toFixed(1)},`
    + `R=${row.constructionDeliveredRoofTiles.toFixed(1)}/${row.constructionRequiredRoofTiles.toFixed(1)}`;
}

function describeWorld(connection: DbConnection): string {
  const config = worldConfig(connection);
  return `configured=${config?.configured ?? 'missing'},tick=${config?.simTick ?? 'missing'},`
    + `speed=${config?.gameSpeed ?? 'missing'},buildings=${connection.db.building.count()},`
    + `trips=${connection.db.delivery_trip.count()},trees=${connection.db.tree_entity.count()},`
    + `quarries=${connection.db.quarry.count()},foraging=${connection.db.foraging_node.count()}`;
}

function worldConfig(connection: DbConnection) {
  return [...connection.db.world_config.iter()][0];
}

function buildingById(connection: DbConnection, id: bigint) {
  return [...connection.db.building.iter()].find((row) => row.id === id);
}

function buildingByKind(connection: DbConnection, kind: string) {
  return [...connection.db.building.iter()].find((row) => row.kind === kind);
}

function deterministicTrees(repetition: number) {
  return Array.from({ length: 8 }, (_, index) => ({
    treeId: `construction-benchmark-tree-${repetition}-${index}`,
    layoutIndex: 1_200_000 + repetition * 100 + index,
    woodYield: 14,
    x: 9_000 + (index % 4) * 10,
    z: 110 + Math.floor(index / 4) * 10,
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

function percentilePair(values: readonly (number | null)[]) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  return {
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
  };
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return round(sorted[Math.min(rank, sorted.length - 1)]);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function earliestMoment(values: readonly (Moment | undefined)[]): Moment | undefined {
  return values
    .filter((value): value is Moment => value != null)
    .sort((left, right) => left.realMs - right.realMs)[0];
}

function ticksBetween(start: Moment | undefined, end: Moment | undefined): number | null {
  if (!start || !end) return null;
  return end.tick - start.tick;
}

function secondsBetween(start: Moment | undefined, end: Moment | undefined): number | null {
  if (!start || !end) return null;
  return round((end.realMs - start.realMs) / 1_000);
}

function sampleTimeoutMs(speed: Speed): number {
  const expectedRealSeconds = maxSampleSimSeconds / (SIM_REALTIME_RATE * speed);
  return Math.ceil((expectedRealSeconds + 30) * 1_000);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function assertFiniteNonNegative(label: string, value: number): void {
  assert(Number.isFinite(value), `${label} must be finite (received ${value})`);
  assert(value >= 0, `${label} must be non-negative (received ${value})`);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  assert(Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum);
  return parsed;
}

function cliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return cliArgs.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

function selectCases<T>(
  available: readonly T[],
  requested: string | undefined,
  idFor: (value: T) => string,
  label: string,
): T[] {
  if (!requested) return [...available];
  const ids = requested.split(',').map((value) => value.trim()).filter(Boolean);
  assert(ids.length > 0, `at least one ${label} must be selected`);
  const selected = ids.map((id) => {
    const value = available.find((candidate) => idFor(candidate) === id);
    assert(value != null, `unknown construction benchmark ${label}: ${id}`);
    return value;
  });
  assert.equal(new Set(selected.map(idFor)).size, selected.length, `duplicate ${label} selection`);
  return selected;
}

function formatFailures(failures: readonly FailureResult[]): string {
  return failures.map((failure) =>
    `${failure.route}/${failure.speed}x/r${failure.repetition}: ${failure.message}; ${failure.diagnostics}`,
  ).join('\n');
}

function disposableDatabaseName(): string {
  return `${DATABASE_PREFIX}${Date.now().toString(36)}-${Math.max(0, process.pid).toString(36)}`;
}

function validateDatabaseName(name: string, generated: boolean): void {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), `Invalid SpacetimeDB database name: ${name}`);
  if (generated) assert(name.startsWith(DATABASE_PREFIX));
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

await main();
