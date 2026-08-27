import {
  MINE_CLAY_PER_CYCLE,
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';
import {
  RICH_MINE_SUPPORT_TARGET,
  richMineSupportRunwayCycles,
  richMineSupportsReady,
} from '../../economy/mineSupportPolicy.ts';
import { mineralDepositBeneath } from '../../economy/settlementGeology.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import {
  formatResourceCostAmount,
  renderResourceAmount,
} from '../../ui/resourceCost.ts';
import type {
  InspectableTarget,
} from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  civilianToolRows,
} from './buildingCommon.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';
import {
  extractionOutputHeadroom,
  extractionOutputTarget,
} from '../../economy/processorOutputPolicy.ts';

export function renderMineralMineInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition('mine');
  const deposit = mineralDepositBeneath(
    building,
    context.gameState.quarries.values(),
  );
  const resource = deposit?.resource === 'salt'
    ? 'salt'
    : deposit?.resource === 'clay'
      ? 'clay'
      : 'iron';
  const resourceLabel = resource === 'iron'
    ? 'iron-bearing ore'
    : resource === 'salt'
      ? 'rock salt'
      : 'deep clay';
  const stock = Math.max(0, building[resource] ?? 0);
  const yardTarget = extractionOutputTarget(
    'mine',
    resource,
  );
  const outputHeadroom = extractionOutputHeadroom(building, resource) ?? 0;
  const targetReached = outputHeadroom <= 1e-6;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundSupply = context.worldQueries.getInboundSupplyTrip(building);
  const inboundSupportTimber = inboundSupply?.cargoKind === 'timber'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const sourceUsable = deposit != null;
  const onsiteSupportReady = richMineSupportsReady(building.timber);
  const supportRecovering = deposit != null
    && !onsiteSupportReady
    && richMineSupportsReady(building.timber, inboundSupportTimber);
  const active = onsiteLabor > 0
    && sourceUsable
    && onsiteSupportReady
    && !targetReached;
  const throughput = (deposit ? RICH_MINE_THROUGHPUT_MULTIPLIER : 1)
    * civilianToolThroughputMultiplier(building.ironwork ?? 0);
  const cycleSeconds = laborScaledInterval(
    definition.harvestInterval,
    onsiteLabor,
  ) / throughput;
  const batch = resource === 'iron'
    ? MINE_IRON_PER_CYCLE
    : resource === 'salt'
      ? MINE_SALT_PER_CYCLE
      : MINE_CLAY_PER_CYCLE;
  const supportRunway = richMineSupportRunwayCycles(
    building.timber,
    inboundSupportTimber,
  );
  const supportRows = `<li><span>Deep shaft supports</span><span>${formatResourceCostAmount(Math.max(0, building.timber))} onsite${
        inboundSupportTimber > 1e-6
          ? ` + ${formatResourceCostAmount(inboundSupportTimber)} inbound`
          : ''
      } / ${formatResourceCostAmount(RICH_MINE_SUPPORT_TARGET)} timber target · ${supportRunway.toFixed(1)} cycles</span></li>
      <li><span>Timber crib wear</span><span>${renderResourceAmount('timber', MINE_TIMBER_SUPPORT_PER_CYCLE, { compact: true, suffix: 'per completed deep batch' })} · nearest lumber mill or storehouse supplies it; roads make the haul faster</span></li>`;

  return {
    eyebrow: deposit === null
      ? 'Deep extraction'
      : `Rich ${resource} mineworks`,
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: deposit === null
      ? 'Stopped - no rich iron, salt, or clay deposit beneath the shaft'
      : targetReached
          ? `Paused - ${resource} yard target reached (${stock.toFixed(0)} / ${yardTarget.toFixed(0)})`
          : building.assignedLabor === 0
            ? 'Idle - assign at least 1 miner to request timber supports'
            : !onsiteSupportReady
            ? supportRecovering
              ? `Waiting - timber supports are approaching the rich deep ${resource} shaft`
              : `Stopped - rich deep ${resource} shaft awaits timber supports`
            : onsiteLabor === 0
              ? 'Extraction paused - the full roster is away with its cart'
              : `Extracting rich deep ${resource} - source does not deplete`,
    statusState: active
      ? 'active'
      : targetReached
        ? 'idle'
        : building.assignedLabor === 0
          ? 'idle'
        : sourceUsable && (onsiteSupportReady || supportRecovering)
          ? 'idle'
          : 'warning',
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      <li><span>Physical source</span><span>${
        deposit === null
          ? 'Missing - Mineworks cannot produce'
          : `Rich ${resourceLabel} seam - non-depleting deep workings`
      }</span></li>
      <li><span>Geological reserve</span><span>${
        deposit === null
          ? 'None beneath shaft'
          : `Deep source does not deplete - surface marker ${Math.round(deposit.remaining)} / ${Math.round(deposit.maxYield)}`
      }</span></li>
      <li><span>Extraction batch</span><span>${batch.toFixed(1)} ${resource} per completed cycle${
        deposit
          ? ` - ${Math.round((RICH_MINE_THROUGHPUT_MULTIPLIER - 1) * 100)}% faster deep working with maintained timber cribs`
          : ''
      }</span></li>
      <li><span>Yard ceiling</span><span>${stock.toFixed(0)} / ${yardTarget.toFixed(0)} ${resource} · ${outputHeadroom.toFixed(0)} headroom</span></li>
      <li><span>Production interval</span><span>${
        active
          ? `${cycleSeconds.toFixed(1)}s`
          : 'paused'
      } (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      <li><span>Dispatch</span><span>${
        deposit === null
          ? 'No dispatch until the shaft is centered on a rich iron, salt, or clay deposit'
          : resource === 'iron'
          ? 'Mineworks carts serve road-linked smithies; market iron covers a local shortfall'
          : resource === 'salt'
            ? 'Mineworks carts serve smokehouses and pastoral holdings; roads speed the haul and market salt covers a local shortfall'
            : "Mineworks carts serve road-linked potters; roads speed the haul and imported clay covers a local shortfall"
      }</span></li>
      ${supportRows}
      ${civilianToolRows(building, context.worldQueries)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(
      building,
      context.populationStats,
      context.worldQueries,
    ),
  };
}
