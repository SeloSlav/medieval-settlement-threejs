import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBridgeRailings } from '../src/roads/BridgeRailings.ts';
import { RoadJunctionBuilder } from '../src/roads/RoadJunctionBuilder.ts';
import {
  ROAD_PLACED_SAMPLE_SPACING,
  RoadMeshBuilder,
} from '../src/roads/RoadMeshBuilder.ts';
import { RoadNetwork, type RoadNetworkSnapshot } from '../src/roads/RoadNetwork.ts';
import { RoadNodeSnapMarkers } from '../src/roads/RoadNodeSnapMarkers.ts';
import {
  ROAD_VISUAL_CORE_Y_OFFSET,
  ROAD_VISUAL_SHOULDER_Y_OFFSET,
  ROAD_VISUAL_WIDTH_SCALE,
  roadCoreMaximumHalfWidth,
  roadVisualWidth,
} from '../src/roads/roadDimensions.ts';
import {
  ROAD_END_TRIM,
  ROAD_JUNCTION_REACH,
  roadTerminalTrimDistance,
  trimPathAtEndpoint,
} from '../src/roads/roadEndpoint.ts';

const point = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);

assert.equal(ROAD_VISUAL_WIDTH_SCALE, 2 / 3);
assert(Math.abs(roadVisualWidth(4.2) - 2.8) < 1e-9);
assert(
  ROAD_VISUAL_CORE_Y_OFFSET > 0
  && ROAD_VISUAL_CORE_Y_OFFSET < ROAD_VISUAL_SHOULDER_Y_OFFSET,
  'placed road surfaces must preserve terrain clearance and shoulder layering',
);

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
  bridgeRoad: new THREE.MeshBasicMaterial(),
  roadEdge: new THREE.MeshBasicMaterial(),
  bridgeSupport: new THREE.MeshBasicMaterial(),
  bridgeRailing: new THREE.MeshBasicMaterial(),
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
const elbowBlendBoundary = blend.userData.junctionBoundary as [number, number][];
const elbowOutside = new THREE.Vector2(1, -1).normalize();
const elbowVisualWidth = roadVisualWidth(4.2);
assert(
  pointInsidePolygon(
    elbowOutside.clone().multiplyScalar(elbowVisualWidth * 1.42 * 0.98),
    elbowBlendBoundary,
  ),
  'the feathered elbow must keep a round outside join instead of retreating to a terrain wedge',
);
assert(
  !pointInsidePolygon(
    elbowOutside.clone().multiplyScalar(elbowVisualWidth * 1.42 * 1.02),
    elbowBlendBoundary,
  ),
  'the feathered elbow round join should remain bounded by its authored outer radius',
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
const [elbowTextureX, elbowTextureZ] = core.userData.junctionTextureDirection as [number, number];
assert(
  Math.max(Math.abs(elbowTextureX), Math.abs(elbowTextureZ)) > 0.999,
  'a bend texture should follow one incident road instead of inventing a diagonal knot orientation',
);
assert(
  typeof core.userData.junctionTextureEdgeId === 'string'
    && core.userData.junctionTextureEdgeId.length > 0,
  'junction diagnostics should expose the road that owns texture orientation',
);
const elbowTextureIncident = elbow.getIncidents(elbowNode).find(
  ({ edge }) => edge.id === core.userData.junctionTextureEdgeId,
);
assert(elbowTextureIncident);
const expectedElbowPhase = elbowTextureIncident.end === 'start'
  ? 0
  : elbowTextureIncident.edge.length / 5.8;
assert(
  Math.abs(core.userData.junctionTexturePhaseV - expectedElbowPhase) < 1e-9,
  'the dominant road should carry its longitudinal texture phase through the junction center',
);
const elbowBlendPositions = blend.geometry.getAttribute('position');
const elbowBlendUvs = blend.geometry.getAttribute('uv');
const elbowEdgeFade = blend.geometry.getAttribute('edgeFade');
assert.equal(
  elbowEdgeFade.count,
  elbowBlendPositions.count,
  'the feather opacity field should cover every junction vertex',
);
let junctionFadeIsIndependent = false;
for (let index = 0; index < elbowEdgeFade.count; index++) {
  junctionFadeIsIndependent ||= Math.abs(elbowEdgeFade.getX(index) - elbowBlendUvs.getX(index)) > 0.1;
}
assert(
  junctionFadeIsIndependent,
  'junction feather opacity must not reuse radial values as dirt albedo UVs',
);
const elbowTexturePerp = new THREE.Vector2(-elbowTextureZ, elbowTextureX);
const elbowLocal = new THREE.Vector2(
  elbowBlendPositions.getX(1) - elbowNode.position.x,
  elbowBlendPositions.getZ(1) - elbowNode.position.z,
);
assert(
  Math.abs(
    elbowBlendUvs.getX(1)
      - (0.5 - elbowLocal.dot(elbowTexturePerp) / elbowVisualWidth)
  ) < 1e-5,
  'the feather dirt texture should use the same planar dominant-road frame as the core',
);

const rotatedCorner = new RoadNetwork();
const rotatedCornerDirections = [17, 137].map((degrees) => {
  const radians = THREE.MathUtils.degToRad(degrees);
  return new THREE.Vector3(Math.cos(radians), 0, Math.sin(radians));
});
for (const direction of rotatedCornerDirections) {
  rotatedCorner.addRoadPath([
    point(0, 0),
    point(direction.x * 18, direction.z * 18),
  ]);
}
const rotatedCornerNode = [...rotatedCorner.nodes.values()].find((node) => (
  rotatedCorner.getNodeDegree(node) === 2
));
assert(rotatedCornerNode);
const rotatedPatch = new RoadJunctionBuilder(flatTerrain as never, materials as never)
  .build(rotatedCorner)
  .getObjectByName(`Road bend ${rotatedCornerNode.id}`) as THREE.Group | undefined;
assert(rotatedPatch);
const rotatedCore = rotatedPatch.children[1] as THREE.Mesh;
const rotatedBoundary = rotatedCore.userData.junctionBoundary as [number, number][];
assert(rotatedBoundary.length >= 72, 'junction debug data should expose its deterministic boundary');
const rotatedVisualWidth = roadVisualWidth(4.2);
const maximumRoadHalfWidth = roadCoreMaximumHalfWidth(rotatedVisualWidth);
const rotatedReach = rotatedVisualWidth * 0.78;
for (const direction of rotatedCornerDirections) {
  const perpendicular = new THREE.Vector2(-direction.z, direction.x);
  for (const side of [-1, 1]) {
    for (const along of [0, rotatedReach * 0.33, rotatedReach * 0.66, rotatedReach * 0.98]) {
      const sample = new THREE.Vector2(direction.x, direction.z)
        .multiplyScalar(along)
        .addScaledVector(perpendicular, maximumRoadHalfWidth * side);
      assert(
        pointInsidePolygon(sample, rotatedBoundary),
        'a rotated junction patch must cover the full irregular road mouth without a corner wedge',
      );
    }
  }
}

for (const separationDegrees of [30, 60, 90, 120, 150]) {
  const rotationDegrees = 17;
  const directions = [rotationDegrees, rotationDegrees + separationDegrees].map((degrees) => {
    const radians = THREE.MathUtils.degToRad(degrees);
    return new THREE.Vector3(Math.cos(radians), 0, Math.sin(radians));
  });
  const network = new RoadNetwork();
  for (const direction of directions) {
    network.addRoadPath([point(0, 0), point(direction.x * 18, direction.z * 18)]);
  }
  const node = [...network.nodes.values()].find((candidate) => network.getNodeDegree(candidate) === 2);
  assert(node);
  const patch = new RoadJunctionBuilder(flatTerrain as never, materials as never)
    .build(network)
    .getObjectByName(`Road bend ${node.id}`) as THREE.Group | undefined;
  assert(patch);
  const outsideBisector = new THREE.Vector2(
    -(directions[0].x + directions[1].x),
    -(directions[0].z + directions[1].z),
  ).normalize();
  const coreBoundary = (patch.children[1] as THREE.Mesh).userData.junctionBoundary as [number, number][];
  const blendBoundary = (patch.children[0] as THREE.Mesh).userData.junctionBoundary as [number, number][];
  assert(
    pointInsidePolygon(
      outsideBisector.clone().multiplyScalar(maximumRoadHalfWidth * 0.98),
      coreBoundary,
    ),
    `${separationDegrees} degree bend core must cover the outside arc between both mouths`,
  );
  assert(
    pointInsidePolygon(
      outsideBisector.clone().multiplyScalar(rotatedVisualWidth * 1.42 * 0.98),
      blendBoundary,
    ),
    `${separationDegrees} degree bend feather must blend across the outside arc`,
  );
}

for (const turnDegrees of [120, -120, 150, -150, 170, -170]) {
  const radians = THREE.MathUtils.degToRad(turnDegrees);
  const sharpTurn = new RoadNetwork();
  sharpTurn.addRoadPath([
    point(-15, 0),
    point(0, 0),
    point(Math.cos(radians) * 15, Math.sin(radians) * 15),
  ]);
  const edge = [...sharpTurn.edges.values()][0];
  assert(edge);
  const edgeGroup = new RoadMeshBuilder(flatTerrain as never, materials as never)
    .buildEdge(edge, sharpTurn);
  const sharpCore = edgeGroup.getObjectByName(`Road core ${edge.id}`) as THREE.Mesh | undefined;
  const sharpBlend = edgeGroup.getObjectByName(`Road edge blend ${edge.id}`) as THREE.Mesh | undefined;
  assert(sharpCore && sharpBlend);
  assertTrianglesFaceUpXZ(sharpCore.geometry, `${turnDegrees} degree road core`);
  assertTrianglesFaceUpXZ(sharpBlend.geometry, `${turnDegrees} degree road feather`);
  const sharpCoreUvs = sharpCore.geometry.getAttribute('uv');
  assert.deepEqual(
    [sharpCoreUvs.getX(0), sharpCoreUvs.getX(1), sharpCoreUvs.getX(2)],
    [0, 0.5, 1],
    'the core should split through a texture-continuous center spine',
  );
}

const terrainFollowingHeight = (x: number, z: number): number => (
  Math.sin(x * 0.37) * 0.8 + Math.cos(z * 0.43) * 0.65
);
const terrainFollowingPatches = new RoadJunctionBuilder(
  {
    getHeightAt: terrainFollowingHeight,
  } as never,
  materials as never,
).build(interiorJoin);
const terrainFollowingPatch = terrainFollowingPatches.getObjectByName(
  `Road ${splitNode.junctionType} ${splitNode.id}`,
) as THREE.Group | undefined;
assert(terrainFollowingPatch, 'the three-way junction should receive terrain-following patch meshes');
const terrainFollowingCore = terrainFollowingPatch.children[1] as THREE.Mesh;
const [throughTextureX, throughTextureZ] = terrainFollowingCore.userData
  .junctionTextureDirection as [number, number];
assert(
  Math.abs(throughTextureX) > 0.999 && Math.abs(throughTextureZ) < 0.001,
  'the straight pair should dominate texture orientation through a T junction',
);
for (const mesh of terrainFollowingPatch.children as THREE.Mesh[]) {
  const maximumTriangleSpan = maximumTriangleSpanXZ(mesh.geometry);
  assert(
    maximumTriangleSpan <= ROAD_PLACED_SAMPLE_SPACING,
    'junction triangles must not exceed the placed-road terrain-sampling interval '
      + `(${maximumTriangleSpan.toFixed(3)} > ${ROAD_PLACED_SAMPLE_SPACING.toFixed(3)})`,
  );
  const minimumClearance = minimumTriangleCentroidClearance(
    mesh.geometry,
    terrainFollowingHeight,
  );
  assert(
    minimumClearance >= 0.02,
    'terrain should not break through the subdivided junction surface '
      + `(minimum centroid clearance ${minimumClearance.toFixed(3)} m)`,
  );
}

const deadEndPatches = patches.children.filter((child) => child.name.startsWith('Road endpoint '));
assert.equal(
  deadEndPatches.length,
  0,
  'dead-end caps should be part of the edge fabric instead of detached junction patches',
);

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
  terminalPath[0].x,
  capMouthDistance,
  'the ribbon should terminate exactly on the shared cap diameter',
);

const terminalEdgeGroup = new RoadMeshBuilder(
  flatTerrain as never,
  materials as never,
).buildEdge(terminalEdge, terminalRoad);
const terminalCore = terminalEdgeGroup.getObjectByName(`Road core ${terminalEdge.id}`) as THREE.Mesh | undefined;
const terminalBlend = terminalEdgeGroup.getObjectByName(`Road edge blend ${terminalEdge.id}`) as THREE.Mesh | undefined;
assert(terminalCore && terminalBlend);
assert.equal(terminalEdgeGroup.userData.logicalWidth, terminalEdge.width);
assert.equal(terminalEdgeGroup.userData.visualWidth, roadVisualWidth(terminalEdge.width));
const placedCorePositions = terminalCore.geometry.getAttribute('position');
const firstCoreWidth = Math.hypot(
  placedCorePositions.getX(0) - placedCorePositions.getX(2),
  placedCorePositions.getZ(0) - placedCorePositions.getZ(2),
);
const visualWidth = roadVisualWidth(terminalEdge.width);
assert(
  Math.abs(firstCoreWidth - visualWidth) <= visualWidth * 0.11,
  'the authored road ribbon should use the reduced visual width plus proportional edge jitter',
);
for (let index = 0; index < Math.min(placedCorePositions.count, 8); index++) {
  assert(
    Math.abs(placedCorePositions.getY(index) - ROAD_VISUAL_CORE_Y_OFFSET) < 1e-6,
    'dry road core vertices should retain the authored terrain lift',
  );
}
const placedBlendPositions = terminalBlend.geometry.getAttribute('position');
for (let index = 0; index < Math.min(placedBlendPositions.count, 12); index++) {
  assert(
    Math.abs(placedBlendPositions.getY(index) - ROAD_VISUAL_SHOULDER_Y_OFFSET) < 1e-6,
    'dry road shoulder vertices should retain the authored terrain lift',
  );
}
const terminalSampleCount = terminalEdge.sampledPath.length - 2;
assert(
  terminalCore.geometry.getAttribute('position').count > terminalSampleCount * 3,
  'the opaque dead-end arcs should be compiled into the road core geometry',
);
assert(
  terminalBlend.geometry.getAttribute('position').count > terminalSampleCount * 6,
  'the feathered dead-end arcs should be compiled into the shoulder geometry',
);

const coreIndex = terminalCore.geometry.index;
const blendIndex = terminalBlend.geometry.index;
assert(coreIndex && blendIndex);
const coreCapIndices = Array.from(
  coreIndex.array.slice((terminalSampleCount - 1) * 12),
);
for (const seamVertex of [
  0,
  2,
  (terminalSampleCount - 1) * 3,
  (terminalSampleCount - 1) * 3 + 2,
]) {
  assert(
    coreCapIndices.includes(seamVertex),
    'each opaque cap diameter must reuse the corresponding terminal ribbon vertex',
  );
}
const blendCapIndices = Array.from(
  blendIndex.array.slice((terminalSampleCount - 1) * 24),
);
for (const seamVertex of [
  0,
  1,
  2,
  3,
  4,
  5,
  terminalSampleCount * 6 - 6,
  terminalSampleCount * 6 - 5,
  terminalSampleCount * 6 - 4,
  terminalSampleCount * 6 - 3,
  terminalSampleCount * 6 - 2,
  terminalSampleCount * 6 - 1,
]) {
  assert(
    blendCapIndices.includes(seamVertex),
    'each feather ring must reuse the corresponding terminal shoulder vertex',
  );
}

const terminalCoreUvs = terminalCore.geometry.getAttribute('uv');
const coreRibbonVertexCount = terminalSampleCount * 3;
assert.deepEqual(
  [terminalCoreUvs.getX(0), terminalCoreUvs.getX(1), terminalCoreUvs.getX(2)],
  [0, 0.5, 1],
  'the placed road core should preserve left, center, and right texture coordinates',
);
let hasStartCapTextureContinuation = false;
let hasEndCapTextureContinuation = false;
const renderedTerminalLength = terminalPath[terminalPath.length - 1].x - terminalPath[0].x;
for (let index = coreRibbonVertexCount; index < terminalCoreUvs.count; index++) {
  hasStartCapTextureContinuation ||= terminalCoreUvs.getY(index) < 0;
  hasEndCapTextureContinuation ||= terminalCoreUvs.getY(index) > renderedTerminalLength / 5.8;
}
assert(hasStartCapTextureContinuation, 'the start cap texture must continue before the ribbon UV origin');
assert(hasEndCapTextureContinuation, 'the end cap texture must continue beyond the ribbon UV terminus');

const blendUvs = terminalBlend.geometry.getAttribute('uv');
assert.deepEqual(
  Array.from({ length: 6 }, (_, index) => Number(blendUvs.getX(index).toFixed(2))),
  [0, 0.42, 1, 1, 0.42, 0],
  'the terminal shoulder cross-section must retain its lateral feather instead of collapsing to zero',
);
const terminalEdgeFade = terminalBlend.geometry.getAttribute('edgeFade');
assert.deepEqual(
  Array.from({ length: 6 }, (_, index) => Number(terminalEdgeFade.getX(index).toFixed(2))),
  [0, 0.42, 1, 1, 0.42, 0],
  'the terminal shoulder should carry an opacity coordinate independent from its dirt UVs',
);
assert.equal(
  terminalEdgeFade.count,
  terminalBlend.geometry.getAttribute('position').count,
  'integrated shoulder caps must extend the opacity attribute to every vertex',
);
let outerCapVertices = 0;
for (let index = terminalSampleCount * 6; index < terminalEdgeFade.count; index++) {
  if (terminalEdgeFade.getX(index) === 0) outerCapVertices += 1;
}
assert(outerCapVertices > 0, 'the integrated terminal feather must still reach true zero opacity');

for (const mesh of [terminalCore, terminalBlend]) {
  const normals = mesh.geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index++) {
    assert(normals.getY(index) > 0.99, 'integrated terminal cap triangles should face upward');
  }
}

const transitionRailingMaterial = new THREE.MeshBasicMaterial();
const transitionRailings = buildBridgeRailings(
  [0, 1, 1, 0].map((bridgeBlend, index) => ({
    center: new THREE.Vector3(index * 2, 0, 0),
    leftDeck: new THREE.Vector3(index * 2, 0, 1),
    rightDeck: new THREE.Vector3(index * 2, 0, -1),
    bridgeBlend,
  })),
  transitionRailingMaterial,
  { start: 2.5, end: 2.5 },
);
assert(transitionRailings);
const transitionPosts = transitionRailings.getObjectByName(
  'Bridge railing posts',
) as THREE.InstancedMesh | undefined;
assert(transitionPosts);
const transitionMatrix = new THREE.Matrix4();
const transitionPosition = new THREE.Vector3();
let transitionMinimumX = Infinity;
let transitionMaximumX = -Infinity;
for (let index = 0; index < transitionPosts.count; index++) {
  transitionPosts.getMatrixAt(index, transitionMatrix);
  transitionPosition.setFromMatrixPosition(transitionMatrix);
  transitionMinimumX = Math.min(transitionMinimumX, transitionPosition.x);
  transitionMaximumX = Math.max(transitionMaximumX, transitionPosition.x);
}
assert(
  transitionMinimumX >= 2.5 - 1e-5 && transitionMaximumX <= 3.5 + 1e-5,
  'a transition sample at a shared endpoint must still honor junction railing clearance',
);
transitionRailingMaterial.dispose();

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
  const bridgeVisualWidth = roadVisualWidth(4.2);
  const junctionReach = bridgeVisualWidth * ROAD_JUNCTION_REACH;
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
        !(
          along >= junctionReach - bridgeVisualWidth * 0.12
          && across < bridgeVisualWidth * 0.3
        ),
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

const shorelineBridgeNetwork = new RoadNetwork();
for (const arm of [point(20, 0), point(-20, 0)]) {
  shorelineBridgeNetwork.addRoadPath([point(0, 0), arm]);
}
const shorelineBridgeNode = [...shorelineBridgeNetwork.nodes.values()].find((candidate) => (
  Math.abs(candidate.position.x) < 1e-6
  && Math.abs(candidate.position.z) < 1e-6
  && shorelineBridgeNetwork.getNodeDegree(candidate) === 2
));
assert(shorelineBridgeNode);
const shorelineBridgeBuilder = new RoadMeshBuilder(
  flatTerrain as never,
  materials as never,
  {
    // Keep the shared node dry while making the immediately adjacent sampled
    // section wet: the transition sample reaches the node even though its own
    // bridge blend remains zero.
    isWaterAt: (x: number, z: number) => Math.hypot(x, z) > 0.4,
    getTerrainY: () => 0,
    // Keep vertical travel modest so this fixture isolates endpoint/run
    // selection rather than bridge-grade behavior.
    getWaterSurfaceY: () => 0.2,
  },
);
const shorelineReach = roadVisualWidth(4.2) * ROAD_JUNCTION_REACH;
for (const edge of shorelineBridgeNetwork.edges.values()) {
  const group = shorelineBridgeBuilder.buildEdge(edge, shorelineBridgeNetwork);
  const core = group.getObjectByName(`Road core ${edge.id}`) as THREE.Mesh | undefined;
  const bridgeBlend = core?.geometry.getAttribute('bridgeBlend');
  assert(bridgeBlend && bridgeBlend.getX(0) <= 0.018);
  const posts = group.getObjectByName('Bridge railing posts') as THREE.InstancedMesh | undefined;
  assert(posts);
  let closestPost = Infinity;
  for (let index = 0; index < posts.count; index++) {
    posts.getMatrixAt(index, transitionMatrix);
    transitionPosition.setFromMatrixPosition(transitionMatrix);
    closestPost = Math.min(
      closestPost,
      Math.hypot(
        transitionPosition.x - shorelineBridgeNode.position.x,
        transitionPosition.z - shorelineBridgeNode.position.z,
      ),
    );
  }
  assert(
    closestPost >= shorelineReach - 0.2,
    `a bridge beginning just beyond a dry shared node must leave the junction arm open (${closestPost.toFixed(3)} < ${shorelineReach.toFixed(3)})`,
  );
}

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
materials.bridgeRoad.dispose();
materials.roadEdge.dispose();
materials.bridgeSupport.dispose();
materials.bridgeRailing.dispose();

console.log('Road junction topology tests passed.');

function maximumTriangleSpanXZ(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  assert(index, 'junction geometry should remain indexed');
  let maximum = 0;
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      maximum = Math.max(
        maximum,
        Math.hypot(
          positions.getX(end) - positions.getX(start),
          positions.getZ(end) - positions.getZ(start),
        ),
      );
    }
  }
  return maximum;
}

function minimumTriangleCentroidClearance(
  geometry: THREE.BufferGeometry,
  terrainHeightAt: (x: number, z: number) => number,
): number {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  assert(index, 'junction geometry should remain indexed');
  let minimum = Infinity;
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
    const y = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
    const z = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3;
    minimum = Math.min(minimum, y - terrainHeightAt(x, z));
  }
  return minimum;
}

function pointInsidePolygon(
  pointToTest: THREE.Vector2,
  polygon: readonly [number, number][],
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (
      (y > pointToTest.y) !== (previousY > pointToTest.y)
      && pointToTest.x < (previousX - x) * (pointToTest.y - y) / (previousY - y) + x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function assertTrianglesFaceUpXZ(
  geometry: THREE.BufferGeometry,
  label: string,
): void {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  assert(index, `${label} should remain indexed`);
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const areaY = (positions.getZ(b) - positions.getZ(a))
        * (positions.getX(c) - positions.getX(a))
      - (positions.getX(b) - positions.getX(a))
        * (positions.getZ(c) - positions.getZ(a));
    assert(
      areaY > 1e-7,
      `${label} triangle ${offset / 3} must face upward without a folded corner cutout (${areaY})`,
    );
  }
}
