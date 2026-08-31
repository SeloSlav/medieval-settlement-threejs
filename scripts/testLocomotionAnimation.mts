import assert from 'node:assert/strict';
import { locomotionAnimationTimeScale } from '../src/settlement/locomotionAnimation.ts';

assert.equal(locomotionAnimationTimeScale('run', 0), 0.38);
assert.equal(locomotionAnimationTimeScale('flee', 0), 0.44);
assert.ok(locomotionAnimationTimeScale('run', 1.2) < 0.6);
assert.ok(locomotionAnimationTimeScale('run', 2.35) < 1.1);
assert.ok(locomotionAnimationTimeScale('run', 2.35) > 1.05);
assert.ok(
  locomotionAnimationTimeScale('run', 1.2)
    < locomotionAnimationTimeScale('walk', 1.2) * 0.6,
);
assert.equal(locomotionAnimationTimeScale('run', Number.NaN), 0.38);
assert.equal(locomotionAnimationTimeScale('run', 100), 1.25);

console.log('Locomotion animation calibration passed: run and flee cycles follow observed travel speed instead of reusing the walk cadence.');
