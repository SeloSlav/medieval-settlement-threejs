import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingStockInstances } from '../src/buildings/BuildingStockInstances.ts';

const parent = new THREE.Group();
parent.position.set(13, 2, -7); parent.rotation.y = .7;
const batch = new BuildingStockInstances(parent);
const material = new THREE.MeshStandardMaterial();
const geometry = new THREE.BoxGeometry(1, 2, 3);
const markers: THREE.Group[] = [], sources: THREE.Mesh[] = [];
for (let i = 0; i < 19; i++) {
  const marker = new THREE.Group(), stock = new THREE.Group();
  marker.position.set(i * 7, i % 3, i * -2); marker.rotation.y = i * .17;
  stock.name = 'Authored firewood Stock'; stock.position.set(1, 2, 3);
  stock.rotation.x = .23; stock.scale.set(1, .8, 1.2);
  const source = new THREE.Mesh(geometry.clone(), material);
  source.position.set(.3, .4, .5); source.castShadow = source.receiveShadow = true;
  stock.add(source); marker.add(stock); parent.add(marker);
  markers.push(marker); sources.push(source); batch.register(String(i), marker);
}
function verify(): void {
  batch.flush(); parent.updateMatrixWorld(true);
  const rendered = batch.group.children as THREE.InstancedMesh[];
  assert.equal(rendered.length, 1);
  const mesh = rendered[0]!;
  assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, true);
  const expected = sources.filter(source => {
    if (source.layers.mask !== 0) return false;
    let node: THREE.Object3D | null = source;
    while (node && node !== parent) { if (!node.visible) return false; node = node.parent; }
    return true;
  });
  assert.equal(mesh.count, expected.length);
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), local = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
    for (const corner of [[-.5, -1, -1.5], [.5, 1, 1.5]]) {
      point.fromArray(corner).applyMatrix4(matrix);
      local.fromArray(corner).applyMatrix4(expected[i]!.matrixWorld);
      assert.ok(point.distanceTo(local) < 1e-5, `world-space stock vertex ${i}`);
      local.copy(point).applyMatrix4(mesh.matrixWorld.clone().invert());
      assert.ok(mesh.boundingBox!.clone().expandByScalar(1e-4).containsPoint(local));
    }
  }
}
verify();
markers[2]!.visible = false; sources[7]!.parent!.visible = false; sources[10]!.visible = false;
markers[6]!.position.x += 93; markers[6]!.rotation.y += .45; verify();
markers[2]!.visible = true; sources[7]!.parent!.visible = true; sources[10]!.visible = true; verify();
batch.remove('3'); assert.equal(sources[3]!.layers.mask, 1); verify();
const version = (batch.group.children[0] as THREE.InstancedMesh).instanceMatrix.version;
batch.flush(); assert.equal((batch.group.children[0] as THREE.InstancedMesh).instanceMatrix.version, version);
batch.dispose(); assert.equal(batch.group.parent, null);
for (const source of sources) assert.equal(source.layers.mask, 1);
console.log('Building stock: exact transforms, 8→32 growth, hidden/reappearing parts, bounds, removal and stable uploads.');
