import {
  ECONOMIC_ACTIVITY_TAX_RATE_MAX,
  ECONOMIC_ACTIVITY_TAX_RATE_MIN,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY } from '../../economy/monasteryPolicy.ts';
import {
  DEFAULT_NIGHT_POLICY,
  formatDawnReport,
  NIGHT_CURFEW_OPTIONS,
  NIGHT_GATHERING_OPTIONS,
  NIGHT_LIGHTING_OPTIONS,
  NIGHT_WATCH_OPTIONS,
  NIGHT_WORK_OPTIONS,
} from '../../economy/nightPolicy.ts';
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
import {
  formatNextMonasteryFeast,
  monasteryFeastReadiness,
  monasteryHospitalityPlan,
  nextMonasteryFeast,
} from '../../economy/monasteryHospitality.ts';
import { computeSettlementLivestockFodderPlan } from '../../economy/livestockFodder.ts';
import { buildVillageAdminReadout } from '../../economy/villageAdminReadout.ts';
import type {
  SettlementBackyardEconomyPlan,
} from '../../economy/settlementBackyardEconomy.ts';
import {
  computeSettlementProvisioning,
  formatHouseholdBufferReadiness,
  formatProvisionRunway,
  formatSabbathReadiness,
  type SettlementRoadProvisioning,
  WINTER_RESERVE_DAYS,
} from '../../economy/settlementProvisioning.ts';
import type { SettlementWelfare } from '../../economy/settlementWelfare.ts';
import { computeSettlementFirewoodPlan } from '../../economy/settlementFirewood.ts';
import {
  formatFreshFoodLoss,
  formatPreservedFoodLoss,
  type FreshFoodLossSite,
  type FreshFoodPreservation,
  type GranaryFreshFoodNetwork,
} from '../../economy/foodPreservation.ts';
import { computeSettlementGranaryReserve } from '../../economy/granaryPolicy.ts';
import {
  computeSettlementGrainPlan,
  GRAIN_PLAN_DAYS_PER_YEAR,
  type SettlementGrainPlan,
  type SettlementGrainRoadPlan,
} from '../../economy/settlementGrainPlan.ts';
import {
  computeSettlementFireRecoveryPlan,
  type SettlementFireRecoveryPlan,
  type SettlementFireRecoveryTarget,
} from '../../economy/settlementFireRecovery.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';
import {
  computeSettlementSeedProcurementPlan,
  type SettlementSeedProcurementAttention,
  type SettlementSeedProcurementPlan,
} from '../../economy/settlementSeedProcurement.ts';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
} from '../../economy/marketplaceSeedPolicy.ts';
import {
  MARKETPLACE_SALT_IMPORT_OFFER,
} from '../../economy/marketplaceMaterialProcurementPolicy.ts';
import { marketplaceTradeOfferCost } from '../../economy/marketplaceTrade.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../../economy/regionalMarket.ts';
import {
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketBottlenecks,
  formatHouseholdMarketPurchasingPower,
  formatHouseholdMarketSettlementSummary,
} from '../../economy/settlementHouseholdMarket.ts';
import {
  computeSettlementParishReliefPlan,
  formatSettlementParishCoverage,
  formatSettlementParishRelief,
} from '../../economy/settlementParishRelief.ts';
import { computeSettlementGrowthPlan, type SettlementGrowthPlan } from '../../economy/settlementGrowth.ts';
import {
  computeSettlementConstructionPlan,
  constructionQueueStatusLabel,
  type ConstructionMaterialQueue,
  type SettlementConstructionPlan,
  type SettlementConstructionRoadPlan,
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
  type GrainChainRoadPlan,
  type IndustrialMaterialPlan,
  type ProcessorInputBuffer,
  type ProcessorOutputRoom,
} from '../../economy/settlementProduction.ts';
import {
  computeSettlementPreservationReservePlan,
  type SettlementPreservationReservePlan,
} from '../../economy/settlementPreservationReserve.ts';
import {
  computeSettlementProsperityPlan,
  type ProsperityRoadPlan,
  type SettlementProsperityPlan,
} from '../../economy/settlementProsperity.ts';
import {
  computeSettlementTextilePlan,
  textileChainBalanceLabel,
  TEXTILE_PLAN_DAYS_PER_YEAR,
  TEXTILE_RESERVE_WARNING_DAYS,
  type SettlementTextilePlan,
} from '../../economy/settlementTextiles.ts';
import {
  computeSettlementArmamentPlan,
  type SettlementArmamentPlan,
} from '../../economy/settlementArmament.ts';
import {
  computeSettlementSpecialtyExportPlan,
  type SettlementSpecialtyExportPlan,
  type SpecialtyExportAttentionKind,
  type SpecialtyExportCargoKind,
} from '../../economy/settlementSpecialtyExports.ts';
import {
  buildSettlementFarmPlan,
  type SettlementSeasonalWorkPlan,
} from '../../farming/farmWorkPlanning.ts';
import { buildResidenceCommunityContext } from '../../economy/economyInspectorViews.ts';
import {
  findServingChapel,
  isResidenceInMonasteryCoverage,
  monasteryLinkedToChapel,
  settlementHasStaffedChapel,
} from '../../logistics/landmarkAccess.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import {
  guardhousePayrollDispatchPlan,
  guardhousePayrollInTransitGold,
  guardhousePayrollPlan,
} from '../../security/guardhousePayrollPolicy.ts';
import {
  computeRefugeShelterPlan,
  formatFrontierForecast,
  formatFrontierRaidTiming,
  formatRaidReport,
  frontierThreatLabel,
  GUARDHOUSE_FOOD_RESERVE_DEEP,
  GUARDHOUSE_FOOD_RESERVE_LEAN,
  guardhouseFoodTarget,
  normalizeGuardhouseFoodReserve,
  type RefugeShelterPlan,
  type SettlementSecurityState,
} from '../../security/frontierSecurity.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { cropLabel } from '../../farming/farmFieldMath.ts';
import {
  describeNextDayEnvironmentOutlook,
  environmentFor,
  nextDayEnvironmentOutlook,
} from '../../world/seasonPolicy.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import { FARM_CROPS, type BuildingKind, type InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderSettlementWelfareRows(welfare: SettlementWelfare): string {
  const welfareInspectButton = welfare.firstAttentionResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${welfare.firstAttentionResidenceId}" aria-label="Inspect highest-risk household">Inspect</button>`;
  const decayInspectButton = welfare.firstDecayResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${welfare.firstDecayResidenceId}" aria-label="Inspect most decayed vacant home">Inspect</button>`;
  const hungerStatus = [
    welfare.hungryResidents > 0 ? `${welfare.hungryResidents} hungry` : null,
    welfare.malnourishedResidents > 0
      ? `${welfare.malnourishedResidents} malnourished`
      : null,
    welfare.starvingResidents > 0 ? `${welfare.starvingResidents} starving` : null,
  ].filter(Boolean).join(' · ') || 'no hunger warning';
  const comfortStatus = welfare.comfortWarningHouseholds > 0
    ? ` · ${welfare.comfortWarningHouseholds} comfort-strained homes / ${welfare.migrationRiskHouseholds} at emigration risk`
    : '';
  const burialStatus = welfare.burialGrounds > 0
    ? `${welfare.occupiedGraves} occupied + ${welfare.reservedGraves} reserved / ${welfare.graveCapacity} graves · ${welfare.openGraves} open`
    : 'no consecrated burial ground';

  return `
    <li><span>Household health</span><span>${welfare.stableHouseholds} / ${welfare.activeHouseholds} occupied homes stable · ${hungerStatus}${comfortStatus}${welfareInspectButton}</span></li>
    <li><span>Illness and remedies</span><span>${welfare.sickResidents} residents unable to work across ${welfare.sickHouseholds} homes · ${welfare.householdRemedyStock.toFixed(1)} at homes + ${welfare.preparedRemedyStock.toFixed(1)} at sheds + ${welfare.remediesInTransit.toFixed(1)} on carts · ${welfare.remedyDemandPerDay.toFixed(2)} / day · ${formatWelfareRunway(welfare.remedyRunwayDays)}${welfare.untreatedSickHouseholds > 0 ? ` · ${welfare.untreatedSickHouseholds} homes await one treatment day` : ''}</span></li>
    <li><span>Mortality and burial</span><span>${welfare.totalDeaths} deaths recorded · ${welfare.uncollectedBodiesAtHomes} bodies remain at homes (${welfare.waitingBodies} waiting, ${welfare.outboundEmptyCarts} empty carts outbound) · ${welfare.loadedBurialCarts} loaded carts inbound · ${burialStatus} · ${welfare.staffedGravediggers} chapel workers available</span></li>
    <li><span>Vacant structures</span><span>${welfare.vacantSoundHomes} sound · ${welfare.neglectedHomes} neglected · ${welfare.dilapidatedHomes} dilapidated · ${welfare.ruinedHomes} ruins · ${welfare.activeDecayRepairs} active restorations${decayInspectButton}</span></li>
  `;
}

function formatWelfareRunway(days: number): string {
  if (!Number.isFinite(days)) return 'no current herb demand';
  if (days < 1) return 'less than one treatment day';
  if (days < 10) return `${days.toFixed(1)} treatment days`;
  return `${Math.floor(days)} treatment days`;
}

function renderFrontierSecurityRows(
  security: SettlementSecurityState,
  refugePlan: RefugeShelterPlan,
  simTick: number,
  month: number,
  enemyPressure: number,
): string {
  const threat = frontierThreatLabel(
    security,
    { conflictMode: 'frontier' },
    month,
  );
  const coverage = Math.round(security.coverage * 100);
  const refugeCapacity = refugePlan.activeRefuges <= 0
    ? 'No active palisaded refuge'
    : `${refugePlan.assignedResidents} / ${refugePlan.totalResidentCapacity} warned residents assigned across ${refugePlan.activeRefuges} ${
        refugePlan.activeRefuges === 1 ? 'refuge' : 'refuges'
      }${
        refugePlan.unassignedWarnedResidents > 0
          ? ` · ${refugePlan.unassignedWarnedResidents} warned residents in reach still lack whole-household room`
          : refugePlan.warnedHomesInReach > 0
            ? ' · every warned household in refuge reach has room'
            : ' · no warned households currently in refuge reach'
      }`;
  return `
    <li><span>Frontier timetable</span><span>${threat} · ${formatFrontierRaidTiming(security, simTick, month)} · enemy pressure ${Math.round(enemyPressure)}%</span></li>
    <li><span>Watch districts</span><span>${coverage}% of weighted holdings watched · ${security.staffedWatchtowers} staffed ${security.staffedWatchtowers === 1 ? 'watchtower' : 'watchtowers'} · weakest likely district ${security.readyGuards.toFixed(1)} / ${security.guardsRequired.toFixed(1)} guards · companies ${Math.round(security.defenseReadiness * 100)}% supplied, paid, drilled, and road-linked · unlinked armed companies still deploy cross-country but are not credited to a specific district forecast</span></li>
    <li><span>Civilian refuge capacity</span><span>${refugeCapacity}</span></li>
    <li><span>Projected incursion</span><span>${formatFrontierForecast(security, enemyPressure)}</span></li>
    <li><span>Last incursion</span><span>${formatRaidReport(security)}</span></li>
  `;
}

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

function formatGrainChainRoads(plan: GrainChainRoadPlan): string {
  if (plan.activeBranches === 0) return 'No staffed mill or granary';
  const pairing = `${plan.matchedBranches} / ${plan.activeBranches} ${
    plan.activeBranches === 1 ? 'branch' : 'branches'
  } pair milling and baking`;
  const unpaired = [
    plan.millOnlyBranches > 0 ? `${plan.millOnlyBranches} mill-only` : '',
    plan.bakeryOnlyBranches > 0 ? `${plan.bakeryOnlyBranches} bakery-only` : '',
  ].filter(Boolean).join(' · ');
  if (plan.hypotheticalFoodPerDay <= 0.05) {
    return `${pairing}${unpaired ? ` · ${unpaired}` : ''}`;
  }
  if (plan.fragmentationFoodPerDay <= 0.05) {
    return `${pairing} · no throughput lost between road branches${
      unpaired ? ` · ${unpaired}` : ''
    }`;
  }
  const inspect = plan.firstImbalancedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstImbalancedBuildingId}" aria-label="Inspect most imbalanced grain-chain branch">Inspect</button>`;
  return `${pairing} · ${plan.fragmentationFoodPerDay.toFixed(1)} food / day unavailable until branches connect${
    unpaired ? ` · ${unpaired}` : ''
  }${inspect}`;
}

function formatIndustrialRoads(plan: IndustrialMaterialPlan): string {
  if (plan.activeRoadBranches === 0) {
    return 'No staffed clay, pottery, charcoal, smithing, or preservation branch';
  }
  const potteryInspect = plan.firstPotteryBottleneckId === null
    ? plan.firstPotteryBottleneckResidenceId === null
      ? ''
      : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${plan.firstPotteryBottleneckResidenceId}" aria-label="Inspect first household without pottery-chain coverage">Inspect home</button>`
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstPotteryBottleneckId}" aria-label="Inspect pottery-chain bottleneck">Inspect pottery</button>`;
  const smithyInspect = plan.firstSmithyBottleneckId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstSmithyBottleneckId}" aria-label="Inspect ironwork-chain bottleneck">Inspect ironwork</button>`;
  const blocked = [
    plan.potteryBlockedBranches > 0
      ? `${plan.potteryBlockedBranches} pottery-blocked`
      : '',
    plan.smithyBlockedBranches > 0
      ? `${plan.smithyBlockedBranches} forge-blocked`
      : '',
  ].filter(Boolean).join(' &middot; ');
  return `${plan.activeRoadBranches} active ${
    plan.activeRoadBranches === 1 ? 'branch' : 'branches'
  } &middot; ${plan.potteryMatchedBranches} pottery-connected &middot; ${
    plan.smithyMatchedBranches
  } forge-connected${
    blocked ? ` &middot; ${blocked}` : ' &middot; no upstream route break'
  }${potteryInspect}${smithyInspect}`;
}

function formatRoadProvisioning(plan: SettlementRoadProvisioning | null): string {
  if (plan === null) return 'Road ledger unavailable';
  if (plan.activeBranches === 0) return 'No occupied road branches';
  const food = `${plan.physicalFoodStock.toFixed(1)} fresh + ${plan.physicalPreservedFoodStock.toFixed(1)} preserved on matching branches · ${plan.foodSuppliedBranches} / ${plan.activeBranches} branches have a stocked fresh-food route · weakest fresh runway ${formatProvisionRunway(plan.worstFoodRunwayDays)} with finite cured rotation${plan.foodUnservedBranches > 0 ? ` · ${plan.foodUnservedHouseholds} homes across ${plan.foodUnservedBranches} ${plan.foodUnservedBranches === 1 ? 'branch' : 'branches'} have no stocked fresh route` : ''}`;
  const fuel = plan.heatedBranches === 0
    ? 'no heated homes'
    : `${plan.physicalFirewoodStock.toFixed(1)} physical fuel · ${plan.firewoodSuppliedBranches} / ${plan.heatedBranches} heated branches have a distributor · weakest winter runway ${formatProvisionRunway(plan.worstWinterFirewoodRunwayDays)}${plan.firewoodUnservedBranches > 0 ? ` · ${plan.firewoodUnservedHouseholds} heated homes have no distributor` : ''}`;
  const inspect = plan.firstExposedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${plan.firstExposedResidenceId}" aria-label="Inspect first road-branch provision exposure">Inspect</button>`;
  return `${food} · winter fuel: ${fuel}${inspect}`;
}

function formatGrowthDuration(seconds: number | null): string {
  if (seconds === null) return 'Paused';
  if (seconds >= 120) return `~${Math.max(1, Math.round(seconds / 60))} min`;
  return `~${Math.max(1, Math.round(seconds))}s`;
}

function formatGrowthBottlenecks(plan: SettlementGrowthPlan): string {
  if (plan.candidateHomes === 0) {
    return plan.fireDisabledVacantSlots > 0
      ? `${plan.fireDisabledVacantSlots} vacant ${plan.fireDisabledVacantSlots === 1 ? 'place is' : 'places are'} offline pending structural recovery`
      : 'No vacant housing';
  }
  if (plan.pausedHomes === 0) return 'All admitting homes hold their required buffers';
  const labels: Array<[keyof SettlementGrowthPlan['waitingOnHomes'], string]> = [
    ['food', 'food'],
    ['firewood', 'firewood'],
    ['water', 'water'],
    ['preservedFood', 'preserved food'],
    ['ale', 'ale'],
    ['cloth', 'textiles'],
    ['pottery', 'pottery'],
  ];
  return labels
    .filter(([kind]) => plan.waitingOnHomes[kind] > 0)
    .map(([kind, label]) => `${label} ${plan.waitingOnHomes[kind]}`)
    .join(' · ');
}

function formatProsperityCapacity(plan: SettlementProsperityPlan): string {
  const usableCapacity = plan.roadPlan?.roadMatchedResidentCapacity
    ?? plan.installedResidentCapacity;
  if (usableCapacity <= 0) {
    if (plan.roadPlan && plan.installedResidentCapacity > 0) {
      return `No road branch contains the full prosperity chain · ${plan.installedResidentCapacity} resident capacity split between branches`;
    }
    return `No complete staffed chain · ${plan.limitingLabel} limits prosperity`;
  }
  if (plan.roadPlan && plan.roadPlan.currentShortfallResidents > 0) {
    return `${plan.currentResidents} prosperous residents · ${plan.roadPlan.currentShortfallResidents} lack throughput on their own branch despite ${usableCapacity} road-matched capacity · ${plan.limitingLabel} limited`;
  }
  const headroom = plan.currentHeadroomResidents;
  return `${plan.currentResidents} / ${usableCapacity} prosperous residents at ${plan.roadPlan ? 'road-matched' : 'installed'} capacity · ${
    headroom >= 0
      ? `headroom for ${headroom}`
      : `short capacity for ${Math.abs(headroom)}`
  } · ${plan.limitingLabel} limited`;
}

function formatProsperityHousingPipeline(plan: SettlementProsperityPlan): string {
  const headroom = plan.fullHousingHeadroomResidents;
  const roadShortfall = plan.roadPlan?.fullShortfallResidents ?? 0;
  return `${plan.existingFullResidents} residents at full existing tier-3 housing · ${plan.existingTierThreeVacancies} vacant places · ${
    roadShortfall > 0
      ? `${roadShortfall} residents lack capacity on their own branch`
      : headroom >= 0
      ? `${headroom} capacity remains`
      : `${Math.abs(headroom)} residents exceed installed capacity`
  }`;
}

function formatProsperityRoads(plan: ProsperityRoadPlan | null): string {
  if (plan === null) return 'Road ledger unavailable';
  if (plan.activeBranches === 0) {
    return 'No staffed specialty chain or tier-3 housing';
  }
  const pairing = `${plan.matchedBranches} / ${plan.activeBranches} branches contain preserved-food, ale, cloth, and pottery capacity`;
  const fragmentation = plan.fragmentationResidentCapacity > 0
    ? ` · ${plan.fragmentationResidentCapacity} resident capacity stranded between specialized branches`
    : ' · no installed capacity stranded';
  const current = plan.currentShortfallResidents > 0
    ? ` · ${plan.currentShortfallResidents} current residents short across ${plan.currentShortBranches} ${plan.currentShortBranches === 1 ? 'branch' : 'branches'}`
    : ' · every current prosperous household has local capacity';
  const pipeline = plan.fullShortfallResidents > 0
    ? ` · full housing pipeline short ${plan.fullShortfallResidents} across ${plan.fullShortBranches} ${plan.fullShortBranches === 1 ? 'branch' : 'branches'}`
    : ' · full tier-3 housing pipeline covered';
  const inspect = plan.firstExposedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${plan.firstExposedResidenceId}" aria-label="Inspect first prosperity road-branch shortfall">Inspect</button>`;
  return `${pairing}${fragmentation}${current}${pipeline}${inspect}`;
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
    <li><span>Haulage posture</span><span>${plan.activeTrips} active · ${plan.outboundTrips} outbound · ${plan.unloadingTrips} unloading · ${plan.returningTrips} returning empty · ${plan.deliveryWorkers} haulers committed${plan.freeHaulerWorkers > 0 ? ` · ${plan.freeHaulerWorkers} reserved outside building rosters` : ''}</span></li>
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

export function renderSettlementFireRecoveryRows(
  plan: SettlementFireRecoveryPlan,
  getBuildingLabel: (kind: BuildingKind) => string,
): string {
  if (plan.incidentCount === 0) {
    return '<li><span>Fire recovery</span><span>No active fires or damaged structures</span></li>';
  }
  const activeInspect = fireRecoveryInspectButton(
    plan.firstActiveTarget,
    'Inspect most urgent active fire',
  );
  const recoveryInspect = fireRecoveryInspectButton(
    plan.firstRecoveryTarget,
    'Inspect next fire-recovery priority',
  );
  const activePriority = plan.firstActiveTarget === null
    ? ''
    : ` · ${fireRecoveryTargetLabel(plan.firstActiveTarget, getBuildingLabel)} ${
        plan.firstActiveTarget.responseWellId === null
          ? 'is unanswered'
          : `has the highest current intensity (${Math.round(
              plan.firstActiveTarget.intensity * 100,
            )}%)`
      }${activeInspect}`;
  const active = plan.burningCount === 0
    ? 'No structures currently burning'
    : `${plan.respondedBurningCount} / ${plan.burningCount} assigned a well response · ${plan.responseWaterRemaining.toFixed(1)} bucket water still requested${
        plan.unrespondedBurningCount > 0
          ? ` · ${plan.unrespondedBurningCount} without a responder`
          : ''
      }${activePriority}`;
  const outage = `${plan.buildingOutages} building ${
    plan.buildingOutages === 1 ? 'outage' : 'outages'
  } + ${plan.residenceOutages} ${
    plan.residenceOutages === 1 ? 'home' : 'homes'
  } offline · ${plan.suspendedWorkers} assigned ${
    plan.suspendedWorkers === 1 ? 'worker' : 'workers'
  } suspended · ${plan.affectedResidents} current ${
    plan.affectedResidents === 1 ? 'resident' : 'residents'
  } disrupted · ${plan.offlineHousingCapacity} housing capacity unavailable`;
  const queue = `${plan.activeRecoveryCount} active · ${plan.readyRecoveryCount} ready · ${plan.coolingRecoveryCount} cooling · ${
    plan.extinguishedCount
  } ${plan.extinguishedCount === 1 ? 'repair' : 'repairs'} + ${
    plan.destroyedCount
  } ${plan.destroyedCount === 1 ? 'rebuild' : 'rebuilds'}${
    plan.firstRecoveryTarget === null
      ? ''
      : ` · ${fireRecoveryTargetLabel(plan.firstRecoveryTarget, getBuildingLabel)} ${
          plan.firstRecoveryTarget.recoveryActive
            ? `underway (${staffingPriorityLabel(
                plan.firstRecoveryTarget.workPriority,
              ).toLocaleLowerCase()} work priority)`
            : plan.firstRecoveryTarget.coolingSeconds <= 1e-6
            ? `is next (${staffingPriorityLabel(
                plan.firstRecoveryTarget.workPriority,
              ).toLocaleLowerCase()} work priority)`
            : `cools in ~${Math.ceil(plan.firstRecoveryTarget.coolingSeconds)}s`
        }${recoveryInspect}`
  }`;
  const shortfalls = [
    plan.timberShortfall > 0.05 ? `${plan.timberShortfall.toFixed(1)} timber short` : '',
    plan.stoneShortfall > 0.05 ? `${plan.stoneShortfall.toFixed(1)} stone short` : '',
    plan.ironworkShortfall > 0.05 ? `${plan.ironworkShortfall.toFixed(1)} ironwork short` : '',
  ].filter(Boolean);
  const readyMaterials = plan.readyRecoveryCount === 0
    ? 'none ready to commit'
    : `${plan.readyTimberCost.toFixed(1)} timber + ${plan.readyStoneCost.toFixed(1)} stone + ${plan.readyIronworkCost.toFixed(1)} ironwork ready to commit`;
  const materials = `${readyMaterials} · ${plan.estimatedTimberCost.toFixed(1)} timber + ${
    plan.estimatedStoneCost.toFixed(1)
  } stone + ${plan.estimatedIronworkCost.toFixed(1)} ironwork current minimum liability${
    plan.burningCount > 0 ? ' · burning damage can raise it' : ''
  } · ${plan.carpenterSupportedTargets} ${
    plan.carpenterSupportedTargets === 1 ? 'target has' : 'targets have'
  } road-linked carpenter support${
    shortfalls.length > 0 ? ` · ${shortfalls.join(' · ')}` : ' · currently covered'
  }`;
  return `
    <li><span>Fire response</span><span>${active}</span></li>
    <li><span>Structural outages</span><span>${outage}</span></li>
    <li><span>Recovery queue</span><span>${queue}</span></li>
    <li><span>Recovery materials</span><span>${materials}</span></li>
  `;
}

function fireRecoveryTargetLabel(
  target: SettlementFireRecoveryTarget,
  getBuildingLabel: (kind: BuildingKind) => string,
): string {
  if (target.buildingKind !== null) return getBuildingLabel(target.buildingKind);
  return target.residenceParcelIndex === null
    ? 'Residence'
    : `Residence parcel #${target.residenceParcelIndex + 1}`;
}

function fireRecoveryInspectButton(
  target: SettlementFireRecoveryTarget | null,
  ariaLabel: string,
): string {
  if (target === null) return '';
  const attribute = target.targetKind === 'building'
    ? 'data-inspect-building'
    : 'data-inspect-residence';
  return ` <button type="button" class="inspector-jump-button" ${attribute}="${target.targetId}" aria-label="${ariaLabel}">Inspect</button>`;
}

function formatConstructionRoads(
  plan: SettlementConstructionRoadPlan,
): string {
  const timber = plan.materials.timber;
  const stone = plan.materials.stone;
  const ironwork = plan.materials.ironwork;
  if (
    timber.roadBoundClaim + stone.roadBoundClaim
      + ironwork.roadBoundClaim
      + timber.offroadClaim + stone.offroadClaim + ironwork.offroadClaim
    <= 0.05
  ) {
    return `No building-held material awaits pickup · ${timber.sourceStock.toFixed(0)} usable timber + ${stone.sourceStock.toFixed(0)} usable stone + ${ironwork.sourceStock.toFixed(0)} usable ironwork remain at completed sources`;
  }
  const roadCoverage =
    timber.roadBoundClaim + stone.roadBoundClaim + ironwork.roadBoundClaim > 0.05
      ? `${plan.suppliedClaimBranches} / ${plan.claimBranches} road-bound claim branches fully sourced · ${timber.matchedRoadBoundClaim.toFixed(0)} / ${timber.roadBoundClaim.toFixed(0)} timber + ${stone.matchedRoadBoundClaim.toFixed(0)} / ${stone.roadBoundClaim.toFixed(0)} stone + ${ironwork.matchedRoadBoundClaim.toFixed(0)} / ${ironwork.roadBoundClaim.toFixed(0)} ironwork matched`
      : 'No road-bound physical claims';
  const fragmentedTimber = timber.fragmentationCoverage;
  const fragmentedStone = stone.fragmentationCoverage;
  const fragmentedIronwork = ironwork.fragmentationCoverage;
  const fragmentation = fragmentedTimber + fragmentedStone + fragmentedIronwork > 0.05
    ? ` · ${fragmentedTimber.toFixed(0)} timber + ${fragmentedStone.toFixed(0)} stone + ${fragmentedIronwork.toFixed(0)} ironwork earmarked but stranded between road branches`
    : '';
  const scarceTimber = Math.max(
    0,
    timber.strandedRoadBoundClaim - timber.fragmentationCoverage,
  );
  const scarceStone = Math.max(
    0,
    stone.strandedRoadBoundClaim - stone.fragmentationCoverage,
  );
  const scarceIronwork = Math.max(
    0,
    ironwork.strandedRoadBoundClaim - ironwork.fragmentationCoverage,
  );
  const scarcity = scarceTimber + scarceStone + scarceIronwork > 0.05
    ? ` · ${scarceTimber.toFixed(0)} timber + ${scarceStone.toFixed(0)} stone + ${scarceIronwork.toFixed(0)} ironwork exceed all usable source stock`
    : '';
  const offroad = timber.offroadClaim + stone.offroadClaim + ironwork.offroadClaim > 0.05
    ? ` · off-road-capable sites can cover ${timber.offroadPotentialCoverage.toFixed(0)} / ${timber.offroadClaim.toFixed(0)} timber + ${stone.offroadPotentialCoverage.toFixed(0)} / ${stone.offroadClaim.toFixed(0)} stone + ${ironwork.offroadPotentialCoverage.toFixed(0)} / ${ironwork.offroadClaim.toFixed(0)} ironwork from remaining stores`
    : '';
  const unmatched = timber.unmatchedSourceStock + stone.unmatchedSourceStock
    + ironwork.unmatchedSourceStock > 0.05
    ? ` · ${timber.unmatchedSourceStock.toFixed(0)} timber + ${stone.unmatchedSourceStock.toFixed(0)} stone + ${ironwork.unmatchedSourceStock.toFixed(0)} ironwork remain outside matched claims`
    : '';
  const inspect = plan.firstExposedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstExposedBuildingId}" aria-label="Inspect first road-stranded construction claim">Inspect</button>`;
  return `${roadCoverage}${fragmentation}${scarcity}${offroad}${unmatched}${inspect} · founders' reserve and carts excluded`;
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
  const ironwork = plan.materials.ironwork;
  const roadRow = plan.roadPlan === null
    ? ''
    : `<li><span>Construction roads</span><span>${formatConstructionRoads(plan.roadPlan)}</span></li>`;
  const fireBlockedRow = plan.fireDisabledSourceBuildings === 0
    ? ''
    : `<li><span>Fire-quarantined stores</span><span>${plan.fireBlockedTimberStock.toFixed(0)} timber + ${plan.fireBlockedStoneStock.toFixed(0)} stone + ${plan.fireBlockedIronworkStock.toFixed(0)} ironwork unavailable across ${plan.fireDisabledSourceBuildings} fire-damaged ${plan.fireDisabledSourceBuildings === 1 ? 'source' : 'sources'} until repaired${plan.firstFireDisabledSourceId === null ? '' : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstFireDisabledSourceId}" aria-label="Inspect first fire-disabled construction source">Inspect</button>`}</span></li>`;
  return `
    <li><span>Construction queue</span><span>${queueLabel} · urgent ${priorities.urgent} / normal ${priorities.normal} / low ${priorities.low}</span></li>
    <li><span>Builder load</span><span>${plan.assignedBuilders} / ${plan.builderCapacity} assigned · ${plan.remainingBuilderDays.toFixed(1)} builder-days after supply</span></li>
    <li><span>Queue materials</span><span>${timber.delivered.toFixed(0)} / ${timber.required.toFixed(0)} timber · ${stone.delivered.toFixed(0)} / ${stone.required.toFixed(0)} stone · ${ironwork.delivered.toFixed(0)} / ${ironwork.required.toFixed(0)} ironwork delivered</span></li>
    <li><span>Supply coverage</span><span>${formatConstructionMaterialCoverage('timber earmarked', timber)} · ${formatConstructionMaterialCoverage('stone earmarked', stone)} · ${formatConstructionMaterialCoverage('ironwork earmarked', ironwork)}${timber.uncovered + stone.uncovered + ironwork.uncovered > 0.05 ? ` · ${timber.uncovered.toFixed(0)} timber + ${stone.uncovered.toFixed(0)} stone + ${ironwork.uncovered.toFixed(0)} ironwork uncovered` : ''}</span></li>
    <li><span>Material movement</span><span>${timber.awaitingPickup.toFixed(0)} timber + ${stone.awaitingPickup.toFixed(0)} stone + ${ironwork.awaitingPickup.toFixed(0)} ironwork await pickup · ${timber.inTransit.toFixed(0)} + ${stone.inTransit.toFixed(0)} + ${ironwork.inTransit.toFixed(0)} on carts · ${timber.foundersReserve.toFixed(0)} timber + ${stone.foundersReserve.toFixed(0)} stone in legacy ledger reserve</span></li>
    ${fireBlockedRow}
    ${roadRow}
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
    : `${formatProvisionRunway(plan.processorRunwayDays)} settlement-ledger runway`;
  const roadRow = plan.roadPlan === null
    ? ''
    : `<li><span>Processor grain roads</span><span>${formatProcessorGrainRoads(plan.roadPlan)}</span></li>`;
  const priority = plan.processorPriorityCounts;
  const priorityTotal = priority[1] + priority[2] + priority[3];
  const priorityRow = priorityTotal > 0
    ? `<li><span>Grain cart priorities</span><span>${priority[3]} high · ${priority[2]} normal · ${priority[1]} low operational processors · carts serve higher tiers first, then lowest cycle runway</span></li>`
    : '';
  return `
    <li><span>Grain allocation</span><span>${plan.totalStock.toFixed(1)} owned · ${plan.inTransit.toFixed(1)} on carts · ${plan.discretionaryStock.toFixed(1)} discretionary after protected claims</span></li>
    <li><span>Protected grain</span><span>Seed ${plan.seed.protected.toFixed(1)} / ${plan.seed.target.toFixed(1)} · winter fodder ${plan.winterFodder.protected.toFixed(1)} / ${plan.winterFodder.target.toFixed(1)} · central reserve ${plan.granaryReserve.protected.toFixed(1)} / ${plan.granaryReserve.target.toFixed(1)}${attention}</span></li>
    <li><span>Installed grain draw</span><span>${plan.processorGrainPerDay.toFixed(1)} / day · bread ${plan.breadGrainPerDay.toFixed(1)} · monastery ${plan.monasteryGrainPerDay.toFixed(1)} · ${runway}</span></li>
    ${roadRow}
    ${priorityRow}
    <li><span>Crop-year balance</span><span>${plan.laborCoveredHarvest.toFixed(1)} / ${plan.potentialHarvest.toFixed(1)} harvest covered · ${plan.annualCommitments.toFixed(1)} committed · ${balance} at current installed capacity over ${GRAIN_PLAN_DAYS_PER_YEAR} days; imports excluded</span></li>
  `;
}

function formatProcessorGrainRoads(plan: SettlementGrainRoadPlan): string {
  if (plan.drawingBranches === 0) {
    return `No road branch has sustained installed grain draw${
      plan.dispatchableSourceStock > 0.05
        ? ` · ${plan.dispatchableSourceStock.toFixed(1)} staffed farm / granary source grain available`
        : ''
    }`;
  }
  const inspect = plan.firstExposedBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstExposedBuildingId}" aria-label="Inspect weakest processor grain road branch">Inspect</button>`;
  const outside = plan.outsideProcessorBranchStock > 0.05
    ? ` · ${plan.outsideProcessorBranchStock.toFixed(1)} dispatchable grain on branches without current processor draw`
    : '';
  return `${plan.stockedDrawingBranches} / ${plan.drawingBranches} drawing ${
    plan.drawingBranches === 1 ? 'branch has' : 'branches have'
  } staffed farm / granary reserve · ${plan.matchedSourceStock.toFixed(1)} matched source grain · weakest source reserve ${
    formatProvisionRunway(plan.weakestSourceRunwayDays)
  } at installed draw${outside}${inspect} · workshop stocks and carts excluded`;
}

const SEED_PROCUREMENT_ATTENTION_LABELS: Record<
  SettlementSeedProcurementAttention,
  string
> = {
  construction: 'market unfinished',
  fire: 'market fire damage',
  labor: 'broker labor missing',
  road: 'market road missing',
  'cash-policy': 'market cash reserve below the current lot price',
  'cash-inbound': 'market cash handcart inbound',
  'cash-cart': 'market awaiting a treasury handcart',
  treasury: 'civic treasury short',
  iron: 'raw iron ahead in queue',
  salt: 'preservation salt ahead in queue',
  ironwork: 'ironwork ahead in queue',
  cooldown: 'caravan cooldown',
};

export function renderSettlementSeedProcurementRows(
  plan: SettlementSeedProcurementPlan,
  firstSeedShortBuildingId: string | null,
): string {
  const marketAttention = plan.firstAttentionMarketId === null
    || plan.firstAttentionKind === null
    ? ''
    : ` &middot; first block ${SEED_PROCUREMENT_ATTENTION_LABELS[plan.firstAttentionKind]} <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttentionMarketId}" aria-label="Inspect first blocked standing seed order">Inspect market</button>`;
  const queueParts = [
    plan.saltQueuedMarkets > 0
      ? `${plan.saltQueuedMarkets} behind salt`
      : '',
    plan.ironQueuedMarkets > 0
      ? `${plan.ironQueuedMarkets} behind raw iron`
      : '',
    plan.ironworkQueuedMarkets > 0
      ? `${plan.ironworkQueuedMarkets} behind frontier ironwork`
      : '',
  ].filter(Boolean);
  const queue = queueParts.length > 0
    ? ` &middot; ${queueParts.join(' &middot; ')}`
    : '';
  const physicalCashReadiness = plan.physicalCashEconomy
    ? `${
        plan.cashInboundMarkets > 0
          ? ` &middot; ${plan.cashInboundMarkets} cash ${plan.cashInboundMarkets === 1 ? 'cart' : 'carts'} inbound`
          : ''
      }${
        plan.cashCartMarkets > 0
          ? ` &middot; ${plan.cashCartMarkets} awaiting treasury ${plan.cashCartMarkets === 1 ? 'cart' : 'carts'}`
          : ''
      }${
        plan.cashPolicyBlockedMarkets > 0
          ? ` &middot; ${plan.cashPolicyBlockedMarkets} reserve ${plan.cashPolicyBlockedMarkets === 1 ? 'target' : 'targets'} below the current lot price`
          : ''
      }${
        plan.treasuryBlockedMarkets > 0
          ? ` &middot; ${plan.treasuryBlockedMarkets} treasury-short`
          : ''
      }`
    : '';
  const readiness = plan.dueMarkets > 0
    ? `${plan.readyMarkets} / ${plan.dueMarkets} due markets ${
        plan.physicalCashEconomy ? 'have coin onsite' : 'ready'
      }${queue}${physicalCashReadiness}${marketAttention}`
    : 'all selected targets currently filled';
  const orders = plan.marketplaces === 0
    ? 'No marketplace'
    : plan.targetMarkets === 0
      ? 'Manual-only at every market'
      : `${plan.plannedImportLots} future ${plan.plannedImportLots === 1 ? 'lot' : 'lots'} / ${plan.plannedImportGrain.toFixed(0)} grain due toward ${plan.targetStock.toFixed(0)} selected stock &middot; ${readiness}`;

  const exposedHoldingId =
    plan.roadPlan?.firstExposedBuildingId ?? firstSeedShortBuildingId;
  const holding = exposedHoldingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${exposedHoldingId}" aria-label="Inspect first seed-short holding">Inspect holding</button>`;
  const recoverySources =
    `${plan.currentMarketStock.toFixed(1)} market + ${plan.currentGranaryStock.toFixed(1)} granary grain`;
  const roadScope = plan.roadPlan === null
    ? ''
    : ' on matching road branches';
  const fragmentation = plan.roadPlan !== null
    && plan.roadPlan.fragmentationCoverage > 0.05
    ? ` &middot; ${plan.roadPlan.fragmentationCoverage.toFixed(1)} apparent coverage stranded by road layout`
    : '';
  const unmatched = plan.roadPlan !== null
    && plan.roadPlan.unmatchedRecoveryGrain > 0.05
    ? ` &middot; ${plan.roadPlan.unmatchedRecoveryGrain.toFixed(1)} recovery grain outside current branch gaps`
    : '';
  const unroutable = plan.roadPlan !== null
    && plan.roadPlan.unroutableShortfall > 0.05
    ? ` &middot; ${plan.roadPlan.unroutableShortfall.toFixed(1)} gap at incomplete or orphaned holdings`
    : '';
  const inbound = plan.inboundSeedGrain > 0.05
    ? ` after ${plan.inboundSeedGrain.toFixed(1)} grain already approaching by cart`
    : '';
  const recovery = plan.seedShortfall <= 0.05
    ? `No remaining holding seed gap${inbound} &middot; ${recoverySources} already counted in owned stock`
    : `${recoverySources} + ${plan.plannedImportGrain.toFixed(0)} future imports could cover up to ${plan.potentialCoverage.toFixed(1)} / ${plan.seedShortfall.toFixed(1)} of the remaining holding gap${inbound}${roadScope}${plan.uncoveredShortfall > 0.05 ? ` &middot; ${plan.uncoveredShortfall.toFixed(1)} still exposed` : ''}${fragmentation}${unmatched}${unroutable}${holding}`;
  const treasury = plan.plannedImportLots <= 0
    ? ''
    : plan.physicalCashEconomy
      ? ` &middot; cash route ${plan.marketCofferGold.toFixed(0)} gold in selected market coffers + ${plan.inboundMarketGold.toFixed(0)} inbound &middot; ${plan.onsiteFundedLotsAtCurrentRate} / ${plan.plannedImportLots} lots buyable now, ${plan.committedFundedLotsAtCurrentRate} funded after inbound carts &middot; ${plan.availableTreasuryGold.toFixed(0)} civic gold is projected to fund ${plan.treasuryRefillLotsAtCurrentRate} further ${plan.treasuryRefillLotsAtCurrentRate === 1 ? 'lot' : 'lots'} through selected reserve targets at today's ${plan.nextLotGoldCost.toFixed(0)} gold rate &middot; selected market cash reserves total ${plan.selectedMarketReserveGold.toFixed(0)}; later lots reprice`
      : ` &middot; treasury funds ${plan.affordableLotsAtCurrentRate} / ${plan.plannedImportLots} lots at today's ${plan.nextLotGoldCost.toFixed(0)} gold rate; later lots reprice`;

  return `
    <li><span>Standing seed orders</span><span>${orders}${treasury}</span></li>
    <li><span>Seed recovery ceiling</span><span>${recovery} &middot; future purchases remain excluded from crop-year balance until bought</span></li>
  `;
}

function renderSettlementTextileRoadRow(plan: SettlementTextilePlan): string {
  const roads = plan.roadPlan;
  if (roads === null || roads.activeBranches === 0) return '';
  const fragmentation = roads.fragmentationClothPotential > 0.05
    ? ` · ${roads.fragmentationClothPotential.toFixed(1)} cloth/year stranded until branches connect`
    : ' · no cloth capacity stranded by topology';
  const householdCoverage = roads.annualHouseholdClothDemand > 0.05
    ? ` · ${roads.coveredHouseholdClothDemand.toFixed(1)} / ${roads.annualHouseholdClothDemand.toFixed(1)} local household need covered`
    : ' · no current household cloth claim';
  const exposure = roads.annualHouseholdClothShortfall > 0.05
    ? ` · ${roads.annualHouseholdClothShortfall.toFixed(1)} local shortfall across ${roads.exposedHouseholdBranches} ${roads.exposedHouseholdBranches === 1 ? 'branch' : 'branches'}`
    : ' · every current household branch covered';
  const inspect = roads.firstExposedResidenceId !== null
    ? ` <button type="button" class="inspector-jump-button" data-inspect-residence="${roads.firstExposedResidenceId}" aria-label="Inspect first textile road-branch shortfall">Inspect home</button>`
    : roads.firstImbalancedBuildingId !== null
      ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${roads.firstImbalancedBuildingId}" aria-label="Inspect first road-stranded wool holding">Inspect holding</button>`
      : '';
  const exportable = roads.annualExportableClothSurplus > 0.05
    ? ` · ${roads.annualExportableClothSurplus.toFixed(1)} cloth/year remains above local household need; the specialty export ledger verifies market access separately`
    : '';
  const reserveInspect = roads.firstReserveExposedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${roads.firstReserveExposedResidenceId}" aria-label="Inspect weakest current household textile reserve">Inspect home</button>`;
  const currentServiceRow = roads.householdBranches === 0
    ? ''
    : `
    <li><span>Textile service</span><span>${roads.stockedSupplierBranches} / ${roads.householdBranches} current household branches have a stocked staffed loom route · ${roads.serviceableClothStock.toFixed(1)} cloth in local cupboards, staffed looms, or approaching home carts · weakest reserve ${formatProvisionRunway(roads.worstHouseholdClothRunwayDays)} · ${roads.unservedHouseholdBranches} without a stocked loom route · ${roads.reserveWarningBranches} below ${TEXTILE_RESERVE_WARNING_DAYS} days${reserveInspect}</span></li>
  `;

  return `
    <li><span>Textile roads</span><span>${roads.matchedBranches} / ${roads.activeBranches} active branches pair raw fibre and loom capacity (${roads.fleeceBranches} wool · ${roads.flaxBranches} flax · ${roads.loomBranches} loom) · ${roads.roadMatchedAnnualClothPotential.toFixed(1)} / ${plan.annualClothPotential.toFixed(1)} cloth/year physically paired${fragmentation}${householdCoverage}${exposure}${exportable}${inspect}</span></li>
    ${currentServiceRow}
  `;
}

export function renderSettlementTextileRows(plan: SettlementTextilePlan): string {
  const roadRow = renderSettlementTextileRoadRow(plan);
  const unavailableCloth = plan.unavailableHouseholdClothStock > 0.05
    ? ` · ${plan.unavailableHouseholdClothStock.toFixed(1)} in treasury, export, fire quarantine, idle, or disconnected stores`
    : '';
  const storesRow = `<li><span>Textile stores</span><span>${plan.woolStock.toFixed(1)} wool owned${plan.woolInTransit > 0.05 ? ` · ${plan.woolInTransit.toFixed(1)} on carts` : ''} · ${plan.flaxStock.toFixed(1)} flax owned${plan.flaxInTransit > 0.05 ? ` · ${plan.flaxInTransit.toFixed(1)} on carts` : ''} · ${plan.clothStock.toFixed(1)} cloth owned${plan.clothInTransit > 0.05 ? ` · ${plan.clothInTransit.toFixed(1)} on carts` : ''} · ${plan.serviceableHouseholdClothStock.toFixed(1)} serviceable to current households${plan.householdClothInTransit > 0.05 ? ` including ${plan.householdClothInTransit.toFixed(1)} approaching homes` : ''}${unavailableCloth} · ${formatProvisionRunway(plan.clothReserveRunwayDays)} weakest household cloth reserve</span></li>`;
  const fireRow = plan.fireDisabledSheepHoldings
    + plan.fireDisabledWeavers
    + plan.fireDisabledProsperousHomes === 0
    ? ''
    : `<li><span>Textile fire outages</span><span>${plan.fireDisabledSheepHoldings} sheep ${plan.fireDisabledSheepHoldings === 1 ? 'holding' : 'holdings'} + ${plan.fireDisabledWeavers} staffed ${plan.fireDisabledWeavers === 1 ? 'loom' : 'looms'} + ${plan.fireDisabledProsperousHomes} prosperous ${plan.fireDisabledProsperousHomes === 1 ? 'home' : 'homes'} offline · ${plan.fireQuarantinedClothStock.toFixed(1)} cloth at affected looms, cupboards, or approaching carts unavailable until recovery</span></li>`;
  if (plan.sheepHoldings === 0) {
    return `
      <li><span>Annual wool clip</span><span>No completed sheep holding</span></li>
      <li><span>Flax route</span><span>${plan.flaxStock.toFixed(1)} harvested fibre owned · requires loom labor and hauled water</span></li>
      ${fireRow}
      ${storesRow}
      <li><span>Textile chain</span><span>${textileChainBalanceLabel(plan)} · ${plan.annualHouseholdClothDemand.toFixed(1)} cloth/year household demand</span></li>
      ${roadRow}
    `;
  }

  const attentionLabel = plan.firstAttentionKind === 'fire'
    ? 'first fire-disabled sheep holding'
    : plan.firstAttentionKind === 'storage'
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
    + plan.missedHoldings
    + plan.fireDisabledSheepHoldings;

  return `
    <li><span>Annual wool clip</span><span>${plan.shornHoldings} / ${plan.sheepHoldings} holdings shorn · ${plan.sheepHeadCount} sheep / ${plan.productiveSheepHeads.toFixed(1)} productive-head equivalent · ${plan.projectedAnnualWool.toFixed(1)} wool potential${clipRisk}${attention}</span></li>
    <li><span>Shearing readiness</span><span>${plan.readyPendingHoldings} pending and ready · ${plan.storageBlockedHoldings} storage-blocked · ${plan.staffingBlockedHoldings} unstaffed · ${plan.flockBlockedHoldings} flock-blocked · ${plan.fireDisabledSheepHoldings} fire-disabled · ${plan.missedHoldings} missed${blocked === 0 ? ' · no exposed clip' : ''}</span></li>
    ${fireRow}
    ${storesRow}
    <li><span>Textile chain</span><span>${plan.annualClothPotential.toFixed(1)} cloth/year installed ceiling from projected wool, physical flax, and loom labor vs ${plan.annualHouseholdClothDemand.toFixed(1)} household need · ${annualBalance} over ${TEXTILE_PLAN_DAYS_PER_YEAR} days · flax assumes a supplied water route · ${textileChainBalanceLabel(plan)}</span></li>
    ${roadRow}
  `;
}

function formatSpecialtyExportDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'no clearing estimate';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function specialtyExportAttentionLabel(
  kind: SpecialtyExportAttentionKind | null,
): string {
  switch (kind) {
    case 'producer-road': return 'producer has no completed market on its road branch';
    case 'producer-storage': return 'road-linked markets have no room for this cargo';
    case 'producer-labor': return 'producer stock is waiting for a worker and cart';
    case 'producer-fire': return 'producer hauling is suspended by fire';
    case 'producer-market-fire': return 'producer hauling is blocked by a fire-disabled market';
    case 'producer-receiving': return 'every eligible market already has an inbound cart';
    case 'market-construction': return 'specialty stock is trapped at an unfinished market';
    case 'market-road': return 'market stock cannot reach regional buyers without road access';
    case 'market-labor': return 'market stock is waiting for a broker';
    case 'market-fire': return 'market brokerage is suspended by fire';
    case 'market-policy': return 'market stock is held below its selected price floor';
    case 'market-manual-trade': return 'the sole broker is settling a manual trade';
    case null: return '';
  }
}

function specialtyExportCargoMix(
  plan: SettlementSpecialtyExportPlan,
): string {
  const labels: Record<SpecialtyExportCargoKind, string> = {
    ale: 'ale',
    honey: 'honey',
    wine: 'wine',
    cloth: 'cloth',
  };
  const parts: string[] = [];
  for (const commodity of ['ale', 'honey', 'wine', 'cloth'] as const) {
    const ledger = plan.commodities[commodity];
    const units = ledger.producerStock
      + ledger.inTransitToMarkets
      + ledger.marketQueue;
    if (units > 0.05) parts.push(`${units.toFixed(1)} ${labels[commodity]}`);
  }
  return parts.length > 0 ? parts.join(' &middot; ') : 'no physical specialty stock';
}

export function renderSettlementSpecialtyExportRows(
  plan: SettlementSpecialtyExportPlan,
): string {
  if (
    plan.producers === 0
    && plan.markets === 0
    && plan.projectedMarketQueueUnits <= 0.05
  ) {
    return '';
  }
  const road = plan.roadPlan;
  const roadRow = road === null
    ? ''
    : `
      <li><span>Specialty export roads</span><span>${road.matchedBranches} / ${road.producerBranches} producer branches reach a completed market &middot; ${road.roadMatchedProducerStock.toFixed(1)} source units on market-connected branches &middot; ${road.roadStrandedProducerStock.toFixed(1)} stranded by topology &middot; ${road.staffedBrokerBranches} / ${road.marketBranches} market branches have a staffed, safe road desk &middot; ${road.exposedProducerBranches} source branches blocked by topology or market storage</span></li>
    `;
  const sourceBlocks = [
    plan.roadStrandedProducerStock > 0.05
      ? `${plan.roadStrandedProducerStock.toFixed(1)} without a market route`
      : '',
    plan.storageBlockedProducerStock > 0.05
      ? `${plan.storageBlockedProducerStock.toFixed(1)} behind full destination stores`
      : '',
    plan.laborBlockedProducerStock > 0.05
      ? `${plan.laborBlockedProducerStock.toFixed(1)} at unstaffed producers`
      : '',
    plan.fireBlockedProducerStock > 0.05
      ? `${plan.fireBlockedProducerStock.toFixed(1)} fire-blocked`
      : '',
    plan.marketFireBlockedProducerStock > 0.05
      ? `${plan.marketFireBlockedProducerStock.toFixed(1)} behind fire-disabled markets`
      : '',
    plan.busyProducerStock > 0.05
      ? `${plan.busyProducerStock.toFixed(1)} waiting for source carts to return`
      : '',
    plan.receivingBlockedProducerStock > 0.05
      ? `${plan.receivingBlockedProducerStock.toFixed(1)} waiting for a market receiving slot`
      : '',
  ].filter(Boolean);
  const blockedQueues = [
    plan.roadBlockedMarketQueueUnits > 0.05
      ? `${plan.roadBlockedMarketQueueUnits.toFixed(1)} road-blocked`
      : '',
    plan.constructionBlockedMarketQueueUnits > 0.05
      ? `${plan.constructionBlockedMarketQueueUnits.toFixed(1)} at unfinished markets`
      : '',
    plan.laborBlockedMarketQueueUnits > 0.05
      ? `${plan.laborBlockedMarketQueueUnits.toFixed(1)} without brokers`
      : '',
    plan.fireBlockedMarketQueueUnits > 0.05
      ? `${plan.fireBlockedMarketQueueUnits.toFixed(1)} fire-blocked`
      : '',
    plan.policyHeldMarketQueueUnits > 0.05
      ? `${plan.policyHeldMarketQueueUnits.toFixed(1)} held for price`
      : '',
    plan.manualTradeBlockedMarketQueueUnits > 0.05
      ? `${plan.manualTradeBlockedMarketQueueUnits.toFixed(1)} behind manual settlement`
      : '',
  ].filter(Boolean);
  const attentionId = plan.firstAttentionBuildingId
    ?? plan.slowestActiveMarketId;
  const attentionLabel = plan.firstAttentionBuildingId === null
    ? 'slowest active specialty desk'
    : specialtyExportAttentionLabel(plan.firstAttentionKind);
  const inspect = attentionId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${attentionId}" aria-label="Inspect ${attentionLabel}">Inspect</button>`;
  const slowest = plan.slowestActiveMarketClearSeconds === null
    ? ''
    : ` &middot; slowest active desk clears its current and approaching queue in ${formatSpecialtyExportDuration(plan.slowestActiveMarketClearSeconds)}`;
  const activeQueue = plan.activeMarketQueueUnits > 0.05
    ? `${plan.activeMarketQueueUnits.toFixed(1)} units at active desks`
    : 'no stock at active desks';

  return `
    <li><span>Specialty pipeline</span><span>${plan.producerStock.toFixed(1)} at completed producers &middot; ${plan.dispatchReadyProducerStock.toFixed(1)} at sources with labor, a free cart, receiving room, and a market route; household and monastery dispatch still goes first &middot; ${plan.inTransitToMarkets.toFixed(1)} approaching markets &middot; ${plan.marketQueueUnits.toFixed(1)} already at market &middot; ${specialtyExportCargoMix(plan)}</span></li>
    ${roadRow}
    <li><span>Producer export blocks</span><span>${sourceBlocks.length > 0 ? sourceBlocks.join(' &middot; ') : 'No physical source-route, storage, labor, fire, or cart block'}</span></li>
    <li><span>Specialty broker desks</span><span>${plan.activeBrokerMarkets} / ${plan.completedMarkets} completed markets actively selling at the current ${Math.round(plan.marketRate * 100)}% regional rate &middot; ${plan.exportWorkers} free ${plan.exportWorkers === 1 ? 'broker' : 'brokers'} clear ${plan.exportRatePerSecond.toFixed(2)} units/s &middot; ${activeQueue}${slowest} &middot; ${plan.blockedMarketQueueUnits.toFixed(1)} blocked or held${blockedQueues.length > 0 ? ` (${blockedQueues.join(' &middot; ')})` : ''}${inspect}</span></li>
  `;
}

export function renderSettlementBackyardEconomyRows(
  plan: SettlementBackyardEconomyPlan,
): string {
  if (plan.occupiedGardens === 0) {
    return `
      <li><span>Backyard economy</span><span>No operational occupied household plot is producing${plan.fireDisabledGardens > 0 ? ` · ${plan.fireDisabledGardens} ${plan.fireDisabledGardens === 1 ? 'plot is' : 'plots are'} suspended by residence fire damage` : ''}</span></li>
    `;
  }
  const environment = `${plan.currentEnvironment.season}, ${plan.currentEnvironment.weather}`;
  const productionState = plan.currentSabbathPause
    ? 'Sunday Sabbath pauses every plot today'
    : `${plan.producingTodayGardens} / ${plan.occupiedGardens} occupied plots are in season`;
  const inspect = plan.firstUnlinkedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${plan.firstUnlinkedResidenceId}" aria-label="Inspect highest-value unlinked backyard">Inspect home</button>`;
  const roadState = plan.occupiedGardenBranches === 0
    ? `${plan.marketLinkedGardens} / ${plan.occupiedGardens} occupied plots can reach an operational market`
    : `${plan.matchedGardenBranches} / ${plan.occupiedGardenBranches} occupied garden branches reach one of ${plan.marketRoadBranches} market branches`;
  const fireBlockedMarkets = plan.fireDisabledMarketplaces > 0
    ? ` &middot; ${plan.fireDisabledMarketplaces} market${plan.fireDisabledMarketplaces === 1 ? '' : 's'} fire-disabled`
    : '';
  const fireBlockedGardens = plan.fireDisabledGardens > 0
    ? ` &middot; ${plan.fireDisabledGardens} occupied ${plan.fireDisabledGardens === 1 ? 'plot' : 'plots'} (${plan.fireDisabledGardenResidents} ${plan.fireDisabledGardenResidents === 1 ? 'resident' : 'residents'}) suspended by household fire damage`
    : '';
  const capped = plan.wealthCappedGardens > 0
    ? ` &middot; ${plan.wealthCappedGardens} ${plan.wealthCappedGardens === 1 ? 'household is' : 'households are'} at or near the wealth cap`
    : '';

  return `
    <li><span>Garden season</span><span>${productionState} &middot; ${environment} &middot; ${plan.currentDaySelfFood.toFixed(1)} home food at today's full workday conditions${fireBlockedGardens}</span></li>
    <li><span>Market-garden roads</span><span>${roadState} &middot; ${plan.marketLinkedGardens} linked, ${plan.marketUnlinkedGardens} unlinked${fireBlockedMarkets}${inspect}</span></li>
    <li><span>Garden trade outlook</span><span>${plan.currentDayRoutedActivity.toFixed(1)} gold routed today${plan.currentDayStrandedActivity > 0.05 ? ` &middot; ${plan.currentDayStrandedActivity.toFixed(1)} stranded` : ''} &middot; next 120 days: ${plan.horizonRoutedActivity.toFixed(1)} routed, ${plan.horizonStrandedActivity.toFixed(1)} stranded${capped}</span></li>
  `;
}

export function renderSettlementArmamentRows(
  plan: SettlementArmamentPlan,
): string {
  const inspect = plan.firstExposedGuardhouseId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstExposedGuardhouseId}" aria-label="Inspect first road-exposed guardhouse">Inspect company</button>`;
  const finishedCoverage = plan.assignedGuards > 0
    ? `${plan.armableFromFinishedStock} / ${plan.assignedGuards} armable after approaching carts and finished stock at staffed road-linked carpenters`
    : 'No guards currently assigned';
  const readyCraftCoverage = plan.assignedGuards > 0
    ? ` &middot; ${plan.armableAfterReadyCrafts} / ${plan.assignedGuards} after polearms whose inputs are already onsite or approaching their carpenter`
    : '';
  const remainingGap = plan.unarmedAfterReadyCrafts > 0
    ? ` &middot; ${plan.unarmedAfterReadyCrafts} still exposed${inspect}`
    : plan.assignedGuards > 0
      ? ' &middot; current establishment physically covered'
      : '';
  const unavailablePolearms = plan.unavailableFinishedPolearms > 0.05
    ? ` &middot; ${plan.unavailableFinishedPolearms.toFixed(1)} in treasury, excess company stock, idle shops, or disconnected stores`
    : '';
  const unavailableIronwork = plan.unavailableIronwork > 0.05
    ? ` &middot; ${plan.unavailableIronwork.toFixed(1)} ironwork outside a staffed armory route`
    : '';
  const roads = plan.roadPlan;
  const roadRow = roads === null || roads.guardBranches === 0
    ? ''
    : `<li><span>Armory roads</span><span>${roads.staffedArmoryGuardBranches} / ${roads.guardBranches} guard branches have a staffed carpenter route &middot; ${roads.finishedStockCoveredBranches} covered by finished arms &middot; ${roads.readyCraftCoveredBranches} covered after ready crafts &middot; ${roads.exposedGuardBranches} still short &middot; ${roads.unservedGuardBranches} without staffed armory${roads.fragmentationGuards > 0.05 ? ` &middot; ${roads.fragmentationGuards.toFixed(1)} guards blocked by branch fragmentation` : ' &middot; no ready arms stranded by topology'}</span></li>`;
  const workOrders = plan.staffedCarpenters === 0
    ? 'No staffed carpenter can execute a polearm order'
    : `${plan.readyArmoryOutput.toFixed(1)} / ${plan.selectedArmoryOutput.toFixed(1)} selected polearms have timber and ironwork onsite or approaching &middot; remaining targets claim ${plan.timberNeededForTargets.toFixed(1)} timber + ${plan.ironworkNeededForTargets.toFixed(1)} ironwork &middot; connected source branches currently hold ${plan.roadSourceTimber.toFixed(1)} timber + ${plan.roadSourceIronwork.toFixed(1)} ironwork before cart contention`;
  const fireOutages = (
    plan.fireDisabledWatchtowers
    + plan.fireDisabledGuardhouses
    + plan.fireDisabledCarpenters
  ) === 0
    ? ''
    : `<li><span>Defense fire outages</span><span>${plan.fireDisabledWatchtowers} staffed ${plan.fireDisabledWatchtowers === 1 ? 'watchtower' : 'watchtowers'} + ${plan.fireDisabledGuardhouses} ${plan.fireDisabledGuardhouses === 1 ? 'guardhouse' : 'guardhouses'} + ${plan.fireDisabledCarpenters} staffed ${plan.fireDisabledCarpenters === 1 ? 'armory' : 'armories'} offline &middot; ${plan.fireDisabledArmedGuards} equipped of ${plan.fireDisabledAssignedGuards} assigned guards unavailable${plan.firstFireDisabledDefenseBuildingId === null ? '' : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstFireDisabledDefenseBuildingId}" aria-label="Inspect first fire-disabled defense building">Inspect outage</button>`}</span></li>`;

  return `
    ${fireOutages}
    <li><span>Armed establishment</span><span>${plan.armedGuards} / ${plan.assignedGuards} guards armed onsite &middot; ${plan.operationalGuardhouses} / ${plan.guardhouses} guardhouses operational &middot; ${finishedCoverage}${readyCraftCoverage}${remainingGap}</span></li>
    <li><span>Company priorities</span><span>${plan.highPriorityCompanies} high &middot; ${plan.normalPriorityCompanies} normal &middot; ${plan.lowPriorityCompanies} low &middot; governs scarce polearms, routine provisions, and wages</span></li>
    ${roadRow}
    <li><span>Armory work orders</span><span>${workOrders}</span></li>
    <li><span>Military stores</span><span>${plan.polearmStock.toFixed(1)} polearms owned${plan.polearmsInTransit > 0.05 ? ` &middot; ${plan.polearmsInTransit.toFixed(1)} on carts` : ''} &middot; ${plan.serviceableFinishedPolearms.toFixed(1)} serviceable to current guard branches${unavailablePolearms} &middot; ${plan.ironworkStock.toFixed(1)} ironwork owned${plan.ironworkInTransit > 0.05 ? ` &middot; ${plan.ironworkInTransit.toFixed(1)} on carts` : ''} &middot; ${plan.serviceableIronwork.toFixed(1)} at staffed armories, approaching them, or in their staffed markets${unavailableIronwork}</span></li>
  `;
}

function formatSeasonalLabor(plan: SettlementSeasonalLaborPlan): string {
  const fire = plan.fireDisabledSites > 0
    ? `${plan.fireDisabledSites} fire-disabled ${plan.fireDisabledSites === 1 ? 'site' : 'sites'}`
    : '';
  if (plan.dormantSites === 0 && plan.fireDisabledSites === 0) {
    return 'No staffed seasonal sites are dormant or fire-disabled';
  }
  if (plan.reclaimableWorkers === 0) {
    const dormant = plan.dormantSites > 0
      ? `${plan.dormantSites} dormant ${plan.dormantSites === 1 ? 'site' : 'sites'}`
      : '';
    return `${[dormant, fire].filter(Boolean).join(' · ')} · ${plan.retainedHaulers} necessary ${plan.retainedHaulers === 1 ? 'hauler' : 'haulers'}`;
  }
  return `${plan.reclaimableWorkers} idle ${plan.reclaimableWorkers === 1 ? 'worker' : 'workers'} across ${plan.reclaimableSites} ${plan.reclaimableSites === 1 ? 'site' : 'sites'}${fire ? ` · ${fire}` : ''} · ${plan.retainedHaulers} ${plan.retainedHaulers === 1 ? 'hauler remains' : 'haulers remain'} for stored goods or active carts`;
}

function formatSeasonalCallup(plan: SettlementSeasonalCallupPlan): string {
  if (plan.activeSites === 0) return 'No seasonal work window is open';
  const fire = plan.fireBlockedSites > 0
    ? ` · ${plan.fireBlockedSites} active ${plan.fireBlockedSites === 1 ? 'site is' : 'sites are'} fire-disabled`
    : '';
  if (plan.understaffedSites === 0) {
    const operationalSites = plan.activeSites - plan.fireBlockedSites;
    return `${operationalSites} operational seasonal ${operationalSites === 1 ? 'site is' : 'sites are'} fully staffed${fire}`;
  }
  if (plan.callupWorkers === 0) {
    return `${plan.openPosts} active seasonal ${plan.openPosts === 1 ? 'vacancy' : 'vacancies'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · no free labor${fire}`;
  }
  return `${plan.callupWorkers} free ${plan.callupWorkers === 1 ? 'worker can' : 'workers can'} fill ${plan.callupWorkers} of ${plan.openPosts} active seasonal ${plan.openPosts === 1 ? 'vacancy' : 'vacancies'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · ${plan.remainingOpenPosts} remain${fire}`;
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
  const fire = plan.fireDisabledSites > 0
    ? `${plan.fireDisabledSites} fire-disabled ${plan.fireDisabledSites === 1 ? 'worksite releases' : 'worksites release'} ${plan.fireRecalledWorkers} ${plan.fireRecalledWorkers === 1 ? 'worker' : 'workers'}`
    : '';
  if (plan.understaffedSites === 0) {
    const operationalSites = plan.worksites - plan.fireDisabledSites;
    return `${operationalSites} operational year-round ${operationalSites === 1 ? 'worksite is' : 'worksites are'} fully staffed${fire ? ` · ${fire}` : ''}`;
  }
  if (plan.calledWorkers === 0) {
    return `${plan.openPosts} open ${plan.openPosts === 1 ? 'post remains' : 'posts remain'} across ${plan.understaffedSites} year-round ${plan.understaffedSites === 1 ? 'worksite' : 'worksites'} · no free or strictly lower-priority labor can fill them${fire ? ` · ${fire}` : ''}`;
  }
  const priorityRecalled = plan.recalledWorkers - plan.fireRecalledWorkers;
  const source = [
    fire,
    priorityRecalled > 0
      ? `${priorityRecalled} lower-priority ${priorityRecalled === 1 ? 'worker moves' : 'workers move'}`
      : '',
    `${plan.calledWorkers} total ${plan.calledWorkers === 1 ? 'worker deploys' : 'workers deploy'}`,
  ].filter(Boolean).join(' · ');
  return `${source} into higher-priority or vacant posts · ${plan.remainingOpenPosts} open ${plan.remainingOpenPosts === 1 ? 'post remains' : 'posts remain'}`;
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
    plan.fireDisabledSites > 0 ? `${plan.fireDisabledSites} fire-disabled` : '',
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
  const fire = plan.fireBlockedSites > 0
    ? ` · ${plan.fireBlockedSites} fire-disabled`
    : '';
  if (plan.readySites === 0) {
    return `${plan.blockedSites} production ${plan.blockedSites === 1 ? 'site is' : 'sites are'} blocked by fire, output capacity, missing input, or an unusable local source${fire}`;
  }
  if (plan.understaffedSites === 0) {
    return `${plan.readySites} ready production ${plan.readySites === 1 ? 'site is' : 'sites are'} fully staffed${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}${fire}`;
  }
  if (plan.callupWorkers === 0) {
    return `${plan.openPosts} open ${plan.openPosts === 1 ? 'post remains' : 'posts remain'} across ${plan.understaffedSites} ready production ${plan.understaffedSites === 1 ? 'site' : 'sites'} · no free labor${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}${fire}`;
  }
  return `${plan.callupWorkers} free ${plan.callupWorkers === 1 ? 'worker can' : 'workers can'} fill ${plan.callupWorkers} of ${plan.openPosts} ready production ${plan.openPosts === 1 ? 'post' : 'posts'} across ${plan.understaffedSites} ${plan.understaffedSites === 1 ? 'site' : 'sites'} · ${plan.remainingOpenPosts} remain${plan.blockedSites > 0 ? ` · ${plan.blockedSites} blocked` : ''}${fire}`;
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
  const quarantine = preservation.quarantinedStock > 0.05
    ? `<li><span>Fire-quarantined food</span><span>${preservation.quarantinedStock.toFixed(1)} inaccessible until recovery · ${formatFreshFoodLoss(preservation.quarantinedSpoilagePerDay)} still spoiling in damaged buildings</span></li>`
    : '';
  const transit = preservation.transitStock > 0.05
    ? `<li><span>Food on carts</span><span>${preservation.transitStock.toFixed(1)} exposed in loaded or returning handcarts · ${formatFreshFoodLoss(preservation.transitSpoilagePerDay)} · unavailable until unloaded</span></li>`
    : '';
  const cured = preservation.preservedFood;
  const curedHotspot = formatPreservedFoodLossSite(
    cured.largestLossSite,
    getBuildingLabel,
    getResidenceParcelIndex,
  );
  const curedQuarantine = cured.quarantinedStock > 0.05
    ? `<li><span>Fire-quarantined provisions</span><span>${cured.quarantinedStock.toFixed(1)} inaccessible until recovery · ${formatPreservedFoodLoss(cured.quarantinedSpoilagePerDay)} still aging in damaged stores</span></li>`
    : '';
  const curedTransit = cured.transitStock > 0.05
    ? `<li><span>Provisions on carts</span><span>${cured.transitStock.toFixed(1)} exposed in loaded or returning handcarts · ${formatPreservedFoodLoss(cured.transitSpoilagePerDay)} · compact routes retain more</span></li>`
    : '';
  return `
    <li><span>Fresh-food spoilage</span><span>${formatFreshFoodLoss(preservation.spoilagePerDay)} · ${Math.round(preservation.usableProtectedShare * 100)}% of usable food in sheltered stores</span></li>
    ${quarantine}
    ${transit}
    <li><span>Largest fresh-food loss</span><span>${hotspot}</span></li>
    <li><span>Granary intake network</span><span>${formatGranaryFreshFoodNetwork(preservation.granaryNetwork)}</span></li>
    <li><span>Cured-food aging</span><span>${formatPreservedFoodLoss(cured.spoilagePerDay)} · ${Math.round(cured.protectedShare * 100)}% held in smokehouses, granaries, monasteries, or markets</span></li>
    ${curedQuarantine}
    ${curedTransit}
    <li><span>Largest cured-food loss</span><span>${curedHotspot}</span></li>
  `;
}

export function renderPreservationReserveRows(
  plan: SettlementPreservationReservePlan,
  saltGoldPerLot: number,
): string {
  if (plan.tierThreeResidents <= 0) {
    return `<li><span>Winter fallback reserve</span><span>No active prosperous residents yet &middot; ${(
      plan.preservedStock + plan.preservedInTransit
    ).toFixed(1)} preserved food can be stockpiled before tier-3 promotions</span></li>`;
  }

  const residenceInspect = plan.firstExposedResidenceId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${plan.firstExposedResidenceId}" aria-label="Inspect weakest winter preservation branch">Inspect household</button>`;
  const buildingInspect = plan.firstAttentionBuildingId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstAttentionBuildingId}" aria-label="Inspect winter preservation bottleneck">Inspect chain</button>`;
  const marketInspect = plan.firstSaltMarketId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${plan.firstSaltMarketId}" aria-label="Inspect preservation salt market">Inspect market</button>`;
  const completion = plan.roadMatchedShortfall <= 0.05
    ? 'Target ready'
    : Number.isFinite(plan.productionDaysToTarget)
      ? `${plan.productionDaysToTarget.toFixed(1)} working days at current same-branch smokehouse crews, including cured-stock aging while the reserve builds`
      : `${plan.branchesWithoutSmokehouse} short ${plan.branchesWithoutSmokehouse === 1 ? 'branch has' : 'branches have'} no staffed same-branch smokehouse`;
  const storedDetail = [
    plan.preservedInTransit > 0.05
      ? `${plan.preservedInTransit.toFixed(1)} arriving by cart`
      : null,
    plan.unmatchedPreservedStock > 0.05
      ? `${plan.unmatchedPreservedStock.toFixed(1)} surplus or stranded outside current branch targets`
      : null,
    plan.quarantinedPreservedStock > 0.05
      ? `${plan.quarantinedPreservedStock.toFixed(1)} fire-quarantined`
      : null,
  ].filter(Boolean).join(' &middot; ');
  const saltGold = Math.max(0, plan.saltImportLots)
    * Math.max(0, saltGoldPerLot);
  const saltImports = plan.saltImportLots <= 0
    ? 'current branch stocks cover the reserve build'
    : `${plan.saltImportLots} twelve-unit Adriatic ${plan.saltImportLots === 1 ? 'lot' : 'lots'} &asymp; ${saltGold.toFixed(0)} gold at today&rsquo;s first-lot rate`;
  const saltWarnings = [
    plan.selectedSaltTarget > 0
      ? `${plan.selectedSaltTarget.toFixed(0)} selected staffed-market reserve settlement-wide`
      : 'no selected staffed-market salt reserve',
    plan.branchesWithoutStandingSalt > 0
      ? `${plan.branchesWithoutStandingSalt} short ${plan.branchesWithoutStandingSalt === 1 ? 'branch lacks' : 'branches lack'} a standing salt order`
      : null,
  ].filter(Boolean).join(' &middot; ');
  const potteryStatus = plan.potteryShortfall > 0.05
    ? `${plan.potteryShortfall.toFixed(1)} vessels still need firing on the affected branches`
    : 'current and inbound vessels cover the reserve build';

  return `
    <li><span>${plan.targetDays}-day winter fallback</span><span>${plan.roadMatchedStock.toFixed(1)} / ${plan.targetStock.toFixed(1)} preserved food road-matched for ${plan.tierThreeResidents} prosperous residents &middot; ${plan.preparedBranches} / ${plan.targetBranches} branches ready${plan.roadMatchedShortfall > 0.05 ? ` &middot; short ${plan.roadMatchedShortfall.toFixed(1)}` : ''}${storedDetail ? ` &middot; ${storedDetail}` : ''}${residenceInspect}</span></li>
    <li><span>Reserve completion</span><span>${completion} &middot; the shortfall requires ${plan.freshFoodRequired.toFixed(1)} fresh food + ${plan.firewoodRequired.toFixed(1)} firewood + ${plan.saltRequired.toFixed(1)} salt + ${plan.potteryRequired.toFixed(1)} pottery${buildingInspect}</span></li>
    <li><span>Adriatic salt burden</span><span>${Math.max(0, plan.saltRequired - plan.saltImportShortfall).toFixed(1)} road-matched toward reserve inputs &middot; ${saltImports} &middot; ${saltWarnings} &middot; repeated imports can tighten the regional rate${marketInspect}</span></li>
    <li><span>Preserving vessels</span><span>${Math.max(0, plan.potteryRequired - plan.potteryShortfall).toFixed(1)} road-matched toward reserve inputs &middot; ${potteryStatus} &middot; kiln cart priorities decide whether smokehouses or household breakage receive the next load</span></li>
  `;
}

function formatFreshFoodLossSite(
  site: FreshFoodLossSite | null,
  getBuildingLabel: (kind: BuildingKind) => string,
  getResidenceParcelIndex: (id: string) => number | null,
): string {
  if (site === null) return 'No fresh food currently spoiling';
  if (site.source === 'treasury') {
    return `Legacy treasury reserve · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)}`;
  }
  if (site.source === 'building' && site.id !== null && site.buildingKind !== null) {
    return `${getBuildingLabel(site.buildingKind)} · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-building="${site.id}" aria-label="Inspect largest fresh-food loss">Inspect</button>`;
  }
  if (site.source === 'residence' && site.id !== null) {
    const parcelIndex = getResidenceParcelIndex(site.id);
    const label = parcelIndex === null ? 'Residence' : `Residence parcel #${parcelIndex + 1}`;
    return `${label} · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-residence="${site.id}" aria-label="Inspect largest household fresh-food loss">Inspect</button>`;
  }
  if (site.source === 'trip') {
    return `Loaded handcart · ${site.stock.toFixed(1)} food · ${formatFreshFoodLoss(site.spoilagePerDay)}`;
  }
  return 'No fresh food currently spoiling';
}

function formatPreservedFoodLossSite(
  site: FreshFoodLossSite | null,
  getBuildingLabel: (kind: BuildingKind) => string,
  getResidenceParcelIndex: (id: string) => number | null,
): string {
  if (site === null) return 'No preserved provisions currently aging';
  if (site.source === 'treasury') {
    return `Legacy treasury reserve · ${site.stock.toFixed(1)} provisions · ${formatPreservedFoodLoss(site.spoilagePerDay)}`;
  }
  if (site.source === 'building' && site.id !== null && site.buildingKind !== null) {
    return `${getBuildingLabel(site.buildingKind)} · ${site.stock.toFixed(1)} provisions · ${formatPreservedFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-building="${site.id}" aria-label="Inspect largest cured-food loss">Inspect</button>`;
  }
  if (site.source === 'residence' && site.id !== null) {
    const parcelIndex = getResidenceParcelIndex(site.id);
    const label = parcelIndex === null ? 'Residence' : `Residence parcel #${parcelIndex + 1}`;
    return `${label} · ${site.stock.toFixed(1)} provisions · ${formatPreservedFoodLoss(site.spoilagePerDay)} <button type="button" class="inspector-jump-button" data-inspect-residence="${site.id}" aria-label="Inspect largest household cured-food loss">Inspect</button>`;
  }
  if (site.source === 'trip') {
    return `Loaded handcart · ${site.stock.toFixed(1)} provisions · ${formatPreservedFoodLoss(site.spoilagePerDay)}`;
  }
  return 'No preserved provisions currently aging';
}

function formatGranaryFreshFoodNetwork(network: GranaryFreshFoodNetwork): string {
  if (network.completedGranaries === 0) return 'No completed granary';
  if (network.collectingGranaries === 0) {
    if (network.fireDisabledGranaries > 0) {
      const disabled = network.fireDisabledGranaries === network.completedGranaries
        ? 'every completed granary is fire-disabled'
        : `${network.fireDisabledGranaries} fire-disabled · remaining granaries have collection disabled`;
      return `${network.completedGranaries} completed · ${disabled}`;
    }
    return `${network.completedGranaries} completed · fresh-food collection disabled at every granary`;
  }
  const enabled = network.collectingGranaries === network.completedGranaries
    ? `${network.collectingGranaries} collection ${network.collectingGranaries === 1 ? 'target' : 'targets'}`
    : `${network.collectingGranaries} / ${network.completedGranaries} collection enabled`;
  const aboveTarget = network.stockAboveTarget > 0.05
    ? ` · ${network.stockAboveTarget.toFixed(1)} above targets from baking or earlier stock`
    : '';
  const fireOutage = network.fireDisabledGranaries > 0
    ? ` · ${network.fireDisabledGranaries} fire-disabled`
    : '';
  return `${network.stockTowardTarget.toFixed(1)} / ${network.targetStock.toFixed(1)} sheltered toward selected targets · ${network.targetShortfall.toFixed(1)} collection headroom · ${network.staffedCollectingGranaries} / ${network.collectingGranaries} collectors staffed · ${enabled}${fireOutage}${aboveTarget}`;
}

export function renderTownHallInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const fireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  );
  const staffed = building.assignedLabor > 0 && !fireDisabled.has(building.id);
  const staffedTownHallAvailable = Array.from(context.gameState.buildings.values()).some(
    (candidate) =>
      candidate.kind === 'town_hall'
      && candidate.constructionComplete !== false
      && candidate.assignedLabor > 0
      && !fireDisabled.has(candidate.id),
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
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const readout = buildVillageAdminReadout({
    gameState: context.gameState,
    worldQueries: context.worldQueries,
    worldHydrology: context.worldHydrology,
    taxRate,
    parishPolicy,
  });
  const collectionRate = staffedTownHallAvailable
    ? 100
    : Math.round(TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER * 100);
  const monasteryPolicy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const nightPolicy = context.getNightPolicy?.() ?? DEFAULT_NIGHT_POLICY;
  const clock = gameClock(context.gameState.tick);
  const frontierSecurity = context.conflictEnabled
    ? context.getSettlementSecurity?.() ?? null
    : null;
  const refugeShelterPlan = frontierSecurity === null
    ? null
    : computeRefugeShelterPlan(context.gameState);
  const frontierSecurityRows = frontierSecurity === null
    ? ''
    : renderFrontierSecurityRows(
        frontierSecurity,
        refugeShelterPlan!,
        context.gameState.tick,
        clock.month,
        context.enemyPressure ?? 0,
      );
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
  const sabbathObserved = parishPolicy.sabbathObservanceEnabled
    && settlementHasStaffedChapel(context.gameState);
  const roadComponentFor = typeof context.worldQueries.getRoadComponentId === 'function'
    ? (entity: { x: number; z: number }) =>
        context.worldQueries.getRoadComponentId(entity.x, entity.z)
    : undefined;
  const provisioning = computeSettlementProvisioning({
    state: context.gameState,
    totals: context.resourceTotals,
    currentFirewoodDemandMultiplier: environment.firewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay: environment.freshFoodSpoilageFractionPerDay,
    preservedFoodSpoilageFractionPerDay:
      environment.preservedFoodSpoilageFractionPerDay,
    currentPreservedFoodDemandMultiplier:
      environment.preservedFoodDemandMultiplier,
    sabbathObserved,
    roadComponentFor,
  });
  const firewoodPlan = computeSettlementFirewoodPlan(
    context.gameState,
    sabbathObserved,
    roadComponentFor,
  );
  const firewoodInspectButton = firewoodPlan.firstDeficitTargetId === null
    ? ''
    : context.gameState.residences.has(firewoodPlan.firstDeficitTargetId)
      ? ` <button type="button" class="inspector-jump-button" data-inspect-residence="${firewoodPlan.firstDeficitTargetId}" aria-label="Inspect first fuel-deficit household">Inspect</button>`
      : ` <button type="button" class="inspector-jump-button" data-inspect-building="${firewoodPlan.firstDeficitTargetId}" aria-label="Inspect first fuel-deficit worksite">Inspect</button>`;
  const freshFoodPreservationRows = renderFreshFoodPreservationRows(
    provisioning.foodPreservation,
    (kind) => context.worldQueries.getBuildingLabel(kind),
    (residenceId) => context.gameState.residences.get(residenceId)?.parcelIndex ?? null,
  );
  const growthChapels = Array.from(context.gameState.buildings.values())
    .filter((candidate) =>
      candidate.kind === 'chapel'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id));
  const growthMonasteries = Array.from(context.gameState.buildings.values())
    .filter((candidate) =>
      candidate.kind === 'monastery'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id));
  const roadPathDistance = (ax: number, az: number, bx: number, bz: number): number | null =>
    context.worldQueries.getRoadPathDistance(ax, az, bx, bz);
  const growthCommunityClaims =
    typeof context.worldQueries.getResidenceCommunityLandmarkClaims === 'function'
      ? context.worldQueries.getResidenceCommunityLandmarkClaims(
          [...context.gameState.residences.values()],
        )
      : null;
  const growthChapelsById = new Map(
    growthChapels.map((chapel) => [chapel.id, chapel]),
  );
  const growth = computeSettlementGrowthPlan({
    state: context.gameState,
    communityForResidence: (residence) => {
      const chapelClaim = growthCommunityClaims?.chapels.get(residence.id);
      return buildResidenceCommunityContext(
        growthCommunityClaims == null
          ? findServingChapel(residence, growthChapels, roadPathDistance)
          : chapelClaim == null
            ? null
            : growthChapelsById.get(chapelClaim.supplierId) ?? null,
        parishPolicy,
        growthCommunityClaims == null
          ? isResidenceInMonasteryCoverage(
              residence,
              growthMonasteries,
              growthChapels,
              roadPathDistance,
            )
          : growthCommunityClaims.monasteries.has(residence.id),
      );
    },
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
    roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
      ? (candidate) => context.worldQueries.getRoadComponentId(
          candidate.x,
          candidate.z,
        )
      : undefined,
  });
  const fireRecoveryPlan = computeSettlementFireRecoveryPlan({
    state: context.gameState,
    resources: context.resourceTotals,
    roadComponentIdsFor: (candidate) =>
      context.worldQueries.getRoadComponentIds(candidate.x, candidate.z),
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
  const payrollInTransit = guardhousePayrollInTransitGold(
    context.gameState.deliveryTrips.values(),
  );
  const guardhousePayroll = guardhousePayrollPlan(
    context.gameState.buildings.values(),
    context.resourceTotals.gold,
    fireDisabled,
    payrollInTransit,
  );
  const payrollDispatch = guardhousePayrollDispatchPlan({
    payroll: guardhousePayroll,
    buildings: context.gameState.buildings.values(),
    trips: context.gameState.deliveryTrips.values(),
    treasuryGold: context.resourceTotals.gold,
    physicalEconomy:
      context.gameState.physicalFoundingSiteEnabled === true
      && (context.conflictEnabled ?? false),
    freeHaulers: context.populationStats.available,
    roadComponentFor:
      typeof context.worldQueries.getRoadComponentId === 'function'
        ? (candidate) => context.worldQueries.getRoadComponentId(
            candidate.x,
            candidate.z,
          )
        : undefined,
  });
  const payrollGoldDue = guardhousePayroll.reduce((sum, company) => sum + company.dailyWage, 0);
  const payrollGoldFunded = guardhousePayroll.reduce((sum, company) => sum + company.fundedGold, 0);
  const payrollGoldOnsite = guardhousePayroll.reduce((sum, company) => sum + company.onsiteGold, 0);
  const payrollGoldInTransit = guardhousePayroll.reduce(
    (sum, company) => sum + company.inTransitGold,
    0,
  );
  const underfundedCompany = guardhousePayroll.find((company) => company.fundedRatio < 0.999);
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
      typeof context.worldQueries.getRoadComponentId === 'function'
        ? (candidate) => context.worldQueries.getRoadComponentId(
            candidate.x,
            candidate.z,
          )
        : undefined,
      environment.watermillThroughputMultiplier,
      environment.clayPitThroughputMultiplier,
      environment.preservedFoodDemandMultiplier,
      clock.month,
      context.worldResourceAbundance ?? 50,
      environment.charcoalBurnerThroughputMultiplier,
    );
  const industrialMaterials = production.industrialMaterials;
  const unmaintainedToolInspect = industrialMaterials.firstUnmaintainedToolSiteId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${industrialMaterials.firstUnmaintainedToolSiteId}" aria-label="Inspect first unmaintained civilian tool rack">Inspect</button>`;
  const leanClayPitInspect = industrialMaterials.firstLeanClayPitId === null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-building="${industrialMaterials.firstLeanClayPitId}" aria-label="Inspect first lean clay bank">Inspect</button>`;
  const prosperity = computeSettlementProsperityPlan(production, growth);
  const textilePlan = computeSettlementTextilePlan({
    state: context.gameState,
    clock,
    production,
    roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
      ? (candidate) => context.worldQueries.getRoadComponentId(
          candidate.x,
          candidate.z,
        )
      : undefined,
  });
  const armamentPlan = context.conflictEnabled
    ? computeSettlementArmamentPlan({
        state: context.gameState,
        roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
          ? (candidate) => context.worldQueries.getRoadComponentId(
              candidate.x,
              candidate.z,
            )
          : undefined,
      })
    : null;
  const processingWeek = `${production.capacityDaysPerWeek}-day working week · operational staffed capacity if supplied · river mills at ${Math.round(production.watermillThroughputMultiplier * 100)}% water power with each mill's tool condition applied`;
  const productionFireOutageRow = production.fireDisabledProcessorSites === 0
    ? ''
    : `<li><span>Processor fire outages</span><span>${production.fireDisabledProcessorWorkers} ${production.fireDisabledProcessorWorkers === 1 ? 'worker is' : 'workers are'} idle across ${production.fireDisabledProcessorSites} fire-disabled ${production.fireDisabledProcessorSites === 1 ? 'processor' : 'processors'}${production.firstFireDisabledProcessorId === null ? '' : ` <button type="button" class="inspector-jump-button" data-inspect-building="${production.firstFireDisabledProcessorId}" aria-label="Inspect first fire-disabled processor">Inspect</button>`}</span></li>`;
  const prosperityHouseholdFireOutageRow =
    production.fireDisabledTierThreeHomes === 0
      ? ''
      : `<li><span>Prosperity household outages</span><span>${production.fireDisabledTierThreeResidents} prosperous ${production.fireDisabledTierThreeResidents === 1 ? 'resident is' : 'residents are'} excluded from active preserved-food, ale, cloth, and pottery demand across ${production.fireDisabledTierThreeHomes} fire-disabled ${production.fireDisabledTierThreeHomes === 1 ? 'home' : 'homes'} · ${production.fireDisabledTierThreeHousingCapacity} prosperous places return to the housing pipeline after recovery</span></li>`;
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
    roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
      ? (candidate) => context.worldQueries.getRoadComponentId(
          candidate.x,
          candidate.z,
        )
      : undefined,
  });
  const marketState = context.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE;
  const preservationReserve = computeSettlementPreservationReservePlan(
    context.gameState,
    {
      sabbathObserved: provisioning.sabbathObserved,
      roadComponentFor,
      preservedFoodSpoilageFractionPerDay:
        environment.preservedFoodSpoilageFractionPerDay,
    },
  );
  const preservationReserveRows = renderPreservationReserveRows(
    preservationReserve,
    marketplaceTradeOfferCost(
      MARKETPLACE_SALT_IMPORT_OFFER,
      marketState,
    ).amount,
  );
  const roadNetworkSnapshot =
    typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
      ? context.worldQueries.getRoadNetworkSnapshot()
      : null;
  const householdMarketPlan = roadNetworkSnapshot == null
    ? null
    : computeSettlementHouseholdMarketPlan({
        state: context.gameState,
        marketState,
        roadNetwork: roadNetworkSnapshot,
        clock,
        sabbathObserved: provisioning.sabbathObserved,
      });
  const householdMarketInspectButton =
    householdMarketPlan?.firstAttentionResidenceId == null
      ? ''
      : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${householdMarketPlan.firstAttentionResidenceId}" aria-label="Inspect first emergency-market household">Inspect</button>`;
  const parishReliefPlan = roadNetworkSnapshot == null
    ? null
    : computeSettlementParishReliefPlan({
        state: context.gameState,
        marketState,
        roadNetwork: roadNetworkSnapshot,
        clock,
        sabbathObserved: provisioning.sabbathObserved,
      });
  const parishReliefInspectButton =
    parishReliefPlan?.firstAttentionResidenceId == null
      ? ''
      : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${parishReliefPlan.firstAttentionResidenceId}" aria-label="Inspect first blocked parish-relief household">Inspect</button>`;
  const parishFireInspectButton =
    parishReliefPlan?.firstUnavailableChapelId == null
      ? ''
      : ` <button type="button" class="inspector-jump-button" data-inspect-building="${parishReliefPlan.firstUnavailableChapelId}" aria-label="Inspect first structurally unavailable church">Inspect outage</button>`;
  const parishFireOutageRow = parishReliefPlan == null
    || (
      parishReliefPlan.fireDisabledChapels === 0
      && parishReliefPlan.reconstructingChapels === 0
      && parishReliefPlan.fireDisabledHomes === 0
    )
    ? ''
    : `<li><span>Parish structural outages</span><span>${parishReliefPlan.fireDisabledChapels} fire-disabled + ${parishReliefPlan.reconstructingChapels} reconstructing ${parishReliefPlan.fireDisabledChapels + parishReliefPlan.reconstructingChapels === 1 ? 'church' : 'churches'} + ${parishReliefPlan.fireDisabledHomes} ${parishReliefPlan.fireDisabledHomes === 1 ? 'home' : 'homes'} outside parish finance · ${parishReliefPlan.structurallyQuarantinedCofferGold.toFixed(1)} coffer gold sealed until structural recovery${parishFireInspectButton}</span></li>`;
  const specialtyExportPlan = computeSettlementSpecialtyExportPlan({
    state: context.gameState,
    marketRate: marketState.specialtyPriceMult,
    roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
      ? (candidate) => context.worldQueries.getRoadComponentId(
          candidate.x,
          candidate.z,
        )
      : undefined,
  });
  const seedProcurement = computeSettlementSeedProcurementPlan({
    state: context.gameState,
    seedShortfall: farmPlan.seedGrainShortfall,
    seedGrainByHolding: farmPlan.seedGrainByHolding,
    availableGold:
      context.gameState.physicalFoundingSiteEnabled === true
        ? payrollDispatch.remainingTreasuryGold
        : context.resourceTotals.gold,
    nextLotGoldCost: marketplaceTradeOfferCost(
      MARKETPLACE_SEED_GRAIN_IMPORT_OFFER,
      marketState,
    ).amount,
    conflictEnabled: context.conflictEnabled ?? false,
    hasRoadAccess: (candidate) =>
      context.worldQueries.hasRoadAccess(candidate.x, candidate.z),
    roadComponentFor: typeof context.worldQueries.getRoadComponentId === 'function'
      ? (candidate) => context.worldQueries.getRoadComponentId(
          candidate.x,
          candidate.z,
        )
      : undefined,
  });
  const centralGrainReserveRow = grainReserve.granaries === 0
    ? '<li><span>Central grain floor</span><span>No completed granary</span></li>'
    : `<li><span>Central grain floor</span><span>${grainReserve.protectedStock.toFixed(1)} / ${grainReserve.reserveTarget.toFixed(1)} protected across ${grainReserve.granaries} ${grainReserve.granaries === 1 ? 'granary' : 'granaries'}${grainReserve.reserveShortfall > 0.05 ? ` · short ${grainReserve.reserveShortfall.toFixed(1)}${grainReserve.firstShortGranaryId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${grainReserve.firstShortGranaryId}" aria-label="Inspect first central grain reserve shortfall">Inspect</button>` : ''}` : ''} · ${grainReserve.processorAndTradeSurplus.toFixed(1)} releasable</span></li>`;
  const weakestRotationField = farmPlan.rotation.weakestYearThreeFieldId === null
    || farmPlan.rotation.lowestYearThreeFertility === null
    ? ''
    : ` · weakest Year 3 ${Math.round(farmPlan.rotation.lowestYearThreeFertility * 100)}% <button type="button" class="inspector-jump-button" data-inspect-field="${farmPlan.rotation.weakestYearThreeFieldId}" aria-label="Inspect weakest Year 3 field">Inspect</button>`;
  const rotationRows = farmPlan.rotation.activeArea <= 1e-9
    ? '<li><span>Three-year rotation</span><span>No active field area planned</span></li>'
    : `
      <li><span>Year 2 rotation</span><span>${FARM_CROPS.filter((crop) => farmPlan.rotation.nextAreaByCrop[crop] > 0.5).map((crop) => `${Math.round(farmPlan.rotation.nextAreaByCrop[crop]).toLocaleString()} m² ${cropLabel(crop).toLowerCase()}`).join(' · ')}</span></li>
      <li><span>Year 3 rotation</span><span>${FARM_CROPS.filter((crop) => farmPlan.rotation.yearThreeAreaByCrop[crop] > 0.5).map((crop) => `${Math.round(farmPlan.rotation.yearThreeAreaByCrop[crop]).toLocaleString()} m² ${cropLabel(crop).toLowerCase()}`).join(' · ')}</span></li>
      <li><span>Cyclic coverage</span><span>${Math.round(farmPlan.rotation.cyclicArea).toLocaleString()} / ${Math.round(farmPlan.rotation.activeArea).toLocaleString()} m² explicitly scheduled · remaining land repeats Year 2</span></li>
      <li><span>Soil trajectory</span><span>${Math.round(farmPlan.rotation.currentAverageFertility * 100)}% now → ${Math.round(farmPlan.rotation.afterCurrentAverageFertility * 100)}% after Year 1 → ${Math.round(farmPlan.rotation.afterPlannedAverageFertility * 100)}% after Year 2 → ${Math.round(farmPlan.rotation.afterYearThreeAverageFertility * 100)}% after Year 3${weakestRotationField}</span></li>
      <li><span>Year 2 potential</span><span>${farmPlan.rotation.plannedHarvest.toFixed(1)} bread grain · ${farmPlan.rotation.plannedBarleyHarvest.toFixed(1)} barley · ${farmPlan.rotation.plannedFibreHarvest.toFixed(1)} flax fibre · seed ${farmPlan.rotation.plannedSeedGrainRequired.toFixed(1)} grain + ${farmPlan.rotation.plannedSeedBarleyRequired.toFixed(1)} barley · ${farmPlan.rotation.restoringFields} fields restore / ${farmPlan.rotation.decliningFields} draw soil</span></li>
      <li><span>Year 3 potential</span><span>${farmPlan.rotation.yearThreeHarvest.toFixed(1)} bread grain · ${farmPlan.rotation.yearThreeBarleyHarvest.toFixed(1)} barley · ${farmPlan.rotation.yearThreeFibreHarvest.toFixed(1)} flax fibre · seed ${farmPlan.rotation.yearThreeSeedGrainRequired.toFixed(1)} grain + ${farmPlan.rotation.yearThreeSeedBarleyRequired.toFixed(1)} barley · ${farmPlan.rotation.yearThreeRestoringFields} fields restore / ${farmPlan.rotation.yearThreeDecliningFields} draw soil · current moisture, future manure excluded</span></li>
    `;
  const farmPlanRows = farmPlan.holdingCount === 0
    ? '<li><span>Cereal plan</span><span>No farm fields linked</span></li>'
    : `
      <li><span>Arable fields</span><span>${farmPlan.activeFields} active${farmPlan.pausedFields > 0 ? ` · ${farmPlan.pausedFields} paused` : ''} across ${farmPlan.holdingCount} holdings${farmPlan.orphanedFields > 0 ? ` · ${farmPlan.orphanedFields} orphaned` : ''}</span></li>
      <li><span>Ox-supported fields</span><span>${farmPlan.cattleSupportedFields} / ${farmPlan.activeFields} active · plough labor includes current cattle coverage</span></li>
      <li><span>September grain</span><span>${farmPlan.laborCoveredHarvest.toFixed(1)} / ${farmPlan.expectedHarvest.toFixed(1)} bread grain covered by current crews</span></li>
      <li><span>September barley</span><span>${farmPlan.laborCoveredBarleyHarvest.toFixed(1)} / ${farmPlan.expectedBarleyHarvest.toFixed(1)} barley covered by current crews</span></li>
      <li><span>September flax</span><span>${farmPlan.laborCoveredFibreHarvest.toFixed(1)} / ${farmPlan.expectedFibreHarvest.toFixed(1)} fibre covered by current crews</span></li>
      <li><span>Seed on holdings</span><span>${farmPlan.seedGrainCovered.toFixed(1)} / ${farmPlan.seedGrainRequired.toFixed(1)} protected onsite${farmPlan.seedGrainShortfall > 0.05 ? ` · short ${farmPlan.seedGrainShortfall.toFixed(1)} across ${farmPlan.seedShortHoldings} holdings${farmPlan.firstSeedShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${farmPlan.firstSeedShortBuildingId}" aria-label="Inspect first seed shortfall">Inspect</button>` : ''}` : ''}</span></li>
      <li><span>Barley seed on holdings</span><span>${farmPlan.seedBarleyCovered.toFixed(1)} / ${farmPlan.seedBarleyRequired.toFixed(1)} protected onsite${farmPlan.seedBarleyShortfall > 0.05 ? ` · short ${farmPlan.seedBarleyShortfall.toFixed(1)}` : ''}</span></li>
      <li><span>Field manure</span><span>${farmPlan.manureCovered.toFixed(1)} / ${farmPlan.manureRequired.toFixed(1)} physically spread, stored, or inbound${farmPlan.manureShortfall > 0.05 ? ` · short ${farmPlan.manureShortfall.toFixed(1)} across ${farmPlan.manureShortHoldings} holdings${farmPlan.firstManureShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${farmPlan.firstManureShortBuildingId}" aria-label="Inspect first manure shortfall">Inspect</button>` : ''}` : ' · cycle coverage secured'}</span></li>
      <li><span>Farm-tool reserve</span><span>${farmPlan.toolIronworkCovered.toFixed(2)} / ${farmPlan.toolIronworkReserveTarget.toFixed(2)} smith-forged ironwork onsite or inbound for ${farmPlan.toolIronworkRequired.toFixed(2)} planned wear · ${farmPlan.toolMaintainedHoldings} / ${farmPlan.toolEligibleHoldings} holdings currently maintained${farmPlan.toolIronworkShortfall > 0.01 ? ` · short ${farmPlan.toolIronworkShortfall.toFixed(2)} across ${farmPlan.toolShortHoldings} holdings${farmPlan.firstToolShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${farmPlan.firstToolShortBuildingId}" aria-label="Inspect first farm-tool shortfall">Inspect</button>` : ''}` : ' · seasonal coverage secured'}</span></li>
      ${rotationRows}
      <li><span>September field labor</span><span>${formatSettlementFieldWork(farmPlan.harvest)}</span></li>
      <li><span>Spring crop labor</span><span>${formatSettlementFieldWork(farmPlan.spring)}</span></li>
      <li><span>Autumn crop labor</span><span>${formatSettlementFieldWork(farmPlan.autumn)}</span></li>
    `;
  const livestockDairyRows = livestockFodder.pastoralHoldings === 0
    ? ''
    : `
      <li><span>Farmhouse cheese</span><span>${livestockFodder.productiveDairyHeads.toFixed(1)} productive cattle/sheep head · ${livestockFodder.dairyPreservedFoodPerDay.toFixed(1)} preserved food / day potential · ${livestockFodder.dairySaltPerDay.toFixed(2)} salt / day</span></li>
      <li><span>Dairy salt buffers</span><span>${livestockFodder.dairySaltStock.toFixed(2)} / ${livestockFodder.dairySaltTarget.toFixed(2)} onsite across staffed holdings${livestockFodder.dairySaltShortfall > 0.05 ? ` · short ${livestockFodder.dairySaltShortfall.toFixed(2)} across ${livestockFodder.dairySaltShortHoldings} holdings · first runway ${formatProvisionRunway(livestockFodder.firstDairySaltRunwayDays)}${livestockFodder.firstDairySaltShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${livestockFodder.firstDairySaltShortBuildingId}" aria-label="Inspect first dairy salt shortfall">Inspect</button>` : ''}` : ' · working buffers covered'} · mine and market carts share salt with smokehouses; fresh dairy continues when empty</span></li>
    `;
  const livestockFodderRows = livestockFodder.holdingCount === 0
    ? '<li><span>Winter herd plan</span><span>No livestock holdings</span></li>'
    : `
      <li><span>Winter herd plan</span><span>${livestockFodder.projectedHeadCount} projected head · ${livestockFodder.winterPastureCapacity.toFixed(1)} pasture-supported · ${livestockFodder.winterUnsupportedHeads.toFixed(1)} need stored fodder · ${livestockFodder.staffedHoldings}/${livestockFodder.holdingCount} holdings staffed</span></li>
      <li><span>Summer hay plan</span><span>${livestockFodder.haymakingHoldings} / ${livestockFodder.pastoralHoldings} cattle/sheep holdings reserving meadow · ${livestockFodder.summerReservedCapacity.toFixed(1)} pasture capacity reserved · ${livestockFodder.hayOutputPerDay.toFixed(1)} hay / day in season</span></li>
      ${livestockDairyRows}
      <li><span>Winter hay reserve</span><span>${livestockFodder.hayStock.toFixed(1)} stored · ${livestockFodder.projectedHayStock.toFixed(1)} projected at winter / ${livestockFodder.winterHayNeed.toFixed(1)} needed${livestockFodder.winterHayShortfall > 0.05 ? ` · short ${livestockFodder.winterHayShortfall.toFixed(1)} before grain` : ''}</span></li>
      <li><span>Winter fodder grain</span><span>${livestockFodder.winterReserveStock.toFixed(1)} / ${livestockFodder.winterReserveTarget.toFixed(1)} onsite after hay${livestockFodder.winterReserveShortfall > 0.05 ? ` · short ${livestockFodder.winterReserveShortfall.toFixed(1)} across ${livestockFodder.shortHoldings} holdings · first combined coverage ${formatProvisionRunway(livestockFodder.firstRunwayDays)}${livestockFodder.firstShortBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${livestockFodder.firstShortBuildingId}" aria-label="Inspect first winter fodder shortfall">Inspect</button>` : ''}` : ' · stocked to holding targets'}</span></li>
      <li><span>Winter fodder logistics</span><span>${livestockFodder.winterGrainNeed.toFixed(1)} emergency grain after projected hay for ${LIVESTOCK_WINTER_FODDER_RESERVE_DAYS} days · ${livestockFodder.winterGrainPerDay.toFixed(1)} / day after hay runs out${livestockFodder.capacityLimitedHoldings > 0 ? ` · ${livestockFodder.capacityLimitedHoldings} holdings need winter resupply even when full` : ''}</span></li>
    `;
  const linkedMonasteries = [...context.gameState.buildings.values()].filter(
    (candidate) =>
      candidate.kind === 'monastery'
      && candidate.constructionComplete !== false
      && !fireDisabled.has(candidate.id)
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
  const feastFoodPerYear = hospitalityPlans.reduce(
    (sum, plan) => sum + plan.feastFoodPerYear,
    0,
  );
  const feastAlePerYear = hospitalityPlans.reduce(
    (sum, plan) => sum + plan.feastAlePerYear,
    0,
  );
  const feastReadyMonasteries = linkedMonasteries.filter(
    (candidate) => monasteryFeastReadiness(candidate).ready,
  ).length;
  const nextFeast = nextMonasteryFeast(clock);
  const monasteryHospitalityRow = linkedMonasteries.length === 0
    ? '<li><span>Monastery hospitality</span><span>No chapel-and-market-linked monastery</span></li>'
    : monasteryPolicy.feastsEnabled
      ? `<li><span>Monastery hospitality</span><span>${hospitalitySupplied} / ${linkedMonasteries.length} supplied above protected feast floors · ${hospitalityGoldPerDay.toFixed(2)} pilgrimage gold/day before handcart collection · annual target ${hospitalityHoneyPerYear.toFixed(0)} honey + ${hospitalityWinePerYear.toFixed(0)} wine</span></li>
        <li><span>Next feast reserve</span><span>${formatNextMonasteryFeast(nextFeast)} · ${feastReadyMonasteries} / ${linkedMonasteries.length} protected pantries ready · annual batches require ${feastFoodPerYear.toFixed(0)} food + ${feastAlePerYear.toFixed(0)} ale settlement-wide</span></li>`
      : `<li><span>Monastery hospitality</span><span>Disabled · ${hospitalityGoldPerDay.toFixed(2)} baseline pilgrimage gold/day before handcart collection · feast stock released to household supply or export</span></li>`;
  const inboundTreasuryGold = Array.from(context.gameState.deliveryTrips.values())
    .filter(
      (trip) =>
        trip.targetBuildingId === building.id
        && trip.cargoKind === 'gold'
        && trip.phase !== 'inbound',
    )
    .reduce((sum, trip) => sum + trip.amount, 0);

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
      <li><span>Treasury chest</span><span>${building.gold.toFixed(0)} gold secured here${inboundTreasuryGold > 1e-6 ? ` · ${inboundTreasuryGold.toFixed(0)} incoming by handcart` : ''}</span></li>
      <li><span>Population</span><span>${context.populationStats.total}</span></li>
      ${renderSettlementWelfareRows(provisioning.welfare)}
      <li><span>Workforce</span><span>${context.populationStats.assigned} / ${context.populationStats.total} committed${context.populationStats.cartAssigned > 0 ? ` · ${context.populationStats.cartAssigned} reserved on carts outside building rosters` : ''} · ${context.populationStats.available} free · ${laborPlan.openPermanentPosts} open permanent posts${laborInspectButton}</span></li>
      <li><span>Sector staffing</span><span>${formatLaborSectorMix(laborPlan)}</span></li>
      <li><span>Staffing priorities</span><span>${formatStaffingPriorities(laborPlan)}</span></li>
      <li><span>Seasonal steward</span><span>${seasonalLaborStewardStatus(seasonalLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Production steward</span><span>${productionLaborStewardStatus(productionLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Construction steward</span><span>${constructionLaborStewardStatus(constructionLaborStewardEnabled, staffedTownHallAvailable)}</span></li>
      <li><span>Steward reserve</span><span>${laborStewardReserveLabel(laborStewardReserve)} · ${context.populationStats.available} currently free</span></li>
      <li><span>Dawn labor review</span><span>${formatLaborStewardForecast(laborStewardForecast, staffedTownHallAvailable)}${laborStewardInspectButton}</span></li>
      <li><span>Last night</span><span>${formatDawnReport(nightPolicy)}</span></li>
      <li><span>Night condition</span><span>${Math.round(nightPolicy.communityCohesion * 100)}% cohesion Â· ${Math.round(nightPolicy.laborFatigue * 100)}% accumulated night-shift fatigue Â· watch strength ${nightPolicy.lastWatchStrength.toFixed(1)}</span></li>
      <li><span>Seasonal labor</span><span>${formatSeasonalLabor(seasonalLabor)}${seasonalLaborInspectButton}</span></li>
      <li><span>Seasonal call-up</span><span>${formatSeasonalCallup(seasonalCallup)}${seasonalCallupInspectButton}</span></li>
      <li><span>Target-paused workshops</span><span>${formatProcessorLaborRecall(processorLaborRecall)}${processorLaborRecallInspectButton}</span></li>
      <li><span>Production call-up</span><span>${formatProcessorLaborCallup(productionLaborCallup)}${productionLaborCallupInspectButton}</span></li>
      <li><span>Year-round balance</span><span>${formatYearRoundLaborRotation(yearRoundLabor)}${yearRoundLaborInspectButton}</span></li>
      <li><span>Production stalls</span><span>${formatWorksiteStalls(worksiteStalls, (kind) => context.worldQueries.getBuildingLabel(kind))}</span></li>
      <li><span>At full housing labor</span><span>${formatFullHousingLabor(laborPlan)}</span></li>
      <li><span>Work in motion</span><span>${formatWorkInMotion(laborPlan)}</span></li>
      ${renderSettlementHaulageRows(laborPlan.haulage)}
      ${renderSettlementFireRecoveryRows(
        fireRecoveryPlan,
        (kind) => context.worldQueries.getBuildingLabel(kind),
      )}
      <li><span>Next dawn outlook</span><span>${nextDawnOutlook}</span></li>
      ${renderConstructionQueueRows(constructionPlan)}
      <li><span>Construction crews</span><span>${formatConstructionLabor(constructionLabor)}${constructionLaborInspectButton}</span></li>
      ${renderStorehouseNetworkRows(laborPlan.storehouseNetwork)}
      <li><span>Housing pipeline</span><span>${growth.vacantSlots} operational vacant places · ${growth.progressingHomes} / ${growth.candidateHomes} homes admitting settlers${growth.firstArrivalHomes > 0 ? ` · ${growth.firstArrivalHomes} awaiting first household` : ''}${growth.abandonedHomes > 0 ? ` · ${growth.abandonedHomes} abandoned` : ''}${growth.fireDisabledHomes > 0 ? ` · ${growth.fireDisabledHomes} fire-disabled homes / ${growth.fireDisabledHousingCapacity} places offline` : ''}</span></li>
      <li><span>Next settler</span><span>${growth.nextArrivalSeconds === null ? growth.vacantSlots > 0 ? 'Paused until household buffers recover' : growth.fireDisabledVacantSlots > 0 ? `${growth.fireDisabledVacantSlots} vacant places return after structural recovery` : 'No vacant housing' : formatGrowthDuration(growth.nextArrivalSeconds)}</span></li>
      <li><span>Growth bottlenecks</span><span>${formatGrowthBottlenecks(growth)}${growthInspectButton}</span></li>
      <li><span>At full housing</span><span>+${growth.additionalFoodPerDay.toFixed(1)} winter fresh food/day after cured-ration displacement · ${growth.additionalGrossFoodPerDay.toFixed(1)} gross meal demand · +${growth.additionalWaterPerDay.toFixed(1)} water/day · +${growth.additionalWinterFirewoodPerDay.toFixed(1)} winter firewood/day</span></li>
      ${growth.additionalPreservedFoodPerDay + growth.additionalAlePerDay + growth.additionalClothPerDay + growth.additionalPotteryPerDay > 1e-6 ? `<li><span>Prosperous-house growth</span><span>+${growth.additionalPreservedFoodPerDay.toFixed(1)} winter-peak preserved ration/day · +${growth.additionalAlePerDay.toFixed(1)} ale/day · +${growth.additionalClothPerDay.toFixed(2)} cloth/day · +${growth.additionalPotteryPerDay.toFixed(2)} pottery/day</span></li>` : ''}
      ${readout.backyardEconomy ? renderSettlementBackyardEconomyRows(readout.backyardEconomy) : ''}
      <li><span>Trade productivity</span><span>${readout.productivityLabel}</span></li>
      <li><span>Household wealth</span><span>${readout.householdWealthLabel}</span></li>
      <li><span>Household savings</span><span>${readout.householdSavingsLabel}</span></li>
      ${householdMarketPlan == null ? '' : `
      <li><span>Emergency market orders</span><span>${formatHouseholdMarketSettlementSummary(householdMarketPlan)}</span></li>
      <li><span>Emergency purchasing power</span><span>${formatHouseholdMarketPurchasingPower(householdMarketPlan)}</span></li>
      <li><span>Emergency bottlenecks</span><span>${formatHouseholdMarketBottlenecks(householdMarketPlan)}${householdMarketInspectButton}</span></li>`}
      <li><span>Garden tolls levied</span><span>${readout.taxIncomeLabel}</span></li>
      <li><span>Collection capacity</span><span>${collectionRate}%${staffedTownHallAvailable ? '' : ' without a staffed clerk'}</span></li>
      <li><span>Church tithe</span><span>${readout.chapelTitheLabel}</span></li>
      <li><span>Parish expenses</span><span>${readout.parishExpenseLabel}</span></li>
      <li><span>Parish coffers</span><span>${readout.cofferBalanceLabel}</span></li>
      ${parishFireOutageRow}
      <li><span>Parish ledger</span><span>${readout.parishLedgerLabel}</span></li>
      ${parishReliefPlan == null ? '' : `
      <li><span>Parish territories</span><span>${formatSettlementParishCoverage(parishReliefPlan)}</span></li>
      <li><span>Parish alms carts</span><span>${parishReliefPlan.activeAlmsTrips} active carrying ${parishReliefPlan.almsGoldInTransit.toFixed(2)} gold · ${parishReliefPlan.almsDueParishes} due / ${parishReliefPlan.almsBlockedParishes} blocked · ${parishReliefPlan.dailyAlmsRecipients} eligible poorest households</span></li>
      <li><span>Monday poor relief</span><span>${formatSettlementParishRelief(parishReliefPlan)}${parishReliefInspectButton}</span></li>`}
      <li><span>Fresh-food reserve</span><span>${provisioning.usableFoodStock.toFixed(1)} usable / ${provisioning.foodStock.toFixed(1)} owned · ${formatProvisionRunway(provisioning.foodRunwayDays)} with finite cured rotation · ${provisioning.totalFoodPerDay.toFixed(1)} fresh/day now from ${provisioning.grossFoodDemandPerDay.toFixed(1)} gross meal demand</span></li>
      <li><span>Cured ration displacement</span><span>${provisioning.householdPreservedFoodRotationPerDay.toFixed(1)} / ${provisioning.householdPreservedFoodRotationTargetPerDay.toFixed(1)} preserved/day currently staged in homes · ${provisioning.usablePreservedFoodStock.toFixed(1)} usable settlement-wide · every rotated unit removes one fresh-food unit from the same meal</span></li>
      <li><span>Road-branch provisions</span><span>${formatRoadProvisioning(provisioning.roadBranches)}</span></li>
      ${freshFoodPreservationRows}
      ${provisioning.displacedHouseholds > 0 ? `<li><span>Fire-displaced households</span><span>${provisioning.displacedHouseholds} ${provisioning.displacedHouseholds === 1 ? 'home' : 'homes'} · ${provisioning.displacedResidents} ${provisioning.displacedResidents === 1 ? 'resident' : 'residents'} excluded from consumption and delivery forecasts until recovery</span></li>` : ''}
      <li><span>Household delivery buffer</span><span>${formatHouseholdBufferReadiness(provisioning)}</span></li>
      <li><span>Fuel placement</span><span>${firewoodPlan.householdStock.toFixed(1)} in household cupboards &middot; ${firewoodPlan.distributorStock.toFixed(1)} at staffed lodges/storehouses &middot; ${firewoodPlan.industrialStock.toFixed(1)} staged inside hot workshops &middot; ${firewoodPlan.firewoodInTransit.toFixed(1)} on carts &middot; ${firewoodPlan.inactiveStock.toFixed(1)} inactive + ${firewoodPlan.quarantinedStock.toFixed(1)} fire-quarantined</span></li>
      <li><span>Protected hearth stock</span><span>${firewoodPlan.protectedHouseholdStock.toFixed(1)} / ${firewoodPlan.protectedHouseholdTarget.toFixed(1)} in cupboards &middot; ${firewoodPlan.householdsBelowProtectedStock} ${firewoodPlan.householdsBelowProtectedStock === 1 ? 'home' : 'homes'} below the ${RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS}-winter-day floor &middot; those homes preempt industrial fuel carts</span></li>
      <li><span>Fuel competition</span><span>${firewoodPlan.winterHouseholdDemandPerDay.toFixed(1)} winter hearths + ${firewoodPlan.industrialDemandPerDay.toFixed(1)} installed hot-work capacity = ${firewoodPlan.totalDemandPerDay.toFixed(1)} firewood/day &middot; staffed lodges sustain ${firewoodPlan.lodgeOutputCapacityPerDay.toFixed(1)}/day from ${firewoodPlan.lodgeTimberDrawPerDay.toFixed(1)} timber/day &middot; ${firewoodPlan.dailyMargin >= 0 ? '+' : ''}${firewoodPlan.dailyMargin.toFixed(1)}/day</span></li>
      <li><span>Fuel road branches</span><span>${firewoodPlan.distributors} staffed distributors across ${firewoodPlan.activeBranches} consuming branches &middot; ${firewoodPlan.flowDeficitBranches} production-short &middot; ${firewoodPlan.unservedBranches} without a distributor &middot; weakest combined runway ${formatProvisionRunway(firewoodPlan.worstBranchRunwayDays)}${firewoodInspectButton}</span></li>
      <li><span>Winter firewood</span><span>${Math.round(provisioning.usableFirewoodStock)} usable / ${Math.round(provisioning.firewoodStock)} owned · ${Math.ceil(provisioning.winterFirewoodNeed)} needed · ${formatProvisionRunway(provisioning.winterFirewoodRunwayDays)} of ${WINTER_RESERVE_DAYS}</span></li>
      ${provisioning.fireQuarantinedFirewoodStock > 0.05 ? `<li><span>Fire-quarantined fuel</span><span>${provisioning.fireQuarantinedFirewoodStock.toFixed(1)} firewood inaccessible until the damaged store or home recovers</span></li>` : ''}
      ${provisioning.sabbathObserved ? `<li><span>Sunday household stores</span><span>${formatSabbathReadiness(provisioning)}</span></li>` : ''}
      <li><span>Processing basis</span><span>${processingWeek}</span></li>
      ${productionFireOutageRow}
      ${prosperityHouseholdFireOutageRow}
      <li><span>Processor buffer basis</span><span>First staffed site to stop or fill · onsite stock plus carts that unload before depletion</span></li>
      <li><span>Mill buffers</span><span>Input ${formatProcessorInputBuffer(production.millInputBuffer)} · flour room ${formatProcessorOutputRoom(production.millOutputRoom)} ${processorInspectButton('mill', production.millInputBuffer, production.millOutputRoom)}</span></li>
      <li><span>Granary bakery buffers</span><span>Input ${formatProcessorInputBuffer(production.bakeryInputBuffer)} · food room ${formatProcessorOutputRoom(production.bakeryOutputRoom)} ${processorInspectButton('granary bakery', production.bakeryInputBuffer, production.bakeryOutputRoom)}</span></li>
      <li><span>Brewery buffers</span><span>Input ${formatProcessorInputBuffer(production.breweryInputBuffer)} · ale room ${formatProcessorOutputRoom(production.breweryOutputRoom)} ${processorInspectButton('brewery', production.breweryInputBuffer, production.breweryOutputRoom)}</span></li>
      <li><span>Smokehouse buffers</span><span>Input ${formatProcessorInputBuffer(production.smokehouseInputBuffer)} · preserved-food room ${formatProcessorOutputRoom(production.smokehouseOutputRoom)} ${processorInspectButton('smokehouse', production.smokehouseInputBuffer, production.smokehouseOutputRoom)}</span></li>
      <li><span>Weaver buffers</span><span>Input ${formatProcessorInputBuffer(production.weaverInputBuffer)} · cloth room ${formatProcessorOutputRoom(production.weaverOutputRoom)} ${processorInspectButton('weaver', production.weaverInputBuffer, production.weaverOutputRoom)}</span></li>
      <li><span>Charcoal-yard buffers</span><span>Input ${formatProcessorInputBuffer(production.charcoalInputBuffer)} &middot; charcoal room ${formatProcessorOutputRoom(production.charcoalOutputRoom)} ${processorInspectButton('charcoal yard', production.charcoalInputBuffer, production.charcoalOutputRoom)}</span></li>
      <li><span>Smithy buffers</span><span>Input ${formatProcessorInputBuffer(production.smithyInputBuffer)} &middot; ironwork room ${formatProcessorOutputRoom(production.smithyOutputRoom)} ${processorInspectButton('smithy', production.smithyInputBuffer, production.smithyOutputRoom)}</span></li>
      <li><span>Potter buffers</span><span>Input ${formatProcessorInputBuffer(production.potterInputBuffer)} &middot; pottery room ${formatProcessorOutputRoom(production.potterOutputRoom)} ${processorInspectButton('potter', production.potterInputBuffer, production.potterOutputRoom)}</span></li>
      <li><span>Processing labor</span><span>${production.millWorkers} mill · ${production.bakeryWorkers} granary · ${production.breweryWorkers} brewing · ${production.smokehouseWorkers} preserving · ${production.weaverWorkers} weaving</span></li>
      <li><span>Material-chain labor</span><span>${industrialMaterials.clayWorkers} clay &middot; ${industrialMaterials.potterWorkers} pottery &middot; ${industrialMaterials.charcoalWorkers} charcoal &middot; ${industrialMaterials.smithyWorkers} smithing</span></li>
      <li><span>Clay-bank conditions</span><span>${Math.round(industrialMaterials.clayBankYieldMultiplier * 100)}% average geological yield across active pits at regional abundance ${Math.round(context.worldResourceAbundance ?? 50)}/100 &times; ${Math.round(production.clayPitThroughputMultiplier * 100)}% current ${environment.weather} ground before tool condition${leanClayPitInspect} &middot; pits never hard-stop, but autumn clay reserves keep winter kilns productive</span></li>
      <li><span>Charcoal-clamp conditions</span><span>${Math.round(production.charcoalBurnerThroughputMultiplier * 100)}% current ${environment.weather} burn pace &middot; damp or frozen billets slow the shared forge-fuel bottleneck; drought dries the charge but also maximizes clamp fire danger</span></li>
      <li><span>Material-chain roads</span><span>${formatIndustrialRoads(industrialMaterials)}</span></li>
      <li><span>Pottery chain</span><span>${industrialMaterials.potteryOutputPerDay.toFixed(1)} road-supplied / ${industrialMaterials.potterInstalledOutputPerDay.toFixed(1)} installed pottery per day &middot; ${industrialMaterials.potteryCoveredDemandPerDay.toFixed(1)} / ${industrialMaterials.potteryDemandPerDay.toFixed(1)} household + smokehouse demand covered &middot; ${industrialMaterials.potteryExportSurplusPerDay.toFixed(1)} exportable and ${industrialMaterials.potteryStrandedPerDay.toFixed(1)} stranded surplus &middot; consumes ${industrialMaterials.potterClayPerDay.toFixed(1)} / ${industrialMaterials.clayOutputPerDay.toFixed(1)} clay capacity + ${industrialMaterials.potterFirewoodPerDay.toFixed(1)} firewood/day</span></li>
      <li><span>Ironwork chain</span><span>${industrialMaterials.ironworkOutputPerDay.toFixed(1)} road-supplied / ${industrialMaterials.smithyInstalledIronworkPerDay.toFixed(1)} installed ironwork per day &middot; needs ${industrialMaterials.smithyIronPerDay.toFixed(1)} raw iron + ${industrialMaterials.smithyCharcoalPerDay.toFixed(1)} / ${industrialMaterials.charcoalOutputPerDay.toFixed(1)} charcoal capacity &middot; local mines and market imports can supply iron &middot; charcoal yards consume ${industrialMaterials.charcoalFirewoodPerDay.toFixed(1)} firewood/day</span></li>
      <li><span>Civilian tool upkeep</span><span>${industrialMaterials.toolMaintainedSites} / ${industrialMaterials.toolEligibleSites} staffed heavy-tool sites equipped &middot; ${industrialMaterials.roadCoveredToolIronworkPerDay.toFixed(2)} / ${industrialMaterials.maintainedToolIronworkPerDay.toFixed(2)} current wear covered on the same road branches &middot; ${industrialMaterials.roadCoveredFullToolIronworkPerDay.toFixed(2)} / ${industrialMaterials.fullToolIronworkPerDay.toFixed(2)} if every active rack is maintained &middot; same-branch smithy surplus before carpentry ${industrialMaterials.ironworkSurplusAfterToolUpkeep.toFixed(2)}${unmaintainedToolInspect}</span></li>
      <li><span>Mill / bakery balance</span><span>${production.flourOutputPerDay.toFixed(1)} flour made / ${production.bakeryFlourCapacityPerDay.toFixed(1)} bakery intake · ${flourBalance}</span></li>
      <li><span>Grain-chain roads</span><span>${formatGrainChainRoads(production.grainChainRoads)}</span></li>
      <li><span>Bread capacity</span><span>${production.breadFoodCapacityPerDay.toFixed(1)} fresh food / day vs ${provisioning.totalFoodPerDay.toFixed(1)} current fresh demand after ${provisioning.householdPreservedFoodRotationPerDay.toFixed(1)} cured-ration displacement · gross meals remain ${provisioning.grossFoodDemandPerDay.toFixed(1)} / day · needs ${production.breadGrainPerDay.toFixed(1)} grain + ${production.breadWaterPerDay.toFixed(1)} water + ${production.breadFirewoodPerDay.toFixed(1)} firewood</span></li>
      <li><span>Ale capacity</span><span>${production.aleOutputPerDay.toFixed(1)} / day vs ${production.aleDemandPerDay.toFixed(1)} tier-3 demand · two workshop cycles per batch · needs ${production.aleBarleyPerDay.toFixed(1)} barley + ${production.aleWaterPerDay.toFixed(1)} water + ${production.aleFirewoodPerDay.toFixed(1)} firewood</span></li>
      <li><span>Preservation capacity</span><span>${production.preservedFoodOutputPerDay.toFixed(1)} / day installed · ${production.currentPreservedFoodDemandPerDay.toFixed(1)} / day current ${environment.season} ration at ${production.currentPreservedFoodDemandMultiplier.toFixed(2)}&times; · ${production.preservedFoodDemandPerDay.toFixed(1)} / day winter design peak · rotated rations displace the same fresh-food calories · full crews need ${production.preservationFreshFoodPerDay.toFixed(1)} fresh food + ${production.preservationFirewoodPerDay.toFixed(1)} firewood + ${production.preservationSaltPerDay.toFixed(1)} salt + ${production.preservationPotteryPerDay.toFixed(1)} pottery</span></li>
      ${preservationReserveRows}
      <li><span>Cloth capacity</span><span>${production.clothOutputPerDay.toFixed(1)} / day vs ${production.clothDemandPerDay.toFixed(1)} tier-3 demand · choose ${production.clothWoolPerDay.toFixed(1)} wool, or ${production.clothFlaxPerDay.toFixed(1)} flax + ${production.clothFlaxWaterPerDay.toFixed(1)} hauled water</span></li>
      <li><span>Household pottery</span><span>${production.potteryOutputPerDay.toFixed(1)} / day installed kiln output vs ${production.potteryDemandPerDay.toFixed(1)} tier-3 breakage replacement · homes share each kiln's physical cart with smokehouses and export</span></li>
      <li><span>Prosperity throughput</span><span>${formatProsperityCapacity(prosperity)}</span></li>
      <li><span>Prosperity roads</span><span>${formatProsperityRoads(prosperity.roadPlan)}</span></li>
      <li><span>Prosperous housing pipeline</span><span>${formatProsperityHousingPipeline(prosperity)} · assumes staffed workshops remain fully supplied</span></li>
      ${renderSettlementTextileRows(textilePlan)}
      ${renderSettlementSpecialtyExportRows(specialtyExportPlan)}
      ${renderSettlementGrainRows(grainPlan)}
      ${renderSettlementSeedProcurementRows(seedProcurement, farmPlan.firstSeedShortBuildingId)}
      ${monasteryHospitalityRow}
      ${farmPlanRows}
      ${centralGrainReserveRow}
      ${livestockFodderRows}
      ${frontierSecurityRows}
      ${armamentPlan === null ? '' : renderSettlementArmamentRows(armamentPlan)}
      ${provisioning.armedGuards > 0 ? `<li><span>Guardhouse food</span><span>${provisioning.guardFoodStock.toFixed(1)} on site · first shortfall ${formatProvisionRunway(provisioning.guardProvisionRunwayDays)}</span></li>
      <li><span>Ration reserves</span><span>${provisioning.guardFoodStock.toFixed(1)} / ${guardProvisionTarget.toFixed(1)} food target · ${leanReserveCompanies} lean · ${standardReserveCompanies} company · ${deepReserveCompanies} deep</span></li>
      <li><span>Guard wages</span><span>${provisioning.guardWagePerDay.toFixed(1)} gold / day · ${formatProvisionRunway(provisioning.guardWageRunwayDays)} across treasury, pay chests, and incoming carts</span></li>
      <li><span>Physical payroll</span><span>${payrollGoldOnsite.toFixed(1)} in company chests · ${payrollGoldInTransit.toFixed(1)} on treasury carts · ${context.resourceTotals.gold.toFixed(1)} still spendable at civic treasuries</span></li>
      <li><span>Civic cash priority</span><span>${
        context.gameState.physicalFoundingSiteEnabled === true
          ? `Residence-upgrade grants stay protected · ${payrollDispatch.reorderDueCompanies} ${payrollDispatch.reorderDueCompanies === 1 ? 'company' : 'companies'} below the pay-chest reorder point${payrollDispatch.inboundCompanies > 0 ? `, ${payrollDispatch.inboundCompanies} already receiving coin` : ''} · ${payrollDispatch.projectedCarts} reachable payroll ${payrollDispatch.projectedCarts === 1 ? 'cart claims' : 'carts claim'} ${payrollDispatch.projectedGold.toFixed(1)} gold before market reserve carts · ${payrollDispatch.remainingTreasuryGold.toFixed(1)} remains for market working cash${payrollDispatch.firstClaimBuildingId ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${payrollDispatch.firstClaimBuildingId}" aria-label="Inspect first guardhouse payroll cash claim">Inspect first claim</button>` : ''}`
          : 'Legacy treasury · direct spending follows simulation order'
      }</span></li>
      <li><span>Next-day payroll</span><span>${payrollGoldFunded.toFixed(1)} / ${payrollGoldDue.toFixed(1)} gold secured or treasury-funded${underfundedCompany ? ` · ${guardhousePayroll.filter((company) => company.fundedRatio < 0.999).length} companies at risk <button type="button" class="inspector-jump-button" data-inspect-building="${underfundedCompany.building.id}" aria-label="Inspect first underfunded guardhouse">Inspect</button>` : ' · all companies funded'}</span></li>
      ` : ''}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">The Town Hall sets the settlement-wide activity tax. Church and monastery policy remain at those buildings.</p>
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
        <h4 class="inspector-action-panel__title">Night orders</h4>
        <p class="inspector-action-panel__hint">Night is fully simulated. Homes eat an evening meal and burn heat, lamps consume stored firewood, stocked processors may continue, and watch, lighting, gatherings, and curfew shape rest, cohesion, theft, fire discovery, and night-raid warning. Active fights never stop at dawn or dusk.</p>
        <label class="city-admin-panel__slider-label" for="town-hall-night-watch"><span>Watch</span></label>
        <select class="inspector-policy-select" id="town-hall-night-watch" data-night-policy data-night-policy-watch ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${NIGHT_WATCH_OPTIONS.map((option) => `<option value="${option.value}" ${nightPolicy.watch === option.value ? 'selected' : ''} title="${option.hint}">${option.label}</option>`).join('')}
        </select>
        <label class="city-admin-panel__slider-label" for="town-hall-night-gathering"><span>Evening life</span></label>
        <select class="inspector-policy-select" id="town-hall-night-gathering" data-night-policy data-night-policy-gathering ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${NIGHT_GATHERING_OPTIONS.map((option) => `<option value="${option.value}" ${nightPolicy.gathering === option.value ? 'selected' : ''} title="${option.hint}">${option.label}</option>`).join('')}
        </select>
        <label class="city-admin-panel__slider-label" for="town-hall-night-work"><span>Production</span></label>
        <select class="inspector-policy-select" id="town-hall-night-work" data-night-policy data-night-policy-work ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${NIGHT_WORK_OPTIONS.map((option) => `<option value="${option.value}" ${nightPolicy.work === option.value ? 'selected' : ''} title="${option.hint}">${option.label}</option>`).join('')}
        </select>
        <label class="city-admin-panel__slider-label" for="town-hall-night-lighting"><span>Lighting</span></label>
        <select class="inspector-policy-select" id="town-hall-night-lighting" data-night-policy data-night-policy-lighting ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${NIGHT_LIGHTING_OPTIONS.map((option) => `<option value="${option.value}" ${nightPolicy.lighting === option.value ? 'selected' : ''} title="${option.hint}">${option.label}</option>`).join('')}
        </select>
        <label class="city-admin-panel__slider-label" for="town-hall-night-curfew"><span>Curfew</span></label>
        <select class="inspector-policy-select" id="town-hall-night-curfew" data-night-policy data-night-policy-curfew ${staffedTownHallAvailable ? '' : 'disabled'}>
          ${NIGHT_CURFEW_OPTIONS.map((option) => `<option value="${option.value}" ${nightPolicy.curfew === option.value ? 'selected' : ''} title="${option.hint}">${option.label}</option>`).join('')}
        </select>
        <p class="inspector-action-panel__hint"><strong>Dawn report:</strong> ${formatDawnReport(nightPolicy)}<br />Cohesion ${Math.round(nightPolicy.communityCohesion * 100)}% · fatigue ${Math.round(nightPolicy.laborFatigue * 100)}%.</p>
        ${!staffedTownHallAvailable ? '<p class="inspector-action-panel__hint">Assign a Town Hall clerk to post night orders.</p>' : ''}
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
        <p class="inspector-action-panel__hint">Deploy free labor to completed production sites that can accept work: workshops below their output ceiling, quarries with usable stone and yard room, open clay yards, and hunting halls with harvestable game above their reserve. High staffing priority fills before normal, then low; equal-priority sites share workers round-robin. This manual order may pre-staff an empty workshop in preparation for future carts. Existing crews are never displaced.${productionLaborStewardEnabled ? ' The daily steward is stricter and calls workshops only when every recipe input is present or already inbound.' : ' Future hiring remains manual.'}</p>
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
