import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementProvisioning,
  formatProvisionDays,
  settlementProvisionLevel,
  shouldShowProvisioning,
  WINTER_RESERVE_DAYS,
} from '../src/economy/settlementProvisioning.ts';
import { computeResourceTotals } from '../src/resources/resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';

const state = emptyGameState();
state.stockpile.food = 72;
state.stockpile.firewood = 259.2;
state.stockpile.gold = 7;
state.residences.set('tier-1', residence('tier-1', 1, 3));
state.residences.set('tier-2', residence('tier-2', 2, 4));
state.buildings.set('guards', building('guards', 'guardhouse', 3, 2.9));

const provisioning = computeSettlementProvisioning({
  state,
  totals: computeResourceTotals(state),
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathConsumptionPaused: true,
});

assert.equal(provisioning.foodConsumers, 7);
assert.equal(provisioning.heatedResidents, 4);
assert.equal(provisioning.armedGuards, 2, 'each ready guard must have one whole polearm');
assert.ok(Math.abs(
  provisioning.householdFoodPerDay
  - 7 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70 * (6 / 7),
) < 1e-9);
assert.equal(provisioning.guardFoodPerDay, 2 * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY);
assert.ok(Math.abs(provisioning.foodRunwayDays - 10) < 1e-9);
assert.ok(Math.abs(
  provisioning.winterFirewoodPerDay
  - 4 * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC * 120 * WINTER_FIREWOOD_DEMAND_MULTIPLIER,
) < 1e-9);
assert.ok(Math.abs(provisioning.winterFirewoodRunwayDays - 15) < 1e-9);
assert.ok(Math.abs(provisioning.winterFirewoodCoverage - 0.5) < 1e-9);
assert.equal(provisioning.guardWagePerDay, 2 * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY);
assert.ok(Math.abs(provisioning.guardWageRunwayDays - 10) < 1e-9);
assert.equal(settlementProvisionLevel(provisioning, 10), 'watch');
assert.equal(shouldShowProvisioning(provisioning, 10), true);
assert.equal(formatProvisionDays(provisioning.winterFirewoodRunwayDays), '15d');
assert.equal(WINTER_RESERVE_DAYS, 30);

const critical = computeSettlementProvisioning({
  state,
  totals: { ...computeResourceTotals(state), food: 7 },
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathConsumptionPaused: true,
});
assert.equal(settlementProvisionLevel(critical, 7), 'critical');
assert.equal(shouldShowProvisioning(critical, 7), true);

const empty = computeSettlementProvisioning({
  state: emptyGameState(),
  totals: computeResourceTotals(emptyGameState()),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathConsumptionPaused: false,
});
assert.equal(settlementProvisionLevel(empty, 10), 'none');
assert.equal(shouldShowProvisioning(empty, 10), false);

const perfState = emptyGameState();
for (let index = 0; index < 10_000; index += 1) {
  perfState.residences.set(
    `home-${index}`,
    residence(`home-${index}`, index % 3 === 0 ? 2 : 1, 4),
  );
}
const started = performance.now();
const perfProvisioning = computeSettlementProvisioning({
  state: perfState,
  totals: computeResourceTotals(perfState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathConsumptionPaused: false,
});
const elapsedMs = performance.now() - started;
assert.equal(perfProvisioning.foodConsumers, 40_000);
assert.ok(elapsedMs < 250, `10,000-home provisioning forecast took ${elapsedMs.toFixed(1)} ms`);

console.log(`settlement provisioning tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes)`);

function building(
  id: string,
  kind: BuildingState['kind'],
  assignedLabor: number,
  polearms: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 1,
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
    polearms,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
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
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function residence(id: string, tier: number, population: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
