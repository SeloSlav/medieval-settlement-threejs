import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  EXTRACTION_OUTPUT_TARGET_KINDS,
  extractionAcceptsMaintenance,
  extractionOutputCommodity,
  extractionOutputHeadroom,
  extractionOutputTarget,
  isExtractionOutputTargetKind,
  isProcessorOutputTargetKind,
  normalizeProcessorOutputTargetPercent,
  PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES,
  PROCESSOR_OUTPUT_TARGET_KINDS,
  processorAcceptsInput,
  processorInputCommodities,
  processorInputStagingCycles,
  processorNeedsInputs,
  processorOutputCommodity,
  processorOutputCommodityForBuilding,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
} from '../src/economy/processorOutputPolicy.ts';
import {
  BREWERY_RECIPE_AUTO,
  BREWERY_RECIPE_CIDER,
  BREWERY_RECIPE_MEAD,
  selectedBreweryRecipePolicy,
} from '../src/economy/breweryRecipePolicy.ts';
import {
  SMOKEHOUSE_RECIPE_AUTO,
  SMOKEHOUSE_RECIPE_CHEESE,
  SMOKEHOUSE_RECIPE_CURED_MEAT,
  SMOKEHOUSE_RECIPE_SMOKED_FISH,
  normalizeSmokehouseRecipePolicy,
  selectedSmokehouseRecipePolicy,
  smokehouseRecipeRequestsInput,
} from '../src/economy/smokehouseRecipePolicy.ts';
import {
  BREWERY_APPLES_PER_CIDER_CYCLE,
  BREWERY_CIDER_PER_CYCLE,
  BREWERY_HONEY_PER_MEAD_CYCLE,
  BREWERY_MEAD_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import { selectDirectProcessorInputTarget } from '../src/logistics/processorInputLogistics.ts';
import { renderProcessorOutputTargetPanel } from '../src/resources/inspector/expandedBuildingRenderer.ts';
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
    ryeGrain: 0,
    oatGrain: 0,
    maslinGrain: 0,
    barley: 0,
    malt: 0,
    ryeFlour: 0,
    maslinFlour: 0,
    food: 0,
    ryeBread: 0,
    maslinBread: 0,
    ale: 0,
    cider: 0,
    mead: 0,
    apples: 0,
    honey: 0,
    wax: 0,
    candles: 0,
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
  [
    'watermill',
    'windmill',
    'bakery',
    'brewery',
    'smokehouse',
    'spinning_retting_house',
    'weaver',
    'charcoal_burner',
    'smithy',
    'potter_kiln',
    'tannery',
    'cobbler',
    'chandlery',
  ],
);
assert.equal(normalizeProcessorOutputTargetPercent(undefined), 100);
assert.equal(normalizeProcessorOutputTargetPercent(0), 100);
assert.equal(PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES, 3);
for (const legacyPercent of [25, 50, 75, 100]) {
  assert.equal(processorInputStagingCycles(legacyPercent), 3);
}
assert.equal(processorInputStagingCycles(undefined), 3);
assert.equal(processorInputStagingCycles(0), 3);
for (const legacyPercent of [25, 50, 75, 100]) {
  assert.equal(normalizeProcessorOutputTargetPercent(legacyPercent), 100);
}
assert.equal(isProcessorOutputTargetKind('watermill'), true);
assert.equal(isProcessorOutputTargetKind('windmill'), true);
assert.equal(isProcessorOutputTargetKind('monastery'), false);
assert.deepEqual(
  EXTRACTION_OUTPUT_TARGET_KINDS,
  ['stone_quarry', 'large_quarry', 'mine', 'clay_pit'],
);
for (const kind of EXTRACTION_OUTPUT_TARGET_KINDS) {
  assert.equal(isExtractionOutputTargetKind(kind), true);
  assert.equal(isProcessorOutputTargetKind(kind), false);
}
assert.equal(processorOutputCommodity('watermill'), 'flour');
assert.equal(processorOutputCommodity('windmill'), 'flour');
assert.equal(processorOutputCommodity('bakery'), 'bread');
assert.equal(processorOutputCommodity('brewery'), 'ale');
assert.equal(processorOutputCommodity('smokehouse'), 'preservedFood');
assert.equal(processorOutputCommodity('weaver'), 'cloth');
assert.equal(processorOutputCommodity('charcoal_burner'), 'charcoal');
assert.equal(processorOutputCommodity('smithy'), 'ironwork');
assert.equal(processorOutputCommodity('potter_kiln'), 'pottery');
assert.equal(processorOutputCommodity('tannery'), 'leather');
assert.equal(processorOutputCommodity('cobbler'), 'shoes');
assert.equal(processorOutputCommodity('chandlery'), 'candles');
assert.equal(BREWERY_APPLES_PER_CIDER_CYCLE, 4);
assert.equal(BREWERY_CIDER_PER_CYCLE, 1);
assert.equal(BREWERY_HONEY_PER_MEAD_CYCLE, 1);
assert.equal(BREWERY_MEAD_PER_CYCLE, 1);
const ciderBrewery = processor('cider-brewery', 'brewery');
ciderBrewery.breweryRecipePolicy = BREWERY_RECIPE_CIDER;
assert.equal(processorOutputCommodityForBuilding(ciderBrewery), 'cider');
const meadBrewery = processor('mead-brewery', 'brewery');
meadBrewery.breweryRecipePolicy = BREWERY_RECIPE_MEAD;
assert.equal(processorOutputCommodityForBuilding(meadBrewery), 'mead');
assert.equal(
  selectedBreweryRecipePolicy(BREWERY_RECIPE_AUTO, { barley: 3, apples: 8, honey: 1 }),
  BREWERY_RECIPE_CIDER,
  'Auto must choose the greatest complete-batch readiness',
);
const breweryRecipePanel = renderProcessorOutputTargetPanel(processor('brewery-panel', 'brewery'));
assert.match(breweryRecipePanel ?? '', /resource-action-button--icon/);
assert.match(breweryRecipePanel ?? '', /data-brewery-recipe-policy="0"[^>]*data-tooltip="3 barley \+ 3 water \+ 1 firewood → 4 ale"/);
assert.match(breweryRecipePanel ?? '', /data-brewery-recipe-policy="1"[^>]*data-tooltip="4 apples → 1 apple cider"/);
assert.match(breweryRecipePanel ?? '', /data-brewery-recipe-policy="4"[^>]*data-tooltip="4 pears → 1 pear cider"/);
assert.match(breweryRecipePanel ?? '', /data-brewery-recipe-policy="2"[^>]*data-tooltip="1 honey → 1 mead"/);
const recipeSmokehouse = processor('smokehouse-panel', 'smokehouse');
recipeSmokehouse.meat = 3;
recipeSmokehouse.fish = 6;
recipeSmokehouse.milk = 9;
recipeSmokehouse.smokehouseRecipePolicy = SMOKEHOUSE_RECIPE_AUTO;
assert.equal(normalizeSmokehouseRecipePolicy(undefined), SMOKEHOUSE_RECIPE_AUTO);
assert.equal(
  selectedSmokehouseRecipePolicy(SMOKEHOUSE_RECIPE_AUTO, recipeSmokehouse),
  SMOKEHOUSE_RECIPE_CURED_MEAT,
  'automatic smokehouse production preserves the legacy meat-first order',
);
assert.equal(smokehouseRecipeRequestsInput(SMOKEHOUSE_RECIPE_AUTO, 'meat'), true);
assert.equal(smokehouseRecipeRequestsInput(SMOKEHOUSE_RECIPE_AUTO, 'fish'), true);
assert.equal(smokehouseRecipeRequestsInput(SMOKEHOUSE_RECIPE_AUTO, 'milk'), true);
assert.equal(smokehouseRecipeRequestsInput(SMOKEHOUSE_RECIPE_SMOKED_FISH, 'fish'), true);
assert.equal(
  smokehouseRecipeRequestsInput(SMOKEHOUSE_RECIPE_SMOKED_FISH, 'meat'),
  false,
  'explicit Smokehouse focus must not create new supply demand for alternate recipes',
);
recipeSmokehouse.smokehouseRecipePolicy = SMOKEHOUSE_RECIPE_SMOKED_FISH;
assert.equal(processorOutputCommodityForBuilding(recipeSmokehouse), 'smokedFish');
recipeSmokehouse.smokehouseRecipePolicy = SMOKEHOUSE_RECIPE_CHEESE;
assert.equal(processorOutputCommodityForBuilding(recipeSmokehouse), 'cheese');
recipeSmokehouse.smokehouseRecipePolicy = SMOKEHOUSE_RECIPE_CURED_MEAT;
assert.equal(processorOutputCommodityForBuilding(recipeSmokehouse), 'curedMeat');
recipeSmokehouse.smokehouseRecipePolicy = SMOKEHOUSE_RECIPE_AUTO;
const smokehouseRecipePanel = renderProcessorOutputTargetPanel(recipeSmokehouse);
assert.match(smokehouseRecipePanel ?? '', /resource-action-button--icon/);
assert.match(smokehouseRecipePanel ?? '', /data-smokehouse-recipe-policy="0"[^>]*disabled/);
assert.match(smokehouseRecipePanel ?? '', /data-smokehouse-recipe-policy="1"[^>]*data-tooltip="3 meat \+ 1 firewood \+ 1 salt → 3 cured meat"/);
assert.match(smokehouseRecipePanel ?? '', /data-smokehouse-recipe-policy="2"[^>]*data-tooltip="3 fish \+ 1 firewood \+ 1 salt → 3 smoked fish"/);
assert.match(smokehouseRecipePanel ?? '', /data-smokehouse-recipe-policy="3"[^>]*data-tooltip="3 milk \+ 1 firewood \+ 1 salt → 3 cheese"/);
assert.equal(renderProcessorOutputTargetPanel(processor('mill-panel', 'watermill')), null);

const leanQuarry = processor('quarry', 'stone_quarry', 25);
leanQuarry.stone = 179;
assert.equal(extractionOutputTarget('stone_quarry', 'stone'), 180);
assert.equal(extractionOutputHeadroom(leanQuarry, 'stone'), 1);
assert.equal(extractionOutputCommodity('stone_quarry'), 'stone');
assert.equal(extractionOutputCommodity('large_quarry'), 'stone');
assert.equal(extractionOutputCommodity('clay_pit'), 'clay');
assert.equal(extractionOutputCommodity('mine', 'iron'), 'iron');
assert.equal(extractionOutputCommodity('mine', 'salt'), 'salt');
assert.equal(extractionOutputCommodity('mine', 'clay'), 'clay');
assert.equal(extractionOutputCommodity('mine'), null);
assert.equal(extractionAcceptsMaintenance(leanQuarry), true);
leanQuarry.stone = 180;
assert.equal(extractionOutputHeadroom(leanQuarry, 'stone'), 0);
assert.equal(
  extractionAcceptsMaintenance(leanQuarry),
  true,
  'a full quarry may still stockpile replacement tools',
);
leanQuarry.stone = 179;
assert.equal(
  extractionAcceptsMaintenance(leanQuarry),
  true,
  'drawing one unit from the yard must immediately reopen tool maintenance',
);
leanQuarry.stone = 180;
const leanIronMine = processor('iron-mine', 'mine', 25);
leanIronMine.iron = 240;
assert.equal(extractionAcceptsMaintenance(leanIronMine, 'iron'), true);
leanIronMine.iron = 239;
assert.equal(extractionAcceptsMaintenance(leanIronMine, 'iron'), true);
assert.equal(
  extractionAcceptsMaintenance(leanIronMine, null),
  false,
  'Mineworks without a rich iron, salt, or clay seam must not absorb smithy output',
);
assert.equal(extractionOutputTarget('large_quarry', 'stone'), 360);
assert.equal(extractionOutputTarget('clay_pit', 'clay'), 180);
assert.equal(extractionOutputTarget('mine', 'iron'), 240);
assert.equal(extractionOutputTarget('mine', 'salt'), 240);
assert.equal(extractionOutputTarget('mine', 'clay'), 240);
assert.equal(
  extractionOutputTarget('mine', 'salt'),
  240,
  'extraction sites must always fill their physical yards regardless of legacy policy state',
);
assert.deepEqual(
  processorInputCommodities('smithy'),
  ['iron', 'charcoal', 'water'],
  'the forge stock policy must stage the complete authoritative recipe',
);
assert.deepEqual(
  processorInputCommodities('potter_kiln'),
  ['clay', 'firewood', 'water'],
  'the pottery stock policy must stage clay, fuel, and puddling water together',
);
assert.deepEqual(processorInputCommodities('tannery'), ['hides', 'water', 'firewood']);
assert.deepEqual(processorInputCommodities('cobbler'), ['leather']);
assert.deepEqual(
  processorInputCommodities('chandlery'),
  ['wax', 'firewood'],
  'the Chandlery must stage beeswax and hearth fuel without consuming flax',
);

const mill = processor('mill', 'watermill', 25);
assert.equal(processorOutputTargetForBuilding(mill), 260);
mill.ryeFlour = 257;
assert.equal(processorOutputHeadroom(mill), 3);
assert.equal(processorNeedsInputs(mill), true);
assert.equal(processorAcceptsInput(mill, 'ryeGrain'), true);
const windmill = processor('windmill', 'windmill', 25);
assert.equal(processorOutputTargetForBuilding(windmill), 260);
assert.deepEqual(
  processorInputCommodities('windmill'),
  ['ryeGrain', 'maslinGrain'],
  'mills expose only their two genuinely millable alternative grains',
);
mill.ryeFlour = 260;
assert.equal(processorOutputHeadroom(mill), 0);
assert.equal(processorNeedsInputs(mill), false);
assert.equal(processorAcceptsInput(mill, 'ryeGrain'), false);

const bakery = processor('bakery', 'bakery', 25);
bakery.ryeBread = processorOutputTargetForBuilding(bakery) ?? 0;
assert.equal(
  processorAcceptsInput(bakery, 'ryeFlour'),
  false,
  'bakery flour should stop at physical finished-food capacity',
);
assert.equal(
  processorAcceptsInput(bakery, 'firewood'),
  false,
  'bakery fuel should stop at the finished-food target',
);
assert.equal(
  processorAcceptsInput(bakery, 'water'),
  false,
  'automatic well service should stop supplying a paused bakery',
);
assert.equal(
  processorAcceptsInput(processor('granary', 'granary', 25), 'food'),
  true,
  'fresh-food centralization must remain governed by its independent intake target',
);

const smokehouse = processor('smokehouse', 'smokehouse', 25);
smokehouse.preservedFood = processorOutputTargetForBuilding(smokehouse) ?? 0;
assert.equal(processorAcceptsInput(smokehouse, 'food'), false);
assert.equal(processorAcceptsInput(smokehouse, 'firewood'), false);
assert.equal(processorAcceptsInput(smokehouse, 'ryeGrain'), true);
assert.equal(
  processorAcceptsInput(processor('monastery', 'monastery', 25), 'oatGrain'),
  true,
  'monasteries may accept physical oats for their emergency seed archive without processing them',
);

const cappedBrewery = processor('1', 'brewery', 25);
cappedBrewery.ale = processorOutputTargetForBuilding(cappedBrewery) ?? 0;
const openBrewery = processor('2', 'brewery', 25);
assert.equal(
  processorAcceptsInput(cappedBrewery, 'firewood'),
  false,
  'a capped brewhouse must stop tying up firewood in an idle input buffer',
);
assert.equal(
  processorAcceptsInput(openBrewery, 'firewood'),
  true,
  'an open brewhouse should accept firing fuel',
);
const selected = selectDirectProcessorInputTarget(
  [cappedBrewery, openBrewery],
  'central-granary',
  'barley',
  () => 10,
  () => false,
  (target) => processorAcceptsInput(target, 'barley'),
);
assert.equal(
  selected?.target.id,
  openBrewery.id,
  'barley arbitration should skip a processor whose ale target is met',
);

const openToolQuarry = processor('open-tool-quarry', 'stone_quarry', 25);
openToolQuarry.stone = 44;
openToolQuarry.ironwork = 0;
const heldToolQuarry = processor('held-tool-quarry', 'stone_quarry', 25);
heldToolQuarry.stone = 180;
heldToolQuarry.ironwork = 0;
const extractionToolTarget = selectDirectProcessorInputTarget(
  [heldToolQuarry, openToolQuarry],
  'smithy',
  'ironwork',
  () => 10,
  () => false,
  (target) => extractionAcceptsMaintenance(target),
);
assert.equal(
  extractionToolTarget?.target.id,
  heldToolQuarry.id,
  'tool-rack stockpiling must be independent of finished-stone yard fullness',
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
  if (processorAcceptsInput(candidate, 'barley')) requestingInputs += 1;
}
const elapsed = performance.now() - started;
assert.equal(requestingInputs, 1);
assert.ok(
  elapsed < 500,
  `100k processor target checks took ${elapsed.toFixed(1)}ms`,
);

const extractionCandidates = Array.from({ length: 100_000 }, (_, index) => {
  const building = processor(`mine-${index}`, 'mine', 25);
  building.iron = index % 2 === 0 ? 240 : 239;
  return building;
});
const extractionStarted = performance.now();
let extractionOpen = 0;
for (const candidate of extractionCandidates) {
  if ((extractionOutputHeadroom(candidate, 'iron') ?? 0) > 1e-6) {
    extractionOpen += 1;
  }
}
const extractionElapsed = performance.now() - extractionStarted;
assert.equal(extractionOpen, 50_000);
assert.ok(
  extractionElapsed < 500,
  `100k extraction target checks took ${extractionElapsed.toFixed(1)}ms`,
);

const table = readFileSync('server/src/tables.rs', 'utf8');
const reducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const economy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const well = readFileSync('server/src/simulation/well.rs', 'utf8');
const generatedTable = readFileSync('src/generated/building_table.ts', 'utf8');
const sync = readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const inspector = readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
const extractionInspectors = [
  'src/resources/inspector/stoneQuarryRenderer.ts',
  'src/resources/inspector/largeQuarryRenderer.ts',
  'src/resources/inspector/mineralMineRenderer.ts',
].map((path) => readFileSync(path, 'utf8')).join('\n');
const worldQueries = readFileSync('src/resources/WorldQueries.ts', 'utf8');

assert.match(
  table,
  /#\[default\(100u8\)\]\s*pub processor_output_target_percent: u8/,
);
assert.doesNotMatch(reducer, /set_processor_output_target/);
assert.match(
  economy,
  /process_batch\([\s\S]*output_target_percent: Option<u8>[\s\S]*processor_output_headroom/,
);
assert.match(
  economy,
  /processor_accepts_input\(&target, commodity\)/,
);
assert.match(economy, /!processor_accepts_input\(&target, commodity\)/);
assert.match(economy, /!processor_accepts_input\(target, commodity\)/);
assert.match(
  economy,
  /fn processor_requests_input[\s\S]*?smokehouse_requests_food_input/,
  'active recipe demand must remain separate from physical cargo acceptance',
);
assert.match(
  economy,
  /fn dispatch_to_building_where_limited[\s\S]*?!processor_requests_input\(&target, commodity\)[\s\S]*?!processor_accepts_input\(&target, commodity\)/,
  'new generic supply trips must satisfy both focused demand and physical storage acceptance',
);
assert.match(
  well,
  /!processor_accepts_input\(&candidate, CommodityKind::Water\)/,
);
assert.match(generatedTable, /processorOutputTargetPercent:[\s\S]*processor_output_target_percent/);
assert.equal(existsSync('src/generated/set_processor_output_target_reducer.ts'), false);
assert.match(sync, /processorOutputTargetPercent: row\.processorOutputTargetPercent/);
assert.doesNotMatch(
  inspector,
  /data-processor-output-target/,
  'workshop inspectors must not expose stock-policy buttons',
);
assert.doesNotMatch(inspector, /Stock policy/);
assert.doesNotMatch(inspector, /Production policy/);
assert.match(inspector, /data-inspector-panel-title="Recipe"/);
assert.doesNotMatch(extractionInspectors, /data-processor-output-target/);
assert.doesNotMatch(inspector, /renderExtractionStockTargetPanel/);
assert.match(
  worldQueries,
  /acceptsMaterialInput[\s\S]*extractionAcceptsMaintenance/,
  'client-side cart previews must mirror authoritative maintenance gating',
);
assert.match(economy, /fn production_output_target_applies/);
assert.match(economy, /fn extraction_accepts_maintenance_input/);
assert.equal(
  (
    economy.match(
      /!extraction_accepts_maintenance_input\(ctx, &target, commodity\)/g,
    ) ?? []
  ).length,
  2,
  'authoritative candidate selection and launch revalidation must both reject tool carts to invalid extraction yards',
);
assert.match(economy, /uses_output_target/);
assert.match(economy, /process_batch\([\s\S]*Some\(target_percent\)/);

console.log(
  `processor output policy tests passed (${elapsed.toFixed(1)}ms processors; ${extractionElapsed.toFixed(1)}ms extraction for 100k checks each)`,
);
