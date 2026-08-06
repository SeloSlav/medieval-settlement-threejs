import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  DEER_FLEE_TRIGGER_DISTANCE,
  DEER_ROAM_RADIUS,
  canDeerDetectObserver,
  createHerdSexDistribution,
  herdSexCounts,
  type DeerMotionState,
  updateDeerMotion,
} from '../src/foraging/DeerWildlifeBehavior.ts';
import {
  createGameHerdSpawnPoints,
  skeletonsUseSharedRig,
} from '../src/foraging/DeerWildlifeVisuals.ts';
import {
  GAME_PATCH_MAX_YIELD,
  RICH_GAME_PATCH_MAX_YIELD,
  displayedGameAnimalCount,
} from '../src/foraging/foragingYields.ts';
import { formatResourceAmount } from '../src/resources/yields.ts';

function fixedRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index++;
    return value;
  };
}

{
  const standardHerd = createGameHerdSpawnPoints(
    { x: 10, z: -20, kind: 'game' },
    fixedRandom([0.18, 0.74, 0.42, 0.91]),
  );
  const largeHerd = createGameHerdSpawnPoints(
    { x: -30, z: 40, kind: 'game', isRich: true },
    fixedRandom([0.12, 0.64, 0.37, 0.88]),
  );
  assert.equal(standardHerd.length, GAME_PATCH_MAX_YIELD);
  assert.equal(largeHerd.length, RICH_GAME_PATCH_MAX_YIELD);
  assert.equal(displayedGameAnimalCount(7.99), 7);
  assert.equal(formatResourceAmount('game', 7.99), '7 game');
}

{
  assert.deepEqual(herdSexCounts(0), { doeCount: 0, stagCount: 0 });
  assert.deepEqual(herdSexCounts(1), { doeCount: 1, stagCount: 0 });
  assert.deepEqual(herdSexCounts(2), { doeCount: 1, stagCount: 1 });
  assert.deepEqual(herdSexCounts(5), { doeCount: 4, stagCount: 1 });
  assert.deepEqual(herdSexCounts(12), { doeCount: 10, stagCount: 2 });
  assert.deepEqual(herdSexCounts(20), { doeCount: 16, stagCount: 4 });
  for (let population = 2; population <= 20; population++) {
    const counts = herdSexCounts(population);
    assert.equal(counts.doeCount + counts.stagCount, population);
    assert.ok(counts.doeCount >= 1, `${population} deer should include a doe`);
    assert.ok(counts.stagCount >= 1, `${population} deer should include a stag`);
    assert.equal(
      counts.stagCount,
      Math.min(population - 1, Math.max(1, Math.round(population * 0.2))),
      `${population} deer should retain the intended stag ratio`,
    );
  }

  const distribution = createHerdSexDistribution(5, fixedRandom([0.18, 0.74, 0.42, 0.91]));
  assert.equal(distribution.filter((sex) => sex === 'stag').length, 1, 'a five-deer herd should have one stag');
  assert.equal(distribution.filter((sex) => sex === 'doe').length, 4, 'a five-deer herd should remain doe-heavy');
}

function createMotion(overrides: Partial<DeerMotionState> = {}): DeerMotionState {
  return {
    x: 0,
    z: 0,
    homeX: 0,
    homeZ: 0,
    targetX: 0,
    targetZ: 0,
    heading: 0,
    speed: 0,
    mode: 'idle',
    modeTimer: 4,
    fleeBias: 0,
    ...overrides,
  };
}

{
  const facingPositiveZ = createMotion({ heading: 0 });
  const behind = { x: 0, z: -8, crouching: true };
  const inFront = { x: 0, z: 8, crouching: true };
  assert.equal(
    canDeerDetectObserver(facingPositiveZ, behind),
    false,
    'a crouching player directly behind a deer should be hidden from its awareness cone',
  );
  assert.equal(
    canDeerDetectObserver(facingPositiveZ, inFront),
    true,
    'a crouching player in front of a deer should be detected',
  );
  assert.equal(
    canDeerDetectObserver(facingPositiveZ, { ...behind, crouching: false }),
    true,
    'a standing player behind a deer should still be detected',
  );
}

{
  const motion = createMotion({ heading: 0 });
  updateDeerMotion(motion, 1 / 60, {
    observer: { x: 0, z: -8, crouching: true },
    random: fixedRandom([0.4]),
  });
  assert.notEqual(motion.mode, 'flee', 'crouch-sneaking from behind should not scare the deer');
  updateDeerMotion(motion, 1 / 60, {
    observer: { x: 0, z: -8, crouching: false },
    random: fixedRandom([0.4]),
  });
  assert.equal(motion.mode, 'flee', 'standing up behind the deer should scare it immediately');
}

{
  const motion = createMotion({ modeTimer: 0.01 });
  const random = fixedRandom([0.15, 0.2, 0.72, 0.4, 0.65, 0.3]);
  for (let frame = 0; frame < 600; frame++) {
    updateDeerMotion(motion, 1 / 60, { observer: null, random });
  }
  assert.ok(Math.hypot(motion.x, motion.z) > 0.5, 'an undisturbed deer should roam away from its spawn');
  assert.ok(
    Math.hypot(motion.x - motion.homeX, motion.z - motion.homeZ) <= DEER_ROAM_RADIUS + 1,
    'ordinary roaming should stay near the game resource',
  );
  assert.notEqual(motion.mode, 'flee', 'orbit-camera observation must not scare deer');
}

{
  const motion = createMotion();
  const observer = { x: DEER_FLEE_TRIGGER_DISTANCE * 0.4, z: 0, crouching: false };
  const initialDistance = Math.hypot(motion.x - observer.x, motion.z - observer.z);
  const random = fixedRandom([0.2, 0.7, 0.4, 0.8]);
  for (let frame = 0; frame < 120; frame++) {
    updateDeerMotion(motion, 1 / 60, { observer, random });
  }
  const escapedDistance = Math.hypot(motion.x - observer.x, motion.z - observer.z);
  assert.equal(motion.mode, 'flee', 'a close first-person observer should trigger fleeing');
  assert.ok(escapedDistance > initialDistance + 6, 'the deer should sprint away from the observer');
  assert.ok(motion.speed > 6, 'fleeing should reach gallop speed');

  updateDeerMotion(motion, 1 / 60, { observer: null, random });
  assert.equal(motion.mode, 'walk', 'deer should return to roaming when the observer is gone');
}

for (const asset of [
  { label: 'doe', path: 'public/assets/models/deer/quaternius-deer.glb', minimumJoints: 40 },
  { label: 'stag', path: 'public/assets/models/deer/quaternius-stag.glb', minimumJoints: 35 },
]) {
  const modelBytes = fs.readFileSync(asset.path);
  const modelBuffer = modelBytes.buffer.slice(
    modelBytes.byteOffset,
    modelBytes.byteOffset + modelBytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(modelBuffer, '', resolve, reject);
  });

  const directClipNames = new Set(
    gltf.animations.filter((clip) => !clip.name.includes('|')).map((clip) => clip.name),
  );
  for (const clipName of ['Idle', 'Eating', 'Walk', 'Gallop']) {
    assert.ok(directClipNames.has(clipName), `${asset.label} GLB should contain the ${clipName} clip`);
  }

  let sourceSkinnedMesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((object) => {
    const skinnedMesh = object as THREE.SkinnedMesh;
    if (!sourceSkinnedMesh && skinnedMesh.isSkinnedMesh) sourceSkinnedMesh = skinnedMesh;
  });
  assert.ok(sourceSkinnedMesh, `${asset.label} GLB should contain a skinned mesh`);
  assert.ok(
    sourceSkinnedMesh.skeleton.bones.length >= asset.minimumJoints,
    `${asset.label} GLB should retain its full articulated rig`,
  );

  const clonedScene = cloneSkinned(gltf.scene);
  const clonedSkinnedMeshes: THREE.SkinnedMesh[] = [];
  clonedScene.traverse((object) => {
    const skinnedMesh = object as THREE.SkinnedMesh;
    if (skinnedMesh.isSkinnedMesh) clonedSkinnedMeshes.push(skinnedMesh);
  });
  const clonedSkinnedMesh = clonedSkinnedMeshes[0];
  assert.ok(clonedSkinnedMesh, `the ${asset.label} runtime clone should remain skinned`);
  assert.notEqual(
    clonedSkinnedMesh.skeleton,
    sourceSkinnedMesh.skeleton,
    `each ${asset.label} should receive an independent skeleton for animation`,
  );
  assert.ok(
    clonedSkinnedMeshes.length > 1,
    `the ${asset.label} runtime clone should retain its material layers`,
  );
  assert.notEqual(
    clonedSkinnedMeshes[1]!.skeleton,
    clonedSkinnedMesh.skeleton,
    `SkeletonUtils should keep distinct ${asset.label} skeleton wrappers per material layer`,
  );
  assert.ok(
    clonedSkinnedMeshes.every((mesh) => (
      skeletonsUseSharedRig(mesh.skeleton, clonedSkinnedMesh.skeleton)
    )),
    `all cloned ${asset.label} material layers should be accepted as one shared rig`,
  );
}

const mapIconSource = fs.readFileSync('src/map/ForagingMapIcons.ts', 'utf8');
assert.match(mapIconSource, /GAME_ICON_HTML/, 'the high-zoom game resource marker should remain defined');
assert.match(
  mapIconSource,
  /foraging-map-icon--game/,
  'the game resource should retain its own static map-marker style',
);

const sceneManagerSource = fs.readFileSync('src/scene/SceneManager.ts', 'utf8');
assert.match(
  sceneManagerSource,
  /isSpawnBlockedAt:\s*isForagingSiteBlocked/,
  'initial deer spawn points should still avoid rivers and quarries',
);
assert.match(
  sceneManagerSource,
  /isMovementBlockedAt:\s*\(x,\s*z\)\s*=>\s*this\.quarrySystem\.isBlockedAt\(x,\s*z\)/,
  'roaming deer should treat quarries, but not water, as movement obstacles',
);

console.log('test:deer-wildlife passed');
