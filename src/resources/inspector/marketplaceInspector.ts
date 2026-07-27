import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { renderMarketplaceTradePanel } from './marketplaceTradeRenderer.ts';
import { formatMarketplaceCaravanCrew } from '../../economy/regionalMarket.ts';
import { marketplaceManualTradeStatus } from '../../economy/marketplaceTrade.ts';
import {
  marketplaceSpecialtyExportPlan,
  marketplaceSpecialtyQueue,
} from '../../economy/specialtyTrade.ts';
import { marketplaceSeedCoveragePlan } from '../../economy/marketplaceSeedCoverage.ts';
import {
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketBranch,
} from '../../economy/settlementHouseholdMarket.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { hasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { gameClock } from '../../world/gameCalendar.ts';

function formatLinkedHomeStatus(connectedHomes: number): string {
  if (connectedHomes <= 0) {
    return 'Caravans awaiting your orders';
  }
  return `Trading with ${connectedHomes} road-linked home${connectedHomes === 1 ? '' : 's'}`;
}

export function renderMarketplaceInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const availability = context.getTradeAvailability?.(building);
  if (!availability) {
    throw new Error('Marketplace inspector requires trade availability.');
  }
  const marketState = context.getMarketState?.();
  if (!marketState) {
    throw new Error('Marketplace inspector requires regional market state.');
  }

  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const connectedHomes = context.worldQueries.countRoadConnectedResidences(building, true);
  const labor = buildingLaborView(building, context.populationStats);
  const hasRoadAccess = context.worldQueries.hasRoadAccess(building.x, building.z);
  const roadSpeedMultiplier = context.worldQueries.getRoadConditionSpeedMultiplier();
  const manualTrade = marketplaceManualTradeStatus(
    building,
    hasRoadAccess,
    roadSpeedMultiplier,
  );
  const brokerCount = Math.max(0, Math.floor(building.assignedLabor));
  const routeCondition = roadSpeedMultiplier < 0.999
    ? `${Math.round(roadSpeedMultiplier * 100)}% caravan pace`
    : 'Firm roads';
  const regionalRoute = brokerCount <= 0
    ? `${routeCondition} · assign a broker to open regional trade`
    : `${routeCondition} · next ${manualTrade.nextCooldownSeconds?.toFixed(1)}s settlement with ${brokerCount} ${brokerCount === 1 ? 'broker' : 'brokers'}`;
  const specialtyPlan = marketplaceSpecialtyExportPlan(
    building,
    marketState.specialtyPriceMult,
  );
  const specialtyQueue = marketplaceSpecialtyQueue(building, marketState.specialtyPriceMult);
  const specialtyExportActive = specialtyQueue.units > 1e-6
    && specialtyPlan.saleAllowed
    && hasRoadAccess
    && specialtyQueue.exportWorkers > 0;
  const specialtyExportHeld = specialtyQueue.units > 1e-6 && !specialtyPlan.saleAllowed;
  const specialtyDesk = formatSpecialtyExportDesk(
    hasRoadAccess,
    building.assignedLabor,
    building.actionCooldown,
    specialtyQueue,
    specialtyPlan,
  );
  const seedCoverage = marketplaceSeedCoveragePlan(
    building,
    context.gameState,
    (_market, farmstead) => context.worldQueries.getRoadPathDistance(
      building.x,
      building.z,
      farmstead.x,
      farmstead.z,
    ),
  );
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const householdMarketPlan = typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
    ? computeSettlementHouseholdMarketPlan({
        state: context.gameState,
        marketState,
        roadNetwork: context.worldQueries.getRoadNetworkSnapshot(),
        clock: gameClock(context.gameState.tick),
        sabbathObserved: parishPolicy.sabbathObservanceEnabled
          && hasStaffedChapel(context.gameState.buildings.values()),
      })
    : null;
  const householdBranch = householdMarketPlan?.branches.get(building.id) ?? null;
  const householdBranchLabel = householdMarketPlan == null
    ? 'Route projection unavailable'
    : formatHouseholdMarketBranch(householdBranch);
  const householdBranchBottleneck = householdBranch == null
    ? 'No assigned household orders'
    : householdBranch.blockedHomes <= 0
      ? 'No critical order blocked'
      : `${householdBranch.blockedHomes} critical orders blocked or waiting - ${householdBranch.cooldownHomes} cooling down`;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: specialtyExportActive
      ? `Brokering specialty exports at ${Math.round(specialtyPlan.marketRate * 100)}% - ${specialtyQueue.unitsPerSecond.toFixed(2)} units/s`
      : specialtyExportHeld
        ? `Holding specialty exports - regional rate ${Math.round(specialtyPlan.marketRate * 100)}%`
      : manualTrade.ready
        ? formatLinkedHomeStatus(connectedHomes)
        : manualTrade.label,
    statusState: specialtyExportActive || (manualTrade.ready && connectedHomes > 0) ? 'ok' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Foreign trade hub — exchange gold and goods with neighboring villages</span></li>
      <li><span>Linked homes</span><span>${connectedHomes}</span></li>
      <li><span>Caravan crew</span><span>${formatMarketplaceCaravanCrew(building.assignedLabor)}</span></li>
      <li><span>Bulk trade desk</span><span>${manualTrade.label}</span></li>
      <li><span>Regional route</span><span>${regionalRoute}</span></li>
      <li><span>Specialty queue</span><span>${specialtyQueue.units.toFixed(1)} units - about ${specialtyQueue.goldValue.toFixed(1)} gold</span></li>
      <li><span>Specialty export desk</span><span>${specialtyDesk}</span></li>
      <li><span>Export stock</span><span>Treasury + road-linked building stores</span></li>
      <li><span>Household reserves</span><span>Protected from exports</span></li>
      <li><span>Backyard sales</span><span>Road-linked homes only</span></li>
      <li><span>Emergency branch</span><span>${householdBranchLabel}</span></li>
      <li><span>Paid-cart queue</span><span>${householdBranchBottleneck}</span></li>
      <li><span>Household orders</span><span>At 18h runway, homes buy a full food-first lot with savings; busy, resting, or blocked carts wait without charging</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor,
    supplementalPanelHtml: renderMarketplaceTradePanel(
      building,
      availability,
      marketState,
      manualTrade,
      context.conflictEnabled,
      seedCoverage,
    ),
  };
}

function formatSpecialtyExportDesk(
  hasRoadAccess: boolean,
  assignedLabor: number,
  actionCooldown: number,
  queue: ReturnType<typeof marketplaceSpecialtyQueue>,
  plan: ReturnType<typeof marketplaceSpecialtyExportPlan>,
): string {
  if (queue.units <= 1e-6) return 'Ready - awaiting ale, honey, wine, or cloth hauls';
  if (!plan.saleAllowed) {
    return `Holding - ${Math.round(plan.marketRate * 100)}% regional rate below ${Math.round(plan.policy.minRate * 100)}% floor`;
  }
  if (!hasRoadAccess) return 'Stalled - connect this market to a road';
  if (assignedLabor <= 0) return 'Stalled - assign at least one broker';
  if (queue.exportWorkers <= 0) {
    return actionCooldown > 1e-6
      ? 'Paused - sole broker is settling a manual trade'
      : 'Stalled - no broker capacity';
  }
  const clearTime = queue.clearSeconds == null
    ? ''
    : ` - clears in about ${queue.clearSeconds.toFixed(1)}s`;
  return `${queue.exportWorkers} broker${queue.exportWorkers === 1 ? '' : 's'} - ${queue.unitsPerSecond.toFixed(2)} units/s at ${Math.round(plan.marketRate * 100)}%${clearTime}`;
}
