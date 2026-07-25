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
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
} from '../../generated/gameBalance.ts';
import {
  formatFoodRunwayDays,
  residenceFoodRunwayDays,
} from '../../logistics/foodLogistics.ts';
import {
  formatSpecialtyRunwayDays,
  residenceAleRunwayDays,
  residencePreservedFoodRunwayDays,
} from '../../logistics/specialtyLogistics.ts';
import { formatWaterRunwayDays, residenceWaterRunwayDays } from '../../logistics/waterLogistics.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import { effectiveResidenceSettleTicks } from '../../economy/chapelCommunity.ts';
import { formatHouseholdWealth } from '../../economy/householdWealth.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
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
import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderResidenceInspector(
  target: Extract<InspectableTarget, { kind: 'residence' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, residenceCount } = target;
  const singleCost = residenceZoneCost(1);
  const singleRefund = residenceZoneSalvageRefund(1);
  const plotCost = residenceZoneCost(residenceCount);
  const plotRefund = residenceZoneSalvageRefund(residenceCount);
  const nearestRoad = context.worldQueries.getNearestRoadNodeDistance(residence.x, residence.z);
  const roadAccess = context.worldQueries.getRoadAccessLabel(residence.x, residence.z);
  const servingLodge = residence.tier >= 2
    ? context.worldQueries.getServingLodgeForResidence(residence)
    : null;
  const servingWell = residence.tier >= 2
    ? context.worldQueries.getServingWellForResidence(residence)
    : null;
  const servingFoodSupplier = context.worldQueries.getServingFoodSupplierForResidence(residence);
  const servingPreservedFoodSupplier = residence.tier >= 3
    ? context.worldQueries.getServingPreservedFoodSupplierForResidence(residence)
    : null;
  const servingAleSupplier = residence.tier >= 3
    ? context.worldQueries.getServingAleSupplierForResidence(residence)
    : null;
  const servingChapel = context.worldQueries.getServingChapelForResidence(residence);
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
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
    servingLodgeId: servingLodge?.id ?? null,
    servingWellId: servingWell?.id ?? null,
    servingFoodSupplierId: servingFoodSupplier?.id ?? null,
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
  const supplierLabel = (supplier: typeof servingLodge): string => {
    if (!supplier) return 'None on branch';
    const distance = context.worldQueries.getRoadPathDistance(
      residence.x,
      residence.z,
      supplier.x,
      supplier.z,
    );
    return `${context.worldQueries.getBuildingLabel(supplier.kind)} · ${formatDeliveryRoadDistance(distance)}`;
  };
  const lodgeLabel = supplierLabel(servingLodge);
  const wellLabel = supplierLabel(servingWell);
  const foodSupplierLabel = supplierLabel(servingFoodSupplier);
  const preservedFoodSupplierLabel = supplierLabel(servingPreservedFoodSupplier);
  const aleSupplierLabel = supplierLabel(servingAleSupplier);
  const capacity = residence.populationCapacity;
  const settlersRemaining = Math.max(0, capacity - residence.population);
  const settleTicks = effectiveResidenceSettleTicks(
    community.hasChapelAccess,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const settleEtaSeconds = settlersRemaining > 0
    ? Math.max(
        1,
        Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
      )
    : null;
  const activeNeedsLabel = activeResidenceNeedKinds(residence.tier)
    .map((kind) => kind === 'preservedFood' ? 'preserved food' : kind)
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
      <li><span>Active needs</span><span>${activeNeedsLabel}</span></li>
      <li><span>Household wealth</span><span>${formatHouseholdWealth(residence.householdWealth)}</span></li>
      ${parishEconomy.hasChapelAccess
        ? `<li><span>Parish tithe</span><span>~${parishEconomy.tithePerDay.toFixed(1)} gold / day when attending (${parishEconomy.attendancePercent}% chance${parishEconomy.wealthLimited ? ', wealth-limited' : ''}) → chapel coffer</span></li>`
        : ''}
      ${settleEtaSeconds != null && !residence.abandoned
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — next in ~${formatSettleEta(settleEtaSeconds)}</span></li>`
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
      <li><span>Serving food supplier</span><span>${foodSupplierLabel}</span></li>
      ${residence.tier >= 2 ? `<li><span>Serving lodge</span><span>${lodgeLabel}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li><span>Serving well</span><span>${wellLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Preserved food supplier</span><span>${preservedFoodSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li><span>Ale supplier</span><span>${aleSupplierLabel}</span></li>` : ''}
      <li><span>Chapel link</span><span>${community.hasChapelAccess ? 'Staffed parish on the road' : 'None on branch'}</span></li>
      <li><span>Monastery coverage</span><span>${community.hasMonasteryCoverage ? 'Linked Pauline house within parish radius' : 'None'}</span></li>
      <li><span>Road access</span><span>${roadAccess}</span></li>
      <li><span>Build cost</span><span>${formatBuildingCost(singleCost)}</span></li>
      <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Remove residence',
      hint: `Salvages about ${singleRefund.timber} timber and ${singleRefund.stone} stone (${Math.round(STONE_SALVAGE_FRACTION * 100)}% timber, ${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone of ${formatBuildingCost(singleCost)}).`,
      secondary: residenceCount > 1
        ? {
            label: 'Remove entire plot',
            hint: `Removes all ${residenceCount} residences and salvages about ${plotRefund.timber} timber and ${plotRefund.stone} stone (${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone, ${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber of ${formatBuildingCost(plotCost)}).`,
          }
        : undefined,
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: residence.tier < 3 ? residenceUpgradePanel(residence.tier) : '<p class="resource-inspector-note">This household has reached tier 3.</p>',
  };
}

function residenceUpgradePanel(tier: 1 | 2 | 3): string {
  const next = tier + 1;
  const costs = tier === 1
    ? [RESIDENCE_TIER2_TIMBER_COST, RESIDENCE_TIER2_STONE_COST, RESIDENCE_TIER2_GOLD_COST]
    : [RESIDENCE_TIER3_TIMBER_COST, RESIDENCE_TIER3_STONE_COST, RESIDENCE_TIER3_GOLD_COST];
  const requirement = tier === 1
    ? "Adds firewood and water needs. Requires a road-linked woodcutter's lodge and well."
    : 'Adds preserved food and ale needs. Requires both road-linked suppliers; a monastery can serve both.';
  return `<button type="button" class="resource-action-button" data-action="upgrade-residence">Upgrade to tier ${next}</button><p class="resource-inspector-note">${costs[0]} timber · ${costs[1]} stone · ${costs[2]} gold. ${requirement}</p>`;
}

function formatSettleEta(seconds: number): string {
  if (seconds >= 120) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  return `${Math.max(1, Math.round(seconds))}s`;
}
