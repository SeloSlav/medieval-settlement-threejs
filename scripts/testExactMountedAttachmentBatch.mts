import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  ExactMountedAttachmentBatch,
} from '../src/settlement/ExactMountedAttachmentBatch.ts';
import {
  attachMilitaryEquipment,
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  MILITARY_EQUIPMENT_KINDS,
  setMilitaryEquipmentCombatStance,
  setMilitaryEquipmentDropped,
  type MilitaryEquipmentKind,
} from '../src/settlement/militaryEquipment.ts';
import {
  attachWorkerTool,
  createWorkerToolSource,
} from '../src/settlement/workerTools.ts';

function makeRig(name: string): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  const waist = new THREE.Bone();
  waist.name = 'Waist';
  const spine = new THREE.Bone();
  spine.name = 'Spine02';
  spine.position.y = 0.75;
  const palmLeft = new THREE.Bone();
  palmLeft.name = 'PalmL';
  palmLeft.position.set(-0.34, 0.45, 0.04);
  const palmRight = new THREE.Bone();
  palmRight.name = 'PalmR';
  palmRight.position.set(0.34, 0.45, 0.04);
  waist.add(spine);
  spine.add(palmLeft, palmRight);
  root.add(waist);
  return root;
}

function renderablesFor(tool: THREE.Object3D): (THREE.Mesh | THREE.Line)[] {
  const mounts = (tool.userData.workerToolMounts as THREE.Object3D[] | undefined) ?? [tool];
  const output: (THREE.Mesh | THREE.Line)[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const mount of mounts) {
    mount.traverse((object) => {
      if (seen.has(object)) return;
      seen.add(object);
      const mesh = object as THREE.Mesh;
      const line = object as THREE.Line;
      if (mesh.isMesh || line.isLine) output.push(mesh.isMesh ? mesh : line);
    });
  }
  return output;
}

function assertMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4, label: string): void {
  for (let index = 0; index < 16; index += 1) {
    assert.ok(
      Math.abs(actual.elements[index]! - expected.elements[index]!) < 1e-5,
      `${label}: matrix component ${index} differs (${actual.elements[index]} vs ${expected.elements[index]})`,
    );
  }
}

const world = new THREE.Group();
world.position.set(17, 2, -9);
const rigPoolA = new THREE.Group();
rigPoolA.position.set(4, 0, 3);
const rigPoolB = new THREE.Group();
rigPoolB.position.set(-8, 0, 11);
const crowdParent = new THREE.Group();
crowdParent.position.set(12, 1, -6);
world.add(rigPoolA, rigPoolB, crowdParent);

const batch = new ExactMountedAttachmentBatch(crowdParent, {
  initialCapacity: 1,
  name: '216 exact mounted soldier kits',
});
const sources = createMilitaryEquipmentSources();
const rigs: THREE.Group[] = [];
const tools: THREE.Group[] = [];
const sourceRenderables: (THREE.Mesh | THREE.Line)[] = [];
let oneCatalogLayerCeiling = 0;

// Also prove that ordinary authored worker-tool GLB geometry follows the same
// path rather than requiring a military-only proxy.
const workerTexture = new THREE.DataTexture(new Uint8Array([86, 56, 31, 255]), 1, 1);
const workerMaterial = new THREE.MeshStandardMaterial({
  map: workerTexture,
  roughness: 0.72,
  metalness: 0.08,
});
workerMaterial.name = 'Exact authored worker-tool material';
const workerGeometry = new THREE.BoxGeometry(0.16, 0.48, 0.055);
const workerScene = new THREE.Group();
const workerMesh = new THREE.Mesh(workerGeometry, workerMaterial);
workerMesh.name = 'Exact authored worker-tool mesh';
workerScene.add(workerMesh);
const workerSource = createWorkerToolSource('hatchet', workerScene);
const workerRig = makeRig('Hidden exact worker pose rig');
workerRig.visible = false;
workerRig.position.set(-2, 0, 1);
rigPoolA.add(workerRig);
const workerTool = attachWorkerTool(workerRig, workerSource);
const workerHandle = batch.registerTool(workerTool);
assert.equal(batch.registerTool(workerTool), workerHandle, 'registering a pooled root must be idempotent');
sourceRenderables.push(...renderablesFor(workerTool));

for (let index = 0; index < 216; index += 1) {
  const kind = MILITARY_EQUIPMENT_KINDS[index % MILITARY_EQUIPMENT_KINDS.length]!;
  const rig = makeRig(`Hidden exact soldier pose rig ${index + 1}`);
  rig.visible = false;
  rig.position.set((index % 18) * 1.15, 0, Math.floor(index / 18) * 1.2);
  rig.rotation.y = (index % 7 - 3) * 0.08;
  rigPoolA.add(rig);
  const tool = attachMilitaryEquipment(rig, sources[kind]);
  if (kind === 'bow' || kind === 'crossbow') {
    setMilitaryEquipmentCombatStance(tool, index % 2 === 0 ? 'ranged' : 'melee');
  }
  if (index % 29 === 0) setMilitaryEquipmentDropped(tool, true);
  sourceRenderables.push(...renderablesFor(tool));
  batch.registerTool(tool);
  rigs.push(rig);
  tools.push(tool);
  if (index === MILITARY_EQUIPMENT_KINDS.length - 1) {
    const oneCatalog = batch.diagnostics();
    oneCatalogLayerCeiling = oneCatalog.meshBatches + oneCatalog.lineBatches;
  }
}

world.updateMatrixWorld(true);
batch.update();
let diagnostic = batch.diagnostics();
assert.equal(diagnostic.registeredTools, 217);
assert.equal(diagnostic.overflowCount, 0, 'dynamic equipment layers may never overflow');
assert.equal(diagnostic.omittedRenderableCount, 0, 'no exact source renderable may be omitted');
assert.equal(diagnostic.sourceRenderableCount, sourceRenderables.length);
assert.equal(diagnostic.hiddenSourceRenderableCount, sourceRenderables.length);
assert.ok(diagnostic.visibleMeshInstances > 216, 'complete multi-piece soldier kits must be present');
assert.ok(diagnostic.visibleLineInstances > 0, 'bow/crossbow cords must remain visible');
assert.ok(diagnostic.visibleLineSegments >= diagnostic.visibleLineInstances * 2);
assert.equal(diagnostic.sourceGeometryIdentityPreserved, true);
assert.equal(diagnostic.sourceMaterialIdentityPreserved, true);
assert.equal(diagnostic.sourceLineTopologyPreserved, true);
assert.equal(diagnostic.lineBatches, 1, 'all exact bow/crossbow cords should share one line draw');
assert.ok(diagnostic.resizeCount > 0, 'one-slot layers must grow without dropping instances');
assert.ok(
  diagnostic.activeDrawCalls <= diagnostic.meshBatches + diagnostic.lineBatches,
  'draw calls must be bounded by exact catalog layers, not company population',
);
assert.equal(
  diagnostic.meshBatches + diagnostic.lineBatches,
  oneCatalogLayerCeiling,
  'adding 207 more soldiers must not add equipment catalog draw layers',
);
assert.ok(
  diagnostic.activeDrawCalls < diagnostic.sourceRenderableCount / 3,
  `216 soldiers should collapse ${diagnostic.sourceRenderableCount} source submissions into catalog batches`,
);

const allocatedDrawCallCeiling = diagnostic.meshBatches + diagnostic.lineBatches;
const originalRegisteredCount = diagnostic.registeredTools;
assert.equal(batch.registerTool(tools[40]!), batch.registerTool(tools[40]!));
assert.equal(batch.diagnostics().registeredTools, originalRegisteredCount);

// The first spear mesh should be copied into batch-parent local space exactly.
// Index zero intentionally starts dropped; use the next active catalog mount so
// its geometry batch has a visible slot zero for exact matrix comparison.
const firstTool = tools[1]!;
const firstMesh = renderablesFor(firstTool).find((object): object is THREE.Mesh => (
  (object as THREE.Mesh).isMesh
))!;
world.updateMatrixWorld(true);
batch.update();
const submitted = batch.group.children.find((object): object is THREE.InstancedMesh => {
  const mesh = object as THREE.InstancedMesh;
  return mesh.isInstancedMesh && mesh.geometry === firstMesh.geometry;
})!;
const actual = new THREE.Matrix4();
submitted.getMatrixAt(0, actual);
const expected = batch.group.matrixWorld.clone().invert().multiply(firstMesh.matrixWorld);
assertMatrixClose(actual, expected, 'batch-parent-local exact mount transform');

// A pooled rig can change pool/owner after registration. The current bone
// matrices, not the original agent identity or parent, must drive the batch.
rigPoolB.add(rigs[1]!);
rigs[1]!.position.set(6, 0.4, -3);
rigs[1]!.rotation.y = 0.7;
world.updateMatrixWorld(true);
batch.update(crowdParent.matrixWorld.clone().invert());
submitted.getMatrixAt(0, actual);
expected.copy(crowdParent.matrixWorld).invert().multiply(firstMesh.matrixWorld);
assertMatrixClose(actual, expected, 'reparented pooled rig exact mount transform');
assert.equal(batch.hasTool(firstTool), true);

// Stance and casualty/drop visibility stays owned by the original mount Groups.
const rangedIndex = tools.findIndex((tool) => tool.userData.workerTool === 'bow');
const rangedTool = tools[rangedIndex]!;
setMilitaryEquipmentCombatStance(rangedTool, 'ranged');
setMilitaryEquipmentDropped(rangedTool, false);
world.updateMatrixWorld(true);
batch.update();
const heldDiagnostic = batch.diagnostics();
setMilitaryEquipmentDropped(rangedTool, true);
world.updateMatrixWorld(true);
batch.update();
const droppedDiagnostic = batch.diagnostics();
assert.ok(
  droppedDiagnostic.visibleMeshInstances < heldDiagnostic.visibleMeshInstances,
  'dropping a weapon must hide held exact mesh layers while retaining harness pieces',
);
assert.ok(droppedDiagnostic.visibleLineInstances <= heldDiagnostic.visibleLineInstances);
assert.equal(droppedDiagnostic.overflowCount, 0);
assert.equal(droppedDiagnostic.meshBatches + droppedDiagnostic.lineBatches, allocatedDrawCallCeiling);

const firstRenderables = renderablesFor(firstTool);
const fullCatalogDiagnostic = batch.diagnostics();
assert.equal(batch.unregisterTool(firstTool), true);
assert.equal(batch.unregisterTool(firstTool), false, 'pool-safe unregister must be idempotent');
for (const renderable of firstRenderables) {
  assert.equal(renderable.visible, true, 'unregister must restore exact source submission state');
}
assert.equal(batch.hasTool(firstTool), false);
diagnostic = batch.diagnostics();
assert.equal(diagnostic.registeredTools, 216);
assert.equal(diagnostic.overflowCount, 0);

batch.clear();
diagnostic = batch.diagnostics();
assert.equal(diagnostic.registeredTools, 0);
assert.equal(diagnostic.activeDrawCalls, 0);
assert.equal(diagnostic.overflowCount, 0);
for (const renderable of sourceRenderables) {
  assert.equal(renderable.visible, true, 'clear must restore borrowed source renderables');
}

const implementation = readFileSync(
  new URL('../src/settlement/ExactMountedAttachmentBatch.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(implementation, /FallbackMilitaryEquipmentRenderer/);
assert.doesNotMatch(implementation, /CapsuleGeometry|SphereGeometry|BoxGeometry|ConeGeometry/);
assert.match(implementation, /source\.geometry/);
assert.match(implementation, /source\.material/);
assert.match(implementation, /overflowCount: 0/);

batch.dispose();
for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);
workerGeometry.dispose();
workerMaterial.dispose();
workerTexture.dispose();

console.log(
  `Exact mounted attachments verified: 216 mixed soldiers, ${allocatedDrawCallCeiling} catalog draw-call ceiling, `
    + `${fullCatalogDiagnostic.submittedMeshTriangles.toLocaleString()} submitted exact equipment triangles, zero overflow.`,
);
