import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFireEffect, disposeFireEffect, setFireEffectActive } from '../src/fires/FireEffect.ts';
import { ResidentFireLight } from '../src/fires/ResidentFireLight.ts';

const world = new THREE.Group();
world.position.set(20, 3, -12);
world.rotation.y = 0.7;
const buildings = new THREE.Group();
world.add(buildings);
const camp = new THREE.Group();
const fire = createFireEffect();
fire.root.position.set(2, 0.5, -3);
camp.add(fire.root);
const lightLocalPosition = fire.light.position.clone();
const resident = new ResidentFireLight(fire.root, buildings);
const visibleLightIds = () => {
  const ids: number[] = [];
  world.traverseVisible(object => { if ((object as THREE.Light).isLight) ids.push(object.id); });
  return ids;
};
const preparedIds = visibleLightIds();
assert.equal(preparedIds.length, 1);
assert.equal(fire.light.intensity, 0, 'detached camp has no stray light');

for (const yaw of [0, 1.3, -2.4]) {
  buildings.add(camp);
  camp.position.set(24, 4, -18);
  camp.rotation.y = yaw;
  resident.sync();
  assert.deepEqual(visibleLightIds(), preparedIds, 'placing the camp cannot invalidate global light IDs');
  const expected = fire.root.localToWorld(lightLocalPosition.clone());
  assert.ok(fire.light.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-9,
    'resident light preserves the authored local position through camp and parent transforms');
  assert.ok(fire.light.intensity > 0);
  camp.visible = false;
  resident.sync();
  assert.equal(fire.light.intensity, 0);
  assert.deepEqual(visibleLightIds(), preparedIds, 'hiding the camp keeps the warmed lighting signature');
  camp.visible = true;
  camp.removeFromParent();
  resident.sync();
  assert.equal(fire.light.intensity, 0);
}
buildings.add(camp);
setFireEffectActive(fire, false);
resident.sync();
assert.equal(fire.light.intensity, 0, 'unoccupied camp cannot illuminate the ground');
assert.deepEqual(visibleLightIds(), preparedIds);
setFireEffectActive(fire, true);
resident.sync();
assert.ok(fire.light.intensity > 0);
disposeFireEffect(fire);
resident.sync();
assert.equal(fire.light.intensity, 0, 'demolition extinguishes the retained light');
resident.dispose();
resident.dispose();
assert.equal(visibleLightIds().length, 0, 'session disposal releases the light');
console.log('Resident camp lighting preserves shader identity, transforms, occupancy and cleanup.');
