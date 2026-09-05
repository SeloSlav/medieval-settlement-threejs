import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AMMUNITION_DIMENSIONS, acquireAmmunitionAssets, createAmmunitionGeometry } from '../src/settlement/rangedAmmunition.ts';
import { createMilitaryEquipmentSources, disposeMilitaryEquipmentSource } from '../src/settlement/militaryEquipment.ts';

for (const kind of ['arrow', 'bolt'] as const) {
  const full = createAmmunitionGeometry(kind), tail = createAmmunitionGeometry(kind, true);
  for (const attribute of ['position', 'normal', 'color']) {
    assert.deepEqual(
      full.getAttribute(attribute).array.slice(full.userData.featherStartVertex * 3),
      tail.getAttribute(attribute).array.slice(tail.userData.featherStartVertex * 3),
      `${kind}: stored and released ammunition must have identical feather surfaces and markings`,
    );
  }
  assert.ok(full.getAttribute('position').count / 3 <= 150, 'complete ammunition stays below 150 triangles');
  assert.ok(tail.boundingBox!.max.z <= .4 + 1e-6, 'quiver arrows omit concealed tips and shaft length');
  assert.ok(Math.abs(full.boundingBox!.max.z - AMMUNITION_DIMENSIONS[kind].shaft - AMMUNITION_DIMENSIONS[kind].point) < 1e-6);
  const p = full.getAttribute('position'), n = full.getAttribute('normal');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(face.length() > 1e-10, `${kind}: no degenerate triangles`);
    for (let j = i; j < i + 3; j++) {
      const normal = new THREE.Vector3().fromBufferAttribute(n, j);
      assert.ok(Number.isFinite(normal.length()) && normal.length() > .99);
      assert.ok(face.dot(normal) > 0, `${kind}: face winding agrees with vertex normals`);
    }
  }
  assert.ok(volume > 0, 'closed ammunition surfaces face outward');
  // Acquisition models simultaneous held arrows and the instanced flight batch.
  const held = acquireAmmunitionAssets(kind), flying = acquireAmmunitionAssets(kind);
  assert.equal(held.geometry, flying.geometry); assert.equal(held.material, flying.material);
  let disposed = 0;
  held.geometry.addEventListener('dispose', () => disposed++);
  held.release(); held.release();
  assert.equal(disposed, 0, 'disposing one soldier cannot invalidate arrows still in flight');
  flying.release(); assert.equal(disposed, 1, 'the last ammunition owner releases its shared GPU geometry');
  console.log(`${kind}: ${p.count / 3} complete triangles; ${tail.getAttribute('position').count / 3} stored-tail triangles; matching feathers and resource ownership verified.`);
  full.dispose(); tail.dispose();
}

const sources = createMilitaryEquipmentSources();
for (const [kind, count, ammo] of [['bow', 8, 'arrow'], ['crossbow', 5, 'bolt']] as const) {
  const quiver = sources[kind].secondaryMounts[0]!.scene;
  const mesh = quiver.children.find(child => child instanceof THREE.Mesh && (child.material as THREE.MeshStandardMaterial).vertexColors) as THREE.Mesh;
  assert.ok(mesh, 'stored feathers survive production material batching');
  const tail = createAmmunitionGeometry(ammo, true);
  assert.equal(mesh.geometry.getAttribute('position').count, tail.getAttribute('position').count * count);
  assert.ok(mesh.geometry.getAttribute('color'), 'quiver batching preserves the matching feather colors');
  tail.dispose();
}
for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);
