import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { fireEffectFromRoot } from '../src/fires/FireEffect.ts';
import { addTierOneChurchRuntimeClock, setTierOneChurchClockTime, CHAPEL_TOWER_CLOCK_ANCHOR_NAME } from '../src/buildings/chapelRuntimeClock.ts';
import { installStaticTransformBoundary } from '../src/scene/StaticTransformBoundary.ts';
import type { BuildingState } from '../src/resources/types.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';

const scene = new THREE.Scene(), parent = new THREE.Group(); scene.add(parent);
const markers = new BuildingMarkers({ parent, terrain: { getHeightAt: () => 2.5 } as unknown as Terrain });
const kinds = ['windmill', 'watermill', 'founders_camp', 'hunters_hall', 'marketplace'] as const;
let states = kinds.map((kind, i) => ({
  id: kind, kind, x: i * 30, z: -8, yaw: .4, workRadius: 0, actionCooldown: 0, assignedLabor: 2,
  timber: 0, firewood: 0, stone: 0, water: 0, food: 0, ale: 0, preservedFood: 0, honey: 0,
  wine: 0, wool: 0, cloth: 0, ironwork: 0, polearms: 0, gold: 0, waterCapacity: 0,
  constructionComplete: true, constructionProgress: 1, foundingShelterActive: true,
  constructionRequiredTimber: 0, constructionRequiredStone: 0, constructionDeliveredTimber: 0,
  constructionDeliveredStone: 0, constructionReservedTimber: 0, constructionReservedStone: 0,
  constructionTreasuryTimber: 0, constructionTreasuryStone: 0, storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true, storehouseAcceptsFirewood: true,
}) satisfies BuildingState);
markers.syncBuildings(states);
const roots = [...(markers as unknown as { buildingMeshes: Map<string, THREE.Group> }).buildingMeshes.values()];
const church = new THREE.Group(), anchor = new THREE.Group(); anchor.name = CHAPEL_TOWER_CLOCK_ANCHOR_NAME;
anchor.position.set(0, 7, 1); church.add(anchor); parent.add(church);
addTierOneChurchRuntimeClock(church); installStaticTransformBoundary(church); roots.push(church);

scene.updateMatrixWorld(true);
const references = roots.map(root => root.clone(true));
const nodes = roots.map(root => { const result: THREE.Object3D[] = []; root.traverse(o => result.push(o)); return result; });
const referenceNodes = references.map(root => { const result: THREE.Object3D[] = []; root.traverse(o => result.push(o)); return result; });
const visits = new Map<THREE.Object3D, number>();
for (const list of nodes) for (const object of list) {
  const original = object.updateMatrixWorld;
  object.updateMatrixWorld = function(force) { visits.set(this, (visits.get(this) ?? 0) + 1); original.call(this, force); };
}
const sails = parent.getObjectByName('Windmill sails')!, wheel = parent.getObjectByName('Watermill wheel')!;
const initialSails = sails.rotation.z, initialWheel = wheel.rotation.x;
const fire = nodes.flat().map(object => object instanceof THREE.Group ? fireEffectFromRoot(object) : null).find(Boolean)!;
const initialSmoke = fire.smoke[0]!.sprite.position.clone();
let comparisons = 0;
for (let frame = 0; frame < 120; frame++) {
  if (frame === 60) {
    states = states.map(state => ({ ...state, x: state.x + 4, yaw: .8, timber: 50 }));
    markers.syncBuildings(states);
    parent.scale.set(1.3, .9, 1.1); parent.rotation.y = .3;
  }
  markers.tick(1 / 60);
  setTierOneChurchClockTime(church, { hour: 9, minute: frame % 60, preciseHour: 9 + frame / 60 });
  scene.updateMatrixWorld(true);
  for (let group = 0; group < roots.length; group++) {
    // Ordinary Three hierarchy is the independent matrix propagation reference.
    const actual = nodes[group]!, reference = referenceNodes[group]!;
    assert.equal(actual.length, reference.length);
    for (let i = 0; i < actual.length; i++) {
      reference[i]!.position.copy(actual[i]!.position);
      reference[i]!.quaternion.copy(actual[i]!.quaternion);
      reference[i]!.scale.copy(actual[i]!.scale);
      reference[i]!.matrix.copy(actual[i]!.matrix);
      reference[i]!.matrixAutoUpdate = actual[i]!.matrixAutoUpdate;
    }
    const referenceParent = new THREE.Group();
    referenceParent.position.copy(parent.position); referenceParent.quaternion.copy(parent.quaternion); referenceParent.scale.copy(parent.scale);
    referenceParent.add(references[group]!); referenceParent.updateMatrixWorld(true);
    for (let i = 0; i < actual.length; i++) {
      assert.deepEqual(actual[i]!.matrixWorld.elements, reference[i]!.matrixWorld.elements,
        `${kinds[group] ?? 'church clock'} / ${actual[i]!.name} / frame ${frame}`);
      comparisons++;
    }
  }
}
assert.notEqual(sails.rotation.z, initialSails, 'Windmill sails remain live');
assert.notEqual(wheel.rotation.x, initialWheel, 'Watermill wheel remains live');
assert.ok(fire.smoke[0]!.sprite.position.distanceTo(initialSmoke) > 0, 'Camp smoke keeps rising');
const skipped = nodes.flat().filter(object => (visits.get(object) ?? 0) < 10).length;
assert.ok(skipped > 100, 'Rigid descendants must stay cached while registered animation islands move');
markers.syncBuildings([]); markers.tick(1 / 60); scene.updateMatrixWorld(true); markers.dispose();
console.log(`Animated building matrix parity passed: ${comparisons} comparisons over 120 frames; ${skipped} rigid descendants update only on state edits.`);
