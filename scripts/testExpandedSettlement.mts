import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
  MONASTERY_COVERAGE_RADIUS,
  RESIDENCE_TIER1_CAPACITY,
  RESIDENCE_TIER2_CAPACITY,
  RESIDENCE_TIER3_CAPACITY,
} from '../src/generated/gameBalance.ts';
import {
  activeResidenceNeedKinds,
  createDefaultNeeds,
} from '../src/residences/residenceNeedState.ts';
import { evaluateResidenceNeedRecovery } from '../src/residences/residenceNeeds.ts';
import type { ResidenceState } from '../src/resources/types.ts';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { pointWithinBuildingSiteClearance } from '../src/buildings/BuildingTerrainLayout.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';

const expanded = [
  'threshing_barn', 'monastery', 'brewery', 'smokehouse', 'granary',
  'apiary', 'watermill', 'carpenter', 'ferry_landing', 'vineyard',
] as const;
for (const kind of expanded) {
  assert.ok(BUILDING_KINDS.includes(kind), `${kind} must remain a generated buildable kind`);
  assert.ok(BUILDING_DEFINITIONS[kind].label.length > 0, `${kind} needs player-facing copy`);
}
assert.equal(BUILDING_DEFINITIONS.watermill.requiresWaterShore, true);
assert.equal(BUILDING_DEFINITIONS.ferry_landing.requiresWaterShore, true);
assert.equal(BUILDING_DEFINITIONS.monastery.acceptsLabor, false);
assert.equal(BUILDING_DEFINITIONS.monastery.requiresHillside, true);
assert.equal(BUILDING_DEFINITIONS.monastery.workRadius, 0);
assert.equal(MONASTERY_COVERAGE_RADIUS, 520);
assert.deepEqual(
  getBuildingExtent('threshing_barn', BUILDING_DEFINITIONS.threshing_barn.workRadius),
  { type: 'work', label: 'Field work extent', radius: 150 },
);
assert.deepEqual(
  getBuildingExtent('monastery', BUILDING_DEFINITIONS.monastery.workRadius),
  { type: 'coverage', label: 'Faith coverage', radius: 520 },
);
for (const kind of ['brewery', 'smokehouse', 'granary', 'apiary', 'watermill', 'carpenter', 'ferry_landing'] as const) {
  assert.equal(BUILDING_DEFINITIONS[kind].workRadius, 0, `${kind} has no spatial work extent`);
  assert.equal(getBuildingExtent(kind, BUILDING_DEFINITIONS[kind].workRadius), null, `${kind} must not render an extent ring`);
}
assert.ok(BUILDING_STORAGE_CAPS.granary.grain > BUILDING_STORAGE_CAPS.threshing_barn.grain);
assert.deepEqual([RESIDENCE_TIER1_CAPACITY, RESIDENCE_TIER2_CAPACITY, RESIDENCE_TIER3_CAPACITY], [3, 6, 10]);

const roadlessPlacementContext = {
  buildings: [],
  residences: [],
  burgageZones: [],
  farmFields: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: () => 0,
  roadNetwork: new RoadNetwork(),
};
assert.equal(
  validateBuildingPlacement('carpenter', 0, 0, roadlessPlacementContext).ok,
  true,
  'roads must be connected after construction, not required for placement',
);
assert.equal(
  pointWithinBuildingSiteClearance(10, -6, { kind: 'watermill', x: 10, z: -6 }),
  true,
  'the construction pad must clear an obstacle at its center',
);
assert.equal(
  pointWithinBuildingSiteClearance(40, -6, { kind: 'watermill', x: 10, z: -6 }),
  false,
  'construction clearing must not expand to the functional work radius',
);

const closeShorePlacement = validateBuildingPlacement('watermill', 0, 0, {
  ...roadlessPlacementContext,
  isWaterAt: (x: number, z: number) => Math.hypot(x - 4, z) <= 0.75,
});
assert.equal(closeShorePlacement.ok, true, 'watermill placement must detect water within the close-bank sampling gap');

const distantShorePlacement = validateBuildingPlacement('watermill', 0, 0, {
  ...roadlessPlacementContext,
  isWaterAt: (x: number, z: number) => Math.hypot(x - 30, z) <= 0.75,
});
assert.equal(distantShorePlacement.ok, false);
if (!distantShorePlacement.ok) assert.equal(distantShorePlacement.reason, 'requires_shore');

const residence = (tier: 1 | 2 | 3): ResidenceState => ({
  id: `tier-${tier}`, zoneId: 'zone', parcelIndex: 0, x: 0, z: 0, yaw: 0,
  population: 1, populationCapacity: tier === 1 ? 3 : tier === 2 ? 6 : 10,
  tier, settlementTicks: 0, needs: createDefaultNeeds(), abandoned: false, householdWealth: 0,
});
const supply = { servingLodgeId: 'lodge', servingWellId: 'well', servingFoodSupplierId: 'food' };
assert.deepEqual(activeResidenceNeedKinds(1), ['food']);
assert.deepEqual(activeResidenceNeedKinds(2), ['firewood', 'water', 'food']);
assert.deepEqual(activeResidenceNeedKinds(3), ['firewood', 'water', 'food', 'preservedFood', 'ale']);
assert.equal(evaluateResidenceNeedRecovery(residence(1), supply).length, 1);
assert.equal(evaluateResidenceNeedRecovery(residence(2), supply).length, 3);
assert.equal(evaluateResidenceNeedRecovery(residence(3), supply).length, 5);

for (const kind of expanded) {
  const model = createBuildingMesh(kind);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  let meshCount = 0;
  model.traverse((object) => { if (object instanceof THREE.Mesh) meshCount += 1; });
  assert.ok(meshCount >= 8, `${kind} needs a modeled silhouette, not a placeholder`);
  assert.ok([size.x, size.y, size.z].every(Number.isFinite), `${kind} bounds must be finite`);
  assert.ok(size.x > 1 && size.y > 1 && size.z > 1, `${kind} must have a visible three-dimensional footprint`);
}

const tierSizes = ([1, 2, 3] as const).map((tier) =>
  new THREE.Box3().setFromObject(createResidenceMesh(42, tier)).getSize(new THREE.Vector3()),
);
assert.ok(tierSizes[0].x < tierSizes[1].x && tierSizes[1].x < tierSizes[2].x);
assert.ok(tierSizes[0].y < tierSizes[1].y && tierSizes[1].y < tierSizes[2].y);

const expandedSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  expandedSimulation,
  /compare_supply_route_candidates/,
  'specialist inputs and outputs should prefer short road routes',
);
assert.match(
  expandedSimulation,
  /building_has_inbound_supply_trip\(ctx, target\.id\)/,
  'a processor should not summon duplicate carts while an input haul is already in flight',
);
assert.match(
  expandedSimulation,
  /!target\.construction_complete/,
  'specialist goods should never be dispatched to unfinished buildings',
);
assert.doesNotMatch(
  expandedSimulation,
  /sources\.sort_by_key\(\|source\| source\.id\)/,
  'building age must not override industrial clustering and road layout',
);

console.log('expanded settlement tests passed');
