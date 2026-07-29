import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  bulkStockpileVisualSignature,
  CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS,
  CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  CLAY_PIT_CLAY_VISUAL_SEGMENTS,
  POTTER_CLAY_VISUAL_SEGMENTS,
  POTTER_FIREWOOD_VISUAL_SEGMENTS,
  POTTER_POTTERY_VISUAL_SEGMENTS,
  SMITHY_CHARCOAL_VISUAL_SEGMENTS,
  SMITHY_IRON_VISUAL_SEGMENTS,
  SMITHY_IRONWORK_VISUAL_SEGMENTS,
  syncBulkStockpileVisuals,
} from '../src/buildings/bulkStockpileVisuals.ts';
import {
  CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CLAY_PIT_CLAY_PER_CYCLE,
  MARKETPLACE_TRADE_OFFERS,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_IRON_PER_CYCLE,
  SMITHY_IRONWORK_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import { createDeliveryCartMesh } from '../src/logistics/deliveryCartMesh.ts';
import type { DeliveryCargoKind } from '../src/logistics/deliveryTrips.ts';
import {
  assignLocalMaterialInputTargets,
  assignMarketplaceMaterialInputTargets,
  directlyDispatchedProcessorInputPerCycle,
  LOCAL_MATERIAL_SOURCE_KINDS,
  localMaterialInputCommodity,
  selectDirectProcessorInputTarget,
  selectMarketplaceMaterialInputTarget,
} from '../src/logistics/processorInputLogistics.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';
import { renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';

assert.equal(CLAY_PIT_CLAY_PER_CYCLE, 4);
assert.deepEqual(
  [CHARCOAL_BURNER_FIREWOOD_PER_CYCLE, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE],
  [3, 2],
  'charcoal must impose a meaningful net firewood cost',
);
assert.deepEqual(
  [SMITHY_IRON_PER_CYCLE, SMITHY_CHARCOAL_PER_CYCLE, SMITHY_IRONWORK_PER_CYCLE],
  [2, 1, 2],
);
assert.deepEqual(
  [POTTER_CLAY_PER_CYCLE, POTTER_FIREWOOD_PER_CYCLE, POTTER_POTTERY_PER_CYCLE],
  [3, 1, 3],
);
assert.ok(SMOKEHOUSE_SALT_PER_CYCLE > 0);
assert.ok(SMOKEHOUSE_POTTERY_PER_CYCLE > 0);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('potter_kiln', 'clay'),
  POTTER_CLAY_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smithy', 'charcoal'),
  SMITHY_CHARCOAL_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smokehouse', 'pottery'),
  SMOKEHOUSE_POTTERY_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smithy', 'iron'),
  SMITHY_IRON_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('smokehouse', 'salt'),
  SMOKEHOUSE_SALT_PER_CYCLE,
);
assert.equal(
  directlyDispatchedProcessorInputPerCycle('marketplace', 'pottery'),
  0,
  'the market is export overflow, not a pottery processor',
);

const nearbyMarket = building('marketplace', {
  id: 'near-market',
  x: 5,
  assignedLabor: 2,
});
const distantSmokehouse = building('smokehouse', {
  id: 'distant-smokehouse',
  x: 80,
  assignedLabor: 2,
  constructionPriority: 3,
  processorOutputTargetPercent: 75,
  pottery: 0,
});
const potteryBufferTarget = selectDirectProcessorInputTarget(
  [nearbyMarket, distantSmokehouse],
  'potter',
  'pottery',
  (candidate) => candidate.x,
);
assert.equal(
  potteryBufferTarget?.target.id,
  distantSmokehouse.id,
  'preservation vessels must reach a staffed smokehouse before nearer market exports',
);
assert.equal(potteryBufferTarget?.duty, 'working-buffer');
assert.equal(
  potteryBufferTarget?.desiredStock,
  SMOKEHOUSE_POTTERY_PER_CYCLE * 3,
);

distantSmokehouse.pottery = potteryBufferTarget?.desiredStock ?? 0;
const potteryExportTarget = selectDirectProcessorInputTarget(
  [nearbyMarket, distantSmokehouse],
  'potter',
  'pottery',
  (candidate) => candidate.x,
);
assert.equal(
  potteryExportTarget?.target.id,
  nearbyMarket.id,
  'pottery should become export stock once preservation buffers are covered',
);
assert.equal(potteryExportTarget?.duty, 'workshop-overflow');

const lowPriorityNearSmithy = building('smithy', {
  id: 'near-smithy',
  x: 5,
  assignedLabor: 2,
  constructionPriority: 1,
  charcoal: 0,
});
const highPriorityFarSmithy = building('smithy', {
  id: 'far-smithy',
  x: 75,
  assignedLabor: 2,
  constructionPriority: 3,
  charcoal: 0,
});
const charcoalTarget = selectDirectProcessorInputTarget(
  [lowPriorityNearSmithy, highPriorityFarSmithy],
  'burner',
  'charcoal',
  (candidate) => candidate.x,
);
assert.equal(
  charcoalTarget?.target.id,
  highPriorityFarSmithy.id,
  'forge-fuel carts must expose work priority as a real production decision',
);
assert.equal(charcoalTarget?.desiredStock, SMITHY_CHARCOAL_PER_CYCLE * 3);

const materialMarket = building('marketplace', {
  id: 'material-market',
  iron: 12,
  salt: 12,
  pottery: 12,
});
const lowPriorityIronTarget = building('smithy', {
  id: 'older-near-smithy',
  x: 5,
  assignedLabor: 2,
  constructionPriority: 1,
  iron: 0,
});
const highPrioritySaltTarget = building('smokehouse', {
  id: 'later-far-smokehouse',
  x: 80,
  assignedLabor: 2,
  constructionPriority: 3,
  salt: 0,
});
let materialRouteSolves = 0;
let marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => {
    materialRouteSolves += 1;
    return candidate.x;
  },
);
assert.equal(
  marketMaterialTarget?.target.id,
  highPrioritySaltTarget.id,
  'a later-built high-priority smokehouse must beat an older nearby low-priority smithy',
);
assert.equal(marketMaterialTarget?.commodity, 'salt');
assert.equal(marketMaterialTarget?.duty, 'working-buffer');
assert.equal(
  materialRouteSolves,
  2,
  'salt and pottery candidates for one smokehouse must share one road solve',
);

lowPriorityIronTarget.constructionPriority = 2;
lowPriorityIronTarget.iron = SMITHY_IRON_PER_CYCLE;
highPrioritySaltTarget.constructionPriority = 2;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'salt',
  'equal-priority imported inputs must serve the lower cycle runway before the shorter road',
);

highPrioritySaltTarget.salt = SMOKEHOUSE_SALT_PER_CYCLE * 3;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'pottery',
  'uncommitted market pottery must return to an uncovered preservation-vessel buffer',
);

highPrioritySaltTarget.pottery = SMOKEHOUSE_POTTERY_PER_CYCLE * 3;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'iron',
  'covered salt and pottery buffers must release the market cart to the smithy',
);

highPrioritySaltTarget.salt = 0;
highPrioritySaltTarget.assignedLabor = 0;
marketMaterialTarget = selectMarketplaceMaterialInputTarget(
  [lowPriorityIronTarget, highPrioritySaltTarget],
  materialMarket,
  (candidate) => candidate.x,
);
assert.equal(
  marketMaterialTarget?.commodity,
  'iron',
  'unstaffed workshops must not reserve scarce imported inputs',
);

highPrioritySaltTarget.assignedLabor = 2;
highPrioritySaltTarget.salt = SMOKEHOUSE_SALT_PER_CYCLE * 3;
highPrioritySaltTarget.pottery = 0;
const reservedExportPotteryTarget = selectMarketplaceMaterialInputTarget(
  [highPrioritySaltTarget],
  { ...materialMarket, iron: 0, salt: 0 },
  (candidate) => candidate.x,
  () => false,
  () => true,
  (commodity) => commodity === 'pottery',
);
assert.equal(
  reservedExportPotteryTarget,
  null,
  'pottery committed to an active market order must not be recalled to a smokehouse',
);

const olderRemoteMarket = building('marketplace', {
  id: 'older-remote-market',
  x: 0,
  iron: 12,
});
const newerNearMarket = building('marketplace', {
  id: 'newer-near-market',
  x: 90,
  iron: 12,
});
const urgentSmithy = building('smithy', {
  id: 'urgent-smithy',
  x: 100,
  assignedLabor: 2,
  constructionPriority: 3,
  iron: 0,
});
const routineSmithy = building('smithy', {
  id: 'routine-smithy',
  x: 10,
  assignedLabor: 2,
  constructionPriority: 2,
  iron: 0,
});
const materialAssignments = assignMarketplaceMaterialInputTargets(
  [olderRemoteMarket, newerNearMarket],
  [routineSmithy, urgentSmithy],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  materialAssignments.get(newerNearMarket.id)?.target.id,
  urgentSmithy.id,
  'the nearest free market must serve an equally urgent workshop regardless of market age',
);
assert.equal(
  materialAssignments.get(olderRemoteMarket.id)?.target.id,
  routineSmithy.id,
  'the remaining market cart should cover the next workshop instead of duplicating an inbound trip',
);

const mixedMaterialMarket = building('marketplace', {
  id: 'mixed-material-market',
  salt: 12,
  pottery: 12,
});
const emptySmokehouse = building('smokehouse', {
  id: 'empty-smokehouse',
  assignedLabor: 2,
  constructionPriority: 2,
  salt: 0,
  pottery: 0,
});
let mixedAssignmentRouteSolves = 0;
const mixedAssignments = assignMarketplaceMaterialInputTargets(
  [mixedMaterialMarket],
  [emptySmokehouse],
  () => {
    mixedAssignmentRouteSolves += 1;
    return 20;
  },
);
assert.equal(
  mixedAssignments.get(mixedMaterialMarket.id)?.commodity,
  'salt',
  'an exact salt/pottery tie must resolve deterministically while reserving one inbound cart slot',
);
assert.equal(
  mixedAssignmentRouteSolves,
  1,
  'salt and pottery candidates for one market/workshop pair must share one road solve',
);

assert.deepEqual(
  LOCAL_MATERIAL_SOURCE_KINDS,
  ['clay_pit', 'charcoal_burner', 'smithy', 'potter_kiln'],
);
assert.deepEqual(
  LOCAL_MATERIAL_SOURCE_KINDS.map(localMaterialInputCommodity),
  ['clay', 'charcoal', 'ironwork', 'pottery'],
);
const olderRemoteClayPit = building('clay_pit', {
  id: 'older-remote-clay-pit',
  x: 0,
  clay: 12,
});
const newerNearClayPit = building('clay_pit', {
  id: 'newer-near-clay-pit',
  x: 90,
  clay: 12,
});
const urgentPotter = building('potter_kiln', {
  id: 'urgent-potter',
  x: 100,
  assignedLabor: 2,
  constructionPriority: 3,
  clay: 0,
});
const routinePotter = building('potter_kiln', {
  id: 'routine-potter',
  x: 10,
  assignedLabor: 2,
  constructionPriority: 2,
  clay: 0,
});
const localMaterialAssignments = assignLocalMaterialInputTargets(
  [olderRemoteClayPit, newerNearClayPit],
  [routinePotter, urgentPotter],
  (source, target) => Math.abs(source.x - target.x),
);
assert.equal(
  localMaterialAssignments.get(newerNearClayPit.id)?.target.id,
  urgentPotter.id,
  'the nearest clay cart must cover an equally urgent kiln regardless of producer age',
);
assert.equal(
  localMaterialAssignments.get(olderRemoteClayPit.id)?.target.id,
  routinePotter.id,
  'the remaining clay cart must cover the next kiln without duplicating its inbound slot',
);

for (const offerId of ['buy_iron', 'buy_salt', 'sell_pottery']) {
  assert.ok(
    MARKETPLACE_TRADE_OFFERS.some((offer) => offer.id === offerId),
    `missing material-chain trade offer ${offerId}`,
  );
}

const buildingVisuals = [
  {
    kind: 'clay_pit',
    container: 'ClayPitStockpile',
    segment: 'ClayPitClaySegment',
    resource: 'clay',
    segments: CLAY_PIT_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'charcoal_burner',
    container: 'CharcoalBurnerFirewoodStockpile',
    segment: 'CharcoalBurnerFirewoodSegment',
    resource: 'firewood',
    segments: CHARCOAL_BURNER_FIREWOOD_VISUAL_SEGMENTS,
  },
  {
    kind: 'charcoal_burner',
    container: 'CharcoalBurnerStockpile',
    segment: 'CharcoalBurnerCharcoalSegment',
    resource: 'charcoal',
    segments: CHARCOAL_BURNER_CHARCOAL_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyIronStockpile',
    segment: 'SmithyIronSegment',
    resource: 'iron',
    segments: SMITHY_IRON_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyCharcoalStockpile',
    segment: 'SmithyCharcoalSegment',
    resource: 'charcoal',
    segments: SMITHY_CHARCOAL_VISUAL_SEGMENTS,
  },
  {
    kind: 'smithy',
    container: 'SmithyIronworkStockpile',
    segment: 'SmithyIronworkSegment',
    resource: 'ironwork',
    segments: SMITHY_IRONWORK_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterClayStockpile',
    segment: 'PotterClaySegment',
    resource: 'clay',
    segments: POTTER_CLAY_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterFirewoodStockpile',
    segment: 'PotterFirewoodSegment',
    resource: 'firewood',
    segments: POTTER_FIREWOOD_VISUAL_SEGMENTS,
  },
  {
    kind: 'potter_kiln',
    container: 'PotterPotteryStockpile',
    segment: 'PotterPotterySegment',
    resource: 'pottery',
    segments: POTTER_POTTERY_VISUAL_SEGMENTS,
  },
] as const;

for (const spec of buildingVisuals) {
  const marker = createBuildingMesh(spec.kind);
  const stockpile = marker.getObjectByName(spec.container);
  assert.ok(stockpile instanceof THREE.Group, `${spec.kind} must expose ${spec.container}`);
  const segments = stockpile.children.filter((child) => child.name === spec.segment);
  assert.equal(
    segments.length,
    spec.segments,
    `${spec.container} must have its configured fill ladder`,
  );
  assert.equal(stockpile.visible, false, `${spec.container} must begin empty`);
  assert.ok(segments.every((segment) => !segment.visible));
  const state = building(spec.kind);
  state[spec.resource] = 999;
  syncBulkStockpileVisuals(marker, state);
  assert.equal(stockpile.visible, true);
  assert.ok(segments.every((segment) => segment.visible));
  state[spec.resource] = 0;
  syncBulkStockpileVisuals(marker, state);
  assert.equal(stockpile.visible, false);
  assert.ok(segments.every((segment) => !segment.visible));
}

const cargoProof: ReadonlyArray<
  readonly [DeliveryCargoKind, string]
> = [
  ['iron', 'Imported iron bar 1'],
  ['clay', 'Clay basket 1'],
  ['salt', 'Adriatic salt sack 1'],
  ['charcoal', 'Charcoal sack 1'],
  ['pottery', 'Fired pottery vessel 1'],
];
for (const [kind, objectName] of cargoProof) {
  const cart = createDeliveryCartMesh(kind);
  assert.ok(cart.getObjectByName(objectName), `${kind} cart must visibly carry ${objectName}`);
}

const renderedCards = renderBuildMenuCards();
for (const slug of ['clay-pit', 'charcoal-burner', 'smithy', 'potter-kiln']) {
  assert.match(renderedCards, new RegExp(`/assets/ui/build-menu/cards/${slug}\\.webp`));
  assert.ok(
    existsSync(`public/assets/ui/build-menu/cards/${slug}.webp`),
    `missing generated ${slug} card`,
  );
}
for (const resource of ['iron', 'clay', 'salt', 'charcoal', 'pottery']) {
  assert.ok(
    existsSync(`public/assets/ui/icons/materials/${resource}.png`),
    `missing generated ${resource} icon`,
  );
}

assert.notEqual(
  bulkStockpileVisualSignature(building('smithy', { charcoal: 1 })),
  bulkStockpileVisualSignature(building('smithy')),
  'the first charcoal sack at a smithy must invalidate its visual signature',
);
assert.notEqual(
  bulkStockpileVisualSignature(building('potter_kiln', { firewood: 1 })),
  bulkStockpileVisualSignature(building('potter_kiln')),
  'the first kiln fuel bundle must invalidate its visual signature',
);
const emptySmithy = building('smithy');
const stockedSmithy = building('smithy', { charcoal: 1 });
const emptySmithySignatures = buildingMarkerSignatures(
  new Map([[emptySmithy.id, emptySmithy]]),
);
const stockedSmithySignatures = buildingMarkerSignatures(
  new Map([[stockedSmithy.id, stockedSmithy]]),
);
assert.notEqual(stockedSmithySignatures.visual, emptySmithySignatures.visual);
assert.equal(
  stockedSmithySignatures.collider,
  emptySmithySignatures.collider,
  'changing forge supplies must not rebuild building colliders',
);

const expandedEconomySource = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const simulationReducerSource = readFileSync(
  'server/src/reducers/simulation.rs',
  'utf8',
);
const rustFunctionSection = (name: string, nextName: string): string => {
  const start = expandedEconomySource.indexOf(`pub fn ${name}`);
  const end = expandedEconomySource.indexOf(`pub fn ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source section should exist`);
  return expandedEconomySource.slice(start, end);
};
const marketplaceMaterialDispatchStep = rustFunctionSection(
  'step_marketplace_material_dispatch',
  'step_local_material_dispatch',
);
const localMaterialDispatchStep = rustFunctionSection(
  'step_local_material_dispatch',
  'step_granary',
);
const smokehouseStep = rustFunctionSection('step_smokehouse', 'step_clay_pit');
const clayPitStep = rustFunctionSection('step_clay_pit', 'step_charcoal_burner');
const charcoalBurnerStep = rustFunctionSection('step_charcoal_burner', 'step_smithy');
const smithyStep = rustFunctionSection('step_smithy', 'step_potter_kiln');
const potterKilnStep = rustFunctionSection('step_potter_kiln', 'step_apiary');
assert.match(
  marketplaceMaterialDispatchStep,
  /compare_processor_input_dispatch_candidates/,
);
assert.match(marketplaceMaterialDispatchStep, /MARKETPLACE_MATERIAL_TARGET_KINDS/);
assert.match(
  marketplaceMaterialDispatchStep,
  /used_sources[\s\S]*used_targets[\s\S]*source_id/,
  'the authoritative pass must reserve each market cart and workshop at most once',
);
assert.match(
  marketplaceMaterialDispatchStep,
  /"smithy"[\s\S]*CommodityKind::Iron[\s\S]*"smokehouse"[\s\S]*CommodityKind::Salt[\s\S]*CommodityKind::Pottery/,
);
assert.match(
  marketplaceMaterialDispatchStep,
  /pending_marketplace_trade_commodity\(&marketplace\) == Some\(CommodityKind::Pottery\)/,
  'an active pottery export must reserve its physically staged vessels',
);
assert.doesNotMatch(
  smokehouseStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&smokehouse,\s*CommodityKind::Salt/,
  'smokehouses must not pull salt in database update order',
);
assert.doesNotMatch(
  smithyStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Iron/,
  'smithies must not pull iron in database update order',
);
assert.doesNotMatch(
  smokehouseStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&smokehouse,\s*CommodityKind::Pottery/,
  'smokehouses must not pull pottery in database update order',
);
assert.doesNotMatch(
  smithyStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Charcoal/,
  'smithies must not pull charcoal in database update order',
);
assert.doesNotMatch(
  potterKilnStep,
  /request_connected_commodity\(\s*ctx,\s*tick,\s*clock,\s*&building,\s*CommodityKind::Clay/,
  'potter kilns must not pull clay in database update order',
);
for (const [section, label] of [
  [clayPitStep, 'clay pits'],
  [charcoalBurnerStep, 'charcoal burners'],
  [smithyStep, 'smithies'],
  [potterKilnStep, 'potters'],
] as const) {
  assert.doesNotMatch(
    section,
    /dispatch_to_building\(/,
    `${label} must not reserve workshop routes one source at a time`,
  );
}
assert.match(
  localMaterialDispatchStep,
  /LOCAL_MATERIAL_SOURCE_KINDS[\s\S]*used_sources[\s\S]*used_targets/,
  'local material dispatch must reserve every producer cart and target once',
);
assert.match(
  localMaterialDispatchStep,
  /"clay_pit"[\s\S]*CommodityKind::Clay[\s\S]*"charcoal_burner"[\s\S]*CommodityKind::Charcoal[\s\S]*"smithy"[\s\S]*CommodityKind::Ironwork[\s\S]*"potter_kiln"[\s\S]*CommodityKind::Pottery/,
);
const caravanIndex = simulationReducerSource.indexOf('step_marketplace_caravans(');
const seedDistributionIndex = simulationReducerSource.indexOf(
  'step_seed_grain_distribution(',
  caravanIndex,
);
const materialDispatchIndex = simulationReducerSource.indexOf(
  'step_marketplace_material_dispatch(',
  seedDistributionIndex,
);
const workshopStepIndex = simulationReducerSource.indexOf(
  'for (sim_kind, building_id) in expanded_ids',
  materialDispatchIndex,
);
const localMaterialDispatchIndex = simulationReducerSource.indexOf(
  'step_local_material_dispatch(',
  workshopStepIndex,
);
assert.ok(
  caravanIndex >= 0
    && seedDistributionIndex > caravanIndex
    && materialDispatchIndex > seedDistributionIndex
    && workshopStepIndex > materialDispatchIndex
    && localMaterialDispatchIndex > workshopStepIndex,
  'regional/household market work and seed recovery must retain cart precedence before workshop inputs',
);

const materialDispatchTargets = Array.from({ length: 100_000 }, (_, index) =>
  building(index % 2 === 0 ? 'smithy' : 'smokehouse', {
    id: `material-target-${index}`,
    x: 100_000 - index,
    assignedLabor: 1,
    constructionPriority: 2,
    iron: index % 2 === 0 ? SMITHY_IRON_PER_CYCLE : 0,
    salt: index % 2 === 0 ? 0 : SMOKEHOUSE_SALT_PER_CYCLE,
  }));
materialDispatchTargets.push(building('smokehouse', {
  id: 'urgent-material-target',
  x: 100_001,
  assignedLabor: 1,
  constructionPriority: 3,
  salt: 0,
}));
const materialDispatchStartedAt = performance.now();
const largeSettlementMaterialTarget = selectMarketplaceMaterialInputTarget(
  materialDispatchTargets,
  materialMarket,
  (candidate) => candidate.x,
);
const materialDispatchElapsedMs = performance.now() - materialDispatchStartedAt;
assert.equal(largeSettlementMaterialTarget?.target.id, 'urgent-material-target');
assert.ok(
  materialDispatchElapsedMs < 250,
  `100,001 imported-material dispatch candidates took ${materialDispatchElapsedMs.toFixed(1)} ms`,
);

const assignmentSources = Array.from({ length: 100 }, (_, index) =>
  building('marketplace', {
    id: `assignment-market-${index}`,
    x: index * 8,
    iron: 12,
  }));
const assignmentTargets = Array.from({ length: 1_000 }, (_, index) =>
  building('smithy', {
    id: `assignment-smithy-${index}`,
    x: index * 3,
    assignedLabor: 1,
    constructionPriority: index % 3 + 1,
    iron: index % 4,
  }));
let assignmentRouteSolves = 0;
const assignmentStartedAt = performance.now();
const largeAssignments = assignMarketplaceMaterialInputTargets(
  assignmentSources,
  assignmentTargets,
  (source, target) => {
    assignmentRouteSolves += 1;
    return Math.abs(source.x - target.x);
  },
);
const assignmentElapsedMs = performance.now() - assignmentStartedAt;
assert.equal(largeAssignments.size, assignmentSources.length);
assert.equal(
  assignmentRouteSolves,
  assignmentSources.length * assignmentTargets.length,
  'each market/workshop pair must share one route solve across candidate commodities',
);
assert.ok(
  assignmentElapsedMs < 500,
  `100,000 settlement-wide market/workshop pairs took ${assignmentElapsedMs.toFixed(1)} ms`,
);

const localAssignmentSources = Array.from({ length: 100 }, (_, index) =>
  building('clay_pit', {
    id: `local-assignment-clay-${index}`,
    x: index * 8,
    clay: 12,
  }));
const localAssignmentTargets = Array.from({ length: 1_000 }, (_, index) =>
  building('potter_kiln', {
    id: `local-assignment-potter-${index}`,
    x: index * 3,
    assignedLabor: 1,
    constructionPriority: index % 3 + 1,
    clay: index % 4,
  }));
let localAssignmentRouteSolves = 0;
const localAssignmentStartedAt = performance.now();
const largeLocalAssignments = assignLocalMaterialInputTargets(
  localAssignmentSources,
  localAssignmentTargets,
  (source, target) => {
    localAssignmentRouteSolves += 1;
    return Math.abs(source.x - target.x);
  },
);
const localAssignmentElapsedMs = performance.now() - localAssignmentStartedAt;
assert.equal(largeLocalAssignments.size, localAssignmentSources.length);
assert.equal(
  localAssignmentRouteSolves,
  localAssignmentSources.length * localAssignmentTargets.length,
);
assert.ok(
  localAssignmentElapsedMs < 500,
  `100,000 local material source/workshop pairs took ${localAssignmentElapsedMs.toFixed(1)} ms`,
);

const signatureBuildings = Array.from({ length: 100_000 }, (_, index) => {
  const kinds = [
    'clay_pit',
    'charcoal_burner',
    'smithy',
    'potter_kiln',
  ] as const;
  return building(kinds[index % kinds.length], {
    firewood: index % 55,
    ironwork: index % 73,
    iron: index % 49,
    clay: index % 73,
    charcoal: index % 73,
    pottery: index % 121,
  });
});
const signatureStartedAt = performance.now();
let signatureLength = 0;
for (const signatureBuilding of signatureBuildings) {
  signatureLength += bulkStockpileVisualSignature(signatureBuilding).length;
}
const signatureElapsedMs = performance.now() - signatureStartedAt;
assert.ok(signatureLength > 0);
assert.ok(
  signatureElapsedMs < 250,
  `100,000 material-chain visual signatures took ${signatureElapsedMs.toFixed(1)} ms`,
);

console.log(
  `Iron, clay, salt, charcoal, pottery chain tests passed (${materialDispatchElapsedMs.toFixed(1)} ms / 100k target candidates; ${assignmentElapsedMs.toFixed(1)} ms / 100k market pairs; ${localAssignmentElapsedMs.toFixed(1)} ms / 100k local pairs; ${signatureElapsedMs.toFixed(1)} ms / 100k visual signatures).`,
);

function building(
  kind: BuildingKind,
  patch: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: `${kind}-test`,
    kind,
    x: 0,
    z: 0,
    constructionComplete: true,
    timber: 0,
    stone: 0,
    firewood: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    ironwork: 0,
    polearms: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    assignedLabor: 2,
    constructionPriority: 2,
    processorOutputTargetPercent: 100,
    ...patch,
  } as BuildingState;
}
