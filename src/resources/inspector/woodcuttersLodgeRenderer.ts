import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import {
  LODGE_FIREWOOD_PER_CYCLE,
  LODGE_TIMBER_PER_CYCLE,
} from '../../generated/gameBalance.ts';
import type { InspectableTarget } from '../types.ts';
import {
  formatFirewoodRunwayDays,
  formatLodgeCrewSplit,
  lodgeDeliveryIntervalSeconds,
  lodgeFirewoodPerDelivery,
  lodgeLaborSplit,
  residenceFirewoodRunwayDays,
} from '../resourceTotals.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Ready';
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds.toFixed(1)}s`;
}

export function renderWoodcuttersLodgeInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const crew = lodgeLaborSplit(building.assignedLabor);
  const crewLabel = formatLodgeCrewSplit(crew);
  const connectedMills = context.worldQueries.getRoadConnectedMills(building);
  const claimedResidences = context.worldQueries.getClaimedResidencesForLodge(building);
  const nextDeliveryTarget = context.worldQueries.getNextDeliveryTargetForLodge(building);
  const nextTargetRunway = nextDeliveryTarget ? residenceFirewoodRunwayDays(nextDeliveryTarget) : null;
  const nextTargetLabel = nextDeliveryTarget
    ? `Parcel #${nextDeliveryTarget.parcelIndex + 1}${nextTargetRunway != null ? ` (${formatFirewoodRunwayDays(nextTargetRunway)} left)` : ''}`
    : 'None needing fuel';
  const millsWithTimber = connectedMills.filter((mill) => mill.timber > 0).length;
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const deliveryInterval = lodgeDeliveryIntervalSeconds(crew.delivering);
  const firewoodPerTrip = lodgeFirewoodPerDelivery(crew.delivering);
  const processingWorkers = crew.alternates ? 1 : crew.processing;
  const timberPerCycle = LODGE_TIMBER_PER_CYCLE * processingWorkers;
  const firewoodPerCycle = LODGE_FIREWOOD_PER_CYCLE * processingWorkers;
  const canDeliver = crew.delivering > 0 && onRoad && building.firewood > 0 && nextDeliveryTarget != null;
  const deliveringSoon = canDeliver && building.deliveryCooldown <= 0.1;
  const onDeliveryCooldown = building.deliveryCooldown > 0.1;

  let statusText: string;
  let statusState: string;
  if (!onRoad) {
    statusText = 'Not connected — place near a road and link with paths';
    statusState = 'idle';
  } else if (building.assignedLabor === 0) {
    statusText = 'Idle — assign lodge workers to process timber and run deliveries';
    statusState = 'idle';
  } else if (connectedMills.length === 0) {
    statusText = 'No road-linked lumber mills — connect a mill by road';
    statusState = 'warning';
  } else if (millsWithTimber === 0 && building.timber <= 0) {
    statusText = 'Road-linked mills have no timber yet';
    statusState = 'warning';
  } else if (claimedResidences.length === 0) {
    statusText = 'No residences claimed on this road branch';
    statusState = 'warning';
  } else if (crew.alternates && onDeliveryCooldown) {
    statusText = nextDeliveryTarget
      ? `Deliverer on trip — next run in ${formatCooldown(building.deliveryCooldown)} → ${nextTargetLabel}`
      : `Deliverer on trip — next run in ${formatCooldown(building.deliveryCooldown)}`;
    statusState = 'active';
  } else if (building.firewood <= 0 && building.timber <= 0) {
    statusText = `Pulling timber from ${millsWithTimber} nearest mill${millsWithTimber === 1 ? '' : 's'} by road`;
    statusState = 'active';
  } else if (building.firewood <= 0) {
    statusText = crew.alternates
      ? 'Processing timber — lone worker alternates with delivery runs'
      : `Processing timber into firewood (${crew.processing} at lodge)`;
    statusState = 'active';
  } else if (onDeliveryCooldown) {
    statusText = nextDeliveryTarget
      ? `Deliverer on trip — next run in ${formatCooldown(building.deliveryCooldown)} → ${nextTargetLabel}`
      : `Next delivery in ${formatCooldown(building.deliveryCooldown)} — all claimed homes stocked`;
    statusState = 'active';
  } else if (deliveringSoon) {
    statusText = nextDeliveryTarget
      ? `Dispatching firewood to ${nextTargetLabel} (${firewoodPerTrip} per trip)`
      : `No claimed residences need firewood right now`;
    statusState = nextDeliveryTarget ? 'active' : 'idle';
  } else {
    statusText = `Serving ${claimedResidences.length} claimed residence${claimedResidences.length === 1 ? '' : 's'} on this branch`;
    statusState = 'active';
  }

  const nearestMill = connectedMills[0];
  const nearestMillDistance = nearestMill
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestMill.x, nearestMill.z)
    : null;
  const millSummary = connectedMills.length === 0
    ? 'None'
    : `${connectedMills.length} by road${nearestMillDistance != null ? ` (nearest ${nearestMillDistance.toFixed(0)} m)` : ''}`;
  const residenceSummary = claimedResidences.length === 0
    ? 'None on branch'
    : `${claimedResidences.length} claimed`;

  const deliveryRow = crew.delivering > 0
    ? `<li><span>Next delivery</span><span>${nextTargetLabel}</span></li>
      <li><span>Delivery timer</span><span>${formatCooldown(building.deliveryCooldown)} / ${deliveryInterval.toFixed(1)}s</span></li>
      <li><span>Firewood per trip</span><span>${firewoodPerTrip}</span></li>`
    : `<li><span>Delivery</span><span>Paused — no lodge workers</span></li>`;

  const processOutputLabel = building.assignedLabor > 0
    ? crew.alternates
      ? `${firewoodPerCycle} firewood from ${timberPerCycle} timber when processing`
      : `${firewoodPerCycle} firewood from ${timberPerCycle} timber`
    : `up to ${LODGE_FIREWOOD_PER_CYCLE * definition.maxLabor} firewood (${definition.maxLabor} workers)`;

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState,
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Crew split</span><span>${crewLabel}</span></li>
      <li><span>Road-linked mills</span><span>${millSummary}</span></li>
      <li><span>Claimed residences</span><span>${residenceSummary}</span></li>
      <li><span>Process interval</span><span>${definition.harvestInterval}s</span></li>
      <li><span>Output per cycle</span><span>${processOutputLabel}</span></li>
      ${deliveryRow}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
