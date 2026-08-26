import {
  STOREHOUSE_FIREWOOD_PER_DELIVERY,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../../generated/gameBalance.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { formatCooldown } from './woodcuttersLodgeStatus.ts';
import {
  renderStorageAcceptanceControls,
  storageAcceptsCommodity,
  storageCommodityLabel,
  STOREHOUSE_STORAGE_COMMODITIES,
  STOREHOUSE_STORAGE_GROUPS,
} from '../../economy/storageAcceptancePolicy.ts';

export function renderStorehouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const fuelWorkers = Math.min(1, building.assignedLabor);
  const fuelPerTrip = STOREHOUSE_FIREWOOD_PER_DELIVERY * fuelWorkers;
  const activeTripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const deliveringHouseholdFuel = activeTrip?.cargoKind === 'firewood'
    && activeTrip.residenceId != null;
  const deliveringIndustrialFuel = (
    activeTrip?.cargoKind === 'firewood' || activeTrip?.cargoKind === 'charcoal'
  )
    && activeTrip.destinationKind === 'building'
    && activeTrip.targetBuildingId != null;
  const activeIndustrialTarget = deliveringIndustrialFuel
    ? context.worldQueries.getBuilding(activeTrip!.targetBuildingId!)
    : null;
  const accepted = STOREHOUSE_STORAGE_COMMODITIES
    .filter((commodity) => storageAcceptsCommodity(building, commodity))
    .map(storageCommodityLabel);
  const status = building.assignedLabor <= 0
      ? ['Storage active · assign haulers to stock market stalls and collect overflow', 'idle'] as const
      : deliveringHouseholdFuel
        ? [`Legacy household fuel cart ${formatTripPhaseLabel(activeTrip!.phase).toLowerCase()}`, 'active'] as const
        : deliveringIndustrialFuel
          ? [`Industrial fuel cart to ${activeIndustrialTarget ? context.worldQueries.getBuildingLabel(activeIndustrialTarget.kind) : 'workshop'}`, 'active'] as const
        : activeTrip
          ? [`${activeTrip.cargoKind[0]?.toUpperCase() ?? ''}${activeTrip.cargoKind.slice(1)} cart in progress`, 'active'] as const
          : inboundTrip
            ? ['Collecting producer overflow', 'active'] as const
            : accepted.length === 0
              ? ['All acceptance filters disabled', 'idle'] as const
              : building.firewood > 0 || (building.charcoal ?? 0) > 0
                ? ['Marketplace fuel reserve ready', 'ok'] as const
                : ['Producer collection ready', 'ok'] as const;

  return {
    eyebrow: 'Settlement logistics',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Communal reserve, Marketplace goods-stall supply, construction logistics, and raw-material buffering</span></li>
      <li><span>Fuel territory</span><span>Handled by staffed Marketplace stalls across their connected road branch · scarce fuel goes to nearest homes first</span></li>
      <li><span>Stall roster</span><span>Each assigned keeper can own one stocked goods category at one nearest connected Marketplace</span></li>
      <li><span>Last mile</span><span>Abstract from stocked goods stalls · no additional household-cart worker</span></li>
      <li><span>Market load</span><span>${fuelWorkers > 0 ? `${fuelPerTrip} physical fuel units per rostered fuel-table replenishment cart` : 'Paused · no haulers'}</span></li>
      <li><span>Construction bonus</span><span>${STOREHOUSE_HAUL_PER_WORKER} materials per staffed hauler; up to 2 haulers per cart</span></li>
      <li><span>Accepted cargo</span><span>${accepted.join(', ') || 'None'}</span></li>
      <li><span>Food policy</span><span>Never accepted — granaries remain specialized</span></li>
      <li><span>Market role</span><span>Stocks household fuel and finished wares while buffering wool, yarn, and linen between textile workshops · no food or regional trade</span></li>
      <li><span>Hauling</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} · ${formatCooldown(activeTripRemaining ?? Infinity)} left` : inboundTrip ? 'Producer cart inbound' : 'Awaiting duty'}</span></li>
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      <div class="inspector-action-panel" data-inspector-panel-title="Accepted goods">
        <p class="inspector-action-panel__hint">Choose which goods this Storehouse may collect; disabling a good stops new intake but leaves existing stock usable.</p>
        ${renderStorageAcceptanceControls(building, STOREHOUSE_STORAGE_GROUPS)}
      </div>
    `,
  };
}
