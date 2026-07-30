import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import type { SettlementHouseholdMarketPlan } from '../src/economy/settlementHouseholdMarket.ts';
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

const branchPlan = {
  branches: new Map([
    ['market-a', { assignedResidenceIds: ['home-a', 'home-c'] }],
    ['market-b', { assignedResidenceIds: ['home-b'] }],
  ]),
} as unknown as SettlementHouseholdMarketPlan;

assert.deepEqual(
  marketplaceServiceResidenceIds(branchPlan, 'market-a'),
  ['home-a', 'home-c'],
  'coverage must use the household IDs already accumulated by the authoritative market branch plan',
);
assert.deepEqual(
  marketplaceServiceResidenceIds(branchPlan, 'missing-market'),
  [],
);
assert.equal(serviceCoverageLabel('well'), 'water service');
assert.equal(serviceCoverageLabel('marketplace'), 'market service');

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
assert.doesNotMatch(
  inspectorSource,
  /computeSettlementHouseholdMarketPlan/,
  'the UI toggle must consume the inspector projection instead of repeating settlement routing',
);
assert.doesNotMatch(
  projectionSource,
  /claimResidenceRoutesByNearestSupplier|computeSettlementHouseholdMarketPlan/,
  'coverage extraction must not run a second route planner',
);

console.log('Service coverage projection and instanced-overlay checks passed.');
