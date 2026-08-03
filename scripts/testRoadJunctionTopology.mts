import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadJunctionBuilder } from '../src/roads/RoadJunctionBuilder.ts';
import { RoadMeshBuilder } from '../src/roads/RoadMeshBuilder.ts';
import { RoadNetwork, type RoadNetworkSnapshot } from '../src/roads/RoadNetwork.ts';
import { RoadNodeSnapMarkers } from '../src/roads/RoadNodeSnapMarkers.ts';
import {
  ROAD_CAP_OVERLAP,
  ROAD_END_TRIM,
  ROAD_JUNCTION_REACH,
  roadTerminalTrimDistance,
  trimPathAtEndpoint,
} from '../src/roads/roadEndpoint.ts';

const point = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);

const endpointJoin = new RoadNetwork();
endpointJoin.addRoadPath([point(0, 0), point(20, 0)]);
const nearStart = point(1, 1);
const snap = endpointJoin.findSnap(nearStart, 5.4);
assert.equal(snap?.kind, 'node', 'a segment projection close to an edge end should reuse the endpoint node');
assert.equal(snap?.nodeId, 'n1');
endpointJoin.addRoadPath([point(1, -10), nearStart]);
assert.equal(endpointJoin.edges.size, 2, 'joining near an endpoint should not leave a split-off road stub');
const joinedNode = endpointJoin.nodes.get('n1');
assert(joinedNode);
assert.equal(endpointJoin.getNodeDegree(joinedNode), 2);
assert.equal(joinedNode.junctionType, 'bend');
const trueDeadEnd = endpointJoin.nodes.get('n2');
assert(trueDeadEnd);
assert.equal(endpointJoin.getNodeDegree(trueDeadEnd), 1);
assert.equal(trueDeadEnd.junctionType, 'endpoint');

const interiorJoin = new RoadNetwork();
interiorJoin.addRoadPath([point(-10, 0), point(10, 0)]);
interiorJoin.addRoadPath([point(0, -10), point(0, 0)]);
const splitNode = [...interiorJoin.nodes.values()].find((node) => (
  Math.abs(node.position.x) < 1e-6 && Math.abs(node.position.z) < 1e-6
));
assert(splitNode);
assert.equal(interiorJoin.getNodeDegree(splitNode), 3, 'an endpoint-to-interior snap should split into three incidences');
assert.equal(splitNode.junctionType, 't-junction');

const nearbyNodeSnapshot: RoadNetworkSnapshot = {
  nextNodeId: 4,
  nextEdgeId: 2,
  nodes: [
    { id: 'n1', position: [-10, 0, 0] },
    { id: 'n2', position: [10, 0, 0] },
    { id: 'n3', position: [0, 0, 2] },
  ],
  edges: [{
    id: 'e1',
    startNodeId: 'n1',
    endNodeId: 'n2',
    width: 4.2,
    controlPoints: [[-10, 0, 0], [10, 0, 0]],
    sampledPath: [[-10, 0, 0], [10, 0, 0]],
    length: 20,
    revision: 1,
  }],
};
const nearbyCrossing = new RoadNetwork();
nearbyCrossing.restore(nearbyNodeSnapshot);
nearbyCrossing.addRoadPath([point(0, -10), point(0, 10)]);
const reusedCrossingNode = nearbyCrossing.nodes.get('n3');
assert(reusedCrossingNode);
assert.equal(
  nearbyCrossing.getNodeDegree(reusedCrossingNode),
  4,
  'reusing a nearby crossing node must also split and attach the crossed edge',
);
assert(!nearbyCrossing.edges.has('e1'), 'the unsplit edge must not survive a crossing-node reuse');

const loop = new RoadNetwork();
loop.addRoadPath([point(0, 0), point(10, 0), point(10, 10), point(0, 10), point(0, 0)]);
const loopNode = [...loop.nodes.values()][0];
assert(loopNode);
assert.equal(loopNode.edgeIds.size, 1);
assert.equal(loop.getNodeDegree(loopNode), 2, 'a loop contributes a start and an end incidence');
assert.equal(loopNode.junctionType, 'bend', 'a closed loop node is joined road, not a dead end');

const elbow = new RoadNetwork();
elbow.addRoadPath([point(-10, 0), point(0, 0)]);
elbow.addRoadPath([point(0, 0), point(0, 10)]);
const flatTerrain = {
  getHeightAt: () => 0,
  getPointAt: (x: number, z: number, yOffset = 0) => new THREE.Vector3(x, yOffset, z),
};
const materials = {
  road: new THREE.MeshBasicMaterial(),
  roadEdge: new THREE.MeshBasicMaterial(),
  bridgeSupport: new THREE.MeshBasicMaterial(),
};
const patches = new RoadJunctionBuilder(flatTerrain as never, materials as never).build(elbow);
const elbowNode = [...elbow.nodes.values()].find((node) => elbow.getNodeDegree(node) === 2);
assert(elbowNode);
const elbowPatch = patches.getObjectByName(`Road bend ${elbowNode.id}`) as THREE.Group | undefined;
assert(elbowPatch);
assert.equal(elbowPatch.children.length, 2, 'a joined node should receive junction blend and core meshes');

for (const mesh of elbowPatch.children as THREE.Mesh[]) {
  const normals = mesh.geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index++) {
    assert(normals.getY(index) > 0.99, 'junction triangles should face upward');
  }
}

const blend = elbowPatch.children[0] as THREE.Mesh;
const blendPositions = blend.geometry.getAttribute('position');
let southEastRadius = Infinity;
for (let index = 1; index < blendPositions.count; index++) {
  const x = blendPositions.getX(index) - elbowNode.position.x;
  const z = blendPositions.getZ(index) - elbowNode.position.z;
  if (x > 0 && z < 0 && Math.abs(Math.abs(x) - Math.abs(z)) < 0.05) {
    southEastRadius = Math.hypot(x, z);
    break;
  }
}
assert(
  southEastRadius <= 4.2 * 0.6,
  'the non-incident elbow quadrant should stay at the compact hub instead of expanding into a slab',
);

const core = elbowPatch.children[1] as THREE.Mesh;
const coreUvs = core.geometry.getAttribute('uv');
assert.equal(coreUvs.getX(0), 0.5, 'the junction center should sample the middle of the road texture');
let minimumCoreU = Infinity;
let maximumCoreU = -Infinity;
for (let index = 0; index < coreUvs.count; index++) {
  minimumCoreU = Math.min(minimumCoreU, coreUvs.getX(index));
  maximumCoreU = Math.max(maximumCoreU, coreUvs.getX(index));
}
assert(
  maximumCoreU - minimumCoreU >= 1,
  'the opaque junction patch must preserve lateral UV distance instead of collapsing the texture to one column',
);

const deadEndPatches = patches.children.filter((child) => child.name.startsWith('Road endpoint '));
assert.equal(deadEndPatches.length, 2, 'only the two true dead ends should receive terminal caps');
for (const group of deadEndPatches as THREE.Group[]) {
  assert.equal(group.children.length, 2);
  for (const mesh of group.children as THREE.Mesh[]) {
    const normals = mesh.geometry.getAttribute('normal');
    for (let index = 0; index < normals.count; index++) {
      assert(normals.getY(index) > 0.99, 'terminal cap triangles should face upward');
    }
  }
}

const terminalRoad = new RoadNetwork();
terminalRoad.addRoadPath([point(0, 0), point(20, 0)]);
const terminalEdge = [...terminalRoad.edges.values()][0];
assert(terminalEdge);
const terminalPath = Array.from({ length: 19 }, (_, index) => point(index * (20 / 18), 0));
const terminalTrim = roadTerminalTrimDistance(terminalEdge.width);
trimPathAtEndpoint(terminalPath, terminalEdge.startNodeId, terminalEdge, terminalEdge.width);
trimPathAtEndpoint(terminalPath, terminalEdge.endNodeId, terminalEdge, terminalEdge.width);
assert(Math.abs(terminalPath[0].x - terminalTrim) < 1e-9);
assert(Math.abs(terminalPath[terminalPath.length - 1].x - (20 - terminalTrim)) < 1e-9);
for (let index = 1; index < terminalPath.length; index++) {
  assert(
    terminalPath[index].x > terminalPath[index - 1].x,
    'terminal trimming must remove consumed samples instead of folding the ribbon backward',
  );
}
const capMouthDistance = terminalEdge.width * ROAD_END_TRIM;
assert.equal(
  capMouthDistance - terminalPath[0].x,
  terminalEdge.width * ROAD_CAP_OVERLAP,
  'the cap mouth should overlap the trimmed ribbon by the configured amount',
);

const terminalPatches = new RoadJunctionBuilder(flatTerrain as never, materials as never).build(terminalRoad);
const startCap = terminalPatches.getObjectByName('Road endpoint n1') as THREE.Group | undefined;
assert(startCap);
const startBlend = startCap.children[0] as THREE.Mesh;
const startBlendUvs = startBlend.geometry.getAttribute('uv');
const arcVertexCount = 23;
const outerRingStart = arcVertexCount * 3;
for (let index = outerRingStart; index < outerRingStart + arcVertexCount; index++) {
  assert.equal(startBlendUvs.getX(index), 0, 'the terminal feather must reach zero opacity at its outer arc');
}

const bridgeContext = {
  isWaterAt: () => true,
  getTerrainY: () => 0,
  getWaterSurfaceY: () => 2,
};

function verifyBridgeJunction(arms: readonly THREE.Vector3[], expectedRuns: number): void {
  const network = new RoadNetwork();
  for (const arm of arms) network.addRoadPath([point(0, 0), arm]);
  const node = [...network.nodes.values()].find((candidate) => (
    Math.abs(candidate.position.x) < 1e-6
    && Math.abs(candidate.position.z) < 1e-6
    && network.getNodeDegree(candidate) === arms.length
  ));
  assert(node);

  const meshBuilder = new RoadMeshBuilder(
    flatTerrain as never,
    materials as never,
    bridgeContext,
  );
  const edgeGroups = [...network.edges.values()].map((edge) => ({
    edge,
    group: meshBuilder.buildEdge(edge, network),
  }));
  const junctionReach = 4.2 * ROAD_JUNCTION_REACH;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  for (const { group } of edgeGroups) {
    const posts = group.getObjectByName('Bridge railing posts') as THREE.InstancedMesh | undefined;
    assert(posts, 'each bridge arm should still carry railings outside the shared hub');
    let closestPost = Infinity;
    for (let index = 0; index < posts.count; index++) {
      posts.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      const postDistance = Math.hypot(position.x, position.z);
      closestPost = Math.min(closestPost, postDistance);
    }
    assert(
      closestPost >= junctionReach - 0.2,
      `arm railings should stop at the junction perimeter instead of entering the shared deck (${closestPost.toFixed(3)} < ${junctionReach.toFixed(3)})`,
    );
  }

  const patches = new RoadJunctionBuilder(flatTerrain as never, materials as never).build(network);
  const patch = patches.getObjectByName(`Road ${node.junctionType} ${node.id}`) as THREE.Group | undefined;
  assert(patch);
  assert.equal(
    patch.children.length,
    expectedRuns > 0 ? 2 : 1,
    expectedRuns > 0
      ? 'a bridge junction should contain only its shared deck and perimeter-railing group'
      : 'a four-way bridge junction should contain only its fully open shared deck',
  );
  assert.equal(patch.userData.bridgeJunction, true);

  const deck = patch.getObjectByName(`Bridge junction deck ${node.id}`) as THREE.Mesh | undefined;
  assert(deck, 'connected bridge arms should share an explicit junction deck');
  const deckPositions = deck.geometry.getAttribute('position');
  const expectedDeckY = edgeGroups[0].edge.surfacePath?.[0]?.y;
  assert(expectedDeckY != null && expectedDeckY > 2);
  for (let index = 0; index < deckPositions.count; index++) {
    assert(
      deckPositions.getY(index) > expectedDeckY
      && deckPositions.getY(index) - expectedDeckY < 0.02,
      'the junction deck should sit just above the incident bridge surface instead of dropping to terrain',
    );
  }
  const bridgeBlend = deck.geometry.getAttribute('bridgeBlend');
  for (let index = 0; index < bridgeBlend.count; index++) {
    assert.equal(bridgeBlend.getX(index), 1, 'the shared deck should use the bridge surface material');
  }

  const railings = patch.getObjectByName('Bridge junction railings') as THREE.Group | undefined;
  if (expectedRuns === 0) {
    assert.equal(
      railings,
      undefined,
      'four-way bridge junctions must not fence any route through the shared center',
    );
    return;
  }
  assert(railings);
  assert.equal(
    railings.userData.railingRunCount,
    expectedRuns,
    'the shared railing runs should follow the junction topology',
  );
  const junctionPosts = railings.getObjectByName(
    'Bridge junction railing posts',
  ) as THREE.InstancedMesh | undefined;
  assert(junctionPosts && junctionPosts.count >= expectedRuns * 2);
  const directions = network.getIncidents(node).map(({ edge, end }) => {
    const path = edge.surfacePath ?? edge.sampledPath;
    const neighbor = end === 'start' ? path[1] : path[path.length - 2];
    return neighbor.clone().sub(node.position).setY(0).normalize();
  });
  for (let index = 0; index < junctionPosts.count; index++) {
    junctionPosts.getMatrixAt(index, matrix);
    position.setFromMatrixPosition(matrix).sub(node.position);
    for (const direction of directions) {
      const along = position.x * direction.x + position.z * direction.z;
      const across = Math.abs(-position.x * direction.z + position.z * direction.x);
      assert(
        !(along >= junctionReach - 4.2 * 0.12 && across < 4.2 * 0.3),
        'junction railings must leave every connected bridge mouth open',
      );
    }
  }
}

verifyBridgeJunction(
  [point(20, 0), point(-20, 0), point(0, 20)],
  3,
);
verifyBridgeJunction(
  [point(20, 0), point(-20, 0), point(0, 20), point(0, -20)],
  0,
);

const markerNetwork = new RoadNetwork();
markerNetwork.addRoadPath([point(0, 0), point(30, 0)]);
const markerParent = new THREE.Group();
const nodeMarkers = new RoadNodeSnapMarkers({ parent: markerParent, network: markerNetwork });
nodeMarkers.setVisible(true);
nodeMarkers.setCursor(point(0, 0));
nodeMarkers.update(0.1);
const markerGroup = markerParent.getObjectByName('Road node snap markers') as THREE.Group | undefined;
const markerRings = markerGroup?.getObjectByName('Road node snap rings') as THREE.InstancedMesh | undefined;
assert(markerRings);
assert.equal(markerRings.count, 1, 'only road nodes near the cursor should reveal');
assert.equal(
  (markerRings.material as THREE.MeshBasicMaterial).color.getHex(),
  0xffffff,
  'road-node snap circles should use the same white marker color as residence connections',
);
assert.equal(
  (markerRings.material as THREE.MeshBasicMaterial).depthTest,
  false,
  'road-node snap circles should remain visible above raised road surfaces',
);
assert.equal(
  (markerRings.material as THREE.MeshBasicMaterial).depthWrite,
  false,
  'road-node snap circles must not alter scene depth',
);
const markerMatrix = new THREE.Matrix4();
const markerPosition = new THREE.Vector3();
markerRings.getMatrixAt(0, markerMatrix);
markerPosition.setFromMatrixPosition(markerMatrix);
assert(Math.abs(markerPosition.x) < 1e-9 && Math.abs(markerPosition.z) < 1e-9);
nodeMarkers.setCursor(null);
for (let frame = 0; frame < 8; frame++) nodeMarkers.update(0.1);
assert.equal(markerRings.count, 0, 'road-node snap circles should fade away after the cursor leaves');
nodeMarkers.dispose();
assert.equal(markerParent.children.length, 0);

materials.road.dispose();
materials.roadEdge.dispose();
materials.bridgeSupport.dispose();

console.log('Road junction topology tests passed.');
