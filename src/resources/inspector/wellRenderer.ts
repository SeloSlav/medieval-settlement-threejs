import {
  WELL_BASE_REFILL_PER_SEC,
  WELL_MINIMUM_REFILL_HYDROLOGY,
  BUILDING_STORAGE_CAPS,
} from '../../generated/gameBalance.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingExtentRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  formatTripBuildingDestinationLabel,
  formatTripDestinationLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import { hydrologyGradeLabel, wellCapacityFromHydrology } from '../../hydrology/sampleHydrology.ts';
import { sampleAuthoritativeHydrologyScore } from '../../hydrology/sampleAuthoritativeHydrology.ts';
import {
  formatDeliveryRoadDistance,
  formatDeliveryTripDuration,
} from '../../logistics/deliveryLogistics.ts';
import {
  formatWaterRunwayDays,
  formatWellCrewSplit,
  industrialWaterRequirement,
  residenceWaterRunwayDays,
  wellLaborSplit,
  wellWaterPerDelivery,
} from '../../logistics/waterLogistics.ts';
import { formatCooldown } from './woodcuttersLodgeStatus.ts';

function formatNextWaterTargetLabel(target: ReturnType<InspectorRenderContext['worldQueries']['getNextWaterDeliveryTargetForWell']>): string {
  if (!target) return 'None needing water';
  const runwayDays = residenceWaterRunwayDays(target);
  const runwaySuffix = runwayDays != null ? ` (${formatWaterRunwayDays(runwayDays)} left)` : '';
  return `Parcel #${target.parcelIndex + 1}${runwaySuffix}`;
}

export function renderWellInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const hydrology = sampleAuthoritativeHydrologyScore(building.x, building.z);
  const capacity = building.waterCapacity > 0
    ? building.waterCapacity
    : wellCapacityFromHydrology(BUILDING_STORAGE_CAPS.well.water ?? 100, hydrology);
  const fillPct = capacity > 0 ? Math.round((building.water / capacity) * 100) : 0;
  const crew = wellLaborSplit(building.assignedLabor);
  const claimedResidences = context.worldQueries.getClaimedResidencesForWell(building);
  const industrialConsumers = context.worldQueries.getRoadConnectedWaterConsumers(building);
  const nextHouseholdTarget = context.worldQueries.getNextWaterDeliveryTargetForWell(building);
  const nextIndustrialTarget = nextHouseholdTarget
    ? null
    : context.worldQueries.getNextIndustrialWaterTargetForWell(building);
  const nextDeliveryTarget = nextHouseholdTarget ?? nextIndustrialTarget;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const availableLabor = Math.max(0, building.assignedLabor - (activeTrip?.deliveryWorkers ?? 0));
  const drawingWorkers = activeTrip || !nextDeliveryTarget
    ? availableLabor
    : Math.max(0, availableLabor - 1);
  const refillHydrology = Math.max(hydrology, WELL_MINIMUM_REFILL_HYDROLOGY);
  const refillPerSec = WELL_BASE_REFILL_PER_SEC
    * refillHydrology
    * drawingWorkers;
  const nextTargetLabel = nextHouseholdTarget
    ? formatNextWaterTargetLabel(nextHouseholdTarget)
    : nextIndustrialTarget
      ? `${context.worldQueries.getBuildingLabel(nextIndustrialTarget.kind)} (${nextIndustrialTarget.water.toFixed(1)} / ${industrialWaterRequirement(nextIndustrialTarget.kind)} water)`
      : 'None needing water';
  const activeTargetLabel = formatTripDestinationLabel(
    activeTrip,
    (id) => context.worldQueries.getResidence(id),
    formatTripBuildingDestinationLabel(
      activeTrip,
      (kind) => context.worldQueries.getBuildingLabel(kind),
      (id) => context.worldQueries.getBuilding(id),
      nextTargetLabel,
    ),
  );
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const deliveryTripSeconds = context.worldQueries.getWellDeliveryTripSeconds(building, nextDeliveryTarget);
  const deliveryDistance = activeTrip
    ? context.worldQueries.getActiveTripPathDistance(activeTrip)
    : nextDeliveryTarget
      ? context.worldQueries.getRoadPathDistance(building.x, building.z, nextDeliveryTarget.x, nextDeliveryTarget.z)
      : null;
  const waterPerTrip = wellWaterPerDelivery(crew.delivering);
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const canDeliver = crew.delivering > 0 && onRoad && building.water > 0 && nextDeliveryTarget != null && !activeTrip;

  let statusText: string;
  let statusState: InspectorView['statusState'];
  if (building.assignedLabor === 0) {
    statusText = 'Idle — assign labor to draw and deliver water';
    statusState = 'idle';
  } else if (!onRoad) {
    statusText = 'Off road — connect to the road network';
    statusState = 'warning';
  } else if (activeTrip) {
    statusText = `Deliverer ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${formatCooldown(tripRemaining ?? Infinity)} remaining → ${activeTargetLabel}`;
    statusState = 'active';
  } else if (canDeliver) {
    statusText = nextHouseholdTarget
      ? `Delivering water — households take priority (${claimedResidences.length} claimed)`
      : `Supplying workshop — ${nextTargetLabel}`;
    statusState = 'active';
  } else if (building.water + 1e-6 >= capacity) {
    statusText = `Full — ${claimedResidences.length} road-linked home${claimedResidences.length === 1 ? '' : 's'} in range`;
    statusState = 'active';
  } else if (drawingWorkers > 0) {
    statusText = `Drawing water — ${fillPct}% (${Math.round(building.water)} / ${Math.round(capacity)})`;
    statusState = building.water > capacity * 0.2 ? 'active' : 'idle';
  } else {
    statusText = `Waiting — ${fillPct}% stored`;
    statusState = 'idle';
  }

  const deliveryRow = crew.delivering > 0
    ? `<li><span>Next delivery</span><span>${activeTrip ? activeTargetLabel : nextTargetLabel}</span></li>
      <li><span>Road distance</span><span>${formatDeliveryRoadDistance(deliveryDistance)}</span></li>
      <li><span>Delivery timer</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} — ${formatCooldown(tripRemaining ?? Infinity)} left` : `Ready / ${formatDeliveryTripDuration(deliveryTripSeconds)}`}</span></li>
      <li><span>Water per trip</span><span>${waterPerTrip}</span></li>`
    : `<li><span>Delivery</span><span>Paused — no deliverer assigned</span></li>`;

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState,
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Crew split</span><span>${nextDeliveryTarget || activeTrip ? formatWellCrewSplit(building.assignedLabor) : `${drawingWorkers} drawing · delivery on demand`}</span></li>
      <li><span>Hydrology</span><span>${hydrologyGradeLabel(hydrology)} (${Math.round(hydrology * 100)}%)</span></li>
      <li><span>Stored water</span><span>${Math.round(building.water)} / ${Math.round(capacity)}</span></li>
      <li><span>Refill rate</span><span>${refillPerSec.toFixed(2)} / sec</span></li>
      ${buildingExtentRow(building.kind)}
      <li><span>Road-linked homes</span><span>${claimedResidences.length === 0 ? 'None in range' : `${claimedResidences.length} claimed`}</span></li>
      <li><span>Workshop demand</span><span>${industrialConsumers.length === 0 ? 'None' : `${industrialConsumers.filter((item) => item.kind === 'brewery').length} brewhouse · ${industrialConsumers.filter((item) => item.kind === 'granary').length} granary`}</span></li>
      <li><span>Dispatch rule</span><span>Fires first · households second · emptiest workshop third</span></li>
      <li><span>Supplies</span><span>Homes, brewhouses, and granary bakeries by visible cart</span></li>
      ${deliveryRow}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
