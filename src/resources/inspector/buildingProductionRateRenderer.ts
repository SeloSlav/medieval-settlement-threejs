import {
  MAX_PRODUCTION_RATE_PERCENT,
  MIN_PRODUCTION_RATE_PERCENT,
  productionRatePlan,
} from '../../economy/productionRatePolicy.ts';
import { renderResourceAmount } from '../../ui/resourceCost.ts';
import type { BuildingState } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';

function formatRateMultiplier(multiplier: number): string {
  return multiplier === 0
    ? 'Paused'
    : `${multiplier.toFixed(multiplier % 1 === 0 ? 0 : 1)}× pace`;
}

function formatMaintenanceMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(multiplier % 1 === 0 ? 0 : 2)}× upkeep`;
}

export function withBuildingProductionRate(
  view: InspectorView,
  building: BuildingState,
): InspectorView {
  const plan = productionRatePlan(building);
  if (!plan) return view;
  const yearlyWear = renderResourceAmount('ironwork', plan.ironworkPerYear, {
    compact: true,
    suffix: '/year maximum at current roster',
  });
  const perWorkerWear = renderResourceAmount('ironwork', plan.ironworkPerWorkerYear, {
    compact: true,
    suffix: '/worker-year',
  });
  const normalYearlyWear = productionRatePlan({
    ...building,
    productionRatePercent: 50,
  })?.ironworkPerYear ?? 0;
  const panel = `
    <div class="inspector-action-panel" data-inspector-panel-title="Production rate">
      <label class="city-admin-panel__slider-label">
        <span>Production rate</span>
        <strong data-production-rate-value>${plan.percent}% · ${formatRateMultiplier(plan.throughputMultiplier)} · ${formatMaintenanceMultiplier(plan.maintenanceMultiplier)}</strong>
      </label>
      <input class="city-admin-panel__slider" type="range" data-production-rate-slider
        data-ironwork-per-year-at-normal="${normalYearlyWear}"
        min="${MIN_PRODUCTION_RATE_PERCENT}" max="${MAX_PRODUCTION_RATE_PERCENT}" step="5" value="${plan.percent}" />
      <div class="city-admin-panel__range-hints"><span>Paused</span><span>50% · normal</span><span>100% · 2× pace / 4× upkeep</span></div>
      <p class="inspector-action-panel__hint" data-production-rate-maintenance>
        Ironwork upkeep: ${yearlyWear} · ${perWorkerWear}. Upkeep scales with pace squared; actual consumption follows completed work, so blocked, empty, unstaffed, seasonal, and full sites wear less.
      </p>
    </div>
  `;
  return {
    ...view,
    supplementalPanelHtml: `${panel}${view.supplementalPanelHtml ?? ''}`,
  };
}
