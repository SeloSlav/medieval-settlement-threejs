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
  const nearestDeposit = context.worldQueries.findNearestSurfaceDepositWithRemaining(
    building.x,
    building.z,
    building.workRadius,
  );
  const resource = nearestDeposit?.resource === 'iron'
    || nearestDeposit?.resource === 'salt'
    || nearestDeposit?.resource === 'clay'
    ? nearestDeposit.resource
    : 'stone';
  const stock = Math.max(0, building[resource] ?? 0);
  const yardTarget = extractionOutputTarget(
    'stone_quarry',
    resource,
    building.processorOutputTargetPercent,
  );
  const outputHeadroom = extractionOutputHeadroom(building, resource) ?? 0;
  const targetReached = outputHeadroom <= 1e-6;
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const active = onsiteLabor > 0 && nearestDeposit != null && !targetReached;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);

  return {
    eyebrow: 'Surface extraction',
    title: label,
    statusText: targetReached
      ? `Paused - ${resource} yard target reached (${stock.toFixed(0)} / ${yardTarget.toFixed(0)})`
      : nearestDeposit == null
        ? 'Stopped - no unexhausted surface deposit in range'
        : onsiteLabor === 0
          ? building.assignedLabor > 0
            ? 'Extraction paused - the full roster is away with its cart'
            : `Idle - assign labor to extract surface ${resource}`
          : `Extracting surface ${resource} — ${Math.round(nearestDeposit.remaining)} left at site`,
    statusState: active
      ? 'active'
      : !targetReached && nearestDeposit == null
        ? 'warning'
        : 'idle',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${civilianToolRows(building, context.worldQueries)}
      ${buildingExtentRow(building.kind)}
      <li><span>Source</span><span>${nearestDeposit == null ? 'No unexhausted deposit in range' : `${nearestDeposit.isRich ? 'Rich' : 'Ordinary'} ${resource} surface deposit · finite`}</span></li>
      <li><span>Harvest interval</span><span>${active ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      <li><span>Yard ceiling</span><span>${stock.toFixed(0)} / ${yardTarget.toFixed(0)} ${resource} · ${outputHeadroom.toFixed(0)} headroom</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: renderExtractionStockTargetPanel(building, resource) ?? undefined,
  };
}
