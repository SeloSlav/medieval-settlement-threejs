import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ResidenceMarkers, createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { createResidenceFirewoodPile, syncFirewoodPile } from '../src/residences/residenceFirewoodPile.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';

const parent = new THREE.Group();
let shadowInvalidations = 0;
const markers = new ResidenceMarkers(parent, () => { shadowInvalidations += 1; });
const residence: ResidenceState = {
  id: 'firewood-visibility', zoneId: 'test-zone', parcelIndex: 0,
  x: 10, z: -8, yaw: 0.7, tier: 1, population: 4, populationCapacity: 4,
  settlementTicks: 0, needs: createDefaultNeeds(), abandoned: false,
  householdWealth: 8, upgradeTargetTier: 0, upgradeProgress: 0,
  upgradeRequiredTimber: 0, upgradeRequiredStone: 0, upgradeRequiredGold: 0,
  upgradeRequiredRoofTiles: 0, upgradeDeliveredTimber: 0, upgradeDeliveredStone: 0,
  upgradeDeliveredGold: 0, upgradeDeliveredRoofTiles: 0, upgradeReservedTimber: 0,
  upgradeReservedStone: 0, upgradeReservedGold: 0, upgradeReservedRoofTiles: 0,
  upgradeAssignedLabor: 0, upgradePriority: 2, tiledRoof: false,
};
const height = (x: number, z: number) => 2 + 0.08 * x - 0.04 * z;

for (const tier of [1, 2, 3, 4] as const) {
  residence.tier = tier;
  for (const stock of [0, 0.01, 0.5, 1, 6, 30, 60, 120, 0, 1]) {
    residence.needs.firewood.stock = stock;
    markers.syncResidences([residence], height);
    const pile = parent.getObjectByName('FirewoodPile') as THREE.Group;
    assert.ok(pile, `tier ${tier} must preserve the dynamic pile through batching`);
    assert.equal(pile.visible, stock > 0);
    assert.deepEqual(pile.scale.toArray(), [1, 1, 1], 'stock must not shrink individual logs');
    if (stock > 0) {
      const logs = pile.children.filter((child) => child.visible);
      assert.equal(logs.length, Math.max(3, Math.ceil(Math.min(1, stock / 60) * 10)));
      pile.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3();
      for (const log of logs) bounds.union(new THREE.Box3().setFromObject(log));
      assert.ok(bounds.max.y - bounds.min.y > 0.65, 'one unit must read as a stacked pile');
      assert.ok(pile.position.z > 0, 'firewood must be at the lane-facing end, not behind the house');
    }
    const before = shadowInvalidations;
    markers.syncResidences([residence], height);
    assert.equal(shadowInvalidations, before, 'unchanged fuel must not invalidate cached shadows');
  }
}
residence.tier = 0;
residence.needs.firewood.stock = 1;
markers.syncResidences([residence], height);
let visiblePiles = 0;
parent.traverseVisible((object) => { if (object.name === 'FirewoodPile') visiblePiles += 1; });
assert.equal(visiblePiles, 0, 'unfinished houses must not show the completed-house pile');
markers.dispose();

// Every variant retains a full-width side-wall clearance at full capacity.
for (const tier of [1, 2, 3, 4] as const) {
  for (const seed of [0, 1, 2, 7, 19, 101]) {
    const house = createResidenceMesh(seed, tier);
    const pile = house.getObjectByName('FirewoodPile') as THREE.Group;
    syncFirewoodPile(house, 60);
    const pileBounds = new THREE.Box3().setFromObject(pile);
    const halfWidth = Math.abs(pile.position.x) - 0.9;
    const clearance = pile.position.x > 0 ? pileBounds.min.x - halfWidth : -halfWidth - pileBounds.max.x;
    assert.ok(clearance > 0.19, `tier ${tier}, seed ${seed}: full pile must clear foundation edge`);
    house.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    (house.userData.windowMaterial as THREE.Material).dispose();
  }
}

// Terrain grounding also works on both sides of rotated, condition-scaled houses.
for (const side of [-1, 1]) {
  for (const yaw of [0, Math.PI / 2, Math.PI, 0.7]) {
    const house = new THREE.Group();
    house.position.set(13, height(13, -7), -7);
    house.rotation.set(0, yaw, 0.01);
    house.scale.set(0.98, 0.94, 0.99);
    const pile = createResidenceFirewoodPile(side * 3.5, 2);
    house.add(pile);
    syncFirewoodPile(house, 1, height);
    pile.updateWorldMatrix(true, true);
    for (const log of pile.children) {
      if (!log.visible) continue;
      const mesh = log as THREE.Mesh;
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y >= height(point.x, point.z) - 0.005, 'logs must not sink into sloped terrain');
      }
    }
    for (const stock of [Number.NaN, Infinity, -1, 0]) {
      syncFirewoodPile(house, stock, height);
      assert.equal(pile.visible, false, 'invalid or empty stock must not show phantom logs');
    }
    (pile.children[0] as THREE.Mesh).geometry.dispose();
  }
}
console.log('Residence firewood visibility passed: low/full/empty stock, all tiers, variants, batching, shadows, and sloped terrain.');
