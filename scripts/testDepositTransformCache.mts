import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createClayDepositSystem } from '../src/clay/ClayDepositSystem.ts';
import type { ClayDepositLayout } from '../src/clay/ClayDepositLayout.ts';
import { createMineralDepositSystem } from '../src/minerals/MineralDepositSystem.ts';
import type { MineralDepositLayout } from '../src/minerals/MineralDepositLayout.ts';
import { createQuarrySystem } from '../src/quarries/QuarrySystem.ts';
import type { QuarryLayout } from '../src/quarries/QuarryLayout.ts';
import { isRetainedRenderSubtree } from '../src/scene/StaticTransformBoundary.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';
import type { ResourceNodeState } from '../src/resources/types.ts';

const terrain = { getHeightAt: (x: number, z: number) => .02 * x - .03 * z } as Terrain;
const site = { x: 12, z: -24, rotation: .7, radiusX: 12, radiusZ: 8 };
const clay = createClayDepositSystem(terrain, { sites: [{ ...site, kind: 'ordinary', formation: 'alluvial' }] } as ClayDepositLayout);
const mineral = createMineralDepositSystem(terrain, { sites: [{ ...site, resource: 'iron', grade: 'ordinary', formation: 'bedrock' }] } as MineralDepositLayout);
const quarry = createQuarrySystem(terrain, { sites: [{ ...site, kind: 'small', pitDepth: 2 }] } as QuarryLayout,
  { role: 'quarry', map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture() });
const scene = new THREE.Scene(), parent = new THREE.Group(); scene.add(parent);
parent.add(clay.group, mineral.group, quarry.group); scene.updateMatrixWorld(true);
assert.equal(isRetainedRenderSubtree(quarry.group), true, 'Unhydrated quarry starts with no render descendants');
await quarry.finishDetails(); scene.updateMatrixWorld(true);
assert.equal(isRetainedRenderSubtree(quarry.group), false, 'Progressively loaded rocks must enter renderer traversal');
assert.ok(quarry.rockPlacements.length > 0);

let visits = 0;
for (const system of [clay, mineral, quarry]) system.group.traverse(object => {
  if (object === system.group) return;
  const update = object.updateMatrixWorld;
  object.updateMatrixWorld = function(force) { visits++; update.call(this, force); };
});
for (let frame = 0; frame < 60; frame++) scene.updateMatrixWorld(true);
assert.equal(visits, 0, 'Static deposits perform no repeated descendant matrix work');
parent.position.set(-300, 2, 150); parent.scale.set(1.2, .8, 1.5); parent.rotation.y = .45;
scene.updateMatrixWorld(true); assert.ok(visits > 0, 'Moving a chunk ancestor refreshes every rigid deposit');
for (const system of [clay, mineral, quarry]) {
  const referenceParent = new THREE.Group(); referenceParent.copy(parent, false);
  const reference = system.group.clone(true); referenceParent.add(reference); referenceParent.updateMatrixWorld(true);
  const actual: THREE.Object3D[] = [], expected: THREE.Object3D[] = [];
  system.group.traverse(o => actual.push(o)); reference.traverse(o => expected.push(o));
  actual.forEach((object, i) => assert.deepEqual(object.matrixWorld.elements, expected[i]!.matrixWorld.elements));
}
const node = (nodeId: string, remaining: number): ResourceNodeState => ({
  nodeId, kind: 'quarry', resource: 'stone', remaining, maxYield: 100, x: site.x, z: site.z,
});
for (const [system, nodeId, sourceName] of [
  [clay, 'clay-ordinary-0', 'Ordinary clay clod'],
  [mineral, 'deposit-iron-ordinary-0', 'iron outcrop'],
] as const) {
  const sources: THREE.Object3D[] = []; system.group.traverse(o => { if (o.name.startsWith(sourceName)) sources.push(o); });
  assert.ok(sources.length > 0);
  assert.equal(system.syncNodes([node(nodeId, 0)]), true); scene.updateMatrixWorld(true);
  assert.ok(sources.every(o => !o.visible));
  assert.equal(system.syncNodes([node(nodeId, 100)]), true); scene.updateMatrixWorld(true);
  assert.ok(sources.every(o => o.visible));
}
assert.equal(quarry.syncNodes([node('quarry-small-0', 0)]), true);
assert.equal(quarry.rockPlacements.length, 0);
assert.equal(quarry.syncNodes([node('quarry-small-0', 100)]), true);
assert.ok(quarry.rockPlacements.length > 0);
for (const system of [clay, mineral, quarry]) system.dispose();
console.log('Deposit transform caches passed: zero idle visits, exact moved-ancestor matrices, late quarry hydration, depletion and restoration.');
