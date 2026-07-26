import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps, laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingStorageRows,
  buildingExtentRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderStoneQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const stoneCapacity = buildingStorageCaps(building.kind).stone ?? 0;
  const storageFull = stoneCapacity > 0 && building.stone >= stoneCapacity - 1e-6;
  const nearestQuarry = context.worldQueries.findNearestQuarryWithRemaining(
    building.x,
    building.z,
    building.workRadius,
  );
  const active = building.assignedLabor > 0 && nearestQuarry != null && !storageFull;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, building.assignedLabor);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: building.assignedLabor === 0
      ? 'Idle — assign labor to extract stone'
      : storageFull
        ? 'Paused — stone storage is full'
        : nearestQuarry
          ? `Extracting — ${Math.round(nearestQuarry.remaining)} stone left at site`
          : 'Idle — no quarry stone in range',
    statusState: active ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingExtentRow(building.kind)}
      <li><span>Harvest interval</span><span>${building.assignedLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : `${definition.harvestInterval}s`} (${building.assignedLabor} workers)</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
