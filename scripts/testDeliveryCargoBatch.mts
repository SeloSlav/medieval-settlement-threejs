import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeliveryCargoCatalog, createDeliveryCartMesh, disposeDeliveryCartMesh } from '../src/logistics/deliveryCartMesh.ts';
import { DELIVERY_CARGO_KINDS, type DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import { DeliveryAgentRenderer } from '../src/logistics/DeliveryAgentRenderer.ts';
import { ExactMountedAttachmentBatch } from '../src/settlement/ExactMountedAttachmentBatch.ts';
import { geometryEqualsGeometry } from '../src/scene/geometryIdentity.ts';
import { sharedFirewoodLogGeometry } from '../src/buildings/firewoodPileMesh.ts';

const catalog = new DeliveryCargoCatalog(), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
let globalDisposals = 0, geometryDisposals = 0, materialDisposals = 0, sourceMeshes = 0;
sharedFirewoodLogGeometry().addEventListener('dispose', () => globalDisposals++);
const carts: THREE.Group[] = [];
for (const kind of DELIVERY_CARGO_KINDS) for (const regionalImport of [false, true]) {
  const actual = createDeliveryCartMesh(kind, { regionalImport, cargoCatalog: catalog });
  const reference = createDeliveryCartMesh(kind, { regionalImport });
  const a = actual.userData.deliveryCartCargo as THREE.Group, b = reference.userData.deliveryCartCargo as THREE.Group;
  assert.equal(a.name, b.name); assert.equal(a.children.length, b.children.length);
  for (let i = 0; i < a.children.length; i++) {
    const x = a.children[i] as THREE.Mesh, y = b.children[i] as THREE.Mesh;
    assert.equal(x.name, y.name); assert.equal(x.material, y.material);
    assert.deepEqual(x.position.toArray(), y.position.toArray()); assert.deepEqual(x.quaternion.toArray(), y.quaternion.toArray());
    assert.deepEqual(x.scale.toArray(), y.scale.toArray()); assert.equal(x.visible, y.visible);
    assert.equal(x.castShadow, y.castShadow); assert.equal(x.receiveShadow, y.receiveShadow); assert.equal(x.renderOrder, y.renderOrder);
    assert(geometryEqualsGeometry(x.geometry, y.geometry)); sourceMeshes++;
    if (!geometries.has(x.geometry)) x.geometry.addEventListener('dispose', () => geometryDisposals++);
    geometries.add(x.geometry);
    for (const material of Array.isArray(x.material) ? x.material : [x.material]) {
      if (!materials.has(material)) material.addEventListener('dispose', () => materialDisposals++);
      materials.add(material);
    }
  }
  carts.push(actual); disposeDeliveryCartMesh(reference);
}
for (const cart of carts) disposeDeliveryCartMesh(cart);
assert.equal(geometryDisposals, 0, 'Cart disposal must retain catalog geometries');
assert.equal(materialDisposals, 0); assert.equal(globalDisposals, 0, 'Cargo must not dispose the globally shared firewood billet');
catalog.dispose(); catalog.dispose();
assert.equal(geometryDisposals, geometries.size, 'Catalog disposes every canonical geometry exactly once');
assert.equal(materialDisposals, 0); assert.equal(globalDisposals, 0);
assert.throws(() => catalog.create('ale', false), /disposed/);

const parent = new THREE.Group(), shared = new DeliveryCargoCatalog();
const batch = new ExactMountedAttachmentBatch(parent, { initialCapacity: 2, name: 'Cargo contract', separateShadows: true });
const loads: THREE.Group[] = [];
for (let i = 0; i < 128; i++) {
  const cart = createDeliveryCartMesh('ale', { cargoCatalog: shared });
  cart.position.set(i % 16 * 3, Math.sin(i), Math.floor(i / 16) * 3); cart.rotation.y = i * .11;
  parent.add(cart); loads.push(cart); batch.registerTool(cart.userData.deliveryCartCargo);
}
for (let step = 0; step < 4; step++) {
  loads[0]!.position.x += 1; parent.position.set(13 + step, 2, -7); parent.rotation.y += .1;
  const expected = new Map<string, THREE.Matrix4[]>();
  parent.updateWorldMatrix(true, true);
  const inverse = batch.group.matrixWorld.clone().invert();
  for (const cart of loads) {
    const cargo = cart.userData.deliveryCartCargo as THREE.Group; cargo.visible = step !== 1 || cart !== loads[0];
    if (!cargo.visible) continue;
    cargo.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const key = o.geometry.uuid + '|' + (o.material as THREE.Material).uuid;
      const values = expected.get(key) ?? []; expected.set(key, values);
      values.push(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    });
  }
  batch.update();
  const colorMeshes: THREE.InstancedMesh[] = [];
  batch.group.traverse(o => { if (o instanceof THREE.InstancedMesh && !o.userData.exactMountedAttachmentShadow) colorMeshes.push(o); });
  for (const o of colorMeshes) {
    const values = expected.get(o.geometry.uuid + '|' + (o.material as THREE.Material).uuid)!;
    assert.equal(o.count, values.length);
    for (let i = 0; i < o.count; i++) {
      const actual = new THREE.Matrix4(); o.getMatrixAt(i, actual);
      for (let j = 0; j < 16; j++) assert(Math.abs(actual.elements[j]! - values[i]!.elements[j]!) < .0001);
    }
  }
  assert.equal(batch.diagnostics().visibleMeshInstances, (step === 1 ? 127 : 128) * 14);
  assert.equal(batch.diagnostics().activeDrawCalls, 8, '128 ale loads share eight exact shape/material draws');
}
const camera = new THREE.PerspectiveCamera(45, 1.4, .1, 200);
camera.position.set(16, 6, 12); camera.lookAt(16, 2, 0); camera.updateMatrixWorld(true);
batch.update(undefined, camera);
const clippedCount = batch.diagnostics().visibleMeshInstances;
assert(clippedCount > 0 && clippedCount < 1792, 'Camera selection must retain visible cargo and omit off-screen pieces');
const versions = (): number[] => { const result: number[] = []; batch.group.traverse(o => { if (o instanceof THREE.InstancedMesh) result.push(o.instanceMatrix.version); }); return result; };
const initialVersions = versions();
batch.update(undefined, camera);
assert.deepEqual(versions(), initialVersions, 'Unchanged rigid poses perform no instance upload');
camera.position.set(2000, 100, 2000); camera.lookAt(3000, 100, 3000); camera.updateMatrixWorld(true);
batch.update(undefined, camera); assert.equal(batch.diagnostics().activeDrawCalls, 0, 'Looking away submits no cargo');
const casterRoot = new THREE.Group(), caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
caster.castShadow = true; caster.position.set(1000, 0, 0); casterRoot.add(caster); parent.add(casterRoot);
batch.registerTool(casterRoot); batch.update(undefined, camera);
assert.equal(batch.diagnostics().visibleMeshInstances, 0, 'Off-screen casters are excluded from the colour prefix');
const casterPosition = caster.getWorldPosition(new THREE.Vector3());
const shadowCamera = new THREE.PerspectiveCamera(45, 1, .1, 20);
shadowCamera.position.copy(casterPosition).add(new THREE.Vector3(3, 3, 3)); shadowCamera.lookAt(casterPosition); shadowCamera.updateMatrixWorld(true);
(batch.group.getObjectByName('Cargo contract shadow draws') as THREE.Group & { prepare(camera: THREE.Camera): void }).prepare(shadowCamera);
assert.equal(batch.diagnostics().visibleShadowMeshInstances, 1, 'A separate shadow camera retains the off-screen caster');
batch.unregisterTool(casterRoot); caster.geometry.dispose(); (caster.material as THREE.Material).dispose();
for (const cart of loads) { batch.unregisterTool(cart.userData.deliveryCartCargo); disposeDeliveryCartMesh(cart); }
batch.update(); assert.equal(batch.diagnostics().activeDrawCalls, 0); batch.dispose(); shared.dispose();

// Exercise the renderer's actual phase replacement and view visibility wiring.
const warn = console.warn; console.warn = () => {};
const renderer = new DeliveryAgentRenderer({ parent: new THREE.Group(), terrain: { getHeightAt: () => 0 } as never, getGameSpeed: () => 1 });
const trip: DeliveryTripState = { id: 'cargo-lifecycle', buildingId: 'origin', residenceId: null, destinationKind: 'building',
  targetBuildingId: 'destination', cargoKind: 'ale', amount: 6, phase: 'outbound', x: 0, z: 0, progress: 0, speedMps: 3,
  unloadSeconds: 8, unloadRemaining: 0, deliveryWorkers: 1, freeHaulerWorkers: 0, oxId: null, pathDistance: 100,
  travelSpeedMultiplier: 1, routePolylineJson: '[[0,0],[100,0]]' };
const diagnostics = () => (renderer as unknown as { cartBatches: ExactMountedAttachmentBatch }).cartBatches.diagnostics();
renderer.syncTrips([trip]); renderer.update(0); assert.equal(diagnostics().visibleMeshInstances, 14);
assert(renderer.hasVisibleDynamicShadowCasters());
renderer.update(0, { centerX: 1000, centerZ: 1000, viewRadius: 10 }); assert.equal(diagnostics().visibleMeshInstances, 0);
assert(!renderer.hasVisibleDynamicShadowCasters());
renderer.update(0); assert.equal(diagnostics().visibleMeshInstances, 14, 'Returning to the view restores all cargo parts');
renderer.syncTrips([{ ...trip, phase: 'unloading' }]); renderer.update(0); assert.equal(diagnostics().visibleMeshInstances, 14);
renderer.syncTrips([{ ...trip, phase: 'inbound', amount: 0 }]); renderer.update(0); assert.equal(diagnostics().visibleMeshInstances, 0);
renderer.syncTrips([{ ...trip, cargoKind: 'water' }]); renderer.update(0); assert.equal(diagnostics().visibleMeshInstances, 8);
renderer.syncTrips([]); renderer.update(0); assert.equal(diagnostics().registeredTools, 0); assert.equal(diagnostics().activeDrawCalls, 0);
assert(!renderer.hasVisibleDynamicShadowCasters());
renderer.dispose(); await new Promise(resolve => setTimeout(resolve, 0)); console.warn = warn;
console.log(JSON.stringify({ kinds: DELIVERY_CARGO_KINDS.length, provenanceVariants: 2, sourceMeshes, canonicalGeometries: geometries.size,
  aleLoads: 128, aleSourceDraws: 1792, aleBatchedDraws: 8, exactTransformsAndLifetime: true, rendererPhaseLifecycle: true }));
