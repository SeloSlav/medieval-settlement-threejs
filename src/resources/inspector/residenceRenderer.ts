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
import { effectiveResidenceSettleTicks } from '../../economy/chapelCommunity.ts';
import { formatHouseholdWealth } from '../../economy/householdWealth.ts';
import { buildResidenceParishEconomyView } from '../../economy/economyInspectorViews.ts';
import {
  RESIDENCE_FIREWOOD_CAPACITY,
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
  const servingLodge = context.worldQueries.getServingLodgeForResidence(residence);
  const servingWell = context.worldQueries.getServingWellForResidence(residence);
  const servingFoodSupplier = context.worldQueries.getServingFoodSupplierForResidence(residence);
  const servingChapel = context.worldQueries.getServingChapelForResidence(residence);
  const community = {
    hasChapelAccess: servingChapel != null,
  };
  const parishEconomy = buildResidenceParishEconomyView(residence, servingChapel);
  const needs = residenceNeedsStatus(residence, {
    servingLodgeId: servingLodge?.id ?? null,
    servingWellId: servingWell?.id ?? null,
    servingFoodSupplierId: servingFoodSupplier?.id ?? null,
  }, community);
  const runwayDays = residenceFirewoodRunwayDays(residence);
  const firewoodRunwayLabel = runwayDays == null
    ? '—'
    : formatFirewoodRunwayDays(runwayDays);
  const lodgeLabel = servingLodge
    ? context.worldQueries.getBuildingLabel(servingLodge.kind)
    : 'None on branch';
  const wellLabel = servingWell
    ? context.worldQueries.getBuildingLabel(servingWell.kind)
    : 'None on branch';
  const capacity = residence.populationCapacity;
  const settlersRemaining = Math.max(0, capacity - residence.population);
  const settleTicks = effectiveResidenceSettleTicks(community.hasChapelAccess);
  const settleEtaSeconds = settlersRemaining > 0
    ? Math.max(
        1,
        Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
      )
    : null;

  return {
    eyebrow: 'Residence',
    title: residence.abandoned
      ? getNeedStock(residence.needs, 'firewood') > 0
        ? 'Abandoned residence — restocking'
        : 'Abandoned residence'
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
      <li><span>Household wealth</span><span>${formatHouseholdWealth(residence.householdWealth)}</span></li>
      ${parishEconomy.hasChapelAccess
        ? `<li><span>Parish tithe</span><span>~${parishEconomy.tithePerDay.toFixed(1)} gold / day when attending (${parishEconomy.attendancePercent}% chance${parishEconomy.wealthLimited ? ', wealth-limited' : ''}) → chapel coffer</span></li>`
        : ''}
      ${settleEtaSeconds != null && !residence.abandoned
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — next in ~${formatSettleEta(settleEtaSeconds)}</span></li>`
        : ''}
      <li><span>Firewood stock</span><span>${Math.round(getNeedStock(residence.needs, 'firewood'))} / ${RESIDENCE_FIREWOOD_CAPACITY}</span></li>
      <li><span>Firewood runway</span><span>${firewoodRunwayLabel}</span></li>
      <li><span>Water stock</span><span>${Math.round(getNeedStock(residence.needs, 'water'))} / ${RESIDENCE_WATER_CAPACITY}</span></li>
      <li><span>Serving lodge</span><span>${lodgeLabel}</span></li>
      <li><span>Serving well</span><span>${wellLabel}</span></li>
      <li><span>Chapel link</span><span>${community.hasChapelAccess ? 'Staffed parish on the road' : 'None on branch'}</span></li>
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
  };
}

function formatSettleEta(seconds: number): string {
  if (seconds >= 120) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  return `${Math.max(1, Math.round(seconds))}s`;
}
