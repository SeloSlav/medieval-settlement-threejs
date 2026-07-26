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

export function withStaffingPriority(
  view: InspectorView,
  building: BuildingState,
): InspectorView {
  if (!buildingAcceptsLabor(building.kind)) return view;
  const priority = normalizeStaffingPriority(building.constructionPriority);
  const panel = `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Staffing priority — if population loss forces reassignment, temporary builders release first, then low-, normal-, and high-priority permanent jobs. This does not hire workers automatically.</p>
      <div class="resource-action-row">${STAFFING_PRIORITIES.map((candidate) =>
        staffingPriorityButton(candidate, priority)).join('')}</div>
      <p class="inspector-action-panel__hint">${staffingPriorityHint(priority)}</p>
    </div>`;
  return {
    ...view,
    detailsHtml: `${view.detailsHtml}<li><span>Staffing priority</span><span>${staffingPriorityLabel(priority)}</span></li>`,
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
