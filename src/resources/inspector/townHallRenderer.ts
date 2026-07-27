import {
  ECONOMIC_ACTIVITY_TAX_RATE_MAX,
  ECONOMIC_ACTIVITY_TAX_RATE_MIN,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY } from '../../economy/monasteryPolicy.ts';
import {
  constructionLaborStewardStatus,
  DEFAULT_LABOR_STEWARD_RESERVE,
  laborStewardReserveLabel,
  LABOR_STEWARD_RESERVE_OPTIONS,
  normalizeLaborStewardReserve,
  productionLaborStewardStatus,
  seasonalLaborStewardStatus,
} from '../../economy/laborSteward.ts';
import {
  computeSettlementLaborStewardForecast,
  type SettlementLaborStewardForecast,
} from '../../economy/laborStewardForecast.ts';
import { monasteryHospitalityPlan } from '../../economy/monasteryHospitality.ts';
import { computeSettlementLivestockFodderPlan } from '../../economy/livestockFodder.ts';
import { buildVillageAdminReadout } from '../../economy/villageAdminReadout.ts';
import {
  computeSettlementProvisioning,
  formatHouseholdBufferReadiness,
  formatProvisionRunway,
  formatSabbathReadiness,
  WINTER_RESERVE_DAYS,
} from '../../economy/settlementProvisioning.ts';
import {
  formatFreshFoodLoss,
  type FreshFoodLossSite,
  type FreshFoodPreservation,
  type GranaryFreshFoodNetwork,
} from '../../economy/foodPreservation.ts';
import { computeSettlementGranaryReserve } from '../../economy/granaryPolicy.ts';
import {
  computeSettlementGrainPlan,
  GRAIN_PLAN_DAYS_PER_YEAR,
  type SettlementGrainPlan,
} from '../../economy/settlementGrainPlan.ts';
import {
  computeSettlementSeedProcurementPlan,
  type SettlementSeedProcurementAttention,
  type SettlementSeedProcurementPlan,
} from '../../economy/settlementSeedProcurement.ts';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
} from '../../economy/marketplaceSeedPolicy.ts';
import { marketplaceTradeOfferCost } from '../../economy/marketplaceTrade.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../../economy/regionalMarket.ts';
import { computeSettlementGrowthPlan, type SettlementGrowthPlan } from '../../economy/settlementGrowth.ts';
import {
  computeSettlementConstructionPlan,
  constructionQueueStatusLabel,
  type ConstructionMaterialQueue,
  type SettlementConstructionPlan,
} from '../../economy/settlementConstruction.ts';
import {
  computeSettlementConstructionLaborPlan,
  type SettlementConstructionLaborPlan,
} from '../../economy/constructionLabor.ts';
import {
  computeSettlementYearRoundLaborRotation,
  type SettlementYearRoundLaborRotation,
} from '../../economy/yearRoundLabor.ts';
import {
  computeSettlementWorksiteStallPlan,
  type SettlementWorksiteStallPlan,
} from '../../economy/settlementWorksiteStalls.ts';
import {
  computeSettlementLaborPlan,
  LABOR_SECTORS,
  LABOR_SECTOR_LABELS,
  type SettlementLaborPlan,
  type StorehouseNetworkPlan,
} from '../../economy/settlementLabor.ts';
import {
  computeSettlementSeasonalCallupPlan,
  computeSettlementSeasonalLaborPlan,
  type SettlementSeasonalCallupPlan,
  type SettlementSeasonalLaborPlan,
} from '../../economy/seasonalLabor.ts';
import {
  computeSettlementProcessorLaborCallupPlan,
  computeSettlementProcessorLaborRecallPlan,
  type SettlementProcessorLaborCallupPlan,
  type SettlementProcessorLaborRecallPlan,
} from '../../economy/processorLabor.ts';
import {
  computeSettlementProductionCapacity,
  grainChainBalanceLabel,
  processorBottleneckBuildingId,
  type ProcessorInputBuffer,
  type ProcessorOutputRoom,
} from '../../economy/settlementProduction.ts';
import {
  computeSettlementProsperityPlan,
  type SettlementProsperityPlan,
} from '../../economy/settlementProsperity.ts';
import {
  computeSettlementTextilePlan,
  textileChainBalanceLabel,
  TEXTILE_PLAN_DAYS_PER_YEAR,
  type SettlementTextilePlan,
} from '../../economy/settlementTextiles.ts';
import {
  buildSettlementFarmPlan,
  type SettlementSeasonalWorkPlan,
} from '../../farming/farmWorkPlanning.ts';
import { buildResidenceCommunityContext } from '../../economy/economyInspectorViews.ts';
import {
  findServingChapel,
  hasStaffedChapel,
  isResidenceInMonasteryCoverage,
  monasteryLinkedToChapel,
} from '../../logistics/landmarkAccess.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import {
  GUARDHOUSE_PAY_PRIORITY_HIGH,
  GUARDHOUSE_PAY_PRIORITY_LOW,
  guardhousePayrollPlan,
} from '../../security/guardhousePayrollPolicy.ts';
import {
  GUARDHOUSE_FOOD_RESERVE_DEEP,
  GUARDHOUSE_FOOD_RESERVE_LEAN,
  guardhouseFoodTarget,
  normalizeGuardhouseFoodReserve,
} from '../../security/frontierSecurity.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  describeNextDayEnvironmentOutlook,
  environmentFor,
  nextDayEnvironmentOutlook,
} from '../../world/seasonPolicy.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { BuildingKind, InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

function formatSettlementFieldWork(plan: SettlementSeasonalWorkPlan): string {
  if (plan.requiredWorkerDays <= 1e-6) return 'No work scheduled';
  const base = `${plan.coveredWorkerDays.toFixed(1)} / ${plan.requiredWorkerDays.toFixed(1)} worker-days covered`;
  return plan.shortfallWorkerDays > 0.05
    ? `${base} · short ${plan.shortfallWorkerDays.toFixed(1)}`
    : `${base} · on plan`;
}

function formatProcessorInputBuffer(
  buffer: ProcessorInputBuffer | null,
): string {
  if (buffer === null) return 'not staffed';
  const base = `${formatProvisionRunway(buffer.days)} (${buffer.limitingInput})`;
  if (buffer.inTransitTrips === 0) return base;

  const carts = `${buffer.inTransitAmount.toFixed(1)} inbound on ${buffer.inTransitTrips} ${buffer.inTransitTrips === 1 ? 'cart' : 'carts'}`;
  const arrival = buffer.nextDeliverySeconds === null
    ? 'arrival unresolved'
    : `first in ${formatHaulageDuration(buffer.nextDeliverySeconds)}`;
  return buffer.deliveryGap
    ? `${base} · ${carts} too late to prevent a stop · ${arrival}`
    : `${base} including ${carts} · ${arrival}`;
}

function formatProcessorOutputRoom(room: ProcessorOutputRoom | null): string {
  return room === null
    ? 'not staffed'
    : `${formatProvisionRunway(room.days)} to ${room.targetPercent}% target`;
}

function processorInspectButton(
  label: string,
  input: ProcessorInputBuffer | null,
  output: ProcessorOutputRoom | null,
): string {
  const buildingId = processorBottleneckBuildingId(input, output);
  return buildingId === null
    ? ''
    : `<button type="button" class="inspector-jump-button" data-inspect-building="${buildingId}" aria-label="Inspect ${label} bottleneck">Inspect</button>`;
}

function formatGrowthDuration(seconds: number | null): string {
  if (seconds === null) return 'Paused';
  if (seconds >= 120) return `~${Math.max(1, Math.round(seconds / 60))} min`;
  return `~${Math.max(1, Math.round(seconds))}s`;
}

function formatGrowthBottlenecks(plan: SettlementGrowthPlan): string {
  if (plan.candidateHomes === 0) return 'No vacant housing';
  if (plan.pausedHomes === 0) return 'All admitting homes hold their required buffers';
  const labels: Array<[keyof SettlementGrowthPlan['waitingOnHomes'], string]> = [
    ['food', 'food'],
    ['firewood', 'firewood'],
    ['water', 'water'],
    ['preservedFood', 'preserved food'],
    ['ale', 'ale'],
    ['cloth', 'textiles'],
  ];
  return labels
    .filter(([kind]) => plan.waitingOnHomes[kind] > 0)
    .map(([kind, label]) => `${label} ${plan.waitingOnHomes[kind]}`)
    .join(' · ');
}

function formatProsperityCapacity(plan: SettlementProsperityPlan): string {
  if (plan.installedResidentCapacity <= 0) {
    return `No complete staffed chain · ${plan.limitingLabel} limits prosperity`;
  }
  const headroom = plan.currentHeadroomResidents;
  return `${plan.currentResidents} / ${plan.installedResidentCapacity} prosperous residents at installed capacity · ${
    headroom >= 0
      ? `headroom for ${headroom}`
      : `short capacity for ${Math.abs(headroom)}`
  } · ${plan.limitingLabel} limited`;
}

function formatProsperityHousingPipeline(plan: SettlementProsperityPlan): string {
  const headroom = plan.fullHousingHeadroomResidents;
  return `${plan.existingFullResidents} residents at full existing tier-3 housing · ${plan.existingTierThreeVacancies} vacant places · ${
    headroom >= 0
      ? `${headroom} capacity remains`
      : `${Math.abs(headroom)} residents exceed installed capacity`
  }`;
}

function formatLaborSectorMix(plan: SettlementLaborPlan): string {
  return LABOR_SECTORS
    .filter((sector) => plan.sectors[sector].capacity > 0)
    .map((sector) => {
      const staffing = plan.sectors[sector];
      return `${LABOR_SECTOR_LABELS[sector]} ${staffing.assigned}/${staffing.capacity}`;
    })
    .join(' · ');
}

function formatFullHousingLabor(plan: SettlementLaborPlan): string {
  if (plan.futurePermanentPostShortfall > 0) {
    return `${plan.populationAtFullHousing} people · ${plan.futurePermanentPostShortfall} permanent posts still unfilled`;
  }
  return `${plan.populationAtFullHousing} people · ${plan.futureFreeLaborAfterFullStaffing} free after every permanent post`;
}

function formatStaffingPriorities(plan: SettlementLaborPlan): string {
  const low = plan.staffingPriorities[1];
  const normal = plan.staffingPriorities[2];
  const high = plan.staffingPriorities[3];
  return `Low ${low.assigned} workers / ${low.worksites} sites · Normal ${normal.assigned} / ${normal.worksites} · High ${high.assigned} / ${high.worksites}`;
}

function formatWorkInMotion(plan: SettlementLaborPlan): string {
  const construction = plan.activeConstructionSites > 0
    ? `${plan.constructionAssigned} / ${plan.constructionCapacity} builders across ${plan.activeConstructionSites} active sites`
    : 'No active building sites';
  const held = plan.heldConstructionSites > 0
    ? ` · ${plan.heldConstructionSites} sites held`
    : '';
  const carts = plan.activeCartTrips > 0
    ? `${plan.cartCrewWorkers} haulers on ${plan.activeCartTrips} active cart runs`
    : 'no carts traveling';
  return `${construction}${held} · ${carts}`;
}

function formatHaulageDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 1e-6) return '0s';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} hr`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds.toFixed(0)}s`;
}

export function renderSettlementHaulageRows(
  plan: SettlementLaborPlan['haulage'],
): string {
  if (plan.activeTrips === 0) {
    return '<li><span>Haulage network</span><span>No active cart runs</span></li>';
  }
  const busiestCargo = plan.busiestCargoKind === null
    ? 'none'
    : `${cargoKindLabel(plan.busiestCargoKind).toLocaleLowerCase()} (${plan.busiestCargoTrips} ${plan.busiestCargoTrips === 1 ? 'run' : 'runs'})`;
  const unresolved = plan.unresolvedTrips > 0
    ? ` · ${plan.unresolvedTrips} ${plan.unresolvedTrips === 1 ? 'route has' : 'routes have'} unresolved timing`
    : '';
  const longest = plan.longestRoute === null
    ? 'No measured road route'
    : `${cargoKindLabel(plan.longestRoute.cargoKind)} · ${Math.round(plan.longestRoute.oneWayDistance).toLocaleString()} m one way · ${formatTripPhaseLabel(plan.longestRoute.phase).toLocaleLowerCase()} · ${plan.longestRoute.remainingSeconds === null ? 'timing unresolved' : `${formatHaulageDuration(plan.longestRoute.remainingSeconds)} left`} <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${plan.longestRoute.tripId}" aria-label="Inspect longest active cart route">Inspect route</button>`;
  return `
    <li><span>Haulage posture</span><span>${plan.activeTrips} active · ${plan.outboundTrips} outbound · ${plan.unloadingTrips} unloading · ${plan.returningTrips} returning empty · ${plan.deliveryWorkers} haulers committed</span></li>
    <li><span>Cargo in motion</span><span>${plan.cargoInTransit.toFixed(1)} units aboard ${plan.loadedTrips} loaded ${plan.loadedTrips === 1 ? 'cart' : 'carts'} · busiest ${busiestCargo}${plan.emergencyTrips > 0 ? ` · ${plan.emergencyTrips} fire ${plan.emergencyTrips === 1 ? 'response' : 'responses'}` : ''}</span></li>
    <li><span>Road commitment</span><span>${Math.round(plan.totalOneWayDistance).toLocaleString()} m across ${plan.measuredTrips} measured ${plan.measuredTrips === 1 ? 'route' : 'routes'} · ${Math.round(plan.averageOneWayDistance).toLocaleString()} m average · ${formatHaulageDuration(plan.totalRemainingWorkerSeconds)} hauler-time remaining${unresolved}</span></li>
    <li><span>Longest active haul</span><span>${longest}</span></li>
  `;
}

function formatConstructionMaterialCoverage(
  label: string,
  material: ConstructionMaterialQueue,
): string {
  const covered = material.foundersReserve + material.awaitingPickup + material.inTransit;
  return `${covered.toFixed(0)} / ${material.remaining.toFixed(0)} ${label}`;
}

export function renderConstructionQueueRows(plan: SettlementConstructionPlan): string {
  if (plan.siteCount === 0) {
    return '<li><span>Construction queue</span><span>No building sites</span></li>';
  }
  const priorities = plan.priorityCounts;
  const activeFlow = plan.statusCounts.building
    + plan.statusCounts['founders-reserve']
    + plan.statusCounts['in-transit'];
  const queueLabel = `${plan.activeSites} active${plan.heldSites > 0 ? ` · ${plan.heldSites} held` : ''}`;
  const attention = plan.firstAttention === null
    ? `${activeFlow} sites building or receiving material`
    : `${constructionQueueStatusLabel(plan.firstAttention.status)} <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttention.buildingId}" aria-label="Inspect first construction queue bottleneck">Inspect</button>`;
  const timber = plan.materials.timber;
  const stone = plan.materials.stone;
  return `
    <li><span>Construction queue</span><span>${queueLabel} · urgent ${priorities.urgent} / normal ${priorities.normal} / low ${priorities.low}</span></li>
    <li><span>Builder load</span><span>${plan.assignedBuilders} / ${plan.builderCapacity} assigned · ${plan.remainingBuilderDays.toFixed(1)} builder-days after supply</span></li>
    <li><span>Queue materials</span><span>${timber.delivered.toFixed(0)} / ${timber.required.toFixed(0)} timber delivered · ${stone.delivered.toFixed(0)} / ${stone.required.toFixed(0)} stone delivered</span></li>
    <li><span>Supply coverage</span><span>${formatConstructionMaterialCoverage('timber earmarked', timber)} · ${formatConstructionMaterialCoverage('stone earmarked', stone)}${timber.uncovered + stone.uncovered > 0.05 ? ` · ${timber.uncovered.toFixed(0)} timber + ${stone.uncovered.toFixed(0)} stone uncovered` : ''}</span></li>
    <li><span>Material movement</span><span>${timber.awaitingPickup.toFixed(0)} timber + ${stone.awaitingPickup.toFixed(0)} stone await pickup · ${timber.inTransit.toFixed(0)} + ${stone.inTransit.toFixed(0)} on carts · ${timber.foundersReserve.toFixed(0)} + ${stone.foundersReserve.toFixed(0)} in founders' reserve</span></li>
    <li><span>Queue attention</span><span>${attention}</span></li>
  `;
}

function formatConstructionLabor(plan: SettlementConstructionLaborPlan): string {
  if (plan.activeSites === 0) return 'No active building sites';
  if (plan.recalledWorkers > 0 && plan.calledWorkers > 0) {
    return `${plan.recalledWorkers} blocked ${plan.recalledWorkers === 1 ? 'builder' : 'builders'} can be released · ${plan.calledWorkers} ${plan.calledWorkers === 1 ? 'worker' : 'workers'} can move to ready sites · ${plan.remainingReadyPosts} ready posts remain`;
  }
  if (plan.recalledWorkers > 0) {
    return `${plan.recalledWorkers} blocked ${plan.recalledWorkers === 1 ? 'builder' : 'builders'} can return to the free labor pool · no productive vacancy is ready`;
  }
  if (plan.calledWorkers > 0) {
    return `${plan.calledWorkers} free ${plan.calledWorkers === 1 ? 'worker can' : 'workers can'} fill ${plan.calledWorkers} of ${plan.readyOpenPosts} ready builder posts · ${plan.remainingReadyPosts} remain`;
  }
  if (plan.readyOpenPosts > 0) {
    return `${plan.readyOpenPosts} ready builder ${plan.readyOpenPosts === 1 ? 'post' : 'posts'} across ${plan.workReadySites} ${plan.workReadySites === 1 ? 'site' : 'sites'} · no free labor`;
  }
  if (plan.inboundWaitingSites > 0) {
    return `${plan.inboundWaitingSites} ${plan.inboundWaitingSites === 1 ? 'site is' : 'sites are'} awaiting inbound material with crews preserved`;
  }
  if (plan.blockedSites > 0) {
    return `${plan.blockedSites} supply-blocked ${plan.blockedSites === 1 ? 'site' : 'sites'} · no builders stranded`;
  }
  return `${plan.workReadySites} work-ready ${plan.workReadySites === 1 ? 'site is' : 'sites are'} fully staffed`;
}

export function renderStorehouseNetworkRows(network: StorehouseNetworkPlan): string {
  if (network.completedDepots === 0) {
    return '<li><span>Material depots</span><span>No completed village storehouse</span></li>';
  }
  const rows = (['timber', 'stone', 'firewood'] as const).map((commodity) => {
    const plan = network.commodities[commodity];
    const label = commodity === 'timber'
      ? 'Timber depots'
      : commodity === 'stone'
        ? 'Stone depots'
        : 'Firewood depots';
    if (plan.acceptingDepots === 0) {
      return `<li><span>${label}</span><span>Collection disabled across ${network.completedDepots} depots</span></li>`;
    }
    const aboveTarget = plan.stockAboveTarget > 0.05
      ? ` · ${plan.stockAboveTarget.toFixed(0)} above targets remains available`
      : '';
    return `<li><span>${label}</span><span>${plan.stockTowardTarget.toFixed(0)} / ${plan.targetStock.toFixed(0)} toward selected targets · ${plan.collectionHeadroom.toFixed(0)} collection headroom · ${plan.staffedAcceptingDepots} / ${plan.acceptingDepots} collectors staffed${aboveTarget}</span></li>`;
  }).join('');
  return `
    <li><span>Material depots</span><span>${network.completedDepots} completed · ${network.staffedDepots} staffed</span></li>
    ${rows}
  `;
}

export function renderSettlementGrainRows(plan: SettlementGrainPlan): string {
  const balance = plan.annualBalance >= 0
    ? `${plan.annualBalance.toFixed(1)} projected surplus`
    : `${Math.abs(plan.annualBalance).toFixed(1)} projected shortfall`;
  const attentionLabel = plan.firstAttentionKind === 'seed'
    ? 'first seed shortfall'
    : plan.firstAttentionKind === 'winter-fodder'
      ? 'first winter-fodder shortfall'
      : 'first central-reserve shortfall';
  const attention = plan.firstAttentionBuildingId === null
    ? ''
    : ` · ${attentionLabel} <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttentionBuildingId}" aria-label="Inspect ${attentionLabel}">Inspect</button>`;
  const runway = plan.processorGrainPerDay <= 1e-9
    ? 'no installed grain draw'
    : `${formatProvisionRunway(plan.processorRunwayDays)} discretionary runway`;
  const priority = plan.processorPriorityCounts;
  const priorityTotal = priority[1] + priority[2] + priority[3];
  const priorityRow = priorityTotal > 0
    ? `<li><span>Grain cart priorities</span><span>${priority[3]} high · ${priority[2]} normal · ${priority[1]} low operational processors · carts serve higher tiers first, then lowest cycle runway</span></li>`
    : '';
  return `
    <li><span>Grain allocation</span><span>${plan.totalStock.toFixed(1)} owned · ${plan.inTransit.toFixed(1)} on carts · ${plan.discretionaryStock.toFixed(1)} discretionary after protected claims</span></li>
    <li><span>Protected grain</span><span>Seed ${plan.seed.protected.toFixed(1)} / ${plan.seed.target.toFixed(1)} · winter fodder ${plan.winterFodder.protected.toFixed(1)} / ${plan.winterFodder.target.toFixed(1)} · central reserve ${plan.granaryReserve.protected.toFixed(1)} / ${plan.granaryReserve.target.toFixed(1)}${attention}</span></li>
    <li><span>Installed grain draw</span><span>${plan.processorGrainPerDay.toFixed(1)} / day · bread ${plan.breadGrainPerDay.toFixed(1)} · ale ${plan.aleGrainPerDay.toFixed(1)} · monastery ${plan.monasteryGrainPerDay.toFixed(1)} · ${runway}</span></li>
    ${priorityRow}
    <li><span>Crop-year balance</span><span>${plan.laborCoveredHarvest.toFixed(1)} / ${plan.potentialHarvest.toFixed(1)} harvest covered · ${plan.annualCommitments.toFixed(1)} committed · ${balance} at current installed capacity over ${GRAIN_PLAN_DAYS_PER_YEAR} days; imports excluded</span></li>
  `;
}

const SEED_PROCUREMENT_ATTENTION_LABELS: Record<
  SettlementSeedProcurementAttention,
  string
> = {
  construction: 'market unfinished',
  labor: 'broker labor missing',
  road: 'market road missing',
  treasury: 'treasury short',
  ironwork: 'ironwork ahead in queue',
  cooldown: 'caravan cooldown',
};

export function renderSettlementSeedProcurementRows(
  plan: SettlementSeedProcurementPlan,
  firstSeedShortBuildingId: string | null,
): string {
  if (plan.marketplaces === 0) {
    const holding = firstSeedShortBuildingId === null
      ? ''
      : ` <button type="button" class="inspector-jump-button" data-inspect-building="${firstSeedShortBuildingId}" aria-label="Inspect first seed-short holding">Inspect holding</button>`;
    return `<li><span>Standing seed orders</span><span>No marketplace${plan.seedShortfall > 0.05 ? ` &middot; ${plan.seedShortfall.toFixed(1)} holding seed gap${holding}` : ''}</span></li>`;
  }

  const marketAttention = plan.firstAttentionMarketId === null
    || plan.firstAttentionKind === null
    ? ''
    : ` &middot; first block ${SEED_PROCUREMENT_ATTENTION_LABELS[plan.firstAttentionKind]} <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttentionMarketId}" aria-label="Inspect first blocked standing seed order">Inspect market</button>`;
  const queue = plan.ironworkQueuedMarkets > 0
    ? ` &middot; ${plan.ironworkQueuedMarkets} behind frontier ironwork`
    : '';
  const readiness = plan.dueMarkets > 0
    ? `${plan.readyMarkets} / ${plan.dueMarkets} due markets ready${queue}${marketAttention}`
    : 'all selected targets currently filled';
  const orders = plan.targetMarkets === 0
    ? 'Manual-only at every market'
    : `${plan.plannedImportLots} future ${plan.plannedImportLots === 1 ? 'lot' : 'lots'} / ${plan.plannedImportGrain.toFixed(0)} grain due toward ${plan.targetStock.toFixed(0)} selected stock &middot; ${readiness}`;

  const holding = firstSeedShortBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${firstSeedShortBuildingId}" aria-label="Inspect first seed-short holding">Inspect holding</button>`;
  const recovery = plan.seedShortfall <= 0.05
    ? `No current holding seed gap &middot; ${plan.currentMarketStock.toFixed(1)} physical market grain already counted in owned stock`
    : `${plan.currentMarketStock.toFixed(1)} physical market grain + ${plan.plannedImportGrain.toFixed(0)} future grain could cover up to ${plan.potentialCoverage.toFixed(1)} / ${plan.seedShortfall.toFixed(1)} of the holding gap${plan.uncoveredShortfall > 0.05 ? ` &middot; ${plan.uncoveredShortfall.toFixed(1)} still exposed` : ''}${holding}`;
  const treasury = plan.plannedImportLots > 0
    ? ` &middot; treasury funds ${plan.affordableLotsAtCurrentRate} / ${plan.plannedImportLots} lots at today's ${plan.nextLotGoldCost.toFixed(0)} gold rate; later lots reprice`
    : '';

  return `
    <li><span>Standing seed orders</span><span>${orders}${treasury}</span></li>
    <li><span>Seed recovery ceiling</span><span>${recovery} &middot; future purchases remain excluded from crop-year balance until bought</span></li>
  `;
}

export function renderSettlementTextileRows(plan: SettlementTextilePlan): string {
  if (plan.sheepHoldings === 0) {
    return `
      <li><span>Annual wool clip</span><span>No completed sheep holding</span></li>
      <li><span>Textile chain</span><span>${textileChainBalanceLabel(plan)} · ${plan.annualHouseholdClothDemand.toFixed(1)} cloth/year household demand</span></li>
    `;
  }

  const attentionLabel = plan.firstAttentionKind === 'storage'
    ? 'first loft without full-clip room'
    : plan.firstAttentionKind === 'staffing'
      ? 'first unstaffed sheep holding'
      : plan.firstAttentionKind === 'flock'
        ? 'first unproductive flock'
        : 'first flock that missed shearing';
  const attention = plan.firstAttentionBuildingId === null
    ? ''
    : ` · ${attentionLabel} <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttentionBuildingId}" aria-label="Inspect ${attentionLabel}">Inspect</button>`;
  const annualBalance = plan.annualClothBalance >= 0
    ? `${plan.annualClothBalance.toFixed(1)} cloth surplus`
    : `${Math.abs(plan.annualClothBalance).toFixed(1)} cloth shortfall`;
  const clipRisk = plan.annualWoolAtRisk > 0.05
    ? ` · ${plan.annualWoolAtRisk.toFixed(1)} wool not secured at current staffing/storage`
    : ' · full projected clip secured';
  const blocked = plan.storageBlockedHoldings
    + plan.staffingBlockedHoldings
    + plan.flockBlockedHoldings
    + plan.missedHoldings;

  return `
    <li><span>Annual wool clip</span><span>${plan.shornHoldings} / ${plan.sheepHoldings} holdings shorn · ${plan.sheepHeadCount} sheep / ${plan.productiveSheepHeads.toFixed(1)} productive-head equivalent · ${plan.projectedAnnualWool.toFixed(1)} wool potential${clipRisk}${attention}</span></li>
    <li><span>Shearing readiness</span><span>${plan.readyPendingHoldings} pending and ready · ${plan.storageBlockedHoldings} storage-blocked · ${plan.staffingBlockedHoldings} unstaffed · ${plan.flockBlockedHoldings} flock-blocked · ${plan.missedHoldings} missed${blocked === 0 ? ' · no exposed clip' : ''}</span></li>
    <li><span>Textile stores</span><span>${plan.woolStock.toFixed(1)} wool owned${plan.woolInTransit > 0.05 ? ` · ${plan.woolInTransit.toFixed(1)} on carts` : ''} · ${plan.clothStock.toFixed(1)} cloth owned${plan.clothInTransit > 0.05 ? ` · ${plan.clothInTransit.toFixed(1)} on carts` : ''} · ${formatProvisionRunway(plan.clothReserveRunwayDays)} household cloth reserve</span></li>
    <li><span>Textile chain</span><span>${plan.annualClothPotential.toFixed(1)} cloth/year at current flock and loom labor vs ${plan.annualHouseholdClothDemand.toFixed(1)} household need · ${annualBalance} over ${TEXTILE_PLAN_DAYS_PER_YEAR} days · ${textileChainBalanceLabel(plan)}</span></li>
  `;
}

function formatSeasonalLabor(plan: SettlementSeasonalLaborPlan): string {
  if (plan.dormantSites === 0) return 'No staffed seasonal sites are dormant';
  if (plan.reclaimableWorkers === 0) {
    return `${plan.dormantSites} dormant ${plan.dormantSites === 1 ? 'site' : 'sites'} · ${plan.retainedHaulers} necessary ${plan.retainedHaulers === 1 ? 'hauler' : 'haulers'}`;
  }
  return `${plan.reclaimableWorkers} idle ${plan.reclaimableWorkers === 1 ? 'worker' : 'workers'} across ${plan.reclaimableSites} ${plan.reclaimableSites === 1 ? 'site' : 'sites'} · ${plan.retainedHaulers} ${plan.retainedHaulers === 1 ? 'hauler remains' : 'haulers remain'} for stored goods or active carts`;
}

function formatSeasonalCallup(plan: SettlementSeasonalCallupPlan): string {
  if (plan.activeSites === 0) return 'No seasonal work window is open';
  if (plan.understaffedSites === 0) {
    return `${plan.activeSites} active seasonal ${plan.activeSites === 1 ? 'site is' : 'sites are'} fully staffed`;
  }
  if (plan.callupWorkers === 0) {
    return `${plan.openPosts} active seasonal ${plan.openPosts === 1 ? 'vacancy' : 'vacancies'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · no free labor`;
  }
  return `${plan.callupWorkers} free ${plan.callupWorkers === 1 ? 'worker can' : 'workers can'} fill ${plan.callupWorkers} of ${plan.openPosts} active seasonal ${plan.openPosts === 1 ? 'vacancy' : 'vacancies'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · ${plan.remainingOpenPosts} remain`;
}

function formatProcessorLaborRecall(plan: SettlementProcessorLaborRecallPlan): string {
  if (plan.targetPausedSites === 0) return 'No staffed workshop is paused at its output target';
  if (plan.reclaimableWorkers === 0) {
    return `${plan.targetPausedSites} target-paused ${plan.targetPausedSites === 1 ? 'workshop' : 'workshops'} · ${plan.retainedDispatchers} necessary ${plan.retainedDispatchers === 1 ? 'dispatcher' : 'dispatchers'}`;
  }
  return `${plan.reclaimableWorkers} reclaimable ${plan.reclaimableWorkers === 1 ? 'worker' : 'workers'} across ${plan.reclaimableSites} target-paused ${plan.reclaimableSites === 1 ? 'workshop' : 'workshops'} · ${plan.retainedDispatchers} ${plan.retainedDispatchers === 1 ? 'dispatcher retained' : 'dispatchers retained'}`;
}

function formatYearRoundLaborRotation(plan: SettlementYearRoundLaborRotation): string {
  if (plan.worksites === 0) return 'No ordinary year-round worksite is built';
  if (plan.understaffedSites === 0) {
    return `${plan.worksites} year-round ${plan.worksites === 1 ? 'worksite is' : 'worksites are'} fully staffed`;
  }
  if (plan.calledWorkers === 0) {
    return `${plan.openPosts} open ${plan.openPosts === 1 ? 'post remains' : 'posts remain'} across ${plan.understaffedSites} year-round ${plan.understaffedSites === 1 ? 'worksite' : 'worksites'} · no free or strictly lower-priority labor can fill them`;
  }
  const freeWorkersUsed = plan.calledWorkers - plan.recalledWorkers;
  const source = plan.recalledWorkers > 0
    ? `${plan.recalledWorkers} lower-priority ${plan.recalledWorkers === 1 ? 'worker moves' : 'workers move'}${freeWorkersUsed > 0 ? ` + ${freeWorkersUsed} from the free pool` : ''}`
    : `${plan.calledWorkers} free ${plan.calledWorkers === 1 ? 'worker moves' : 'workers move'}`;
  return `${source} into ${plan.calledWorkers} higher-priority or vacant ${plan.calledWorkers === 1 ? 'post' : 'posts'} · ${plan.remainingOpenPosts} open ${plan.remainingOpenPosts === 1 ? 'post remains' : 'posts remain'}`;
}

function formatWorksiteStalls(
  plan: SettlementWorksiteStallPlan,
  getBuildingLabel: (kind: BuildingKind) => string,
): string {
  if (plan.stalledSites === 0) {
    return plan.supplyEnRouteSites > 0
      ? `${plan.supplyEnRouteSites} ${plan.supplyEnRouteSites === 1 ? 'site is' : 'sites are'} waiting on inbound carts · no unattended stall`
      : `No stalls across ${plan.auditedSites} staffed workshops, quarries, hunting halls, or active fishing camps`;
  }
  const reasons = [
    plan.inputStalledSites > 0 ? `${plan.inputStalledSites} empty-input` : '',
    plan.outputStalledSites > 0 ? `${plan.outputStalledSites} output-blocked` : '',
    plan.sourceStalledSites > 0 ? `${plan.sourceStalledSites} without usable source` : '',
    plan.reserveStalledSites > 0 ? `${plan.reserveStalledSites} reserve-held` : '',
  ].filter(Boolean).join(' · ');
  const duty = plan.dispatchDutySites > 0
    ? ` · ${plan.dispatchDutySites} ${plan.dispatchDutySites === 1 ? 'site retains' : 'sites retain'} delivery duty`
    : '';
  const inbound = plan.supplyEnRouteSites > 0
    ? ` · ${plan.supplyEnRouteSites} more recovering by cart`
    : '';
  const recall = plan.reclaimableWorkers > 0
    ? ` · ${plan.reclaimableWorkers} safely recallable${plan.retainedDispatchers > 0 ? ` while ${plan.retainedDispatchers} ${plan.retainedDispatchers === 1 ? 'dispatcher remains' : 'dispatchers remain'}` : ''}`
    : ' · no labor can leave without interrupting dispatch';
  const first = plan.sites.find(
    (site) => site.buildingId === plan.firstReclaimableBuildingId,
  ) ?? plan.firstAttention;
  const attention = first === null
    ? ''
    : ` · first ${getBuildingLabel(first.kind)}: ${first.detail} <button type="button" class="inspector-jump-button" data-inspect-building="${first.buildingId}" aria-label="Inspect first production stall">Inspect</button>`;
  return `${plan.stalledWorkers} production ${plan.stalledWorkers === 1 ? 'worker is' : 'workers are'} stalled across ${plan.stalledSites} ${plan.stalledSites === 1 ? 'site' : 'sites'} · ${reasons}${duty}${recall}${inbound}${attention}`;
}

function formatProcessorLaborCallup(plan: SettlementProcessorLaborCallupPlan): string {
  if (plan.auditedSites === 0) return 'No managed production worksite is built';
  if (plan.readySites === 0) {
    return `${plan.blockedSites} production ${plan.blockedSites === 1 ? 'site is' : 'sites are'} blocked by output capacity or an unusable local source`;
  }
  if (plan.understaffedSites === 0) {
    return `${plan.readySites} ready production ${plan.readySites === 1 ? 'site is' : 'sites are'} fully staffed${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}`;
  }
  if (plan.callupWorkers === 0) {
    return `${plan.openPosts} open ${plan.openPosts === 1 ? 'post remains' : 'posts remain'} across ${plan.understaffedSites} ready production ${plan.understaffedSites === 1 ? 'site' : 'sites'} · no free labor${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}`;
  }
  return `${plan.callupWorkers} free ${plan.callupWorkers === 1 ? 'worker can' : 'workers can'} fill ${plan.callupWorkers} of ${plan.openPosts} ready production ${plan.openPosts === 1 ? 'post' : 'posts'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · ${plan.remainingOpenPosts} remain${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}`;
}

function formatLaborStewardStage(
  label: string,
  recalledWorkers: number,
  calledWorkers: number,
): string {
  if (recalledWorkers === 0 && calledWorkers === 0) return `${label} steady`;
  const actions = [
    recalledWorkers > 0 ? `release ${recalledWorkers}` : '',
    calledWorkers > 0 ? `deploy ${calledWorkers}` : '',
  ].filter(Boolean).join('/');
  return `${label} ${actions}`;
}

function formatLaborStewardForecast(
  forecast: SettlementLaborStewardForecast,
  staffedTownHallAvailable: boolean,
): string {
  if (forecast.enabledStages === 0) {
    return `No automatic rotations enabled · ${forecast.availableLaborBefore} free`;
  }
  const timing = staffedTownHallAvailable
    ? 'Next dawn'
    : 'Paused without a clerk; next-dawn snapshot';
  const stages = [
    forecast.seasonal
      ? formatLaborStewardStage(
          'seasonal',
          forecast.seasonal.recalledWorkers,
          forecast.seasonal.calledWorkers,
        )
      : '',
    forecast.production
      ? formatLaborStewardStage(
          'production',
          forecast.production.recalledWorkers,
          forecast.production.calledWorkers,
        )
      : '',
    forecast.construction
      ? formatLaborStewardStage(
          'construction',
          forecast.construction.recalledWorkers,
          forecast.construction.calledWorkers,
        )
      : '',
  ].filter(Boolean);
  const reserveStatus = forecast.laborReserve === 0
    ? ''
    : forecast.availableLaborAfter >= forecast.laborReserve
      ? ` · ${forecast.laborReserve} held free`
      : ` · reserve short ${forecast.laborReserve - forecast.availableLaborAfter}; productive crews stay assigned`;
  return `${timing}: ${stages.join(' → ')} · ${forecast.availableLaborAfter} free after review${reserveStatus}`;
}

export function renderFreshFoodPreservationRows(
  preservation: FreshFoodPreservation,
  getBuildingLabel: (kind: BuildingKind) => string,
  getResidenceParcelIndex: (id: string) => number | null,
): string {
  const hotspot = formatFreshFoodLossSite(
    preservation.largestLossSite,
    getBuildingLabel,
    getResidenceParcelIndex,
  );
  return `
    <li><span>Fresh-food spoilage</span><span>${formatFreshFoodLoss(preservation.spoilagePerDay)} · ${Math.round(preservation.protectedShare * 100)}% in sheltered stores</span></li>
    <li><span>Largest fresh-food loss</span><span>${hotspot}</span></li>
    <li><span>Granary intake network</span><span>${formatGranaryFreshFoodNetwork(preservation.granaryNetwork)}</span></li>
  `;
}

function formatFreshFoodLossSite(
  site: FreshFoodLossSite | null,
  getBuildingLabel: (kind: BuildingKind) => string,
  getResidenceParcelIndex: (id: string) => number | null,
): string {
  if (site === null) return 'No fresh food currently spoiling';
  if (site.source === 'treasury') {
    return `Founding treasury · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)}`;
  }
  if (site.source === 'building' && site.id !== null && site.buildingKind !== null) {
    return `${getBuildingLabel(site.buildingKind)} · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-building="${site.id}" aria-label="Inspect largest fresh-food loss">Inspect</button>`;
  }
  if (site.source === 'residence' && site.id !== null) {
    const parcelIndex = getResidenceParcelIndex(site.id);
    const label = parcelIndex === null ? 'Residence' : `Residence parcel #${parcelIndex + 1}`;
    return `${label} · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-residence="${site.id}" aria-label="Inspect largest household fresh-food loss">Inspect</button>`;
  }
  return 'No fresh food currently spoiling';
}

function formatGranaryFreshFoodNetwork(network: GranaryFreshFoodNetwork): string {
  if (network.completedGranaries === 0) return 'No completed granary';
  if (network.collectingGranaries === 0) {
    return `${network.completedGranaries} completed · fresh-food collection disabled at every granary`;
  }
  const enabled = network.collectingGranaries === network.completedGranaries
    ? `${network.collectingGranaries} collection ${network.collectingGranaries === 1 ? 'target' : 'targets'}`
    : `${network.collectingGranaries} / ${network.completedGranaries} collection enabled`;
  const aboveTarget = network.stockAboveTarget > 0.05
    ? ` · ${network.stockAboveTarget.toFixed(1)} above targets from baking or earlier stock`
    : '';
  return `${network.stockTowardTarget.toFixed(1)} / ${network.targetStock.toFixed(1)} sheltered toward selected targets · ${network.targetShortfall.toFixed(1)} collection headroom · ${network.staffedCollectingGranaries} / ${network.collectingGranaries} collectors staffed · ${enabled}${aboveTarget}`;
}

export function renderTownHallInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const staffed = building.assignedLabor > 0;
  const staffedTownHallAvailable = Array.from(context.gameState.buildings.values()).some(
    (candidate) =>
      candidate.kind === 'town_hall'
      && candidate.constructionComplete !== false
      && candidate.assignedLabor > 0,
  );
  const seasonalLaborStewardEnabled =
    context.getSeasonalLaborStewardEnabled?.() ?? false;
  const constructionLaborStewardEnabled =
    context.getConstructionLaborStewardEnabled?.() ?? false;
  const productionLaborStewardEnabled =
    context.getProductionLaborStewardEnabled?.() ?? false;
  const laborStewardReserve = normalizeLaborStewardReserve(
    context.getLaborStewardReserve?.() ?? DEFAULT_LABOR_STEWARD_RESERVE,
  );
  const taxRate = context.getEconomicActivityTaxRate?.() ?? 0;
  const readout = buildVillageAdminReadout({
    gameState: context.gameState,
    worldQueries: context.worldQueries,
    taxRate,
    parishPolicy: context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY,
  });
  const collectionRate = staffed ? 100 : Math.round(TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER * 100);
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const monasteryPolicy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const clock = gameClock(context.gameState.tick);
  const environment = environmentFor(context.gameState.seed, context.worldHydrology, clock);
  const environmentOutlook = nextDayEnvironmentOutlook(
    context.gameState.seed,
    context.worldHydrology,
    clock,
  );
  const nextDawnOutlook = describeNextDayEnvironmentOutlook(
    environment,
    environmentOutlook,
  );
  const laborStewardForecast = computeSettlementLaborStewardForecast(
    context.gameState,
    environmentOutlook.clock.month,
    context.populationStats.available,
    {
      seasonalEnabled: seasonalLaborStewardEnabled,
      productionEnabled: productionLaborStewardEnabled,
      constructionEnabled: constructionLaborStewardEnabled,
    },
    laborStewardReserve,
  );
  const laborStewardInspectButton = laborStewardForecast.firstChangedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${laborStewardForecast.firstChangedBuildingId}" aria-label="Inspect first dawn labor steward crew change">Inspect</button>`;
  const provisioning = computeSettlementProvisioning({
    state: context.gameState,
    totals: context.resourceTotals,
    currentFirewoodDemandMultiplier: environment.firewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay: environment.freshFoodSpoilageFractionPerDay,
    sabbathObserved: parishPolicy.sabbathObservanceEnabled
      && hasStaffedChapel(context.gameState.buildings.values()),
  });
  const freshFoodPreservationRows = renderFreshFoodPreservationRows(
    provisioning.foodPreservation,
    (kind) => context.worldQueries.getBuildingLabel(kind),
    (residenceId) => context.gameState.residences.get(residenceId)?.parcelIndex ?? null,
  );
  const growthChapels = Array.from(context.gameState.buildings.values())
    .filter((candidate) => candidate.kind === 'chapel');
  const growthMonasteries = Array.from(context.gameState.buildings.values())
    .filter((candidate) => candidate.kind === 'monastery');
  const roadPathDistance = (ax: number, az: number, bx: number, bz: number): number | null =>
    context.worldQueries.getRoadPathDistance(ax, az, bx, bz);
  const growth = computeSettlementGrowthPlan({
    state: context.gameState,
    communityForResidence: (residence) => buildResidenceCommunityContext(
      findServingChapel(residence, growthChapels, roadPathDistance),
      parishPolicy,
      isResidenceInMonasteryCoverage(
        residence,
        growthMonasteries,
        growthChapels,
        roadPathDistance,
      ),
    ),
  });
  const growthInspectButton = growth.firstPausedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${growth.firstPausedResidenceId}" aria-label="Inspect first growth-blocked residence">Inspect</button>`;
  const laborPlan = computeSettlementLaborPlan({
    state: context.gameState,
    population: context.populationStats,
    vacantHousingSlots: growth.vacantSlots,
    excludeNavigationBuildingId: building.id,
  });
  const laborInspectButton = laborPlan.firstUnstaffedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${laborPlan.firstUnstaffedBuildingId}" aria-label="Inspect first unstaffed worksite">Inspect</button>`;
  const constructionPlan = computeSettlementConstructionPlan({
    state: context.gameState,
    hasRoadAccess: (candidate) =>
      context.worldQueries.hasRoadAccess(candidate.x, candidate.z),
  });
  const constructionLabor = computeSettlementConstructionLaborPlan(
    context.gameState,
    context.populationStats.available,
  );
  const constructionLaborInspectId = constructionLabor.recalledWorkers > 0
    ? constructionLabor.firstBlockedBuildingId
    : constructionLabor.firstReadyUnderstaffedBuildingId;
  const constructionLaborInspectButton = constructionLaborInspectId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${constructionLaborInspectId}" aria-label="Inspect first construction crew rotation site">Inspect</button>`;
  const seasonalLabor = computeSettlementSeasonalLaborPlan(
    context.gameState,
    clock.month,
  );
  const seasonalLaborInspectButton = seasonalLabor.firstReclaimableBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${seasonalLabor.firstReclaimableBuildingId}" aria-label="Inspect first dormant seasonal worksite">Inspect</button>`;
  const seasonalCallup = computeSettlementSeasonalCallupPlan(
    context.gameState,
    clock.month,
    context.populationStats.available,
  );
  const seasonalCallupInspectButton = seasonalCallup.firstUnderstaffedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${seasonalCallup.firstUnderstaffedBuildingId}" aria-label="Inspect first understaffed active seasonal worksite">Inspect</button>`;
  const processorLaborRecall = computeSettlementProcessorLaborRecallPlan(
    context.gameState,
  );
  const processorLaborRecallInspectButton = processorLaborRecall.firstReclaimableBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${processorLaborRecall.firstReclaimableBuildingId}" aria-label="Inspect first target-paused workshop">Inspect</button>`;
  const productionLaborCallup = computeSettlementProcessorLaborCallupPlan(
    context.gameState,
    context.populationStats.available,
  );
  const productionLaborCallupInspectButton = productionLaborCallup.firstUnderstaffedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${productionLaborCallup.firstUnderstaffedBuildingId}" aria-label="Inspect first understaffed ready production site">Inspect</button>`;
  const yearRoundLabor = computeSettlementYearRoundLaborRotation(
    context.gameState,
    context.populationStats.available,
  );
  const worksiteStalls = computeSettlementWorksiteStallPlan(
    context.gameState,
    clock.month,
  );
  const yearRoundLaborInspectId = yearRoundLabor.firstRecalledBuildingId
    ?? yearRoundLabor.firstUnderstaffedBuildingId;
  const yearRoundLaborInspectButton = yearRoundLaborInspectId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${yearRoundLaborInspectId}" aria-label="Inspect first year-round crew balance site">Inspect</button>`;
  const guardhousePayroll = guardhousePayrollPlan(
    context.gameState.buildings.values(),
    context.resourceTotals.gold,
  );
  const payrollGoldDue = guardhousePayroll.reduce((sum, company) => sum + company.dailyWage, 0);
  const payrollGoldFunded = guardhousePayroll.reduce((sum, company) => sum + company.fundedGold, 0);
  const underfundedCompany = guardhousePayroll.find((company) => company.fundedRatio < 0.999);
  const highPriorityCompanies = guardhousePayroll.filter(
    (company) => company.priority === GUARDHOUSE_PAY_PRIORITY_HIGH,
  ).length;
  const lowPriorityCompanies = guardhousePayroll.filter(
    (company) => company.priority === GUARDHOUSE_PAY_PRIORITY_LOW,
  ).length;
  const normalPriorityCompanies = guardhousePayroll.length
    - highPriorityCompanies
    - lowPriorityCompanies;
  let leanReserveCompanies = 0;
  let deepReserveCompanies = 0;
  let guardProvisionTarget = 0;
  for (const company of guardhousePayroll) {
    const reserve = normalizeGuardhouseFoodReserve(company.building.guardhouseFoodReserve);
    if (reserve === GUARDHOUSE_FOOD_RESERVE_LEAN) leanReserveCompanies += 1;
    if (reserve === GUARDHOUSE_FOOD_RESERVE_DEEP) deepReserveCompanies += 1;
    guardProvisionTarget += guardhouseFoodTarget(
      company.building.assignedLabor,
      company.building.polearms,
      reserve,
    );
  }
  const standardReserveCompanies = guardhousePayroll.length
    - leanReserveCompanies
    - deepReserveCompanies;
  const livestockFodder = computeSettlementLivestockFodderPlan(
    context.gameState,
    environment.pastureCapacityMultiplier,
    provisioning.sabbathObserved,
    clock.month,
    clock.monthDay,
  );
  const production = context.settlementProduction
    ?? computeSettlementProductionCapacity(
      context.gameState,
      provisioning.sabbathObserved,
    );
  const prosperity = computeSettlementProsperityPlan(production, growth);
  const textilePlan = computeSettlementTextilePlan({
    state: context.gameState,
    clock,
    production,
  });
  const processingWeek = `${production.capacityDaysPerWeek}-day working week · installed capacity if supplied`;
  const flourBalance = grainChainBalanceLabel(production);
  const farmPlan = buildSettlementFarmPlan(
    context.gameState,
    clock,
    provisioning.sabbathObserved,
  );
  const grainReserve = computeSettlementGranaryReserve(context.gameState);
  const grainPlan = computeSettlementGrainPlan({
    state: context.gameState,
    farmPlan,
    livestockFodder,
    granaryReserve: grainReserve,
    production,
    sabbathObserved: provisioning.sabbathObserved,
    monasteryProductivity: (candidate) =>
      monasteryLinkedToChapel(candidate, growthChapels, roadPathDistance)
        ? 1
        : MONASTERY_UNLINKED_PRODUCTIVITY,
  });
  const marketState = context.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE;
  const seedProcurement = computeSettlementSeedProcurementPlan({
    state: context.gameState,
    seedShortfall: farmPlan.seedGrainShortfall,
    availableGold: context.resourceTotals.gold,
    nextLotGoldCost: marketplaceTradeOfferCost(
      MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
      marketState,
    ).amount,
    conflictEnabled: context.conflictEnabled ?? false,
    hasRoadAccess: (candidate) =>
      context.worldQueries.hasRoadAccess(candidate.x, candidate.z),
  });
  const centralGrainReserveRow = grainReserve.granaries === 0
    ? '<li><span>Central grain floor</span><span>No completed granary</span></li>'
    : `<li><span>Central grain floor</span><span>${grainReserve.protectedStock.toFixed(1)} / ${grainReserve.reserveTarget.toFixed(1)} protected across ${grainReserve.granaries} ${grainReserve.granaries === 1 ? 'granary' : 'granaries'}${grainReserve.reserveShortfall > 0.05 ? ` · short ${grainReserve.reserveShortfall.toFixed(1)}${grainReserve.firstShortGranaryId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${grainReserve.firstShortGranaryId}" aria-label="Inspect first central grain reserve shortfall">Inspect</button>` : ''}` : ''} · ${grainReserve.processorAndTradeSurplus.toFixed(1)} releasable</span></li>`;
  const weakestRotationField = farmPlan.rotation.weakestFieldId === null
    || farmPlan.rotation.lowestPlannedFertility === null
    ? ''
    : ` · weakest ${Math.round(farmPlan.rotation.lowestPlannedFertility * 100)}% <button type="button" class="inspector-jump-button" data-inspect-field="${farmPlan.rotation.weakestFieldId}" aria-label="Inspect weakest planned field">Inspect</button>`;
  const rotationRows = farmPlan.rotation.activeArea <= 1e-9
    ? '<li><span>Next rotation</span><span>No active field area planned</span></li>'
    : `
      <li><span>Next rotation</span><span>${Math.round(farmPlan.rotation.nextRyeArea).toLocaleString()} m² rye · ${Math.round(farmPlan.rotation.nextOatsArea).toLocaleString()} m² oats · ${Math.round(farmPlan.rotation.nextFallowArea).toLocaleString()} m² worked fallow</span></li>
      <li><span>Soil trajectory</span><span>${Math.round(farmPlan.rotation.currentAverageFertility * 100)}% now → ${Math.round(farmPlan.rotation.afterCurrentAverageFertility * 100)}% after current crops → ${Math.round(farmPlan.rotation.afterPlannedAverageFertility * 100)}% after the plan${weakestRotationField}</span></li>
      <li><span>Next-cycle potential</span><span>${farmPlan.rotation.plannedHarvest.toFixed(1)} grain at current moisture · ${farmPlan.rotation.plannedSeedGrainRequired.toFixed(1)} seed · ${farmPlan.rotation.restoringFields} fields restore / ${farmPlan.rotation.decliningFields} draw soil · future manure excluded</span></li>
    `;
  const farmPlanRows = farmPlan.holdingCount === 0
    ? '<li><span>Cereal plan</span><span>No farm fields linked</span></li>'
    : `
      <li><span>Cereal fields</span><span>${farmPlan.activeFields} active${farmPlan.pausedFields > 0 ? ` · ${farmPlan.pausedFields} paused` : ''} across ${farmPlan.holdingCount} holdings${farmPlan.orphanedFields > 0 ? ` · ${farmPlan.orphanedFields} orphaned` : ''}</span></li>
      <li><span>Ox-supported fields</span><span>${farmPlan.cattleSupportedFields} / ${farmPlan.activeFields} active · plough labor includes current cattle coverage</span></li>
      <li><span>September harvest</span><span>${farmPlan.laborCoveredHarvest.toFixed(1)} / ${farmPlan.expectedHarvest.toFixed(1)} grain covered by current crews</span></li>
      <li><span>Seed on holdings</span><span>${farmPlan.seedGrainCovered.toFixed(1)} / ${farmPlan.seedGrainRequired.toFixed(1)} protected onsite${farmPlan.seedGrainShortfall > 0.05 ? ` · short ${farmPlan.seedGrainShortfall.toFixed(1)} across ${farmPlan.seedShortHoldings} holdings${farmPlan.firstSeedShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${farmPlan.firstSeedShortBuildingId}" aria-label="Inspect first seed shortfall">Inspect</button>` : ''}` : ''}</span></li>
      ${rotationRows}
      <li><span>September field labor</span><span>${formatSettlementFieldWork(farmPlan.harvest)}</span></li>
      <li><span>Spring oats labor</span><span>${formatSettlementFieldWork(farmPlan.spring)}</span></li>
      <li><span>Autumn rye/fallow labor</span><span>${formatSettlementFieldWork(farmPlan.autumn)}</span></li>
    `;
  const livestockFodderRows = livestockFodder.holdingCount === 0
    ? '<li><span>Winter herd plan</span><span>No livestock holdings</span></li>'
    : `
      <li><span>Winter herd plan</span><span>${livestockFodder.projectedHeadCount} projected head · ${livestockFodder.winterPastureCapacity.toFixed(1)} pasture-supported · ${livestockFodder.winterUnsupportedHeads.toFixed(1)} need stored fodder · ${livestockFodder.staffedHoldings}/${livestockFodder.holdingCount} holdings staffed</span></li>
      <li><span>Summer hay plan</span><span>${livestockFodder.haymakingHoldings} / ${livestockFodder.pastoralHoldings} cattle/sheep holdings reserving meadow · ${livestockFodder.summerReservedCapacity.toFixed(1)} pasture capacity reserved · ${livestockFodder.hayOutputPerDay.toFixed(1)} hay / day in season</span></li>
      <li><span>Winter hay reserve</span><span>${livestockFodder.hayStock.toFixed(1)} stored · ${livestockFodder.projectedHayStock.toFixed(1)} projected at winter / ${livestockFodder.winterHayNeed.toFixed(1)} needed${livestockFodder.winterHayShortfall > 0.05 ? ` · short ${livestockFodder.winterHayShortfall.toFixed(1)} before grain` : ''}</span></li>
      <li><span>Winter fodder grain</span><span>${livestockFodder.winterReserveStock.toFixed(1)} / ${livestockFodder.winterReserveTarget.toFixed(1)} onsite after hay${livestockFodder.winterReserveShortfall > 0.05 ? ` · short ${livestockFodder.winterReserveShortfall.toFixed(1)} across ${livestockFodder.shortHoldings} holdings · first combined coverage ${formatProvisionRunway(livestockFodder.firstRunwayDays)}${livestockFodder.firstShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${livestockFodder.firstShortBuildingId}" aria-label="Inspect first winter fodder shortfall">Inspect</button>` : ''}` : ' · stocked to holding targets'}</span></li>
      <li><span>Winter fodder logistics</span><span>${livestockFodder.winterGrainNeed.toFixed(1)} emergency grain after projected hay for ${LIVESTOCK_WINTER_FODDER_RESERVE_DAYS} days · ${livestockFodder.winterGrainPerDay.toFixed(1)} / day after hay runs out${livestockFodder.capacityLimitedHoldings > 0 ? ` · ${livestockFodder.capacityLimitedHoldings} holdings need winter resupply even when full` : ''}</span></li>
    `;
  const linkedMonasteries = [...context.gameState.buildings.values()].filter(
    (candidate) =>
      candidate.kind === 'monastery'
      && candidate.constructionComplete !== false
      && monasteryLinkedToChapel(candidate, growthChapels, roadPathDistance)
      && context.worldQueries.findNearestRoadLinkedBuilding(
        candidate,
        ['marketplace'],
      ) != null,
  );
  const hospitalityPlans = linkedMonasteries.map((candidate) =>
    monasteryHospitalityPlan(candidate, monasteryPolicy.feastsEnabled),
  );
  const hospitalitySupplied = hospitalityPlans.filter(
    (plan) => plan.supplyRatio >= 0.999,
  ).length;
  const hospitalityGoldPerDay = hospitalityPlans.reduce(
    (sum, plan) => sum + plan.pilgrimageGoldPerDay,
    0,
  );
  const hospitalityHoneyPerYear = hospitalityPlans.reduce(
    (sum, plan) => sum + plan.honeyPerYear,
    0,
  );
  const hospitalityWinePerYear = hospitalityPlans.reduce(
    (sum, plan) => sum + plan.winePerYear,
    0,
  );
  const monasteryHospitalityRow = linkedMonasteries.length === 0
    ? '<li><span>Monastery hospitality</span><span>No chapel-and-market-linked monastery</span></li>'
    : monasteryPolicy.feastsEnabled
      ? `<li><span>Monastery hospitality</span><span>${hospitalitySupplied} / ${linkedMonasteries.length} fully supplied · ${hospitalityGoldPerDay.toFixed(2)} pilgrimage gold/day · annual target ${hospitalityHoneyPerYear.toFixed(0)} honey + ${hospitalityWinePerYear.toFixed(0)} wine</span></li>`
      : `<li><span>Monastery hospitality</span><span>Disabled · ${hospitalityGoldPerDay.toFixed(2)} baseline pilgrimage gold/day · honey and wine remain exportable</span></li>`;

  return {
    eyebrow: 'Civic administration',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: staffed
      ? 'Clerk administering taxation and the settlement ledger'
      : `Unstaffed — policy locked and only ${collectionRate}% of assessed tax is collected`,
    statusState: staffed ? 'active' : 'warning',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Settlement government, taxation, and economic ledger</span></li>
      <li><span>Population</span><span>${context.populationStats.total}</span></li>
      <li><span>Workforce</span><span>${context.populationStats.assigned} / ${context.populationStats.total} assigned · ${context.populationStats.available} free · ${laborPlan.openPermanentPosts} open permanent posts${laborInspectButton}</span></li>
      <li><span>Sector staffing</span><span>${formatLaborSectorMix(laborPlan)}</span></li>
      <li><span>Staffing priorities</span><span>${formatStaffingPriorities(laborPlan)}</span></li>
      <li><span>Seasonal steward</span><span>${seasonalLaborStewardStatus(seasonalLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Production steward</span><span>${productionLaborStewardStatus(productionLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Construction steward</span><span>${constructionLaborStewardStatus(constructionLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Steward reserve</span><span>${laborStewardReserveLabel(laborStewardReserve)} · ${context.populationStats.available} currently free</span></li>
      <li><span>Dawn labor review</span><span>${formatLaborStewardForecast(laborStewardForecast, staffedTownHallAvailable)}${laborStewardInspectButton}</span></li>
      <li><span>Seasonal labor</span><span>${formatSeasonalLabor(seasonalLabor)}${seasonalLaborInspectButton}</span></li>
      <li><span>Seasonal call-up</span><span>${formatSeasonalCallup(seasonalCallup)}${seasonalCallupInspectButton}</span></li>
      <li><span>Target-paused workshops</span><span>${formatProcessorLaborRecall(processorLaborRecall)}${processorLaborRecallInspectButton}</span></li>
      <li><span>Production call-up</span><span>${formatProcessorLaborCallup(productionLaborCallup)}${productionLaborCallupInspectButton}</span></li>
      <li><span>Year-round balance</span><span>${formatYearRoundLaborRotation(yearRoundLabor)}${yearRoundLaborInspectButton}</span></li>
      <li><span>Production stalls</span><span>${formatWorksiteStalls(worksiteStalls, (kind) => context.worldQueries.getBuildingLabel(kind))}</span></li>
      <li><span>At full housing labor</span><span>${formatFullHousingLabor(laborPlan)}</span></li>
      <li><span>Work in motion</span><span>${formatWorkInMotion(laborPlan)}</span></li>
      ${renderSettlementHaulageRows(laborPlan.haulage)}
      <li><span>Next dawn outlook</span><span>${nextDawnOutlook}</span></li>
      ${renderConstructionQueueRows(constructionPlan)}
      <li><span>Construction crews</span><span>${formatConstructionLabor(constructionLabor)}${constructionLaborInspectButton}</span></li>
      ${renderStorehouseNetworkRows(laborPlan.storehouseNetwork)}
      <li><span>Housing pipeline</span><span>${growth.vacantSlots} vacant places · ${growth.progressingHomes} / ${growth.candidateHomes} homes admitting settlers${growth.firstArrivalHomes > 0 ? ` · ${growth.firstArrivalHomes} awaiting first household` : ''}${growth.abandonedHomes > 0 ? ` · ${growth.abandonedHomes} abandoned` : ''}</span></li>
      <li><span>Next settler</span><span>${growth.nextArrivalSeconds === null ? growth.vacantSlots > 0 ? 'Paused until household buffers recover' : 'No vacant housing' : formatGrowthDuration(growth.nextArrivalSeconds)}</span></li>
      <li><span>Growth bottlenecks</span><span>${formatGrowthBottlenecks(growth)}${growthInspectButton}</span></li>
      <li><span>At full housing</span><span>+${growth.additionalFoodPerDay.toFixed(1)} food/day · +${growth.additionalWaterPerDay.toFixed(1)} water/day · +${growth.additionalWinterFirewoodPerDay.toFixed(1)} winter firewood/day</span></li>
      ${growth.additionalPreservedFoodPerDay + growth.additionalAlePerDay + growth.additionalClothPerDay > 1e-6 ? `<li><span>Prosperous-house growth</span><span>+${growth.additionalPreservedFoodPerDay.toFixed(1)} preserved food/day · +${growth.additionalAlePerDay.toFixed(1)} ale/day · +${growth.additionalClothPerDay.toFixed(2)} cloth/day</span></li>` : ''}
      <li><span>Village activity</span><span>${readout.gdpLabel}</span></li>
      <li><span>Trade productivity</span><span>${readout.productivityLabel}</span></li>
      <li><span>Household wealth</span><span>${readout.householdWealthLabel}</span></li>
      <li><span>Household savings</span><span>${readout.householdSavingsLabel}</span></li>
      <li><span>Assessed tax</span><span>${readout.taxIncomeLabel}</span></li>
      <li><span>Collection capacity</span><span>${collectionRate}%${staffed ? '' : ' while unstaffed'}</span></li>
      <li><span>Chapel tithe</span><span>${readout.chapelTitheLabel}</span></li>
      <li><span>Parish expenses</span><span>${readout.parishExpenseLabel}</span></li>
      <li><span>Parish coffers</span><span>${readout.cofferBalanceLabel}</span></li>
      <li><span>Parish ledger</span><span>${readout.parishLedgerLabel}</span></li>
      <li><span>Food reserve</span><span>${formatProvisionRunway(provisioning.foodRunwayDays)} · ${provisioning.totalFoodPerDay.toFixed(1)} consumed / day</span></li>
      ${freshFoodPreservationRows}
      <li><span>Household delivery buffer</span><span>${formatHouseholdBufferReadiness(provisioning)}</span></li>
      <li><span>Winter firewood</span><span>${Math.round(provisioning.firewoodStock)} / ${Math.ceil(provisioning.winterFirewoodNeed)} · ${formatProvisionRunway(provisioning.winterFirewoodRunwayDays)} of ${WINTER_RESERVE_DAYS}</span></li>
      ${provisioning.sabbathObserved ? `<li><span>Sunday household stores</span><span>${formatSabbathReadiness(provisioning)}</span></li>` : ''}
      <li><span>Processing basis</span><span>${processingWeek}</span></li>
      <li><span>Processor buffer basis</span><span>First staffed site to stop or fill · onsite stock plus carts that unload before depletion</span></li>
      <li><span>Mill buffers</span><span>Input ${formatProcessorInputBuffer(production.millInputBuffer)} · flour room ${formatProcessorOutputRoom(production.millOutputRoom)} ${processorInspectButton('mill', production.millInputBuffer, production.millOutputRoom)}</span></li>
      <li><span>Granary bakery buffers</span><span>Input ${formatProcessorInputBuffer(production.bakeryInputBuffer)} · food room ${formatProcessorOutputRoom(production.bakeryOutputRoom)} ${processorInspectButton('granary bakery', production.bakeryInputBuffer, production.bakeryOutputRoom)}</span></li>
      <li><span>Brewery buffers</span><span>Input ${formatProcessorInputBuffer(production.breweryInputBuffer)} · ale room ${formatProcessorOutputRoom(production.breweryOutputRoom)} ${processorInspectButton('brewery', production.breweryInputBuffer, production.breweryOutputRoom)}</span></li>
      <li><span>Smokehouse buffers</span><span>Input ${formatProcessorInputBuffer(production.smokehouseInputBuffer)} · preserved-food room ${formatProcessorOutputRoom(production.smokehouseOutputRoom)} ${processorInspectButton('smokehouse', production.smokehouseInputBuffer, production.smokehouseOutputRoom)}</span></li>
      <li><span>Weaver buffers</span><span>Input ${formatProcessorInputBuffer(production.weaverInputBuffer)} · cloth room ${formatProcessorOutputRoom(production.weaverOutputRoom)} ${processorInspectButton('weaver', production.weaverInputBuffer, production.weaverOutputRoom)}</span></li>
      <li><span>Processing labor</span><span>${production.millWorkers} mill · ${production.bakeryWorkers} granary · ${production.breweryWorkers} brewing · ${production.smokehouseWorkers} preserving · ${production.weaverWorkers} weaving</span></li>
      <li><span>Mill / bakery balance</span><span>${production.flourOutputPerDay.toFixed(1)} flour made / ${production.bakeryFlourCapacityPerDay.toFixed(1)} bakery intake · ${flourBalance}</span></li>
      <li><span>Bread capacity</span><span>${production.breadFoodCapacityPerDay.toFixed(1)} food / day vs ${provisioning.totalFoodPerDay.toFixed(1)} total demand · needs ${production.breadGrainPerDay.toFixed(1)} grain + ${production.breadWaterPerDay.toFixed(1)} water + ${production.breadFirewoodPerDay.toFixed(1)} firewood</span></li>
      <li><span>Ale capacity</span><span>${production.aleOutputPerDay.toFixed(1)} / day vs ${production.aleDemandPerDay.toFixed(1)} tier-3 demand · needs ${production.aleGrainPerDay.toFixed(1)} grain + ${production.aleWaterPerDay.toFixed(1)} water</span></li>
      <li><span>Preservation capacity</span><span>${production.preservedFoodOutputPerDay.toFixed(1)} / day vs ${production.preservedFoodDemandPerDay.toFixed(1)} tier-3 demand · needs ${production.preservationFreshFoodPerDay.toFixed(1)} fresh food + ${production.preservationFirewoodPerDay.toFixed(1)} firewood</span></li>
      <li><span>Cloth capacity</span><span>${production.clothOutputPerDay.toFixed(1)} / day vs ${production.clothDemandPerDay.toFixed(1)} tier-3 demand · needs ${production.clothWoolPerDay.toFixed(1)} wool</span></li>
      <li><span>Prosperity throughput</span><span>${formatProsperityCapacity(prosperity)}</span></li>
      <li><span>Prosperous housing pipeline</span><span>${formatProsperityHousingPipeline(prosperity)} · assumes staffed workshops remain fully supplied</span></li>
      ${renderSettlementTextileRows(textilePlan)}
      ${renderSettlementGrainRows(grainPlan)}
      ${renderSettlementSeedProcurementRows(seedProcurement, farmPlan.firstSeedShortBuildingId)}
      ${monasteryHospitalityRow}
      ${farmPlanRows}
      ${centralGrainReserveRow}
      ${livestockFodderRows}
      <li><span>Armed establishment</span><span>${provisioning.assignedGuards > 0
        ? `${provisioning.armedGuards} / ${provisioning.assignedGuards} armed · ${provisioning.unarmedGuards} need polearms`
        : 'No guard company assigned'}</span></li>
      ${provisioning.armedGuards > 0 ? `<li><span>Guardhouse food</span><span>${provisioning.guardFoodStock.toFixed(1)} on site · first shortfall ${formatProvisionRunway(provisioning.guardProvisionRunwayDays)}</span></li>
      <li><span>Ration reserves</span><span>${provisioning.guardFoodStock.toFixed(1)} / ${guardProvisionTarget.toFixed(1)} food target · ${leanReserveCompanies} lean · ${standardReserveCompanies} company · ${deepReserveCompanies} deep</span></li>
      <li><span>Guard wages</span><span>${provisioning.guardWagePerDay.toFixed(1)} gold / day · ${formatProvisionRunway(provisioning.guardWageRunwayDays)}</span></li>
      <li><span>Next-day payroll</span><span>${payrollGoldFunded.toFixed(1)} / ${payrollGoldDue.toFixed(1)} gold funded${underfundedCompany ? ` · ${guardhousePayroll.filter((company) => company.fundedRatio < 0.999).length} companies at risk <button type="button" class="inspector-jump-button" data-inspect-building="${underfundedCompany.building.id}" aria-label="Inspect first underfunded guardhouse">Inspect</button>` : ' · all companies funded'}</span></li>
      <li><span>Payroll priorities</span><span>${highPriorityCompanies} high · ${normalPriorityCompanies} normal · ${lowPriorityCompanies} low</span></li>` : ''}
      ${context.conflictEnabled ? `<li><span>Imported ironwork</span><span>${Math.round(context.resourceTotals.ironwork)}</span></li>` : ''}
      <li><span>Polearms on hand</span><span>${Math.round(context.resourceTotals.polearms)}</span></li>
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
    supplementalPanelHtml: `
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">The Town Hall sets the settlement-wide activity tax. Chapel and monastery policy remain at those buildings.</p>
        <label class="city-admin-panel__slider-label">
          <span>Activity tax rate</span>
          <strong data-policy-tax-rate-value>${Math.round(taxRate * 100)}%</strong>
        </label>
        <input class="city-admin-panel__slider" type="range"
          data-policy-tax-rate
          min="${Math.round(ECONOMIC_ACTIVITY_TAX_RATE_MIN * 100)}"
          max="${Math.round(ECONOMIC_ACTIVITY_TAX_RATE_MAX * 100)}"
          step="1" value="${Math.round(taxRate * 100)}" ${staffed ? '' : 'disabled'} />
        <div class="city-admin-panel__range-hints"><span>Growth</span><span>Revenue</span></div>
      </div>
      <div class="inspector-action-panel">
        <label class="city-admin-panel__toggle">
          <input type="checkbox" data-policy-seasonal-labor-steward
            ${seasonalLaborStewardEnabled ? 'checked' : ''}
            ${staffedTownHallAvailable ? '' : 'disabled'} />
          <span>Daily seasonal labor steward</span>
        </label>
        <p class="inspector-action-panel__hint">At each new calendar day, a staffed Town Hall releases dormant farm, forage, fishing, apiary, and vineyard crews before assigning free labor to active seasonal sites. Existing staffing priorities decide the order; year-round jobs, builders, and production-workshop crews are untouched. Enabling performs one review immediately. Manual is the save-compatible default.</p>
        ${!staffedTownHallAvailable ? '<p class="inspector-action-panel__hint">Assign a Town Hall clerk to change or run this policy.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <label class="city-admin-panel__slider-label" for="town-hall-labor-steward-reserve">
          <span>Automatic labor reserve</span>
          <strong>${laborStewardReserve}</strong>
        </label>
        <select class="inspector-policy-select" id="town-hall-labor-steward-reserve"
          data-policy-labor-steward-reserve ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${LABOR_STEWARD_RESERVE_OPTIONS
            .map((reserve) => `<option value="${reserve}" ${reserve === laborStewardReserve ? 'selected' : ''}>${reserve === 0 ? '0 — Full automatic deployment' : `${reserve} — Hold ${reserve === 1 ? 'one villager' : `${reserve} villagers`} free`}</option>`)
            .join('')}
        </select>
        <p class="inspector-action-panel__hint">All enabled dawn stewards share this floor after safe crew releases. It preserves labor for explicit orders and emergencies without dismissing productive crews merely to reach the floor. Manual call-ups can still use the reserve.</p>
        ${!staffedTownHallAvailable ? '<p class="inspector-action-panel__hint">Assign a Town Hall clerk to change this policy.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <label class="city-admin-panel__toggle">
          <input type="checkbox" data-policy-production-labor-steward
            ${productionLaborStewardEnabled ? 'checked' : ''}
            ${staffedTownHallAvailable ? '' : 'disabled'} />
          <span>Daily production labor steward</span>
        </label>
        <p class="inspector-action-panel__hint">At each new calendar day, a staffed Town Hall releases surplus crews only from genuinely stalled workshops, blocked quarries, and reserve-held hunting halls, retaining a dispatcher for stored output or an active cart. It then fills supplied, below-target production sites by staffing priority and fair within-tier rotation. Matching inbound supplies protect recovering workshops. The Dawn labor review previews the full seasonal → production → construction sequence against one shared labor pool without issuing orders. Enabling performs one review immediately.</p>
        ${!staffedTownHallAvailable ? '<p class="inspector-action-panel__hint">Assign a Town Hall clerk to change or run this policy.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <label class="city-admin-panel__toggle">
          <input type="checkbox" data-policy-construction-labor-steward
            ${constructionLaborStewardEnabled ? 'checked' : ''}
            ${staffedTownHallAvailable ? '' : 'disabled'} />
          <span>Daily construction labor steward</span>
        </label>
        <p class="inspector-action-panel__hint">At each new calendar day, a staffed Town Hall releases builders only from sites that cannot progress and have no supply cart approaching, then fills immediately productive sites by urgent, normal, and low priority. Crews awaiting inbound material stay assigned and equal-priority sites share workers round-robin. Enabling performs one rotation immediately. When multiple stewards are enabled, active seasonal work is reviewed first, production second, and construction last.</p>
        ${!staffedTownHallAvailable ? '<p class="inspector-action-panel__hint">Assign a Town Hall clerk to change or run this policy.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Rotate construction labor now using the existing queue priorities. Builders are released only from sites that cannot progress and have no supply cart approaching; crews awaiting inbound material stay in place. Free workers then fill immediately productive urgent sites before normal and low sites, sharing workers round-robin within each tier.${constructionLaborStewardEnabled ? ' The daily steward repeats this safe rotation automatically.' : ' Future rotations remain manual.'}</p>
        <button type="button" class="resource-action-button" data-rotate-construction-labor ${staffedTownHallAvailable && constructionLabor.assignments.length > 0 ? '' : 'disabled'}>
          ${constructionLabor.recalledWorkers > 0 && constructionLabor.calledWorkers > 0
            ? `Rotate ${constructionLabor.recalledWorkers} blocked → ${constructionLabor.calledWorkers} ready`
            : constructionLabor.recalledWorkers > 0
              ? `Recall ${constructionLabor.recalledWorkers} blocked ${constructionLabor.recalledWorkers === 1 ? 'builder' : 'builders'}`
              : constructionLabor.calledWorkers > 0
                ? `Deploy ${constructionLabor.calledWorkers} construction ${constructionLabor.calledWorkers === 1 ? 'worker' : 'workers'}`
                : 'No construction crew changes ready'}
        </button>
        ${!staffedTownHallAvailable && constructionLabor.assignments.length > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to issue a settlement-wide construction rotation.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Recall only surplus crews at seasonally dormant farms, apiaries, vineyards, foragers, and fishing camps. One hauler remains wherever stored goods or an active cart still need attention. Staffing priorities stay unchanged.${seasonalLaborStewardEnabled ? ' The steward will call labor back when work becomes active.' : ' You must restaff before the next work window.'}</p>
        <button type="button" class="resource-action-button" data-recall-idle-seasonal-labor ${staffedTownHallAvailable && seasonalLabor.reclaimableWorkers > 0 ? '' : 'disabled'}>
          ${seasonalLabor.reclaimableWorkers > 0
            ? `Recall ${seasonalLabor.reclaimableWorkers} idle ${seasonalLabor.reclaimableWorkers === 1 ? 'worker' : 'workers'}`
            : 'No seasonal workers to recall'}
        </button>
        ${!staffedTownHallAvailable && seasonalLabor.reclaimableWorkers > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to issue a settlement-wide recall.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Call free workers only to seasonal sites whose work is active now. High staffing priority fills before normal, then low; within a tier each site receives one worker before any receives another. Existing crews are never displaced.${seasonalLaborStewardEnabled ? ' The next daily review repeats this rule automatically.' : ' Future hiring remains manual.'}</p>
        <button type="button" class="resource-action-button" data-call-up-active-seasonal-labor ${staffedTownHallAvailable && seasonalCallup.callupWorkers > 0 ? '' : 'disabled'}>
          ${seasonalCallup.callupWorkers > 0
            ? `Call up ${seasonalCallup.callupWorkers} seasonal ${seasonalCallup.callupWorkers === 1 ? 'worker' : 'workers'}`
            : seasonalCallup.openPosts > 0
              ? 'No free labor to call up'
              : 'No active seasonal vacancies'}
        </button>
        ${!staffedTownHallAvailable && seasonalCallup.callupWorkers > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to issue a settlement-wide call-up.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Recall only labor that cannot currently produce: workshops with an empty input or reached output target, blocked quarries, and active-season hunting or fishing sites without harvestable stock. Matching inbound supplies protect recovering workshops. One dispatcher remains for stored output or an active cart.${productionLaborStewardEnabled ? ' The steward will redeploy released labor to ready production sites.' : ' Restaffing remains an explicit decision.'}</p>
        <button type="button" class="resource-action-button" data-recall-target-idle-processor-labor ${staffedTownHallAvailable && worksiteStalls.reclaimableWorkers > 0 ? '' : 'disabled'}>
          ${worksiteStalls.reclaimableWorkers > 0
            ? `Recall ${worksiteStalls.reclaimableWorkers} stalled production ${worksiteStalls.reclaimableWorkers === 1 ? 'worker' : 'workers'}`
            : 'No stalled production workers to recall'}
        </button>
        ${!staffedTownHallAvailable && worksiteStalls.reclaimableWorkers > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to issue a settlement-wide stalled-production recall.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Deploy free labor to completed production sites that can accept work: workshops below their output ceiling, quarries with usable stone and yard room, and hunting halls with harvestable game above their reserve. High staffing priority fills before normal, then low; equal-priority sites share workers round-robin. This manual order may pre-staff an empty workshop in preparation for future carts. Existing crews are never displaced.${productionLaborStewardEnabled ? ' The daily steward is stricter and calls workshops only when inputs are present or already inbound.' : ' Future hiring remains manual.'}</p>
        <button type="button" class="resource-action-button" data-call-up-target-ready-processor-labor ${staffedTownHallAvailable && productionLaborCallup.callupWorkers > 0 ? '' : 'disabled'}>
          ${productionLaborCallup.callupWorkers > 0
            ? `Deploy ${productionLaborCallup.callupWorkers} production ${productionLaborCallup.callupWorkers === 1 ? 'worker' : 'workers'}`
            : productionLaborCallup.openPosts > 0
              ? 'No free labor to deploy'
              : 'No ready production vacancies'}
        </button>
        ${!staffedTownHallAvailable && productionLaborCallup.callupWorkers > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to deploy production crews.</p>' : ''}
      </div>
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Balance completed year-round services and ordinary industries using free labor first. If higher-priority vacancies remain, the minimum necessary workers move from strictly lower tiers, taking the lowest tier and newest stable worksite first. Equal-priority crews, seasonal sites, source-bound production, builders, and Town Hall clerks are never displaced. Future hiring remains explicit.</p>
        <button type="button" class="resource-action-button" data-balance-year-round-labor ${staffedTownHallAvailable && yearRoundLabor.assignments.length > 0 ? '' : 'disabled'}>
          ${yearRoundLabor.recalledWorkers > 0
            ? `Reassign ${yearRoundLabor.recalledWorkers} lower-priority ${yearRoundLabor.recalledWorkers === 1 ? 'worker' : 'workers'}`
            : yearRoundLabor.calledWorkers > 0
              ? `Deploy ${yearRoundLabor.calledWorkers} year-round ${yearRoundLabor.calledWorkers === 1 ? 'worker' : 'workers'}`
              : yearRoundLabor.openPosts > 0
                ? 'Year-round priorities already balanced'
                : 'No year-round vacancies'}
        </button>
        ${!staffedTownHallAvailable && yearRoundLabor.assignments.length > 0 ? '<p class="inspector-action-panel__hint">Assign a clerk to balance year-round crews.</p>' : ''}
      </div>
    `,
  };
}
