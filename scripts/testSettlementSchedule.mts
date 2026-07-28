import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_DAY_START_OFFSET_SECONDS,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_START_HOUR,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { gameClock, gameClockAtElapsedSeconds, isLaborPaused, laborPauseLabel } from '../src/world/gameCalendar.ts';
import {
  deriveSettlementSchedule,
  expectLaborPausedLikeServer,
  settlementScheduleDirtyKey,
} from '../src/world/settlementSchedule.ts';
import { deriveInterpolatedSettlementSchedule } from '../src/world/settlementSchedule.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import {
  interpolatedSimElapsedSeconds,
  SettlementPresentationController,
} from '../src/app/settlementSchedulePresentation.ts';
import { parseVisualQaConditions } from '../src/app/visualQaConditions.ts';
import type { GameState } from '../src/resources/types.ts';
import type { CombatAgentState } from '../src/security/combatAgents.ts';

const secondsPerGameHour = CALENDAR_SECONDS_PER_DAY / 24;
const secondsPerGameMinute = secondsPerGameHour / 60;
const nightTick = Math.ceil((17 * secondsPerGameHour) / SIM_TICK_SECONDS);
const workHourTick = 0;
const middayTick = (
  12 * secondsPerGameHour - CALENDAR_DAY_START_OFFSET_SECONDS
) / SIM_TICK_SECONDS;
const mondayWorkMorningElapsed =
  CALENDAR_SECONDS_PER_DAY
  + CALENDAR_WORK_START_HOUR * secondsPerGameHour
  + secondsPerGameMinute
  - CALENDAR_DAY_START_OFFSET_SECONDS;
const workMorningTick = mondayWorkMorningElapsed / SIM_TICK_SECONDS;

const nightClock = gameClock(nightTick);
assert.equal(isLaborPaused(nightClock, false, false), true);
assert.equal(laborPauseLabel(nightClock, false, false), 'Night hours');
assert.equal(expectLaborPausedLikeServer(nightClock, false, false), true);

const workClock = gameClock(workHourTick);
assert.equal(isLaborPaused(workClock, false, false), false);
assert.equal(laborPauseLabel(workClock, false, false), null);
assert.equal(expectLaborPausedLikeServer(workClock, false, false), false);

const sundayWorkTick = workHourTick;
const sundayClock = gameClock(sundayWorkTick);
assert.equal(sundayClock.isSunday, true, 'work-hour tick should land on Sunday (day 0)');
assert.equal(sundayClock.isWorkHours, true);
assert.equal(isLaborPaused(sundayClock, true, true), true);
assert.equal(laborPauseLabel(sundayClock, true, true), 'Sunday sabbath');
assert.equal(expectLaborPausedLikeServer(sundayClock, true, true), true);

assert.equal(isLaborPaused(sundayClock, true, false), false);
assert.equal(expectLaborPausedLikeServer(sundayClock, true, false), false);

const schedule = deriveSettlementSchedule(
  { simTick: nightTick, parishPolicy: DEFAULT_PARISH_POLICY },
  null,
);
assert.equal(schedule.laborPaused, true);
assert.equal(schedule.dayNight.smokeAllowed, false);
assert.equal(schedule.dayNight.isNight, true);

const daySchedule = deriveSettlementSchedule(
  { simTick: middayTick, parishPolicy: DEFAULT_PARISH_POLICY },
  null,
);
assert.equal(daySchedule.laborPaused, false);
assert.equal(daySchedule.dayNight.smokeAllowed, true);
assert.equal(daySchedule.dayNight.isNight, false);
assert.ok(
  daySchedule.dayNight.buildingIndirectIntensity > schedule.dayNight.buildingIndirectIntensity,
  'daylight should provide more indirect building-face light than night',
);
assert.ok(daySchedule.dayNight.buildingIndirectIntensity >= 0.08);
assert.ok(schedule.dayNight.buildingIndirectIntensity <= 0.03);

const gameState = {
  buildings: new Map([
    ['chapel-1', {
      id: 'chapel-1',
      kind: 'chapel' as const,
      x: 0,
      z: 0,
      assignedLabor: 1,
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      food: 0,
      gold: 0,
    }],
  ]),
} as unknown as GameState;

const staffedKey = settlementScheduleDirtyKey(
  { simTick: workHourTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
const unstaffedKey = settlementScheduleDirtyKey(
  { simTick: workHourTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  null,
);
assert.notEqual(staffedKey, unstaffedKey);

const staffedSunday = deriveSettlementSchedule(
  { simTick: sundayWorkTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
assert.equal(staffedSunday.laborPaused, true);
assert.equal(staffedSunday.staffedChapel, true);

const elapsedAtWork = workMorningTick * SIM_TICK_SECONDS;
const interpolatedWork = deriveInterpolatedSettlementSchedule(
  elapsedAtWork + secondsPerGameMinute * 0.5,
  DEFAULT_PARISH_POLICY,
  null,
);
assert.equal(interpolatedWork.laborPaused, false);
assert.equal(interpolatedWork.clock.minute, 1);

const clockFromElapsed = gameClockAtElapsedSeconds(
  elapsedAtWork + secondsPerGameMinute * 1.01,
);
assert.equal(clockFromElapsed.hour, CALENDAR_WORK_START_HOUR);
assert.equal(clockFromElapsed.minute, 2);
assert.equal(gameClock(workMorningTick).hour, CALENDAR_WORK_START_HOUR);
for (const speed of [1, 5, 20, 120] as const) {
  assert.ok(
    Math.abs(
      interpolatedSimElapsedSeconds(0, 1, speed) - speed * SIM_REALTIME_RATE,
    ) < 1e-9,
  );
}
assert.equal(interpolatedSimElapsedSeconds(0, 10, 0), 0);

let presentationNowMs = 1_000;
const presentation = new SettlementPresentationController(() => presentationNowMs);
const emptyPresentationTargets = {
  settlementHud: null,
  sceneManager: null,
  buildingMarkers: null,
  residenceMarkers: null,
  villagers: null,
  ambientAudio: null,
};
const anchorTick = 3_700;
const noCombatAgents = new Map<string, CombatAgentState>();
const activeCombatAgents = new Map<string, CombatAgentState>([
  ['raider:42', {
    id: 'raider:42',
    raidId: '42',
    faction: 'raider',
    sourceBuildingId: null,
    sourceSlot: 0,
    targetKind: 'building',
    targetId: 'building:9',
    x: 20,
    z: 30,
    homeX: 300,
    homeZ: 300,
    health: 80,
    maxHealth: 80,
    readiness: 0,
    status: 'advancing',
    attackCooldown: 0,
    lootProgress: 0,
    carryingLoot: false,
    issuedPolearms: 0,
    raidAnchorBuildingId: null,
    stateChangedTick: anchorTick,
  }],
]);
const ultraSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 120,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(ultraSchedule);

presentationNowMs += 1_000;
const scenicSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 1,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(scenicSchedule);
assert.ok(
  scenicSchedule.clock.simTick > ultraSchedule.clock.simTick,
  'switching speed at the same authoritative tick must preserve interpolated clock progress',
);
assert.ok(
  Math.abs(
    scenicSchedule.clock.simTick
      - (
        ultraSchedule.clock.simTick
        + 120 * SIM_REALTIME_RATE / SIM_TICK_SECONDS
      ),
  ) < 1e-9,
);

presentationNowMs += 1_000;
const normalSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 5,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(normalSchedule);
assert.ok(
  Math.abs(
    normalSchedule.clock.simTick
      - (
        scenicSchedule.clock.simTick
        + SIM_REALTIME_RATE / SIM_TICK_SECONDS
      ),
  ) < 1e-9,
  'each subsequent speed transition must continue from the displayed clock',
);

const raidSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 5,
    combatAgents: activeCombatAgents,
  },
  null,
  true,
);
assert.ok(raidSchedule);
assert.equal(
  raidSchedule.laborPaused,
  true,
  'a capable hostile agent must stop visible civilian work immediately',
);

const winterQa = parseVisualQaConditions('?visualQa=winter');
assert.ok(winterQa);
const qaPresentation = new SettlementPresentationController(
  () => presentationNowMs,
  winterQa,
);
const qaSchedule = qaPresentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 120,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(qaSchedule);
assert.deepEqual(
  [
    qaSchedule.clock.month,
    qaSchedule.clock.monthDay,
    qaSchedule.clock.hour,
    qaSchedule.clock.minute,
  ],
  [1, 15, 13, 0],
  'visual-QA schedule must remain fixed independently of authoritative simulation time',
);
presentationNowMs += 5_000;
qaPresentation.tick(emptyPresentationTargets);
const repeatedQaSchedule = qaPresentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick + 1,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 120,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(repeatedQaSchedule);
assert.deepEqual(
  [
    repeatedQaSchedule.clock.month,
    repeatedQaSchedule.clock.monthDay,
    repeatedQaSchedule.clock.hour,
    repeatedQaSchedule.clock.minute,
  ],
  [1, 15, 13, 0],
);

const laborScheduleSource = readFileSync(
  new URL('../server/src/simulation/labor_schedule.rs', import.meta.url),
  'utf8',
);
const tickContextSource = readFileSync(
  new URL('../server/src/simulation/tick_context.rs', import.meta.url),
  'utf8',
);
const constructionSource = readFileSync(
  new URL('../server/src/simulation/construction.rs', import.meta.url),
  'utf8',
);
assert.match(
  tickContextSource,
  /sabbath_observance_by_owner:\s*RefCell<HashMap<Identity,\s*bool>>/,
  'owner Sabbath policy should be cached once per simulation substep',
);
assert.match(
  tickContextSource,
  /staffed_chapel_by_owner:\s*RefCell<HashMap<Identity,\s*bool>>/,
  'staffed-chapel state should be shared by every Sunday schedule check',
);
assert.match(
  tickContextSource,
  /building_ids_for_kinds\(ctx,\s*owner,\s*&\["chapel"\]\)/,
  'staffed-chapel discovery should use the shared owner/building-kind index',
);
assert.doesNotMatch(
  laborScheduleSource,
  /ctx\.db\s*\.\s*building\(\)\s*\.\s*iter\(\)/,
  'a schedule check must not rescan the whole building table',
);
assert.match(
  laborScheduleSource,
  /labor_and_logistics_paused\([\s\S]*?tick:\s*&SimTickContext[\s\S]*?owner_sabbath_observance_enabled\(ctx,\s*tick,\s*owner\)[\s\S]*?owner_has_staffed_chapel\(ctx,\s*tick,\s*owner\)/,
  'all schedule decisions should resolve through the tick-local owner caches',
);
assert.match(
  constructionSource,
  /site\.kind == "chapel"[\s\S]*?tick\.invalidate_staffed_chapel\(site\.owner\)/,
  'chapel completion should invalidate derived schedule state for later phases',
);

console.log('settlement schedule tests passed');
