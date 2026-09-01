import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BanditCampRenderer } from '../src/security/BanditCampRenderer.ts';
import type { BanditCampState } from '../src/security/banditState.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';

const parent = new THREE.Group();
const terrain = { getHeightAt: () => 2.5 } as unknown as Terrain;
const renderer = new BanditCampRenderer(terrain, parent);
const physicalRoot = parent.getObjectByName('Physical bandit camps') as THREE.Group;
assert.ok(physicalRoot, 'bandit-camp renderer should attach its physical root');

const active = banditCamp({ active: true, health: 180, destroyedTick: 0 });
renderer.sync([active]);
assert.equal(physicalRoot.children.length, 1, 'an active camp should have one physical visual');
assert.equal(physicalRoot.children[0]!.position.y, 2.53, 'camp should follow terrain height');

const tents: THREE.Mesh[] = [];
physicalRoot.traverse((object) => {
  if (object instanceof THREE.Mesh && object.name === 'Bandit weathered canvas tent') {
    tents.push(object);
  }
});
assert.equal(tents.length, 2, 'the active camp should retain both weathered canvas shelters');
for (const tent of tents) {
  const material = tent.material as THREE.MeshStandardMaterial;
  assert.ok(material.map, 'bandit tents must use the founders-camp woven canvas texture');
  assert.match(material.map.name, /founding canvas/i);
}
const texturedTimber = physicalRoot.getObjectByName('Bandit textured perimeter stake') as THREE.Mesh;
assert.ok(texturedTimber, 'the camp should retain physical timber and prop meshes');
assert.ok(
  (texturedTimber.material as THREE.MeshStandardMaterial).map,
  'bandit timber should reuse the building wood texture map',
);

renderer.sync([banditCamp({ active: false, health: 0, destroyedTick: 42 })]);
assert.equal(
  physicalRoot.children.length,
  0,
  'an inactive destroyed camp must disappear instead of swapping to a ruin mesh',
);

renderer.sync([active]);
assert.equal(physicalRoot.children.length, 1, 'a later authoritative respawn should recreate the camp');
renderer.dispose();
assert.equal(parent.children.length, 0, 'dispose should remove the physical camp root');

console.log('Bandit camps use shared textured camp materials and disappear when destroyed.');

function banditCamp(
  overrides: Partial<BanditCampState>,
): BanditCampState {
  return {
    id: 'bandit-camp-7',
    x: 12,
    z: -9,
    health: 180,
    maxHealth: 180,
    active: true,
    stolenGoods: 0,
    spawnedTick: 1,
    nextTheftTick: 10,
    lastTheftTick: 0,
    destroyedTick: 0,
    ...overrides,
  };
}
