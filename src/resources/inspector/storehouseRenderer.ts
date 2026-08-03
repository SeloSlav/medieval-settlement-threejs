import {
  BUILDING_STORAGE_CAPS,
  STOREHOUSE_FIREWOOD_PER_DELIVERY,
  STOREHOUSE_HAUL_PER_WORKER,
  STOREHOUSE_OVERFLOW_THRESHOLD,
} from '../../generated/gameBalance.ts';
import {
  formatDeliveryRoadDistance,
  formatDeliveryTripDuration,
} from '../../logistics/deliveryLogistics.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
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
} from './woodcuttersLodgeStatus.ts';
import {
  STOREHOUSE_COMMODITIES,
  STOREHOUSE_STOCK_TARGET_PRESETS,
  storehouseCollectionHeadroom,
  storehouseAcceptsCommodity,
  storehouseCommodityTarget,
  storehouseCommodityTargetPercent,
  type StorehouseCommodity,
} from '../../economy/storehousePolicy.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';

export function renderStorehouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const claimedResidences = context.worldQueries.getClaimedResidencesForFirewoodSupplier(building);
  const nextFuelTarget = context.worldQueries.getNextFirewoodDeliveryTarget(building);
  const industrialDispatch = building.storehouseAcceptsFirewood
    && building.assignedLabor > 0
    && building.firewood > 1e-6
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'firewood')
    : null;
  const materialDispatch = (['iron', 'clay', 'salt'] as const)
    .filter((commodity) =>
      storehouseAcceptsCommodity(building, commodity)
      && Math.max(0, building[commodity] ?? 0) > 1e-6
    )
    .map((commodity) => ({
      commodity,
      dispatch: context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        commodity,
      ),
    }))
    .find(({ dispatch }) => dispatch != null) ?? null;
  const fuelWorkers = Math.min(2, building.assignedLabor);
  const fuelPerTrip = STOREHOUSE_FIREWOOD_PER_DELIVERY * fuelWorkers;
  const fuelDistance = nextFuelTarget
    ? context.worldQueries.getRoadPathDistance(
      building.x,
      building.z,
      nextFuelTarget.x,
      nextFuelTarget.z,
    )
    : null;
  const fuelTripSeconds = context.worldQueries.getFirewoodDeliveryTripSeconds(
    building,
    nextFuelTarget,
    fuelWorkers,
  );
  const activeTripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const nextFuelLabel = formatNextDeliveryTargetLabel(nextFuelTarget);
  const deliveringHouseholdFuel = activeTrip?.cargoKind === 'firewood'
    && activeTrip.residenceId != null;
  const deliveringIndustrialFuel = activeTrip?.cargoKind === 'firewood'
    && activeTrip.destinationKind === 'building'
    && activeTrip.targetBuildingId != null;
  const activeIndustrialTarget = deliveringIndustrialFuel
    ? context.worldQueries.getBuilding(activeTrip!.targetBuildingId!)
    : null;
  const industrialFuelDuty = industrialDispatch
    ? `${context.worldQueries.getBuildingLabel(industrialDispatch.target.kind)} · ${staffingPriorityLabel(industrialDispatch.workPriority)} priority · ${industrialDispatch.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(industrialDispatch.routeDistance)}`
    : activeIndustrialTarget
      ? `Cart committed to ${context.worldQueries.getBuildingLabel(activeIndustrialTarget.kind)}`
      : building.firewood <= 1e-6
        ? 'No surplus firewood stored'
        : 'No staffed workshop currently requests surplus fuel';
  const accepted = STOREHOUSE_COMMODITIES
    .filter((commodity) => storehouseAcceptsCommodity(building, commodity))
    .map(storehouseCommodityLabel);
  const collectionTargets = STOREHOUSE_COMMODITIES
    .map((commodity) =>
      `${storehouseCommodityLabel(commodity)} ${storehouseCommodityTargetPercent(building, commodity)}%`,
    )
    .join(' · ');
  const collectionHeadroom = STOREHOUSE_COMMODITIES.reduce(
    (sum, commodity) =>
      storehouseAcceptsCommodity(building, commodity)
        ? sum + storehouseCollectionHeadroom(
          Math.max(0, building[commodity] ?? 0),
          BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0,
          storehouseCommodityTargetPercent(building, commodity),
        )
        : sum,
    0,
  );
  const status = building.assignedLabor <= 0
      ? ['Storage active · assign haulers to distribute fuel and collect overflow', 'idle'] as const
      : deliveringHouseholdFuel
        ? [`Household fuel cart ${formatTripPhaseLabel(activeTrip!.phase).toLowerCase()}`, 'active'] as const
        : deliveringIndustrialFuel
          ? [`Industrial fuel cart to ${activeIndustrialTarget ? context.worldQueries.getBuildingLabel(activeIndustrialTarget.kind) : 'workshop'}`, 'active'] as const
        : activeTrip
          ? [`${activeTrip.cargoKind[0]?.toUpperCase() ?? ''}${activeTrip.cargoKind.slice(1)} cart in progress`, 'active'] as const
          : inboundTrip
            ? ['Collecting producer overflow', 'active'] as const
            : accepted.length === 0
              ? ['All acceptance filters disabled', 'idle'] as const
              : building.storehouseAcceptsFirewood && building.firewood > 0 && nextFuelTarget
                ? [`Ready to deliver fuel to ${nextFuelLabel}`, 'ok'] as const
                : industrialDispatch
                  ? [`Protected household reserves covered · ${context.worldQueries.getBuildingLabel(industrialDispatch.target.kind)} is next for surplus fuel`, 'ok'] as const
                  : materialDispatch
                    ? [`Ready to supply ${storehouseCommodityLabel(materialDispatch.commodity)} to ${context.worldQueries.getBuildingLabel(materialDispatch.dispatch!.target.kind)}`, 'ok'] as const
                    : collectionHeadroom <= 0.05
                      ? ['Selected collection targets met', 'ok'] as const
                      : ['Ready to collect producer overflow', 'ok'] as const;

  return {
    eyebrow: 'Settlement logistics',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Communal reserve, household fuel distribution, construction logistics, and raw-material buffering</span></li>
      <li><span>Duty priority</span><span>Claimed homes below their winter-night fuel floor first; urgent workshop buffers next; incoming producer overflow last</span></li>
      <li><span>Fuel territory</span><span>${claimedResidences.length === 0 ? 'None in range' : `${claimedResidences.length} households claimed`}</span></li>
      <li><span>Next fuel delivery</span><span>${nextFuelLabel}</span></li>
      <li><span>Fuel road distance</span><span>${formatDeliveryRoadDistance(fuelDistance)}</span></li>
      <li><span>Fuel cart</span><span>${fuelWorkers > 0 ? `${fuelPerTrip} firewood · ${formatDeliveryTripDuration(fuelTripSeconds)}` : 'Paused · no haulers'}</span></li>
      <li><span>Surplus fuel duty</span><span>${nextFuelTarget ? `Protected household stock first · then ${industrialFuelDuty}` : industrialFuelDuty}</span></li>
      <li><span>Raw-material duty</span><span>${materialDispatch ? `${storehouseCommodityLabel(materialDispatch.commodity)} to ${context.worldQueries.getBuildingLabel(materialDispatch.dispatch!.target.kind)} · ${staffingPriorityLabel(materialDispatch.dispatch!.workPriority)} priority · ${materialDispatch.dispatch!.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(materialDispatch.dispatch!.routeDistance)}` : 'No staffed workshop currently requests stored iron, clay, or salt'}</span></li>
      <li><span>Collection trigger</span><span>Producer stock above ${Math.round(STOREHOUSE_OVERFLOW_THRESHOLD * 100)}%</span></li>
      <li><span>Cart assignment</span><span>Fullest producer first · nearest compatible idle depot</span></li>
      <li><span>Construction bonus</span><span>${STOREHOUSE_HAUL_PER_WORKER} materials per staffed hauler; up to 2 haulers per cart</span></li>
      <li><span>Accepted cargo</span><span>${accepted.join(', ') || 'None'}</span></li>
      <li><span>Collection ceilings</span><span>${collectionTargets}</span></li>
      <li><span>Food policy</span><span>Never accepted — granaries remain specialized</span></li>
      <li><span>Market role</span><span>No food retail or regional trade</span></li>
      <li><span>Hauling</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} · ${formatCooldown(activeTripRemaining ?? Infinity)} left` : inboundTrip ? 'Producer cart inbound' : 'Awaiting duty'}</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Storage works without staff. Assigned haulers first protect a half winter day of firewood in each claimed home. They then restore the most urgent staffed workshop buffer from stored iron, clay, salt, or surplus fuel before collecting fresh producer overflow. This lets a depot shorten mine-to-workshop routes without creating goods off-map.</p>
        ${acceptanceToggle('timber', 'Timber', building.storehouseAcceptsTimber)}
        ${acceptanceToggle('stone', 'Stone', building.storehouseAcceptsStone)}
        ${acceptanceToggle('firewood', 'Firewood', building.storehouseAcceptsFirewood)}
        ${acceptanceToggle('iron', 'Iron', building.storehouseAcceptsIron !== false)}
        ${acceptanceToggle('clay', 'Clay', building.storehouseAcceptsClay !== false)}
        ${acceptanceToggle('salt', 'Salt', building.storehouseAcceptsSalt !== false)}
        <p class="inspector-action-panel__hint">Collection targets distribute producer overflow between depots. After household fuel duties, the fullest blocked producer claims the nearest compatible idle depot. Targets cap incoming overflow carts only: construction and household fuel can still draw below them, material already above a lowered target remains available, and one cart already on the road may still arrive.</p>
        ${renderStorehouseStockTargetControls(building)}
      </div>
    `,
  };
}

export function renderStorehouseStockTargetControls(building: BuildingState): string {
  return STOREHOUSE_COMMODITIES.map((commodity) => {
    const percent = storehouseCommodityTargetPercent(building, commodity);
    const target = storehouseCommodityTarget(building, commodity);
    const stock = Math.max(0, building[commodity] ?? 0);
    const headroom = storehouseCollectionHeadroom(
      stock,
      BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0,
      percent,
    );
    const pressure = headroom > 0.05
      ? `${headroom.toFixed(0)} collection headroom`
      : stock > target + 0.05
        ? `${(stock - target).toFixed(0)} above target · still available`
        : 'At collection target';
    return `
      <p class="resource-inspector-note">${storehouseCommodityLabel(commodity)} target · ${stock.toFixed(0)} stored / ${target.toFixed(0)} selected · ${pressure}</p>
      <div class="resource-action-row">${STOREHOUSE_STOCK_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-storehouse-stock-kind="${commodity}" data-storehouse-stock-target="${preset.percent}" title="${preset.hint}" ${percent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
    `;
  }).join('');
}

function acceptanceToggle(key: StorehouseCommodity, label: string, checked: boolean): string {
  return `<label class="city-admin-panel__toggle"><input type="checkbox" data-storehouse-accepts-${key} ${checked ? 'checked' : ''} /><span>Accept ${label}</span></label>`;
}

function storehouseCommodityLabel(commodity: StorehouseCommodity): string {
  switch (commodity) {
    case 'timber': return 'Timber';
    case 'stone': return 'Stone';
    case 'firewood': return 'Firewood';
    case 'iron': return 'Iron';
    case 'clay': return 'Clay';
    case 'salt': return 'Salt';
  }
}
