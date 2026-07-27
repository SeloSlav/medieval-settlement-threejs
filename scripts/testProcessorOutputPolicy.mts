import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  isProcessorOutputTargetKind,
  normalizeProcessorOutputTargetPercent,
  PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES,
  PROCESSOR_OUTPUT_TARGET_KINDS,
  PROCESSOR_OUTPUT_TARGET_PRESETS,
  processorAcceptsInput,
  processorInputStagingCycles,
  processorNeedsInputs,
  processorOutputCommodity,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
} from '../src/economy/processorOutputPolicy.ts';
import { selectGrainProcessorTarget } from '../src/logistics/grainLogistics.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

function processor(
  id: string,
  kind: BuildingKind,
  targetPercent = 100,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    grain: 0,
    flour: 0,
    food: 0,
    ale: 0,
    preservedFood: 0,
    cloth: 0,
    wool: 0,
    water: 0,
    firewood: 0,
    assignedLabor: 1,
    constructionComplete: true,
    processorOutputTargetPercent: targetPercent,
  } as BuildingState;
}

assert.deepEqual(
  PROCESSOR_OUTPUT_TARGET_KINDS,
  ['watermill', 'granary', 'brewery', 'smokehouse', 'weaver'],
);
assert.equal(normalizeProcessorOutputTargetPercent(undefined), 100);
assert.equal(normalizeProcessorOutputTargetPercent(0), 100);
assert.equal(PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES, 3);
assert.deepEqual(
  PROCESSOR_OUTPUT_TARGET_PRESETS.map((preset) => [
    preset.percent,
    processorInputStagingCycles(preset.percent),
  ]),
  [[25, 1], [50, 2], [75, 3], [100, 3]],
);
assert.equal(processorInputStagingCycles(undefined), 3);
assert.equal(processorInputStagingCycles(0), 3);
for (const percent of [25, 50, 75, 100]) {
  assert.equal(normalizeProcessorOutputTargetPercent(percent), percent);
}
assert.equal(isProcessorOutputTargetKind('watermill'), true);
assert.equal(isProcessorOutputTargetKind('monastery'), false);
assert.equal(processorOutputCommodity('watermill'), 'flour');
assert.equal(processorOutputCommodity('granary'), 'food');
assert.equal(processorOutputCommodity('brewery'), 'ale');
assert.equal(processorOutputCommodity('smokehouse'), 'preservedFood');
assert.equal(processorOutputCommodity('weaver'), 'cloth');

const mill = processor('mill', 'watermill', 25);
assert.equal(processorOutputTargetForBuilding(mill), 65);
mill.flour = 62;
assert.equal(processorOutputHeadroom(mill), 3);
assert.equal(processorNeedsInputs(mill), true);
assert.equal(processorAcceptsInput(mill, 'grain'), true);
mill.flour = 65;
assert.equal(processorOutputHeadroom(mill), 0);
assert.equal(processorNeedsInputs(mill), false);
assert.equal(processorAcceptsInput(mill, 'grain'), false);

const granary = processor('granary', 'granary', 25);
granary.food = processorOutputTargetForBuilding(granary) ?? 0;
assert.equal(
  processorAcceptsInput(granary, 'flour'),
  false,
  'bakery flour should stop at the finished-food target',
);
assert.equal(
  processorAcceptsInput(granary, 'firewood'),
  false,
  'bakery fuel should stop at the finished-food target',
);
assert.equal(
  processorAcceptsInput(granary, 'water'),
  false,
  'well carts should stop supplying a paused bakery',
);
assert.equal(
  processorAcceptsInput(granary, 'food'),
  true,
  'fresh-food centralization must remain governed by its independent intake target',
);

const smokehouse = processor('smokehouse', 'smokehouse', 25);
smokehouse.preservedFood = processorOutputTargetForBuilding(smokehouse) ?? 0;
assert.equal(processorAcceptsInput(smokehouse, 'food'), false);
assert.equal(processorAcceptsInput(smokehouse, 'firewood'), false);
assert.equal(processorAcceptsInput(smokehouse, 'grain'), true);
assert.equal(
  processorAcceptsInput(processor('monastery', 'monastery', 25), 'grain'),
  true,
  'autonomous monastery hospitality remains outside staffed workshop policy',
);

const cappedBrewery = processor('1', 'brewery', 25);
cappedBrewery.ale = processorOutputTargetForBuilding(cappedBrewery) ?? 0;
const openBrewery = processor('2', 'brewery', 25);
const selected = selectGrainProcessorTarget(
  [cappedBrewery, openBrewery],
  'central-granary',
  () => 10,
  () => 1,
  () => false,
  (target) => processorAcceptsInput(target, 'grain'),
);
assert.equal(
  selected?.target.id,
  openBrewery.id,
  'grain arbitration should skip a processor whose output target is met',
);

const candidates = Array.from({ length: 100_000 }, (_, index) => {
  const building = processor(String(index), 'brewery', 50);
  building.ale = index === 99_999
    ? 0
    : processorOutputTargetForBuilding(building) ?? 0;
  return building;
});
const started = performance.now();
let requestingInputs = 0;
for (const candidate of candidates) {
  if (processorAcceptsInput(candidate, 'grain')) requestingInputs += 1;
}
const elapsed = performance.now() - started;
assert.equal(requestingInputs, 1);
assert.ok(
  elapsed < 500,
  `100k processor target checks took ${elapsed.toFixed(1)}ms`,
);

const table = readFileSync('server/src/tables.rs', 'utf8');
const reducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const economy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const well = readFileSync('server/src/simulation/well.rs', 'utf8');
const generatedTable = readFileSync('src/generated/building_table.ts', 'utf8');
const generatedReducer = readFileSync(
  'src/generated/set_processor_output_target_reducer.ts',
  'utf8',
);
const sync = readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const inspector = readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);

assert.match(
  table,
  /#\[default\(100u8\)\]\s*pub processor_output_target_percent: u8/,
);
assert.match(
  reducer,
  /set_processor_output_target[\s\S]*is_valid_processor_output_target_percent[\s\S]*is_processor_output_target_kind[\s\S]*processor_output_target_percent = target_percent/,
);
assert.match(
  economy,
  /process_batch\([\s\S]*output_target_percent: Option<u8>[\s\S]*processor_output_headroom/,
);
assert.match(
  economy,
  /processor_accepts_input\(&target, CommodityKind::Grain\)/,
);
assert.match(economy, /!processor_accepts_input\(&target, commodity\)/);
assert.match(economy, /!processor_accepts_input\(target, commodity\)/);
assert.match(
  well,
  /!processor_accepts_input\(&candidate, CommodityKind::Water\)/,
);
assert.match(generatedTable, /processorOutputTargetPercent:[\s\S]*processor_output_target_percent/);
assert.match(generatedReducer, /buildingId:[\s\S]*targetPercent/);
assert.match(sync, /processorOutputTargetPercent: row\.processorOutputTargetPercent/);
assert.match(inspector, /data-processor-output-target/);
assert.match(inspector, /stages \$\{stagingLabel\}/);
assert.match(inspector, /sets both the on-site input staging depth and the finished-goods ceiling/);
assert.match(inspector, /Routine input top-ups stop at the staged-cycle target/);
assert.match(inspector, /last-resort overflow when normal storage cannot receive its cargo/);

console.log(
  `processor output policy tests passed (${elapsed.toFixed(1)}ms for 100k checks)`,
);
