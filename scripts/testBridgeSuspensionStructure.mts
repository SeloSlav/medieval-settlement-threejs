import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BRIDGE_SUSPENSION_STYLE,
  buildBridgeSuspensionStructure,
  setBridgeSuspensionDebugMode,
} from '../src/roads/BridgeSuspension.ts';
import type { BridgeSpan } from '../src/roads/RiverBridgeSpans.ts';

const timber = new THREE.MeshBasicMaterial({ color: 0x6b4e38 });
const rope = new THREE.MeshBasicMaterial({ color: 0x7a5b38 });
const path = [
  new THREE.Vector3(-16, 0.72, -1.5),
  new THREE.Vector3(-8, 1.18, -0.55),
  new THREE.Vector3(0, 1.3, 0.35),
  new THREE.Vector3(8, 1.24, 0.9),
  new THREE.Vector3(16, 0.76, 1.6),
];
const span: BridgeSpan = {
  rampStart: 0,
  deckStart: 4,
  deckEnd: 28,
  rampEnd: 32,
  deckY: 1.3,
};

const structure = buildBridgeSuspensionStructure(
  path,
  3.1,
  [span],
  timber,
  rope,
);
assert(structure, 'a bridge span should produce an above-deck suspension structure');
assert.equal(structure.name, 'Bridge suspension structure');
assert.equal(structure.userData.fpNoCollision, true);

const evidence = structure.userData.bridgeSuspension as {
  deterministicInput: string;
  debugMode: string;
  spanCount: number;
  towerStationCount: number;
  cableBayCount: number;
  mainCableCount: number;
  backstayCount: number;
  anchorageCount: number;
  suspenderCount: number;
  geometry: { drawCalls: number; triangles: number; instances: number };
};
assert.equal(evidence.deterministicInput, 'sampled-path-and-bridge-spans');
assert.equal(evidence.spanCount, 1);
assert.equal(evidence.towerStationCount, 3, 'long bridges need entry, middle, and exit tower stations');
assert.equal(evidence.cableBayCount, 2);
assert.equal(evidence.mainCableCount, 4, 'each tower bay needs a main cable on both sides');
assert.equal(evidence.backstayCount, 4, 'paired end towers need four backstays');
assert.equal(evidence.anchorageCount, 4, 'each backstay needs a bank anchorage');
assert(evidence.suspenderCount >= 24, 'main cables should be visibly tied down to both deck edges');
assert(evidence.geometry.drawCalls <= 8, 'the authored assembly should remain a compact static draw bundle');
assert(evidence.geometry.triangles > 0 && evidence.geometry.triangles < 8_000);

const towerPosts = structure.getObjectByName(
  'Bridge suspension tower posts',
) as THREE.InstancedMesh | undefined;
const towerCrossbeams = structure.getObjectByName(
  'Bridge suspension tower crossbeams',
) as THREE.InstancedMesh | undefined;
const towerCaps = structure.getObjectByName(
  'Bridge suspension tower caps',
) as THREE.InstancedMesh | undefined;
const mainCables = structure.getObjectByName(
  'Bridge main suspension cable tubes',
) as THREE.Mesh | undefined;
const backstays = structure.getObjectByName(
  'Bridge suspension backstay tubes',
) as THREE.Mesh | undefined;
const anchorPosts = structure.getObjectByName(
  'Bridge suspension anchor posts',
) as THREE.InstancedMesh | undefined;
const hangers = structure.getObjectByName(
  'Bridge suspension vertical hangers',
) as THREE.InstancedMesh | undefined;
assert.equal(towerPosts?.count, 6, 'three paired timber pylons should establish the bridge silhouette');
assert.equal(towerCrossbeams?.count, 3, 'each tower station should be tied across the roadway');
assert.equal(towerCaps?.count, 6);
assert(mainCables && backstays, 'main cables and end backstays must both be physical tube geometry');
assert.equal(anchorPosts?.count, 4);
assert.equal(hangers?.count, evidence.suspenderCount);

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
towerPosts.getMatrixAt(0, matrix);
matrix.decompose(position, quaternion, scale);
assert.ok(
  Math.abs(
    scale.y
    - (
      BRIDGE_SUSPENSION_STYLE.silhouette.towerHeight
      + BRIDGE_SUSPENSION_STYLE.silhouette.towerEmbedDepth
    )
  ) < 1e-6,
  'tower height must remain owned by the suspension dimension contract',
);
assert.ok(scale.x >= 0.29 && scale.z >= 0.33, 'pylons should read as structural timber, not railing posts');

mainCables.geometry.computeBoundingBox();
const cableBounds = mainCables.geometry.boundingBox;
assert(cableBounds);
assert.ok(cableBounds.max.y - cableBounds.min.y > 0.8, 'main cables need a readable suspension sag');
for (const attributeName of ['position', 'normal', 'uv']) {
  const attribute = mainCables.geometry.getAttribute(attributeName);
  assert(attribute, `main cable tubes should expose ${attributeName}`);
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      assert(Number.isFinite(attribute.array[index * attribute.itemSize + component]));
    }
  }
}

setBridgeSuspensionDebugMode(structure, 'towers');
assert.equal(evidence.debugMode, 'towers');
for (const child of structure.children) {
  assert.equal(
    child.visible,
    child.userData.bridgeSuspensionPart === 'towers',
    'tower isolation must hide every non-tower load-path component',
  );
}
setBridgeSuspensionDebugMode(structure, 'final');
assert(structure.children.every((child) => child.visible), 'final debug mode should restore the complete bridge');

const shortStructure = buildBridgeSuspensionStructure(
  [new THREE.Vector3(-4, 1, 0), new THREE.Vector3(4, 1, 0)],
  2.8,
  [{ rampStart: 0, deckStart: 1, deckEnd: 7, rampEnd: 8, deckY: 1 }],
  timber,
  rope,
);
assert(shortStructure);
const shortEvidence = shortStructure.userData.bridgeSuspension as {
  towerStationCount: number;
  mainCableCount: number;
};
assert.equal(shortEvidence.towerStationCount, 2, 'short crossings should not be crowded by a middle tower');
assert.equal(shortEvidence.mainCableCount, 2);

timber.dispose();
rope.dispose();
console.log('test:bridge-suspension passed');
