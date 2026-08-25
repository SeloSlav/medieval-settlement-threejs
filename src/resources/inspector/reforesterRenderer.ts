import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  NATURAL_TREE_MATURATION_DAYS,
} from '../../generated/gameBalance.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingStorageRows,
  treeCountRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  forestryWorkAreaDetailRow,
  renderForestryWorkAreaPanel,
} from './treeWorkAreaRenderer.ts';

export function renderReforesterInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const regrowing = building.assignedLabor > 0 && stumpTrees + growingTrees > 0;
  const laborDaySeconds = CALENDAR_SECONDS_PER_DAY;
  const managedTreesPerDay = definition.regrowRatePerSecond
    * building.assignedLabor
    * laborDaySeconds;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: building.assignedLabor === 0
      ? stumpTrees + growingTrees > 0
        ? 'Natural succession — assign a forester to accelerate recovery'
        : 'Idle — no recovering trees in range'
      : growingTrees > 0
        ? `Reforesting — ${growingTrees} saplings growing${stumpTrees > 0 ? `, ${stumpTrees} stumps queued` : ''}`
        : stumpTrees > 0
          ? `Reforesting — ${stumpTrees} stumps in range`
          : 'Idle — no stumps in range',
    statusState: regrowing ? 'active' : building.assignedLabor === 0 ? 'idle' : 'draft',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${forestryWorkAreaDetailRow(building)}
      <li><span>Managed capacity</span><span>${building.assignedLabor > 0 ? `${managedTreesPerDay.toFixed(1)} trees/day` : `${(definition.regrowRatePerSecond * laborDaySeconds).toFixed(1)} trees/day per worker`}</span></li>
      <li><span>Natural succession</span><span>about ${NATURAL_TREE_MATURATION_DAYS} days</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: renderForestryWorkAreaPanel(building, {
      pending: context.pendingTreeWorkAreaBuildingId === building.id,
    }),
  };
}
