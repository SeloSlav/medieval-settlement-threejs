import {
  DEFAULT_PRODUCTION_RATE_PERCENT,
  MAX_PRODUCTION_RATE_PERCENT,
  MIN_PRODUCTION_RATE_PERCENT,
  productionRatePlan,
} from '../../economy/productionRatePolicy.ts';
import type { BuildingState } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';

export function formatProductionIronworkPerYear(amount: number): string {
  return amount > 0 ? `≤ ${amount.toFixed(1)} / year` : '0 / year';
}

export function withBuildingProductionRate(
  view: InspectorView,
  building: BuildingState,
): InspectorView {
  const plan = productionRatePlan(building);
  if (!plan) return view;
  const effectiveness = `${Math.round(plan.throughputMultiplier * 100)}%`;
  const normalYearlyWear = productionRatePlan({
    ...building,
    productionRatePercent: DEFAULT_PRODUCTION_RATE_PERCENT,
  })?.ironworkPerYear ?? 0;
  const panel = `
    <div class="inspector-action-panel" data-inspector-panel-title="Maintenance">
      <input class="city-admin-panel__slider" type="range" data-production-rate-slider
        aria-label="Maintenance" aria-valuetext="${effectiveness} production effectiveness"
        data-ironwork-per-year-at-normal="${normalYearlyWear}"
        min="${MIN_PRODUCTION_RATE_PERCENT}" max="${MAX_PRODUCTION_RATE_PERCENT}" step="5" value="${plan.percent}" />
      <div class="city-admin-panel__slider-label">
        <span>Ironwork required</span>
        <strong data-production-rate-maintenance>${formatProductionIronworkPerYear(plan.ironworkPerYear)}</strong>
      </div>
      <div class="city-admin-panel__slider-label">
        <span>Production effectiveness</span>
        <strong data-production-rate-value>${effectiveness}</strong>
      </div>
    </div>
  `;
  return {
    ...view,
    supplementalPanelHtml: `${panel}${view.supplementalPanelHtml ?? ''}`,
  };
}
