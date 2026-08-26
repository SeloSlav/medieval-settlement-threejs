import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  WEAVER_LINEN_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  formatGrainWorkingBuffer,
  GRAIN_CRITICAL_RUNWAY_CYCLES,
  GRAIN_DISPATCH_TARGET_KINDS,
  GRAIN_DISPATCH_SOURCE_KINDS,
  GRAIN_PROCESSOR_KINDS,
  grainDispatchDuty,
  grainInputRunwayCycles,
  grainInputTarget,
  selectGrainDispatchTarget,
  selectGrainProcessorTarget,
} from '../src/logistics/grainLogistics.ts';
import {
  directlyDispatchedProcessorInputPerCycle,
  PROCESSOR_INPUT_BUFFER_CYCLES,
  processorInputRunwayCycles,
  processorInputTarget,
  selectDirectProcessorInputTarget,
} from '../src/logistics/processorInputLogistics.ts';
import {
  computeSettlementGranaryReserve,
  GRANARY_GRAIN_RESERVE_MAX,
  granaryExportableGrain,
  granaryProtectedGrain,
  normalizeGranaryGrainReserve,
} from '../src/economy/granaryPolicy.ts';
import {
  WEAVER_INPUT_POLICY_AUTO,
  WEAVER_INPUT_POLICY_FLAX_FIRST,
  WEAVER_INPUT_POLICY_WOOL_FIRST,
} from '../src/economy/weaverInputPolicy.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

const expandedSimulation = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const supplyPolicy = readFileSync(
  new URL('../server/src/supply_policy.rs', import.meta.url),
  'utf8',
);
const expandedInspector = readFileSync(
  new URL('../src/resources/inspector/expandedBuildingRenderer.ts', import.meta.url),
  'utf8',
);
const processorStatus = readFileSync(
  new URL('../src/resources/inspector/buildingProcessorStatus.ts', import.meta.url),
  'utf8',
);
const tickContext = readFileSync(
  new URL('../server/src/simulation/tick_context.rs', import.meta.url),
  'utf8',
);
const tradingPostTrade = readFileSync(
  new URL('../server/src/simulation/trading_post_trade.rs', import.meta.url),
  'utf8',
);
const simulationReducer = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const worldQueries = readFileSync(
  new URL('../src/resources/WorldQueries.ts', import.meta.url),
  'utf8',
);

assert.deepEqual(GRAIN_DISPATCH_SOURCE_KINDS, ['threshing_barn', 'granary']);
assert.deepEqual(GRAIN_PROCESSOR_KINDS, ['pastoral_farmstead', 'watermill', 'windmill']);
assert.deepEqual(
  GRAIN_DISPATCH_TARGET_KINDS,
  ['pastoral_farmstead', 'watermill', 'windmill', 'granary'],
);
assert.equal(
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  'pastoral feed preparation must remain a 1:1 whole-unit recipe',
);
assert.equal(GRAIN_CRITICAL_RUNWAY_CYCLES, 1);
assert.equal(PROCESSOR_INPUT_BUFFER_CYCLES, 3);
assert.equal(directlyDispatchedProcessorInputPerCycle('bakery', 'ryeFlour'), 3);
assert.equal(directlyDispatchedProcessorInputPerCycle('brewery', 'barley'), 3);
assert.equal(directlyDispatchedProcessorInputPerCycle('smokehouse', 'food'), 3);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('spinning_retting_house', 'wool'),
  SPINNING_RETTING_WOOL_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('spinning_retting_house', 'flax'),
  SPINNING_RETTING_FLAX_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('weaver', 'yarn'),
  WEAVER_YARN_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('weaver', 'linen'),
  WEAVER_LINEN_PER_CYCLE,
);
assert.equal(directlyDispatchedProcessorInputPerCycle('weaver', 'wool'), 0);
assert.equal(directlyDispatchedProcessorInputPerCycle('weaver', 'flax'), 0);
assert.equal(processorInputTarget(2), 6);
assert.equal(processorInputTarget(2, 25), 2);
assert.equal(processorInputTarget(2, 50), 4);
assert.equal(processorInputTarget(2, 75), 6);
assert.equal(processorInputRunwayCycles(3, 2), 1.5);
assert.equal(GRANARY_GRAIN_RESERVE_MAX, BUILDING_STORAGE_CAPS.granary.grain);
assert.equal(normalizeGranaryGrainReserve(119.6), 120);
assert.equal(normalizeGranaryGrainReserve(10_000), GRANARY_GRAIN_RESERVE_MAX);
assert.equal(granaryProtectedGrain(90, 120), 90);
assert.equal(granaryExportableGrain(150, 120), 30);
assert.equal(granaryExportableGrain(90, 120), 0);
assert.equal(grainInputTarget('watermill'), 9);
assert.equal(grainInputTarget('pastoral_farmstead'), 3);
assert.equal(grainInputTarget('watermill', 1, 25), 3);
assert.equal(grainInputTarget('watermill', 1, 50), 6);
assert.equal(grainInputTarget('watermill', 1, 75), 9);
assert.ok(
  grainInputTarget('watermill') < BUILDING_STORAGE_CAPS.watermill.grain,
  'working stock must remain much smaller than processor storage',
);
assert.ok(
  processorInputTarget(
    directlyDispatchedProcessorInputPerCycle('brewery', 'barley'),
  ) < (BUILDING_STORAGE_CAPS.brewery.barley ?? 0),
  'centralizing barley should not simply move the whole reserve into a brewhouse',
);
assert.equal(
  formatGrainWorkingBuffer(4.5, 'watermill'),
  '4 / 9 · farmstead or granary supply',
);
assert.equal(grainInputRunwayCycles('watermill', 6), 2);

function grainDestination(
  id: string,
  kind: BuildingKind,
  x: number,
  grain: number,
  assignedLabor = 2,
  processorOutputTargetPercent = 100,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    ryeGrain: grain,
    oatGrain: 0,
    maslinGrain: 0,
    assignedLabor,
    processorOutputTargetPercent,
    constructionComplete: true,
  } as BuildingState;
}

const nearMill = grainDestination('mill', 'watermill', 5, 6);
const farEmptyMill = grainDestination('far-mill', 'watermill', 60, 0);
assert.equal(grainDispatchDuty(nearMill), 'working-buffer');
assert.equal(
  selectGrainDispatchTarget(
    [nearMill, farEmptyMill],
    'farm',
    (target) => target.x,
  )?.target.id,
  farEmptyMill.id,
  'the lowest-cycle processor should beat a shorter route until working buffers recover',
);

const granary = grainDestination('granary', 'granary', 40, 0, 0);
granary.granaryGrainReserve = 120;
const feedWorkshop = grainDestination('feed-workshop', 'pastoral_farmstead', 6, 0, 1);
assert.equal(grainDispatchDuty(feedWorkshop, 1, 'oatGrain'), 'working-buffer');
assert.equal(grainDispatchDuty(feedWorkshop, 1, 'ryeGrain'), null);
assert.equal(
  selectGrainDispatchTarget(
    [feedWorkshop, granary],
    'farm',
    (target) => target.x,
    () => 1,
    () => false,
    () => true,
    'oatGrain',
  )?.target.id,
  feedWorkshop.id,
  'surplus farm oats must restore a staffed pastoral feed-workshop buffer before central storage',
);
assert.equal(
  selectGrainProcessorTarget(
    [feedWorkshop],
    'central-granary',
    (target) => target.x,
    () => 1,
    () => false,
    () => true,
    'oatGrain',
  )?.target.id,
  feedWorkshop.id,
  'granary oats must use the same pastoral processor arbitration as farm oats',
);
assert.equal(
  selectGrainProcessorTarget(
    [feedWorkshop],
    'central-granary',
    (target) => target.x,
    () => 1,
    () => false,
    () => true,
    'maslinGrain',
  ),
  null,
  'pastoral feed workshops must never request rye or maslin grain',
);
const bufferedMill = grainDestination('buffered-mill', 'watermill', 4, 12);
assert.equal(
  selectGrainDispatchTarget(
    [bufferedMill, granary],
    'farm',
    (target) => target.x,
  )?.target.id,
  granary.id,
  'central storage should beat filling a processor past its working buffer',
);
const idleMill = grainDestination('idle-mill', 'watermill', 2, 0, 0);
assert.equal(grainDispatchDuty(idleMill), 'workshop-overflow');
assert.equal(
  selectGrainDispatchTarget(
    [idleMill, granary],
    'farm',
    (target) => target.x,
  )?.target.id,
  granary.id,
  'idle workshops should not claim active input-buffer priority',
);
assert.equal(
  selectGrainDispatchTarget(
    [idleMill, bufferedMill],
    'farm',
    (target) => target.x,
  )?.target.id,
  idleMill.id,
  'workshop storage remains a last-resort outlet when no granary can receive grain',
);
const leanBufferedMill = grainDestination('lean-mill', 'watermill', 3, 3, 1, 25);
const deepBufferedMill = grainDestination('deep-mill', 'watermill', 4, 3, 1, 75);
assert.equal(
  grainDispatchDuty(leanBufferedMill),
  'workshop-overflow',
  'Lean should stop staging grain after one complete cycle',
);
assert.equal(
  grainDispatchDuty(deepBufferedMill),
  'working-buffer',
  'Deep should keep staging the same mill toward three cycles',
);
assert.equal(
  selectGrainDispatchTarget(
    [leanBufferedMill, deepBufferedMill],
    'farm',
    (target) => target.x,
  )?.target.id,
  deepBufferedMill.id,
  'policy depth should affect real grain cart eligibility',
);
assert.equal(
  selectGrainDispatchTarget(
    [nearMill, farEmptyMill],
    'farm',
    (target) => target.x,
    () => 1,
    (target) => target.id === farEmptyMill.id,
  )?.target.id,
  nearMill.id,
  'a processor with an inbound cart must not attract a duplicate grain load',
);

assert.equal(
  selectGrainProcessorTarget(
    [nearMill, farEmptyMill],
    'central-granary',
    (target) => target.x,
  )?.target.id,
  farEmptyMill.id,
  'a granary should replenish the lowest processor runway before choosing by route',
);
const highPriorityMill = {
  ...nearMill,
  id: 'high-priority-mill',
  x: 80,
  constructionPriority: 3,
};
const lowPriorityEmptyMill = {
  ...farEmptyMill,
  id: 'low-priority-mill',
  x: 5,
  constructionPriority: 1,
};
const farmPriorityDispatch = selectGrainDispatchTarget(
  [lowPriorityEmptyMill, highPriorityMill],
  'farm',
  (target) => target.x,
);
assert.equal(
  farmPriorityDispatch?.target.id,
  lowPriorityEmptyMill.id,
  'farm carts should restore the lowest runway regardless of legacy completed-building priority',
);
assert.equal(farmPriorityDispatch?.workPriority, 2);
assert.equal(
  selectGrainProcessorTarget(
    [lowPriorityEmptyMill, highPriorityMill],
    'central-granary',
    (target) => target.x,
  )?.target.id,
  lowPriorityEmptyMill.id,
  'central grain should use the same lowest-runway ordering',
);
const equalRunwayNearMill = grainDestination('equal-near', 'watermill', 5, 3);
const equalRunwayFarMill = grainDestination('equal-far', 'watermill', 50, 3);
assert.equal(
  selectGrainProcessorTarget(
    [equalRunwayFarMill, equalRunwayNearMill],
    'central-granary',
    (target) => target.x,
  )?.target.id,
  equalRunwayNearMill.id,
  'equal processor runways should use the shorter road route',
);
assert.equal(
  selectGrainProcessorTarget(
    [farEmptyMill, nearMill],
    'central-granary',
    (target) => target.x,
    () => 1,
    (target) => target.id === farEmptyMill.id,
  )?.target.id,
  nearMill.id,
  'a second granary must skip a processor that already has an inbound grain cart',
);

function processorInputDestination(
  id: string,
  kind: Extract<
    BuildingKind,
    | 'bakery'
    | 'brewery'
    | 'smokehouse'
    | 'spinning_retting_house'
    | 'weaver'
    | 'granary'
  >,
  x: number,
  stock: number,
  assignedLabor = 1,
  constructionPriority = 2,
  processorOutputTargetPercent = 100,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    ryeFlour: kind === 'bakery' || kind === 'granary' ? stock : 0,
    barley: kind === 'brewery' ? stock : 0,
    food: kind === 'smokehouse' ? stock : 0,
    wool: kind === 'spinning_retting_house' ? stock : 0,
    flax: 0,
    yarn: kind === 'weaver' ? stock : 0,
    linen: 0,
    assignedLabor,
    constructionPriority,
    processorOutputTargetPercent,
    constructionComplete: true,
  } as BuildingState;
}

const highPriorityBakery = processorInputDestination('8', 'bakery', 80, 6, 1, 3);
const lowPriorityEmptyBakery = processorInputDestination('7', 'bakery', 5, 0, 1, 1);
const priorityFlourDispatch = selectDirectProcessorInputTarget(
  [lowPriorityEmptyBakery, highPriorityBakery],
  'watermill',
  'ryeFlour',
  (target) => target.x,
);
assert.equal(
  priorityFlourDispatch?.target.id,
  lowPriorityEmptyBakery.id,
  'scarce mill flour should restore the emptiest bakery regardless of legacy priority',
);
assert.equal(priorityFlourDispatch?.desiredStock, 9);
assert.equal(priorityFlourDispatch?.runwayCycles, 0);
assert.equal(priorityFlourDispatch?.workPriority, 2);
const highPriorityBrewery = processorInputDestination(
  'brew-high',
  'brewery',
  80,
  6,
  1,
  3,
);
const lowPriorityEmptyBrewery = processorInputDestination(
  'brew-low',
  'brewery',
  5,
  0,
  1,
  1,
);
const barleyDispatch = selectDirectProcessorInputTarget(
  [lowPriorityEmptyBrewery, highPriorityBrewery],
  'farmstead',
  'barley',
  (target) => target.x,
);
assert.equal(
  barleyDispatch?.target.id,
  lowPriorityEmptyBrewery.id,
  'barley carts should restore the lowest malting runway',
);
assert.equal(barleyDispatch?.desiredStock, 9);

const bufferedHighBakery = processorInputDestination('9', 'bakery', 2, 9, 1, 3);
assert.equal(
  selectDirectProcessorInputTarget(
    [bufferedHighBakery, lowPriorityEmptyBakery],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.target.id,
  lowPriorityEmptyBakery.id,
  'an uncovered active buffer should beat higher-tier warehouse overflow',
);
const centralFlourGranary = processorInputDestination('flour-store', 'granary', 80, 0, 1, 1);
assert.equal(
  selectDirectProcessorInputTarget(
    [bufferedHighBakery, centralFlourGranary],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.target.id,
  centralFlourGranary.id,
  'once every bakery working buffer is covered, mill surplus should centralize before overfilling a bakery',
);
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPriorityEmptyBakery, centralFlourGranary],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.target.id,
  lowPriorityEmptyBakery.id,
  'an active bakery working buffer must still beat a nearer or emptier granary',
);
assert.equal(
  selectDirectProcessorInputTarget(
    [bufferedHighBakery, centralFlourGranary],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.duty,
  'central-storage',
);
const idleEmptyBakery = processorInputDestination('10', 'bakery', 1, 0, 0, 3);
assert.equal(
  selectDirectProcessorInputTarget(
    [idleEmptyBakery, lowPriorityEmptyBakery],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.target.id,
  lowPriorityEmptyBakery.id,
  'unstaffed storage should not claim active processor-buffer priority',
);
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPriorityEmptyBakery, highPriorityBakery],
    'watermill',
    'ryeFlour',
    (target) => target.x,
    (target) => target.id === highPriorityBakery.id,
  )?.target.id,
  lowPriorityEmptyBakery.id,
  'an inbound flour cart must prevent duplicate source dispatch',
);
const highPrioritySpinner = processorInputDestination(
  '12',
  'spinning_retting_house',
  50,
  3,
  1,
  3,
);
const lowPrioritySpinner = processorInputDestination(
  '11',
  'spinning_retting_house',
  5,
  0,
  1,
  1,
);
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPrioritySpinner, highPrioritySpinner],
    'pastoral-farmstead',
    'wool',
    (target) => target.x,
  )?.target.id,
  lowPrioritySpinner.id,
  'annual fleece should restore the lowest spinning-house runway',
);
const woolFirstSpinner = {
  ...processorInputDestination('wool-first', 'spinning_retting_house', 80, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_WOOL_FIRST,
};
const flaxFirstSpinner = {
  ...processorInputDestination('flax-first', 'spinning_retting_house', 5, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
};
const automaticSpinner = {
  ...processorInputDestination('automatic', 'spinning_retting_house', 2, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_AUTO,
};
const specializedWoolDispatch = selectDirectProcessorInputTarget(
  [flaxFirstSpinner, automaticSpinner, woolFirstSpinner],
  'pastoral-farmstead',
  'wool',
  (target) => target.x,
);
assert.equal(
  specializedWoolDispatch?.target.id,
  woolFirstSpinner.id,
  'equal-priority fleece carts should replenish a wool-first spinner before nearer neutral or flax-first shops',
);
assert.equal(specializedWoolDispatch?.inputPreferenceRank, 0);
assert.equal(
  selectDirectProcessorInputTarget(
    [woolFirstSpinner, automaticSpinner, flaxFirstSpinner],
    'farmstead',
    'flax',
    (target) => target.x,
  )?.target.id,
  flaxFirstSpinner.id,
  'equal-priority flax carts should replenish a flax-first retting house',
);
const highPriorityFlaxFirstSpinner = {
  ...flaxFirstSpinner,
  id: 'high-priority-flax-first',
  constructionPriority: 3,
};
const lowPriorityWoolFirstSpinner = {
  ...woolFirstSpinner,
  id: 'low-priority-wool-first',
  constructionPriority: 1,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPriorityWoolFirstSpinner, highPriorityFlaxFirstSpinner],
    'pastoral-farmstead',
    'wool',
    (target) => target.x,
  )?.target.id,
  lowPriorityWoolFirstSpinner.id,
  'raw-fibre specialization should not be overridden by legacy completed-building priority',
);
const bufferedWoolFirstSpinner = {
  ...woolFirstSpinner,
  id: 'buffered-wool-first',
  wool: 9,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [bufferedWoolFirstSpinner, flaxFirstSpinner],
    'pastoral-farmstead',
    'wool',
    (target) => target.x,
  )?.target.id,
  flaxFirstSpinner.id,
  'an uncovered fallback spinner must receive wool after the matching working buffer is covered',
);
const idleWoolFirstSpinner = {
  ...woolFirstSpinner,
  id: 'idle-wool-first',
  x: 80,
  assignedLabor: 0,
};
const idleNearFlaxFirstSpinner = {
  ...flaxFirstSpinner,
  id: 'idle-near-flax-first',
  x: 5,
  assignedLabor: 0,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [idleWoolFirstSpinner, idleNearFlaxFirstSpinner],
    'pastoral-farmstead',
    'wool',
    (target) => target.x,
  )?.target.id,
  idleNearFlaxFirstSpinner.id,
  'last-resort workshop overflow should keep using the shortest road regardless of specialization',
);

const highPriorityWeaver = processorInputDestination('prepared-12', 'weaver', 50, 2, 1, 3);
const lowPriorityWeaver = processorInputDestination('prepared-11', 'weaver', 5, 0, 1, 1);
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPriorityWeaver, highPriorityWeaver],
    'spinning-retting-house',
    'yarn',
    (target) => target.x,
  )?.target.id,
  lowPriorityWeaver.id,
  'prepared yarn should restore the lowest Weaver runway',
);
const yarnFirstWeaver = {
  ...processorInputDestination('yarn-first', 'weaver', 80, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_WOOL_FIRST,
};
const linenFirstWeaver = {
  ...processorInputDestination('linen-first', 'weaver', 5, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
};
const automaticWeaver = {
  ...processorInputDestination('prepared-automatic', 'weaver', 2, 0),
  weaverInputPolicy: WEAVER_INPUT_POLICY_AUTO,
};
const specializedYarnDispatch = selectDirectProcessorInputTarget(
  [linenFirstWeaver, automaticWeaver, yarnFirstWeaver],
  'spinning-retting-house',
  'yarn',
  (target) => target.x,
);
assert.equal(
  specializedYarnDispatch?.target.id,
  yarnFirstWeaver.id,
  'equal-priority yarn carts should replenish a yarn-first Weaver before nearer neutral or linen-first looms',
);
assert.equal(specializedYarnDispatch?.inputPreferenceRank, 0);
assert.equal(
  selectDirectProcessorInputTarget(
    [yarnFirstWeaver, automaticWeaver, linenFirstWeaver],
    'spinning-retting-house',
    'linen',
    (target) => target.x,
  )?.target.id,
  linenFirstWeaver.id,
  'equal-priority linen carts should replenish a linen-first Weaver',
);
const bufferedYarnFirstWeaver = {
  ...yarnFirstWeaver,
  id: 'buffered-yarn-first',
  yarn: 6,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [bufferedYarnFirstWeaver, linenFirstWeaver],
    'spinning-retting-house',
    'yarn',
    (target) => target.x,
  )?.target.id,
  linenFirstWeaver.id,
  'an uncovered fallback Weaver must receive yarn after the matching working buffer is covered',
);
const idleYarnFirstWeaver = {
  ...yarnFirstWeaver,
  id: 'idle-yarn-first',
  x: 80,
  assignedLabor: 0,
};
const idleNearLinenFirstWeaver = {
  ...linenFirstWeaver,
  id: 'idle-near-linen-first',
  x: 5,
  assignedLabor: 0,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [idleYarnFirstWeaver, idleNearLinenFirstWeaver],
    'spinning-retting-house',
    'yarn',
    (target) => target.x,
  )?.target.id,
  idleNearLinenFirstWeaver.id,
  'prepared-fibre overflow should keep using the shortest road regardless of specialization',
);
const highPrioritySmokehouse = processorInputDestination('14', 'smokehouse', 50, 3, 1, 3);
const lowPrioritySmokehouse = processorInputDestination('13', 'smokehouse', 5, 0, 1, 1);
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPrioritySmokehouse, highPrioritySmokehouse],
    'granary',
    'food',
    (target) => target.x,
  )?.target.id,
  lowPrioritySmokehouse.id,
  'granary and swine food carts should restore the lowest preservation runway first',
);
const leanBakery = processorInputDestination('15', 'bakery', 3, 3, 1, 2, 25);
const deepBakery = processorInputDestination('16', 'bakery', 4, 3, 1, 2, 75);
assert.equal(
  selectDirectProcessorInputTarget(
    [leanBakery, deepBakery],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.target.id,
  deepBakery.id,
  'a one-cycle Lean bakery should stop claiming flour while a Deep bakery keeps staging',
);
assert.equal(
  selectDirectProcessorInputTarget(
    [leanBakery],
    'watermill',
    'ryeFlour',
    (target) => target.x,
  )?.desiredStock,
  BUILDING_STORAGE_CAPS.bakery.flour,
  'covered Lean workshops remain eligible only as ordinary overflow storage',
);

const perfTargets = Array.from({ length: 100_000 }, (_, index) =>
  grainDestination(`granary-${index}`, 'granary', 100_000 - index, 0, 1));
const perfStart = performance.now();
const perfSelected = selectGrainDispatchTarget(
  perfTargets,
  'farm',
  (target) => target.x,
);
const perfElapsed = performance.now() - perfStart;
assert.equal(perfSelected?.target.id, 'granary-99999');
assert.ok(perfElapsed < 150, `100k grain destinations took ${perfElapsed.toFixed(1)}ms`);

const processorPerfTargets = Array.from({ length: 100_000 }, (_, index) =>
  grainDestination(`mill-${index}`, 'watermill', 100_000 - index, 0, 1));
const processorPerfStart = performance.now();
const processorPerfSelected = selectGrainProcessorTarget(
  processorPerfTargets,
  'central-granary',
  (target) => target.x,
);
const processorPerfElapsed = performance.now() - processorPerfStart;
assert.equal(processorPerfSelected?.target.id, 'mill-99999');
assert.ok(
  processorPerfElapsed < 150,
  `100k central processor candidates took ${processorPerfElapsed.toFixed(1)}ms`,
);

const processorInputPerfTargets = Array.from({ length: 100_000 }, (_, index) =>
  processorInputDestination(String(index), 'bakery', 100_000 - index, 0));
const processorInputPerfStart = performance.now();
const processorInputPerfSelected = selectDirectProcessorInputTarget(
  processorInputPerfTargets,
  'watermill',
  'ryeFlour',
  (target) => target.x,
);
const processorInputPerfElapsed = performance.now() - processorInputPerfStart;
assert.equal(processorInputPerfSelected?.target.id, '99999');
assert.ok(
  processorInputPerfElapsed < 150,
  `100k direct processor-input candidates took ${processorInputPerfElapsed.toFixed(1)}ms`,
);

const reservePerfBuildings = new Map(
  perfTargets.map((building) => [
    building.id,
    { ...building, ryeGrain: 150, granaryGrainReserve: 120 },
  ]),
);
const reservePerfStart = performance.now();
const reservePerfSummary = computeSettlementGranaryReserve({
  buildings: reservePerfBuildings,
} as import('../src/resources/types.ts').GameState);
const reservePerfElapsed = performance.now() - reservePerfStart;
assert.equal(reservePerfSummary.granaries, 100_000);
assert.equal(reservePerfSummary.protectedStock, 12_000_000);
assert.equal(reservePerfSummary.processorAndTradeSurplus, 3_000_000);
assert.ok(
  reservePerfElapsed < 150,
  `100k-granary reserve ledger took ${reservePerfElapsed.toFixed(1)}ms`,
);

const functionSection = (name: string, nextName: string): string => {
  const start = expandedSimulation.indexOf(`pub fn ${name}`);
  const end = expandedSimulation.indexOf(`pub fn ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source section should exist`);
  return expandedSimulation.slice(start, end);
};

const watermillStep = functionSection(
  'step_watermill',
  'step_industrial_firewood_dispatch',
);
assert.doesNotMatch(watermillStep, /request_connected_commodity/);
assert.match(watermillStep, /step_processor/);
assert.match(watermillStep, /CommodityKind::RyeFlour/);
assert.doesNotMatch(watermillStep, /CommodityKind::OatFlour/);
assert.match(watermillStep, /CommodityKind::MaslinFlour/);
assert.doesNotMatch(watermillStep, /CommodityKind::Flour\b/);

const breweryStepStart = expandedSimulation.indexOf('pub fn step_brewery');
const breweryStepEnd = expandedSimulation.indexOf('\nfn brewery_output_headroom', breweryStepStart);
assert.ok(breweryStepStart >= 0 && breweryStepEnd > breweryStepStart);
const breweryStep = expandedSimulation.slice(breweryStepStart, breweryStepEnd);
assert.doesNotMatch(
  breweryStep,
  /request_connected_commodity[\s\S]*CommodityKind::Firewood/,
  'brewhouses must not pull fuel in processor update order',
);
assert.match(
  expandedSimulation,
  /step_industrial_firewood_dispatch[\s\S]*CommodityKind::Firewood[\s\S]*INDUSTRIAL_FIREWOOD_TARGET_KINDS/,
  'source-side household-cleared fuel dispatch must replenish brewhouse buffers',
);
assert.match(breweryStep, /step_processor/);
assert.match(
  breweryStep,
  /CommodityKind::Barley,\s*BREWERY_BARLEY_PER_MALT_CYCLE[\s\S]*CommodityKind::Malt,\s*BREWERY_MALT_PER_CYCLE[\s\S]*CommodityKind::Malt,\s*BREWERY_MALT_PER_ALE_CYCLE[\s\S]*CommodityKind::Ale,\s*BREWERY_ALE_PER_CYCLE/,
  'authoritative brewing must physically malt barley before making ale',
);

const monasteryStep = functionSection('step_monastery', 'step_carpenter');
assert.match(monasteryStep, /request_monastery_seed_archive/);
assert.doesNotMatch(monasteryStep, /CommodityKind::Porridge|MONASTERY_OAT_GRAIN_PER_CYCLE/);

assert.match(
  supplyPolicy,
  /pub const GRAIN_PROCESSOR_KINDS: &\[&str\] = &\["pastoral_farmstead", "watermill", "windmill"\]/,
  'central grain arbitration must share one authoritative processor list',
);
assert.match(supplyPolicy, /pub const GRAIN_CRITICAL_RUNWAY_CYCLES: f64 = 1\.0/);
assert.match(supplyPolicy, /pub fn compare_grain_dispatch_candidates/);
assert.match(supplyPolicy, /pub fn grain_work_priority/);
assert.match(supplyPolicy, /pub fn select_grain_dispatch_candidate/);
assert.match(supplyPolicy, /processor_input_staging_cycles\(processor_output_target_percent\)/);
assert.match(supplyPolicy, /pub enum ProcessorInputDispatchDuty/);
assert.match(supplyPolicy, /pub fn select_processor_input_dispatch_candidate/);
assert.match(supplyPolicy, /pub fn select_seed_grain_delivery_candidate/);
assert.match(supplyPolicy, /compare_seed_grain_delivery_candidates/);
assert.match(
  expandedSimulation,
  /target\.assigned_labor == 0/,
  'routine pull-based targets still require assigned labor',
);

assert.match(expandedInspector, /Automatic routing/);
assert.doesNotMatch(
  expandedInspector,
  /Central grain reserve|data-granary-grain-reserve|Next seed cart|Next grain cart|Next preservation buffer/,
);
assert.match(expandedInspector, /Grain working buffer/);
assert.match(expandedInspector, /getNextFarmGrainDispatch/);
assert.match(expandedInspector, /getNextFarmBarleyDispatch/);
assert.match(expandedInspector, /getNextGranaryGrainDispatch/);
assert.match(expandedInspector, /Waiting for an assigned granary hauler/);
assert.doesNotMatch(expandedInspector, /staffingPriorityLabel|processor work priority/);
assert.match(expandedInspector, /getNextDirectProcessorInputDispatch/);
assert.match(expandedInspector, /central flour reserve after active bakery buffers/);
assert.match(expandedInspector, /emergency overflow because no granary can receive flour/);
assert.match(expandedInspector, /Spring crop labor/);
assert.match(expandedInspector, /Seed grain/);
assert.match(expandedInspector, /Barley seed/);
assert.match(expandedInspector, /onsite.*inbound/);
assert.match(expandedInspector, /Seed cart inbound/);
assert.match(expandedInspector, /Linked-field seed/);
assert.match(processorStatus, /farmstead or granary deliveries may supply/);

const farmsteadStep = functionSection('step_threshing_barn', 'step_watermill');
assert.match(farmsteadStep, /dispatch_farmstead_typed_grain/);
assert.doesNotMatch(farmsteadStep, /request_connected_seed_grain/);
assert.match(
  farmsteadStep,
  /dispatch_to_building\([\s\S]{0,200}CommodityKind::Flax,[\s\S]{0,80}&\["spinning_retting_house", "granary"\]/,
  'field flax must leave the threshing barn as its distinct physical commodity for retting or granary storage',
);
assert.doesNotMatch(
  farmsteadStep,
  /dispatch_to_building\([\s\S]{0,200}CommodityKind::Grain/,
  'farm grain must keep using the seed-reserve-aware dispatch path',
);
const seedDistribution = expandedSimulation.slice(
  expandedSimulation.indexOf('pub fn step_seed_grain_distribution'),
  expandedSimulation.indexOf('pub fn step_watermill'),
);
assert.match(seedDistribution, /source_ids\.sort_unstable\(\)/);
assert.match(seedDistribution, /select_seed_grain_delivery_candidate/);
assert.match(seedDistribution, /&\["threshing_barn"\]/);
assert.match(seedDistribution, /target\.assigned_labor == 0/);
assert.match(seedDistribution, /building_has_inbound_commodity_trip/);
assert.match(seedDistribution, /farmstead_seed_grain_remaining\(&fields\)\.for_commodity\(commodity\)/);
assert.match(seedDistribution, /source\.kind == "trading_post" && source\.assigned_labor == 0/);
assert.match(seedDistribution, /GRAIN_TRANSFER_PER_TRIP/);
assert.match(
  seedDistribution,
  /let request = \(target\.required - building_commodity_stock\(&target\.building, commodity\)\)/,
  'seed carts must load only the selected holding shortfall',
);
const marketStepIndex = simulationReducer.indexOf('step_marketplace_caravans(ctx');
const seedStepIndex = simulationReducer.indexOf('step_seed_grain_distribution(ctx');
const regionalMarketStepIndex = simulationReducer.indexOf('step_regional_markets(ctx');
assert.ok(
  marketStepIndex >= 0
    && marketStepIndex < seedStepIndex
    && seedStepIndex < regionalMarketStepIndex,
  'standing imports and routine market work must resolve before one deterministic seed-distribution pass',
);
const farmsteadDispatch = expandedSimulation.slice(
  expandedSimulation.indexOf('fn dispatch_farmstead_typed_grain'),
  expandedSimulation.indexOf('fn dispatch_farmstead_barley'),
);
assert.match(farmsteadDispatch, /CommodityKind::RyeGrain/);
assert.match(farmsteadDispatch, /CommodityKind::OatGrain/);
assert.match(farmsteadDispatch, /CommodityKind::MaslinGrain/);
assert.match(farmsteadDispatch, /reserves\.for_commodity/);
assert.doesNotMatch(farmsteadDispatch, /CommodityKind::OatGrain[\s\S]*"monastery"/);
assert.match(farmsteadDispatch, /dispatch_to_building_where_limited/);
const granaryDispatch = expandedSimulation.slice(
  expandedSimulation.indexOf('fn next_granary_grain_dispatch'),
  expandedSimulation.indexOf('pub(crate) fn dispatch_to_building'),
);
assert.match(granaryDispatch, /source\.assigned_labor <= 1/);
assert.match(granaryDispatch, /select_grain_dispatch_candidate/);
assert.match(granaryDispatch, /CommodityKind::RyeGrain/);
assert.match(granaryDispatch, /CommodityKind::OatGrain/);
assert.match(granaryDispatch, /CommodityKind::MaslinGrain/);
assert.match(
  granaryDispatch,
  /tick\.building_disabled_by_fire\(ctx, target\.id\)/,
  'granary grain must reroute around fire-disabled processors',
);
assert.match(granaryDispatch, /CONSTRUCTION_PRIORITY_NORMAL/);
assert.match(granaryDispatch, /GRAIN_PROCESSOR_KINDS/);
assert.match(granaryDispatch, /building_has_inbound_supply_trip/);
assert.match(granaryDispatch, /processor_accepts_input\(&target, commodity\)/);
assert.match(granaryDispatch, /granary_typed_grain_surplus\(source, commodity\)/);
assert.match(granaryDispatch, /fn dispatch_granary_grain/);
const granaryStep = expandedSimulation.slice(
  expandedSimulation.indexOf('pub fn step_granary'),
  expandedSimulation.indexOf('fn step_farmstead_fields'),
);
const criticalDispatchIndex = granaryStep.indexOf('if grain_is_critical');
const foodDutyIndex = granaryStep.indexOf('for duty in granary_dispatch_order');
const routineDispatchIndex = granaryStep.indexOf('if !grain_is_critical');
assert.ok(
  criticalDispatchIndex >= 0
    && criticalDispatchIndex < foodDutyIndex
    && foodDutyIndex < routineDispatchIndex,
  'critical processor grain must preempt food while routine grain waits behind food duty',
);
assert.match(expandedSimulation, /fn connected_source_surplus/);
assert.match(expandedSimulation, /directly_dispatched_processor_input_per_cycle/);
assert.match(expandedSimulation, /processor_input_per_cycle_for_dispatch\(target_kind, commodity\)/);
assert.match(supplyPolicy, /\("bakery", "ryeFlour" \| "maslinFlour"\)/);
assert.match(supplyPolicy, /\("brewery", "barley"\)/);
assert.match(supplyPolicy, /\("smokehouse", "food" \| "meat" \| "fish" \| "milk"\)/);
assert.match(supplyPolicy, /\("spinning_retting_house", "wool"\)/);
assert.match(supplyPolicy, /\("spinning_retting_house", "flax"\)/);
assert.match(supplyPolicy, /\("spinning_retting_house", "water"\)/);
assert.match(supplyPolicy, /\("weaver", "yarn"\)/);
assert.match(supplyPolicy, /\("weaver", "linen"\)/);
assert.match(
  supplyPolicy,
  /\("pastoral_farmstead", "oatGrain"\) => LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE/,
  'authoritative grain arbitration must recognize pastoral oats as a direct processor input',
);
assert.match(expandedSimulation, /select_processor_input_dispatch_candidate/);
assert.match(
  expandedSimulation,
  /CONSTRUCTION_PRIORITY_NORMAL/,
  'source-dispatched flour, fresh food, raw fibre, and prepared fibre must use neutral operating order',
);
const spinningRettingStep = functionSection('step_spinning_retting_house', 'step_weaver');
assert.match(spinningRettingStep, /weaver_uses_flax/);
assert.match(
  spinningRettingStep,
  /CommodityKind::Flax,[\s\S]{0,100}SPINNING_RETTING_FLAX_PER_CYCLE[\s\S]{0,140}CommodityKind::Water,[\s\S]{0,100}SPINNING_RETTING_FLAX_WATER_PER_CYCLE/,
  'the retting route must consume both physical flax and water',
);
assert.match(
  spinningRettingStep,
  /CommodityKind::Linen, SPINNING_RETTING_LINEN_PER_CYCLE/,
  'the wet fibre route must yield prepared linen',
);
assert.match(
  spinningRettingStep,
  /CommodityKind::Wool, SPINNING_RETTING_WOOL_PER_CYCLE/,
  'the dry fibre route must consume wool',
);
assert.match(
  spinningRettingStep,
  /CommodityKind::Yarn, SPINNING_RETTING_YARN_PER_CYCLE/,
  'the dry fibre route must yield yarn',
);
assert.match(
  spinningRettingStep,
  /for commodity in \[CommodityKind::Yarn, CommodityKind::Linen\][\s\S]*&\["weaver"\][\s\S]*&\["village_storehouse"\][\s\S]*&\["trading_post"\]/,
  'prepared fibres must travel physically to Weavers, storage, or regional trade',
);
const weaverStep = functionSection('step_weaver', 'step_tannery');
assert.match(weaverStep, /weaver_uses_linen/);
assert.match(weaverStep, /CommodityKind::Yarn, WEAVER_YARN_PER_CYCLE/);
assert.match(weaverStep, /CommodityKind::Linen, WEAVER_LINEN_PER_CYCLE/);
assert.match(
  weaverStep,
  /CommodityKind::Cloth, WEAVER_CLOTH_PER_CYCLE/,
  'the Weaver must turn either prepared-fibre route into finished clothing',
);
assert.match(
  expandedSimulation,
  /\("trading_post", CommodityKind::Wool \| CommodityKind::Flax\)[\s\S]{0,120}\["spinning_retting_house", "village_storehouse"\]/,
  'imported raw fibres must stage at the fibre workshop or the correct storehouse',
);
assert.match(
  expandedSimulation,
  /\("trading_post", CommodityKind::Yarn \| CommodityKind::Linen\)[\s\S]{0,120}\["weaver", "village_storehouse"\]/,
  'imported prepared fibres must stage at the Weaver or the correct storehouse',
);
assert.match(expandedSimulation, /granary_typed_grain_surplus\(source, commodity\)/);
assert.doesNotMatch(expandedSimulation, /fn request_connected_seed_grain/);
assert.match(expandedSimulation, /farmstead_seed_grain_remaining\(&fields\)\.for_commodity\(commodity\)/);
assert.match(tickContext, /farmstead_seed_reserves:[\s\S]{0,80}RefCell<HashMap<Identity, HashMap<u64, FarmsteadSeedReserves>>>/);
assert.match(tickContext, /pub fn farmstead_seed_reserve_for/);
assert.match(tickContext, /farm_field\(\)\.owner\(\)\.filter\(&owner\)/);
assert.match(
  tradingPostTrade,
  /granary_exportable_grain\(stock, protected\)/,
  'market-accessible grain must exclude the protected granary floor',
);
assert.match(worldQueries, /getNextDirectProcessorInputDispatch/);
assert.match(worldQueries, /getNextFarmFlaxDispatch/);
assert.match(worldQueries, /selectDirectProcessorInputTarget/);
assert.match(
  worldQueries,
  /getNextFarmGrainDispatch[\s\S]*target\.kind !== 'pastoral_farmstead'[\s\S]*target\.animalFeed/,
  'client farm previews must route oats to pastoral workshops only while finished-feed storage has room',
);
assert.match(worldQueries, /private \*fireEnabledBuildings/);

const shortReserveSummary = computeSettlementGranaryReserve({
  buildings: new Map([
    ['10', { ...granary, id: '10', ryeGrain: 30, granaryGrainReserve: 120 }],
    ['2', { ...granary, id: '2', ryeGrain: 30, granaryGrainReserve: 120 }],
    ['20', { ...granary, id: '20', ryeGrain: 90, granaryGrainReserve: 120 }],
  ]),
} as import('../src/resources/types.ts').GameState);
assert.equal(
  shortReserveSummary.firstShortGranaryId,
  '2',
  'equal reserve coverage should select the stable server-order granary id',
);

const reserveSummary = computeSettlementGranaryReserve({
  buildings: new Map([
    ['granary', { ...granary, ryeGrain: 150, granaryGrainReserve: 120 }],
    ['unfinished', {
      ...granary,
      id: 'unfinished',
      ryeGrain: 420,
      granaryGrainReserve: 420,
      constructionComplete: false,
    }],
  ]),
} as import('../src/resources/types.ts').GameState);
assert.deepEqual(reserveSummary, {
  granaries: 1,
  grainStored: 150,
  reserveTarget: 120,
  protectedStock: 120,
  reserveShortfall: 0,
  processorAndTradeSurplus: 30,
  firstShortGranaryId: null,
});

console.log(
  `central grain logistics tests passed (${perfElapsed.toFixed(1)}ms for 100k destinations; `
  + `${processorPerfElapsed.toFixed(1)}ms for 100k processor candidates; `
  + `${processorInputPerfElapsed.toFixed(1)}ms for 100k direct input candidates; `
  + `${reservePerfElapsed.toFixed(1)}ms for 100k reserve rows)`,
);
