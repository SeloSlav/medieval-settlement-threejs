import {
  BUILDING_STORAGE_CAPS,
  STOREHOUSE_FIREWOOD_PER_DELIVERY,
  STOREHOUSE_HAUL_PER_WORKER,
  STOREHOUSE_OVERFLOW_THRESHOLD,
} from '../../generated/gameBalance.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
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
import { formatCooldown } from './woodcuttersLodgeStatus.ts';
import {
  STOREHOUSE_COMMODITIES,
  STOREHOUSE_STOCK_TARGET_PRESETS,
  storehouseCollectionHeadroom,
  storehouseAcceptsCommodity,
  storehouseCommodityTarget,
  storehouseCommodityTargetPercent,
  type StorehouseCommodity,
} from '../../economy/storehousePolicy.ts';
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
  const charcoalDispatch = building.assignedLabor > 0
    && (building.charcoal ?? 0) > 1e-6
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'charcoal')
    : null;
  const firewoodDispatch = building.assignedLabor > 0
    && building.firewood > 1e-6
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'firewood')
    : null;
  const industrialDispatch = charcoalDispatch
    ? { commodity: 'charcoal' as const, dispatch: charcoalDispatch }
    : firewoodDispatch
      ? { commodity: 'firewood' as const, dispatch: firewoodDispatch }
      : null;
  const materialDispatch = (['iron', 'clay', 'salt'] as const)
    .filter((commodity) =>
      Math.max(0, building[commodity] ?? 0) > 1e-6
    )
    .map((commodity) => ({
      commodity,
      dispatch: context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        commodity,
      ),
    }))
    .find(({ dispatch }) => dispatch != null) ?? null;
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
  const industrialFuelDuty = industrialDispatch
    ? `${storehouseCommodityLabel(industrialDispatch.commodity)} to ${context.worldQueries.getBuildingLabel(industrialDispatch.dispatch.target.kind)} · ${industrialDispatch.dispatch.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(industrialDispatch.dispatch.routeDistance)}`
    : activeIndustrialTarget
      ? `Cart committed to ${context.worldQueries.getBuildingLabel(activeIndustrialTarget.kind)}`
      : building.firewood <= 1e-6
        ? 'No surplus firewood stored'
        : 'No staffed workshop currently requests surplus fuel';
  const accepted = STOREHOUSE_STORAGE_COMMODITIES
    .filter((commodity) => storageAcceptsCommodity(building, commodity))
    .map(storageCommodityLabel);
  const collectionTargets = STOREHOUSE_COMMODITIES
    .map((commodity) =>
      `${storehouseCommodityLabel(commodity)} ${storehouseCommodityTargetPercent(building, commodity)}%`,
    )
    .join(' · ');
  const collectionHeadroom = STOREHOUSE_COMMODITIES.reduce(
    (sum, commodity) =>
      commodity !== 'charcoal' && storehouseAcceptsCommodity(building, commodity)
        ? sum + storehouseCollectionHeadroom(
          Math.max(0, building[commodity] ?? 0),
          BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0,
          storehouseCommodityTargetPercent(building, commodity),
        )
        : sum,
    0,
  );
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
                ? ['Ready to maintain the combined Marketplace fuel reserve', 'ok'] as const
                : industrialDispatch
                  ? [`Marketplace duty clear · ${context.worldQueries.getBuildingLabel(industrialDispatch.dispatch.target.kind)} is next for ${industrialDispatch.commodity}`, 'ok'] as const
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
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Communal reserve, Marketplace goods-stall supply, construction logistics, and raw-material buffering</span></li>
      <li><span>Duty priority</span><span>Refill active smithies from below 3 to 6 charcoal cycles; maintain a 21-day household- and season-scaled combined Marketplace reserve and winter fuel floor; serve other hot workshops; collect producer output last</span></li>
      <li><span>Fuel territory</span><span>Handled by staffed Marketplace stalls across their connected road branch · scarce fuel goes to nearest homes first</span></li>
      <li><span>Next fuel delivery</span><span>Marketplace stall or urgent workshop · never a routine home cart</span></li>
      <li><span>Stall roster</span><span>Each assigned keeper can own one stocked goods category at one nearest connected Marketplace</span></li>
      <li><span>Last mile</span><span>Abstract from stocked goods stalls · no additional household-cart worker</span></li>
      <li><span>Market load</span><span>${fuelWorkers > 0 ? `${fuelPerTrip} physical fuel units per rostered fuel-table replenishment cart` : 'Paused · no haulers'}</span></li>
      <li><span>Surplus fuel duty</span><span>${industrialFuelDuty}</span></li>
      <li><span>Raw-material duty</span><span>${materialDispatch ? `${storehouseCommodityLabel(materialDispatch.commodity)} to ${context.worldQueries.getBuildingLabel(materialDispatch.dispatch!.target.kind)} · ${materialDispatch.dispatch!.runwayCycles.toFixed(1)} cycles onsite · ${formatDeliveryRoadDistance(materialDispatch.dispatch!.routeDistance)}` : 'No staffed workshop currently requests stored iron, clay, or salt'}</span></li>
      <li><span>Collection trigger</span><span>Producer stock above ${Math.round(STOREHOUSE_OVERFLOW_THRESHOLD * 100)}%</span></li>
      <li><span>Cart assignment</span><span>Fullest producer first · nearest compatible idle depot</span></li>
      <li><span>Construction bonus</span><span>${STOREHOUSE_HAUL_PER_WORKER} materials per staffed hauler; up to 2 haulers per cart</span></li>
      <li><span>Accepted cargo</span><span>${accepted.join(', ') || 'None'}</span></li>
      <li><span>Collection ceilings</span><span>${collectionTargets}</span></li>
      <li><span>Food policy</span><span>Never accepted — granaries remain specialized</span></li>
      <li><span>Market role</span><span>Stocks firewood and 2×-value charcoal into one household fuel reserve, plus clothing and pottery · no food or regional trade</span></li>
      <li><span>Hauling</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} · ${formatCooldown(activeTripRemaining ?? Infinity)} left` : inboundTrip ? 'Producer cart inbound' : 'Awaiting duty'}</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      <div class="inspector-action-panel" data-inspector-panel-title="Accepted goods">
        <p class="inspector-action-panel__hint">Choose which goods this Storehouse may collect; disabling a good stops new intake but leaves existing stock usable.</p>
        ${renderStorageAcceptanceControls(building, STOREHOUSE_STORAGE_GROUPS)}
      </div>
      <div class="inspector-action-panel" data-inspector-panel-title="Collection limits">
        <p class="inspector-action-panel__hint">Set each material's collection limit; overflow carts use another depot and stored goods remain when a limit is lowered.</p>
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
    const capacity = BUILDING_STORAGE_CAPS.village_storehouse[commodity] ?? 0;
    const headroom = storehouseCollectionHeadroom(
      stock,
      capacity,
      percent,
    );
    const status = headroom > 0.05
      ? commodity === 'charcoal'
        ? `${headroom.toFixed(0)} room when demanded`
        : `${headroom.toFixed(0)} room`
      : stock > target + 0.05
        ? `${(stock - target).toFixed(0)} over limit`
        : 'limit reached';
    return `
      <section class="storehouse-stock-target" aria-label="${storehouseCommodityLabel(commodity)} collection limit">
        <div class="storehouse-stock-target__heading">
          <strong>${storehouseCommodityLabel(commodity)}</strong>
          <span>${stock.toFixed(0)} stored · limit ${target.toFixed(0)} · ${status}</span>
        </div>
        <div class="resource-action-row">${STOREHOUSE_STOCK_TARGET_PRESETS
          .map((preset) => {
            const selected = percent === preset.percent;
            return `<button type="button" class="resource-action-button${selected ? ' is-selected' : ''}" data-storehouse-stock-kind="${commodity}" data-storehouse-stock-target="${preset.percent}" aria-pressed="${selected}" title="${preset.percent}% limit: ${preset.hint}" ${selected ? 'disabled' : ''}>${preset.percent}%</button>`;
          })
          .join('')}</div>
      </section>
    `;
  }).join('');
}

function storehouseCommodityLabel(commodity: StorehouseCommodity): string {
  switch (commodity) {
    case 'timber': return 'Timber';
    case 'stone': return 'Stone';
    case 'firewood': return 'Firewood';
    case 'charcoal': return 'Charcoal';
    case 'iron': return 'Iron';
    case 'clay': return 'Clay';
    case 'salt': return 'Salt';
  }
}
