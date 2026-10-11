import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { RoadSurfaceIndex, sampleRoadSurfaceY } from '../src/roads/RoadSurfaceSampling.ts';

const network = new RoadNetwork();
for (let row = -10; row <= 10; row++) {
  network.addRoadPath([new THREE.Vector3(-500, row % 3, row * 30), new THREE.Vector3(500, row % 3 + 5, row * 30)], 4.2);
}
// Crossings at different heights and a folded path must choose the nearest
// segment of each edge, then the highest of the overlapping road surfaces.
const edges = [...network.edges.values()];
edges.push({ ...edges[0], id: 'folded', surfacePath: [
  new THREE.Vector3(-25, 20, -25), new THREE.Vector3(25, 40, 25),
  new THREE.Vector3(-25, 60, 25), new THREE.Vector3(25, 80, -25),
] });
const index = new RoadSurfaceIndex(edges);
let seed = 571;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
let covered = 0;
const compare = (x: number, z: number) => {
  const reference = sampleRoadSurfaceY(edges, x, z);
  const actual = index.sample(x, z);
  if (reference == null) assert.equal(actual, null);
  else { assert.ok(actual != null && Math.abs(actual - reference) < 1e-9, `${x},${z}: ${actual} != ${reference}`); covered++; }
};
for (let i = 0; i < 30_000; i++) compare(random() * 1100 - 550, random() * 650 - 325);
for (const x of [-512, -16, 0, 16, 512]) for (const z of [-2.184, 0, 2.184, 30]) compare(x, z);
assert.ok(covered > 2000);
// Geometry and topology edits must invalidate cached height data.
assert.notEqual(network.sampleSurfaceY(0, 0), null);
for (const edge of network.edges.values()) edge.surfacePath = edge.sampledPath.map(p => new THREE.Vector3(p.x, 100, p.z));
network.invalidateRoadGeometry();
assert.equal(network.sampleSurfaceY(0, 0), 100);
network.restore({ nextNodeId: 1, nextEdgeId: 1, nodes: [], edges: [] });
assert.equal(network.sampleSurfaceY(0, 0), null);
console.log(`PASS: 30,020 indexed samples match the full scan (${covered} road hits); geometry and topology invalidation.`);
