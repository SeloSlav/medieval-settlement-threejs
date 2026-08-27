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
  const normalYearlyWear = plan.throughputMultiplier > 1e-9
    ? plan.ironworkPerYear / plan.throughputMultiplier
    : plan.ironworkPerWorkerYear * Math.max(0, building.assignedLabor);
  const panel = `
    <div class="inspector-action-panel" data-inspector-panel-title="Production rate">
      <label class="city-admin-panel__slider-label">
        <span>Production rate</span>
        <strong data-production-rate-value>${plan.percent}% · ${formatRateMultiplier(plan.throughputMultiplier)}</strong>
      </label>
      <input class="city-admin-panel__slider" type="range" data-production-rate-slider
        data-ironwork-per-year-at-normal="${normalYearlyWear}"
        min="${MIN_PRODUCTION_RATE_PERCENT}" max="${MAX_PRODUCTION_RATE_PERCENT}" step="5" value="${plan.percent}" />
      <div class="city-admin-panel__range-hints"><span>Paused</span><span>50% · normal</span><span>100% · double</span></div>
      <p class="inspector-action-panel__hint" data-production-rate-maintenance>
        Ironwork upkeep: ${yearlyWear} · ${perWorkerWear}. Actual consumption follows completed work, so blocked, empty, unstaffed, seasonal, and full sites wear less.
      </p>
    </div>
  `;
  return {
    ...view,
    supplementalPanelHtml: `${panel}${view.supplementalPanelHtml ?? ''}`,
  };
}

