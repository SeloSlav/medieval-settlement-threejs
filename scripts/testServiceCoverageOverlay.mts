import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { ResidenceMarkers } from '../src/residences/ResidenceMarkers.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
  marketplaceResidenceFulfillment,
  marketplaceServiceResidenceIds,
  serviceCoverageLabel,
} from '../src/resources/serviceCoverage.ts';
import type { ResidenceState } from '../src/resources/types.ts';

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
  /setMarketplaceServiceCoverage\([\s\S]*kind === 'marketplace'/,
  'Marketplace coverage should route the claimed homes into the world-space arc renderer',
);

console.log('Service coverage projection and translucent mesh-overlay checks passed.');
