import {
  ECONOMIC_ACTIVITY_TAX_RATE_MAX,
  ECONOMIC_ACTIVITY_TAX_RATE_MIN,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { buildVillageAdminReadout } from '../../economy/villageAdminReadout.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderTownHallInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const staffed = building.assignedLabor > 0;
  const taxRate = context.getEconomicActivityTaxRate?.() ?? 0;
  const readout = buildVillageAdminReadout({
    gameState: context.gameState,
    worldQueries: context.worldQueries,
    taxRate,
    parishPolicy: context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY,
  });
  const collectionRate = staffed ? 100 : Math.round(TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER * 100);

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
    `,
  };
}
