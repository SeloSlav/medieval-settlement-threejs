import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  OX_DRAG_LOAD_KINDS,
  OxDragLoadLibrary,
  oxDragLoadKindForWorkplace,
} from '../src/settlement/oxDragLoad.ts';

assert.equal(oxDragLoadKindForWorkplace('lumber_mill'), 'timber');
assert.equal(oxDragLoadKindForWorkplace('woodcutters_lodge'), 'timber');
assert.equal(oxDragLoadKindForWorkplace('stone_quarry'), 'stone');
assert.equal(oxDragLoadKindForWorkplace('mine'), 'iron');
assert.equal(oxDragLoadKindForWorkplace('clay_pit'), 'clay');
assert.equal(oxDragLoadKindForWorkplace('charcoal_burner'), 'charcoal');
assert.equal(oxDragLoadKindForWorkplace('threshing_barn'), 'sheaves');
assert.equal(oxDragLoadKindForWorkplace('pastoral_farmstead'), 'feed');
assert.equal(oxDragLoadKindForWorkplace('carpenter'), 'planks');
assert.equal(oxDragLoadKindForWorkplace('reforester'), null);

const library = new OxDragLoadLibrary();
for (const kind of OX_DRAG_LOAD_KINDS) {
  const load = library.create(kind);
  load.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  load.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  assert.ok(meshes.length > 0, `${kind} must contain rendered geometry`);
  assert.ok(meshes.length <= 4, `${kind} should remain a low-draw-call merged assembly`);
  for (const mesh of meshes) {
    const positions = mesh.geometry.getAttribute('position');
    assert.ok(positions && positions.count >= 3, `${mesh.name} must contain vertices`);
    for (let index = 0; index < positions.count; index += 1) {
      assert.ok(
        Number.isFinite(positions.getX(index))
          && Number.isFinite(positions.getY(index))
          && Number.isFinite(positions.getZ(index)),
        `${mesh.name} must not contain invalid positions`,
      );
    }
  }

  const bounds = new THREE.Box3().setFromObject(load);
  assert.ok(bounds.min.y >= -0.025, `${kind} should rest on the ground plane`);
  if (kind === 'timber') {
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.z > 3, 'dragged logs must read as full-length trunks');
    assert.ok(size.z > size.x * 2.5, 'dragged logs must align lengthwise behind the ox');
  }
}

const firstTimber = library.create('timber');
const secondTimber = library.create('timber');
const firstGeometry = (firstTimber.children[0] as THREE.Mesh).geometry;
const secondGeometry = (secondTimber.children[0] as THREE.Mesh).geometry;
assert.strictEqual(
  firstGeometry,
  secondGeometry,
  'multiple oxen must share merged cargo geometry instead of rebuilding it',
);
library.dispose();

console.log('test:ox-drag-load passed');
