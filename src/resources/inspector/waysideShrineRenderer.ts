import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingExtentRow,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

export function renderWaysideShrineInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);

  return {
    eyebrow: 'Civic decoration',
    title: label,
    statusText: 'A finished roadside landmark — decorative only.',
    statusState: 'idle',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
      <li><span>Purpose</span><span>Decoration only</span></li>
      <li><span>Labor</span><span>None</span></li>
      <li><span>Settlement effect</span><span>None</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
  };
}
