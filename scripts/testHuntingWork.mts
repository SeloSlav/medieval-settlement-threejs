import assert from 'node:assert/strict';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  findHuntingTarget, huntingShotCooldown, HUNTING_SHOT_SECONDS,
  HUNTING_DRAW_SECONDS, type HuntingTarget,
} from '../src/settlement/huntingWork.ts';
import { resolveCombatWeaponPresentation, sampleCombatAttackTimeline } from '../src/settlement/combatWeaponAnimation.ts';

const deer: HuntingTarget[] = [
  { id: 'doe', nodeId: 'game', active: true, x: 12, y: 1, z: 16 },
  { id: 'stag', nodeId: 'game', active: true, x: 8, y: 1.1, z: 16 },
  { id: 'hidden', nodeId: 'game', active: false, x: 0, y: 1, z: 15 },
  { id: 'other-herd', nodeId: 'other', active: true, x: 0, y: 1, z: 16 },
  { id: 'outside', nodeId: 'game', active: true, x: -1, y: 1, z: -5 },
];
const query = { nodeId: 'game', x: 0, z: 10, areaX: 0, areaZ: 20, areaRadius: 20 };
assert.equal(findHuntingTarget(deer, query)?.id, 'stag');
assert.equal(findHuntingTarget(deer, { ...query, preferredId: 'doe' })?.id, 'doe');
assert.equal(findHuntingTarget(deer, { ...query, areaRadius: 2 }), null);
assert.equal(findHuntingTarget(deer, { ...query, x: 100 }), null);
assert.equal(findHuntingTarget([{ ...deer[0]!, x: 0, z: 11 }], query), null);

for (const dt of [1 / 120, 1 / 30, 0.08, 0.24]) {
  const presentation = { ...resolveCombatWeaponPresentation('bow', Infinity)!, attackSeconds: HUNTING_DRAW_SECONDS };
  let previous: number | null = null;
  let releases = 0;
  for (let elapsed = 0; elapsed < HUNTING_SHOT_SECONDS; elapsed += dt) {
    const cooldown = huntingShotCooldown(HUNTING_SHOT_SECONDS - elapsed);
    if (sampleCombatAttackTimeline(presentation, cooldown, previous).releaseEdge) releases++;
    previous = cooldown;
  }
  assert.equal(releases, 1, `one arrow per stop at dt=${dt}`);
}

// Exercise the actual worker state machine without loading browser graphics.
const renderer: any = Object.create(VillagerRenderer.prototype);
const camp = { id: 'camp', kind: 'hunters_hall', x: 0, z: 20, workRadius: 40, constructionComplete: true };
renderer.buildings = new Map([['camp', camp]]);
renderer.fireDisabledBuildingIds = new Set();
renderer.workerTargets = new Map([['camp', [{ id: 'game', kind: 'game' }]]]);
renderer.findHuntingTarget = (request: typeof query) => findHuntingTarget(deer, request);
renderer.getHeightAt = () => 0;
renderer.getRoadDeckY = null;
renderer.roadNetwork = null;
const createHunter = (variant: string) => ({
  role: 'worker', modelVariant: variant, workplaceId: 'camp', routinePhase: 'work',
  pathPurpose: 'worker_work_loop', workActivity: 'hunt', workTarget: { id: 'game', kind: 'game', x: 12, z: 16 },
  path: [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 40 }], pathDistance: 40,
  workStopDistance: 10, workRemaining: 0, workPerformed: false,
  walkSpeed: 1.4, mode: 'walk', x: 0, z: 0, y: 0, yaw: 0,
});
for (const variant of ['man', 'woman']) {
  const hunter: any = createHunter(variant);
  assert.equal(renderer.workerToolFor(hunter), 'bow');
  renderer.beginWorkerActivity(hunter);
  assert.equal(hunter.mode, 'wait');
  assert.equal(hunter.huntingTarget.id, 'stag');
  assert.equal(hunter.workRemaining, HUNTING_SHOT_SECONDS);
  assert.equal(hunter.currentMoveSpeed, 0);
  renderer.simStep(hunter, HUNTING_SHOT_SECONDS);
  assert.equal(hunter.mode, 'walk');
  assert.equal(hunter.huntingTarget, null);
  assert.equal(hunter.workStopDistance, 18);
  assert.equal(hunter.workPerformed, false);
  renderer.simStep(hunter, 0.1);
  assert.ok(hunter.simPathCursor > 10.01, 'walking resumes between shots');
  renderer.beginWorkerActivity(hunter);
  deer[1]!.active = false;
  renderer.simStep(hunter, 0.1);
  assert.equal(hunter.mode, 'walk', 'disappearing deer cancels the draw');
  deer[1]!.active = true;
  hunter.routinePhase = 'going_to_refuge';
  assert.equal(renderer.workerToolFor(hunter), null);
  assert.equal(renderer.huntingTargetFor(hunter), null);
  hunter.routinePhase = 'work';
  renderer.fireDisabledBuildingIds.add('camp');
  assert.equal(renderer.workerToolFor(hunter), null);
  renderer.fireDisabledBuildingIds.clear();
  camp.constructionComplete = false;
  assert.equal(renderer.workerToolFor(hunter), 'hammer');
  camp.constructionComplete = true;
  renderer.clearWorkerActivity(hunter);
  assert.equal(hunter.huntingTarget, null);
}
console.log('Hunting target limits, shot timing, male/female worker equipment, walking and cancellation passed.');
