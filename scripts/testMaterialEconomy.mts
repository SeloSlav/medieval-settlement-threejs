import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
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
  directlyDispatchedProcessorInputPerCycle,
  selectDirectProcessorInputTarget,
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
  },
  {
    kind: 'charcoal_burner',
    container: 'CharcoalBurnerStockpile',
    segment: 'CharcoalBurnerCharcoalSegment',
    resource: 'charcoal',
  },
  {
    kind: 'smithy',
    container: 'SmithyIronStockpile',
    segment: 'SmithyIronSegment',
    resource: 'iron',
  },
  {
    kind: 'potter_kiln',
    container: 'PotterPotteryStockpile',
    segment: 'PotterPotterySegment',
    resource: 'pottery',
  },
] as const;

for (const spec of buildingVisuals) {
  const marker = createBuildingMesh(spec.kind);
  const stockpile = marker.getObjectByName(spec.container);
  assert.ok(stockpile instanceof THREE.Group, `${spec.kind} must expose ${spec.container}`);
  const segments = stockpile.children.filter((child) => child.name === spec.segment);
  assert.ok(segments.length >= 4, `${spec.container} must have a readable fill ladder`);
  const state = building(spec.kind);
  state[spec.resource] = 999;
  syncBulkStockpileVisuals(marker, state);
  assert.equal(stockpile.visible, true);
  assert.ok(segments.every((segment) => segment.visible));
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

console.log('Iron, clay, salt, charcoal, pottery chain tests passed.');

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
