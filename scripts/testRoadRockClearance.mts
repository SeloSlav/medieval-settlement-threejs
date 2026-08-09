import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ForestManager, type ForestRockInstances } from '../src/props/ForestManager.ts';
import { createStubForestInstances } from '../src/props/forestInstanceStub.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { validateRoadPlacement } from '../src/roads/RoadPlacementValidation.ts';
import { collectRoadRemovedRockIndices } from '../src/roads/roadRockClearance.ts';
import type { RockObstacle } from '../src/utils/pathGeometry.ts';

const roadPath = [
  new THREE.Vector3(-20, 0, 0),
  new THREE.Vector3(20, 0, 0),
];
const roadWidth = 4;
const network = {
  edges: new Map([['road-1', {
    width: roadWidth,
    sampledPath: roadPath,
    controlPoints: roadPath,
  }]]),
} as unknown as RoadNetwork;

verifyForestRockClearance();
verifySharedRoadRockClearance();
verifyRoadPlacementHasNoDecorationBlocker();
verifyRoadPlacementSlopeRestriction();

console.log('Road decorative-rock clearance tests passed.');

function verifyForestRockClearance(): void {
  const nearRoad: RockObstacle = { x: 0, z: 0, scale: 1 };
  const awayFromRoad: RockObstacle = { x: 0, z: 12, scale: 1 };
  const rockField = createRockField([nearRoad, awayFromRoad]);
  const manager = new ForestManager(
    new THREE.Group(),
    createStubForestInstances([]),
    rockField,
    null,
    [],
    { getHeightAt: () => 0 } as never,
    () => {},
  );

  manager.syncRoadClearance(network);
  assert.deepEqual(
    manager.rockPlacements,
    [awayFromRoad],
    'roads should hide intersecting decorative forest rocks and remove their collision entries',
  );

  manager.syncRoadClearance(null);
  assert.deepEqual(
    manager.rockPlacements,
    [nearRoad, awayFromRoad],
    'removing the road should restore decorative rocks that have no other clearance source',
  );
}

function verifySharedRoadRockClearance(): void {
  const rocks: RockObstacle[] = [
    { x: -8, z: 0, scale: 0.5 },
    { x: 4, z: 3.5, scale: 0.7 },
    { x: 0, z: 12, scale: 1 },
  ];
  assert.deepEqual(
    [...collectRoadRemovedRockIndices(rocks, network)],
    [0, 1],
    'the shared forest/riverbank clearance rule should select only road-overlapping decoration',
  );
}

function verifyRoadPlacementHasNoDecorationBlocker(): void {
  assert.deepEqual(
    validateRoadPlacement([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 120),
    ], 3.5),
    { ok: true },
    'flat roads should not need scene-obstacle validation before decorative rocks are cleared',
  );
}

function verifyRoadPlacementSlopeRestriction(): void {
  assert.deepEqual(
    validateRoadPlacement([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 4.5, 10),
    ], 3.5),
    { ok: true },
    'roads at the 45% maximum grade should remain buildable',
  );
  assert.deepEqual(
    validateRoadPlacement([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 100, 10),
    ], 3.5),
    { ok: false, reason: 'too_steep' },
    'roads above the 45% maximum grade should be rejected',
  );
}

function createRockField(placements: RockObstacle[]): ForestRockInstances {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const shadowMaterial = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const shadowMesh = new THREE.InstancedMesh(geometry, shadowMaterial, placements.length);
  const instances = placements.map((placement, instanceIndex) => {
    const matrix = new THREE.Matrix4().makeTranslation(placement.x, 0, placement.z);
    mesh.setMatrixAt(instanceIndex, matrix);
    shadowMesh.setMatrixAt(instanceIndex, matrix);
    return {
      placement,
      mesh,
      shadowMesh,
      instanceIndex,
      matrix,
    };
  });
  return { group: new THREE.Group(), instances };
}
