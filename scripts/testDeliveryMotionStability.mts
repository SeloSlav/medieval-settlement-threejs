import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeliveryAgentRenderer } from '../src/logistics/DeliveryAgentRenderer.ts';
import { advanceDeliveryDisplayProgress } from '../src/logistics/deliveryPresentationMotion.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
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

for (const authorityInterval of [0.75, 1.4]) {
  const frameRate = 60;
  const speed = 3;
  const dt = 1 / frameRate;
  let displayProgress = 0;
  let serverProgress = 0;
  let nextAuthorityTime = authorityInterval;
  const frameDeltas: number[] = [];

  for (let frame = 1; frame <= TEST_DURATION_SECONDS * frameRate; frame += 1) {
    const time = frame * dt;
    while (time + 1e-9 >= nextAuthorityTime) {
      serverProgress = speed * nextAuthorityTime;
      nextAuthorityTime += authorityInterval;
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

  assert.ok(
    frameDeltas.every((delta) => delta >= speed * dt * 0.98),
    `a ${authorityInterval}s live-row interval must not stop a moving cart`,
  );
}

{
  const frameRate = 60;
  const speed = 3;
  const dt = 1 / frameRate;
  let displayProgress = 0;
  for (let frame = 0; frame < frameRate * 2; frame += 1) {
    const previous = displayProgress;
    displayProgress = advanceDeliveryDisplayProgress({
      displayProgress,
      serverProgress: 0,
      pathDistance: 10_000,
      phase: 'outbound',
      effectiveTravelSpeed: speed,
      deltaSeconds: dt,
    });
    assert.ok(
      displayProgress - previous >= speed * dt * 0.98,
      'a temporarily stale live row must not make the cart walk in place',
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

const originalWarn = console.warn;
console.warn = (message?: unknown, ...optionalParams: unknown[]): void => {
  if (typeof message === 'string' && message.startsWith('[Delivery carts]')) return;
  originalWarn(message, ...optionalParams);
};

for (const oxId of [null, 'stable-ox-1'] as const) {
  const parent = new THREE.Group();
  const renderer = new DeliveryAgentRenderer({
    parent,
    terrain: { getHeightAt: () => 0 } as never,
    getGameSpeed: () => 1,
    isOnRoadSurface: () => false,
  });
  let trip: DeliveryTripState = {
    id: oxId ? 'renderer-ox-cart' : 'renderer-hand-cart',
    buildingId: 'origin',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'destination',
    cargoKind: 'timber',
    amount: 6,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 4,
    unloadSeconds: 8,
    unloadRemaining: 0,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    oxId,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[[0,0],[100,0]]',
  };
  renderer.syncTrips([trip]);

  const frameRate = 60;
  const dt = 1 / frameRate;
  const expectedDelta = 4 * 0.75 * dt;
  const authorityInterval = 1.4;
  let nextAuthorityTime = authorityInterval;
  let previousX = renderer.inspectDeliveryAgent(trip.id)?.position.x ?? 0;
  let previousOxX = renderer.getOxFollowPose(trip.id)?.x ?? 0;

  for (let frame = 1; frame <= frameRate * 3; frame += 1) {
    const time = frame * dt;
    while (time + 1e-9 >= nextAuthorityTime) {
      trip = { ...trip, progress: 4 * 0.75 * nextAuthorityTime };
      renderer.syncTrips([trip]);
      nextAuthorityTime += authorityInterval;
    }
    renderer.update(dt);
    const x = renderer.inspectDeliveryAgent(trip.id)?.position.x;
    assert.ok(x != null);
    assert.ok(
      x - previousX >= expectedDelta * 0.98,
      `${oxId ? 'ox cart' : 'hand cart'} renderer must advance on every frame`,
    );
    previousX = x;

    if (oxId) {
      const oxX = renderer.getOxFollowPose(trip.id)?.x;
      assert.ok(oxX != null);
      assert.ok(
        oxX - previousOxX >= expectedDelta * 0.98,
        'the attached ox and guide formation must inherit continuous cart motion',
      );
      previousOxX = oxX;
    }
  }
  renderer.dispose();
}
await new Promise<void>((resolve) => setTimeout(resolve, 0));
console.warn = originalWarn;

console.log('delivery and ox temporal motion stability checks passed');
