import assert from 'node:assert/strict';
import { advanceDeliveryDisplayProgress } from '../src/logistics/deliveryPresentationMotion.ts';
import { advanceOxFollowPosition } from '../src/settlement/oxFollowMotion.ts';

const AUTHORITY_INTERVAL_SECONDS = 0.2;
const TEST_DURATION_SECONDS = 3;

for (const frameRate of [30, 60, 144]) {
  for (const speed of [1.2, 3, 12]) {
    const dt = 1 / frameRate;
    let displayProgress = 0;
    let serverProgress = 0;
    let nextAuthorityTime = AUTHORITY_INTERVAL_SECONDS;
    const frameDeltas: number[] = [];

    for (let frame = 1; frame <= TEST_DURATION_SECONDS * frameRate; frame += 1) {
      const time = frame * dt;
      while (time + 1e-9 >= nextAuthorityTime) {
        serverProgress = speed * nextAuthorityTime;
        nextAuthorityTime += AUTHORITY_INTERVAL_SECONDS;
      }
      const previous = displayProgress;
      displayProgress = advanceDeliveryDisplayProgress({
        displayProgress,
        serverProgress,
        pathDistance: 10_000,
        phase: 'outbound',
        effectiveTravelSpeed: speed,
        deltaSeconds: dt,
      });
      frameDeltas.push(displayProgress - previous);
    }

    const expectedDelta = speed * dt;
    const minimumDelta = Math.min(...frameDeltas);
    const maximumDelta = Math.max(...frameDeltas);
    assert.ok(
      minimumDelta >= expectedDelta * 0.98,
      `${frameRate} Hz / ${speed} m/s cart paused between authority samples (${minimumDelta})`,
    );
    assert.ok(
      maximumDelta <= expectedDelta * 1.02,
      `${frameRate} Hz / ${speed} m/s cart surged at an authority sample (${maximumDelta})`,
    );
  }
}

{
  const position = { x: 0, z: 0 };
  const dt = 1 / 60;
  const speed = 0.9;
  let targetZ = 0;
  const frameDeltas: number[] = [];
  for (let frame = 0; frame < 180; frame += 1) {
    targetZ += speed * dt;
    const previousZ = position.z;
    advanceOxFollowPosition(position, 0, targetZ, speed * dt);
    frameDeltas.push(position.z - previousZ);
  }
  assert.ok(
    frameDeltas.every((delta) => delta > 0),
    'an ox following sub-2.5 cm frame deltas must move every frame',
  );
  assert.ok(
    Math.abs(position.z - targetZ) < 1e-9,
    'an ox able to reach its target should lock exactly without residual drift',
  );
}

console.log('delivery and ox temporal motion stability checks passed');
