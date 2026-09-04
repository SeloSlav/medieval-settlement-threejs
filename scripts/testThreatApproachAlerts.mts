import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import type { CombatAgentState } from '../src/security/combatAgents.ts';
import type { BanditCampState } from '../src/security/banditState.ts';
import {
  ThreatApproachTracker,
  liveThreatCombatGroupPosition,
} from '../src/security/threatApproachAlerts.ts';
import { WORLD_FOLEY_CLIPS } from '../src/audio/audioCatalog.ts';

function agent(
  id: string,
  faction: CombatAgentState['faction'],
  status: CombatAgentState['status'],
  raidId: string,
  x: number,
  z: number,
  routeProgress = 70,
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
    routeProgress,
  };
}

function camp(id: string, x: number, z: number): BanditCampState {
  return {
    id,
    x,
    z,
    health: 100,
    maxHealth: 100,
    active: true,
    stolenGoods: 0,
    spawnedTick: 10,
    nextTheftTick: 20,
    lastTheftTick: 0,
    destroyedTick: 0,
  };
}

const townTargets = [{ id: 'building-1', x: 0, z: 0 }];

const tracker = new ThreatApproachTracker();
const restingBandits = [agent('b1', 'bandit', 'holding', 'camp-1', 80, 40)];
assert.deepEqual(
  tracker.update(restingBandits, 10, 'world-a'),
  [],
  'a live camp must begin populated but must not alert while bandits are resting',
);

const banditApproach = [agent('b1', 'bandit', 'advancing', 'camp-1', 70, 35)];
assert.deepEqual(
  tracker.update(banditApproach, 11, 'world-a'),
  [],
  'bandits outside town must not emit a distant approach warning',
);
const banditsInterceptedOutside = [agent('b1', 'bandit', 'fighting', 'camp-1', 70, 35)];
assert.deepEqual(
  tracker.update(banditsInterceptedOutside, 12, 'world-a', [], townTargets),
  [],
  'combat outside town must not be mislabeled as a breach',
);
const firstBanditBreach = [agent('b1', 'bandit', 'advancing', 'camp-1', 24, 18, 35)];
assert.equal(
  tracker.update(firstBanditBreach, 13, 'world-a', [], townTargets)[0]?.sound,
  'bandit-town-entry',
);
assert.deepEqual(tracker.update(restingBandits, 13, 'world-a'), []);
assert.deepEqual(tracker.update(banditApproach, 14, 'world-a'), []);
assert.equal(tracker.update(firstBanditBreach, 15, 'world-a', [], townTargets).length, 1,
  'the same camp may announce a new breach only after its previous patrol returned');

const wolfPack = [
  agent('w1', 'wolf', 'advancing', 'wolves-20', 10, 20),
  agent('w2', 'wolf', 'advancing', 'wolves-20', 14, 24),
  agent('w3', 'wolf', 'advancing', 'wolves-20', 12, 22),
];
const wildlifeAlerts = tracker.update(wolfPack, 20, 'world-a');
assert.deepEqual(wildlifeAlerts, [], 'wildlife outside town must not announce yet');
const wildlifeBreach = wolfPack.map((animal) => ({ ...animal, routeProgress: 30 }));
const wildlifeBreachAlerts = tracker.update(wildlifeBreach, 21, 'world-a', [], townTargets);
assert.equal(wildlifeBreachAlerts.length, 1, 'a coordinated pack receives one breach alert');
assert.equal(wildlifeBreachAlerts[0]?.kind, 'wildlife');
assert.equal(wildlifeBreachAlerts[0]?.x, 12);
assert.equal(wildlifeBreachAlerts[0]?.z, 22);
assert.equal(wildlifeBreachAlerts[0]?.combatGroupId, 'wildlife:wolves-20');
assert.deepEqual(
  liveThreatCombatGroupPosition(
    wildlifeBreach,
    wildlifeBreachAlerts[0]!.combatGroupId!,
    (id) => id === 'w1'
      ? { x: 31, z: 40 }
      : id === 'w2'
        ? { x: 35, z: 44 }
        : { x: 33, z: 42 },
  ),
  { x: 33, z: 42, count: 3 },
  'opening the wildlife report must follow the pack to its live rendered centroid',
);
assert.equal(
  liveThreatCombatGroupPosition(
    wildlifeBreach.map((animal) => ({ ...animal, status: 'downed' })),
    'wildlife:wolves-20',
  ),
  null,
  'a defeated wildlife group should fall back to the report location instead of a corpse centroid',
);

const ottomans = [
  agent('r1', 'raider', 'advancing', 'raid-7', -60, 4),
  agent('r2', 'raider', 'advancing', 'raid-7', -58, 6),
];
const ottomanAlerts = tracker.update(ottomans, 22, 'world-a');
assert.equal(ottomanAlerts.length, 1);
assert.equal(ottomanAlerts[0]?.kind, 'ottoman');
assert.equal(ottomanAlerts[0]?.phase, 'map-entry');
assert.equal(ottomanAlerts[0]?.sound, 'ottoman-map-entry');
assert.match(ottomanAlerts[0]?.title ?? '', /entered the map/);
assert.equal(
  tracker.update(ottomans, 22, 'world-b').length,
  1,
  'a new world must not inherit threat-alert suppression',
);

const lifecycleTracker = new ThreatApproachTracker();
const establishedCamp = camp('camp-new', 140, -90);
assert.deepEqual(
  lifecycleTracker.update([], 30, 'world-c', []),
  [],
  'initial sync must not announce camps that predate the client session',
);
const campAlerts = lifecycleTracker.update([], 31, 'world-c', [establishedCamp]);
assert.equal(campAlerts.length, 1);
assert.equal(campAlerts[0]?.phase, 'camp-established');
assert.equal(campAlerts[0]?.sound, 'bandit-camp-established');
assert.equal(campAlerts[0]?.x, 140);
assert.equal(campAlerts[0]?.combatGroupId, null);
assert.deepEqual(lifecycleTracker.update([], 32, 'world-c', [establishedCamp]), []);

const enteringBandits = [agent('b2', 'bandit', 'advancing', 'camp-2', 22, 18, 35)];
assert.deepEqual(liveThreatCombatGroupPosition([
  ...enteringBandits,
  agent('b1', 'bandit', 'holding', 'camp-2', 200, 200),
  agent('b3', 'bandit', 'holding', 'camp-2', 201, 200),
  agent('b4', 'bandit', 'holding', 'camp-2', 202, 200),
], 'bandit:camp-2'), { x: 22, z: 18, count: 1 },
'the town-entry report must focus the lone intruder rather than average it with three camp sentries');
const banditEntry = lifecycleTracker.update(
  enteringBandits,
  33,
  'world-c',
  [establishedCamp],
  townTargets,
);
assert.equal(banditEntry.length, 1, 'first sight inside town emits the breach, not stacked approach and breach cues');
assert.equal(banditEntry[0]?.phase, 'town-entry');
assert.equal(banditEntry[0]?.sound, 'bandit-town-entry');
assert.deepEqual(lifecycleTracker.update(enteringBandits, 34, 'world-c', [establishedCamp]), []);

const enteringWildlife = [agent('w4', 'wolf', 'fighting', 'wolves-21', 8, 9, 90)];
const wildlifeEntry = lifecycleTracker.update(
  enteringWildlife,
  35,
  'world-c',
  [establishedCamp],
  townTargets,
);
assert.equal(wildlifeEntry[0]?.sound, 'wildlife-town-entry');

const mapEnteringOttomans = [agent('r3', 'raider', 'advancing', 'raid-8', -200, 3, 180)];
const ottomanMapEntry = lifecycleTracker.update(mapEnteringOttomans, 36, 'world-c', [establishedCamp]);
assert.equal(ottomanMapEntry[0]?.sound, 'ottoman-map-entry');
const ottomansInsideTown = [agent('r3', 'raider', 'looting', 'raid-8', -5, 3, 5)];
assert.deepEqual(
  lifecycleTracker.update(ottomansInsideTown, 37, 'world-c', [establishedCamp]),
  [],
  'Ottoman groups warn on map entry and do not announce again at town breach',
);

for (const filename of [
  'event_ottoman_raiders_detected.mp3',
  'event_bandit_camp_established.mp3',
  'event_bandits_town_entry.mp3',
  'event_wildlife_town_entry.mp3',
]) {
  assert.ok(existsSync(`public/sounds/world/${filename}`), `${filename} must be generated`);
}
assert.match(WORLD_FOLEY_CLIPS.event_ottoman_raiders_detected.path, /ottoman_raiders_detected/);
assert.match(WORLD_FOLEY_CLIPS.event_bandit_camp_established.path, /bandit_camp_established/);
assert.match(WORLD_FOLEY_CLIPS.event_bandits_town_entry.path, /bandits_town_entry/);
assert.match(WORLD_FOLEY_CLIPS.event_wildlife_town_entry.path, /wildlife_town_entry/);

const app = readFileSync('src/app/App.ts', 'utf8');
assert.match(app, /notifyThreatApproaches\(snapshot\)/);
assert.match(app, /setGameSpeed\(1\)/);
assert.match(app, /kind: alert\.combatGroupId \? 'combat-group' : 'world'/);
assert.match(app, /id: alert\.combatGroupId \?\? alert\.id/);
assert.match(app, /playThreatAlert\(alert\.sound\)/);
assert.match(app, /snapshot\.banditCamps\.values\(\)/);

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
