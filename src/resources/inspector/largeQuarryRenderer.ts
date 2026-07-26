import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps, laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderLargeQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const caps = buildingStorageCaps(building.kind);
  const richDeposit = [...context.gameState.quarries.values()].find((quarry) =>
    quarry.isRich && Math.hypot(quarry.x - building.x, quarry.z - building.z) <= 2.5
  );
  const storageFull = building.stone >= caps.stone - 1e-6;
  const active = building.assignedLabor > 0 && richDeposit != null && !storageFull;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, building.assignedLabor);

  return {
    eyebrow: 'Underground quarry',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: building.assignedLabor === 0
      ? 'Idle — assign workers to the underground quarry'
      : storageFull
        ? 'Paused — stone storage is full'
        : !richDeposit
          ? 'Stopped — no rich underground source beneath the shaft'
          : 'Extracting from the inexhaustible underground source',
    statusState: active ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      <li><span>Source</span><span>Rich underground stone · inexhaustible</span></li>
      <li><span>Surface reserve</span><span>Separate · ${Math.round(richDeposit?.remaining ?? 0)} remaining</span></li>
      <li><span>Production interval</span><span>${building.assignedLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : `${definition.harvestInterval}s`} (${building.assignedLabor} workers)</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
