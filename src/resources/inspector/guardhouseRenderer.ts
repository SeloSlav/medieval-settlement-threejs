import { getBuildingCost } from '../buildingEconomy.ts';
import {
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE,
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
  normalizeGuardhouseFoodReserve,
} from '../../security/frontierSecurity.ts';
import {
  GUARDHOUSE_PAY_PRIORITIES,
  guardhousePayrollPlan,
  guardhousePayPriorityLabel,
  normalizeGuardhousePayPriority,
} from '../../security/guardhousePayrollPolicy.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import type { InspectableTarget } from '../types.ts';
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
  const armed = suspendedByFire ? 0 : equippedGuards;
  const readiness = suspendedByFire
    ? 0
    : Math.max(0, Math.min(1, building.actionCooldown));
  const ready = armed * readiness;
  const muster = getGuardhouseMusterState(
    building,
    context.gameState,
    (ax, az, bx, bz) => context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    context.worldQueries.getRoadConditionSpeedMultiplier(),
  );
  const settlement = context.getSettlementSecurity?.();
  const settlementReady = settlement?.readyGuards ?? ready;
  const guardRequirement = settlement?.guardsRequired ?? 0;
  const dailyFood = armed * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  const dailyWages = armed * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
  const payroll = guardhousePayrollPlan(
    context.gameState.buildings.values(),
    context.resourceTotals.gold,
    fireDisabled,
  ).find((entry) => entry.building.id === building.id);
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

  const status = suspendedByFire
    ? ['Fire outage — company cannot muster', 'warning'] as const
    : building.assignedLabor <= 0
    ? ['Unstaffed — no guards can muster', 'warning'] as const
    : armed <= 0
      ? ['Unarmed — awaiting carpenter-made polearms', 'warning'] as const
      : foodRunwayDays < 1
        ? ['Short on provisions — readiness is falling', 'warning'] as const
        : payroll && payroll.fundedRatio < 0.999
          ? [
              `Payroll shortfall — ${Math.round(payroll.fundedRatio * 100)}% of next-day wages funded after higher priorities`,
              'warning',
            ] as const
          : foodRunwayDays < PROVISION_WARNING_DAYS
            ? [`Provision reserve low — ${formatProvisionRunway(foodRunwayDays)} on site`, 'warning'] as const
            : readiness < 0.99
              ? ['Drilling and mustering', 'active'] as const
              : muster.efficiency < 0.999
                ? [
                    muster.routeDistance == null
                      ? `No staffed tower link — ${Math.round(muster.efficiency * 100)}% local response`
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

  return {
    eyebrow: 'Frontier defense',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Paid local guard company mustered by the watch</span></li>
      <li><span>Armed guards</span><span>${equippedGuards} / ${building.assignedLabor} equipped${suspendedByFire ? ' · unavailable during fire recovery' : ''}</span></li>
      <li><span>Local readiness</span><span>${Math.round(readiness * 100)}% · ${ready.toFixed(1)} ready</span></li>
      <li><span>Watch muster</span><span>${muster.routeDistance == null ? `No staffed tower by road · ${Math.round(muster.efficiency * 100)}% local response` : `${Math.round(muster.routeDistance)} m by road · ${Math.round(muster.efficiency * 100)}% · ${musterRouteFeedback}${linkedWatchButton}`}</span></li>
      <li><span>Road conditions</span><span>${roadConditionFeedback}</span></li>
      <li><span>Effective company</span><span>${muster.effectiveReady.toFixed(1)} guards after signal and travel</span></li>
      <li><span>Settlement defense</span><span>${settlementReady.toFixed(1)}${guardRequirement > 0 ? ` / ${guardRequirement.toFixed(1)} required` : ''}</span></li>
      <li><span>Projected raid</span><span>${settlement ? formatFrontierForecast(settlement, context.enemyPressure) : 'Awaiting frontier reports'}</span></li>
      <li><span>Daily upkeep</span><span>${dailyFood.toFixed(1)} food · ${dailyWages.toFixed(1)} gold</span></li>
      <li><span>Food endurance</span><span>${building.food.toFixed(1)} on site · ${formatProvisionRunway(foodRunwayDays)}</span></li>
      <li><span>Ration policy</span><span>${guardhouseFoodReserveLabel(foodReserve)} · ${foodReserve} food per armed guard</span></li>
      <li><span>Company priority</span><span>${guardhousePayPriorityLabel(companyPriority)} · scarce polearms, routine provisions, and wages</span></li>
      <li><span>Next-day wages</span><span>${suspendedByFire ? 'Suspended during fire recovery' : payroll ? `${payroll.fundedGold.toFixed(1)} / ${payroll.dailyWage.toFixed(1)} funded · claim ${payroll.claimPosition} of ${payroll.companyCount}` : armed > 0 ? 'Awaiting payroll forecast' : 'No armed guards to pay'}</span></li>
      <li><span>Treasury wages</span><span>${context.resourceTotals.gold.toFixed(1)} gold available across all companies</span></li>
      <li><span>Provision target</span><span>${suspendedByFire ? 'Suspended until fire recovery' : armed > 0 ? `${foodTarget.toFixed(1)} food · ${formatProvisionRunway(targetRunwayDays)} when full · central granary intervenes below ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS} days` : 'None until polearms arm the company'}</span></li>
      <li><span>Provision priority</span><span>Producer and granary carts preserve household delivery reserves</span></li>
      <li><span>Supply chain</span><span>Food by road · polearms from a staffed carpenter · ironwork imported at a staffed market</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `${renderRationReservePanel(foodReserve)}${renderCompanyPriorityPanel(companyPriority)}`,
  };
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
      <p class="inspector-action-panel__hint">Within one tier, polearms restore the lowest armed share first, then prefer the shorter road and stable building order. Payroll uses stable building order. The forecast allocates one day of current treasury gold with no new income; food shortages can still reduce readiness even when wages are funded.</p>
    </div>
  `;
}
