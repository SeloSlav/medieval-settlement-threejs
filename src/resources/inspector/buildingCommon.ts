import type { BuildingResourceCost } from '../buildingEconomy.ts';
import { getBuildingExtent } from '../../buildings/buildingExtents.ts';
import {
  buildingSalvageRefund,
  formatBuildingCost,
  getBuildingCost,
  GOLD_SALVAGE_FRACTION,
  IRONWORK_SALVAGE_FRACTION,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
} from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import {
  buildingAcceptsLabor,
  buildingMaxLabor,
  maxAssignableLabor,
  type PopulationStats,
} from '../resourceTotals.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import type { InspectorLaborView } from './renderInspectableTarget.ts';
import { renderBuildingResourceCost, renderResourceAmount } from '../../ui/resourceCost.ts';
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
import {
  rosteredCartWorkers,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import {
  civilianToolPlan,
  farmToolWorkerDayRunway,
} from '../../economy/civilianToolPolicy.ts';
import {
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
} from '../../generated/gameBalance.ts';
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
  const wearAmount = isFarmstead
    ? FARM_TOOL_IRONWORK_PER_WORKER_DAY
    : CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
  const wear = isFarmstead
    ? `${renderResourceAmount('ironwork', wearAmount, { compact: true, suffix: 'per completed worker-day' })} · wear follows actual field progress`
    : isGrainMill
      ? `${renderResourceAmount('ironwork', wearAmount, { compact: true, suffix: 'per completed milling cycle' })} · dressing hammers, gudgeons, and fittings share the smithy buffer`
      : `${renderResourceAmount('ironwork', wearAmount, { compact: true, suffix: 'per completed cycle' })} · partial batches wear tools in proportion to real output`;
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
    ? `${renderResourceAmount('ironwork', plan.refillAmount, { compact: true, suffix: 'requested' })} · refill to ${Math.ceil(plan.refillTarget)} (${refillWork})`
    : `reorders below ${Math.ceil(plan.reorderStock)} · next cart refills to ${Math.ceil(plan.refillTarget)}`;
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
    supplyRoute = `${Math.round(inboundIronwork.amount)} ironwork inbound · ${remainingSeconds.toFixed(0)}s ETA`;
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
  const roofTiles = (cost.roofTiles ?? 0) > 0
    ? ` and ${refund.roofTiles ?? 0} roof tiles`
    : '';
  const gold = (cost.gold ?? 0) > 0
    ? ` and ${refund.gold ?? 0} gold`
    : '';
  const fittingRate = (cost.ironwork ?? 0) > 0
    ? `, ${Math.round(IRONWORK_SALVAGE_FRACTION * 100)}% ironwork`
    : '';
  const goldRate = (cost.gold ?? 0) > 0
    ? `, ${Math.round(GOLD_SALVAGE_FRACTION * 100)}% gold`
    : '';
  return `Leaves about ${refund.timber} timber, ${refund.stone} stone${fittings}${roofTiles}${gold} at this site (${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone, ${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber${fittingRate}${goldRate} of ${formatBuildingCost(cost)}). Carts must recover it, and the footprint remains occupied until the pile is empty.`;
}

export function buildingLaborView(
  building: BuildingState,
  populationStats: PopulationStats,
  worldQueries?: WorldQueries,
  laborTrips?: Iterable<DeliveryTripState> | null,
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
  const buildingCap = building.constructionComplete !== false
    ? buildingMaxLabor(building.kind)
    : CONSTRUCTION_MAX_BUILDERS;
  if (
    building.constructionComplete === false
    && normalizeConstructionPriority(building.constructionPriority) === CONSTRUCTION_PRIORITY_HOLD
  ) {
    return {
      visible: true,
      count: 0,
      maxCount: buildingCap,
      hint: 'Construction is held. Reservations remain earmarked; resume the site before assigning builders.',
      decreaseDisabled: true,
      increaseDisabled: true,
    };
  }

  const maxLabor = maxAssignableLabor(building, populationStats);
  const dedicatedCartHaulers = building.constructionComplete !== false
    && (building.kind === 'village_storehouse' || building.kind === 'trading_post');
  const activeTrips = laborTrips == null
    ? [worldQueries?.getActiveDeliveryTrip?.(building) ?? null].filter(
        (trip): trip is DeliveryTripState => trip != null,
      )
    : [...laborTrips];
  const cartWorkers = activeTrips.reduce(
    (total, trip) => total + Math.max(0, trip.deliveryWorkers),
    0,
  );
  const reservedOutsideRoster = activeTrips.reduce(
    (total, trip) => total + Math.max(0, trip.freeHaulerWorkers),
    0,
  );
  const rosteredWorkersAway = Math.min(
    Math.max(0, building.assignedLabor),
    activeTrips.reduce(
      (total, trip) => total + rosteredCartWorkers(building, trip),
      0,
    ),
  );
  const onsiteWorkers = Math.max(0, building.assignedLabor - rosteredWorkersAway);
  const cartCount = activeTrips.length;
  const cartLaborHint = cartWorkers <= 0
    ? ''
    : rosteredWorkersAway > 0
      ? ` ${cartWorkers} ${cartWorkers === 1 ? 'worker is' : 'workers are'} traveling with ${cartCount === 1 ? 'this cart' : `${cartCount} carts`}; ${rosteredWorkersAway} ${rosteredWorkersAway === 1 ? 'rostered worker is' : 'rostered workers are'} away, leaving ${onsiteWorkers} on site. Only the on-site crew performs this building's role until return${reservedOutsideRoster > 0 ? ` (${reservedOutsideRoster} additional ${reservedOutsideRoster === 1 ? 'hauler is' : 'haulers are'} reserved outside the roster)` : ''}.`
      : ` ${cartWorkers} ${cartWorkers === 1 ? 'worker is' : 'workers are'} traveling with ${cartCount === 1 ? 'this cart' : `${cartCount} carts`} and already reserved outside this roster.`;
  const workforceNoun = building.kind === 'monastery'
    ? 'monks assigned'
    : dedicatedCartHaulers
      ? 'dedicated cart haulers'
      : 'workers here';
  const smallholdingLaborHint = populationStats.dedicatedSmallholding > 0
    ? `; ${populationStats.dedicatedSmallholding} healthy Smallholding resident${populationStats.dedicatedSmallholding === 1 ? ' is' : 's are'} dedicated to backyard work and cannot be assigned here`
    : '';
  return {
    visible: true,
    label: building.kind === 'monastery'
      ? 'Monastic community'
      : dedicatedCartHaulers
        ? 'Cart haulers'
        : 'Workforce',
    count: building.assignedLabor,
    maxCount: buildingCap,
    hint: building.constructionComplete !== false
      ? `${building.assignedLabor}/${buildingCap} ${workforceNoun} · ${populationStats.available} reserve workers can be assigned (${populationStats.total} population, ${populationStats.assigned} explicitly rostered${populationStats.flexibleAssigned > 0 ? `, ${populationStats.flexibleAssigned} currently on flexible tasks` : ''}${smallholdingLaborHint}).${cartLaborHint}`
      : `${building.assignedLabor}/${buildingCap} builders · ${populationStats.idle} reserve workers currently idle (${populationStats.available} total reserve${smallholdingLaborHint}).${cartLaborHint} Builders construct while onsite; if no hauler is idle at a material limit, site builders may operate distinctly reserved carts while one remains ready for the first load. A lone builder may haul to break a bootstrap deadlock.`,
    decreaseDisabled: building.assignedLabor <= 0,
    increaseDisabled: building.assignedLabor >= maxLabor,
  };
}

export function buildingCostRows(cost: BuildingResourceCost): string {
  return `
    <li data-inspector-secondary><span>Build cost</span><span>${renderBuildingResourceCost(cost)}</span></li>
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
