import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  GUARDHOUSE_PAYROLL_VISUAL_CAPACITY,
  GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS,
} from '../src/buildings/meshes/civicLogisticsBuildingMeshes.ts';
import type { BuildingState } from '../src/resources/types.ts';
import {
  GUARDHOUSE_PAY_PRIORITY_HIGH,
  GUARDHOUSE_PAY_PRIORITY_LOW,
  GUARDHOUSE_PAY_PRIORITY_NORMAL,
  guardhousePayrollCartLoad,
  guardhousePayrollDispatchPlan,
  guardhousePayrollInTransitGold,
  guardhousePayrollLogisticsPlan,
  guardhousePayrollPlan,
  guardhousePayrollReorderPoint,
  guardhousePayrollTarget,
  guardhousePayPriorityLabel,
  normalizeGuardhousePayPriority,
} from '../src/security/guardhousePayrollPolicy.ts';

assert.equal(normalizeGuardhousePayPriority(undefined), GUARDHOUSE_PAY_PRIORITY_NORMAL);
assert.equal(normalizeGuardhousePayPriority(-4), GUARDHOUSE_PAY_PRIORITY_LOW);
assert.equal(normalizeGuardhousePayPriority(99), GUARDHOUSE_PAY_PRIORITY_HIGH);
assert.equal(guardhousePayPriorityLabel(0), 'Low');
assert.equal(guardhousePayPriorityLabel(1), 'Normal');
assert.equal(guardhousePayPriorityLabel(2), 'High');

const payroll = guardhousePayrollPlan([
  guardhouse('building-10', 4, GUARDHOUSE_PAY_PRIORITY_HIGH),
  guardhouse('building-2', 2, GUARDHOUSE_PAY_PRIORITY_HIGH),
  guardhouse('building-1', 6, GUARDHOUSE_PAY_PRIORITY_NORMAL),
  guardhouse('building-3', 1, GUARDHOUSE_PAY_PRIORITY_LOW),
  guardhouse('building-4', 0, GUARDHOUSE_PAY_PRIORITY_HIGH),
], 2);

assert.deepEqual(
  payroll.map((company) => company.building.id),
  ['building-2', 'building-10', 'building-1', 'building-3'],
  'priority must lead and server u64 order must break equal-priority ties',
);
assert.equal(payroll[0].dailyWage, 0.7);
assert.equal(payroll[0].fundedGold, 0.7);
assert.ok(Math.abs(payroll[1].fundedGold - 1.3) < 1e-9);
assert.ok(Math.abs(payroll[1].fundedRatio - (1.3 / 1.4)) < 1e-9);
assert.equal(payroll[2].fundedRatio, 0);
assert.equal(payroll[3].fundedRatio, 0);
assert.deepEqual(payroll.map((company) => company.claimPosition), [1, 2, 3, 4]);
assert.ok(Math.abs(guardhousePayrollTarget(6) - 21) < 1e-9);
assert.ok(Math.abs(guardhousePayrollReorderPoint(6) - 10.5) < 1e-9);
assert.equal(
  guardhousePayrollCartLoad({
    armedGuards: 6,
    onsiteGold: 10.5,
    inTransitGold: 0,
    treasuryGold: 100,
  }),
  0,
  'a company at the five-day reorder point must not dispatch fractional carts',
);
assert.ok(Math.abs(
  guardhousePayrollCartLoad({
    armedGuards: 6,
    onsiteGold: 8.4,
    inTransitGold: 0,
    treasuryGold: 100,
  }) - 12.6,
) < 1e-9);

const physicalCompany = guardhouse('building-20', 6, GUARDHOUSE_PAY_PRIORITY_HIGH);
physicalCompany.x = 100;
physicalCompany.gold = 4;
const townHall = {
  ...guardhouse('building-1', 0, GUARDHOUSE_PAY_PRIORITY_NORMAL),
  kind: 'town_hall',
  x: 0,
  gold: 30,
} as BuildingState;
const readyLogistics = guardhousePayrollLogisticsPlan({
  guardhouse: physicalCompany,
  buildings: [physicalCompany, townHall],
  trips: [],
  physicalEconomy: true,
  freeHaulers: 1,
  getRoadPathDistance: () => 125,
});
assert.equal(readyLogistics.status, 'ready');
assert.equal(readyLogistics.source?.id, townHall.id);
assert.equal(readyLogistics.routeDistance, 125);
assert.ok(Math.abs(readyLogistics.cartLoad - 17) < 1e-9);
assert.equal(
  guardhousePayrollLogisticsPlan({
    guardhouse: physicalCompany,
    buildings: [physicalCompany, townHall],
    trips: [],
    physicalEconomy: true,
    freeHaulers: 0,
    getRoadPathDistance: () => 125,
  }).status,
  'no-hauler',
);
assert.equal(
  guardhousePayrollLogisticsPlan({
    guardhouse: physicalCompany,
    buildings: [physicalCompany, townHall],
    trips: [],
    physicalEconomy: true,
    freeHaulers: 1,
    getRoadPathDistance: () => null,
  }).status,
  'no-road',
);
const incomingPayroll = {
  id: 'trip-1',
  buildingId: townHall.id,
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: physicalCompany.id,
  cargoKind: 'gold',
  amount: 12,
  phase: 'outbound',
  x: 50,
  z: 0,
  progress: 50,
  speedMps: 2,
  unloadSeconds: 3,
  unloadRemaining: 3,
  deliveryWorkers: 1,
  freeHaulerWorkers: 1,
  pathDistance: 125,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
} as const;
assert.equal(
  guardhousePayrollInTransitGold([incomingPayroll]).get(physicalCompany.id),
  12,
);
const enRouteLogistics = guardhousePayrollLogisticsPlan({
  guardhouse: physicalCompany,
  buildings: [physicalCompany, townHall],
  trips: [incomingPayroll],
  physicalEconomy: true,
  freeHaulers: 0,
  getRoadPathDistance: () => 125,
});
assert.equal(enRouteLogistics.status, 'en-route');
assert.equal(enRouteLogistics.securedGold, 16);
assert.equal(enRouteLogistics.activeTrip?.id, incomingPayroll.id);

const secondPhysicalCompany = guardhouse(
  'building-21',
  2,
  GUARDHOUSE_PAY_PRIORITY_NORMAL,
);
const salvageTreasury = {
  ...guardhouse('building-30', 0, GUARDHOUSE_PAY_PRIORITY_NORMAL),
  kind: 'salvage_pile',
  gold: 10,
} as BuildingState;
const physicalDispatchPayroll = guardhousePayrollPlan(
  [secondPhysicalCompany, physicalCompany, townHall, salvageTreasury],
  40,
);
const physicalDispatch = guardhousePayrollDispatchPlan({
  payroll: physicalDispatchPayroll,
  buildings: [
    secondPhysicalCompany,
    physicalCompany,
    townHall,
    salvageTreasury,
  ],
  trips: [],
  treasuryGold: 40,
  physicalEconomy: true,
  freeHaulers: 2,
  roadComponentFor: () => 1,
});
assert.equal(physicalDispatch.reorderDueCompanies, 2);
assert.equal(physicalDispatch.projectedCarts, 2);
assert.ok(Math.abs(physicalDispatch.projectedGold - 24) < 1e-9);
assert.ok(Math.abs(physicalDispatch.remainingTreasuryGold - 16) < 1e-9);
assert.equal(physicalDispatch.remainingFreeHaulers, 0);
assert.equal(
  physicalDispatch.firstClaimBuildingId,
  physicalCompany.id,
  'high-priority payroll must claim the first physical treasury cart',
);
const oneSourceDispatch = guardhousePayrollDispatchPlan({
  payroll: physicalDispatchPayroll,
  buildings: [secondPhysicalCompany, physicalCompany, townHall],
  trips: [],
  treasuryGold: 40,
  physicalEconomy: true,
  freeHaulers: 2,
  roadComponentFor: () => 1,
});
assert.equal(oneSourceDispatch.projectedCarts, 1);
assert.ok(Math.abs(oneSourceDispatch.projectedGold - 17) < 1e-9);
assert.ok(
  Math.abs(oneSourceDispatch.remainingTreasuryGold - 23) < 1e-9,
  'one treasury chest must not promise simultaneous payroll and market carts',
);
const severedDispatch = guardhousePayrollDispatchPlan({
  payroll: physicalDispatchPayroll,
  buildings: [secondPhysicalCompany, physicalCompany, townHall],
  trips: [],
  treasuryGold: 40,
  physicalEconomy: true,
  freeHaulers: 2,
  roadComponentFor: (candidate) =>
    candidate.kind === 'town_hall' ? 1 : 2,
});
assert.equal(severedDispatch.projectedCarts, 0);
assert.equal(severedDispatch.remainingTreasuryGold, 40);
const partialInboundPayroll = {
  ...incomingPayroll,
  id: 'trip-partial',
  amount: 2,
};
const inboundDispatchPayroll = guardhousePayrollPlan(
  [physicalCompany, townHall],
  40,
  new Set(),
  guardhousePayrollInTransitGold([partialInboundPayroll]),
);
const inboundDispatch = guardhousePayrollDispatchPlan({
  payroll: inboundDispatchPayroll,
  buildings: [physicalCompany, townHall],
  trips: [partialInboundPayroll],
  treasuryGold: 40,
  physicalEconomy: true,
  freeHaulers: 1,
  roadComponentFor: () => 1,
});
assert.equal(inboundDispatch.reorderDueCompanies, 1);
assert.equal(inboundDispatch.inboundCompanies, 1);
assert.equal(inboundDispatch.projectedCarts, 0);
assert.equal(inboundDispatch.remainingTreasuryGold, 40);

const fireFilteredPayroll = guardhousePayrollPlan(
  [
    guardhouse('building-2', 2, GUARDHOUSE_PAY_PRIORITY_HIGH),
    guardhouse('building-10', 4, GUARDHOUSE_PAY_PRIORITY_HIGH),
  ],
  10,
  new Set(['building-2']),
);
assert.deepEqual(
  fireFilteredPayroll.map((company) => company.building.id),
  ['building-10'],
  'fire-disabled companies must neither consume wages nor displace the next payroll claim',
);

const legacy = guardhousePayrollPlan([
  guardhouse('building-5', 2, undefined),
], 1);
assert.equal(legacy[0].priority, GUARDHOUSE_PAY_PRIORITY_NORMAL);
assert.equal(legacy[0].fundedRatio, 1);

const schema = readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  schema,
  /#\[default\(1u8\)\]\s+pub guardhouse_pay_priority: u8/,
  'existing saves must migrate to normal company priority',
);

const reducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(
  reducers,
  /set_guardhouse_pay_priority[\s\S]*?is_valid_guardhouse_pay_priority[\s\S]*?building\.guardhouse_pay_priority = pay_priority/,
  'company priority must remain owner-validated, server-authoritative, and save-compatible',
);

const simulation = readFileSync('server/src/reducers/simulation.rs', 'utf8');
assert.match(
  simulation,
  /guardhouse_payroll_ids\.push[\s\S]*?guardhouse_payroll_buckets\(guardhouse_payroll_ids\)[\s\S]*?\.rev\(\)[\s\S]*?step_guardhouse/,
  'guardhouses must consume scarce wages from high to low priority outside mixed building order',
);
assert.match(
  simulation,
  /Residence-upgrade grants are already reserved[\s\S]*?if conflict_enabled[\s\S]*?try_dispatch_guardhouse_payroll\([\s\S]*?step_marketplace_caravans\(ctx/,
  'physical payroll must claim treasury carts before marketplace working-cash refills',
);

const inspector = readFileSync('src/resources/inspector/guardhouseRenderer.ts', 'utf8');
assert.match(
  inspector,
  /Company priority[\s\S]*?data-guardhouse-pay-priority[\s\S]*?lowest armed share first/,
  'guardhouse controls must explain the shared equipment, provision, and wage order',
);
const guardhousePayrollSimulation = readFileSync(
  'server/src/simulation/guardhouse_payroll.rs',
  'utf8',
);
assert.match(
  guardhousePayrollSimulation,
  /available_free_haulers[\s\S]*?building_ids_for_kinds[\s\S]*?PAYROLL_TREASURY_KINDS[\s\S]*?try_start_building_supply_trip[\s\S]*?CommodityKind::Gold/,
  'physical payroll must reserve free labor and move one lockbox over a real treasury road route',
);
assert.match(
  guardhousePayrollSimulation,
  /physical_founding_site_enabled[\s\S]*?if !physical_economy[\s\S]*?armed_guards/,
  'the early payroll pass must preserve legacy abstract-treasury saves',
);
const deliveryTrips = readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(
  deliveryTrips,
  /DeliveryLaborSource::Free => available_free_haulers/,
  'treasury payroll carts must reserve a free hauler instead of removing the Town Hall clerk',
);
const townHallInspector = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallInspector, /Next-day payroll/);
assert.match(townHallInspector, /Civic cash priority/);
assert.match(townHallInspector, /before market reserve carts/);
assert.match(townHallInspector, /payrollDispatch\.remainingTreasuryGold/);
assert.match(
  townHallInspector,
  /Company priorities[\s\S]*?governs scarce polearms, routine provisions, and wages/,
  'the settlement ledger must expose aggregate funding and every assigned company priority',
);
const expandedEconomy = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
assert.match(
  expandedEconomy,
  /dispatch_polearms_to_guardhouse[\s\S]*?select_guardhouse_armament_candidate[\s\S]*?guardhouse_pay_priority[\s\S]*?guardhouse_polearm_coverage[\s\S]*?distance[\s\S]*?building\.id/,
  'carpenter weapon dispatch must apply priority, armed coverage, route, and stable id',
);
assert.match(
  expandedEconomy,
  /physical_payroll[\s\S]*?try_dispatch_guardhouse_payroll[\s\S]*?building\.gold[\s\S]*?CommodityKind::Gold[\s\S]*?else \{[\s\S]*?spend_treasury_gold/,
  'new saves must consume local pay chests while legacy saves retain abstract treasury compatibility',
);
assert.match(
  expandedEconomy,
  /wage_paid[\s\S]*credit_settlement_household_income[\s\S]*withdrawn - credited/,
  'guard wages must move civic coin into household wallets and conserve any cap overflow',
);
const commodities = readFileSync('server/src/economy/commodities.rs', 'utf8');
assert.match(
  commodities,
  /CommodityKind::Gold[\s\S]*?"guardhouse"/,
  'guardhouses must accept physical payroll coin',
);
const fires = readFileSync('server/src/simulation/fires.rs', 'utf8');
assert.match(
  fires,
  /building\.gold = 0\.0/,
  'a destroyed guardhouse must lose the coin stored in its pay chest',
);
const settlementSecurity = readFileSync(
  'server/src/simulation/settlement_security.rs',
  'utf8',
);
assert.match(
  settlementSecurity,
  /fn building_portable_stores[\s\S]*?gold: building\.gold[\s\S]*?pub\(super\) fn building_portable_stores_at_site[\s\S]*?stores\.polearms = \(stores\.polearms - issued\)\.max\(0\.0\)[\s\S]*?pub\(super\) fn plunder_raid_target_at_contact[\s\S]*?RaidTargetKind::Building[\s\S]*?let before = building_portable_stores_at_site\(&building, issued\)[\s\S]*?before\.plunder\(loss_fraction\)[\s\S]*?company_remaining\.polearms \+= issued[\s\S]*?retain_unplundered_stores/,
  'guardhouse pay chests must remain part of the portable stores removed only after raid contact',
);
assert.match(
  inspector,
  /Pay chest[\s\S]*?Payroll route[\s\S]*?pay lockboxes from a civic treasury/,
  'the guardhouse inspector must expose local coin, route blockers, and the full supply chain',
);
const guardhouseMesh = createBuildingMesh('guardhouse');
const payrollChest = guardhouseMesh.getObjectByName('GuardhousePayrollChest');
assert.ok(payrollChest instanceof THREE.Group);
assert.equal(
  payrollChest.children.filter((child) => child.name === 'GuardhousePayrollSegment').length,
  GUARDHOUSE_PAYROLL_VISUAL_SEGMENTS,
);
assert.ok(Math.abs(GUARDHOUSE_PAYROLL_VISUAL_CAPACITY - 21) < 1e-9);
const lowChest = guardhouse('building-90', 6, GUARDHOUSE_PAY_PRIORITY_NORMAL);
lowChest.gold = 1;
const fullChest = { ...lowChest, gold: GUARDHOUSE_PAYROLL_VISUAL_CAPACITY };
assert.notEqual(
  buildingMarkerSignatures(new Map([[lowChest.id, lowChest]])).visual,
  buildingMarkerSignatures(new Map([[fullChest.id, fullChest]])).visual,
  'pay-chest fill bands must refresh without rebuilding colliders',
);

const performanceCompanies = Array.from(
  { length: 100_000 },
  (_, index) => guardhouse(
    `building-${100_000 - index}`,
    (index % 6) + 1,
    index % 3,
  ),
);
const performanceFireDisabled = new Set(
  performanceCompanies
    .filter((_, index) => index % 2 === 0)
    .map((company) => company.id),
);
const performanceStarted = performance.now();
const performancePlan = guardhousePayrollPlan(
  performanceCompanies,
  10_000,
  performanceFireDisabled,
);
const performanceElapsed = performance.now() - performanceStarted;
assert.equal(performancePlan.length, 50_000);
assert.equal(performancePlan[0].priority, GUARDHOUSE_PAY_PRIORITY_HIGH);
assert.ok(
  performanceElapsed < 500,
  `100k-company client payroll forecast regressed (${performanceElapsed.toFixed(1)} ms)`,
);
const dispatchPerformanceStarted = performance.now();
const performanceDispatch = guardhousePayrollDispatchPlan({
  payroll: performancePlan,
  buildings: [
    ...performanceCompanies,
    {
      ...guardhouse('building-200000', 0, GUARDHOUSE_PAY_PRIORITY_NORMAL),
      kind: 'town_hall',
      gold: 10_000,
    } as BuildingState,
  ],
  trips: [],
  treasuryGold: 10_000,
  physicalEconomy: true,
  freeHaulers: 1,
  roadComponentFor: () => 1,
});
const dispatchPerformanceElapsed =
  performance.now() - dispatchPerformanceStarted;
assert.equal(performanceDispatch.projectedCarts, 1);
assert.ok(
  dispatchPerformanceElapsed < 250,
  `100k-company physical cash arbitration regressed (${dispatchPerformanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `guardhouse payroll policy tests passed (${performanceElapsed.toFixed(1)} ms forecast + ${dispatchPerformanceElapsed.toFixed(1)} ms cash arbitration for 100k companies / 50k fire outages)`,
);

function guardhouse(
  id: string,
  armedGuards: number,
  priority: number | undefined,
): BuildingState {
  return {
    id,
    kind: 'guardhouse',
    constructionComplete: true,
    assignedLabor: armedGuards,
    polearms: armedGuards,
    guardhousePayPriority: priority,
    gold: 0,
    x: 0,
    z: 0,
  } as BuildingState;
}
