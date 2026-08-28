import { edibleFoodStock } from '../../economy/foodInventory.ts';
import {
  buildingSharedStorageCapacity,
  buildingStoredResourceTotal,
} from '../../economy/sharedStorageCapacity.ts';
import {
  RESOURCE_COST_KINDS,
  formatResourceCostAmount,
  type ResourceCostKind,
} from '../../ui/resourceCost.ts';
import type { BuildingState } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';

export type BuildingLocalStorageItem = {
  kind: ResourceCostKind;
  amount: number;
};

/**
 * Reads the physical stock fields shared by every building. The card is a
 * derived view, so old saves and server rows do not need a parallel summary.
 */
export function buildingLocalStorageItems(
  building: BuildingState,
): BuildingLocalStorageItem[] {
  const inventory = building as unknown as Partial<Record<ResourceCostKind, number>>;
  return RESOURCE_COST_KINDS.flatMap((kind) => {
    const amount = inventory[kind];
    return amount != null && Number.isFinite(amount) && amount > 1e-6
      ? [{ kind, amount: Math.max(0, amount) }]
      : [];
  });
}

export function withBuildingLocalStorage(
  view: InspectorView,
  building: BuildingState,
): InspectorView {
  const items = buildingLocalStorageItems(building);
  const total = buildingStoredResourceTotal(building);
  const capacity = buildingSharedStorageCapacity(building.kind);
  const food = Math.max(0, edibleFoodStock(building));
  const nonFood = Math.max(0, total - food);
  const stockSummary = food > 1e-6
    ? nonFood > 1e-6
      ? `${formatResourceCostAmount(food)} food · ${formatResourceCostAmount(total)} total`
      : `${formatResourceCostAmount(food)} food`
    : total > 1e-6
      ? `${formatResourceCostAmount(total)} stored`
      : 'Empty';
  const summary = capacity == null
    ? stockSummary
    : `${formatResourceCostAmount(total)} / ${formatResourceCostAmount(capacity)} total`;
  const tooltip = capacity == null
    ? items.length > 0
      ? 'Exact goods physically stored at this building now.'
      : 'Nothing is currently stored at this building.'
    : `Exact goods physically stored here. All accepted resources share this ${formatResourceCostAmount(capacity)}-unit capacity.`;
  const encodedItems = items.length > 0
    ? ` data-tooltip-resources="${encodeURIComponent(JSON.stringify(items))}"`
    : '';

  return {
    ...view,
    detailsHtml: `<li data-inspector-primary data-local-storage tabindex="0" data-tooltip-title="Local storage" data-tooltip="${tooltip}"${encodedItems}><span>Local storage</span><span>${summary}</span></li>${view.detailsHtml}`,
  };
}
