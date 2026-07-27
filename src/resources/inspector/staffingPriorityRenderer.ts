import {
  normalizeStaffingPriority,
  STAFFING_PRIORITIES,
  staffingPriorityHint,
  staffingPriorityLabel,
  type StaffingPriority,
} from '../../economy/staffingPriority.ts';
import { buildingAcceptsLabor } from '../resourceTotals.ts';
import type { BuildingState } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';

const PRIORITIZED_CART_INPUTS: Partial<Record<BuildingState['kind'], string>> = {
  watermill: 'Grain',
  brewery: 'Grain, well-water, and firewood',
  monastery: 'Grain',
  granary: 'Flour and well-water',
  smokehouse: 'Dispatched fresh food',
  weaver: 'Wool',
};

export function withStaffingPriority(
  view: InspectorView,
  building: BuildingState,
): InspectorView {
  const acceptsLabor = buildingAcceptsLabor(building.kind);
  const prioritizedCartInputs = PRIORITIZED_CART_INPUTS[building.kind];
  const routesPrioritizedInputs = prioritizedCartInputs != null;
  if (!acceptsLabor && !routesPrioritizedInputs) return view;
  const priority = normalizeStaffingPriority(building.constructionPriority);
  const priorityLabel = routesPrioritizedInputs
    ? acceptsLabor
      ? 'Labor & cart priority'
      : 'Cart priority'
    : 'Staffing priority';
  const explanation = routesPrioritizedInputs
    ? acceptsLabor
      ? `Labor & cart priority — population-loss reassignment preserves higher tiers, and scarce ${prioritizedCartInputs.toLowerCase()} carts serve higher tiers first. This does not hire workers automatically.`
      : `Cart priority — scarce ${prioritizedCartInputs.toLowerCase()} carts serve higher tiers first. Runway, road distance, and stable order decide within a tier.`
    : 'Staffing priority — if population loss forces reassignment, temporary builders release first, then low-, normal-, and high-priority permanent jobs. This does not hire workers automatically.';
  const priorityHint = routesPrioritizedInputs
    ? acceptsLabor
      ? `${staffingPriorityHint(priority)} ${prioritizedCartInputs} carts serve this tier before lower-priority consumers.`
      : `${staffingPriorityLabel(priority)} cart tier · ${prioritizedCartInputs} carts serve this tier before lower-priority consumers.`
    : staffingPriorityHint(priority);
  const panel = `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">${explanation}</p>
      <div class="resource-action-row">${STAFFING_PRIORITIES.map((candidate) =>
        staffingPriorityButton(candidate, priority)).join('')}</div>
      <p class="inspector-action-panel__hint">${priorityHint}</p>
    </div>`;
  return {
    ...view,
    detailsHtml: `${view.detailsHtml}<li><span>${priorityLabel}</span><span>${staffingPriorityLabel(priority)}</span></li>`,
    supplementalPanelHtml: `${view.supplementalPanelHtml ?? ''}${panel}`,
  };
}

function staffingPriorityButton(
  candidate: StaffingPriority,
  current: StaffingPriority,
): string {
  return `<button type="button" class="resource-action-button" data-staffing-priority="${candidate}" ${
    candidate === current ? 'disabled' : ''
  }>${staffingPriorityLabel(candidate)}</button>`;
}
