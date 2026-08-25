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
  historicalHolidayYear,
  holidayObservanceForClock,
  julianEasterDate,
} from '../src/world/holidayCalendar.ts';
import {
  holidayBackyardPosition,
  holidayChapelActivity,
} from '../src/settlement/holidayCelebration.ts';
import {
  deriveSettlementSchedule,
  deriveSettlementScheduleFromClock,
  expectLaborPausedLikeServer,
  settlementScheduleDirtyKey,
  type SettlementSchedule,
} from '../src/world/settlementSchedule.ts';
import { deriveInterpolatedSettlementSchedule } from '../src/world/settlementSchedule.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import {
  interpolatedSimElapsedSeconds,
  SettlementPresentationController,
  type SettlementPresentationTargets,
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
assert.equal(isLaborPaused(nightClock, false, false), false);
assert.equal(laborPauseLabel(nightClock, false, false), null);
assert.equal(expectLaborPausedLikeServer(nightClock, false, false), false);

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

assert.deepEqual(julianEasterDate(1550), { month: 4, day: 6 });
assert.deepEqual(julianEasterDate(1551), { month: 3, day: 29 });
assert.equal(historicalHolidayYear(1), 1550);
assert.equal(historicalHolidayYear(10), 1559);
assert.equal(historicalHolidayYear(11), 1550);

const jurjevoClock = {
  ...workClock,
  month: 4,
  monthDay: 23,
  year: 1,
  isSunday: false,
};
const jurjevo = holidayObservanceForClock(jurjevoClock);
assert.ok(jurjevo);
assert.equal(jurjevo.id, 'jurjevo');
assert.equal(jurjevo.historicalYear, 1550);
assert.equal(isLaborPaused(jurjevoClock, false, false), true);
assert.equal(laborPauseLabel(jurjevoClock, false, false), 'Jurjevo · St George');

const easter1550 = holidayObservanceForClock({ month: 4, monthDay: 6, year: 1 });
assert.equal(easter1550?.id, 'easter');
assert.equal(easter1550?.periodLength, 4);
assert.equal(
  holidayObservanceForClock({ month: 3, monthDay: 29, year: 2 })?.id,
  'easter',
);
assert.equal(
  holidayObservanceForClock({ month: 12, monthDay: 25, year: 1 })?.periodDay,
  2,
);
assert.equal(holidayObservanceForClock({ month: 4, monthDay: 26, year: 1 }), null);

const chapelCohorts = Array.from({ length: 100 }, (_, index) =>
  holidayChapelActivity(
    { hour: 17, minute: 0 },
    jurjevo,
    `villager:${index}`,
  )
);
assert.ok(chapelCohorts.some((activity) => activity === 'congregation'));
assert.ok(chapelCohorts.some((activity) => activity === null));
const backyard = holidayBackyardPosition(
  { x: 10, z: 20, yaw: 0 },
  'villager:backyard',
);
assert.ok(backyard.z < 16, 'holiday household positions should sit behind the main house');

const schedule = deriveSettlementSchedule(
  { simTick: nightTick, parishPolicy: DEFAULT_PARISH_POLICY },
  null,
);
assert.equal(schedule.laborPaused, false);
assert.equal(schedule.dayNight.smokeAllowed, true);
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
  fireIncidents: new Map(),
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

gameState.fireIncidents.set('chapel-fire', {
  id: 'chapel-fire',
  targetKind: 'building',
  targetId: 'chapel-1',
  status: 'burning',
} as never);
const fireDisabledKey = settlementScheduleDirtyKey(
  { simTick: workHourTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
assert.notEqual(
  fireDisabledKey,
  staffedKey,
  'the presentation schedule must invalidate when its only staffed chapel catches fire',
);
const fireDisabledSunday = deriveSettlementSchedule(
  { simTick: sundayWorkTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
assert.equal(fireDisabledSunday.staffedChapel, false);
assert.equal(
  fireDisabledSunday.laborPaused,
  false,
  'workers must remain on duty when the only chapel is fire-disabled',
);

const holidaySchedule = deriveSettlementScheduleFromClock(
  jurjevoClock,
  { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: false },
  null,
);
assert.equal(holidaySchedule.laborPaused, true);
assert.equal(holidaySchedule.holiday?.id, 'jurjevo');
assert.equal(holidaySchedule.laborPauseLabel, 'Jurjevo · St George');

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

const reusableClock = gameClockAtElapsedSeconds(0);
const expectedReusableClock = gameClockAtElapsedSeconds(
  elapsedAtWork + secondsPerGameMinute * 7.25,
);
assert.equal(
  gameClockAtElapsedSeconds(
    elapsedAtWork + secondsPerGameMinute * 7.25,
    reusableClock,
  ),
  reusableClock,
  'elapsed-time presentation should be able to reuse its owned clock record',
);
assert.deepEqual(reusableClock, expectedReusableClock);

const reusableSchedule = deriveSettlementScheduleFromClock(
  gameClockAtElapsedSeconds(elapsedAtWork),
  DEFAULT_PARISH_POLICY,
  null,
);
const reusableDayNight = reusableSchedule.dayNight;
const reusableSunDirection = reusableSchedule.dayNight.sunDirection;
const reusableGrade = reusableSchedule.dayNight.grade;
const nextReusableClock = gameClockAtElapsedSeconds(
  elapsedAtWork + secondsPerGameMinute * 11.75,
);
const expectedReusableSchedule = deriveSettlementScheduleFromClock(
  gameClockAtElapsedSeconds(elapsedAtWork + secondsPerGameMinute * 11.75),
  DEFAULT_PARISH_POLICY,
  null,
);
assert.equal(
  deriveSettlementScheduleFromClock(
    nextReusableClock,
    DEFAULT_PARISH_POLICY,
    null,
    undefined,
    reusableSchedule,
  ),
  reusableSchedule,
  'presentation schedule updates should reuse the controller-owned record',
);
assert.equal(reusableSchedule.clock, nextReusableClock);
assert.equal(reusableSchedule.dayNight, reusableDayNight);
assert.equal(reusableSchedule.dayNight.sunDirection, reusableSunDirection);
assert.equal(reusableSchedule.dayNight.grade, reusableGrade);
assert.deepEqual(reusableSchedule, expectedReusableSchedule);
for (const speed of [1, 4, 8] as const) {
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
const fastestSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 8,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
assert.ok(fastestSchedule);

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
  scenicSchedule.clock.simTick > fastestSchedule.clock.simTick,
  'switching speed at the same authoritative tick must preserve interpolated clock progress',
);
assert.ok(
  Math.abs(
    scenicSchedule.clock.simTick
      - (
        fastestSchedule.clock.simTick
        + 8 * SIM_REALTIME_RATE / SIM_TICK_SECONDS
      ),
  ) < 1e-9,
);

presentationNowMs += 1_000;
const normalSchedule = presentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 4,
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
    gameSpeed: 4,
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

let presentationBuildingScans = 0;
const countedBuildings = new Map(gameState.buildings);
const countedBuildingValues = countedBuildings.values.bind(countedBuildings);
countedBuildings.values = () => {
  presentationBuildingScans += 1;
  return countedBuildingValues();
};
let presentationCombatScans = 0;
const countedCombatAgents = new Map(activeCombatAgents);
const countedCombatValues = countedCombatAgents.values.bind(countedCombatAgents);
countedCombatAgents.values = () => {
  presentationCombatScans += 1;
  return countedCombatValues();
};
const cachedPresentation = new SettlementPresentationController(
  () => presentationNowMs,
);
cachedPresentation.sync(
  emptyPresentationTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 4,
    combatAgents: countedCombatAgents,
  },
  { buildings: countedBuildings } as unknown as GameState,
  true,
);
const scansAfterSync = {
  buildings: presentationBuildingScans,
  combat: presentationCombatScans,
};
const cachedTickStarted = performance.now();
for (let frame = 0; frame < 10_000; frame += 1) {
  presentationNowMs += 16;
  cachedPresentation.tick(emptyPresentationTargets);
}
const cachedTickElapsedMs = performance.now() - cachedTickStarted;
assert.deepEqual(
  {
    buildings: presentationBuildingScans,
    combat: presentationCombatScans,
  },
  scansAfterSync,
  'interpolated presentation frames must reuse snapshot-derived chapel and raid state',
);
assert.ok(
  cachedTickElapsedMs < 250,
  `10,000 cached presentation frames took ${cachedTickElapsedMs.toFixed(1)} ms`,
);

const presentedSchedules: SettlementSchedule[] = [];
const retainedPresentation = new SettlementPresentationController(
  () => presentationNowMs,
);
const retainedTargets = {
  ...emptyPresentationTargets,
  ambientAudio: {
    syncSettlementSchedule(value: SettlementSchedule | null) {
      if (value) presentedSchedules.push(value);
    },
  },
} as unknown as SettlementPresentationTargets;
retainedPresentation.sync(
  retainedTargets,
  {
    simTick: anchorTick,
    parishPolicy: DEFAULT_PARISH_POLICY,
    gameSpeed: 4,
    combatAgents: noCombatAgents,
  },
  null,
  true,
);
presentationNowMs += 16;
retainedPresentation.tick(retainedTargets);
const firstRetainedTick = presentedSchedules.at(-1)!;
const firstRetainedTickSimTick = firstRetainedTick.clock.simTick;
presentationNowMs += 16;
retainedPresentation.tick(retainedTargets);
const secondRetainedTick = presentedSchedules.at(-1)!;
assert.equal(
  secondRetainedTick,
  firstRetainedTick,
  'ordinary interpolated frames should retain one controller-owned schedule record',
);
assert.equal(secondRetainedTick.clock, firstRetainedTick.clock);
assert.equal(secondRetainedTick.dayNight, firstRetainedTick.dayNight);
assert.equal(secondRetainedTick.dayNight.sunDirection, firstRetainedTick.dayNight.sunDirection);
assert.equal(secondRetainedTick.dayNight.grade, firstRetainedTick.dayNight.grade);
assert.ok(
  secondRetainedTick.clock.simTick > firstRetainedTickSimTick,
  'the retained clock must still advance continuously',
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
    gameSpeed: 8,
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
    gameSpeed: 8,
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
const simulationSource = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const laborStewardSources = [
  'seasonal_labor_steward.rs',
  'production_labor_steward.rs',
  'construction_labor_steward.rs',
].map((fileName) => ({
  fileName,
  source: readFileSync(
    new URL(`../server/src/simulation/${fileName}`, import.meta.url),
    'utf8',
  ),
}));
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
  /labor_and_logistics_paused\([\s\S]*?tick:\s*&SimTickContext[\s\S]*?owner_observes_sabbath\(ctx,\s*tick,\s*owner,\s*clock\)/,
  'all schedule decisions should resolve through the owner-aware Sabbath helper',
);
for (const { fileName, source } of laborStewardSources) {
  assert.match(
    source,
    /&&\s*!.*owner_observes_sabbath\([\s\S]{0,180}?ctx,\s*tick,\s*settlement\.owner,\s*clock/,
    `${fileName} must not churn worker assignments during an observed Sabbath`,
  );
}
assert.doesNotMatch(
  laborScheduleSource,
  /if\s+!clock\.is_work_hours|if\s+!is_work_hours\(clock\)/,
  'displayed work-hour metadata must not pause continuous labor or logistics',
);
assert.match(
  constructionSource,
  /site\.kind == "chapel"[\s\S]*?tick\.invalidate_staffed_chapel\(site\.owner\)/,
  'chapel completion should invalidate derived schedule state for later phases',
);
assert.match(
  simulationSource,
  /holiday_observance\(&clock\)\.is_some\(\)[\s\S]*?return;/,
  'the authoritative substep should freeze all production and penalty state on named holy days',
);
assert.match(
  simulationSource,
  /if !holiday_protected \{[\s\S]*?step_live_raids/,
  'holiday protection should also stop wall-clock combat damage while the calendar advances',
);
assert.match(
  simulationSource,
  /if has_delivery_trips \{[\s\S]*?step_delivery_trips/,
  'already-departed carts must keep moving through a named holy day',
);
assert.doesNotMatch(
  simulationSource,
  /if has_delivery_trips && !holiday_protected/,
  'holiday protection must block new dispatch without stranding committed carts',
);

console.log('settlement schedule tests passed');
