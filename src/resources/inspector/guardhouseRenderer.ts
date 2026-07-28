import { getBuildingCost } from '../buildingEconomy.ts';
import {
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE,
  GUARDHOUSE_PAYROLL_REORDER_DAYS,
  GUARDHOUSE_PAYROLL_TARGET_DAYS,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
} from '../../generated/gameBalance.ts';
import {
  formatProvisionRunway,
  PROVISION_WARNING_DAYS,
} from '../../economy/settlementProvisioning.ts';
import {
  armedGuardCount,
  formatFrontierForecast,
  getGuardhouseMusterState,
  GUARDHOUSE_FOOD_RESERVES,
  guardhouseFoodTarget,
  guardhouseFoodReserveLabel,
  guardhouseMusterResponseBand,
  GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
  isFrontierAlertActive,
  normalizeGuardhouseMusterWatchtowerId,
  normalizeGuardhouseFoodReserve,
} from '../../security/frontierSecurity.ts';
import {
  GUARDHOUSE_PAY_PRIORITIES,
  guardhousePayrollInTransitGold,
  guardhousePayrollLogisticsPlan,
  guardhousePayrollPlan,
  guardhousePayPriorityLabel,
  normalizeGuardhousePayPriority,
} from '../../security/guardhousePayrollPolicy.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  guardRecoveryRemainingDays,
  type CombatAgentState,
} from '../../security/combatAgents.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderGuardhouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const fireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  );
  const suspendedByFire = fireDisabled.has(building.id);
  const equippedGuards = armedGuardCount(building.assignedLabor, building.polearms);
  const companyAgents = [...(context.combatAgents ?? [])].filter((agent) =>
    agent.faction === 'guard' && agent.sourceBuildingId === building.id);
  const woundedAgents = companyAgents.filter(isWoundedGuard);
  const fieldedGuards = companyAgents.length - woundedAgents.length;
  const casualtyLaborFloor = woundedAgents.reduce(
    (floor, agent) => Math.max(floor, agent.sourceSlot + 1),
    0,
  );
  const fitEquippedGuards = Math.max(0, equippedGuards - woundedAgents.length);
  const armed = suspendedByFire ? 0 : fitEquippedGuards;
  const readiness = suspendedByFire
    ? 0
    : Math.max(0, Math.min(1, building.actionCooldown));
  const ready = armed * readiness;
  const settlement = context.getSettlementSecurity?.();
  const frontierAlert = settlement
    ? isFrontierAlertActive(
        settlement,
        context.conflictEnabled === true,
        gameClock(context.gameState.tick).month,
      )
    : false;
  const settlementReady = settlement?.readyGuards ?? ready;
  const guardRequirement = settlement?.guardsRequired ?? 0;
  // Casualties still occupy the roster and consume company support while
  // unavailable for a later muster.
  const supportedGuards = suspendedByFire ? 0 : equippedGuards;
  const dailyFood = supportedGuards * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  const dailyWages = supportedGuards * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
  const payrollInTransit = guardhousePayrollInTransitGold(
    context.gameState.deliveryTrips.values(),
  );
  const payroll = guardhousePayrollPlan(
    context.gameState.buildings.values(),
    context.resourceTotals.gold,
    fireDisabled,
    payrollInTransit,
  ).find((entry) => entry.building.id === building.id);
  const payrollLogistics = guardhousePayrollLogisticsPlan({
    guardhouse: building,
    buildings: context.gameState.buildings.values(),
    trips: context.gameState.deliveryTrips.values(),
    physicalEconomy: context.gameState.physicalFoundingSiteEnabled === true,
    freeHaulers: context.populationStats.available,
    getRoadPathDistance: (ax, az, bx, bz) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
  });
  const companyPriority = normalizeGuardhousePayPriority(building.guardhousePayPriority);
  const foodReserve = normalizeGuardhouseFoodReserve(building.guardhouseFoodReserve);
  const foodTarget = guardhouseFoodTarget(
    suspendedByFire ? 0 : building.assignedLabor,
    building.polearms,
    foodReserve,
  );
  const targetRunwayDays = dailyFood > 1e-9
    ? foodTarget / dailyFood
    : Number.POSITIVE_INFINITY;
  const foodRunwayDays = dailyFood > 1e-9
    ? Math.max(0, building.food) / dailyFood
    : Number.POSITIVE_INFINITY;
  const orderedMusterPostId = normalizeGuardhouseMusterWatchtowerId(
    building.guardhouseMusterWatchtowerId,
  );
  const musterPostOptions = guardhouseMusterPostOptions(
    building,
    context,
    fireDisabled,
  );
  const muster = getGuardhouseMusterState(
    building,
    context.gameState,
    (ax, az, bx, bz) => context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    context.worldQueries.getRoadConditionSpeedMultiplier(),
    new Map(
      musterPostOptions.map((option) => [
        option.tower.id,
        option.routeDistance,
      ]),
    ),
  );
  const effectiveReady = armed * readiness * muster.efficiency;
  const recoveryFeedback = formatGuardRecoveryFeedback(
    woundedAgents,
    context.gameState.tick,
  );
  const orderedMusterPost = orderedMusterPostId === null
    ? null
    : musterPostOptions.find((option) => option.tower.id === orderedMusterPostId)
      ?? null;
  const linkedWatchButton = muster.linkedTowerId
    ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${muster.linkedTowerId}" aria-label="Inspect linked watchtower">Inspect watch</button>`
    : '';
  const musterResponseBand = guardhouseMusterResponseBand(muster.efficiency);
  const musterRouteFeedback = musterResponseBand === 'full'
    ? 'green route · full response'
    : musterResponseBand === 'delayed'
      ? 'amber route · delayed response'
      : 'red route · weak response';
  const roadConditionFeedback = muster.routeDistance != null
    && muster.responseDistance != null
    && muster.roadSpeedMultiplier < 0.999
    ? `${Math.round(muster.roadSpeedMultiplier * 100)}% travel pace · ${Math.round(muster.routeDistance)} m responds like ${Math.round(muster.responseDistance)} m`
    : suspendedByFire
      ? 'Fire outage · no watch response'
      : 'Dry or firm road · normal response distance';

  const missingMusterRoute = orderedMusterPostId === null
    ? 'No staffed tower by road'
    : orderedMusterPost === null
      ? 'Ordered watch no longer exists; automatic reassignment suspended'
      : orderedMusterPost.fireDisabled
        ? 'Ordered watch is in fire recovery; automatic reassignment suspended'
        : orderedMusterPost.tower.assignedLabor <= 0
          ? 'Ordered watch is unstaffed; automatic reassignment suspended'
          : 'Ordered watch route severed; automatic reassignment suspended';

  const status = suspendedByFire
    ? ['Fire outage — company cannot muster', 'warning'] as const
    : building.assignedLabor <= 0
    ? ['Unstaffed — no guards can muster', 'warning'] as const
    : equippedGuards <= 0
      ? ['Unarmed — awaiting carpenter-made polearms', 'warning'] as const
      : woundedAgents.length > 0
        ? [
            `${woundedAgents.length} wounded — ${fitEquippedGuards} fit for muster`,
            'warning',
          ] as const
      : foodRunwayDays < 1
        ? ['Short on provisions — readiness is falling', 'warning'] as const
        : isPayrollLogisticsBlocked(payrollLogistics.status)
          ? [payrollLogisticsStatus(payrollLogistics.status), 'warning'] as const
        : payrollLogistics.onsiteRunwayDays < 1
          ? [
              payrollLogistics.inTransitGold > 1e-6
                ? 'Pay chest empty — treasury lockbox is still on the road'
                : 'Pay chest empty — readiness is falling',
              'warning',
            ] as const
        : payroll && payroll.fundedRatio < 0.999
          ? [
              `Payroll shortfall — ${Math.round(payroll.fundedRatio * 100)}% of next-day wages funded after higher priorities`,
              'warning',
            ] as const
          : foodRunwayDays < PROVISION_WARNING_DAYS
            ? [`Provision reserve low — ${formatProvisionRunway(foodRunwayDays)} on site`, 'warning'] as const
            : frontierAlert && armed > 0 && muster.linkedTowerId
              ? [
                  `Muster underway — ${armed} equipped ${armed === 1 ? 'guard is' : 'guards are'} marching to the linked watch`,
                  'active',
                ] as const
            : readiness < 0.99
              ? ['Drilling and mustering', 'active'] as const
              : muster.efficiency < 0.999
                ? [
                    muster.routeDistance == null
                      ? 'No staffed tower link — company cannot reinforce a warned district'
                      : muster.responseDistance != null
                        && muster.routeDistance <= GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE
                        && muster.responseDistance > GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE
                        ? `Soft-road delay — ${Math.round(muster.efficiency * 100)}% effective`
                        : `Long watch route — ${Math.round(muster.efficiency * 100)}% effective`,
                    'warning',
                  ] as const
                : guardRequirement > 0 && settlementReady + 1e-6 < guardRequirement
                  ? [`Company ready — settlement needs ${(guardRequirement - settlementReady).toFixed(1)} more guards`, 'warning'] as const
                  : ['Guard company ready', 'ok'] as const;

  const labor = buildingLaborView(
    building,
    context.populationStats,
    context.worldQueries,
  );
  if (woundedAgents.length > 0) {
    labor.decreaseDisabled = building.assignedLabor <= casualtyLaborFloor;
    labor.hint += ` Wounded guards retain their roster positions; assignments through slot ${casualtyLaborFloor} cannot be released until recovery.`;
  }

  return {
    eyebrow: 'Frontier defense',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Paid local guard company mustered by the watch</span></li>
      ${woundedAgents.length > 0 ? `<li><span>Wounded company</span><span>${recoveryFeedback}</span></li>` : ''}
      ${fieldedGuards > 0 ? `<li><span>In the field</span><span>${fieldedGuards} guard${fieldedGuards === 1 ? '' : 's'} physically deployed</span></li>` : ''}
      <li><span>Fit for muster</span><span>${fitEquippedGuards} of ${equippedGuards} equipped guards available</span></li>
      <li><span>Armed guards</span><span>${equippedGuards} / ${building.assignedLabor} equipped${suspendedByFire ? ' · unavailable during fire recovery' : ''}</span></li>
      <li><span>Local readiness</span><span>${Math.round(readiness * 100)}% · ${ready.toFixed(1)} ready</span></li>
      <li><span>Muster order</span><span>${orderedMusterPostId === null ? 'Nearest staffed watch by road' : `Hold for Watch #${orderedMusterPostId} unless the order is changed`}</span></li>
      <li><span>Watch muster</span><span>${muster.routeDistance == null ? `${missingMusterRoute}; no district reinforcement` : `${Math.round(muster.routeDistance)} m by road · ${Math.round(muster.efficiency * 100)}% · ${musterRouteFeedback}${linkedWatchButton}`}</span></li>
      <li><span>Alert posture</span><span>${frontierAlert ? muster.linkedTowerId && armed > 0 ? `${armed} equipped ${armed === 1 ? 'guard' : 'guards'} taking the linked watch road, then breaking cross-country for nearby or active attacks` : 'Frontier alert active, but this company has no equipped road-linked response' : 'Ordinary drill at the guardhouse until raiders are reported during campaign season'}</span></li>
      <li><span>Road conditions</span><span>${roadConditionFeedback}</span></li>
      <li><span>Effective company</span><span>${effectiveReady.toFixed(1)} guards after casualties, signal, and travel</span></li>
      <li><span>Settlement defense</span><span>${settlementReady.toFixed(1)}${guardRequirement > 0 ? ` / ${guardRequirement.toFixed(1)} required` : ''}</span></li>
      <li><span>Projected raid</span><span>${settlement ? formatFrontierForecast(settlement, context.enemyPressure) : 'Awaiting frontier reports'}</span></li>
      <li><span>Daily upkeep</span><span>${dailyFood.toFixed(1)} food · ${dailyWages.toFixed(1)} gold</span></li>
      <li><span>Food endurance</span><span>${building.food.toFixed(1)} on site · ${formatProvisionRunway(foodRunwayDays)}</span></li>
      <li><span>Ration policy</span><span>${guardhouseFoodReserveLabel(foodReserve)} · ${foodReserve} food per armed guard</span></li>
      <li><span>Company priority</span><span>${guardhousePayPriorityLabel(companyPriority)} · scarce polearms, routine provisions, and wages</span></li>
      <li><span>Next-day wages</span><span>${suspendedByFire ? 'Suspended during fire recovery' : payroll ? `${payroll.fundedGold.toFixed(1)} / ${payroll.dailyWage.toFixed(1)} funded · claim ${payroll.claimPosition} of ${payroll.companyCount}` : armed > 0 ? 'Awaiting payroll forecast' : 'No armed guards to pay'}</span></li>
      <li><span>Pay chest</span><span>${payrollLogistics.onsiteGold.toFixed(1)} / ${payrollLogistics.targetGold.toFixed(1)} gold · ${formatProvisionRunway(payrollLogistics.onsiteRunwayDays)} on site</span></li>
      <li><span>Payroll route</span><span>${payrollLogisticsFeedback(payrollLogistics, context)}</span></li>
      <li><span>Treasury wages</span><span>${context.resourceTotals.gold.toFixed(1)} spendable gold across all company claims</span></li>
      <li><span>Provision target</span><span>${suspendedByFire ? 'Suspended until fire recovery' : armed > 0 ? `${foodTarget.toFixed(1)} food · ${formatProvisionRunway(targetRunwayDays)} when full · central granary intervenes below ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS} days` : 'None until polearms arm the company'}</span></li>
      <li><span>Provision priority</span><span>Producer and granary carts preserve household delivery reserves</span></li>
      <li><span>Supply chain</span><span>Food by road · polearms from a staffed carpenter · pay lockboxes from a civic treasury · ironwork imported at a staffed market</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: woundedAgents.length > 0
      ? {
          visible: false,
          hint: 'The guardhouse must remain standing while wounded guards recuperate here.',
        }
      : { visible: true, hint: buildingDemolishHint(building.kind) },
    labor,
    supplementalPanelHtml: `${renderMusterPostPanel(
      orderedMusterPostId,
      musterPostOptions,
    )}${renderRationReservePanel(foodReserve)}${renderCompanyPriorityPanel(companyPriority)}`,
  };
}

function isWoundedGuard(agent: CombatAgentState): boolean {
  return agent.status === 'downed'
    || agent.status === 'wounded-returning'
    || agent.status === 'recovering';
}

function formatGuardRecoveryFeedback(
  agents: readonly CombatAgentState[],
  simTick: number,
): string {
  const downed = agents.filter((agent) => agent.status === 'downed').length;
  const returning = agents.filter(
    (agent) => agent.status === 'wounded-returning',
  ).length;
  const recovering = agents.filter(
    (agent) => agent.status === 'recovering',
  );
  const parts = [
    downed > 0 ? `${downed} awaiting evacuation` : '',
    returning > 0 ? `${returning} limping back` : '',
    recovering.length > 0 ? `${recovering.length} recuperating on site` : '',
  ].filter(Boolean);
  if (recovering.length > 0) {
    const remainingDays = Math.max(
      ...recovering.map((agent) =>
        guardRecoveryRemainingDays(agent, simTick)),
    );
    parts.push(
      remainingDays < 1
        ? 'under one day to full recovery'
        : `up to ${Math.ceil(remainingDays)} days to full recovery`,
    );
  }
  return parts.join(' · ');
}

type MusterPostOption = {
  tower: BuildingState;
  routeDistance: number | null;
  fireDisabled: boolean;
};

function guardhouseMusterPostOptions(
  guardhouse: BuildingState,
  context: InspectorRenderContext,
  fireDisabled: ReadonlySet<string>,
): MusterPostOption[] {
  const towers = [...context.gameState.buildings.values()]
    .filter((candidate) =>
      candidate.kind === 'watchtower'
      && candidate.constructionComplete !== false);
  if (towers.length === 0) return [];

  const distances = context.worldQueries
    .getRoadNetworkSnapshot()
    .getPathfinder()
    .roadPathDistancesFrom(
      guardhouse.x,
      guardhouse.z,
      towers.map((tower) => ({ x: tower.x, z: tower.z })),
    );
  return towers
    .map((tower, index) => ({
      tower,
      routeDistance: distances[index] ?? null,
      fireDisabled: fireDisabled.has(tower.id),
    }))
    .sort((left, right) => {
      if (left.routeDistance === null) {
        if (right.routeDistance !== null) return 1;
      } else if (right.routeDistance === null) {
        return -1;
      } else if (Math.abs(left.routeDistance - right.routeDistance) > 1e-6) {
        return left.routeDistance - right.routeDistance;
      }
      return left.tower.id.localeCompare(right.tower.id, undefined, {
        numeric: true,
      });
    });
}

function renderMusterPostPanel(
  orderedMusterPostId: string | null,
  options: readonly MusterPostOption[],
): string {
  const automatic = `<button type="button" class="resource-action-button" data-guardhouse-muster-watchtower="auto" ${orderedMusterPostId === null ? 'disabled' : ''}>Nearest staffed watch</button>`;
  const posts = options.map((option) => {
    const route = option.routeDistance === null
      ? 'no road'
      : `${Math.round(option.routeDistance)} m`;
    const state = option.fireDisabled
      ? 'fire outage'
      : option.tower.assignedLabor <= 0
        ? 'unstaffed'
        : `${option.tower.assignedLabor} watch${option.tower.assignedLabor === 1 ? 'man' : 'men'}`;
    return `<button type="button" class="resource-action-button" data-guardhouse-muster-watchtower="${option.tower.id}" title="${route} by road · ${state}" ${orderedMusterPostId === option.tower.id ? 'disabled' : ''}>Watch #${option.tower.id} · ${route}</button>`;
  }).join('');
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Muster post — leave the company on its nearest staffed road-linked watch, or bind it to one completed post. An explicit order can reinforce a chosen district, but it keeps waiting when that watch is unstaffed, burning, or cut off instead of quietly moving elsewhere.</p>
      <div class="resource-action-row">${automatic}${posts}</div>
      <p class="inspector-action-panel__hint">${options.length === 0 ? 'Complete a watchtower before issuing a company order.' : 'Long and weather-softened routes reduce the company strength that arrives in time. Hover a post for staffing and outage state.'}</p>
    </div>
  `;
}

function renderRationReservePanel(currentReserve: number): string {
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Company ration reserve — choose how much fresh food producers and emergency granary carts try to keep at this guardhouse. The twelve-food minimum keeps a practical cart lot at very small posts.</p>
      <div class="resource-action-row">${GUARDHOUSE_FOOD_RESERVES
        .map((candidate) => `<button type="button" class="resource-action-button" data-guardhouse-food-reserve="${candidate.reservePerGuard}" title="${candidate.hint}" ${candidate.reservePerGuard === currentReserve ? 'disabled' : ''}>${candidate.label} · ${candidate.reservePerGuard}/guard</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Lean reserves release perishable food and haulage capacity to households. Deep reserves can bridge a disrupted frontier route, but they lock up more fresh food here and expose it to ordinary spoilage and plunder.</p>
    </div>
  `;
}

function renderCompanyPriorityPanel(currentPriority: number): string {
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Company priority — high-priority guardhouses claim scarce carpenter-made polearms, routine food sources, and treasury wages before lower tiers. Emergency granary food still goes to the armed company with the lowest runway.</p>
      <div class="resource-action-row">${GUARDHOUSE_PAY_PRIORITIES
        .map((candidate) => `<button type="button" class="resource-action-button" data-guardhouse-pay-priority="${candidate.priority}" ${candidate.priority === currentPriority ? 'disabled' : ''}>${candidate.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Within one tier, polearms restore the lowest armed share first, then prefer the shorter road and stable building order. Payroll uses stable building order: a free hauler refills the local chest to ten days once it falls below five. The forecast allocates one day of current treasury and secured company gold with no new income.</p>
    </div>
  `;
}

function isPayrollLogisticsBlocked(
  status: ReturnType<typeof guardhousePayrollLogisticsPlan>['status'],
): boolean {
  return status === 'no-treasury'
    || status === 'no-gold'
    || status === 'no-road'
    || status === 'no-hauler'
    || status === 'treasury-busy';
}

function payrollLogisticsStatus(
  status: ReturnType<typeof guardhousePayrollLogisticsPlan>['status'],
): string {
  switch (status) {
    case 'no-treasury': return 'No civic treasury can dispatch company pay';
    case 'no-gold': return 'Treasury empty — company pay cannot be dispatched';
    case 'no-road': return 'Payroll route severed — no treasury lockbox can reach this company';
    case 'no-hauler': return 'Payroll waiting — no free hauler can leave the treasury';
    case 'treasury-busy': return 'Payroll waiting — reachable treasury carts are already committed';
    default: return 'Payroll logistics ready';
  }
}

function payrollLogisticsFeedback(
  plan: ReturnType<typeof guardhousePayrollLogisticsPlan>,
  context: InspectorRenderContext,
): string {
  const sourceLabel = plan.source
    ? context.worldQueries.getBuildingLabel(plan.source.kind)
    : 'civic treasury';
  const route = plan.routeDistance === null ? '' : ` · ${Math.round(plan.routeDistance)} m by road`;
  const inspectTrip = plan.activeTrip
    ? ` <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${plan.activeTrip.id}" aria-label="Inspect incoming payroll cart">Inspect cart</button>`
    : '';
  switch (plan.status) {
    case 'inactive': return 'No armed guards require pay';
    case 'legacy': return 'Legacy abstract treasury settlement';
    case 'stocked':
      return `Local chest above ${GUARDHOUSE_PAYROLL_REORDER_DAYS}-day reorder · next refill to ${GUARDHOUSE_PAYROLL_TARGET_DAYS} days`;
    case 'en-route':
      return `${plan.inTransitGold.toFixed(1)} gold from ${sourceLabel}${route}${inspectTrip}`;
    case 'ready':
      return `${plan.cartLoad.toFixed(1)} gold ready at ${sourceLabel}${route}`;
    default:
      return `${payrollLogisticsStatus(plan.status)}${route}`;
  }
}
