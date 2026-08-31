import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AuthoredSkinnedInstanceBatch,
} from '../src/scene/AuthoredSkinnedInstanceBatch.ts';
import { COMBAT_AGENT_STATES } from '../src/security/combatAgents.ts';
import {
  applyCombatWeaponPose,
  bindCombatWeaponRig,
  disposeCombatWeaponRig,
  resolveCombatWeaponPresentation,
  restoreCombatWeaponPose,
} from '../src/settlement/combatWeaponAnimation.ts';
import {
  MILITARY_EQUIPMENT_KINDS,
  attachMilitaryEquipment,
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
  setMilitaryEquipmentCombatStance,
  setMilitaryEquipmentDropped,
  type MilitaryEquipmentKind,
  type MilitaryEquipmentSource,
} from '../src/settlement/militaryEquipment.ts';
import { shouldCreateBattlefieldWeaponDrop } from '../src/settlement/militaryWeaponDropPolicy.ts';
import {
  ExactMountedAttachmentBatch,
} from '../src/settlement/ExactMountedAttachmentBatch.ts';

const browserGlobal = globalThis as typeof globalThis & {
  self?: typeof globalThis;
  createImageBitmap?: () => Promise<unknown>;
};
browserGlobal.self = globalThis;
browserGlobal.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const MODEL_CASES = [
  {
    label: 'Croatian male',
    path: 'public/assets/models/villagers/worker-male-common-01-v002.glb',
    targetHeight: 1.72,
    heldKind: 'spear-shield',
  },
  {
    label: 'Ottoman raider',
    path: 'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
    targetHeight: 1.74,
    heldKind: 'sidearm',
  },
] as const;

const POSES = [
  { label: 'walk+fight overlay', clip: 'walk', logicalMode: 'fight' },
  { label: 'run+fight overlay', clip: 'run', logicalMode: 'fight' },
  { label: 'fight', clip: 'slash', logicalMode: 'fight' },
  { label: 'hurt', clip: 'hit_to_body_01', logicalMode: 'hurt' },
  { label: 'fall', clip: 'fall', logicalMode: 'fall' },
] as const;
const SAMPLE_FRACTIONS = [0.17, 0.51, 0.83] as const;
const MATRIX_EPSILON = 2e-5;
const LOCAL_GRIP_EPSILON = 2e-5;
const MAX_HAND_MOUNT_WORLD_OFFSET_METERS = 0.12;

for (const status of COMBAT_AGENT_STATES) {
  for (const kind of MILITARY_EQUIPMENT_KINDS) {
    assert.equal(
      shouldCreateBattlefieldWeaponDrop(status, kind),
      status === 'downed',
      `${status} ${kind} drop ownership`,
    );
  }
}
assert.equal(shouldCreateBattlefieldWeaponDrop('downed', 'hatchet'), false);
assert.equal(shouldCreateBattlefieldWeaponDrop('fighting', null), false);

const sources = createMilitaryEquipmentSources();
const coLocationReports: Array<{
  model: string;
  kind: MilitaryEquipmentKind;
  frames: number;
  maxBodyBoneMatrixError: number;
  maxEquipmentMatrixError: number;
  maxCoLocationMatrixError: number;
}> = [];
const reports: Array<{
  model: string;
  kind: MilitaryEquipmentKind;
  samples: number;
  maxMatrixError: number;
  maxLocalGripError: number;
  maxHandMountOffsetMeters: number;
}> = [];

for (const modelCase of MODEL_CASES) {
  const source = await loadGlb(modelCase.path);
  const sourceHeight = new THREE.Box3().setFromObject(source.scene)
    .getSize(new THREE.Vector3()).y;
  assert.ok(sourceHeight > 0.001, `${modelCase.label} source height`);
  const clips = new Map(source.animations.map((clip) => [clip.name, clip]));
  for (const pose of POSES) {
    assert.ok(clips.has(pose.clip), `${modelCase.label} must contain ${pose.clip}`);
  }
  coLocationReports.push(verifyBatchedBodyEquipmentCoLocation(
    modelCase,
    source,
    sourceHeight,
    sources[modelCase.heldKind],
  ));

  for (const kind of MILITARY_EQUIPMENT_KINDS) {
    const actor = new THREE.Group();
    actor.name = `${modelCase.label} attachment-contract actor`;
    actor.position.set(7.25, 1.3, -4.6);
    actor.rotation.set(0.03, -0.71, -0.02);
    const model = cloneSkinned(source.scene) as THREE.Group;
    model.scale.setScalar(modelCase.targetHeight / sourceHeight);
    actor.add(model);
    const tool = attachMilitaryEquipment(model, sources[kind]);
    const combatRig = bindCombatWeaponRig(model, kind, tool);
    assert.ok(combatRig, `${modelCase.label} ${kind} must bind the production combat rig`);
    const mixer = new THREE.AnimationMixer(model);
    const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
    assert.ok(mounts?.length, `${modelCase.label} ${kind} mount catalog`);

    const report = {
      model: modelCase.label,
      kind,
      samples: 0,
      maxMatrixError: 0,
      maxLocalGripError: 0,
      maxHandMountOffsetMeters: 0,
    };

    for (const pose of POSES) {
      const clip = clips.get(pose.clip)!;
      for (const fraction of SAMPLE_FRACTIONS) {
        restoreCombatWeaponPose(combatRig);
        mixer.stopAllAction();
        const action = mixer.clipAction(clip, model).reset().play();
        action.time = clip.duration * fraction;
        mixer.update(0);

        setMilitaryEquipmentDropped(tool, false);
        const presentation = resolveCombatWeaponPresentation(
          kind,
          kind === 'bow' || kind === 'crossbow' ? 12 : 1.8,
        );
        assert.ok(presentation, `${kind} combat presentation`);
        setMilitaryEquipmentCombatStance(tool, presentation.stance);
        applyCombatWeaponPose(combatRig, {
          tool: kind,
          targetDistance: kind === 'bow' || kind === 'crossbow' ? 12 : 1.8,
          attackCooldown: presentation.attackSeconds * 0.46,
          attackSeconds: presentation.attackSeconds,
          dtSeconds: 1 / 60,
          logicalMode: pose.logicalMode,
        });
        actor.updateWorldMatrix(true, true);

        assert.notEqual(
          tool.userData.workerToolDropped,
          true,
          `${modelCase.label} ${kind} ${pose.label} must remain body-owned`,
        );
        let visibleHandMounts = 0;
        for (const mount of mounts) {
          if (!mount.visible) continue;
          const bone = mount.parent;
          assert.ok(
            bone instanceof THREE.Bone,
            `${modelCase.label} ${kind} ${mount.name} must remain bone-mounted`,
          );
          const parentName = bone.name.toLowerCase();
          if (!parentName.includes('hand') && !parentName.includes('palm')) continue;
          visibleHandMounts += 1;

          const expectedWorld = new THREE.Matrix4().multiplyMatrices(
            bone.matrixWorld,
            mount.matrix,
          );
          const matrixError = maxMatrixDelta(expectedWorld, mount.matrixWorld);
          report.maxMatrixError = Math.max(report.maxMatrixError, matrixError);
          assert.ok(
            matrixError <= MATRIX_EPSILON,
            `${modelCase.label} ${kind} ${pose.label} ${mount.name} world matrix drifted by ${matrixError}`,
          );

          const mountWorld = mount.getWorldPosition(new THREE.Vector3());
          const boneWorld = bone.getWorldPosition(new THREE.Vector3());
          const mountInBone = bone.worldToLocal(mountWorld.clone());
          const localGripError = mountInBone.distanceTo(mount.position);
          const handMountOffsetMeters = mountWorld.distanceTo(boneWorld);
          report.maxLocalGripError = Math.max(report.maxLocalGripError, localGripError);
          report.maxHandMountOffsetMeters = Math.max(
            report.maxHandMountOffsetMeters,
            handMountOffsetMeters,
          );
          assert.ok(
            localGripError <= LOCAL_GRIP_EPSILON,
            `${modelCase.label} ${kind} ${pose.label} ${mount.name} grip-local error ${localGripError}`,
          );
          assert.ok(
            handMountOffsetMeters <= MAX_HAND_MOUNT_WORLD_OFFSET_METERS,
            `${modelCase.label} ${kind} ${pose.label} ${mount.name} is ${handMountOffsetMeters}m from its hand`,
          );
          assertFiniteRenderableWorldMatrices(mount, modelCase.label, kind, pose.label);
          report.samples += 1;
        }
        assert.ok(
          visibleHandMounts > 0,
          `${modelCase.label} ${kind} ${pose.label} must retain a visible hand-held mount`,
        );
      }
    }

    reports.push(report);
    restoreCombatWeaponPose(combatRig);
    disposeCombatWeaponRig(combatRig);
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }
}

for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);

const maxMatrixError = Math.max(...reports.map((report) => report.maxMatrixError));
const maxLocalGripError = Math.max(...reports.map((report) => report.maxLocalGripError));
const maxHandMountOffsetMeters = Math.max(
  ...reports.map((report) => report.maxHandMountOffsetMeters),
);
console.log(JSON.stringify({
  models: MODEL_CASES.map((entry) => entry.label),
  equipmentKinds: MILITARY_EQUIPMENT_KINDS.length,
  poseContracts: POSES.map((pose) => pose.label),
  sampledHandMountTransforms: reports.reduce((sum, report) => sum + report.samples, 0),
  failingKinds: [],
  maxMatrixError,
  maxLocalGripError,
  maxHandMountOffsetMeters,
  batchedBodyEquipmentCoLocation: coLocationReports,
  livingStatusesWithDrops: [],
}, null, 2));

/**
 * Reconstructs a live hand bone from the exact GPU body palette, then proves
 * the rigid equipment batch lands at the same authored descendant transform.
 * Two unrelated actor transforms catch the former raw-world palette bug,
 * which applied translation/yaw twice to the body but only once to equipment.
 */
function verifyBatchedBodyEquipmentCoLocation(
  modelCase: (typeof MODEL_CASES)[number],
  source: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  sourceHeight: number,
  equipmentSource: MilitaryEquipmentSource,
): {
  model: string;
  kind: MilitaryEquipmentKind;
  frames: number;
  maxBodyBoneMatrixError: number;
  maxEquipmentMatrixError: number;
  maxCoLocationMatrixError: number;
} {
  const world = new THREE.Group();
  world.position.set(-3.6, 0.7, 5.4);
  world.rotation.set(0.025, 0.31, -0.018);
  const crowdParent = new THREE.Group();
  crowdParent.position.set(2.1, -0.15, -1.7);
  crowdParent.rotation.y = -0.22;
  world.add(crowdParent);

  const actor = new THREE.Group();
  crowdParent.add(actor);
  const model = cloneSkinned(source.scene) as THREE.Group;
  model.scale.setScalar(modelCase.targetHeight / sourceHeight);
  actor.add(model);
  const posedMesh = firstSkinnedMesh(model);
  const tool = attachMilitaryEquipment(model, equipmentSource);
  setMilitaryEquipmentCombatStance(tool, 'melee');
  setMilitaryEquipmentDropped(tool, false);
  const mounts = tool.userData.workerToolMounts as THREE.Group[] | undefined;
  const heldMount = mounts?.find((mount) => (
    mount.visible
    && mount.parent instanceof THREE.Bone
    && /hand|palm/i.test(mount.parent.name)
  ));
  assert.ok(heldMount, `${modelCase.label} ${modelCase.heldKind} held hand mount`);
  const heldRenderable = firstMeshDescendant(heldMount);
  const heldBone = heldMount.parent as THREE.Bone;
  const heldBoneIndex = posedMesh.skeleton.bones.indexOf(heldBone);
  assert.ok(heldBoneIndex >= 0, `${modelCase.label} held bone must belong to body palette`);

  const bodyBatch = new AuthoredSkinnedInstanceBatch({
    parent: crowdParent,
    sourceRoot: source.scene,
    capacity: 1,
    name: `${modelCase.label} body/equipment co-location body`,
  });
  bodyBatch.setCount(1);
  const attachmentBatch = new ExactMountedAttachmentBatch(crowdParent, {
    initialCapacity: 1,
    name: `${modelCase.label} body/equipment co-location equipment`,
  });
  attachmentBatch.registerTool(tool);

  const run = source.animations.find((clip) => clip.name === 'run');
  assert.ok(run, `${modelCase.label} body/equipment co-location run clip`);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(run, model).play();
  const frameInputs = [
    { x: 8.4, y: 1.1, z: -6.8, yaw: -0.73, fraction: 0.21 },
    { x: -11.2, y: 0.35, z: 9.6, yaw: 1.17, fraction: 0.68 },
  ] as const;
  const paletteMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const reconstructedBoneWorld = new THREE.Matrix4();
  const boneToRenderable = new THREE.Matrix4();
  const reconstructedRenderableWorld = new THREE.Matrix4();
  let maxBodyBoneMatrixError = 0;
  let maxEquipmentMatrixError = 0;
  let maxCoLocationMatrixError = 0;

  for (const frame of frameInputs) {
    actor.position.set(frame.x, frame.y, frame.z);
    actor.rotation.set(0, frame.yaw, 0);
    action.time = run.duration * frame.fraction;
    mixer.update(0);
    world.updateWorldMatrix(true, true);

    bodyBatch.setFromCloneAt(0, model);
    bodyBatch.commit();
    attachmentBatch.update();
    world.updateWorldMatrix(true, true);

    const submittedBody = firstInstancedMesh(bodyBatch.group);
    submittedBody.getMatrixAt(0, instanceMatrix);
    const posePalette = (bodyBatch as unknown as {
      posePalette: { array: Float32Array };
    }).posePalette.array;
    paletteMatrix.fromArray(posePalette, heldBoneIndex * 16);
    reconstructedBoneWorld
      .multiplyMatrices(submittedBody.matrixWorld, instanceMatrix)
      .multiply(paletteMatrix)
      .multiply(posedMesh.skeleton.boneInverses[heldBoneIndex]!.clone().invert());
    const bodyBoneError = maxMatrixDelta(reconstructedBoneWorld, heldBone.matrixWorld);
    maxBodyBoneMatrixError = Math.max(maxBodyBoneMatrixError, bodyBoneError);
    assert.ok(
      bodyBoneError <= MATRIX_EPSILON,
      `${modelCase.label} frame ${frame.fraction} body palette reconstructed hand drifted by ${bodyBoneError}`,
    );

    const submittedEquipmentWorld = closestSubmittedRenderableWorld(
      attachmentBatch.group,
      heldRenderable,
    );
    const equipmentError = maxMatrixDelta(submittedEquipmentWorld, heldRenderable.matrixWorld);
    maxEquipmentMatrixError = Math.max(maxEquipmentMatrixError, equipmentError);
    assert.ok(
      equipmentError <= MATRIX_EPSILON,
      `${modelCase.label} frame ${frame.fraction} equipment batch drifted by ${equipmentError}`,
    );

    boneToRenderable
      .copy(heldBone.matrixWorld)
      .invert()
      .multiply(heldRenderable.matrixWorld);
    reconstructedRenderableWorld
      .multiplyMatrices(reconstructedBoneWorld, boneToRenderable);
    const coLocationError = maxMatrixDelta(
      reconstructedRenderableWorld,
      submittedEquipmentWorld,
    );
    maxCoLocationMatrixError = Math.max(maxCoLocationMatrixError, coLocationError);
    assert.ok(
      coLocationError <= MATRIX_EPSILON,
      `${modelCase.label} frame ${frame.fraction} batched body/weapon separated by ${coLocationError}`,
    );
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  attachmentBatch.dispose();
  bodyBatch.dispose();
  return {
    model: modelCase.label,
    kind: modelCase.heldKind,
    frames: frameInputs.length,
    maxBodyBoneMatrixError,
    maxEquipmentMatrixError,
    maxCoLocationMatrixError,
  };
}

function maxMatrixDelta(left: THREE.Matrix4, right: THREE.Matrix4): number {
  let maximum = 0;
  for (let index = 0; index < 16; index += 1) {
    maximum = Math.max(maximum, Math.abs(left.elements[index]! - right.elements[index]!));
  }
  return maximum;
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!found && mesh.isSkinnedMesh) found = mesh;
  });
  assert.ok(found, `${root.name || 'authored root'} must contain a SkinnedMesh`);
  return found;
}

function firstMeshDescendant(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!found && mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) found = mesh;
  });
  assert.ok(found, `${root.name || 'held mount'} must contain a rigid Mesh`);
  return found;
}

function firstInstancedMesh(root: THREE.Object3D): THREE.InstancedMesh {
  let found: THREE.InstancedMesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!found && mesh.isInstancedMesh) found = mesh;
  });
  assert.ok(found, `${root.name || 'batch'} must contain an InstancedMesh`);
  return found;
}

function closestSubmittedRenderableWorld(
  batchRoot: THREE.Object3D,
  source: THREE.Mesh,
): THREE.Matrix4 {
  let closest: THREE.Matrix4 | null = null;
  let closestError = Number.POSITIVE_INFINITY;
  const instance = new THREE.Matrix4();
  const candidateWorld = new THREE.Matrix4();
  batchRoot.updateWorldMatrix(true, true);
  batchRoot.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.geometry !== source.geometry) return;
    for (let slot = 0; slot < mesh.count; slot += 1) {
      mesh.getMatrixAt(slot, instance);
      candidateWorld.multiplyMatrices(mesh.matrixWorld, instance);
      const error = maxMatrixDelta(candidateWorld, source.matrixWorld);
      if (error >= closestError) continue;
      closestError = error;
      closest = candidateWorld.clone();
    }
  });
  assert.ok(closest, `${source.name || source.uuid} must have an exact submitted equipment instance`);
  return closest;
}

function assertFiniteRenderableWorldMatrices(
  root: THREE.Object3D,
  model: string,
  kind: MilitaryEquipmentKind,
  pose: string,
): void {
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    const line = object as THREE.Line;
    if (!mesh.isMesh && !line.isLine) return;
    assert.equal(
      object.matrixWorld.elements.every(Number.isFinite),
      true,
      `${model} ${kind} ${pose} ${object.name} world transform must stay finite`,
    );
  });
}

async function loadGlb(path: string): Promise<{
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}> {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(buffer as ArrayBuffer, '');
}
