import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';
import {
  LARGE_QUARRY_SUPPORT_TARGET,
  largeQuarrySupportRunwayCycles,
  largeQuarrySupportsReady,
} from '../../economy/largeQuarrySupportPolicy.ts';
import { LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE } from '../../generated/gameBalance.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import { renderResourceAmount } from '../../ui/resourceCost.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  civilianToolRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  extractionOutputHeadroom,
  extractionOutputTarget,
} from '../../economy/processorOutputPolicy.ts';
import { renderExtractionStockTargetPanel } from './extractionStockTargetRenderer.ts';

export function renderLargeQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const richDeposit = [...context.gameState.quarries.values()].find((quarry) =>
    quarry.isRich
    && Math.hypot(quarry.x - building.x, quarry.z - building.z) <= 2.5
  );
  const resource = richDeposit?.resource === 'iron'
    || richDeposit?.resource === 'salt'
    || richDeposit?.resource === 'clay'
    ? richDeposit.resource
    : 'stone';
  const stock = Math.max(0, building[resource] ?? 0);
  const yardTarget = extractionOutputTarget(
    'large_quarry',
    resource,
    building.processorOutputTargetPercent,
  );
  const outputHeadroom = extractionOutputHeadroom(building, resource) ?? 0;
  const targetReached = outputHeadroom <= 1e-6;
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const inboundSupply = context.worldQueries.getInboundSupplyTrip(building);
  const inboundSupportTimber = inboundSupply?.cargoKind === 'timber'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const onsiteSupportsReady = largeQuarrySupportsReady(building.timber);
  const supportsRecovering = !onsiteSupportsReady
    && largeQuarrySupportsReady(building.timber, inboundSupportTimber);
  const supportRunway = largeQuarrySupportRunwayCycles(
    building.timber,
    inboundSupportTimber,
  );
  const active = onsiteLabor > 0
    && richDeposit != null
    && onsiteSupportsReady
    && !targetReached;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);

  return {
    eyebrow: `Deep ${resource} quarry`,
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: targetReached
      ? `Paused - ${resource} yard target reached (${stock.toFixed(0)} / ${yardTarget.toFixed(0)})`
      : !richDeposit
        ? 'Stopped — no rich underground source beneath the shaft'
        : !onsiteSupportsReady
          ? supportsRecovering
            ? 'Waiting — prepared chamber supports are approaching'
            : 'Stopped — deep chambers await prepared timber supports'
          : onsiteLabor === 0
            ? building.assignedLabor > 0
              ? 'Extraction paused - the full roster is away with its cart'
              : 'Idle - assign workers to the underground quarry'
            : 'Extracting from the non-depleting underground source',
    statusState: active
      ? 'active'
      : targetReached
        ? 'idle'
        : richDeposit == null || (!onsiteSupportsReady && !supportsRecovering)
          ? 'warning'
          : 'idle',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${civilianToolRows(building, context.worldQueries)}
      <li><span>Source</span><span>Rich underground ${resource} · does not deplete</span></li>
      <li><span>Surface reserve</span><span>Separate · ${Math.round(richDeposit?.remaining ?? 0)} / ${Math.round(richDeposit?.maxYield ?? 0)} ${resource} remaining</span></li>
      <li><span>Chamber supports</span><span>${Math.round(Math.max(0, building.timber))} onsite${
        inboundSupportTimber > 1e-6
          ? ` + ${Math.round(inboundSupportTimber)} inbound`
          : ''
      } / ${Math.ceil(LARGE_QUARRY_SUPPORT_TARGET)} timber target · ${supportRunway.toFixed(1)} batches</span></li>
      <li><span>Support wear</span><span>${renderResourceAmount('timber', LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE, { compact: true, suffix: 'per completed underground batch' })} · nearest lumber mill or village storehouse supplies it; roads make the haul faster</span></li>
      <li><span>Yard ceiling</span><span>${stock.toFixed(0)} / ${yardTarget.toFixed(0)} ${resource} · ${outputHeadroom.toFixed(0)} headroom</span></li>
      <li><span>Production interval</span><span>${active ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      ${buildingRoadAccessRow(context.worldQueries, building)}
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
