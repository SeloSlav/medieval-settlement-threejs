import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advanceCombatMotion, receiveCombatMotion, COMBAT_PREDICTION_SECONDS,
  combatAnimationMovementSpeed, combatLocomotion } from '../src/settlement/combatMotion.ts';
import { AnimalCombatRenderer, animalCombatAnimation, animalCombatLocomotionRate } from '../src/settlement/AnimalCombatRenderer.ts';
import { agentPacedDelta } from '../src/world/agentPacing.ts';
import type { CombatAgentStatus } from '../src/security/combatAgents.ts';

type Sample = { t: number; x: number; z: number; velocityX: number; velocityZ: number; status: CombatAgentStatus };
function replay(samples: Sample[], fps: number, rate: number, legacy = false) {
  let motion = receiveCombatMotion(samples[0]!, undefined, samples[0]!.t);
  let x = samples[0]!.x, z = samples[0]!.z, time = samples[0]!.t, next = 1;
  let legacyAge = 0, source = samples[0]!;
  const speeds: number[] = [], accelerations: number[] = [], positions: number[] = [];
  let lastSpeed = 0;
  function advance(dt: number) {
    if (dt <= 0) return;
    if (legacy) {
      legacyAge = Math.min(0.3, legacyAge + dt);
      const blend = 1 - Math.exp(-dt * 14);
      x += (source.x + source.velocityX * legacyAge * rate - x) * blend;
      z += (source.z + source.velocityZ * legacyAge * rate - z) * blend;
    } else {
      advanceCombatMotion(motion, dt, rate);
      x = motion.targetX;
      z = motion.targetZ;
    }
  }
  for (let frame = 1; frame / fps < samples.at(-1)!.t; frame++) {
    const end = frame / fps;
    const beforeX = x, beforeZ = z;
    while (next < samples.length && samples[next]!.t <= end) {
      const sample = samples[next++]!;
      advance(sample.t - time);
      time = sample.t;
      source = sample;
      legacyAge = 0;
      const rendered = [motion.targetX, motion.targetZ, motion.renderVelocityX, motion.renderVelocityZ];
      motion = receiveCombatMotion(sample, motion, sample.t);
      assert.deepEqual([motion.targetX, motion.targetZ, motion.renderVelocityX, motion.renderVelocityZ],
        rendered, 'packets must preserve both position and velocity');
    }
    advance(end - time);
    time = end;
    const speed = Math.hypot(x - beforeX, z - beforeZ) * fps;
    if (end > 2) {
      speeds.push(speed);
      accelerations.push(Math.abs(speed - lastSpeed) * fps);
      positions.push(x);
    }
    lastSpeed = speed;
  }
  return { min: Math.min(...speeds), max: Math.max(...speeds),
    peakAcceleration: Math.max(...accelerations), x, motion, positions };
}

for (const fps of [30, 60, 120]) {
  for (const gameSpeed of [1, 4, 8] as const) {
    for (const interval of [0.2, 0.25]) {
      const rate = 0.75 * gameSpeed;
      const samples: Sample[] = Array.from({ length: 41 }, (_, i) => ({
        t: i * interval, x: i * 3.35 * rate * 0.2, z: 0, velocityX: 3.35, velocityZ: 0, status: 'advancing',
      }));
      const result = replay(samples, fps, rate);
      const expected = 3.35 * rate * 0.2 / interval;
      assert.ok(result.min > expected * 0.97, JSON.stringify({fps,gameSpeed,interval,result}));
      assert.ok(result.max < expected * 1.03, JSON.stringify({fps,gameSpeed,interval,result}));
      // Missing one network update does not stop an otherwise steady path.
      const missed = replay(samples.filter((_, i) => i !== 20), fps, rate);
      assert.ok(missed.min > expected * 0.95);
      assert.ok(missed.max < expected * 1.05);
    }
    const pacedRate = agentPacedDelta(1, gameSpeed);
    const baseWalk = 1.2;
    assert.equal(combatAnimationMovementSpeed(baseWalk * pacedRate, pacedRate), baseWalk,
      'combat and villagers must feed identical speeds to the same paced mixer');
  }
}

// Real local-server arrival intervals, captured with the game's unconfirmed-read transport.
// Unlike the previous ideal 5 Hz fixture, these contain scheduler load and delivery jitter.
const intervals = [0.218,0.223,0.257,0.256,0.257,0.214,0.249,0.248,0.248,0.223,
  0.245,0.252,0.241,0.224,0.256,0.244,0.250,0.217,0.249];
const jittered: Sample[] = [{t:0,x:0,z:0,velocityX:2.15,velocityZ:0,status:'holding'}];
for (let i = 1; i <= 80; i++) jittered.push({
  t: jittered.at(-1)!.t + intervals[(i-1) % intervals.length]!,
  x: i * 2.15 * 0.75 * 0.2, z: 0, velocityX:2.15,velocityZ:0,status:'holding',
});
const old = replay(jittered, 60, 0.75, true);
const current = replay(jittered, 60, 0.75);
console.log('Captured cadence replay:', JSON.stringify({ old, current }, (key,value) =>
  key === 'positions' || key === 'motion' ? undefined : value));
assert.ok(current.peakAcceleration < old.peakAcceleration * 0.5, 'jitter corrections must be gentler than the old predictor');
assert.ok(current.min > 1, 'a walking camp patrol must never pause between updates');
assert.ok(current.max - current.min < 0.35, 'stride speed stays steady across packet jitter');

const sample = {x:0,z:0,velocityX:3.35,velocityZ:0,status:'retreating' as const};
const motion = receiveCombatMotion(sample, undefined, 0);
advanceCombatMotion(motion, 0.1, 0.75);
const frozen = {...motion};
advanceCombatMotion(motion, 0, 0.75);
advanceCombatMotion(motion, 1, 0);
assert.deepEqual(motion, frozen, 'pause freezes position, velocity and the prediction clock');
receiveCombatMotion(sample, motion, 0.1);
assert.equal(motion.age, 0.1, 'duplicate snapshots cannot rewind movement');
advanceCombatMotion(motion, 20, 0.75);
assert.equal(motion.age, COMBAT_PREDICTION_SECONDS);
assert.ok(Math.abs(motion.targetX - 3.35 * COMBAT_PREDICTION_SECONDS * 0.75) < 1e-8, 'network loss has a bounded endpoint');
for (const status of ['holding','looting','fighting'] as const) {
  const stopped = receiveCombatMotion({...sample,status,velocityX:0},undefined,0);
  advanceCombatMotion(stopped, 1, 0.75);
  assert.equal(stopped.targetX, 0, 'the server final velocity owns a stationary pose');
}
receiveCombatMotion({...sample,status:'downed',x:2},motion,21);
advanceCombatMotion(motion,2,0.75);
assert.ok(Math.abs(motion.targetX-2)<1e-4, 'downed actors settle within a tenth of a millimetre');
receiveCombatMotion({...sample,x:2,velocityX:-3.35},motion,23);
advanceCombatMotion(motion,0.2,0.75);
assert.ok(motion.targetX<2,'turns respond without a snapshot-buffer delay');
let gait = combatLocomotion(2.15);
assert.equal(gait,'run');
for(const speed of [2,1.9,1.8,2.1]) {
  gait = combatLocomotion(speed,gait);
  assert.equal(gait,'run','small corrections cannot restart humanoid gait');
}
let action = animalCombatAnimation({status:'advancing',moveSpeed:3});
for(const speed of [2.2,2,2.15,1.95]) {
  action=animalCombatAnimation({status:'advancing',moveSpeed:speed},action);
  assert.equal(action,'Gallop');
}
assert.equal(animalCombatLocomotionRate('Walk',1.25),1);
assert.equal(animalCombatLocomotionRate('Gallop',6.5),2);
for (const gameSpeed of [1,4,8]) {
  const rate = gameSpeed * 0.75;
  assert.equal(animalCombatAnimation({status:'advancing',moveSpeed:1.5*rate},'',rate),'Walk',
    'game acceleration does not change a walking dog into a gallop');
  assert.equal(animalCombatAnimation({status:'advancing',moveSpeed:3*rate},'',rate),'Gallop');
}
// Exercise the real mixer handoff: switching stride length must keep the foot phase.
const mixer = new THREE.AnimationMixer(new THREE.Object3D());
const walk = mixer.clipAction(new THREE.AnimationClip('Walk',2,[]));
const gallop = mixer.clipAction(new THREE.AnimationClip('Gallop',1,[]));
walk.play();
mixer.update(1.3);
const instance = {mixer,actions:new Map([['Walk',walk],['Gallop',gallop]]),actionName:'Walk'};
(AnimalCombatRenderer.prototype as any).play(instance,'Gallop',false);
assert.ok(Math.abs(gallop.time-0.65)<1e-8,'walk-to-run handoff preserves normalized foot phase');
const change = receiveCombatMotion(sample,undefined,0);
advanceCombatMotion(change,0.1,0.75);
advanceCombatMotion(change,0.1,6);
assert.ok(change.renderVelocityX>sample.velocityX*0.75,'speed orders respond before waiting for a buffered packet');
const batch=Array.from({length:1024},()=>receiveCombatMotion(sample,undefined,0));
const started=performance.now();
for(let frame=0;frame<600;frame++) for(const m of batch) advanceCombatMotion(m,1/60,0.75);
const frameMs=(performance.now()-started)/600;
assert.ok(frameMs<2,`1024 combat motion updates took ${frameMs.toFixed(3)}ms per frame`);
console.log(`1024 combat motion updates: ${frameMs.toFixed(3)} ms/frame.`);
console.log('Combat motion passed: real cadence/jitter, missing packets, continuous velocity, pause, stops, turns and shared villager animation units.');
