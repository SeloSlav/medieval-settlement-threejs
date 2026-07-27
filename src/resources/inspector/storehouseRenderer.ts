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

export function renderStorehouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const claimedResidences = context.worldQueries.getClaimedResidencesForFirewoodSupplier(building);
  const nextFuelTarget = context.worldQueries.getNextFirewoodDeliveryTarget(building);
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
  const accepted = [
    building.storehouseAcceptsTimber ? 'timber' : '',
    building.storehouseAcceptsStone ? 'stone' : '',
    building.storehouseAcceptsFirewood ? 'firewood' : '',
  ].filter(Boolean);
  const collectionTargets = STOREHOUSE_COMMODITIES
    .map((commodity) =>
      `${storehouseCommodityLabel(commodity)} ${storehouseCommodityTargetPercent(building, commodity)}%`,
    )
    .join(' Â· ');
  const collectionHeadroom = STOREHOUSE_COMMODITIES.reduce(
    (sum, commodity) =>
      storehouseAcceptsCommodity(building, commodity)
        ? sum + storehouseCollectionHeadroom(
          Math.max(0, building[commodity]),
          BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0,
          storehouseCommodityTargetPercent(building, commodity),
        )
        : sum,
    0,
  );
  const status = !roadAccess.startsWith('Connected')
    ? ['Connect to a road before haulers can collect overflow', 'warning'] as const
    : building.assignedLabor <= 0
      ? ['Storage active · assign haulers to distribute fuel and collect overflow', 'idle'] as const
      : deliveringHouseholdFuel
        ? [`Household fuel cart ${formatTripPhaseLabel(activeTrip!.phase).toLowerCase()}`, 'active'] as const
        : activeTrip
          ? ['Construction supply cart in progress', 'active'] as const
          : inboundTrip
            ? ['Collecting producer overflow', 'active'] as const
            : accepted.length === 0
              ? ['All acceptance filters disabled', 'idle'] as const
              : building.storehouseAcceptsFirewood && building.firewood > 0 && nextFuelTarget
                ? [`Ready to deliver fuel to ${nextFuelLabel}`, 'ok'] as const
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
      <li><span>Role</span><span>Communal reserve, household fuel distribution, and construction logistics</span></li>
      <li><span>Duty priority</span><span>Claimed household fuel, then producer overflow</span></li>
      <li><span>Fuel territory</span><span>${claimedResidences.length === 0 ? 'None on branch' : `${claimedResidences.length} households claimed`}</span></li>
      <li><span>Next fuel delivery</span><span>${nextFuelLabel}</span></li>
      <li><span>Fuel road distance</span><span>${formatDeliveryRoadDistance(fuelDistance)}</span></li>
      <li><span>Fuel cart</span><span>${fuelWorkers > 0 ? `${fuelPerTrip} firewood · ${formatDeliveryTripDuration(fuelTripSeconds)}` : 'Paused · no haulers'}</span></li>
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
        <p class="inspector-action-panel__hint">Storage works without staff. Assigned haulers first carry accepted firewood to claimed homes, then collect producer overflow; stored material also supports larger construction carts.</p>
        ${acceptanceToggle('timber', 'Timber', building.storehouseAcceptsTimber)}
        ${acceptanceToggle('stone', 'Stone', building.storehouseAcceptsStone)}
        ${acceptanceToggle('firewood', 'Firewood', building.storehouseAcceptsFirewood)}
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
    const stock = Math.max(0, building[commodity]);
    const headroom = storehouseCollectionHeadroom(
      stock,
      BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0,
      percent,
    );
    const pressure = headroom > 0.05
      ? `${headroom.toFixed(0)} collection headroom`
      : stock > target + 0.05
        ? `${(stock - target).toFixed(0)} above target Â· still available`
        : 'At collection target';
    return `
      <p class="resource-inspector-note">${storehouseCommodityLabel(commodity)} target Â· ${stock.toFixed(0)} stored / ${target.toFixed(0)} selected Â· ${pressure}</p>
      <div class="resource-action-row">${STOREHOUSE_STOCK_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-storehouse-stock-kind="${commodity}" data-storehouse-stock-target="${preset.percent}" title="${preset.hint}" ${percent === preset.percent ? 'disabled' : ''}>${preset.label} Â· ${preset.percent}%</button>`)
        .join('')}</div>
    `;
  }).join('');
}

function acceptanceToggle(key: 'timber' | 'stone' | 'firewood', label: string, checked: boolean): string {
  return `<label class="city-admin-panel__toggle"><input type="checkbox" data-storehouse-accepts-${key} ${checked ? 'checked' : ''} /><span>Accept ${label}</span></label>`;
}

function storehouseCommodityLabel(commodity: StorehouseCommodity): string {
  return commodity === 'timber'
    ? 'Timber'
    : commodity === 'stone'
      ? 'Stone'
      : 'Firewood';
}
