import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advanceAuthoredAnimationClock, type AuthoredAnimationPose } from '../src/scene/AuthoredAnimationClock.ts';

const clips = [0, 1].map(i => new THREE.AnimationClip(`clip-${i}`, 1, [
  new THREE.VectorKeyframeTrack('Bone.position', [0, .3, 1], [0, i, 0, 1, i + 2, .3, 0, i, 0]),
  new THREE.QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [0, 0, 0, 1, 0, Math.sin(.3 + i), 0, Math.cos(.3 + i)]),
]));
function make() {
  const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'Bone'; root.add(bone);
  const mixer = new THREE.AnimationMixer(root);
  const actions = clips.map(clip => mixer.clipAction(clip));
  actions[0]!.play();
  return { root, bone, mixer, actions };
}
const fast = make(), original = make();
let gpuFrames = 0, cpuFrames = 0;
for (let frame = 0; frame < 720; frame++) {
  for (const rig of [fast, original]) {
    if (frame === 110) { rig.actions[0]!.fadeOut(.18); rig.actions[1]!.reset().fadeIn(.18).play(); }
    if (frame === 250) { rig.actions[1]!.fadeOut(.18); rig.actions[0]!.reset().fadeIn(.18).play(); }
    if (frame === 330) rig.mixer.timeScale = 1.8;
    if (frame === 400) rig.actions[0]!.paused = true;
    if (frame === 430) rig.actions[0]!.paused = false;
    if (frame === 470) { rig.mixer.stopAllAction(); rig.actions[1]!.reset().setLoop(THREE.LoopOnce, 1); rig.actions[1]!.clampWhenFinished = true; rig.actions[1]!.play(); }
    if (frame === 560) { rig.mixer.stopAllAction(); rig.actions[0]!.reset().setLoop(THREE.LoopPingPong, 4).play(); }
  }
  const action = advanceAuthoredAnimationClock(fast.mixer, 1/60, clip => clips.includes(clip));
  original.mixer.update(1/60);
  assert.equal(fast.mixer.time, original.mixer.time);
  for (let i = 0; i < 2; i++) {
    assert.equal(fast.actions[i]!.time, original.actions[i]!.time, `action clock at ${frame}`);
    assert.equal(fast.actions[i]!.getEffectiveWeight(), original.actions[i]!.getEffectiveWeight());
  }
  if (action) {
    gpuFrames++;
  } else {
    cpuFrames++;
    // Returning to CPU must recover the current pose after many consecutive
    // GPU frames that did not touch the CPU skeleton or property buffers.
    assert.deepEqual(fast.bone.position.toArray(), original.bone.position.toArray(), `position ${frame}`);
    assert.deepEqual(fast.bone.quaternion.toArray(), original.bone.quaternion.toArray(), `rotation ${frame}`);
  }
}
assert.ok(gpuFrames > 400 && cpuFrames > 100);
const observed = make();
let loops = 0; observed.mixer.addEventListener('loop', () => loops++);
for (let i = 0; i < 120; i++) assert.equal(advanceAuthoredAnimationClock(observed.mixer, 1/60, () => true), null);
assert.ok(loops > 0, 'event-observed mixers retain normal dispatch');
const blended = make(), referenceBlend = make();
const pose: AuthoredAnimationPose = { primary: null, secondary: null, blend: 0 };
let blendedGpuFrames = 0;
for(let frame=0;frame<120;frame++) {
  for(const rig of [blended,referenceBlend]) {
    if(frame===10) {rig.actions[0]!.fadeOut(.18);rig.actions[1]!.reset().fadeIn(.18).play();}
    if(frame===60) {rig.actions[1]!.fadeOut(.23);rig.actions[0]!.reset().fadeIn(.23).play();}
    if(frame===95) rig.actions[0]!.setEffectiveWeight(.4);
  }
  const active=advanceAuthoredAnimationClock(blended.mixer,1/120,()=>true,pose);
  referenceBlend.mixer.update(1/120);
  for(let i=0;i<2;i++) {
    assert.equal(blended.actions[i]!.time,referenceBlend.actions[i]!.time);
    assert.equal(blended.actions[i]!.getEffectiveWeight(),referenceBlend.actions[i]!.getEffectiveWeight());
  }
  if(active&&pose.secondary&&pose.blend>0&&pose.blend<1) blendedGpuFrames++;
  if(!active) {
    assert.ok(blended.bone.position.distanceTo(referenceBlend.bone.position)<1e-7,'CPU fallback recovers a partial-weight pose');
    assert.ok(blended.bone.quaternion.angleTo(referenceBlend.bone.quaternion)<1e-7,'CPU fallback recovers partial-weight rotation');
  }
}
assert.ok(blendedGpuFrames>=35,`${blendedGpuFrames} matching-channel crossfade frames reached the GPU`);
console.log(`Authored animation clock parity: ${gpuFrames} GPU-eligible and ${cpuFrames} CPU frames; fades, rates, pause, clamped endings, ping-pong and events.`);
console.log(`Crossfade clock parity: ${blendedGpuFrames} GPU blend frames and exact partial-weight fallback.`);
