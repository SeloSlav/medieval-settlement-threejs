import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  livestockPastureManagementHeadAllowance,
  PASTORAL_MANAGEMENT_UNITS,
  SWINE_MANAGEMENT_UNITS,
} from '../src/farming/pastureCapacity.ts';

const source = (path: string): string => fs.readFileSync(path, 'utf8');

assert.equal(PASTORAL_MANAGEMENT_UNITS, 60);
assert.equal(SWINE_MANAGEMENT_UNITS, 30);
assert.equal(
  livestockPastureManagementHeadAllowance('cattle', [
    { species: 'cattle', headCount: 4 },
    { species: 'sheep', headCount: 10 },
  ]),
  12,
  'four sibling cattle and ten sibling sheep must leave only 38 management units, or twelve cattle',
);
assert.equal(
  livestockPastureManagementHeadAllowance('sheep', [
    { species: 'cattle', headCount: 4 },
    { species: 'sheep', headCount: 10 },
  ]),
  38,
);
assert.equal(
  livestockPastureManagementHeadAllowance('swine', [{ species: 'swine', headCount: 8 }]),
  22,
);

const types = source('src/resources/types.ts');
const subscriptions = source('src/data/gameTableSubscriptions.ts');
const sync = source('src/data/spacetimeTableSync/syncLivestock.ts');
const reducers = source('src/data/spacetimeReducers.ts');
const queries = source('src/resources/WorldQueries.ts');
const inspector = source('src/resources/ResourceInspector.ts');
const pastureRenderer = source('src/resources/inspector/pastureRenderer.ts');
const buildingRenderer = source('src/resources/inspector/livestockBuildingRenderer.ts');
const markers = source('src/farming/PastureMarkers.ts');
const visuals = source('src/farming/LivestockVisuals.ts');
const placement = source('src/farming/FarmFieldTool.ts');

assert.match(types, /type LivestockHerdState = \{[\s\S]{0,180}pastureId: string;[\s\S]{0,180}buildingId: string;/);
assert.match(subscriptions, /'pasture_herd'/);
assert.doesNotMatch(subscriptions, /'livestock_herd'/);
assert.match(sync, /Iterable<PastureHerd>/);
assert.match(sync, /const pastureId = pastureClientId\(row\.pastureId\)/);
assert.match(sync, /const buildingId = buildingClientId\(row\.farmsteadId\)/);
assert.match(sync, /herds\.set\(pastureId/);

for (const reducerName of [
  'setLivestockSpecies',
  'tradeLivestock',
  'setLivestockBreedingReserve',
  'setLivestockHaymakingPercent',
]) {
  assert.match(
    reducers,
    new RegExp(`function ${reducerName}\\([\\s\\S]{0,160}pastureId: string[\\s\\S]{0,260}parsePastureServerId\\(pastureId\\)[\\s\\S]{0,300}pastureId: serverId`),
    `${reducerName} must parse and send the pasture id`,
  );
}

assert.match(queries, /herd: state\.livestockHerds\.get\(pasture\.id\) \?\? null/);
assert.match(queries, /getLivestockHerdsForBuilding[\s\S]{0,220}herd\.buildingId === buildingId/);
assert.match(inspector, /selectedTarget\.pasture\.id,[\s\S]{0,80}headDelta/);
assert.doesNotMatch(
  inspector,
  /onTradeLivestock\?\.\(\s*this\.selectedTarget\.farmstead\.id/,
  'pasture controls must never forward a farmstead id as the herd key',
);

assert.match(pastureRenderer, /Independent livestock parcel/);
assert.match(pastureRenderer, /Each fenced pasture keeps its own herd and carrying limit/);
assert.match(pastureRenderer, /fence and every sibling pasture remain untouched/i);
assert.match(pastureRenderer, /livestockPastureManagementHeadAllowance\(species, otherHerds\)/);
assert.match(pastureRenderer, /data-livestock-species="cattle"/);
assert.match(pastureRenderer, /data-livestock-trade="1"/);
assert.match(pastureRenderer, /data-livestock-breeding-reserve/);
assert.match(pastureRenderer, /data-livestock-haymaking-percent/);

assert.match(buildingRenderer, /Mixed livestock holding/);
assert.match(buildingRenderer, /getLivestockHerdsForBuilding\(building\.id\)/);
assert.match(buildingRenderer, /data-inspect-pasture/);
assert.doesNotMatch(buildingRenderer, /data-livestock-species=/);
assert.doesNotMatch(buildingRenderer, /data-livestock-trade=/);
assert.doesNotMatch(buildingRenderer, /data-livestock-breeding-reserve=/);

assert.match(markers, /herds\.get\(pasture\.id\)/);
assert.doesNotMatch(markers, /herds\.get\(pasture\.farmsteadId\)/);
assert.match(visuals, /pasturesById\.get\(herd\.pastureId\)/);
assert.match(visuals, /herdPastureId = herd\.pastureId/);
assert.match(placement, /choose after fencing:/);
assert.match(placement, /farmstead!\.kind === 'swineherd'/);
assert.doesNotMatch(placement, /state\.livestockHerds\.get\(farmstead!\.id\)\?\.species/);

console.log('pasture-keyed livestock client contracts passed');
