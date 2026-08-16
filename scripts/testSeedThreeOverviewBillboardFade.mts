import assert from 'node:assert/strict';
import { partitionSeedThreeSelectionByStaticLod } from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import {
  OVERVIEW_BILLBOARD_FULL_OPACITY_ZOOM_PERCENT,
  OVERVIEW_BILLBOARD_REMOVE_ZOOM_PERCENT,
  OVERVIEW_BILLBOARD_REVEAL_ZOOM_PERCENT,
  updateSeedThreeOverviewBillboardFade,
  type SeedThreeOverviewBillboardFadeState,
} from '../src/vegetation/seedthree/seedThreeOverviewBillboardFade.ts';

const hidden: SeedThreeOverviewBillboardFadeState = { enabled: false, opacity: 0 };

const insideDisabledHysteresis = updateSeedThreeOverviewBillboardFade(
  hidden,
  98,
  1 / 60,
);
assert.equal(
  insideDisabledHysteresis.enabled,
  false,
  'overview quads must remain disabled between the reveal and remove thresholds',
);
assert.equal(insideDisabledHysteresis.visible, false);

const revealed = updateSeedThreeOverviewBillboardFade(
  hidden,
  OVERVIEW_BILLBOARD_REVEAL_ZOOM_PERCENT,
  1 / 60,
);
assert.equal(revealed.enabled, true, 'retreating to 96% must reveal overview quads');
assert.ok(revealed.opacity > 0, 'revealed overview quads must begin a damped fade-in');

const insideEnabledHysteresis = updateSeedThreeOverviewBillboardFade(
  { enabled: true, opacity: revealed.opacity },
  98,
  1 / 60,
);
assert.equal(
  insideEnabledHysteresis.enabled,
  true,
  'enabled overview quads must remain enabled inside the hysteresis band',
);

const midpoint = updateSeedThreeOverviewBillboardFade(
  { enabled: true, opacity: 0.5 },
  85,
  1 / 60,
);
assert.equal(midpoint.targetOpacity, 0.5, 'the smootherstep zoom fade must be centered at 85%');

const fullyRetreated = updateSeedThreeOverviewBillboardFade(
  { enabled: true, opacity: 1 },
  OVERVIEW_BILLBOARD_FULL_OPACITY_ZOOM_PERCENT,
  1 / 60,
);
assert.equal(fullyRetreated.targetOpacity, 1);
assert.equal(fullyRetreated.opacity, 1);

const removed = updateSeedThreeOverviewBillboardFade(
  { enabled: true, opacity: 0.8 },
  OVERVIEW_BILLBOARD_REMOVE_ZOOM_PERCENT,
  0.1,
);
assert.equal(removed.enabled, false, '100% zoom must disable overview quads');
assert.equal(removed.targetOpacity, 0);
assert.ok(
  removed.opacity > 0 && removed.visible,
  'the group must remain renderable while its residual opacity fades out',
);

let settled = removed;
for (let frame = 0; frame < 120 && settled.visible; frame += 1) {
  settled = updateSeedThreeOverviewBillboardFade(settled, 100, 1 / 60);
}
assert.equal(settled.opacity, 0, 'a completed fade-out must snap to exact zero opacity');
assert.equal(settled.visible, false, 'the overview group may hide only after its fade completes');

const oneStep = updateSeedThreeOverviewBillboardFade(hidden, 70, 0.1);
const halfStep = updateSeedThreeOverviewBillboardFade(hidden, 70, 0.05);
const twoSteps = updateSeedThreeOverviewBillboardFade(halfStep, 70, 0.05);
assert.ok(
  Math.abs(oneStep.opacity - twoSteps.opacity) < 1e-12,
  'half-life damping must remain frame-rate independent',
);

const firstPerson = updateSeedThreeOverviewBillboardFade(
  { enabled: true, opacity: 0.8 },
  70,
  1 / 60,
  true,
);
assert.equal(firstPerson.enabled, false, 'first-person mode must never render overview quads');
assert.equal(firstPerson.targetOpacity, 0);
assert.equal(firstPerson.opacity, 0, 'first-person mode must remove residual overview opacity immediately');
assert.equal(firstPerson.visible, false, 'first-person mode must hide the overlapping overview group immediately');

const overlappingLods = partitionSeedThreeSelectionByStaticLod(
  {
    nearIndices: [0, 1],
    overviewIndices: [2, 3],
    viewIndices: [1, 2],
  },
  (layoutIndex) => layoutIndex === 2 || layoutIndex === 3,
  true,
);
assert.deepEqual(overlappingLods, {
  nearIndices: [0, 1, 2, 3],
  overviewIndices: [2, 3],
  nearViewIndices: [1, 2],
  overviewViewIndices: [2],
  nearViewCount: 2,
  overviewViewCount: 1,
}, 'forced overview trees must keep their real near LOD resident under the fading quads');

console.log('SeedThree overview billboard fade: easing, hysteresis, settling, and resident overlap passed.');
