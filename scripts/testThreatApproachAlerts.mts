import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import type { CombatAgentState } from '../src/security/combatAgents.ts';
import { ThreatApproachTracker } from '../src/security/threatApproachAlerts.ts';
import { WORLD_FOLEY_CLIPS } from '../src/audio/audioCatalog.ts';

function agent(
  id: string,
  faction: CombatAgentState['faction'],
  status: CombatAgentState['status'],
  raidId: string,
  x: number,
  z: number,
): CombatAgentState {
  return {
    id,
    raidId,
    faction,
    sourceBuildingId: null,
    sourceSlot: 0,
    targetKind: 'building',
    targetId: 'building-1',
    x,
    z,
    homeX: 0,
    homeZ: 0,
    health: 50,
    maxHealth: 50,
    readiness: 1,
    status,
    attackCooldown: 0,
    lootProgress: 0,
    carryingLoot: false,
    issuedPolearms: 0,
    raidAnchorBuildingId: null,
    banditCampId: faction === 'bandit' ? `bandit-camp-${raidId}` : null,
    companyId: null,
    homeResidenceId: null,
    personIdentity: null,
    stateChangedTick: 1,
    routeProgress: 20,
  };
}

const tracker = new ThreatApproachTracker();
const restingBandits = [agent('b1', 'bandit', 'holding', 'camp-1', 80, 40)];
assert.deepEqual(
  tracker.update(restingBandits, 10, 'world-a'),
  [],
  'a live camp must begin populated but must not alert while bandits are resting',
);

const banditApproach = [agent('b1', 'bandit', 'advancing', 'camp-1', 70, 35)];
const firstBanditAlert = tracker.update(banditApproach, 11, 'world-a');
assert.equal(firstBanditAlert.length, 1);
assert.equal(firstBanditAlert[0]?.kind, 'bandit');
assert.deepEqual(tracker.update(banditApproach, 12, 'world-a'), []);
assert.deepEqual(tracker.update(restingBandits, 13, 'world-a'), []);
assert.equal(
  tracker.update(banditApproach, 14, 'world-a').length,
  1,
  'the same camp may alert again only after the previous patrol returned',
);

const wolfPack = [
  agent('w1', 'wolf', 'advancing', 'wolves-20', 10, 20),
  agent('w2', 'wolf', 'advancing', 'wolves-20', 14, 24),
  agent('w3', 'wolf', 'advancing', 'wolves-20', 12, 22),
];
const wildlifeAlerts = tracker.update(wolfPack, 20, 'world-a');
assert.equal(wildlifeAlerts.length, 1, 'a coordinated pack receives one group alert');
assert.equal(wildlifeAlerts[0]?.kind, 'wildlife');
assert.equal(wildlifeAlerts[0]?.x, 12);
assert.equal(wildlifeAlerts[0]?.z, 22);

const ottomans = [
  agent('r1', 'raider', 'advancing', 'raid-7', -60, 4),
  agent('r2', 'raider', 'fighting', 'raid-7', -58, 6),
];
const ottomanAlerts = tracker.update(ottomans, 21, 'world-a');
assert.equal(ottomanAlerts.length, 1);
assert.equal(ottomanAlerts[0]?.kind, 'ottoman');
assert.match(ottomanAlerts[0]?.title ?? '', /Ottoman raiders detected/);
assert.equal(
  tracker.update(ottomans, 21, 'world-b').length,
  1,
  'a new world must not inherit threat-alert suppression',
);

for (const filename of [
  'event_wildlife_detected.mp3',
  'event_bandits_detected.mp3',
  'event_ottoman_raiders_detected.mp3',
]) {
  assert.ok(existsSync(`public/sounds/world/${filename}`), `${filename} must be generated`);
}
assert.match(WORLD_FOLEY_CLIPS.event_wildlife_detected.path, /wildlife_detected/);
assert.match(WORLD_FOLEY_CLIPS.event_bandits_detected.path, /bandits_detected/);
assert.match(WORLD_FOLEY_CLIPS.event_ottoman_raiders_detected.path, /ottoman_raiders_detected/);

const app = readFileSync('src/app/App.ts', 'utf8');
assert.match(app, /notifyThreatApproaches\(snapshot\)/);
assert.match(app, /setGameSpeed\(1\)/);
assert.match(app, /kind: 'world'/);
assert.match(app, /playThreatAlert\(alert\.kind\)/);

const banditSimulation = readFileSync('server/src/simulation/bandits.rs', 'utf8');
assert.match(banditSimulation, /state: HOLDING/);
assert.match(banditSimulation, /next_theft_tick:[\s\S]{0,140}day_ticks\(\)/);
assert.match(banditSimulation, /CAMP_RESPAWN_DAYS: u64 = 8/);
assert.match(banditSimulation, /CAMP_TOWN_CLEARANCE: f64 = 120\.0/);
assert.match(banditSimulation, /CAMP_RESOURCE_CLEARANCE: f64 = 55\.0/);
assert.match(banditSimulation, /CAMP_NEIGHBOR_CLEARANCE: f64 = 110\.0/);
assert.match(banditSimulation, /camp_respawn_ready/);
assert.match(banditSimulation, /forage_clearance/);
assert.match(banditSimulation, /fully_clear/);
assert.match(banditSimulation, /quarry_clearance/);
assert.match(banditSimulation, /camp_clearance/);

console.log('threat approach alerts passed (reports, 1x slowdown, camera targets, audio, and camp respawns)');
