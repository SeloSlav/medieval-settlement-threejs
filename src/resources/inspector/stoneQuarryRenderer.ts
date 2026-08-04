import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  civilianToolRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingStorageRows,
  buildingExtentRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';
import {
  extractionOutputHeadroom,
  extractionOutputTarget,
} from '../../economy/processorOutputPolicy.ts';
import { renderExtractionStockTargetPanel } from './extractionStockTargetRenderer.ts';

export function renderStoneQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const stoneTarget = extractionOutputTarget(
    'stone_quarry',
    'stone',
    building.processorOutputTargetPercent,
  );
  const outputHeadroom = extractionOutputHeadroom(building, 'stone') ?? 0;
  const targetReached = outputHeadroom <= 1e-6;
  const nearestQuarry = context.worldQueries.findNearestQuarryWithRemaining(
    building.x,
    building.z,
    building.workRadius,
  );
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const active = onsiteLabor > 0 && nearestQuarry != null && !targetReached;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: targetReached
      ? `Paused - stone yard target reached (${building.stone.toFixed(0)} / ${stoneTarget.toFixed(0)})`
      : nearestQuarry == null
        ? 'Stopped - no unexhausted surface stone in range'
        : onsiteLabor === 0
          ? building.assignedLabor > 0
            ? 'Extraction paused - the full roster is away with its cart'
            : 'Idle - assign labor to extract stone'
          : `Extracting — ${Math.round(nearestQuarry.remaining)} stone left at site`,
    statusState: active
      ? 'active'
      : !targetReached && nearestQuarry == null
        ? 'warning'
        : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${civilianToolRows(building, context.worldQueries)}
      ${buildingExtentRow(building.kind)}
      <li><span>Harvest interval</span><span>${active ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      <li><span>Yard ceiling</span><span>${building.stone.toFixed(0)} / ${stoneTarget.toFixed(0)} stone · ${outputHeadroom.toFixed(0)} headroom</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: renderExtractionStockTargetPanel(building, 'stone') ?? undefined,
  };
}
