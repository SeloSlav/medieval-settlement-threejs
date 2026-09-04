import assert from 'node:assert/strict';
import { advanceCombatMotion, receiveCombatMotion, COMBAT_PREDICTION_SECONDS } from '../src/settlement/combatMotion.ts';
import { animalCombatAnimation, animalCombatLocomotionRate } from '../src/settlement/AnimalCombatRenderer.ts';

const sample = { x: 0, z: 0, velocityX: 3.35, velocityZ: 0, status: 'retreating' as const };
for (const fps of [30, 60, 120]) {
  for (const gameSpeed of [1, 4, 8]) {
    const dt = 1 / fps;
    const rate = 0.75 * gameSpeed;
    const speed = sample.velocityX * rate;
    let motion = receiveCombatMotion(sample);
    let display = 0;
    const speeds: number[] = [];
    for (let frame = 1; frame <= fps * 4; frame++) {
      const time = frame * dt;
      // Server updates at 5 Hz; duplicate non-motion snapshots arrive between.
      if (frame % (fps / 5) === 0) {
        motion = receiveCombatMotion({ ...sample, x: speed * time }, motion);
      } else {
        receiveCombatMotion({ ...sample, x: motion.x }, motion);
      }
      advanceCombatMotion(motion, dt, rate);
      const before = display;
      display += (motion.targetX - display) * (1 - Math.exp(-dt * 14));
      if (time > 1) speeds.push((display - before) / dt);
    }
    assert.ok(Math.min(...speeds) > speed * 0.98, `${fps} fps, ${gameSpeed}x must not slow between snapshots`);
    assert.ok(Math.max(...speeds) < speed * 1.02, `${fps} fps, ${gameSpeed}x must not surge on snapshots`);
  }
}
const motion = receiveCombatMotion(sample);
advanceCombatMotion(motion, 0.1, 0.75);
const frozen = { ...motion };
advanceCombatMotion(motion, 0, 0.75);
advanceCombatMotion(motion, 1, 0);
assert.deepEqual(motion, frozen, 'pausing freezes movement and prediction age');
receiveCombatMotion(sample, motion);
assert.equal(motion.age, 0.1, 'duplicate snapshots cannot rewind continuous motion');
advanceCombatMotion(motion, 20, 0.75);
assert.equal(motion.age, COMBAT_PREDICTION_SECONDS);
assert.equal(motion.targetX, 3.35 * COMBAT_PREDICTION_SECONDS * 0.75, 'network loss cannot cause unlimited drift');
for (const status of ['holding', 'looting', 'downed'] as const) {
  receiveCombatMotion({ ...sample, x: 2, status }, motion);
  advanceCombatMotion(motion, 0.2, 6);
  assert.equal(motion.targetX, 2, `${status} must stop prediction, even with stale velocity`);
}
receiveCombatMotion({ ...sample, x: 2, velocityX: -3.35 }, motion);
advanceCombatMotion(motion, 0.1, 0.75);
assert.ok(motion.targetX < 2, 'new directions replace the old prediction');
receiveCombatMotion({ ...sample, status: 'fighting' }, motion);
advanceCombatMotion(motion, 0.1, 0.75);
assert.ok(motion.targetX > 0, 'dogs keep moving smoothly while biting fleeing prey');
receiveCombatMotion({ ...sample, status: 'fighting', velocityX: 0 }, motion);
advanceCombatMotion(motion, 0.1, 0.75);
assert.equal(motion.targetX, 0, 'stationary fighters do not drift');
let action = animalCombatAnimation({ status: 'advancing', moveSpeed: 3 });
assert.equal(action, 'Gallop');
for (const speed of [2.2, 2.0, 2.15, 1.95, 2.2]) {
  action = animalCombatAnimation({ status: 'advancing', moveSpeed: speed }, action);
  assert.equal(action, 'Gallop', 'small speed fluctuations must not restart the gait');
}
assert.equal(animalCombatAnimation({ status: 'advancing', moveSpeed: 1.5 }, action), 'Walk');
assert.equal(animalCombatAnimation({ status: 'fighting', moveSpeed: 4 }), 'Attack');
assert.equal(animalCombatAnimation({ status: 'downed', moveSpeed: 4 }), 'Death');
assert.equal(animalCombatLocomotionRate('Walk', 1.25), 1);
assert.equal(animalCombatLocomotionRate('Gallop', 6.5), 2);
console.log('Combat movement passed: steady 5 Hz replication at 30/60/120 fps and 1x/4x/8x, pause, stale packets, turns, and animal gait continuity.');
