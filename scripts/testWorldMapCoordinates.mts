import assert from 'node:assert/strict';
import {
  areResourceIconsAlwaysShown,
  resolveResourceIconOpacity,
  setResourceIconsAlwaysShown,
} from '../src/map/resourceMapIconPreference.ts';
import { worldDirectionToMapRotation, worldToMapPercent } from '../src/map/worldToMapPercent.ts';

const EPSILON = 1e-12;
const bounds = { minX: -100, maxX: 100, minZ: -200, maxZ: 200 };

assert.deepEqual(
  worldToMapPercent(0, 0, bounds),
  { x: 50, y: 50 },
  'the world origin should be centered on the minimap',
);
assert.deepEqual(
  worldToMapPercent(100, 200, bounds),
  { x: 100, y: 100 },
  'world +X should map right and world +Z should map down',
);

const cardinalDirections = [
  { label: 'world -Z points up', x: 0, z: -1, expected: 0 },
  { label: 'world +X points right', x: 1, z: 0, expected: Math.PI / 2 },
  { label: 'world +Z points down', x: 0, z: 1, expected: Math.PI },
  { label: 'world -X points left', x: -1, z: 0, expected: -Math.PI / 2 },
] as const;

for (const direction of cardinalDirections) {
  const actual = worldDirectionToMapRotation(direction.x, direction.z);
  assert.ok(
    Math.abs(actual - direction.expected) < EPSILON,
    `${direction.label}: expected ${direction.expected}, received ${actual}`,
  );
}

assert.equal(
  resolveResourceIconOpacity(400, true),
  1,
  'always-show resource icons should stay fully visible at close zoom',
);
assert.equal(
  resolveResourceIconOpacity(400, false),
  0,
  'disabling always-show should restore the close-zoom icon fade',
);
assert.equal(
  resolveResourceIconOpacity(25, false),
  1,
  'resource icons should remain visible at overview zoom when always-show is disabled',
);
assert.equal(
  areResourceIconsAlwaysShown(),
  true,
  'resource icons should be set to always show by default',
);
setResourceIconsAlwaysShown(false);
assert.equal(
  areResourceIconsAlwaysShown(),
  false,
  'the resource icon preference should be possible to disable',
);
setResourceIconsAlwaysShown(true);

console.log('test:world-map passed');
