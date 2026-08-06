import type { BuildingResourceCost } from '../buildingEconomy.ts';
import { getBuildingExtent } from '../../buildings/buildingExtents.ts';
import {
  buildingSalvageRefund,
  formatBuildingCost,
  getBuildingCost,
  IRONWORK_SALVAGE_FRACTION,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
} from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import {
  buildingAcceptsLabor,
  buildingMaxLabor,
  buildingStorageCaps,
  maxAssignableLabor,
  type PopulationStats,
} from '../resourceTotals.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import type { InspectorLaborView } from './renderInspectableTarget.ts';
import {
  CONSTRUCTION_MAX_BUILDERS,
  MIN_DELIVERY_TRIP_SEC,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
} from '../../generated/gameBalance.ts';
import {
  CONSTRUCTION_PRIORITY_HOLD,
  normalizeConstructionPriority,
} from '../../logistics/constructionPriority.ts';
import { onsiteBuildingLabor, rosteredCartWorkers } from '../../logistics/deliveryTrips.ts';
import {
  civilianToolPlan,
  farmToolWorkerDayRunway,
} from '../../economy/civilianToolPolicy.ts';
import {
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
} from '../../generated/gameBalance.ts';
import {
  FRESH_FOOD_KINDS,
  NAMED_FOOD_LABELS,
  PRESERVED_FOOD_KINDS,
  freshFoodStock,
  preservedFoodStock,
} from '../../economy/foodInventory.ts';

export function buildingStorageRows(
  building: BuildingState,
  kind: BuildingKind,
  includeFrontierStock = true,
): string {
  const caps = buildingStorageCaps(kind);
  return [
    caps.timber > 0 ? `<li><span>Timber stored</span><span>${Math.round(building.timber)} / ${caps.timber}</span></li>` : '',
    caps.firewood > 0 ? `<li><span>Firewood stored</span><span>${Math.round(building.firewood)} / ${caps.firewood}</span></li>` : '',
    caps.stone > 0 ? `<li><span>Stone stored</span><span>${Math.round(building.stone)} / ${caps.stone}</span></li>` : '',
    caps.water != null && caps.water > 0 ? `<li><span>Water stored</span><span>${Math.round(building.water)} / ${caps.water}</span></li>` : '',
    buildingFoodStorageRows(building, caps.food ?? 0, false),
    caps.grain != null && caps.grain > 0 ? `<li><span>Grain stored</span><span>${Math.round(building.grain)} / ${caps.grain}</span></li>` : '',
    caps.barley != null && caps.barley > 0 ? `<li><span>Barley stored</span><span>${Math.round(building.barley ?? 0)} / ${caps.barley}</span></li>` : '',
    caps.malt != null && caps.malt > 0 ? `<li><span>Malt stored</span><span>${Math.round(building.malt ?? 0)} / ${caps.malt}</span></li>` : '',
    caps.flour != null && caps.flour > 0 ? `<li><span>Flour stored</span><span>${Math.round(building.flour)} / ${caps.flour}</span></li>` : '',
    caps.ale != null && caps.ale > 0 ? `<li><span>Ale stored</span><span>${Math.round(building.ale)} / ${caps.ale}</span></li>` : '',
    buildingFoodStorageRows(building, caps.preservedFood ?? 0, true),
    caps.honey != null && caps.honey > 0 ? `<li><span>Honey stored</span><span>${Math.round(building.honey)} / ${caps.honey}</span></li>` : '',
    caps.wine != null && caps.wine > 0 ? `<li><span>Wine stored</span><span>${Math.round(building.wine)} / ${caps.wine}</span></li>` : '',
    caps.wool != null && caps.wool > 0 ? `<li><span>Wool stored</span><span>${Math.round(building.wool ?? 0)} / ${caps.wool}</span></li>` : '',
    caps.flax != null && caps.flax > 0 ? `<li><span>Flax fibre stored</span><span>${Math.round(building.flax ?? 0)} / ${caps.flax}</span></li>` : '',
    caps.cloth != null && caps.cloth > 0 ? `<li><span>Cloth stored</span><span>${Math.round(building.cloth ?? 0)} / ${caps.cloth}</span></li>` : '',
    includeFrontierStock && caps.ironwork != null && caps.ironwork > 0 ? `<li><span>Ironwork stored</span><span>${Math.round(building.ironwork ?? 0)} / ${caps.ironwork}</span></li>` : '',
    includeFrontierStock && caps.polearms != null && caps.polearms > 0 ? `<li><span>Polearms stored</span><span>${Math.round(building.polearms ?? 0)} / ${caps.polearms}</span></li>` : '',
    caps.iron != null && caps.iron > 0 ? `<li><span>Iron stored</span><span>${Math.round(building.iron ?? 0)} / ${caps.iron}</span></li>` : '',
    caps.clay != null && caps.clay > 0 ? `<li><span>Clay stored</span><span>${Math.round(building.clay ?? 0)} / ${caps.clay}</span></li>` : '',
    caps.salt != null && caps.salt > 0 ? `<li><span>Salt stored</span><span>${Math.round(building.salt ?? 0)} / ${caps.salt}</span></li>` : '',
    caps.charcoal != null && caps.charcoal > 0 ? `<li><span>Charcoal stored</span><span>${Math.round(building.charcoal ?? 0)} / ${caps.charcoal}</span></li>` : '',
    caps.pottery != null && caps.pottery > 0 ? `<li><span>Pottery stored</span><span>${Math.round(building.pottery ?? 0)} / ${caps.pottery}</span></li>` : '',
    caps.roofTiles != null && caps.roofTiles > 0 ? `<li><span>Roof tiles stacked</span><span>${Math.round(building.roofTiles ?? 0)} / ${caps.roofTiles}</span></li>` : '',
  ].filter(Boolean).join('');
}

function buildingFoodStorageRows(
  building: BuildingState,
  capacity: number,
  preserved: boolean,
): string {
  if (capacity <= 0) return '';
  const total = preserved
    ? preservedFoodStock(building)
    : freshFoodStock(building);
  const kinds = preserved ? PRESERVED_FOOD_KINDS : FRESH_FOOD_KINDS;
  const rows = [
    `<li><span>${preserved ? 'Preserved store' : 'Fresh-food store'}</span><span>${Math.round(total)} / ${capacity}</span></li>`,
  ];
  for (const kind of kinds) {
    const amount = Math.max(0, building[kind] ?? 0);
    if (amount <= 1e-6) continue;
    const label = kind === 'food'
      ? 'Legacy mixed food'
      : kind === 'preservedFood'
        ? 'Legacy preserved food'
        : NAMED_FOOD_LABELS[kind];
    rows.push(`<li><span>&nbsp;&nbsp;${label}</span><span>${amount.toFixed(1)}</span></li>`);
  }
  return rows.join('');
}

export function civilianToolRows(
  building: BuildingState,
  worldQueries?: WorldQueries,
): string {
  const plan = civilianToolPlan(building);
  if (plan == null) return '';
  const bonus = Math.round((CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER - 1) * 100);
  const isFarmstead = building.kind === 'threshing_barn';
  const isGrainMill = building.kind === 'watermill' || building.kind === 'windmill';
  const runway = isFarmstead
    ? `${farmToolWorkerDayRunway(plan.ironwork).toFixed(1)} active worker-days onsite`
    : `${plan.runwayCycles.toFixed(1)} cycles onsite`;
  const wear = isFarmstead
    ? `${FARM_TOOL_IRONWORK_PER_WORKER_DAY} ironwork per completed worker-day · wear follows actual field progress`
    : isGrainMill
      ? `${CIVILIAN_TOOL_IRONWORK_PER_CYCLE} ironwork per completed milling cycle · dressing hammers, gudgeons, and fittings share the smithy buffer`
      : `${CIVILIAN_TOOL_IRONWORK_PER_CYCLE} ironwork per completed cycle · partial batches wear tools in proportion to real output`;
  const toolLabel = isGrainMill ? 'Mill dressing' : 'Work tools';
  const maintainedLabel = isGrainMill
    ? `Stone faces dressed and iron fittings sound · +${bonus}% throughput · ${runway}`
    : `Maintained · +${bonus}% throughput · ${runway}`;
  const baselineLabel = isGrainMill
    ? `Worn stone faces · baseline milling · deliver ironwork for +${bonus}% throughput`
    : `Baseline hand tools · deliver ironwork for +${bonus}% throughput`;
  const refillWork = isFarmstead
    ? `${(plan.refillAmount / FARM_TOOL_IRONWORK_PER_WORKER_DAY).toFixed(0)} active worker-days`
    : `${(plan.refillAmount / CIVILIAN_TOOL_IRONWORK_PER_CYCLE).toFixed(0)} cycles`;
  const refillRule = plan.reorderDue
    ? `${plan.refillAmount.toFixed(2)} ironwork requested · refill to ${plan.refillTarget.toFixed(2)} (${refillWork})`
    : `reorders below ${plan.reorderStock.toFixed(2)} · next cart refills to ${plan.refillTarget.toFixed(2)}`;
  const inbound = worldQueries && typeof worldQueries.getInboundSupplyTrip === 'function'
    ? worldQueries.getInboundSupplyTrip(building)
    : null;
  const inboundIronwork = inbound?.cargoKind === 'ironwork' ? inbound : null;
  const smithy = worldQueries && typeof worldQueries.findNearestRoadLinkedBuilding === 'function'
    ? worldQueries.findNearestRoadLinkedBuilding(
        building,
        ['smithy'],
        (candidate) => candidate.assignedLabor > 0,
      )
    : null;
  let supplyRoute: string;
  if (inboundIronwork && worldQueries) {
    const remainingSeconds = typeof worldQueries.getDeliveryTripRemainingSeconds === 'function'
      ? worldQueries.getDeliveryTripRemainingSeconds(inboundIronwork)
      : MIN_DELIVERY_TRIP_SEC;
    supplyRoute = `${inboundIronwork.amount.toFixed(2)} ironwork inbound · ${remainingSeconds.toFixed(0)}s ETA`;
  } else if (smithy && worldQueries) {
    const distance = typeof worldQueries.getLocalDeliveryDistance === 'function'
      ? worldQueries.getLocalDeliveryDistance(
          smithy.x,
          smithy.z,
          building.x,
          building.z,
        ) ?? 0
      : typeof worldQueries.getRoadPathDistance === 'function'
        ? worldQueries.getRoadPathDistance(
            smithy.x,
            smithy.z,
            building.x,
            building.z,
          ) ?? Math.hypot(building.x - smithy.x, building.z - smithy.z)
        : Math.hypot(building.x - smithy.x, building.z - smithy.z);
    const travelSpeedMultiplier = typeof worldQueries.getDeliveryTravelSpeedMultiplier === 'function'
      ? worldQueries.getDeliveryTravelSpeedMultiplier(smithy)
      : 1;
    const tripSeconds = Math.max(
      MIN_DELIVERY_TRIP_SEC,
      distance * 2 / (
        TIMBER_DELIVERY_SPEED_MPS
        * Math.max(1e-6, travelSpeedMultiplier)
      ) + TIMBER_DELIVERY_UNLOAD_SEC,
    );
    supplyRoute = `staffed smithy · ${distance.toFixed(0)}m delivery road · about ${tripSeconds.toFixed(0)}s per refill run`;
  } else {
    supplyRoute = 'no road-reachable staffed smithy';
  }
  return `
    <li><span>${toolLabel}</span><span>${plan.maintained ? maintainedLabel : baselineLabel}</span></li>
    <li><span>Tool wear</span><span>${wear}</span></li>
    <li><span>Rack refill</span><span>${refillRule}</span></li>
    <li><span>Smithy route</span><span>${supplyRoute} · only smithy carts refill this rack; finished ironwork held at a market does not</span></li>
  `;
}

export function buildingRoadAccessRow(worldQueries: WorldQueries, building: BuildingState): string {
  const roadAccess = worldQueries.getRoadAccessLabel(building.x, building.z);
  return `<li><span>Road access</span><span>${roadAccess}</span></li>`;
}

export function buildingDemolishHint(kind: BuildingKind): string {
  const cost = getBuildingCost(kind);
  const refund = buildingSalvageRefund(kind);
  const fittings = (cost.ironwork ?? 0) > 0
    ? ` and ${refund.ironwork ?? 0} ironwork`
    : '';
  const fittingRate = (cost.ironwork ?? 0) > 0
    ? `, ${Math.round(IRONWORK_SALVAGE_FRACTION * 100)}% ironwork`
    : '';
  return `Leaves about ${refund.timber} timber, ${refund.stone} stone${fittings} at this site (${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone, ${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber${fittingRate} of ${formatBuildingCost(cost)}). Carts must recover it, and the footprint remains occupied until the pile is empty.`;
}

export function buildingLaborView(
  building: BuildingState,
  populationStats: PopulationStats,
  worldQueries?: WorldQueries,
): InspectorLaborView {
  if (building.constructionComplete !== false && !buildingAcceptsLabor(building.kind)) {
    return {
      visible: false,
      count: 0,
      hint: '',
      decreaseDisabled: true,
      increaseDisabled: true,
    };
  }
  if (
    building.constructionComplete === false
    && normalizeConstructionPriority(building.constructionPriority) === CONSTRUCTION_PRIORITY_HOLD
  ) {
    return {
      visible: true,
      count: 0,
      hint: 'Construction is held. Reservations remain earmarked; resume the site before assigning builders.',
      decreaseDisabled: true,
      increaseDisabled: true,
    };
  }

  const maxLabor = maxAssignableLabor(building, populationStats);
  const buildingCap = building.constructionComplete !== false
    ? buildingMaxLabor(building.kind)
    : CONSTRUCTION_MAX_BUILDERS;
  const activeTrip = worldQueries?.getActiveDeliveryTrip?.(building) ?? null;
  const cartWorkers = Math.max(0, activeTrip?.deliveryWorkers ?? 0);
  const reservedOutsideRoster = Math.max(0, activeTrip?.freeHaulerWorkers ?? 0);
  const rosteredWorkersAway = rosteredCartWorkers(building, activeTrip);
  const onsiteWorkers = onsiteBuildingLabor(building, activeTrip);
  const cartLaborHint = cartWorkers <= 0
    ? ''
    : rosteredWorkersAway > 0
      ? ` ${cartWorkers} ${cartWorkers === 1 ? 'worker is' : 'workers are'} traveling with this cart; ${rosteredWorkersAway} ${rosteredWorkersAway === 1 ? 'rostered worker is' : 'rostered workers are'} away, leaving ${onsiteWorkers} on site. Only the on-site crew performs this building's role until return${reservedOutsideRoster > 0 ? ` (${reservedOutsideRoster} additional ${reservedOutsideRoster === 1 ? 'hauler is' : 'haulers are'} reserved outside the roster)` : ''}.`
      : ` ${cartWorkers} ${cartWorkers === 1 ? 'worker is' : 'workers are'} traveling with this cart and already reserved outside this roster.`;
  return {
    visible: true,
    count: building.assignedLabor,
    hint: building.constructionComplete !== false
      ? `${building.assignedLabor}/${buildingCap} workers here · ${populationStats.available} available (${populationStats.total} population, ${populationStats.assigned} committed${populationStats.cartAssigned > 0 ? `, including ${populationStats.cartAssigned} in-transit reservations` : ''}).${cartLaborHint}`
      : `${building.assignedLabor}/${buildingCap} builders · ${populationStats.available} available. Builders construct; unassigned workers fetch every reserved material cart from the best reachable source.`,
    decreaseDisabled: building.assignedLabor <= 0,
    increaseDisabled: building.assignedLabor >= maxLabor,
  };
}

export function buildingCostRows(cost: BuildingResourceCost): string {
  return `
    <li><span>Build cost</span><span>${formatBuildingCost(cost)}</span></li>
  `;
}

export function buildingExtentRow(kind: BuildingKind): string {
  const definition = getBuildingDefinition(kind);
  const extent = getBuildingExtent(kind, definition.workRadius);
  if (!extent) return '';
  return `<li><span>${extent.label}</span><span>${extent.radius} m</span></li>`;
}

export function treeCountRows(matureTrees: number, stumpTrees: number, growingTrees: number): string {
  return `
    <li><span>Mature trees</span><span>${matureTrees}</span></li>
    <li><span>Stumps</span><span>${stumpTrees}</span></li>
    <li><span>Growing saplings</span><span>${growingTrees}</span></li>
  `;
}
