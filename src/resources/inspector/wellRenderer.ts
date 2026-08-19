import {
  BUILDING_STORAGE_CAPS,
  DROUGHT_WELL_REFILL_MULTIPLIER,
  RESIDENCE_POPULATION_WIDE,
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
  industrialWaterTarget,
  wellRefillPerSecond,
  wellSustainableHomeCapacity,
} from '../../logistics/waterLogistics.ts';
import { weaverFibreDeliveryPreferenceLabel } from '../../economy/weaverInputPolicy.ts';
import { formatCooldown } from './woodcuttersLodgeStatus.ts';

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
  const claimedResidences = context.worldQueries.getClaimedResidencesForWell(building);
  const industrialConsumers = context.worldQueries.getRoadConnectedWaterConsumers(building);
  const nextIndustrialTarget = context.worldQueries.getNextIndustrialWaterTargetForWell(building);
  const activeTrips = [...context.gameState.deliveryTrips.values()]
    .filter((trip) => trip.buildingId === building.id);
  const respondingTrips = activeTrips.filter((trip) =>
    trip.destinationKind === 'fire' && trip.phase !== 'inbound');
  const activeTrip = respondingTrips[0] ?? activeTrips[0] ?? null;
  const refillPerSec = wellRefillPerSecond(hydrology);
  const sustainableHomes = wellSustainableHomeCapacity(hydrology);
  const droughtWideHomeCapacity = wellSustainableHomeCapacity(
    hydrology,
    DROUGHT_WELL_REFILL_MULTIPLIER,
    RESIDENCE_POPULATION_WIDE,
  );
  const capacityLabel = `~${sustainableHomes}-home normal-weather yield`;
  const industrialPreferenceLabel = nextIndustrialTarget?.kind === 'weaver'
    ? ` · ${weaverFibreDeliveryPreferenceLabel(nextIndustrialTarget.weaverInputPolicy, 'flax')}`
    : '';
  const nextTargetLabel = nextIndustrialTarget
      ? `${context.worldQueries.getBuildingLabel(nextIndustrialTarget.kind)}${industrialPreferenceLabel} (${Math.round(nextIndustrialTarget.water)} / ${Math.round(industrialWaterTarget(nextIndustrialTarget.kind, nextIndustrialTarget.processorOutputTargetPercent))} staged water)`
      : 'No nearby workshop needs water';
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
  const tripRemaining = activeTrip
    ? context.worldQueries.getDeliveryTripRemainingSeconds(activeTrip)
    : null;

  let statusText: string;
  let statusState: InspectorView['statusState'];
  if (respondingTrips.length > 0) {
    statusText = `${respondingTrips.length} bucket ${respondingTrips.length === 1 ? 'carrier' : 'carriers'} responding — ${Math.round(respondingTrips.reduce((sum, trip) => sum + Math.max(0, trip.amount), 0))} water committed`;
    statusState = 'active';
  } else if (activeTrip) {
    statusText = `Deliverer ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${formatCooldown(tripRemaining ?? Infinity)} remaining → ${activeTargetLabel}`;
    statusState = 'active';
  } else if (nextIndustrialTarget && building.water > 1e-6) {
    statusText = `Supplying homes first, then nearby workshops automatically — ${nextTargetLabel}`;
    statusState = 'active';
  } else if (claimedResidences.length > 0 && building.water > 1e-6) {
    statusText = `${claimedResidences.length} home${claimedResidences.length === 1 ? '' : 's'} currently connected — ${fillPct}% reserve · ${capacityLabel}`;
    statusState = 'active';
  } else if (building.water + 1e-6 >= capacity) {
    statusText = `Full — ${claimedResidences.length} home${claimedResidences.length === 1 ? '' : 's'} currently connected · ${capacityLabel}`;
    statusState = 'active';
  } else {
    statusText = `Groundwater refilling — ${fillPct}% (${Math.round(building.water)} / ${Math.round(capacity)})`;
    statusState = building.water > capacity * 0.2 ? 'active' : 'idle';
  }

  const deliveryRow = respondingTrips.length > 0
    ? `<li><span>Emergency response</span><span>${respondingTrips.length} concurrent bucket ${respondingTrips.length === 1 ? 'carrier' : 'carriers'}</span></li>
      <li><span>Water committed</span><span>${Math.round(respondingTrips.reduce((sum, trip) => sum + Math.max(0, trip.amount), 0))}</span></li>
      <li><span>Tracked carrier</span><span>${activeTargetLabel} · ${formatTripPhaseLabel(activeTrip!.phase)} — ${formatCooldown(tripRemaining ?? Infinity)} left</span></li>`
    : `<li><span>Routine delivery</span><span>No cart — homes and workshops draw automatically within this well's radius and road branch</span></li>
      <li><span>Next workshop</span><span>${nextTargetLabel}</span></li>`;
  const workshopDemand = [
    ['brewer', industrialConsumers.filter((item) => item.kind === 'brewery').length],
    ['bakery', industrialConsumers.filter((item) => item.kind === 'bakery').length],
    ['weaver', industrialConsumers.filter((item) => item.kind === 'weaver').length],
    ['smithy', industrialConsumers.filter((item) => item.kind === 'smithy').length],
    ['potter', industrialConsumers.filter((item) => item.kind === 'potter_kiln').length],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => `${count} ${name}${Number(count) === 1 ? '' : 's'}`)
    .join(' · ');

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState,
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li data-inspector-secondary data-inspector-detail="Routine water service needs no assigned worker or last-mile cart."><span>Labor</span><span>None</span></li>
      <li><span>Hydrology</span><span>${hydrologyGradeLabel(hydrology)} (${Math.round(hydrology * 100)}%)</span></li>
      <li><span>Stored water</span><span>${Math.round(building.water)} / ${Math.round(capacity)}</span></li>
      <li><span>Refill rate</span><span>${refillPerSec.toFixed(2)} / sec</span></li>
      <li data-inspector-secondary data-inspector-detail="The normal estimate uses standard three-person homes; the drought floor uses fully occupied four-person homes. Connected homes retain priority over workshops."><span>Sustainable capacity</span><span>~${sustainableHomes} standard homes · at least ${droughtWideHomeCapacity} full homes in drought</span></li>
      ${buildingExtentRow(building.kind)}
      <li><span>Homes connected now</span><span>${claimedResidences.length === 0 ? 'None' : claimedResidences.length}</span></li>
      <li><span>Workshop demand</span><span>${workshopDemand || 'None'}</span></li>
      <li data-inspector-secondary data-inspector-detail="Connected homes draw first from real well storage; nearby road-connected workshops then fill their real input buffers from the remainder."><span>Distribution</span><span>Automatic in radius · homes first</span></li>
      <li data-inspector-secondary data-inspector-detail="Fire calls reserve new water before homes and workshops; all useful free haulers may respond together."><span>Fire priority</span><span>Emergency calls first</span></li>
      ${deliveryRow}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    serviceCoverage: {
      kind: 'well',
      residenceIds: claimedResidences.map((residence) => residence.id),
    },
  };
}
