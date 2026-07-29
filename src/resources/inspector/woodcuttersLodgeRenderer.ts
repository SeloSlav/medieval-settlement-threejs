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
import { computeUnreservedBuildingTimber } from '../resourceTotals.ts';
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
import {
  formatTripBuildingDestinationLabel,
  formatTripDestinationLabel,
  formatTripPhaseLabel,
  tripRemainingSeconds,
} from '../../logistics/deliveryTrips.ts';
import {
  normalizeWoodcutterTimberReserve,
  timberAboveWoodcutterReserve,
  WOODCUTTER_TIMBER_RESERVE_PRESETS,
} from '../../economy/woodcutterPolicy.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';

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
  const claimedResidences = context.worldQueries.getClaimedResidencesForFirewoodSupplier(building);
  const nextDeliveryTarget = context.worldQueries.getNextFirewoodDeliveryTarget(building);
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
  const activeTripDistance = activeTrip
    ? context.worldQueries.getActiveTripPathDistance(activeTrip)
    : null;
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const industrialDispatch = building.assignedLabor > 0 && building.firewood > 1e-6
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'firewood')
    : null;
  const activeBuildingDestination = activeTrip?.cargoKind === 'firewood'
    && activeTrip.destinationKind === 'building'
    && activeTrip.targetBuildingId != null
    ? context.worldQueries.getBuilding(activeTrip.targetBuildingId)
    : null;
  const industrialTarget = industrialDispatch?.target ?? activeBuildingDestination;
  const industrialTargetName = industrialTarget
    ? context.worldQueries.getBuildingLabel(industrialTarget.kind)
    : 'industry';
  const industrialTargetLabel = industrialDispatch
    ? `${industrialTargetName} (${staffingPriorityLabel(industrialDispatch.workPriority).toLowerCase()} priority, ${industrialDispatch.runwayCycles.toFixed(1)} cycles)`
    : industrialTargetName;
  const hasIndustrialTarget = industrialTarget != null;
  const activeResidenceDestination = formatTripDestinationLabel(
    activeTrip,
    (id) => context.worldQueries.getResidence(id),
    nextTargetLabel,
  );
  const activeDestinationLabel = formatTripBuildingDestinationLabel(
    activeTrip,
    (kind) => context.worldQueries.getBuildingLabel(kind),
    (id) => context.worldQueries.getBuilding(id),
    activeResidenceDestination,
  );
  const inboundTimberTrip = context.worldQueries.getInboundTimberTrip(building);
  const timberTripRemaining = inboundTimberTrip
    ? tripRemainingSeconds(
      inboundTimberTrip,
      context.worldQueries.getActiveTripPathDistance(inboundTimberTrip),
    )
    : null;
  const processingWorkers = lodgeLaborAlternates(building.assignedLabor) ? 1 : crew.processing;
  const timberPerCycle = LODGE_TIMBER_PER_CYCLE * processingWorkers;
  const firewoodPerCycle = LODGE_FIREWOOD_PER_CYCLE * processingWorkers;
  const timberReserve = normalizeWoodcutterTimberReserve(building.woodcutterTimberReserve ?? 0);
  const availableUnreservedTimber = computeUnreservedBuildingTimber(context.gameState);
  const timberAboveReserve = timberAboveWoodcutterReserve(
    availableUnreservedTimber,
    timberReserve,
  );
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
    inboundTimberTrip,
    timberTripRemainingSeconds: timberTripRemaining,
    nextTargetLabel,
    activeDestinationLabel,
    hasNextTarget: nextDeliveryTarget != null,
    hasIndustrialTarget,
    industrialTargetLabel,
    firewoodPerTrip,
    canDeliver,
    availableUnreservedTimber,
    timberReserve,
    timberPerCycle,
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
  const industrialFuelDuty = industrialDispatch
    ? `${context.worldQueries.getBuildingLabel(industrialDispatch.target.kind)} · ${staffingPriorityLabel(industrialDispatch.workPriority)} priority · ${industrialDispatch.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(industrialDispatch.routeDistance)}`
    : activeBuildingDestination
      ? `Cart committed to ${context.worldQueries.getBuildingLabel(activeBuildingDestination.kind)}`
      : 'No staffed workshop currently requests surplus fuel';

  const deliveryRow = crew.delivering > 0
    ? `<li><span>Next delivery</span><span>${activeDestinationLabel}</span></li>
      <li><span>Road distance</span><span>${formatDeliveryRoadDistance(activeTripDistance ?? deliveryDistance)}</span></li>
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
      <li><span>Surplus fuel duty</span><span>${nextDeliveryTarget ? `Household cart first · then ${industrialFuelDuty}` : industrialFuelDuty}</span></li>
      <li><span>Process interval</span><span>${definition.harvestInterval}s</span></li>
      <li><span>Output per cycle</span><span>${processOutputLabel}</span></li>
      <li><span>Construction timber floor</span><span>${Math.round(timberReserve)}</span></li>
      <li><span>Unreserved building timber</span><span>${Math.floor(availableUnreservedTimber)} total · ${Math.floor(timberAboveReserve)} above floor</span></li>
      ${deliveryRow}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">This lodge stops hauling and splitting timber before settlement-wide physical stock would fall below its chosen floor. Materials already reserved by active construction sites are protected separately.</p>
        ${WOODCUTTER_TIMBER_RESERVE_PRESETS
          .map((preset) => `<button type="button" class="resource-action-button" data-woodcutter-timber-reserve="${preset.reserve}" ${timberReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
          .join('')}
      </div>
    `,
  };
}
