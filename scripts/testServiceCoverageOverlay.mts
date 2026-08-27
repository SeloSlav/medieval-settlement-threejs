import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { ResidenceMarkers } from '../src/residences/ResidenceMarkers.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
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
let halo = coverageRoot.getObjectByName('Served residence ground halos');
assert.ok(halo instanceof THREE.InstancedMesh);
assert.equal(halo.count, 2);
assert.equal(
  coverageRoot.children.filter((child) => child instanceof THREE.InstancedMesh).length,
  1,
  'any number of served homes must remain one instanced draw submission',
);
assert.equal(
  (halo.material as THREE.MeshBasicMaterial).color.getHex(),
  0x57c9ff,
  'well territory must use a readable water-blue halo',
);

const firstMatrix = new THREE.Matrix4();
halo.getMatrixAt(0, firstMatrix);
const firstPosition = new THREE.Vector3();
firstPosition.setFromMatrixPosition(firstMatrix);
assert.equal(firstPosition.x, homes[0].x);
assert.equal(firstPosition.z, homes[0].z);
assert.ok(firstPosition.y > 2.5, 'halos should sit slightly above the leveled home pad');

markers.setServiceCoverageHighlights(new Set(['home-b']), 'marketplace');
halo = coverageRoot.getObjectByName('Served residence ground halos');
assert.ok(halo instanceof THREE.InstancedMesh);
assert.equal(halo.count, 1);
assert.equal(
  (halo.material as THREE.MeshBasicMaterial).color.getHex(),
  0xe7c45c,
  'market territory must use a distinct trade-gold halo',
);

markers.setServiceCoverageHighlights(new Set(['home-b']), 'chapel');
halo = coverageRoot.getObjectByName('Served residence ground halos');
assert.ok(halo instanceof THREE.InstancedMesh);
assert.equal(halo.count, 1);
assert.equal(
  (halo.material as THREE.MeshBasicMaterial).color.getHex(),
  0xc89cff,
  'church territory must use a distinct parish-violet halo',
);

markers.syncResidences([homes[0]], () => 2.5);
halo = coverageRoot.getObjectByName('Served residence ground halos');
assert.ok(halo instanceof THREE.InstancedMesh);
assert.equal(halo.count, 0, 'a removed covered residence must disappear immediately');

markers.setServiceCoverageHighlights(new Set(), null);
assert.equal(halo.count, 0);
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

console.log('Service coverage projection and instanced-overlay checks passed.');
