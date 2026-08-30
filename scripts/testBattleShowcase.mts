import assert from 'node:assert/strict';
import {
  BATTLE_SHOWCASE_CHARGE_END_SECONDS,
  BATTLE_SHOWCASE_DURATION_SECONDS,
  BATTLE_SHOWCASE_FORMATION_COLUMNS,
  BATTLE_SHOWCASE_FORMATION_ROWS,
  BATTLE_SHOWCASE_FRIENDLY_COUNT,
  BATTLE_SHOWCASE_HOSTILE_COUNT,
  battleShowcaseCamera,
  battleShowcasePhaseAt,
  countBattleShowcaseAgents,
  createBattleShowcase,
  mergeBattleShowcaseAgents,
  parseBattleShowcaseRequest,
} from '../src/app/battleShowcase.ts';

assert.deepEqual(parseBattleShowcaseRequest('?battleShowcase=1&battleShot=clash&battleLoop=0'), {
  enabled: true,
  loop: false,
  shot: 'clash',
});
assert.equal(parseBattleShowcaseRequest('?showcase=1'), null);

const showcase = createBattleShowcase({
  seed: 0x431a_2e0d,
  playableHalf: 248,
  getTerrainHeight: (x, z) => -0.5 + x * 0.0005 + z * 0.0003,
  isWaterAt: () => false,
  terrainPreset: 'delnice_meadow',
  rendererBackend: 'webgpu',
  connectedServer: true,
});

assert.equal(showcase.site.x, 0);
assert.equal(showcase.site.z, 0);
assert.equal(showcase.diagnostics.productionTerrain, true);
assert.equal(showcase.diagnostics.connectedServer, true);
assert.equal(showcase.diagnostics.serverStateMutated, false);
assert.equal(showcase.diagnostics.combatants.total, 48);
assert.equal(BATTLE_SHOWCASE_FORMATION_COLUMNS * BATTLE_SHOWCASE_FORMATION_ROWS, 24);
assert.equal(battleShowcasePhaseAt(0), 'charge');
assert.equal(battleShowcasePhaseAt(4), 'charge');
assert.equal(battleShowcasePhaseAt(BATTLE_SHOWCASE_CHARGE_END_SECONDS), 'clash');
assert.equal(battleShowcasePhaseAt(10), 'clash');
assert.equal(battleShowcasePhaseAt(23), 'rout');
assert.equal(battleShowcasePhaseAt(29), 'aftermath');

for (const time of [0, 4, 10, 16, 23, 29, BATTLE_SHOWCASE_DURATION_SECONDS]) {
  const agents = showcase.sample(time);
  assert.equal(agents.size, 48, `expected 48 combatants at ${time}s`);
  assert.equal(countBattleShowcaseAgents(agents), 48);
  assert.equal(
    [...agents.values()].filter((agent) => agent.faction === 'raider').length,
    BATTLE_SHOWCASE_HOSTILE_COUNT,
  );
}

const opening = showcase.sample(0);
const openingCroatian = opening.get('battle-showcase:croatian:01')!;
const openingOttoman = opening.get('battle-showcase:ottoman:01')!;
assert.equal(
  [...opening.values()].filter((agent) => agent.status === 'advancing').length,
  48,
);
assert.ok(
  [...opening.values()].every((agent) => (agent.routeProgress ?? 0) > 14),
  'every opening combatant should select a run animation',
);
assert.equal(openingCroatian.status, 'advancing');
assert.equal(openingOttoman.status, 'advancing');
assert.equal(openingCroatian.targetKind, 'combat-agent');
assert.equal(openingOttoman.targetKind, 'combat-agent');
assert.ok((openingCroatian.routeProgress ?? 0) > 14, 'Croatian line should run immediately');
assert.ok((openingOttoman.routeProgress ?? 0) > 14, 'Ottoman line should run immediately');

const openingAdvance = showcase.sample(0.5);
const advancingCroatian = openingAdvance.get(openingCroatian.id)!;
const advancingOttoman = openingAdvance.get(openingOttoman.id)!;
const axisCoordinate = (agent: { x: number; z: number }): number =>
  (agent.x - showcase.site.x) * showcase.site.axisX
  + (agent.z - showcase.site.z) * showcase.site.axisZ;
assert.ok(
  axisCoordinate(advancingCroatian) > axisCoordinate(openingCroatian) + 0.5,
  'Croatian formation should visibly charge toward contact in the opening half-second',
);
assert.ok(
  axisCoordinate(advancingOttoman) < axisCoordinate(openingOttoman) - 0.5,
  'Ottoman formation should visibly charge toward contact in the opening half-second',
);
assert.ok(
  advancingOttoman.x - advancingCroatian.x < openingOttoman.x - openingCroatian.x,
  'paired opponents should converge during the charge',
);

const deterministicClash = [...showcase.sample(16).entries()];
assert.deepEqual([...showcase.sample(16).entries()], deterministicClash);

const aftermath = showcase.sample(BATTLE_SHOWCASE_DURATION_SECONDS);
assert.equal([...aftermath.values()].filter((agent) => agent.status === 'downed').length, 10);
const fallenAtImpact = showcase.sample(18.4).get('battle-showcase:croatian:02')!;
const fallenAfterRout = showcase.sample(27).get('battle-showcase:croatian:02')!;
assert.equal(fallenAfterRout.status, 'downed');
assert.equal(fallenAtImpact.x, fallenAfterRout.x);
assert.equal(fallenAtImpact.z, fallenAfterRout.z);

const routStart = showcase.sample(22).get('battle-showcase:ottoman:01')!;
const routEnd = showcase.sample(27).get('battle-showcase:ottoman:01')!;
assert.equal(routEnd.status, 'retreating');
assert.ok(
  axisCoordinate(routEnd) > axisCoordinate(routStart) + 15,
  'surviving Ottoman agents should deterministically rout away from contact',
);

const openingCamera = battleShowcaseCamera(showcase.site, 'clash', 0);
const contactCamera = battleShowcaseCamera(
  showcase.site,
  'clash',
  BATTLE_SHOWCASE_CHARGE_END_SECONDS,
);
const wideCamera = battleShowcaseCamera(showcase.site, 'wide', 0);
const routCamera = battleShowcaseCamera(showcase.site, 'clash', 27);
assert.ok(openingCamera.distance < 29, 'opening camera should be closer than take two');
assert.ok(contactCamera.distance < 13.5, 'contact camera should be closer than take two');
assert.ok(wideCamera.distance < 32, 'wide camera should also move closer');

// CameraController narrows from 54 to 48 degrees on its close-ground curve;
// validate against the narrower endpoint so the fit remains conservative.
const verticalFov = 48 * Math.PI / 180;
const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * (16 / 9));
const openingSubjectRadius = Math.max(
  ...[...opening.values()].map((agent) => Math.hypot(
    agent.x - openingCamera.targetX,
    agent.z - openingCamera.targetZ,
  )),
);
assert.ok(
  openingCamera.distance * Math.tan(horizontalFov * 0.5) > openingSubjectRadius * 1.2,
  'closer opening camera should retain a twenty-percent horizontal formation margin',
);
const routSubjectRadius = Math.max(
  ...[...showcase.sample(27).values()].map((agent) => Math.hypot(
    agent.x - routCamera.targetX,
    agent.z - routCamera.targetZ,
  )),
);
assert.ok(
  routCamera.distance * Math.tan(horizontalFov * 0.5) > routSubjectRadius * 1.04,
  'rout tracking should keep casualties and the retreating formation inside frame',
);

const rotatedSite = { ...showcase.site, axisX: 0, axisZ: 1 };
const rotatedCroatianCamera = battleShowcaseCamera(rotatedSite, 'croatian', 0);
assert.ok(
  rotatedCroatianCamera.targetZ < rotatedSite.z - 10,
  'side-follow cameras should stage in the site formation frame',
);

const merged = mergeBattleShowcaseAgents(new Map([
  ['authoritative:1', { ...aftermath.values().next().value!, id: 'authoritative:1' }],
]), aftermath);
assert.equal(merged.size, BATTLE_SHOWCASE_FRIENDLY_COUNT + BATTLE_SHOWCASE_HOSTILE_COUNT + 1);

console.log('Live production battle density, charge, rout, framing, and safety contract passed.');
