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
  CONSTRUCTION_HAUL_PER_WORKER,
  CONSTRUCTION_MAX_BUILDERS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { gameClock, isLaborPaused, laborPauseLabel } from '../src/world/gameCalendar.ts';
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
const summaryOnly = cliArgs.includes('--summary-only');
const isolatedCoreOnly = cliArgs.includes('--isolated-core-only');
const matrixOnly = cliArgs.includes('--matrix-only');
assert(!(isolatedCoreOnly && matrixOnly), '--isolated-core-only and --matrix-only are mutually exclusive');
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
type BenchmarkScenario = 'paired-contention' | 'isolated-core';

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
const includesNearRoute = selectedRoutes.some((route) => route.id === 'near');
const includeIsolatedCore = isolatedCoreOnly || (!matrixOnly && includesNearRoute);

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
  borrowedBuilderWorkers: number;
};

type TripTrace = {
  id: bigint;
  cargoKind: number;
  amountAtDispatch: number;
  pathDistance: number;
  deliveryWorkers: number;
  laborBuildingId: bigint;
  freeHaulerWorkers: number;
  phase: number;
  currentAmount: number;
  dispatched: Moment;
  arrived?: Moment;
  unloaded?: Moment;
  returned?: Moment;
};

type SiteTrace = {
  key: string;
  scenario: BenchmarkScenario;
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
  peakBorrowedBuilderCarts: number;
  peakBorrowedBuilderWorkers: number;
  activity: Moment[];
};

type SiteResult = {
  key: string;
  scenario: BenchmarkScenario;
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
  expectedRouteMeters: number;
  tripCount: number;
  peakActiveCarts: number;
  peakApproachingCarts: number;
  peakBorrowedBuilderCarts: number;
  peakBorrowedBuilderWorkers: number;
  longestActivityGapRealSeconds: number;
  longestActivityGapTicks: number;
  longestActivityGapReason: string;
  maxEligibleProgressGapTicks: number;
  meanTravelTicks: number | null;
  meanUnloadTicks: number | null;
  cargoLoads: Array<{ cargoKind: number; amount: number }>;
  requiredMaterialTotal: number;
  deliveredMaterialTotal: number;
  dispatchedCargoTotal: number;
  atomicCompletion: boolean;
  gateMisses: string[];
};

type FailureResult = {
  scenario: BenchmarkScenario;
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

  if (!isolatedCoreOnly) {
    for (const speed of selectedSpeeds) {
      if (aborted) break;
      for (const route of selectedRoutes) {
        if (aborted) break;
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          if (aborted) break;
          const seed = BigInt(530_000 + route.alongRoadMeters * 10 + repetition);
          await prepareFreshWorld(connection, speed, seed, repetition);
          observer.beginRun();
          const runStarted = performance.now();

          try {
            const traces: SiteTrace[] = [];
            for (const project of PROJECTS) {
              const trace = observer.expectPlacement({
                scenario: 'paired-contention',
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

            await waitForAtomicCompletion(
              connection,
              traces,
              `${route.id}/${speed}x/repetition-${repetition} paired atomic completion`,
              sampleTimeoutMs(speed),
            );

            const runResults = traces.map((trace) => observer.result(trace));
            results.push(...runResults);
            console.log(JSON.stringify({
              checkpoint: 'construction-pacing-sample',
              scenario: 'paired-contention',
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
              scenario: 'paired-contention',
              repetition,
              seed: seed.toString(),
              speed,
              route: route.id,
              message,
              diagnostics,
            });
            console.error(JSON.stringify({
              checkpoint: 'construction-pacing-failure',
              scenario: 'paired-contention',
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
  }

  if (!aborted && includeIsolatedCore) {
    aborted = !(await runIsolatedCoreCases(connection, observer));
  }

  const pairedExpectedSamples = isolatedCoreOnly
    ? 0
    : selectedSpeeds.length * selectedRoutes.length * PROJECTS.length * repetitions;
  const isolatedExpectedSamples = includeIsolatedCore
    ? selectedSpeeds.length * repetitions
    : 0;
  const expectedResults = pairedExpectedSamples + isolatedExpectedSamples;
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
      pairedProjects: isolatedCoreOnly
        ? []
        : PROJECTS.map(({ kind, class: projectClass }) => ({ kind, projectClass })),
      pairingTradeoff: isolatedCoreOnly
        ? null
        : 'Well and Village Storehouse are clicked back-to-back in each fresh world. This halves benchmark runtime and deliberately measures realistic shared cart/builder contention; it is not an isolated-project lower bound.',
      isolatedCoreGate: includeIsolatedCore
        ? {
            kind: 'well',
            route: 'near',
            dayAlignedClickTick: 0,
            dayAlignedClock: '08:00 (configured calendar start, within work hours)',
            staffing: `${CONSTRUCTION_MAX_BUILDERS}/${CONSTRUCTION_MAX_BUILDERS} builders plus all remaining founders available to haul`,
            source: 'normal physically stocked Founders’ Camp; no direct stock mutation',
            gate: `atomic completion within ${CALENDAR_SECONDS_PER_DAY} simulation seconds / one calendar day`,
          }
        : null,
      percentileMethod: 'nearest-rank; with the default three deterministic repetitions P95 is the observed worst sample',
      dispatchCycle: {
        authority: 'one scheduler heartbeat; generated SIM_REALTIME_RATE mirrors server BASE_SPEED_NUMERATOR / BASE_SPEED_DENOMINATOR',
        observerBoundary: 'click is captured before the placement reducer; dispatch is captured in the next eligible scheduler transaction',
        maxObservedSimTicksBySpeed: Object.fromEntries(
          selectedSpeeds.map((speed) => [speed, dispatchCycleTickBudget(speed)]),
        ),
      },
      assertionPolicy: 'Missing/invalid authoritative transitions, non-atomic completion, absent carts/routes, blocked-crew release or one-onsite-builder violations, observation-ceiling failures, scheduler-cycle dispatch misses, eligible-work stalls, one-day unexplained inactivity, 4x passive gaps, and every scenario-appropriate product pacing-gate miss are fatal. The isolated day-aligned Well owns the one-day core-service gate; paired Well timings remain the explicit simultaneous-contention distribution.',
      observationCeiling: '900 simulated seconds by default, enforced from the authoritative sim tick equally at every speed; the derived wall timeout adds 30 seconds only as a paused-server safety guard',
      repetitions,
      selectedSpeeds,
      selectedRoutes: isolatedCoreOnly ? [] : selectedRoutes.map((route) => route.id),
      selectedScenarios: [
        ...(!isolatedCoreOnly ? ['paired-contention'] : []),
        ...(includeIsolatedCore ? ['isolated-core'] : []),
      ],
      expectedCompletedSamples: expectedResults,
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
  console.log(JSON.stringify(
    summaryOnly
      ? {
          databaseName: evidence.databaseName,
          contract: evidence.contract,
          summaries: evidence.summaries,
          gateMisses: evidence.gateMisses,
          failures: evidence.failures,
        }
      : evidence,
    null,
    2,
  ));

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
    for (const [label, routeMeters] of [
      ['minimum', result.routeMetersMin],
      ['median', result.routeMetersP50],
      ['maximum', result.routeMetersMax],
    ] as const) {
      assert(
        routeMeters != null && Math.abs(routeMeters - result.expectedRouteMeters) <= 0.1,
        `${result.key} ${label} route ${routeMeters}m does not match the ${result.expectedRouteMeters}m authority fixture route`,
      );
    }
    assert(
      result.peakBorrowedBuilderWorkers <= CONSTRUCTION_MAX_BUILDERS,
      `${result.key} borrowed ${result.peakBorrowedBuilderWorkers} builders from a ${CONSTRUCTION_MAX_BUILDERS}-builder site`,
    );
    if (result.scenario === 'paired-contention') {
      assert.equal(
        result.peakBorrowedBuilderWorkers,
        CONSTRUCTION_MAX_BUILDERS - 1,
        `${result.key} did not release every blocked builder except the one kept onsite`,
      );
      assert.equal(
        result.peakBorrowedBuilderCarts,
        CONSTRUCTION_MAX_BUILDERS - 1,
        `${result.key} did not preserve one distinct cart reservation per borrowed builder`,
      );
    } else {
      assert.equal(
        result.peakBorrowedBuilderWorkers,
        0,
        `${result.key} borrowed builders despite enough genuinely free founding haulers`,
      );
    }
    for (const cargo of result.cargoLoads) {
      assert(
        cargo.amount > 0 && cargo.amount <= CONSTRUCTION_HAUL_PER_WORKER + 1e-6,
        `${result.key} cart load ${cargo.amount} violates the ${CONSTRUCTION_HAUL_PER_WORKER}-unit one-worker cart bound`,
      );
    }
    assertApproxEqual(
      `${result.key} dispatched cargo conservation`,
      result.dispatchedCargoTotal,
      result.requiredMaterialTotal,
    );
    assertApproxEqual(
      `${result.key} delivered material conservation`,
      result.deliveredMaterialTotal,
      result.requiredMaterialTotal,
    );
    assertFiniteNonNegative(`${result.key} real completion`, result.clickToCompletionRealSeconds);
    assertFiniteNonNegative(`${result.key} sim completion`, result.clickToCompletionSimSeconds);
    assert(
      result.clickToDispatchTicks != null
        && result.clickToDispatchTicks <= dispatchCycleTickBudget(result.speed),
      `${result.key} did not dispatch stocked reachable material within one authoritative scheduler cycle`,
    );
    assert(
      result.maxEligibleProgressGapTicks <= dispatchCycleTickBudget(result.speed),
      `${result.key} left a supplied, staffed work frame unchanged for ${result.maxEligibleProgressGapTicks} eligible ticks`,
    );
    assert(
      result.longestActivityGapTicks * SIM_TICK_SECONDS <= CALENDAR_SECONDS_PER_DAY,
      `${result.key} remained unchanged for more than one game-day without a cart, unload, labor, material, or work event; reported blocker: ${result.longestActivityGapReason}`,
    );
    if (result.speed === 4) {
      assert(
        result.longestActivityGapRealSeconds <= 30,
        `${result.key} imposed ${result.longestActivityGapRealSeconds}s at 4x without visible construction activity`,
      );
    }
    assert.deepEqual(result.gateMisses, [], `${result.key} pacing gates:\n${result.gateMisses.join('\n')}`);
  }
  console.log(
    `authoritative construction pacing benchmark passed (${results.length} project samples; ${repetitions} repetitions per selected scenario cell)`,
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
    scenario: BenchmarkScenario;
    repetition: number;
    seed: bigint;
    speed: Speed;
    route: RouteCase;
    project: ProjectCase;
  }): SiteTrace {
    const trace: SiteTrace = {
      key: `${input.scenario}/${input.project.kind}/${input.route.id}/${input.speed}x/r${input.repetition}`,
      ...input,
      click: this.moment(),
      trips: new Map(),
      ledger: [],
      peakActiveCarts: 0,
      peakApproachingCarts: 0,
      peakBorrowedBuilderCarts: 0,
      peakBorrowedBuilderWorkers: 0,
      activity: [],
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
    const activityMoments = [trace.click, ...trace.activity, trace.completion];
    const longestActivityGap = longestMomentGap(activityMoments);
    const clickToCompletionTicks = trace.completion.tick - trace.click.tick;
    const clickToCompletionSimSeconds = clickToCompletionTicks * SIM_TICK_SECONDS;
    const atomicCompletion = Boolean(finalRow.constructionComplete)
      && finalRow.constructionProgress >= 1 - 1e-6
      && constructionMaterialsReady(finalRow);
    const gateMisses: string[] = [];

    const dispatchCycleTicks = dispatchCycleTickBudget(trace.speed);
    if (!trace.firstDispatch) {
      gateMisses.push('no stocked-source construction dispatch was observed');
    } else if (trace.firstDispatch.tick - trace.click.tick > dispatchCycleTicks) {
      gateMisses.push(
        `first dispatch took ${trace.firstDispatch.tick - trace.click.tick} ticks (> ${dispatchCycleTicks}-tick scheduler dispatch cycle at ${trace.speed}x)`,
      );
    }
    if (!atomicCompletion) gateMisses.push('completion was not atomic with delivered material and progress');
    const ownsNearGate = trace.route.id === 'near'
      && (trace.project.kind !== 'well' || trace.scenario === 'isolated-core');
    if (ownsNearGate) {
      const gateSeconds = trace.project.nearGateDays * CALENDAR_SECONDS_PER_DAY;
      if (clickToCompletionSimSeconds > gateSeconds + 1e-6) {
        gateMisses.push(
          `near ${trace.project.class} completion took ${round(clickToCompletionSimSeconds)} sim seconds (> ${gateSeconds})`,
        );
      }
    }

    return {
      key: trace.key,
      scenario: trace.scenario,
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
      expectedRouteMeters: expectedRouteMeters(trace.route, trace.project),
      tripCount: trips.length,
      peakActiveCarts: trace.peakActiveCarts,
      peakApproachingCarts: trace.peakApproachingCarts,
      peakBorrowedBuilderCarts: trace.peakBorrowedBuilderCarts,
      peakBorrowedBuilderWorkers: trace.peakBorrowedBuilderWorkers,
      longestActivityGapRealSeconds: longestActivityGap == null
        ? 0
        : round((longestActivityGap.end.realMs - longestActivityGap.start.realMs) / 1_000),
      longestActivityGapTicks: longestActivityGap == null
        ? 0
        : longestActivityGap.end.tick - longestActivityGap.start.tick,
      longestActivityGapReason: constructionGapReason(trace, finalRow, longestActivityGap),
      maxEligibleProgressGapTicks: maxEligibleProgressGapTicks(trace, finalRow),
      meanTravelTicks: mean(travelTicks),
      meanUnloadTicks: mean(unloadTicks),
      cargoLoads: trips.map((trip) => ({
        cargoKind: trip.cargoKind,
        amount: round(trip.amountAtDispatch),
      })),
      requiredMaterialTotal: constructionRequiredTotal(finalRow),
      deliveredMaterialTotal: constructionDeliveredTotal(finalRow),
      dispatchedCargoTotal: round(trips.reduce(
        (total, trip) => total + trip.amountAtDispatch,
        0,
      )),
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
      laborBuildingId: row.laborBuildingId,
      freeHaulerWorkers: row.freeHaulerWorkers,
      phase: row.phase,
      currentAmount: row.amount,
      dispatched,
    });
    trace.activity.push(dispatched);
    this.scheduleCartPeaks(trace);
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
    trace.activity.push(moment);
    this.scheduleCartPeaks(trace);
  }

  private onTripDelete(row: DeliveryTrip): void {
    const trace = this.active.find((candidate) => candidate.trips.has(row.id));
    const trip = trace?.trips.get(row.id);
    if (!trace || !trip) return;
    const returned = this.moment();
    trip.returned = returned;
    trip.currentAmount = 0;
    trip.phase = 3;
    trace.activity.push(returned);
    this.scheduleCartPeaks(trace);
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
      borrowedBuilderWorkers: Math.min(
        row.assignedLabor,
        this.borrowedBuilderWorkers(trace),
      ),
    });
    trace.activity.push(moment);
  }

  private refreshCartPeaks(trace: SiteTrace): void {
    if (trace.siteId == null) return;
    const trips = [...this.connection.db.delivery_trip.iter()].filter(
      (trip) => trip.targetBuildingId === trace.siteId,
    );
    const active = trips.length;
    const approaching = trips.filter((trip) => trip.phase !== 2 && trip.amount > 1e-6).length;
    trace.peakActiveCarts = Math.max(trace.peakActiveCarts, active);
    trace.peakApproachingCarts = Math.max(trace.peakApproachingCarts, approaching);
    const borrowed = trips.filter((trip) =>
      trip.laborBuildingId === trace.siteId,
    );
    const borrowedWorkers = borrowed.reduce(
      (total, trip) => total + Math.max(0, trip.deliveryWorkers - trip.freeHaulerWorkers),
      0,
    );
    trace.peakBorrowedBuilderCarts = Math.max(
      trace.peakBorrowedBuilderCarts,
      borrowed.length,
    );
    trace.peakBorrowedBuilderWorkers = Math.max(
      trace.peakBorrowedBuilderWorkers,
      borrowedWorkers,
    );
  }

  private scheduleCartPeaks(trace: SiteTrace): void {
    // Spacetime table events from one transaction may notify an insert before
    // a same-transaction return deletion. Sample after the event batch so a
    // transient client callback order cannot manufacture a fifth builder from
    // a four-person authoritative roster.
    queueMicrotask(() => this.refreshCartPeaks(trace));
  }

  private borrowedBuilderWorkers(trace: SiteTrace): number {
    if (trace.siteId == null) return 0;
    return [...this.connection.db.delivery_trip.iter()]
      .filter((trip) => trip.laborBuildingId === trace.siteId)
      .reduce(
        (total, trip) => total + Math.max(0, trip.deliveryWorkers - trip.freeHaulerWorkers),
        0,
      );
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
  startClock = true,
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

  if (startClock) await startAuthoritativeClock(connection, speed);
}

async function startAuthoritativeClock(
  connection: DbConnection,
  speed: Speed,
): Promise<void> {
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

async function runIsolatedCoreCases(
  connection: DbConnection,
  observer: ConstructionBenchmarkObserver,
): Promise<boolean> {
  const route = ROUTES[0];
  const project = PROJECTS[0];
  for (const speed of selectedSpeeds) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const seed = BigInt(540_000 + repetition);
      await prepareFreshWorld(connection, speed, seed, repetition, false);
      observer.beginRun();
      const runStarted = performance.now();
      try {
        const trace = observer.expectPlacement({
          scenario: 'isolated-core',
          repetition,
          seed,
          speed,
          route,
          project,
        });
        await callReducer(connection, 'placeBuilding', 'place_building', {
          kind: project.kind,
          x: 8_650 + route.alongRoadMeters,
          z: project.z,
        });
        await waitUntil(
          () => trace.siteId != null,
          `${trace.key} site insertion before clock start`,
          { timeoutMs: 5_000, describe: () => observer.describe(trace) },
        );
        assert.equal(trace.click.tick, 0, `${trace.key} must click at the fresh-world tick-zero boundary`);
        const clickClock = gameClock(trace.click.tick);
        assert(
          clickClock.isWorkHours && clickClock.hour === 8,
          `${trace.key} expected the configured 08:00 workday start, received hour ${clickClock.hour}`,
        );
        const site = buildingById(connection, trace.siteId!);
        const camp = buildingByKind(connection, 'founders_camp');
        assert(site, `${trace.key} site row disappeared before clock start`);
        assert(camp, `${trace.key} Founders’ Camp disappeared before clock start`);
        assert.equal(
          site.assignedLabor,
          CONSTRUCTION_MAX_BUILDERS,
          `${trace.key} must begin with a full ${CONSTRUCTION_MAX_BUILDERS}-builder roster`,
        );
        assert(
          camp.timber + 1e-6 >= site.constructionRequiredTimber
            && camp.stone + 1e-6 >= site.constructionRequiredStone,
          `${trace.key} must begin against physically stocked normal Founders’ Camp material`,
        );

        await startAuthoritativeClock(connection, speed);
        await waitForAtomicCompletion(
          connection,
          [trace],
          `${route.id}/${speed}x/repetition-${repetition} isolated core-service atomic completion`,
          sampleTimeoutMs(speed),
        );
        const result = observer.result(trace);
        results.push(result);
        console.log(JSON.stringify({
          checkpoint: 'construction-pacing-sample',
          scenario: 'isolated-core',
          repetition,
          sampleCount: repetitions,
          seed: seed.toString(),
          speed,
          route: route.id,
          elapsedRealSeconds: round((performance.now() - runStarted) / 1_000),
          projects: [compactSampleLog(result)],
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const diagnostics = observer.describeRun();
        failures.push({
          scenario: 'isolated-core',
          repetition,
          seed: seed.toString(),
          speed,
          route: route.id,
          message,
          diagnostics,
        });
        console.error(JSON.stringify({
          checkpoint: 'construction-pacing-failure',
          scenario: 'isolated-core',
          repetition,
          seed: seed.toString(),
          speed,
          route: route.id,
          message,
          diagnostics,
        }));
        return false;
      } finally {
        observer.endRun();
      }
    }
  }
  return true;
}

async function waitForAtomicCompletion(
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
    const key = `${result.scenario}/${result.project}/${result.route}/${result.speed}x`;
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
      peakBorrowedBuilderCarts: percentilePair(group.map((row) => row.peakBorrowedBuilderCarts)),
      peakBorrowedBuilderWorkers: percentilePair(group.map((row) => row.peakBorrowedBuilderWorkers)),
      longestActivityGapRealSeconds: percentilePair(group.map((row) => row.longestActivityGapRealSeconds)),
      longestActivityGapTicks: percentilePair(group.map((row) => row.longestActivityGapTicks)),
      longestActivityGapReasons: [...new Set(group.map((row) => row.longestActivityGapReason))],
      maxEligibleProgressGapTicks: percentilePair(group.map((row) => row.maxEligibleProgressGapTicks)),
      gateMisses: group.flatMap((row) => row.gateMisses),
    }),
  );
}

function compactSampleLog(result: SiteResult) {
  return {
    scenario: result.scenario,
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
    borrowedBuilderCarts: result.peakBorrowedBuilderCarts,
    maxActivityGapRealSeconds: result.longestActivityGapRealSeconds,
    maxActivityGapReason: result.longestActivityGapReason,
    maxEligibleProgressGapTicks: result.maxEligibleProgressGapTicks,
    gateMisses: result.gateMisses,
  };
}

function constructionMaterialsReady(row: Building): boolean {
  return row.constructionDeliveredTimber + 1e-6 >= row.constructionRequiredTimber
    && row.constructionDeliveredStone + 1e-6 >= row.constructionRequiredStone
    && row.constructionDeliveredIronwork + 1e-6 >= row.constructionRequiredIronwork
    && row.constructionDeliveredRoofTiles + 1e-6 >= row.constructionRequiredRoofTiles;
}

function constructionRequiredTotal(row: Building): number {
  return round(
    row.constructionRequiredTimber
      + row.constructionRequiredStone
      + row.constructionRequiredIronwork
      + row.constructionRequiredRoofTiles,
  );
}

function constructionDeliveredTotal(row: Building): number {
  return round(
    row.constructionDeliveredTimber
      + row.constructionDeliveredStone
      + row.constructionDeliveredIronwork
      + row.constructionDeliveredRoofTiles,
  );
}

function expectedRouteMeters(route: RouteCase, project: ProjectCase): number {
  // The Founders' Camp is 14m north of the straight fixture road. A project
  // travels that first mile, the requested along-road case, then its own
  // signed last mile back off the road. This makes route geometry independent
  // of scheduler speed and turns near/medium/far into exact authority checks.
  return route.alongRoadMeters + 14 + Math.abs(project.z);
}

function dispatchCycleTickBudget(speed: Speed): number {
  // The authoritative scheduler runs one heartbeat per real-time tick and
  // accrues `speed * BASE_SPEED_NUMERATOR / BASE_SPEED_DENOMINATOR` economy
  // substeps. SIM_REALTIME_RATE is the generated client mirror of that 3/4
  // ratio. The placement click is observed before the next scheduler
  // transaction, so 8x/4x/1x legitimately expose at most 6/3/1 sim ticks
  // between click and the first eligible dispatch—not a fixed five-tick wall.
  return Math.max(1, Math.ceil(speed * SIM_REALTIME_RATE));
}

function longestMomentGap(
  moments: readonly Moment[],
): { start: Moment; end: Moment } | null {
  const ordered = [...moments].sort((left, right) => left.realMs - right.realMs);
  let longest: { start: Moment; end: Moment } | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const candidate = { start: ordered[index - 1], end: ordered[index] };
    if (
      longest == null
      || candidate.end.realMs - candidate.start.realMs
        > longest.end.realMs - longest.start.realMs
    ) longest = candidate;
  }
  return longest;
}

function constructionGapReason(
  trace: SiteTrace,
  row: Building,
  gap: { start: Moment; end: Moment } | null,
): string {
  if (gap == null) return 'No interval between construction events';
  const pauseLabels = new Set<string>();
  let eligibleTicks = 0;
  for (let tick = gap.start.tick + 1; tick <= gap.end.tick; tick += 1) {
    const clock = gameClock(tick);
    const pause = laborPauseLabel(clock, false, false);
    if (pause) pauseLabels.add(pause);
    else eligibleTicks += 1;
  }
  if (eligibleTicks === 0 && pauseLabels.size > 0) {
    return `${[...pauseLabels].join(' / ')} — worksite inspector and HUD show the scheduled pause`;
  }

  const state = [...trace.ledger]
    .filter((event) => event.tick <= gap.start.tick)
    .sort((left, right) => right.tick - left.tick)[0];
  if (!state) return 'Placement is awaiting its first authoritative site snapshot';
  const requiredTotal = constructionRequiredTotal(row);
  const deliveredTotal = state.deliveredTimber
    + state.deliveredStone
    + state.deliveredIronwork
    + state.deliveredRoofTiles;
  const materialReadiness = requiredTotal <= 1e-6
    ? 1
    : Math.min(1, deliveredTotal / requiredTotal);
  const onsiteBuilders = Math.max(0, state.labor - state.borrowedBuilderWorkers);
  if (state.labor <= 0) return 'No builders assigned — assign labor in the worksite inspector';
  if (onsiteBuilders <= 0) {
    return 'Assigned builders are hauling reserved supplies; inbound carts and returning crew are shown in the worksite inspector';
  }
  if (state.progress + 1e-6 >= materialReadiness && materialReadiness < 1) {
    return 'Frame is at the delivered-material limit; the worksite inspector reports the next reserved source, cart, or attainable hauling remedy';
  }
  return 'No authoritative blocker — a supplied, staffed site must advance within the next eligible scheduler cycle';
}

function maxEligibleProgressGapTicks(trace: SiteTrace, row: Building): number {
  const requiredTotal = row.constructionRequiredTimber
    + row.constructionRequiredStone
    + row.constructionRequiredIronwork
    + row.constructionRequiredRoofTiles;
  if (requiredTotal <= 1e-6) return 0;
  const byTick = new Map<number, LedgerEvent>();
  for (const event of trace.ledger) byTick.set(event.tick, event);
  const events = [...byTick.values()].sort((left, right) => left.tick - right.tick);
  let longest = 0;
  for (let index = 0; index < events.length - 1; index += 1) {
    const event = events[index];
    const deliveredTotal = event.deliveredTimber
      + event.deliveredStone
      + event.deliveredIronwork
      + event.deliveredRoofTiles;
    const materialReadiness = Math.min(1, deliveredTotal / requiredTotal);
    const onsiteBuilders = Math.max(0, event.labor - event.borrowedBuilderWorkers);
    if (onsiteBuilders <= 0 || event.progress + 1e-6 >= materialReadiness) continue;
    const nextProgress = events.slice(index + 1).find(
      (candidate) => candidate.progress > event.progress + 1e-9,
    );
    if (nextProgress) {
      let eligibleTicks = 0;
      for (let tick = event.tick + 1; tick <= nextProgress.tick; tick += 1) {
        if (!isLaborPaused(gameClock(tick), false, false)) eligibleTicks += 1;
      }
      longest = Math.max(longest, eligibleTicks);
    }
  }
  return longest;
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

function assertApproxEqual(label: string, actual: number, expected: number): void {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6,
    `${label} expected ${expected}, received ${actual}`,
  );
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
    `${failure.scenario}/${failure.route}/${failure.speed}x/r${failure.repetition}: ${failure.message}; ${failure.diagnostics}`,
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
