import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import {
  LODGE_FIREWOOD_PER_CYCLE,
  LODGE_TIMBER_PER_CYCLE,
} from '../../generated/gameBalance.ts';
import {
  formatDeliveryRoadDistance,
  formatDeliveryTripDuration,
} from '../../logistics/deliveryLogistics.ts';
import {
  formatLodgeCrewSplit,
  lodgeFirewoodPerDelivery,
  lodgeLaborAlternates,
  lodgeLaborSplit,
} from '../../logistics/lodgeLogistics.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  formatCooldown,
  formatNextDeliveryTargetLabel,
  resolveWoodcuttersLodgeStatus,
} from './woodcuttersLodgeStatus.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';

export function renderWoodcuttersLodgeInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const crew = lodgeLaborSplit(building.assignedLabor);
  const crewLabel = formatLodgeCrewSplit(crew, building.assignedLabor);
  const connectedMills = context.worldQueries.getRoadConnectedMills(building);
  const claimedResidences = context.worldQueries.getClaimedResidencesForLodge(building);
  const nextDeliveryTarget = context.worldQueries.getNextDeliveryTargetForLodge(building);
  const nextTargetLabel = formatNextDeliveryTargetLabel(nextDeliveryTarget);
  const millsWithTimber = connectedMills.filter((mill) => mill.timber > 0).length;
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const deliveryTripSeconds = context.worldQueries.getLodgeDeliveryTripSeconds(building, nextDeliveryTarget);
  const deliveryDistance = nextDeliveryTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nextDeliveryTarget.x, nextDeliveryTarget.z)
    : null;
  const firewoodPerTrip = lodgeFirewoodPerDelivery(crew.delivering);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const processingWorkers = lodgeLaborAlternates(building.assignedLabor) ? 1 : crew.processing;
  const timberPerCycle = LODGE_TIMBER_PER_CYCLE * processingWorkers;
  const firewoodPerCycle = LODGE_FIREWOOD_PER_CYCLE * processingWorkers;
  const canDeliver = crew.delivering > 0 && onRoad && building.firewood > 0 && nextDeliveryTarget != null && !activeTrip;
  const { statusText, statusState } = resolveWoodcuttersLodgeStatus({
    onRoad,
    assignedLabor: building.assignedLabor,
    connectedMillCount: connectedMills.length,
    millsWithTimber,
    timber: building.timber,
    firewood: building.firewood,
    claimedResidenceCount: claimedResidences.length,
    crew,
    tripRemainingSeconds: tripRemaining,
    activeTrip,
    nextTargetLabel,
    hasNextTarget: nextDeliveryTarget != null,
    firewoodPerTrip,
    canDeliver,
  });

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
    ? `<li><span>Next delivery</span><span>${activeTrip ? `Parcel #${(context.worldQueries.getResidence(activeTrip.residenceId)?.parcelIndex ?? 0) + 1}` : nextTargetLabel}</span></li>
      <li><span>Road distance</span><span>${formatDeliveryRoadDistance(deliveryDistance)}</span></li>
      <li><span>Delivery timer</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} — ${formatCooldown(tripRemaining ?? Infinity)} left` : `Ready / ${formatDeliveryTripDuration(deliveryTripSeconds)}`}</span></li>
      <li><span>Firewood per trip</span><span>${firewoodPerTrip}</span></li>`
    : `<li><span>Delivery</span><span>Paused — no lodge workers</span></li>`;

  const processOutputLabel = building.assignedLabor > 0
    ? lodgeLaborAlternates(building.assignedLabor)
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
