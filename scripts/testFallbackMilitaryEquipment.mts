import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FALLBACK_MILITARY_EQUIPMENT_DRAW_CALL_BUDGET,
  FALLBACK_MILITARY_EQUIPMENT_KEYS,
  FallbackMilitaryEquipmentRenderer,
  fallbackEquipmentKey,
} from '../src/settlement/FallbackMilitaryEquipmentRenderer.ts';
import type { WorkerToolKind } from '../src/settlement/workerTools.ts';

assert.equal(FALLBACK_MILITARY_EQUIPMENT_DRAW_CALL_BUDGET, 11);
assert.equal(new Set(FALLBACK_MILITARY_EQUIPMENT_KEYS).size, 11);
assert.equal(fallbackEquipmentKey('bow', 12), 'bow:ranged');
assert.equal(fallbackEquipmentKey('bow', 2), 'bow:melee');
assert.equal(fallbackEquipmentKey('crossbow', 12), 'crossbow:ranged');
assert.equal(fallbackEquipmentKey('crossbow', 2), 'crossbow:melee');
assert.equal(fallbackEquipmentKey('axe', 4), null);

const tools: WorkerToolKind[] = [
  'spear', 'spear-shield', 'pike-kit', 'sidearm', 'sidearm-shield',
  'sword-shield', 'halberd', 'bow', 'crossbow',
];
const parent = new THREE.Group();
const renderer = new FallbackMilitaryEquipmentRenderer(parent);
const agents = Array.from({ length: 216 }, (_, index) => ({
  id: `stress:${index}`,
  tool: tools[index % tools.length],
  combatTargetDistance: index % 4 === 0 ? 2 : 12,
  x: index % 18,
  y: 0,
  z: Math.floor(index / 18),
  yaw: index * 0.17,
}));
renderer.sync(agents);
const diagnostics = renderer.diagnostics();
assert.equal(diagnostics.length, FALLBACK_MILITARY_EQUIPMENT_DRAW_CALL_BUDGET);
assert.equal(diagnostics.reduce((sum, row) => sum + row.instances, 0), 216);
assert.ok(diagnostics.every((row) => row.triangles > 0));
assert.ok(diagnostics.every((row) => row.triangles < 1_500), 'each rigid kit LOD must remain cheap');
assert.ok(
  diagnostics.reduce((sum, row) => sum + row.triangles, 0) < 9_000,
  'the complete eleven-stance catalog must remain within its shared topology budget',
);
assert.equal(parent.children.length, 1);
assert.equal(parent.children[0]!.children.length, FALLBACK_MILITARY_EQUIPMENT_DRAW_CALL_BUDGET);

const excluded = new Set(agents.slice(0, 72).map((agent) => agent.id));
renderer.sync(agents, excluded);
assert.equal(
  renderer.diagnostics().reduce((sum, row) => sum + row.instances, 0),
  144,
  'field mode should arm every soldier outside the 72-rig close cohort',
);

renderer.dispose();
assert.equal(parent.children.length, 0);

console.log('Fallback military equipment arms every distance-LOD soldier in 11 bounded instanced draws.');
