import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  FIRE_RESOLVED_RETENTION_SECONDS,
  SIM_TICK_SECONDS,
  type BuildingKind,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementFireRecoveryPlan,
} from '../src/economy/settlementFireRecovery.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import { settlementHasStaffedChapel } from '../src/logistics/landmarkAccess.ts';
import {
  renderSettlementFireRecoveryRows,
} from '../src/resources/inspector/townHallRenderer.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';

const currentTick = 1_000;
const carpenter = building('2', 'carpenter', {
  x: 0,
  assignedLabor: 2,
});
const granary = building('10', 'granary', {
  x: 10,
  assignedLabor: 3,
  constructionPriority: 3,
});
const lodge = building('11', 'woodcutters_lodge', {
  x: 110,
  assignedLabor: 2,
  constructionPriority: 1,
});
const destroyedHome = residence('20', 2, {
  x: 20,
  population: 0,
  populationCapacity: 6,
  abandoned: true,
});
const burningHome = residence('21', 3, {
  x: 120,
  population: 4,
  populationCapacity: 4,
});
const incidents = new Map<string, FireIncidentState>([
  ['1', fire('1', 'building', granary.id, {
    x: granary.x,
    status: 'burning',
    intensity: 0.7,
    damage: 0.25,
    waterDelivered: 2,
    requiredWater: 10,
    responseWellId: null,
  })],
  ['2', fire('2', 'building', lodge.id, {
    x: lodge.x,
    status: 'extinguished',
    intensity: 0,
    damage: 0.5,
    resolvedTick: currentTick - Math.ceil(
      FIRE_RESOLVED_RETENTION_SECONDS / SIM_TICK_SECONDS,
    ),
  })],
  ['3', fire('3', 'residence', destroyedHome.id, {
    x: destroyedHome.x,
    status: 'destroyed',
    intensity: 0,
    damage: 1,
    resolvedTick: currentTick - 10,
  })],
  ['4', fire('4', 'residence', burningHome.id, {
    x: burningHome.x,
    status: 'burning',
    intensity: 0.95,
    damage: 0.1,
    waterDelivered: 3,
    requiredWater: 9,
    responseWellId: 'well-1',
  })],
]);
const state = {
  tick: currentTick,
  buildings: new Map([
    [carpenter.id, carpenter],
    [granary.id, granary],
    [lodge.id, lodge],
  ]),
  residences: new Map([
    [destroyedHome.id, destroyedHome],
    [burningHome.id, burningHome],
  ]),
  fireIncidents: incidents,
} as Pick<GameState, 'tick' | 'buildings' | 'residences' | 'fireIncidents'>;
const roadComponentIdsFor = (target: { x: number }): readonly number[] =>
  target.x < 100 ? [1] : [2];
const plan = computeSettlementFireRecoveryPlan({
  state,
  resources: { timber: 1, stone: 1 },
  roadComponentIdsFor,
});

assert.equal(plan.incidentCount, 4);
assert.equal(plan.burningCount, 2);
assert.equal(plan.respondedBurningCount, 1);
assert.equal(plan.unrespondedBurningCount, 1);
assert.equal(plan.responseWaterRemaining, 14);
assert.equal(plan.extinguishedCount, 1);
assert.equal(plan.destroyedCount, 1);
assert.equal(plan.readyRecoveryCount, 1);
assert.equal(plan.coolingRecoveryCount, 1);
assert.equal(plan.buildingOutages, 2);
assert.equal(plan.residenceOutages, 2);
assert.equal(plan.suspendedWorkers, 5);
assert.equal(plan.affectedResidents, 4);
assert.equal(plan.offlineHousingCapacity, 10);
assert.equal(plan.carpenterSupportedTargets, 2);
assert.equal(plan.firstActiveTarget?.targetId, granary.id);
assert.equal(plan.firstRecoveryTarget?.targetId, lodge.id);
assert.ok(plan.estimatedTimberCost > plan.readyTimberCost);
assert.ok(plan.estimatedStoneCost > plan.readyStoneCost);
assert.ok(plan.timberShortfall > 0);
assert.ok(plan.stoneShortfall > 0);

const disabledCarpenterPlan = computeSettlementFireRecoveryPlan({
  state: {
    ...state,
    fireIncidents: new Map([
      ...incidents,
      ['5', fire('5', 'building', carpenter.id, {
        status: 'extinguished',
        resolvedTick: 0,
      })] as const,
    ]),
  },
  resources: { timber: 1_000, stone: 1_000 },
  roadComponentIdsFor,
});
assert.equal(
  disabledCarpenterPlan.carpenterSupportedTargets,
  0,
  'a damaged carpenter must not discount any recovery target on its branch',
);

const rows = renderSettlementFireRecoveryRows(
  plan,
  (kind) => kind.replaceAll('_', ' '),
);
assert.match(rows, /Fire response/);
assert.match(rows, /1 without a responder/);
assert.match(rows, /Structural outages/);
assert.match(rows, /Recovery queue/);
assert.match(rows, /current minimum liability/);
assert.match(rows, /burning damage can raise it/);
assert.match(rows, /data-inspect-building="10"/);
assert.match(rows, /data-inspect-building="11"/);

const activeRepair = residence('22', 2, {
  x: 30,
  population: 0,
  populationCapacity: 6,
  fireRepairActive: true,
  upgradePriority: 3,
  upgradeProgress: 0.4,
  upgradeRequiredTimber: 20,
  upgradeRequiredStone: 12,
  upgradeDeliveredTimber: 8,
  upgradeDeliveredStone: 4,
  upgradeReservedTimber: 12,
  upgradeReservedStone: 8,
  upgradeAssignedLabor: 1,
});
const activeRepairPlan = computeSettlementFireRecoveryPlan({
  state: {
    tick: currentTick,
    buildings: new Map([[carpenter.id, carpenter]]),
    residences: new Map([[activeRepair.id, activeRepair]]),
    fireIncidents: new Map([
      ['active-repair', fire('active-repair', 'residence', activeRepair.id, {
        x: activeRepair.x,
        status: 'destroyed',
        intensity: 0,
        damage: 1,
        resolvedTick: currentTick - 10,
      })],
    ]),
  },
  resources: { timber: 0, stone: 0 },
  roadComponentIdsFor,
});
assert.equal(activeRepairPlan.activeRecoveryCount, 1);
assert.equal(activeRepairPlan.readyRecoveryCount, 0);
assert.equal(activeRepairPlan.coolingRecoveryCount, 0);
assert.equal(activeRepairPlan.estimatedTimberCost, 0);
assert.equal(activeRepairPlan.estimatedStoneCost, 0);
assert.equal(activeRepairPlan.timberShortfall, 0);
assert.equal(activeRepairPlan.stoneShortfall, 0);
assert.equal(activeRepairPlan.firstRecoveryTarget?.targetId, activeRepair.id);
assert.equal(activeRepairPlan.firstRecoveryTarget?.recoveryActive, true);
assert.equal(activeRepairPlan.firstRecoveryTarget?.workPriority, 3);
const activeRepairRows = renderSettlementFireRecoveryRows(
  activeRepairPlan,
  (kind) => kind.replaceAll('_', ' '),
);
assert.match(activeRepairRows, /1 active · 0 ready · 0 cooling/);
assert.match(activeRepairRows, /underway \(high work priority\)/);
assert.match(activeRepairRows, /data-inspect-residence="22"/);

const chapel = building('chapel-1', 'chapel', { assignedLabor: 1 });
const chapelState = {
  buildings: new Map([[chapel.id, chapel]]),
  fireIncidents: new Map<string, FireIncidentState>(),
};
assert.equal(settlementHasStaffedChapel(chapelState), true);
chapelState.fireIncidents.set(
  'chapel-fire',
  fire('chapel-fire', 'building', chapel.id, { status: 'extinguished' }),
);
assert.equal(
  settlementHasStaffedChapel(chapelState),
  false,
  'a fire-disabled chapel must not trigger Sabbath work stoppage',
);

const tickContextSource = readFileSync(
  'server/src/simulation/tick_context.rs',
  'utf8',
);
const staffedChapelSource = tickContextSource.slice(
  tickContextSource.indexOf('pub fn owner_has_staffed_chapel'),
  tickContextSource.indexOf('pub fn invalidate_staffed_chapel'),
);
assert.match(
  staffedChapelSource,
  /!self\.building_disabled_by_fire\(ctx, building\.id\)/,
  'the authoritative Sabbath roster must reject a fire-disabled chapel',
);
const townHallSource = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallSource, /computeSettlementFireRecoveryPlan/);
assert.match(townHallSource, /renderSettlementFireRecoveryRows/);

const perfBuildings = new Map<string, BuildingState>();
const perfIncidents = new Map<string, FireIncidentState>();
for (let index = 0; index < 100_000; index += 1) {
  const id = String(index);
  perfBuildings.set(id, building(id, 'lumber_mill'));
  perfIncidents.set(id, fire(id, 'building', id, {
    status: index % 5 === 0 ? 'destroyed' : 'extinguished',
    damage: (index % 100) / 100,
  }));
}
perfBuildings.set(
  'carpenter',
  building('carpenter', 'carpenter', { assignedLabor: 2 }),
);
let idleRoadProbes = 0;
const idleStarted = performance.now();
const idlePlan = computeSettlementFireRecoveryPlan({
  state: {
    tick: currentTick,
    buildings: perfBuildings,
    residences: new Map(),
    fireIncidents: new Map(),
  },
  resources: { timber: 0, stone: 0 },
  roadComponentIdsFor: () => {
    idleRoadProbes += 1;
    return [1];
  },
});
const idleElapsed = performance.now() - idleStarted;
assert.equal(idlePlan.incidentCount, 0);
assert.equal(idleRoadProbes, 0);
assert.ok(
  idleElapsed < 10,
  `idle recovery planning took ${idleElapsed.toFixed(1)} ms`,
);

const perfStarted = performance.now();
const perfPlan = computeSettlementFireRecoveryPlan({
  state: {
    tick: currentTick,
    buildings: perfBuildings,
    residences: new Map(),
    fireIncidents: perfIncidents,
  },
  resources: { timber: 1_000_000_000, stone: 1_000_000_000 },
});
const perfElapsed = performance.now() - perfStarted;
assert.equal(perfPlan.incidentCount, 100_000);
assert.equal(perfPlan.readyRecoveryCount, 100_000);
assert.equal(perfPlan.firstRecoveryTarget?.targetId, '95');
assert.ok(
  perfElapsed < 500,
  `100k-incident recovery planning took ${perfElapsed.toFixed(1)} ms`,
);

console.log(
  `settlement fire-recovery planning tests passed (${idleElapsed.toFixed(1)} ms idle; `
  + `${perfElapsed.toFixed(1)} ms for 100,000 incidents)`,
);

function building(
  id: string,
  kind: BuildingKind,
  partial: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    ...partial,
  };
}

function residence(
  id: string,
  tier: ResidenceState['tier'],
  partial: Partial<ResidenceState> = {},
): ResidenceState {
  return {
    id,
    zoneId: 'zone-1',
    parcelIndex: Number(id) || 0,
    x: 0,
    z: 0,
    yaw: 0,
    population: 0,
    populationCapacity: 4,
    tier,
    settlementTicks: 0,
    needs: {} as ResidenceState['needs'],
    abandoned: false,
    householdWealth: 0,
    ...partial,
  };
}

function fire(
  id: string,
  targetKind: FireIncidentState['targetKind'],
  targetId: string,
  partial: Partial<FireIncidentState> = {},
): FireIncidentState {
  return {
    id,
    targetKind,
    targetId,
    x: 0,
    z: 0,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 0.5,
    damage: 0.2,
    waterDelivered: 0,
    requiredWater: 6,
    extinguishChance: 0,
    startedTick: 0,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
    ...partial,
  };
}
