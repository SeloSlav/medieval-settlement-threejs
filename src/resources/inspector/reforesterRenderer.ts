import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingStorageRows,
  buildingExtentRow,
  treeCountRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderReforesterInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const regrowing = building.assignedLabor > 0 && stumpTrees + growingTrees > 0;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: building.assignedLabor === 0
      ? 'Idle — assign a forester to regrow stumps'
      : growingTrees > 0
        ? `Reforesting — ${growingTrees} saplings growing${stumpTrees > 0 ? `, ${stumpTrees} stumps queued` : ''}`
        : stumpTrees > 0
          ? `Reforesting — ${stumpTrees} stumps in range`
          : 'Idle — no stumps in range',
    statusState: regrowing ? 'active' : building.assignedLabor === 0 ? 'idle' : 'draft',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingExtentRow(building.kind)}
      <li><span>Regrowth rate</span><span>${building.assignedLabor > 0 ? `${(definition.regrowRatePerSecond * building.assignedLabor).toFixed(3)}/s` : `${definition.regrowRatePerSecond}/s per worker`}</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
  };
}
