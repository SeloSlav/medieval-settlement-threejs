import { getBuildingDefinition } from '../buildings.ts';
import {
  CARPENTER_DELIVERY_SPEED_MULTIPLIER,
  CARPENTER_IRONWORK_PER_POLEARM,
  CARPENTER_TIMBER_COST_MULTIPLIER,
  CARPENTER_TIMBER_PER_POLEARM,
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  GRAIN_TRANSFER_PER_TRIP,
  MONASTERY_CHARITY_FOOD_PER_DELIVERY,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
  TEXTILE_TRANSFER_PER_TRIP,
} from '../../generated/gameBalance.ts';
import { roadDeliveryTripSeconds } from '../../logistics/deliveryLogistics.ts';
import {
  granaryDispatchPriorityLabel,
  institutionalFoodSurplus,
} from '../../logistics/foodLogistics.ts';
import { compareStableEntityIds } from '../../logistics/roadLogistics.ts';
import {
  formatGrainWorkingBuffer,
  GRAIN_CRITICAL_RUNWAY_CYCLES,
} from '../../logistics/grainLogistics.ts';
import type { BuildingKind, BuildingState, InspectableTarget } from '../types.ts';
import { buildingDemolishHint, buildingExtentRow, buildingLaborView, buildingRoadAccessRow, buildingStorageRows } from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import { renderInboundSupplyRow, renderOutboundDeliveryRows, type DeliveryStatusContext } from './deliveryStatusRows.ts';
import {
  onsiteBuildingLabor,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  DEFAULT_MONASTERY_POLICY,
  formatMonasteryFoodCharityTotal,
  formatMonasteryPilgrimageTotal,
  formatMonasteryTithePaidTotal,
} from '../../economy/monasteryPolicy.ts';
import {
  formatHospitalityRunway,
  monasteryHospitalityPlan,
  monasteryHospitalityStatusLabel,
} from '../../economy/monasteryHospitality.ts';
import { formatFreshFoodLoss } from '../../economy/foodPreservation.ts';
import {
  GRANARY_FRESH_FOOD_TARGET_PRESETS,
  GRANARY_GRAIN_RESERVE_PRESETS,
  granaryExportableGrain,
  granaryFreshFoodTarget,
  granaryReserveLabel,
  normalizeGranaryFreshFoodTargetPercent,
  normalizeGranaryGrainReserve,
} from '../../economy/granaryPolicy.ts';
import {
  CARPENTER_POLEARM_RESERVE_PRESETS,
  carpenterArmoryPlan,
} from '../../economy/carpenterArmoryPolicy.ts';
import {
  buildFarmsteadWorkPlan,
  farmsteadSeedGrainRequired,
  type SeasonalWorkPlan,
} from '../../farming/farmWorkPlanning.ts';
import {
  seedGrainSourceCoveragePlan,
  type SeedGrainSourceCoveragePlan,
} from '../../economy/marketplaceSeedCoverage.ts';
import { computeCattleFieldSupport } from '../../farming/cattleFieldSupport.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import { GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS } from '../../security/frontierSecurity.ts';
import {
  isProcessorOutputTargetKind,
  normalizeProcessorOutputTargetPercent,
  PROCESSOR_OUTPUT_TARGET_PRESETS,
  processorInputStagingCycles,
  processorOutputCommodity,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
} from '../../economy/processorOutputPolicy.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';

const PROCESS: Record<string, string> = {
  threshing_barn: 'Farmstead crew works nearby drawn fields',
  watermill: 'Grain + river power → flour',
  granary: 'Buffers grain for processors, bakes staple food, and shelters road-hauled fresh food',
  brewery: 'Grain + water → ale',
  smokehouse: 'Fresh food + firewood → preserved food',
  apiary: 'April-September forest forage → food, monastery hospitality, or export honey',
  vineyard: 'September-October grape harvest → food, monastery hospitality, or export wine',
  monastery: 'Tithes + food + hospitality stores → charity, feasts, pilgrimages',
  carpenter: 'Timber + imported iron heads → polearms and cartwright support',
  weaver: 'Annual sheep fleece → woven cloth → tier-3 households, then marketplace export',
  ferry_landing: 'River crossing → regional trade income',
};

const OUTBOUND_SUPPLY_KINDS = new Set<BuildingKind>([
  'threshing_barn',
  'watermill',
  'granary',
  'brewery',
  'smokehouse',
  'apiary',
  'vineyard',
  'monastery',
  'carpenter',
  'weaver',
]);

const HOUSEHOLD_FOOD_DISTRIBUTORS = new Set<BuildingKind>([
  'granary',
  'apiary',
  'vineyard',
  'monastery',
]);

function buildingHasOutboundStock(building: BuildingState, protectedSeedGrain = 0): boolean {
  switch (building.kind) {
    case 'threshing_barn':
      return building.grain > protectedSeedGrain + 1e-6;
    case 'watermill':
      return building.flour > 0;
    case 'granary':
      return building.food > 0
        || granaryExportableGrain(
          building.grain,
          building.granaryGrainReserve ?? 0,
        ) > 1e-6;
    case 'brewery':
      return building.ale > 0;
    case 'smokehouse':
      return building.preservedFood > 0;
    case 'apiary':
      return building.honey > 0 || building.food > 0;
    case 'vineyard':
      return building.wine > 0 || building.food > 0;
    case 'monastery':
      return building.food > 0;
    case 'carpenter':
      return (building.polearms ?? 0) > 0;
    case 'weaver':
      return (building.cloth ?? 0) > 0;
    default:
      return false;
  }
}

function outboundDestinationLabel(building: BuildingState): string {
  switch (building.kind) {
    case 'threshing_barn':
      return 'Highest-priority active processor, then lowest runway and granary reserve';
    case 'watermill':
      return 'Highest-priority flour-short bakery, then lowest runway and road route';
    case 'granary':
      return 'Priority-selected critical processor first · otherwise food policy, then that processor';
    case 'brewery':
      return 'Monastery, claimed tier-3 home, then road-linked export market';
    case 'smokehouse':
      return 'Lowest-runway claimed tier-3 home';
    case 'apiary':
    case 'vineyard':
      return 'Claimed food-needy home, then provisioned monastery, then export market';
    case 'monastery':
      return 'Claimed parish home needing food';
    case 'carpenter':
      return 'Nearest road-linked guardhouse';
    case 'weaver':
      return 'Lowest-runway claimed tier-3 home, then road-linked export market';
    default:
      return 'Awaiting destination';
  }
}

function cargoPerTripLabel(building: BuildingState): string | null {
  switch (building.kind) {
    case 'threshing_barn':
    case 'granary':
    case 'watermill':
    case 'brewery':
    case 'apiary':
    case 'vineyard':
      return `${GRAIN_TRANSFER_PER_TRIP} per haul`;
    case 'weaver':
      return `2 cloth per household haul · ${TEXTILE_TRANSFER_PER_TRIP} per market haul`;
    case 'monastery':
      return `${MONASTERY_CHARITY_FOOD_PER_DELIVERY} food per charity haul`;
    default:
      return null;
  }
}

function outboundTargetKinds(kind: BuildingKind): BuildingKind[] {
  switch (kind) {
    case 'threshing_barn':
      return ['watermill', 'brewery', 'granary', 'monastery'];
    case 'watermill':
      return ['granary'];
    case 'granary':
      return ['smokehouse'];
    case 'apiary':
    case 'vineyard':
      return ['marketplace'];
    case 'carpenter':
      return ['guardhouse'];
    case 'weaver':
      return ['marketplace'];
    default:
      return [];
  }
}

function outboundTripTarget(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): { id?: string; x: number; z: number } | null {
  if (building.kind === 'threshing_barn') {
    return context.worldQueries.getNextFarmGrainDispatch(building)?.target ?? null;
  }
  if (building.kind === 'watermill') {
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'flour',
    )?.target ?? null;
  }
  if (building.kind === 'brewery') {
    const monastery = context.worldQueries.findNearestRoadLinkedBuilding(
      building,
      ['monastery'],
    );
    if (monastery) return monastery;
    const home = context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'ale');
    if (home) return home;
    return context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'apiary' || building.kind === 'vineyard') {
    const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
    const hospitalityTarget = policy.feastsEnabled
      ? context.worldQueries.getNextMonasteryHospitalityTarget(
          building,
          building.kind === 'apiary' ? 'honey' : 'wine',
        )
      : null;
    return context.worldQueries.getNextFoodDeliveryTargetForSupplier(building)
      ?? hospitalityTarget
      ?? context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'weaver') {
    return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'cloth')
      ?? context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'granary') {
    if (
      seedPlan?.nextDispatchBuildingId != null
      && seedPlan.nextDispatchAmount > 0.05
    ) {
      const seedTarget = context.gameState.buildings.get(
        seedPlan.nextDispatchBuildingId,
      );
      if (seedTarget) return seedTarget;
    }
    const grainDispatch = context.worldQueries.getNextGranaryGrainDispatch(building);
    const guardFoodDispatch = context.conflictEnabled
      ? context.worldQueries.getNextGranaryGuardFoodDispatch(building)
      : null;
    const grainIsCritical = grainDispatch != null
      && grainDispatch.runwayCycles < GRAIN_CRITICAL_RUNWAY_CYCLES;
    const guardFoodPreemptsGrain = guardFoodDispatch != null
      && (
        !grainIsCritical
        || grainDispatch != null && (() => {
          const guardUrgency = guardFoodDispatch.runwayDays
            / GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS;
          const grainUrgency = grainDispatch.runwayCycles
            / GRAIN_CRITICAL_RUNWAY_CYCLES;
          return guardUrgency < grainUrgency - 1e-9
            || (
              Math.abs(guardUrgency - grainUrgency) <= 1e-9
              && compareStableEntityIds(
                guardFoodDispatch.target.id,
                grainDispatch.target.id,
              ) < 0
            );
        })()
      );
    if (guardFoodPreemptsGrain) {
      return guardFoodDispatch.target;
    }
    if (grainIsCritical) {
      return grainDispatch.target;
    }
    if (building.food > 1e-6) {
      const householdTarget =
        context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
      const preservationTarget = context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        'food',
      )?.target ?? null;
      const foodTarget = building.granaryHouseholdsFirst === true
        ? householdTarget ?? preservationTarget
        : preservationTarget ?? householdTarget;
      if (foodTarget) return foodTarget;
    }
    return grainDispatch?.target ?? null;
  }

  const buildingTarget = context.worldQueries.findNearestRoadLinkedBuilding(
    building,
    outboundTargetKinds(building.kind),
  );
  if (buildingTarget) return buildingTarget;

  switch (building.kind) {
    case 'monastery':
      return context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
    case 'smokehouse':
      return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
        building,
        'preservedFood',
      );
    default:
      return null;
  }
}

function plannedOutboundTripSeconds(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): number {
  const network = context.worldQueries.getRoadNetworkSnapshot();
  const target = outboundTripTarget(building, context, seedPlan);
  const granaryIsSendingBuildingSupply = building.kind === 'granary'
    && target?.id != null
    && context.gameState.buildings.has(target.id);
  const weaverIsSendingHouseholdSupply = building.kind === 'weaver'
    && target?.id != null
    && context.gameState.residences.has(target.id);
  const speed = building.kind === 'monastery' || (building.kind === 'granary' && !granaryIsSendingBuildingSupply) || building.kind === 'brewery' || building.kind === 'smokehouse' || weaverIsSendingHouseholdSupply
    ? FOOD_DELIVERY_SPEED_MPS
    : TIMBER_DELIVERY_SPEED_MPS;
  const unload = building.kind === 'monastery' || (building.kind === 'granary' && !granaryIsSendingBuildingSupply) || building.kind === 'brewery' || building.kind === 'smokehouse' || weaverIsSendingHouseholdSupply
    ? FOOD_DELIVERY_UNLOAD_SEC
    : TIMBER_DELIVERY_UNLOAD_SEC;
  return roadDeliveryTripSeconds(
    network,
    building,
    target,
    speed,
    1,
    unload,
    context.worldQueries.getDeliveryTravelSpeedMultiplier(building),
  );
}

function renderLogisticsRows(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): string {
  if (!OUTBOUND_SUPPLY_KINDS.has(building.kind)) return '';

  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const protectedSeedGrain = building.kind === 'threshing_barn'
    ? farmsteadSeedGrainRequired(
        [...context.gameState.farmFields.values()]
          .filter((field) => field.farmsteadId === building.id),
      )
    : 0;
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const seedDispatchReady = building.kind === 'granary'
    && seedPlan?.nextDispatchAmount != null
    && seedPlan.nextDispatchAmount > 0.05;
  const activeSeedCollection = building.kind === 'granary'
    && activeTrip?.cargoKind === 'grain'
    && activeTrip.targetBuildingId != null
    && context.gameState.buildings.get(activeTrip.targetBuildingId)?.kind === 'threshing_barn';
  const seedHaulUsesHoldingCrew = seedDispatchReady || activeSeedCollection;
  const flourDispatch = building.kind === 'watermill'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'flour')
    : null;
  const destination = seedHaulUsesHoldingCrew
    ? 'Least-covered staffed farmstead, then shorter road'
    : flourDispatch
      ? flourDispatch.duty === 'working-buffer'
        ? `${context.worldQueries.getBuildingLabel(flourDispatch.target.kind)} · ${staffingPriorityLabel(flourDispatch.workPriority)} priority · ${flourDispatch.target.flour.toFixed(1)} / ${flourDispatch.desiredStock.toFixed(1)} flour · ${flourDispatch.runwayCycles.toFixed(1)} cycles`
        : `${context.worldQueries.getBuildingLabel(flourDispatch.target.kind)} · overflow after active bakery buffers · shortest road`
      : outboundDestinationLabel(building);
  const nearestTarget = outboundTripTarget(building, context, seedPlan);
  const pathDistance = nearestTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestTarget.x, nearestTarget.z)
    : null;
  const deliveryContext: DeliveryStatusContext = {
    getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    getResidence: (id: string) => context.worldQueries.getResidence(id),
    getBuilding: (id: string) => context.worldQueries.getBuilding(id),
    getBuildingLabel: (kind: BuildingKind) => context.worldQueries.getBuildingLabel(kind),
    getActiveTripPathDistance: (trip: DeliveryTripState) => context.worldQueries.getActiveTripPathDistance(trip),
  };
  const foodTerritoryRows = HOUSEHOLD_FOOD_DISTRIBUTORS.has(building.kind)
    ? (() => {
        const claimed = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
        const next = context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
        return `<li><span>Food territory</span><span>${building.food <= 1e-6 ? 'Yielding while empty' : claimed.length === 0 ? 'None on branch' : `${claimed.length} households claimed`}</span></li>
          <li><span>Next household</span><span>${next ? `Parcel #${next.parcelIndex + 1}` : 'None needing food'}</span></li>`;
      })()
    : '';
  const textileTerritoryRows = building.kind === 'weaver'
    ? (() => {
        const claimed = context.worldQueries.getClaimedResidencesForSpecialtySupplier(
          building,
          'cloth',
        );
        const next = context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
          building,
          'cloth',
        );
        return `<li><span>Textile territory</span><span>${(building.cloth ?? 0) <= 1e-6 ? 'Yielding while empty' : claimed.length === 0 ? 'None on branch' : `${claimed.length} tier-3 households claimed`}</span></li>
          <li><span>Next household</span><span>${next ? `Parcel #${next.parcelIndex + 1}` : 'None needing cloth'}</span></li>`;
      })()
    : '';
  const hospitalityRoutingRows = building.kind === 'apiary' || building.kind === 'vineyard'
    ? (() => {
        const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
        const commodity = building.kind === 'apiary' ? 'honey' : 'wine';
        const target = policy.feastsEnabled
          ? context.worldQueries.getNextMonasteryHospitalityTarget(building, commodity)
          : null;
        return `<li><span>Monastery priority</span><span>${
          !policy.feastsEnabled
            ? 'Disabled — all specialty surplus remains exportable'
            : target
              ? `${context.worldQueries.getBuildingLabel(target.kind)} needs ${commodity}`
              : 'Hospitality stores full or no linked monastery'
        }</span></li>`;
      })()
    : '';
  const householdTerritoryRows =
    foodTerritoryRows + textileTerritoryRows + hospitalityRoutingRows;

  if (!onRoad) {
    return `${householdTerritoryRows}<li><span>Deliveries</span><span>Off road — connect to dispatch hauls</span></li>`;
  }

  const requiresLabor = building.kind !== 'monastery' && !seedHaulUsesHoldingCrew;
  if (requiresLabor && building.assignedLabor === 0) {
    return `${householdTerritoryRows}<li><span>Deliveries</span><span>Idle — assign workers to dispatch hauls</span></li>`;
  }

  if (activeTrip) {
    const tripPath = context.worldQueries.getActiveTripPathDistance(activeTrip);
    return householdTerritoryRows + renderOutboundDeliveryRows(
      activeTrip,
      tripRemaining,
      destination,
      tripPath,
      plannedOutboundTripSeconds(building, context, seedPlan),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  const inboundRow = renderInboundSupplyRow(inboundTrip, deliveryContext);
  if (inboundRow) return householdTerritoryRows + inboundRow;

  if (seedDispatchReady || buildingHasOutboundStock(building, protectedSeedGrain)) {
    return householdTerritoryRows + renderOutboundDeliveryRows(
      null,
      null,
      destination,
      pathDistance,
      plannedOutboundTripSeconds(building, context, seedPlan),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  return `${householdTerritoryRows}<li><span>Deliveries</span><span>Ready — awaiting cargo or destination</span></li>`;
}

function formatGranarySeedCart(
  plan: SeedGrainSourceCoveragePlan | null,
  building: BuildingState,
  context: InspectorRenderContext,
): string {
  if (plan === null) return 'No seed forecast';
  if (!plan.sourceOperational) return 'Blocked while this granary is fire-disabled';
  if (plan.sourceBusy) {
    return 'Cart occupied &middot; least-covered holding recalculates when it returns';
  }
  if (plan.nextDispatchBuildingId === null) {
    if (plan.inboundBlockedHoldings > 0) {
      return `${plan.inboundBlockedHoldings} short holding${plan.inboundBlockedHoldings === 1 ? '' : 's'} already receiving grain &middot; no duplicate cart`;
    }
    if (plan.laborBlockedHoldings > 0) {
      return `${plan.laborBlockedHoldings} short holding${plan.laborBlockedHoldings === 1 ? '' : 's'} blocked by missing farm labor`;
    }
    if (plan.fireBlockedHoldings > 0) {
      return `${plan.fireBlockedHoldings} short holding${plan.fireBlockedHoldings === 1 ? '' : 's'} blocked by fire`;
    }
    if (plan.connectedHoldings <= 0) return 'No active field claim on this road branch';
    if (plan.seedShortfall <= 0.05) return 'Reachable field claims covered';
    return 'No safe staffed road-reachable holding eligible';
  }
  const inspect = `<button type="button" class="inspector-jump-button" data-inspect-building="${plan.nextDispatchBuildingId}" aria-label="Inspect next granary seed-cart holding">Inspect holding</button>`;
  const distance = plan.nextDispatchDistance === null
    ? ''
    : ` &middot; ${plan.nextDispatchDistance.toFixed(0)} m road`;
  if (building.grain <= 0.05 || plan.nextDispatchAmount <= 0.05) {
    return `Awaiting physical grain &middot; next holding ${plan.nextDispatchStock.toFixed(1)} / ${plan.nextDispatchRequired.toFixed(1)} onsite${distance} ${inspect}`;
  }
  const collection = building.assignedLabor <= 0
    ? ' &middot; holding crew collects'
    : '';
  return `${plan.nextDispatchAmount.toFixed(1)} grain &rarr; ${context.worldQueries.getBuildingLabel('threshing_barn')} at ${plan.nextDispatchStock.toFixed(1)} / ${plan.nextDispatchRequired.toFixed(1)} onsite${distance}${collection} ${inspect}`;
}

export function renderExpandedBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries, {
    matureTrees: target.matureTrees,
    month: gameClock(context.gameState.tick).month,
  });
  const armory = building.kind === 'carpenter' && context.conflictEnabled
    ? carpenterArmoryPlan(building)
    : null;
  const carpenterStatus = building.kind === 'carpenter'
    ? building.assignedLabor <= 0
      ? {
          statusText: context.conflictEnabled
            ? 'Idle — assign craftspeople for cartwright work and polearms'
            : 'Idle — assign craftspeople for construction and cart support',
          statusState: 'idle' as const,
        }
      : armory?.reserve === 0
        ? {
            statusText: 'Cart support active — polearm production paused by policy',
            statusState: 'active' as const,
          }
      : armory && armory.shortfall > 0 && building.timber < CARPENTER_TIMBER_PER_POLEARM
        ? { statusText: `Cart support active — polearms need ${CARPENTER_TIMBER_PER_POLEARM} timber each`, statusState: 'warning' as const }
        : armory && armory.shortfall > 0 && (building.ironwork ?? 0) < CARPENTER_IRONWORK_PER_POLEARM
          ? { statusText: 'Cart support active — polearms await market-imported ironwork', statusState: 'warning' as const }
          : armory && armory.shortfall <= 0
            ? {
                statusText: `Cart support active — armory reserve ready (${armory.stock.toFixed(0)}/${armory.reserve})`,
                statusState: 'active' as const,
              }
          : {
              statusText: context.conflictEnabled
                ? 'Supporting carts and fitting polearms'
                : 'Supporting linked construction and cart traffic',
              statusState: 'active' as const,
            }
    : null;
  const fallbackActive = definition.acceptsLabor ? building.assignedLabor > 0 : true;
  const granarySeedPlan = building.kind === 'granary'
    ? seedGrainSourceCoveragePlan(
        building,
        context.gameState,
        (_source, farmstead) => context.worldQueries.getRoadPathDistance(
          building.x,
          building.z,
          farmstead.x,
          farmstead.z,
        ),
      )
    : null;
  const logisticsRows = renderLogisticsRows(building, context, granarySeedPlan);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    gameClock(context.gameState.tick),
  );
  const monasteryPolicy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const hospitality = building.kind === 'monastery'
    ? monasteryHospitalityPlan(building, monasteryPolicy.feastsEnabled)
    : null;
  const monasteryHospitalityRows = hospitality
    ? `<li><span>Hospitality</span><span>${monasteryHospitalityStatusLabel(hospitality)}</span></li>
      <li><span>Honey runway</span><span>${formatHospitalityRunway(hospitality.honeyRunwayDays)} · ${hospitality.honeyPerDay.toFixed(1)}/day + feast use</span></li>
      <li><span>Wine runway</span><span>${formatHospitalityRunway(hospitality.wineRunwayDays)} · ${hospitality.winePerDay.toFixed(1)}/day + feast use</span></li>
      <li><span>Annual hospitality</span><span>${hospitality.honeyPerYear.toFixed(0)} honey + ${hospitality.winePerYear.toFixed(0)} wine at five feast days</span></li>
      <li><span>Pilgrimage income</span><span>${hospitality.pilgrimageGoldPerDay.toFixed(2)} gold/day at current stores · requires chapel and market road link</span></li>`
    : '';
  const monasteryTreasuryRows = building.kind === 'monastery'
    ? (() => {
        const incomingTithe = Array.from(context.gameState.deliveryTrips.values())
          .filter(
            (trip) =>
              trip.targetBuildingId === building.id
              && trip.cargoKind === 'gold'
              && trip.phase !== 'inbound',
          )
          .reduce((sum, trip) => sum + trip.amount, 0);
        return `<li><span>Monastery treasury</span><span>${building.gold.toFixed(1)} gold secured here${incomingTithe > 0.05 ? ` · ${incomingTithe.toFixed(1)} tithe incoming by handcart` : ''}</span></li>`;
      })()
    : '';
  const granaryGrainDispatch = building.kind === 'granary'
    ? context.worldQueries.getNextGranaryGrainDispatch(building)
    : null;
  const granaryGuardFoodDispatch = building.kind === 'granary' && context.conflictEnabled
    ? context.worldQueries.getNextGranaryGuardFoodDispatch(building)
    : null;
  const granaryInstitutionalFood = building.kind === 'granary'
    ? institutionalFoodSurplus(
        building.food,
        context.worldQueries.getClaimedResidencesForFoodSupplier(building).length,
        buildingStorageCaps('granary').food ?? 0,
      )
    : 0;
  const granaryPreservationDispatch = building.kind === 'granary'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'food')
    : null;
  const granaryPreservationDispatchLabel = building.kind === 'granary'
    ? granaryInstitutionalFood <= 1e-6
      ? building.food > 1e-6
        ? 'Household reserve holds current fresh food'
        : 'No fresh food available'
      : granaryPreservationDispatch
        ? granaryPreservationDispatch.duty === 'working-buffer'
          ? `${context.worldQueries.getBuildingLabel(granaryPreservationDispatch.target.kind)} · ${staffingPriorityLabel(granaryPreservationDispatch.workPriority)} priority · ${granaryPreservationDispatch.target.food.toFixed(1)} / ${granaryPreservationDispatch.desiredStock.toFixed(1)} fresh food`
          : `${context.worldQueries.getBuildingLabel(granaryPreservationDispatch.target.kind)} · active buffers covered · nearest overflow route`
        : 'No road-linked smokehouse can receive fresh food'
    : '';
  const granaryExportableStock = building.kind === 'granary'
    ? granaryExportableGrain(
        building.grain,
        building.granaryGrainReserve ?? 0,
      )
    : 0;
  const granaryFoodTargetPercent = building.kind === 'granary'
    ? normalizeGranaryFreshFoodTargetPercent(building.granaryFreshFoodTargetPercent)
    : 75;
  const granaryFoodTarget = building.kind === 'granary'
    ? granaryFreshFoodTarget(
        buildingStorageCaps('granary').food ?? 0,
        granaryFoodTargetPercent,
      )
    : 0;
  const granaryGrainDispatchLabel = building.kind === 'granary'
    ? granaryGrainDispatch
      ? `${context.worldQueries.getBuildingLabel(granaryGrainDispatch.target.kind)} · ${staffingPriorityLabel(granaryGrainDispatch.workPriority)} priority · ${granaryGrainDispatch.target.grain.toFixed(1)} / ${granaryGrainDispatch.desiredStock.toFixed(1)} · ${granaryGrainDispatch.runwayCycles.toFixed(1)} cycles${
          granaryGrainDispatch.runwayCycles < GRAIN_CRITICAL_RUNWAY_CYCLES
            ? ' · critical, preempts food cart'
            : ' · after available food duty'
        }`
      : building.assignedLabor <= 0
        ? 'Idle — assign granary keepers to dispatch'
        : granaryExportableStock <= 1e-6
          ? building.grain > 1e-6
            ? 'Strategic floor holds current grain'
            : 'No exportable grain'
          : 'No staffed road-linked processor below buffer'
    : '';
  const granaryGuardFoodDispatchLabel = building.kind === 'granary' && context.conflictEnabled
    ? granaryGuardFoodDispatch
      ? `${context.worldQueries.getBuildingLabel(granaryGuardFoodDispatch.target.kind)} · ${granaryGuardFoodDispatch.target.food.toFixed(1)} / ${granaryGuardFoodDispatch.desiredStock.toFixed(1)} · ${granaryGuardFoodDispatch.runwayDays.toFixed(1)} days`
      : building.assignedLabor <= 0
        ? 'Idle — assign granary keepers to dispatch'
        : granaryInstitutionalFood <= 1e-6
          ? building.food > 1e-6
            ? 'Household reserve holds current food'
            : 'No food available'
          : `No armed company below ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS}-day emergency floor`
    : '';
  const granaryMilitaryRows = building.kind === 'granary' && context.conflictEnabled
    ? `<li><span>Next guard cart</span><span>${granaryGuardFoodDispatchLabel}</span></li>
      <li><span>Emergency arbitration</span><span>Guard under ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS} days vs priority-selected processor under ${GRAIN_CRITICAL_RUNWAY_CYCLES} cycle · lower relative runway first</span></li>`
    : '';
  const granaryRows = building.kind === 'granary'
    ? `<li><span>Central grain reserve</span><span>${granaryReserveLabel(building)}</span></li>
      <li><span>Seed exception</span><span>Linked farmsteads may draw through the floor; least-covered eligible holding goes first</span></li>
      <li><span>Next seed cart</span><span>${formatGranarySeedCart(granarySeedPlan, building, context)}</span></li>
      <li><span>Next grain cart</span><span>${granaryGrainDispatchLabel}</span></li>
      ${granaryMilitaryRows}
      <li><span>Fresh-food intake</span><span>${building.granaryAcceptsFreshFood === false ? `Local delivery only · ${granaryFoodTargetPercent}% target retained` : `Centralize to ${granaryFoodTargetPercent}% capacity · ${granaryFoodTarget.toFixed(0)} food`}</span></li>
      <li><span>Dispatch priority</span><span>${granaryDispatchPriorityLabel(building.granaryHouseholdsFirst === true)}</span></li>
      <li><span>Next preservation buffer</span><span>${granaryPreservationDispatchLabel}</span></li>
      <li><span>Household priority</span><span>1 food cart per source-claimed home · capped at 50% source storage</span></li>
      <li><span>Sheltered storage</span><span>${Math.round((1 - FRESH_FOOD_STORAGE_GRANARY_FACTOR) * 100)}% less spoilage · ${formatFreshFoodLoss(building.food * environment.freshFoodSpoilageFractionPerDay * FRESH_FOOD_STORAGE_GRANARY_FACTOR)}</span></li>`
    : '';
  const grainProcessorRows = building.kind === 'watermill'
    || building.kind === 'brewery'
    || building.kind === 'monastery'
    ? `<li><span>Grain working buffer</span><span>${formatGrainWorkingBuffer(
        building.grain,
        building.kind,
        building.kind === 'monastery' && !context.worldQueries.isMonasteryLinkedToChapel(building)
          ? MONASTERY_UNLINKED_PRODUCTIVITY
          : 1,
        building.processorOutputTargetPercent,
      )}</span></li>`
    : '';
  const institutionalFoodRows = building.kind === 'smokehouse'
    ? '<li><span>Fresh-food priority</span><span>Collects central surplus only · household delivery reserves stay local</span></li>'
    : '';
  const farmsteadPlanning = building.kind === 'threshing_barn'
    ? renderFarmsteadPlanning(building, context)
    : null;
  const buildingPolicyPanelHtml = building.kind === 'monastery'
    ? renderMonasteryPolicyPanel(context)
    : building.kind === 'threshing_barn'
      ? renderFarmsteadFieldPanel()
      : building.kind === 'granary'
        ? renderGranaryPolicyPanel(building)
        : building.kind === 'carpenter' && context.conflictEnabled
          ? renderCarpenterArmoryPanel(building)
          : undefined;
  const processorPolicyPanelHtml = renderProcessorOutputTargetPanel(building);
  const supplementalPanelHtml = `${buildingPolicyPanelHtml ?? ''}${processorPolicyPanelHtml ?? ''}`
    || undefined;
  const role = building.kind === 'carpenter' && !context.conflictEnabled
    ? 'Timber framing and cartwright support for road-linked building sites'
    : PROCESS[building.kind] ?? 'Settlement service';
  const carpenterSupportRows = building.kind === 'carpenter'
    ? `<li><span>Construction timber</span><span>${Math.round((1 - CARPENTER_TIMBER_COST_MULTIPLIER) * 100)}% less at road-linked sites</span></li>
      <li><span>Cart travel</span><span>${Math.round((CARPENTER_DELIVERY_SPEED_MULTIPLIER - 1) * 100)}% faster from linked origins</span></li>
      <li><span>Support state</span><span>${building.assignedLabor > 0 ? 'Active across this road network' : 'Inactive — requires at least 1 craftsperson'}</span></li>
      ${armory ? `<li><span>Armory reserve</span><span>${armory.reserve <= 0 ? `${armory.stock.toFixed(0)} stored · production paused` : `${armory.stock.toFixed(0)} / ${armory.reserve} polearms`}</span></li>
      <li><span>Inputs to target</span><span>${armory.shortfall <= 0 ? 'Reserve stocked' : `${armory.timberToTarget.toFixed(0)} timber · ${armory.ironworkToTarget.toFixed(0)} imported ironwork`}</span></li>
      <li><span>Company issue</span><span>One polearm per assigned guard · surplus remains here</span></li>` : ''}`
    : '';
  const frontierStockVisible = building.kind !== 'carpenter' || context.conflictEnabled === true;
  return {
    eyebrow: 'Settlement building',
    title: definition.label,
    statusText: carpenterStatus?.statusText ?? processorStatus?.statusText ?? farmsteadPlanning?.statusText ?? (fallbackActive ? 'Operating' : 'Awaiting workers'),
    statusState: carpenterStatus?.statusState ?? processorStatus?.statusState ?? farmsteadPlanning?.statusState ?? (fallbackActive ? 'active' : 'warning'),
    detailsHtml: `<li><span>Role</span><span>${role}</span></li>${carpenterSupportRows}${building.kind === 'carpenter' && context.conflictEnabled ? `<li><span>Polearm batch</span><span>${CARPENTER_TIMBER_PER_POLEARM} timber + ${CARPENTER_IRONWORK_PER_POLEARM} imported ironwork → 1 polearm</span></li>` : ''}${granaryRows}${grainProcessorRows}${institutionalFoodRows}${monasteryHospitalityRows}${monasteryTreasuryRows}${farmsteadPlanning?.rows ?? ''}${processorStatus?.waterDetailHtml ?? ''}${buildingStorageRows(building, building.kind, frontierStockVisible)}${buildingRoadAccessRow(context.worldQueries, building)}${buildingExtentRow(building.kind)}${logisticsRows}`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    ...(supplementalPanelHtml ? { supplementalPanelHtml } : {}),
  };
}

function formatSeasonalWork(plan: SeasonalWorkPlan): string {
  if (plan.requiredWorkerDays <= 1e-6) return 'No cereal work scheduled';
  const base = `${plan.requiredWorkerDays.toFixed(1)} worker-days / ${plan.availableWorkerDays.toFixed(1)} available`;
  return plan.shortfallWorkerDays > 0.05
    ? `${base} · short ${plan.shortfallWorkerDays.toFixed(1)}`
    : `${base} · on plan`;
}

function renderFarmsteadPlanning(
  building: BuildingState,
  context: InspectorRenderContext,
): { rows: string; statusText: string; statusState: 'active' | 'warning' | 'idle' } {
  const clock = gameClock(context.gameState.tick);
  const fields = [...context.gameState.farmFields.values()]
    .filter((field) => field.farmsteadId === building.id);
  const parish = context.getParishPolicy?.();
  const sabbathObserved = Boolean(
    parish?.sabbathObservanceEnabled
    && settlementHasStaffedChapel(context.gameState),
  );
  const cattleSupport = computeCattleFieldSupport(context.gameState);
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const plan = buildFarmsteadWorkPlan(
    fields,
    onsiteLabor,
    clock,
    sabbathObserved,
    cattleSupport,
  );
  const grainRoom = Math.max(0, (buildingStorageCaps(building.kind).grain ?? 0) - building.grain);
  const haulingRequired = plan.expectedHarvest > grainRoom + 1e-6;
  const seasonalRisk = plan.harvest.shortfallWorkerDays > 0.05
    || plan.spring.shortfallWorkerDays > 0.05
    || plan.autumn.shortfallWorkerDays > 0.05;
  const inboundSupply = context.worldQueries.getInboundSupplyTrip(building);
  const inboundSeed = inboundSupply?.cargoKind === 'grain'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const onsiteSeedShortfall = Math.max(0, plan.seedGrainRequired - building.grain);
  const seedShortfall = Math.max(
    0,
    plan.seedGrainRequired - building.grain - inboundSeed,
  );
  const exportableGrain = Math.max(0, building.grain - plan.seedGrainRequired);
  const grainDispatch = context.worldQueries.getNextFarmGrainDispatch(building);
  const grainRoutingLabel = grainDispatch == null
    ? exportableGrain > 1e-6
      ? 'No road-linked capacity'
      : building.grain > 1e-6 && plan.seedGrainRequired > 1e-6
        ? 'Held for linked fields'
        : 'No grain awaiting haul'
    : grainDispatch.duty === 'working-buffer'
      ? `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · ${staffingPriorityLabel(grainDispatch.workPriority)} priority · ${grainDispatch.target.grain.toFixed(1)} / ${grainDispatch.desiredStock.toFixed(1)} working buffer`
      : grainDispatch.duty === 'granary-reserve'
        ? `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · central reserve`
        : `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · emergency overflow`;
  const rotationRows = plan.rotation.activeArea <= 1e-9
    ? '<li><span>Next rotation</span><span>No active field area planned</span></li>'
    : `
      <li><span>Next rotation</span><span>${Math.round(plan.rotation.nextRyeArea)} m² rye · ${Math.round(plan.rotation.nextOatsArea)} m² oats · ${Math.round(plan.rotation.nextFallowArea)} m² worked fallow</span></li>
      <li><span>Soil trajectory</span><span>${Math.round(plan.rotation.currentAverageFertility * 100)}% now → ${Math.round(plan.rotation.afterCurrentAverageFertility * 100)}% after current crops → ${Math.round(plan.rotation.afterPlannedAverageFertility * 100)}% after the plan${plan.rotation.weakestFieldId && plan.rotation.lowestPlannedFertility !== null ? ` · weakest ${Math.round(plan.rotation.lowestPlannedFertility * 100)}% <button type="button" class="inspector-jump-button" data-inspect-field="${plan.rotation.weakestFieldId}" aria-label="Inspect weakest planned field">Inspect</button>` : ''}</span></li>
      <li><span>Next-cycle potential</span><span>${plan.rotation.plannedHarvest.toFixed(1)} grain at current moisture · ${plan.rotation.plannedSeedGrainRequired.toFixed(1)} seed · future manure excluded</span></li>
    `;
  const rows = `
    <li><span>Linked fields</span><span>${plan.activeFields} active${plan.pausedFields > 0 ? ` · ${plan.pausedFields} paused` : ''}</span></li>
    <li><span>Ox-supported fields</span><span>${plan.cattleSupportedFields} / ${plan.activeFields} active · labor forecast includes faster ploughing</span></li>
    ${rotationRows}
    <li><span>September labor</span><span>${formatSeasonalWork(plan.harvest)}</span></li>
    <li><span>Spring oats labor</span><span>${formatSeasonalWork(plan.spring)}</span></li>
    <li><span>Autumn rye/fallow labor</span><span>${formatSeasonalWork(plan.autumn)}</span></li>
    <li><span>Seed grain</span><span>${Math.min(building.grain, plan.seedGrainRequired).toFixed(1)} onsite${inboundSeed > 0.05 ? ` + ${inboundSeed.toFixed(1)} inbound` : ''} / ${plan.seedGrainRequired.toFixed(1)} protected${seedShortfall > 0.05 ? ` · still short ${seedShortfall.toFixed(1)}` : ''}</span></li>
    <li><span>Exportable grain</span><span>${exportableGrain.toFixed(1)} after sowing reserve</span></li>
    <li><span>${clock.month === 9 ? 'Harvest remaining' : 'Harvest potential'}</span><span>${plan.expectedHarvest.toFixed(1)} grain</span></li>
    <li><span>Harvest storage</span><span>${grainRoom.toFixed(1)} onsite room${haulingRequired ? ' · road hauling required' : ' · fits onsite'}</span></li>
    <li><span>Next grain haul</span><span>${grainRoutingLabel}</span></li>
    <li><span>Grain policy</span><span>Linked-field seed · processor work priority · lowest cycle runway · granary · overflow</span></li>
  `;

  if (fields.length === 0) {
    return { rows, statusText: 'No fields laid out', statusState: 'idle' };
  }
  if (plan.activeFields === 0) {
    return { rows, statusText: 'All linked fields are paused', statusState: 'idle' };
  }
  if (onsiteLabor <= 0) {
    return {
      rows,
      statusText: building.assignedLabor > 0
        ? 'Field work paused - the farm crew is away with its cart'
        : 'Fields waiting - assign a farm crew',
      statusState: 'warning',
    };
  }
  if (onsiteSeedShortfall > 0.05 && inboundSeed > 0.05) {
    return {
      rows,
      statusText: seedShortfall > 0.05
        ? `Seed cart inbound — ${seedShortfall.toFixed(1)} grain will still be needed`
        : 'Seed cart inbound — sowing resumes after unloading',
      statusState: 'warning',
    };
  }
  if (seedShortfall > 0.05 && (clock.month >= 9 || clock.month <= 4)) {
    return {
      rows,
      statusText: `Sowing at risk — connect stored or market-imported grain, or pause fields (short ${seedShortfall.toFixed(1)})`,
      statusState: 'warning',
    };
  }
  if (seasonalRisk) {
    return { rows, statusText: 'Season at risk — add labor or pause low-priority fields', statusState: 'warning' };
  }
  if (haulingRequired && clock.month === 9) {
    return { rows, statusText: 'Harvest needs continuous grain hauling', statusState: 'warning' };
  }
  return { rows, statusText: 'Farm calendar on plan', statusState: 'active' };
}

export function renderGranaryPolicyPanel(building: BuildingState): string {
  const householdsFirst = building.granaryHouseholdsFirst === true;
  const grainReserve = normalizeGranaryGrainReserve(building.granaryGrainReserve ?? 0);
  const freshFoodTargetPercent = normalizeGranaryFreshFoodTargetPercent(
    building.granaryFreshFoodTargetPercent,
  );
  const freshFoodTarget = granaryFreshFoodTarget(
    buildingStorageCaps('granary').food ?? 0,
    freshFoodTargetPercent,
  );
  const priorityHint = householdsFirst
    ? 'Household-first sends the next available cart to the lowest-runway claimed home. If no home can receive food, the granary falls through to the highest-priority smokehouse working buffer.'
    : 'Preservation-first restores the highest-priority smokehouse working buffer before route distance. If no smokehouse can receive food, the granary immediately falls through to its lowest-runway claimed home.';
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Centralizing fresh food sharply reduces spoilage but consumes a road haul before the granary can redistribute it. Every routine food supplier keeps one household cart per claimed home, capped at half its storage, before any granary, smokehouse, or guardhouse cart may load.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-granary-accepts-fresh-food ${building.granaryAcceptsFreshFood === false ? '' : 'checked'} /><span>Collect fresh-food surplus</span></label>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-granary-households-first ${householdsFirst ? 'checked' : ''} /><span>Feed households before smokehouses</span></label>
      <p class="inspector-action-panel__hint">${priorityHint}</p>
      <p class="resource-inspector-note">Fresh-food intake target — lower settings reduce collection-cart pressure and keep stock near its source territory; higher settings shelter more food from spoilage for winter and preservation.</p>
      <div class="resource-action-row">${GRANARY_FRESH_FOOD_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-granary-fresh-food-target="${preset.percent}" title="${preset.hint}" ${freshFoodTargetPercent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Current target ${freshFoodTarget.toFixed(0)} food. Intake stops at this level, but household, smokehouse, and guard carts may continue drawing stock.</p>
      <p class="resource-inspector-note">Strategic grain floor — mills, brewers, monasteries, and foreign sales cannot draw below it. Linked farmsteads may still take this grain when they need seed.</p>
      <div class="resource-action-row">${GRANARY_GRAIN_RESERVE_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-granary-grain-reserve="${preset.reserve}" ${grainReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">A staffed granary collects only stock above local reserves until its selected target. Producers with no claimed homes can send their whole stock. Staff are required for both delivery duties.</p>
    </div>
  `;
}

export function renderProcessorOutputTargetPanel(building: BuildingState): string | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  const percent = normalizeProcessorOutputTargetPercent(
    building.processorOutputTargetPercent,
  );
  const output = processorOutputCommodity(building.kind);
  const stagingCycles = processorInputStagingCycles(percent);
  const stagingLabel = `${stagingCycles} input ${stagingCycles === 1 ? 'cycle' : 'cycles'}`;
  const label = output === 'preservedFood' ? 'preserved food' : output;
  const stock = Math.max(0, building[output] ?? 0);
  const target = processorOutputTargetForBuilding(building) ?? 0;
  const headroom = processorOutputHeadroom(building) ?? 0;
  const pressure = headroom > 0.05
    ? `${headroom.toFixed(0)} production headroom`
    : stock > target + 0.05
      ? `${(stock - target).toFixed(0)} above target · still available`
      : 'Production paused at target';
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Stock policy · stages ${stagingLabel} · finished ${label} ${stock.toFixed(0)} / ${target.toFixed(0)} · ${pressure}</p>
      <div class="resource-action-row">${PROCESSOR_OUTPUT_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-processor-output-target="${preset.percent}" title="${preset.hint}" ${percent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">This policy sets both the on-site input staging depth and the finished-goods ceiling. Routine input top-ups stop at the staged-cycle target; a producer may still use the workshop as last-resort overflow when normal storage cannot receive its cargo. Finished-goods deliveries may draw below the ceiling and restart work. It is not a protected reserve, and a cart already on the road may still arrive after you lower it.</p>
    </div>
  `;
}

function renderCarpenterArmoryPanel(building: BuildingState): string {
  const armory = carpenterArmoryPlan(building);
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Finished polearm reserve — the workshop stops consuming timber and imported ironwork when this target is stocked.</p>
      <div class="resource-action-row">${CARPENTER_POLEARM_RESERVE_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-carpenter-polearm-reserve="${preset.reserve}" ${armory.reserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Carpenters first issue one weapon to each assigned guard, then rebuild this local reserve. “Cartwright only” preserves imported fittings and timber while retaining road-linked construction and cart bonuses.</p>
    </div>
  `;
}

function renderFarmsteadFieldPanel(): string {
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Lay out cultivated land for this farmstead. Its crew will exclusively plough, sow, tend, and harvest the linked fields.</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button" data-land-parcel="field">Lay out farm field</button>
      </div>
    </div>
  `;
}

function renderMonasteryPolicyPanel(context: InspectorRenderContext): string {
  const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">The monastery decides how much parish tithe supports alms and whether apiaries and vineyards provision hospitality before exporting their surplus.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-monastery-feasts ${policy.feastsEnabled ? 'checked' : ''} /><span>Provision hospitality and feast days</span></label>
      <p class="inspector-action-panel__hint">Enabled monasteries consume ${MONASTERY_HOSPITALITY_HONEY_PER_DAY.toFixed(1)} honey and ${MONASTERY_HOSPITALITY_WINE_PER_DAY.toFixed(1)} wine per day, with extra feast-day use, raising linked pilgrimage income from ${MONASTERY_PILGRIMAGE_GOLD_PER_DAY.toFixed(1)} to as much as ${(MONASTERY_PILGRIMAGE_GOLD_PER_DAY + MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY).toFixed(1)} gold per day. Disable this to leave all honey and wine available for export.</p>
      <label class="city-admin-panel__slider-label"><span>Parish tithe share</span><strong data-policy-monastery-tithe-value>${Math.round(policy.titheShare * 100)}%</strong></label>
      <input class="city-admin-panel__slider" type="range" data-policy-monastery-tithe min="0" max="80" step="5" value="${Math.round(policy.titheShare * 100)}" />
      <div class="city-admin-panel__range-hints"><span>Chapel keeps all</span><span>Monastery-led</span></div>
      <p class="inspector-action-panel__hint">Lifetime: ${formatMonasteryTithePaidTotal(policy.tithePaidTotal)} · ${formatMonasteryPilgrimageTotal(policy.pilgrimageGoldTotal)} · ${formatMonasteryFoodCharityTotal(policy.foodCharityTotal)}</p>
    </div>
  `;
}
