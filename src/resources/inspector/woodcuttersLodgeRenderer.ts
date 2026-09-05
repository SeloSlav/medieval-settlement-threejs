import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import {
  formatLodgeCrewSplit,
  lodgeFirewoodPerDelivery,
  lodgeLaborSplit,
} from '../../logistics/lodgeLogistics.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import { buildingSharedStorageRoom } from '../../economy/sharedStorageCapacity.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  civilianToolRows,
  treeCountRows,
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
} from '../../logistics/deliveryTrips.ts';
import {
  forestryWorkAreaDetailRow,
  renderForestryWorkAreaPanel,
} from './treeWorkAreaRenderer.ts';

export function renderWoodcuttersLodgeInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const crew = lodgeLaborSplit(building.assignedLabor, context.populationStats.idle);
  const crewLabel = formatLodgeCrewSplit(crew, building.assignedLabor);
  const claimedResidences = context.worldQueries.getClaimedResidencesForFirewoodSupplier(building);
  const nextDeliveryTarget = context.worldQueries.getNextFirewoodDeliveryTarget(building);
  const nextTargetLabel = formatNextDeliveryTargetLabel(nextDeliveryTarget);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const wood = context.worldQueries.getForestryStock?.(building);
  const activeTripDistance = activeTrip
    ? context.worldQueries.getActiveTripPathDistance(activeTrip)
    : null;
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const industrialDispatch = building.firewood > 1e-6
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
    ? `${industrialTargetName} (${industrialDispatch.runwayCycles.toFixed(1)} cycles onsite)`
    : industrialTargetName;
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
  const firewoodRoom = buildingSharedStorageRoom(building);
  const { statusText, statusState } = resolveWoodcuttersLodgeStatus({
    assignedLabor: building.assignedLabor,
    matureTrees,
    firewood: building.firewood,
    firewoodRoom,
    claimedResidenceCount: claimedResidences.length,
    crew,
    tripRemainingSeconds: tripRemaining,
    activeTrip,
    activeDestinationLabel,
    hasIndustrialTarget: industrialTarget != null,
    industrialTargetLabel,
  });

  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);
  const firewoodPerTrip = lodgeFirewoodPerDelivery(crew.delivering);
  const residenceSummary = 'Lodge → staffed Storehouse → Marketplace stall → abstract household supply';
  const industrialFuelDuty = industrialDispatch
    ? `${context.worldQueries.getBuildingLabel(industrialDispatch.target.kind)} · ${industrialDispatch.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(industrialDispatch.routeDistance)}`
    : activeBuildingDestination
      ? `Cart committed to ${context.worldQueries.getBuildingLabel(activeBuildingDestination.kind)}`
      : 'No staffed workshop currently requests surplus fuel';

  const deliveryRow = activeTrip
    ? `<li><span>Active physical cart</span><span>${activeDestinationLabel}</span></li>
      <li><span>Road distance</span><span>${formatDeliveryRoadDistance(activeTripDistance)}</span></li>
      <li><span>Delivery timer</span><span>${formatTripPhaseLabel(activeTrip.phase)} — ${formatCooldown(tripRemaining ?? Infinity)} left</span></li>
      <li><span>Firewood per trip</span><span>${firewoodPerTrip}</span></li>`
    : industrialTarget
      ? `<li><span>Next physical cart</span><span>${industrialTargetLabel}</span></li>
        <li><span>Household last mile</span><span>None · Storehouses stock Marketplace stalls instead</span></li>`
      : `<li><span>Physical logistics</span><span>Storehouse collection ready; no timber intake required</span></li>
        <li><span>Household last mile</span><span>None · Storehouses stock Marketplace stalls instead</span></li>`;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: activeTrip?.destinationKind === 'forestry'
      ? (activeTrip.phase === 'inbound' ? 'Cart returning split firewood to the lodge' : 'Cart collecting split firewood in the forest')
      : wood?.falling ? 'Tree falling — workers stand clear'
      : wood?.fallen ? 'Workers cutting the fallen trunk into logs'
      : wood?.logs ? 'Splitting fallen logs into firewood'
      : statusText,
    statusState: wood && (wood.logs || wood.fallen || wood.falling) ? 'active' : statusState,
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Labor roles</span><span>${crewLabel}</span></li>
      <li><span>Resource chain</span><span>Fallen logs → split firewood → cart → lodge storage → Storehouse</span></li>
      ${wood ? `<li><span>Shared log stock</span><span>${wood.logs} logs · ${wood.health}/${wood.maxHealth} wood health</span></li>
      <li><span>Cutting site</span><span>${wood.splitFirewood} firewood awaiting collection · ${wood.firewood} still in logs</span></li>` : ''}
      ${forestryWorkAreaDetailRow(building)}
      <li><span>Household route</span><span>${residenceSummary}</span></li>
      <li><span>Surplus fuel duty</span><span>${industrialFuelDuty}</span></li>
      <li><span>Harvest interval</span><span>${onsiteLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      <li><span>Wood conversion</span><span>5 log health per firewood · twice the timber yield</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${deliveryRow}
      ${civilianToolRows(building, context.worldQueries)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: renderForestryWorkAreaPanel(building, {
      pending: context.pendingTreeWorkAreaBuildingId === building.id,
    }),
  };
}
