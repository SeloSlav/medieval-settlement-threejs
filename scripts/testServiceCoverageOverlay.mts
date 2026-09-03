import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { WellServiceCoverage } from '../src/buildings/WellServiceCoverage.ts';
import { ResourceInspector } from '../src/resources/ResourceInspector.ts';
import { ResidenceMarkers } from '../src/residences/ResidenceMarkers.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
  marketplaceResidenceFulfillment,
  marketplaceServiceResidenceIds,
  serviceCoverageLabel,
} from '../src/resources/serviceCoverage.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';

function residence(
  id: string,
  x: number,
  z: number,
  tier: ResidenceState['tier'] = 1,
): ResidenceState {
  return {
    id,
    zoneId: 'coverage-zone',
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population: 4,
    populationCapacity: 6,
    tier,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

const markets = [
  { id: 'market-a', x: 0, z: 0 },
  { id: 'market-b', x: 20, z: 0 },
];
const marketHomes = [
  { id: 'home-a', x: 2, z: 0 },
  { id: 'home-b', x: 18, z: 0 },
  { id: 'home-c', x: 10, z: 0 },
  { id: 'home-unroaded', x: 0, z: 20 },
];
const roadDistance = (ax: number, az: number, bx: number, bz: number) =>
  az === 20 ? null : Math.hypot(bx - ax, bz - az);

assert.deepEqual(
  marketplaceServiceResidenceIds(marketHomes, markets, 'market-a', roadDistance),
  ['home-a', 'home-c'],
  'coverage must assign road-linked homes to the nearest stocked Marketplace and break ties by stable id',
);
assert.deepEqual(
  marketplaceServiceResidenceIds(marketHomes, markets, 'missing-market', roadDistance),
  [],
);
assert.equal(serviceCoverageLabel('well'), 'water service');
assert.equal(serviceCoverageLabel('marketplace'), 'market service');
assert.equal(serviceCoverageLabel('chapel'), 'church service');
assert.equal(serviceCoverageLabel('tavern'), 'beverage service');

const fulfillmentHome = residence('fulfillment-home', 0, 0, 3);
assert.equal(marketplaceResidenceFulfillment(fulfillmentHome), 'unfulfilled');
fulfillmentHome.needs.food.stock = 4;
assert.equal(marketplaceResidenceFulfillment(fulfillmentHome), 'partial');
fulfillmentHome.needs.firewood.stock = 4;
fulfillmentHome.needs.cloth.stock = 1;
fulfillmentHome.needs.shoes.stock = 1;
assert.equal(marketplaceResidenceFulfillment(fulfillmentHome), 'fulfilled');
fulfillmentHome.needs.shoes.deficitTicks = 1;
assert.equal(
  marketplaceResidenceFulfillment(fulfillmentHome),
  'partial',
  'stock with an active shortage clock is not yet fulfilled',
);

const parent = new THREE.Group();
const markers = new ResidenceMarkers(parent);
const homes = [
  residence('home-a', -8, 4, 1),
  residence('home-b', 7, -3, 3),
];
markers.syncResidences(homes, () => 2.5);
markers.setServiceCoverageHighlights(
  new Set(homes.map((home) => home.id)),
  'well',
);

const coverageRoot = parent.getObjectByName('Residence service coverage');
assert.ok(coverageRoot instanceof THREE.Group);
let firstOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-a');
let secondOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-b');
assert.ok(firstOverlay instanceof THREE.Mesh);
assert.ok(secondOverlay instanceof THREE.Mesh);
assert.equal(
  coverageRoot.children.filter((child) => child instanceof THREE.Mesh).length,
  2,
  'each served home must receive one merged full-structure overlay mesh',
);
assert.equal(
  (firstOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0x57c9ff,
  'well territory must use a readable water-blue house tint',
);
assert.equal((firstOverlay.material as THREE.MeshBasicMaterial).transparent, true);
assert.ok((firstOverlay.material as THREE.MeshBasicMaterial).opacity < 0.5);
assert.ok(firstOverlay.geometry.getAttribute('position').count > 100);
assert.equal(firstOverlay.position.x, homes[0].x);
assert.equal(firstOverlay.position.y, 2.5);
assert.equal(firstOverlay.position.z, homes[0].z);

markers.setServiceCoverageHighlights(
  new Set(['home-a', 'home-b']),
  'marketplace',
  new Map([
    ['home-a', 'fulfilled'],
    ['home-b', 'unfulfilled'],
  ]),
);
firstOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-a');
secondOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-b');
assert.ok(firstOverlay instanceof THREE.Mesh);
assert.ok(secondOverlay instanceof THREE.Mesh);
assert.equal(
  (firstOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0x62d27b,
  'a fully supplied Marketplace home must be green',
);
assert.equal(
  (secondOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0xe6655e,
  'a wholly unfulfilled Marketplace home must be red',
);

markers.setServiceCoverageHighlights(
  new Set(['home-b']),
  'marketplace',
  new Map([['home-b', 'partial']]),
);
secondOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-b');
assert.ok(secondOverlay instanceof THREE.Mesh);
assert.equal(
  (secondOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0xefc84f,
  'a partly supplied Marketplace home must be yellow',
);

markers.setServiceCoverageHighlights(new Set(['home-b']), 'chapel');
secondOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-b');
assert.ok(secondOverlay instanceof THREE.Mesh);
assert.equal(
  (secondOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0xc89cff,
  'church territory must use a distinct parish-purple house tint',
);

markers.setServiceCoverageHighlights(new Set(['home-b']), 'tavern');
secondOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-b');
assert.ok(secondOverlay instanceof THREE.Mesh);
assert.equal(
  (secondOverlay.material as THREE.MeshBasicMaterial).color.getHex(),
  0xff9b3d,
  'tavern territory must use a distinct ale-orange house tint',
);

markers.syncResidences([homes[0]], () => 2.5);
assert.equal(
  coverageRoot.getObjectByName('Served residence mesh overlay:home-b'),
  undefined,
  'a removed covered residence overlay must disappear immediately',
);

markers.setServiceCoverageHighlights(new Set(['home-a']), 'well');
firstOverlay = coverageRoot.getObjectByName('Served residence mesh overlay:home-a');
assert.ok(firstOverlay instanceof THREE.Mesh && firstOverlay.visible);
markers.setServiceCoverageHighlights(new Set(), null);
assert.equal(firstOverlay.visible, false);
markers.dispose();
assert.equal(parent.getObjectByName('Residence service coverage'), undefined);

let terrainLift = 0;
const heightAt = (x: number, z: number) => x * 0.05 + z * 0.02 + terrainLift;
const wellCoverage = new WellServiceCoverage(parent, { getHeightAt: heightAt });
const wells = new Map([
  ['well-a', { id: 'well-a', kind: 'well', x: 25, z: -15, workRadius: 90, constructionComplete: true } as BuildingState],
  ['well-b', { id: 'well-b', kind: 'well', x: -30, z: 40, workRadius: 75, constructionComplete: true } as BuildingState],
]);
const coverageEvents: Array<string | null> = [];
const coverageInspector = Object.create(ResourceInspector.prototype) as ResourceInspector;
Object.assign(coverageInspector, {
  serviceCoverageBuildingId: 'well-a',
  serviceCoverageEmittedBuildingId: null,
  serviceCoverageResidenceIds: new Set(),
  serviceCoverageMarketplaceFulfillment: new Map(),
  options: {
    onServiceCoverageChange: (_ids: unknown, kind: string | null, _fulfillment: unknown, id: string | null) => {
      coverageEvents.push(id);
      wellCoverage.sync(kind === 'well' && id != null ? wells.get(id)! : null);
    },
  },
});
coverageInspector['refreshServiceCoverage']({ kind: 'well', residenceIds: [] });
const waterRing = parent.getObjectByName('Well water service coverage ring');
assert.ok(waterRing instanceof THREE.Mesh && waterRing.visible);
assert.deepEqual(coverageEvents, ['well-a'], 'zero served homes must still activate coverage');
assert.equal((waterRing.material as THREE.MeshBasicMaterial).color.getHex(), 0x57c9ff);
const ringPositions = waterRing.geometry.getAttribute('position');
for (let index = 0; index < ringPositions.count; index++) {
  const x = ringPositions.getX(index);
  const z = ringPositions.getZ(index);
  assert.ok(Math.abs(Math.hypot(x - 25, z + 15) - 90) < 0.45, 'the ring must trace the full 90 m service reach');
  assert.ok(Math.abs(ringPositions.getY(index) - heightAt(x, z) - 0.18) < 1e-5, 'the ring must follow sloping terrain');
}
coverageInspector['refreshServiceCoverage']({ kind: 'well', residenceIds: [] });
assert.equal(coverageEvents.length, 1, 'unchanged coverage must not rebuild each inspector refresh');
assert.equal(waterRing.geometry.getAttribute('position'), ringPositions);
coverageInspector['clearServiceCoverage']();
assert.equal(waterRing.visible, false);
Object.assign(coverageInspector, { serviceCoverageBuildingId: 'well-a' });
coverageInspector['refreshServiceCoverage']({ kind: 'well', residenceIds: [] });
assert.equal(waterRing.visible, true, 're-enabling an empty well must show its radius again');
Object.assign(coverageInspector, { serviceCoverageBuildingId: 'well-b' });
coverageInspector['refreshServiceCoverage']({ kind: 'well', residenceIds: [] });
assert.equal(coverageEvents.at(-1), 'well-b', 'switching wells with identical home sets must change the ring');
const secondPositions = waterRing.geometry.getAttribute('position');
assert.ok(Math.abs(Math.hypot(secondPositions.getX(0) + 30, secondPositions.getZ(0) - 40) - 75) < 0.45);
const priorHeight = secondPositions.getY(0);
terrainLift = 4;
wellCoverage.sync(wells.get('well-b')!, true);
assert.ok(Math.abs(waterRing.geometry.getAttribute('position').getY(0) - priorHeight - 4) < 1e-5);
wellCoverage.sync({ ...wells.get('well-b')!, constructionComplete: false });
assert.equal(waterRing.visible, false, 'unfinished wells must not advertise active coverage');
wellCoverage.sync(wells.get('well-b')!);
wellCoverage.sync(null);
assert.equal(waterRing.visible, false, 'deselected or removed wells must hide their ring');
wellCoverage.dispose();
assert.equal(parent.getObjectByName('Well water service coverage ring'), undefined);

const inspectorSource = fs.readFileSync(
  'src/resources/ResourceInspector.ts',
  'utf8',
);
const projectionSource = fs.readFileSync(
  'src/resources/serviceCoverage.ts',
  'utf8',
);
const marketInspectorSource = fs.readFileSync(
  'src/resources/inspector/marketStallsRenderer.ts',
  'utf8',
);
const chapelInspectorSource = fs.readFileSync(
  'src/resources/inspector/chapelRenderer.ts',
  'utf8',
);
const expandedBuildingInspectorSource = fs.readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
const appBootstrapSource = fs.readFileSync(
  'src/app/appBootstrap.ts',
  'utf8',
);
assert.doesNotMatch(
  inspectorSource,
  /computeSettlementHouseholdMarketPlan/,
  'the UI toggle must consume the inspector projection instead of calculating territory itself',
);
assert.doesNotMatch(
  projectionSource,
  /computeSettlementHouseholdMarketPlan/,
  'local Marketplace coverage must not be confused with regional Trading Post contingency routes',
);
assert.match(marketInspectorSource, /serviceCoverage:[\s\S]*kind: 'marketplace'/);
assert.match(chapelInspectorSource, /serviceCoverage:[\s\S]*kind: 'chapel'/);
assert.match(
  expandedBuildingInspectorSource,
  /getClaimedResidencesForSpecialtySupplier\(building, 'ale'\)[\s\S]*serviceCoverage:[\s\S]*kind: 'tavern'/,
  'the Tavern inspector must project the occupied tier-2+ homes actually claimed by its stocked beverage service',
);
assert.match(
  inspectorSource,
  /window\.addEventListener\('keydown', this\.onWindowKeyDown\)/,
  'Marketplace coverage should install the hold-Tab shortcut',
);
assert.match(
  inspectorSource,
  /event\.key !== 'Tab'[\s\S]*serviceCoverageTabPreviewBuildingId[\s\S]*endServiceCoverageTabPreview/,
  'the Tab shortcut should be a momentary preview that ends on key release',
);
assert.match(
  appBootstrapSource,
  /setWellServiceCoverage\([\s\S]*kind === 'well'/,
  'the water coverage toggle must show the well radius alongside residence mesh highlights',
);
assert.match(
  appBootstrapSource,
  /setMarketplaceServiceCoverage\([\s\S]*kind === 'marketplace'/,
  'Marketplace coverage should route the claimed homes into the world-space arc renderer',
);

console.log('Service coverage projection and translucent mesh-overlay checks passed.');
