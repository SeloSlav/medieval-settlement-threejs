import type { BuildingState, TreeWorkArea } from '../types.ts';
import { effectiveTreeWorkArea, hasCustomTreeWorkArea } from '../treeWorkArea.ts';

type ForestryWorkAreaBuilding = Pick<
  BuildingState,
  'id' | 'kind' | 'x' | 'z' | 'workRadius'
> & {
  treeWorkArea?: TreeWorkArea;
};

export function activeTreeWorkArea(
  building: ForestryWorkAreaBuilding,
): TreeWorkArea | null {
  return hasCustomTreeWorkArea(building) ? building.treeWorkArea! : null;
}

export function forestryWorkAreaDetailRow(
  building: ForestryWorkAreaBuilding,
): string {
  const area = activeTreeWorkArea(building);
  const value = area
    ? `Limited circle · ${Math.round(area.radius)} m`
    : `Default extent · ${Math.round(effectiveTreeWorkArea(building).radius)} m`;
  return `<li><span>Work area</span><span>${value}</span></li>`;
}

export function renderForestryWorkAreaPanel(
  building: ForestryWorkAreaBuilding,
  options: { pending?: boolean } = {},
): string {
  const area = activeTreeWorkArea(building);
  const active = area !== null;
  const pending = options.pending === true && !active;
  const state = active ? 'active' : pending ? 'pending' : 'default';
  const defaultRadius = Math.round(effectiveTreeWorkArea(building).radius);
  const workerRule = building.kind === 'reforester'
    ? 'Foresters plant and tend trees only inside the chosen circle.'
    : 'Laborers fell mature trees only inside the chosen circle.';
  const centerDistance = area
    ? Math.round(Math.hypot(area.x - building.x, area.z - building.z))
    : 0;
  const label = area
    ? `Limited work area · ${Math.round(area.radius)} m`
    : pending
      ? 'Cancel work area placement'
      : 'Limit work area';
  const tooltipTitle = active
    ? 'Limited work area active'
    : pending
      ? 'Cancel work area placement'
      : 'Limit work area';
  const tooltip = area
    ? `${workerRule} Its center is ${centerDistance} m from this building. Click to remove the limit and restore the default ${defaultRadius} m building-centered extent.`
    : pending
      ? 'Move the circle anywhere on the map. Hold Ctrl and use the mouse wheel to resize it, then click to set it. Click this button again to cancel. Press Escape to cancel from the map.'
      : `${workerRule} Click to start, then move the circle anywhere on the map. Hold Ctrl and use the mouse wheel to resize it, then click to set it.`;
  const ariaLabel = area
    ? `${label} active. Click to restore the default work extent.`
    : pending
      ? 'Choosing a limited work area. Click to cancel placement.'
      : 'Limit work area. Choose a circle where this building should work.';

  return `
    <section class="inspector-action-panel" data-inspector-pinned-action data-inspector-panel-title="Work area">
      <button type="button"
        class="resource-action-button resource-action-button--icon resource-action-button--toggle${pending ? ' is-pending' : ''}"
        data-tree-work-area-action
        data-tree-work-area-state="${state}"
        aria-pressed="${active}"
        aria-label="${ariaLabel}"
        data-tooltip-title="${tooltipTitle}"
        data-tooltip="${tooltip}">
        <span class="inspector-action-icon" data-action-icon="tree-work-area" aria-hidden="true"></span>
        <span>${label}</span>
      </button>
    </section>
  `;
}
