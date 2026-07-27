import {
  formatBuildingCost,
  residenceZoneCost,
  residenceZoneSalvageRefund,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
} from '../buildingEconomy.ts';
import {
  formatFirewoodRunwayDays,
  RESIDENCE_WATER_CAPACITY,
  residenceFirewoodRunwayDays,
  SIM_TICK_SECONDS,
} from '../resourceTotals.ts';
import {
  RESIDENCE_ALE_CAPACITY,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
} from '../../generated/gameBalance.ts';
import {
  formatFoodRunwayDays,
  residenceFoodRunwayDays,
} from '../../logistics/foodLogistics.ts';
import {
  formatSpecialtyRunwayDays,
  residenceAleRunwayDays,
  residenceClothRunwayDays,
  residencePreservedFoodRunwayDays,
} from '../../logistics/specialtyLogistics.ts';
import { formatWaterRunwayDays, residenceWaterRunwayDays } from '../../logistics/waterLogistics.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import { effectiveResidenceSettleTicks } from '../../economy/chapelCommunity.ts';
import { formatHouseholdWealth } from '../../economy/householdWealth.ts';
import {
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketResidenceStatus,
} from '../../economy/settlementHouseholdMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../../economy/regionalMarket.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { residenceSettlementReadiness } from '../../economy/residenceSettlement.ts';
import {
  evaluateResidenceUpgrade,
  type ResidenceUpgradePlan,
  type ResidenceUpgradeServiceKind,
} from '../../economy/residenceUpgrade.ts';
import {
  computeSettlementProsperityPlan,
  projectTierThreeUpgrade,
  type SettlementProsperityPlan,
  type TierThreeUpgradeProjection,
} from '../../economy/settlementProsperity.ts';
import { productionRoadBranchKey } from '../../economy/settlementProduction.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import {
  buildResidenceCommunityContext,
  buildResidenceParishEconomyView,
} from '../../economy/economyInspectorViews.ts';
import {
  RESIDENCE_FIREWOOD_CAPACITY,
  activeResidenceNeedKinds,
  residenceNeedsStatus,
  getNeedStock,
} from '../../residences/residenceNeeds.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderResidenceInspector(
  target: Extract<InspectableTarget, { kind: 'residence' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, residenceCount } = target;
  const fireDisabled = fireForTarget(
    context.gameState.fireIncidents.values(),
    'residence',
    residence.id,
  ) !== null;
  const intactPlotResidenceCount = Array.from(context.gameState.residences.values()).filter(
    (candidate) =>
      candidate.zoneId === zone.id
      && fireForTarget(
        context.gameState.fireIncidents.values(),
        'residence',
        candidate.id,
      ) === null,
  ).length;
  const singleCost = residenceZoneCost(1);
  const singleRefund = residenceZoneSalvageRefund(1);
  const plotRefund = residenceZoneSalvageRefund(intactPlotResidenceCount);
  const nearestRoad = context.worldQueries.getNearestRoadNodeDistance(residence.x, residence.z);
  const roadAccess = context.worldQueries.getRoadAccessLabel(residence.x, residence.z);
  const servingFirewoodSupplier =
    context.worldQueries.getServingFirewoodSupplierForResidence(residence);
  const servingWell = context.worldQueries.getServingWellForResidence(residence);
  const servingFoodSupplier = context.worldQueries.getServingFoodSupplierForResidence(residence);
  const servingPreservedFoodSupplier = residence.tier >= 2
    ? context.worldQueries.getServingPreservedFoodSupplierForResidence(residence)
    : null;
  const servingAleSupplier = residence.tier >= 2
    ? context.worldQueries.getServingAleSupplierForResidence(residence)
    : null;
  const servingClothSupplier = residence.tier >= 2
    ? context.worldQueries.getServingClothSupplierForResidence(residence)
    : null;
  const preservedFoodUpgradeSupplier = residence.tier === 2
    ? servingPreservedFoodSupplier
      ?? context.worldQueries.getPreservedFoodUpgradeSupplierForResidence(residence)
    : servingPreservedFoodSupplier;
  const aleUpgradeSupplier = residence.tier === 2
    ? servingAleSupplier
      ?? context.worldQueries.getAleUpgradeSupplierForResidence(residence)
    : servingAleSupplier;
  const clothUpgradeSupplier = residence.tier === 2
    ? servingClothSupplier
      ?? context.worldQueries.getClothUpgradeSupplierForResidence(residence)
    : servingClothSupplier;
  const upgradePlan = evaluateResidenceUpgrade(
    residence,
    context.resourceTotals,
    {
      firewood: {
        supplier: servingFirewoodSupplier,
        stocked: upgradeSupplierHasStock('firewood', servingFirewoodSupplier),
      },
      water: {
        supplier: servingWell,
        stocked: upgradeSupplierHasStock('water', servingWell),
      },
      preservedFood: {
        supplier: preservedFoodUpgradeSupplier,
        stocked: servingPreservedFoodSupplier != null,
      },
      ale: {
        supplier: aleUpgradeSupplier,
        stocked: servingAleSupplier != null,
      },
      cloth: {
        supplier: clothUpgradeSupplier,
        stocked: servingClothSupplier != null,
      },
    },
    { fireDisabled },
  );
  const prosperityPlan = !fireDisabled
    && upgradePlan?.nextTier === 3
    && context.settlementProduction
    ? computeSettlementProsperityPlan(context.settlementProduction)
    : null;
  const prosperityRoadKey = prosperityPlan?.roadPlan
    && typeof context.worldQueries.getRoadComponentId === 'function'
    ? productionRoadBranchKey(
        context.worldQueries.getRoadComponentId(residence.x, residence.z),
        'residence',
        residence.id,
      )
    : undefined;
  const tierThreeProjection = prosperityPlan && upgradePlan?.nextTier === 3
    ? projectTierThreeUpgrade(
        prosperityPlan,
        residence,
        upgradePlan.populationCapacity,
        prosperityRoadKey,
      )
    : null;
  const servingChapel = context.worldQueries.getServingChapelForResidence(residence);
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const householdMarketPlan = typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
    ? computeSettlementHouseholdMarketPlan({
        state: context.gameState,
        marketState: context.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE,
        roadNetwork: context.worldQueries.getRoadNetworkSnapshot(),
        clock: gameClock(context.gameState.tick),
        sabbathObserved: parishPolicy.sabbathObservanceEnabled
          && settlementHasStaffedChapel(context.gameState),
        residenceIds: new Set([residence.id]),
      })
    : null;
  const householdMarket = householdMarketPlan?.residences.get(residence.id) ?? null;
  const householdMarketplace = householdMarket?.marketplaceId == null
    ? null
    : context.gameState.buildings.get(householdMarket.marketplaceId) ?? null;
  const householdMarketplaceLabel = householdMarketplace == null
    ? 'marketplace'
    : `${context.worldQueries.getBuildingLabel(householdMarketplace.kind)}${
        householdMarket?.roadDistance == null
          ? ''
          : ` (${formatDeliveryRoadDistance(householdMarket.roadDistance)})`
      }`;
  const householdMarketStatus = householdMarketPlan == null
    ? 'Route projection unavailable'
    : formatHouseholdMarketResidenceStatus(
        householdMarket,
        householdMarketplaceLabel,
      );
  const hasMonasteryCoverage = context.worldQueries.isResidenceInMonasteryCoverage(residence);
  const community = buildResidenceCommunityContext(
    servingChapel,
    parishPolicy,
    hasMonasteryCoverage,
  );
  const parishEconomy = buildResidenceParishEconomyView(
    residence,
    servingChapel,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const needs = residenceNeedsStatus(residence, {
    servingLodgeId: servingFirewoodSupplier?.id ?? null,
    servingWellId: servingWell?.id ?? null,
    servingFoodSupplierId: servingFoodSupplier?.id ?? null,
    servingPreservedFoodSupplierId: servingPreservedFoodSupplier?.id ?? null,
    servingAleSupplierId: servingAleSupplier?.id ?? null,
    servingClothSupplierId: servingClothSupplier?.id ?? null,
  }, community);
  const runwayDays = residence.tier >= 2 ? residenceFirewoodRunwayDays(residence) : null;
  const firewoodRunwayLabel = runwayDays == null
    ? '—'
    : formatFirewoodRunwayDays(runwayDays);
  const waterRunwayDays = residence.tier >= 2 ? residenceWaterRunwayDays(residence) : null;
  const waterRunwayLabel = waterRunwayDays == null
    ? '—'
    : formatWaterRunwayDays(waterRunwayDays);
  const foodRunwayDays = residenceFoodRunwayDays(residence);
  const foodRunwayLabel = foodRunwayDays == null
    ? '—'
    : formatFoodRunwayDays(foodRunwayDays);
  const preservedFoodRunwayDays = residence.tier >= 3 ? residencePreservedFoodRunwayDays(residence) : null;
  const preservedFoodRunwayLabel = preservedFoodRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(preservedFoodRunwayDays);
  const aleRunwayDays = residence.tier >= 3 ? residenceAleRunwayDays(residence) : null;
  const aleRunwayLabel = aleRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(aleRunwayDays);
  const clothRunwayDays = residence.tier >= 3 ? residenceClothRunwayDays(residence) : null;
  const clothRunwayLabel = clothRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(clothRunwayDays);
  const supplierLabel = (supplier: typeof servingFirewoodSupplier): string => {
    if (!supplier) return 'None on branch';
    const distance = context.worldQueries.getRoadPathDistance(
      residence.x,
      residence.z,
      supplier.x,
      supplier.z,
    );
    return `${context.worldQueries.getBuildingLabel(supplier.kind)} · ${formatDeliveryRoadDistance(distance)}`;
  };
  const firewoodSupplierLabel = supplierLabel(servingFirewoodSupplier);
  const wellLabel = supplierLabel(servingWell);
  const foodSupplierLabel = supplierLabel(servingFoodSupplier);
  const preservedFoodSupplierLabel = supplierLabel(servingPreservedFoodSupplier);
  const aleSupplierLabel = supplierLabel(servingAleSupplier);
  const clothSupplierLabel = supplierLabel(servingClothSupplier);
  const capacity = residence.populationCapacity;
  const settlersRemaining = Math.max(0, capacity - residence.population);
  const settlementReadiness = residenceSettlementReadiness(residence, community);
  const settleTicks = effectiveResidenceSettleTicks(
    community.hasChapelAccess,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const settleEtaSeconds = settlersRemaining > 0
    && settlementReadiness.ready
    && !fireDisabled
    ? Math.max(
        1,
        Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
      )
    : null;
  const activeNeedsLabel = activeResidenceNeedKinds(residence.tier)
    .map((kind) =>
      kind === 'preservedFood'
        ? 'preserved food'
        : kind === 'cloth'
          ? 'household textiles'
          : kind
    )
    .join(', ');

  return {
    eyebrow: 'Residence',
    title: residence.abandoned
      ? 'Abandoned residence'
      : residenceCount === 1
        ? 'Residence'
        : `Residence plot (${residenceCount} residences)`,
    statusText: needs.label,
    statusState: needs.state,
    detailsHtml: `
      <li><span>Plots</span><span>${zone.plotCount}</span></li>
      <li><span>Residences</span><span>${residenceCount}</span></li>
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1}</span></li>
      <li><span>Population</span><span>${residence.abandoned ? 0 : residence.population} / ${capacity}</span></li>
      <li><span>House tier</span><span>${residence.tier} / 3</span></li>
      ${upgradePlan ? residenceUpgradeRows(upgradePlan, context.worldQueries.getBuildingLabel.bind(context.worldQueries)) : ''}
      ${prosperityPlan && tierThreeProjection
        ? residenceProsperityRows(prosperityPlan, tierThreeProjection)
        : ''}
      <li><span>Active needs</span><span>${activeNeedsLabel}</span></li>
      <li><span>Household wealth</span><span>${formatHouseholdWealth(residence.householdWealth)}</span></li>
      <li><span>Emergency market</span><span>${householdMarketStatus}</span></li>
      <li><span>Standing-order rule</span><span>At 18h food or active water runway - food first - household-funded full lot</span></li>
      ${fireDisabled
        ? '<li><span>Parish economy</span><span>Paused · no tithe, alms, or relief claim until structural recovery</span></li>'
        : parishEconomy.hasChapelAccess
          ? `<li><span>Parish tithe</span><span>~${parishEconomy.tithePerDay.toFixed(1)} gold / day when attending (${parishEconomy.attendancePercent}% chance${parishEconomy.wealthLimited ? ', wealth-limited' : ''}) → chapel coffer</span></li>`
          : ''}
      ${settleEtaSeconds != null && !residence.abandoned
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — next in ~${formatSettleEta(settleEtaSeconds)}</span></li>`
        : ''}
      ${settlersRemaining > 0
        && !residence.abandoned
        && !fireDisabled
        && !settlementReadiness.ready
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — paused for ${formatSettlementWait(settlementReadiness.waitingOn)}</span></li>`
        : ''}
      ${settlersRemaining > 0 && !residence.abandoned && fireDisabled
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — structural recovery required before settlement resumes</span></li>`
        : ''}
      <li><span>Food stock</span><span>${Math.round(getNeedStock(residence.needs, 'food'))} / ${RESIDENCE_FOOD_CAPACITY}</span></li>
      <li><span>Food runway</span><span>${foodRunwayLabel}</span></li>
      ${residence.tier >= 2 ? `<li><span>Firewood stock</span><span>${Math.round(getNeedStock(residence.needs, 'firewood'))} / ${RESIDENCE_FIREWOOD_CAPACITY}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li><span>Firewood runway</span><span>${firewoodRunwayLabel}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li><span>Water stock</span><span>${Math.round(getNeedStock(residence.needs, 'water'))} / ${RESIDENCE_WATER_CAPACITY}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li><span>Water runway</span><span>${waterRunwayLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Preserved food</span><span>${Math.round(getNeedStock(residence.needs, 'preservedFood'))} / ${RESIDENCE_PRESERVED_FOOD_CAPACITY}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Preserved food runway</span><span>${preservedFoodRunwayLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Ale</span><span>${Math.round(getNeedStock(residence.needs, 'ale'))} / ${RESIDENCE_ALE_CAPACITY}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Ale runway</span><span>${aleRunwayLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Household textiles</span><span>${Math.round(getNeedStock(residence.needs, 'cloth'))} / ${RESIDENCE_CLOTH_CAPACITY}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Textile runway</span><span>${clothRunwayLabel}</span></li>` : ''}
      <li><span>Serving food supplier</span><span>${foodSupplierLabel}</span></li>
      ${residence.tier >= 2 ? `<li><span>Firewood supplier</span><span>${firewoodSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li><span>Serving well</span><span>${wellLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Preserved food supplier</span><span>${preservedFoodSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Ale supplier</span><span>${aleSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Cloth supplier</span><span>${clothSupplierLabel}</span></li>` : ''}
      <li><span>Chapel link</span><span>${community.hasChapelAccess ? 'Staffed parish on the road' : 'None on branch'}</span></li>
      <li><span>Monastery coverage</span><span>${community.hasMonasteryCoverage ? 'Linked Pauline house within parish radius' : 'None'}</span></li>
      <li><span>Road access</span><span>${roadAccess}</span></li>
      <li><span>Build cost</span><span>${formatBuildingCost(singleCost)}</span></li>
      <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Remove residence',
      hint: fireDisabled
        ? 'Removes this fire-damaged residence. Its structural material is no longer recoverable.'
        : `Leaves about ${singleRefund.timber} timber and ${singleRefund.stone} stone at this cottage footprint (${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber, ${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone of ${formatBuildingCost(singleCost)}). A free hauler must cart it to connected storage before the footprint clears.`,
      secondary: residenceCount > 1
        ? {
            label: 'Remove entire plot',
            hint: `Removes all ${residenceCount} residences and leaves ${intactPlotResidenceCount} separate reclamation ${intactPlotResidenceCount === 1 ? 'pile' : 'piles'} with about ${plotRefund.timber} timber and ${plotRefund.stone} stone total. Fire-damaged cottages yield nothing; every intact footprint remains occupied until free haulers reach connected storage.`,
          }
        : undefined,
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: upgradePlan
      ? residenceUpgradePanel(upgradePlan, prosperityPlan, tierThreeProjection)
      : '<p class="resource-inspector-note">This household has reached tier 3.</p>',
  };
}

function residenceUpgradeRows(
  plan: ResidenceUpgradePlan,
  buildingLabel: (kind: BuildingState['kind']) => string,
): string {
  const services = plan.services.map((service) =>
    `${service.label}: ${service.supplier
      ? `${buildingLabel(service.supplier.kind)} route${service.stocked ? '' : ' · currently empty'}`
      : 'missing'}`,
  ).join(' · ');
  const resources = plan.resources.map(
    (resource) =>
      `${resource.label} ${formatUpgradeAmount(resource.available)} / ${formatUpgradeAmount(resource.required)}`,
  ).join(' · ');
  return `
    <li><span>Tier ${plan.nextTier} services</span><span>${services}</span></li>
    <li><span>Upgrade resources</span><span>${resources}</span></li>
  `;
}

function residenceProsperityRows(
  plan: SettlementProsperityPlan,
  projection: TierThreeUpgradeProjection,
): string {
  const immediateStatus = projection.immediateSustainable
    ? `${projection.immediateHeadroomResidents} resident capacity remains`
    : `short capacity for ${Math.abs(projection.immediateHeadroomResidents)} residents`;
  const usableCapacity = plan.roadPlan?.roadMatchedResidentCapacity
    ?? plan.installedResidentCapacity;
  const localCapacity = projection.immediateResidents
    + projection.immediateHeadroomResidents;
  const localCurrentResidents = projection.immediateResidents
    - projection.occupantsPromotedNow;
  return `
    <li><span>Settlement prosperity</span><span>${plan.currentResidents} / ${usableCapacity} road-matched residents at installed capacity${plan.roadPlan && plan.roadPlan.fragmentationResidentCapacity > 0 ? ` · ${plan.roadPlan.fragmentationResidentCapacity} capacity split between branches` : ''} · assumes fully supplied staffed workshops</span></li>
    ${projection.roadBranchScoped ? `<li><span>Local prosperity branch</span><span>${localCurrentResidents} current / ${localCapacity} resident capacity · ${projection.limitingLabel} limited</span></li>` : ''}
    <li><span>Promotion load</span><span>+${projection.occupantsPromotedNow} prosperous consumers now · +${projection.targetHouseCapacity} with this house full · ${immediateStatus}</span></li>
    <li><span>Immediate daily demand</span><span>+${projection.immediateDemand.preservedFood.toFixed(2)} preserved food · +${projection.immediateDemand.ale.toFixed(2)} ale · +${projection.immediateDemand.cloth.toFixed(3)} cloth</span></li>
  `;
}

function residenceUpgradePanel(
  plan: ResidenceUpgradePlan,
  prosperity: SettlementProsperityPlan | null,
  projection: TierThreeUpgradeProjection | null,
): string {
  const status = plan.ready
    ? `Ready · adds ${plan.addedCapacity} resident capacity (${plan.populationCapacity} total) · ${plan.addedNeeds.toLowerCase()}.`
    : `Blocked · ${plan.blockers.join(' · ')}.`;
  const guidance = plan.nextTier === 2
    ? "Firewood needs a staffed lodge or accepting storehouse; water needs a staffed road-linked well whose service radius reaches this home."
    : 'Preserved food needs a staffed smokehouse or pastoral holding; ale needs a staffed brewhouse or parish-linked monastery; household textiles need a staffed weaver.';
  const throughput = prosperity && projection
    ? projection.immediateSustainable
      ? projection.fullPipelineSustainable
        ? ` Installed capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'} can sustain the current occupants and this house at full occupancy; ${projection.limitingLabel} is the tightest chain.`
        : ` Current occupants fit, but filling this house would exceed installed ${projection.limitingLabel} capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'}.`
      : ` Warning: promoting the current occupants immediately exceeds installed ${projection.limitingLabel} capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'} by ${Math.abs(projection.immediateHeadroomResidents)} residents.`
    : '';
  return `<button type="button" class="resource-action-button" data-action="upgrade-residence" ${plan.ready ? '' : 'disabled'}>Upgrade to tier ${plan.nextTier}</button><p class="resource-inspector-note">${status}${throughput} ${guidance}</p>`;
}

function upgradeSupplierHasStock(
  kind: ResidenceUpgradeServiceKind,
  supplier: BuildingState | null,
): boolean {
  if (!supplier) return false;
  if (kind === 'firewood') return supplier.firewood > 1e-6;
  if (kind === 'water') return supplier.water > 1e-6;
  if (kind === 'preservedFood') return supplier.preservedFood > 1e-6;
  if (kind === 'ale') return supplier.ale > 1e-6;
  return (supplier.cloth ?? 0) > 1e-6;
}

function formatUpgradeAmount(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
}

function formatSettleEta(seconds: number): string {
  if (seconds >= 120) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  return `${Math.max(1, Math.round(seconds))}s`;
}

function formatSettlementWait(
  waitingOn: ReturnType<typeof residenceSettlementReadiness>['waitingOn'],
): string {
  return waitingOn.map(
    (buffer) =>
      `${buffer.label} ${formatUpgradeAmount(buffer.stock)} / ${formatUpgradeAmount(buffer.required)}`,
  ).join(' · ');
}
