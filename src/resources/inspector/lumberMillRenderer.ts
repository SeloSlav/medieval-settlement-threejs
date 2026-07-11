import { MILL_WATER_PER_HARVEST } from '../../generated/gameBalance.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps, laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  buildingWorkRadiusRow,
  treeCountRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderLumberMillInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const storageCaps = buildingStorageCaps(building.kind);
  const connectedWells = context.worldQueries.getRoadConnectedWells(building);
  const wellsWithWater = connectedWells.filter((well) => well.water > 0).length;
  const storageFull = storageCaps.timber > 0 && building.timber >= storageCaps.timber - 0.001;
  const hasWaterSupply = connectedWells.length > 0;
  const hasHarvestWater = building.water + 1e-6 >= MILL_WATER_PER_HARVEST || wellsWithWater > 0;
  const active = building.assignedLabor > 0 && matureTrees > 0 && !storageFull && hasWaterSupply && hasHarvestWater;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, building.assignedLabor);

  const nearestWell = connectedWells[0];
  const nearestWellDistance = nearestWell
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestWell.x, nearestWell.z)
    : null;
  const wellSummary = connectedWells.length === 0
    ? 'None'
    : `${connectedWells.length} by road${nearestWellDistance != null ? ` (nearest ${nearestWellDistance.toFixed(0)} m)` : ''}`;

  let statusText: string;
  if (building.assignedLabor === 0) {
    statusText = 'Idle — assign labor to harvest timber';
  } else if (!hasWaterSupply) {
    statusText = 'Idle — needs a road-connected well to operate';
  } else if (!hasHarvestWater) {
    statusText = `Waiting for water — needs ${MILL_WATER_PER_HARVEST} per harvest`;
  } else if (storageFull) {
    statusText = `Storage full — not harvesting (${matureTrees} mature trees in range)`;
  } else if (matureTrees > 0) {
    statusText = `Harvesting — ${matureTrees} mature trees in range`;
  } else {
    statusText = 'Idle — no mature trees in range';
  }

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState: active ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Road-linked wells</span><span>${wellSummary}</span></li>
      <li><span>Water per harvest</span><span>${MILL_WATER_PER_HARVEST}</span></li>
      ${buildingWorkRadiusRow(building.kind)}
      <li><span>Harvest interval</span><span>${building.assignedLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : `${definition.harvestInterval}s`} (${building.assignedLabor} workers)</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
