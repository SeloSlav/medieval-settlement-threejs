import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CampStandardRenderer, createCampStandardAnchor, CAMP_STANDARD_ANCHOR_NAME } from '../src/settlement/CampStandardRenderer.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import { batchCompletedBuildingStaticMeshes } from '../src/buildings/staticBuildingBatch.ts';
import { disposeObject3D } from '../src/utils/dispose.ts';

const world = new THREE.Group();
world.position.set(23, 2, -8);
world.rotation.y = 0.7;
const flags = new CampStandardRenderer(world);
const founders = createFoundersCampMesh();
founders.position.set(10, 0, 0);
founders.rotation.y = -0.43;
world.add(founders);
const founderAnchor = founders.getObjectByName(CAMP_STANDARD_ANCHOR_NAME)!;
assert.ok(founderAnchor, 'founders camp owns a planted standard anchor');
batchCompletedBuildingStaticMeshes(founders);
assert.equal(founders.getObjectByName(CAMP_STANDARD_ANCHOR_NAME), founderAnchor, 'batching retains the flag anchor');
const prewarm = flags.beginGpuPrewarm(founders);
assert.equal(prewarm.objects[0], world.getObjectByName('Planted camp standards'));
const preparedCloth = world.getObjectByName('Player heraldic standard cloth') as THREE.Mesh;
const preparedGeometry = preparedCloth.geometry;
const preparedMaterial = preparedCloth.material;
assert.ok(preparedCloth.visible);
prewarm.restore();
assert.equal(flags.diagnostics()?.standards, 0);
assert.equal(preparedCloth.visible, false, 'covered warmup cannot leave a floating flag');
flags.sync([founders]);
assert.equal(preparedCloth.geometry, preparedGeometry, 'placement reuses uploaded cloth buffers');
assert.equal(preparedCloth.material, preparedMaterial, 'placement reuses compiled cloth material');

const bandit = new THREE.Group();
bandit.position.set(-10, 0, 0);
bandit.rotation.y = 1.3;
const banditAnchor = createCampStandardAnchor('bandit');
banditAnchor.position.set(-4.5, 0, 2.5);
bandit.add(banditAnchor);
world.add(bandit);
const camps = [founders, bandit];
flags.sync(camps);
assert.equal(flags.diagnostics()?.standards, 2);
assert.equal(flags.diagnostics()?.panels, 3, 'founders retain both lord and Croatian panels, outlaws get one');
assert.equal(flags.diagnostics()?.simulationNodes, 180);

const cloth = world.getObjectByName('Bandit outlaw standard cloth') as THREE.Mesh;
assert.ok(cloth);
const positions = cloth.geometry.getAttribute('position');
const initial = Array.from(positions.array);
for (let frame = 0; frame < 180; frame += 1) flags.sync(camps, 1 / 60);
assert.notDeepEqual(Array.from(positions.array), initial, 'planted flags actually simulate wind');
assert.ok(flags.diagnostics()!.maxStretchRatio < 1.22);
assert.equal(flags.diagnostics()?.ownershipResets, 0);

// The solver's first node is on the hoist: check it remains directly above
// the ground anchor after both camp and enclosing-world transforms.
const expected = banditAnchor.getWorldPosition(new THREE.Vector3());
cloth.updateWorldMatrix(true, false);
const pinned = new THREE.Vector3().fromBufferAttribute(positions, 0).applyMatrix4(cloth.matrixWorld);
assert.ok(Math.abs(pinned.x - expected.x) < 1e-5);
assert.ok(Math.abs(pinned.z - expected.z) < 1e-5);
assert.ok(Math.abs(pinned.y - (expected.y - 0.08 + 3.35)) < 1e-5);
assert.equal((cloth.material as THREE.MeshStandardMaterial).side, THREE.DoubleSide);
assert.ok(cloth.castShadow);

bandit.visible = false;
flags.sync(camps);
assert.equal(flags.diagnostics()?.standards, 1, 'hidden camps do not leave floating flags');
flags.sync([]);
assert.equal(flags.diagnostics()?.standards, 0, 'removed camps release cloth state');
bandit.visible = true;
flags.sync(camps);
assert.equal(flags.diagnostics()?.standards, 2, 'flags can be recreated after camp respawn');
flags.dispose();
assert.equal(world.getObjectByName('Planted camp standards'), undefined);
disposeObject3D(founders);
console.log('Both camps reuse planted military cloth with stable hoists, live wind, batching-safe anchors and clean disposal.');
