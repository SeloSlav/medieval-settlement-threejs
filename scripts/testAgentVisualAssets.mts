import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  DELIVERY_CARGO_KINDS,
  type DeliveryCargoKind,
} from '../src/logistics/deliveryTrips.ts';
import {
  createDeliveryCartMesh,
  deliveryCartMeshName,
  disposeDeliveryCartMesh,
  type DeliveryCartModelSource,
} from '../src/logistics/deliveryCartMesh.ts';
import {
  createDeliveryCartWorkerSource,
  createDeliveryCartWorkerVisual,
  DELIVERY_CART_HANDLE_TARGETS,
  disposeDeliveryCartWorkerSources,
  disposeDeliveryCartWorkerVisual,
  updateDeliveryCartWorkerVisual,
  type DeliveryCartWorkerSources,
} from '../src/logistics/deliveryCartWorker.ts';
import {
  pickVillagerHairColor,
  pickVillagerModelVariant,
} from '../src/settlement/villagerPaths.ts';
import {
  attachWorkerTool,
  createWorkerToolSource,
  type WorkerToolKind,
} from '../src/settlement/workerTools.ts';
import {
  AGENT_WORK_ANIMATION_DISTANCE,
  isWithinWorkAnimationRange,
} from '../src/settlement/crowdView.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;

async function parseGlb(path: string) {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

const villagerAssets = [
  {
    variant: 'man',
    path: 'public/assets/models/villagers/quaternius-villager-man.glb',
  },
  {
    variant: 'woman',
    path: 'public/assets/models/villagers/quaternius-villager-woman.glb',
  },
] as const;

const deliveryWorkerSources = {} as DeliveryCartWorkerSources;
for (const asset of villagerAssets) {
  const gltf = await parseGlb(asset.path);
  const clips = gltf.animations.map((clip) => clip.name.toLowerCase());
  assert.ok(
    clips.some((name) => name.endsWith('_idle') || name.endsWith('|idle')),
    `${asset.variant} villager must retain an authored idle animation`,
  );
  assert.ok(
    clips.some((name) => name.endsWith('_walk') || name.endsWith('|walk')),
    `${asset.variant} villager must retain an authored walk animation`,
  );
  assert.ok(
    clips.some((name) => name.endsWith('_sitting') || name.endsWith('|sitting')),
    `${asset.variant} villager must retain the authored ambient sitting animation`,
  );

  let sourceMesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((object) => {
    if (!sourceMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      sourceMesh = object as THREE.SkinnedMesh;
    }
  });
  assert.ok(sourceMesh, `${asset.variant} villager must contain a skinned mesh`);

  const clone = cloneSkinned(gltf.scene);
  let cloneMesh: THREE.SkinnedMesh | null = null;
  clone.traverse((object) => {
    if (!cloneMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      cloneMesh = object as THREE.SkinnedMesh;
    }
  });
  assert.ok(cloneMesh, `${asset.variant} runtime clone must remain skinned`);
  assert.notEqual(
    cloneMesh.skeleton,
    sourceMesh.skeleton,
    `${asset.variant} runtime clone needs an independent rig`,
  );
  deliveryWorkerSources[asset.variant] = createDeliveryCartWorkerSource(
    asset.variant,
    gltf.scene,
    gltf.animations,
  );
}

const variants = Array.from({ length: 256 }, (_, index) =>
  pickVillagerModelVariant(index * 7919)
);
assert.ok(variants.includes('man'), 'deterministic villagers should include men');
assert.ok(variants.includes('woman'), 'deterministic villagers should include women');
assert.equal(pickVillagerModelVariant(12345), pickVillagerModelVariant(12345));
assert.equal(pickVillagerHairColor(67890), pickVillagerHairColor(67890));

const cartGltf = await parseGlb(
  'public/assets/models/delivery-cart/quaternius-medieval-cart.glb',
);
const materialNames = new Set<string>();
let cartMeshCount = 0;
cartGltf.scene.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  cartMeshCount += 1;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) materialNames.add(material.name);
});
assert.ok(cartMeshCount >= 5, 'Quaternius cart should retain its composed low-poly mesh');
for (const name of ['Wood', 'Red', 'Beige', 'DarkWood']) {
  assert.ok(materialNames.has(name), `cart should retain the ${name} material layer`);
}

const cartBounds = new THREE.Box3().setFromObject(cartGltf.scene);
const cartSource: DeliveryCartModelSource = {
  scene: cartGltf.scene,
  bounds: cartBounds,
  sourceHeight: cartBounds.max.y - cartBounds.min.y,
};
const cartA = createDeliveryCartMesh('firewood', {
  appearanceSeed: 12,
  source: cartSource,
});
const cartB = createDeliveryCartMesh('water', {
  appearanceSeed: 13,
  source: cartSource,
});
assert.equal(cartA.name, deliveryCartMeshName('firewood', true));
assert.equal(cartA.userData.deliveryCartAsset, 'quaternius-medieval-cart');
assert.notEqual(
  cartA.getObjectByName('Cart cargo: firewood'),
  undefined,
  'authored cart chassis should preserve the cargo-specific overlay',
);
assert.notEqual(
  cartB.getObjectByName('Cart cargo: water'),
  undefined,
  'all delivery kinds should preserve their readable load',
);

const cargoSignatures: Record<DeliveryCargoKind, string> = {
  firewood: 'Firewood split log 1',
  water: 'Water barrel',
  food: 'Fresh food basket',
  timber: 'Timber pole 1',
  grain: 'Grain sack',
  flour: 'Flour sack',
  ale: 'Ale keg',
  preservedFood: 'Preserved food crock 1',
  honey: 'Honey crock 1',
  wine: 'Wine amphora',
  stone: 'Quarried stone 1',
  polearms: 'Polearm shaft 1',
  ironwork: 'Ironwork spearhead 1',
  wool: 'Wool fleece bundle 1',
  cloth: 'Woven cloth roll 1',
  gold: 'Treasury lockbox',
};
for (const [index, kind] of DELIVERY_CARGO_KINDS.entries()) {
  const cart = createDeliveryCartMesh(kind, {
    appearanceSeed: 100 + index,
    source: cartSource,
  });
  const signature = cart.getObjectByName(cargoSignatures[kind]);
  assert.ok(signature, `${kind} cargo must retain a recognizable physical load`);
  assert.ok(
    signature instanceof THREE.Mesh,
    `${kind} cargo signature should be rendered geometry`,
  );
  disposeDeliveryCartMesh(cart);
}

const firewoodLog = cartA.getObjectByName('Firewood split log 1') as THREE.Mesh;
assert.match(
  (firewoodLog.material as THREE.Material).name,
  /timber/i,
  'firewood should use natural timber rather than an orange commodity material',
);
const waterBarrel = cartB.getObjectByName('Water barrel') as THREE.Mesh;
assert.match(
  (waterBarrel.material as THREE.Material).name,
  /timber/i,
  'water should be carried in a wooden barrel rather than a blue token cylinder',
);

const worker = createDeliveryCartWorkerVisual(84525, deliveryWorkerSources);
cartA.add(worker.root);
assert.equal(worker.root.userData.deliveryCartWorker, true);
assert.equal(worker.root.userData.deliveryCartCrewIndex, 0);
assert.equal(worker.mode, 'walk');
for (let index = 0; index < 12; index++) {
  updateDeliveryCartWorkerVisual(worker, 1 / 30, true, 1.05);
}
cartA.updateMatrixWorld(true);
for (const [side, palmName] of [
  ['left', 'PalmL'],
  ['right', 'PalmR'],
] as const) {
  const palm = worker.model.getObjectByName(palmName);
  assert.ok(palm, `delivery worker must retain ${palmName}`);
  const handPosition = palm.getWorldPosition(new THREE.Vector3());
  const handleTarget = DELIVERY_CART_HANDLE_TARGETS[side];
  const target = cartA.localToWorld(
    new THREE.Vector3(handleTarget.x, handleTarget.y, handleTarget.z),
  );
  const handDistance = handPosition.distanceTo(target);
  assert.ok(
    handDistance < 0.125,
    `${side} hand should remain planted on its cart handle (${handDistance.toFixed(3)}m)`,
  );
}
updateDeliveryCartWorkerVisual(worker, 1 / 30, false, 0);
assert.equal(worker.mode, 'idle', 'unloading workers should settle into an idle stance');

const companion = createDeliveryCartWorkerVisual(84526, deliveryWorkerSources, 1);
cartA.add(companion.root);
assert.equal(companion.root.userData.deliveryCartCrewIndex, 1);
assert.equal(companion.pinsCartHandles, false);
assert.ok(
  Math.abs(companion.root.position.x) > 0.8,
  'additional cart hands should walk beside the cart instead of overlapping the puller',
);
updateDeliveryCartWorkerVisual(companion, 1 / 30, true, 1.05);
disposeDeliveryCartWorkerVisual(companion);
disposeDeliveryCartWorkerVisual(worker);
disposeDeliveryCartMesh(cartA);
disposeDeliveryCartMesh(cartB);
disposeDeliveryCartWorkerSources(deliveryWorkerSources);

const workerToolAssets: ReadonlyArray<{
  kind: WorkerToolKind;
  path: string;
}> = [
  {
    kind: 'hatchet',
    path: 'public/assets/models/worker-tools/kenney-tool-hatchet.glb',
  },
  {
    kind: 'pickaxe',
    path: 'public/assets/models/worker-tools/kenney-tool-pickaxe.glb',
  },
  {
    kind: 'hammer',
    path: 'public/assets/models/worker-tools/kenney-tool-hammer.glb',
  },
  {
    kind: 'spear',
    path: 'public/assets/models/worker-tools/quaternius-spear.glb',
  },
];
const workerRigGltf = await parseGlb(villagerAssets[0].path);
const workerRigBounds = new THREE.Box3().setFromObject(workerRigGltf.scene);
const workerRigHeight = workerRigBounds.max.y - workerRigBounds.min.y;
for (const asset of workerToolAssets) {
  const gltf = await parseGlb(asset.path);
  const source = createWorkerToolSource(asset.kind, gltf.scene);
  const workerRig = cloneSkinned(workerRigGltf.scene) as THREE.Group;
  workerRig.scale.setScalar(1.72 / workerRigHeight);
  const tool = attachWorkerTool(workerRig, source);
  workerRig.updateMatrixWorld(true);

  assert.equal(
    tool.parent?.name,
    'PalmR',
    `${asset.kind} should be parented directly to the right-hand joint`,
  );
  assert.equal(tool.userData.workerTool, asset.kind);
  const swingClip = workerRigGltf.animations.find((clip) =>
    clip.name.toLowerCase().endsWith('_swordslash')
  );
  assert.ok(swingClip, 'worker rig should retain its authored swing animation');
  const mixer = new THREE.AnimationMixer(workerRig);
  mixer.clipAction(swingClip, workerRig).play();
  mixer.setTime(0);
  workerRig.updateMatrixWorld(true);
  const restToolPosition = tool.getWorldPosition(new THREE.Vector3());
  mixer.setTime(swingClip.duration * 0.55);
  workerRig.updateMatrixWorld(true);
  const swungToolPosition = tool.getWorldPosition(new THREE.Vector3());
  assert.ok(
    restToolPosition.distanceTo(swungToolPosition) > 0.08,
    `${asset.kind} should follow the hand joint through the swing animation`,
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(workerRig);

  const worldSize = new THREE.Box3()
    .setFromObject(tool)
    .getSize(new THREE.Vector3());
  const worldLength = Math.max(worldSize.x, worldSize.y, worldSize.z);
  const expectedRange = asset.kind === 'spear' ? [1.65, 1.95] : [0.5, 0.8];
  assert.ok(
    worldLength >= expectedRange[0] && worldLength <= expectedRange[1],
    `${asset.kind} should be scaled to a believable hand-tool length (got ${worldLength.toFixed(3)}m)`,
  );
}

const workView = {
  centerX: 0,
  centerZ: 0,
  viewRadius: 180,
  shadowRadius: 80,
};
assert.equal(
  isWithinWorkAnimationRange(AGENT_WORK_ANIMATION_DISTANCE - 0.1, 0, workView),
  true,
);
assert.equal(
  isWithinWorkAnimationRange(AGENT_WORK_ANIMATION_DISTANCE + 0.1, 0, workView),
  false,
  'skeletal chopping and mining should stop outside the work-animation LOD',
);

const villagerLicense = fs.readFileSync(
  'public/assets/models/villagers/LICENSE.txt',
  'utf8',
);
assert.match(villagerLicense, /CC0 1\.0/);
assert.match(villagerLicense, /fjHyMd5Wxw/);
assert.match(villagerLicense, /zMyPlQXBzq/);

const cartLicense = fs.readFileSync(
  'public/assets/models/delivery-cart/LICENSE.txt',
  'utf8',
);
assert.match(cartLicense, /CC0 1\.0/);
assert.match(cartLicense, /l7bDe7ak6j/);

const workerToolLicense = fs.readFileSync(
  'public/assets/models/worker-tools/LICENSE.txt',
  'utf8',
);
assert.match(workerToolLicense, /CC0 1\.0/);
assert.match(workerToolLicense, /kenney\.nl\/assets\/survival-kit/);
assert.match(workerToolLicense, /poly\.pizza\/m\/3zA9NtYBEi/);
assert.match(workerToolLicense, /Quaternius/);

console.log('villager and delivery-cart asset tests passed');
