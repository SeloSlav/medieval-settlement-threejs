import {
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
import { buildingStorageCaps, laborScaledInterval } from '../resourceTotals.ts';
import type {
  InspectableTarget,
} from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  civilianToolRows,
} from './buildingCommon.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';

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
  const resource = deposit?.resource === 'salt' ? 'salt' : 'iron';
  const resourceLabel = resource === 'iron' ? 'iron-bearing ore' : 'rock salt';
  const stock = Math.max(0, building[resource] ?? 0);
  const capacity = buildingStorageCaps('mine')[resource] ?? 0;
  const storageFull = capacity > 0 && stock >= capacity - 1e-6;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundSupply = context.worldQueries.getInboundSupplyTrip(building);
  const inboundSupportTimber = inboundSupply?.cargoKind === 'timber'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const sourceUsable = deposit != null
    && (deposit.isRich === true || deposit.remaining > 1e-6);
  const onsiteSupportReady = deposit?.isRich !== true
    || richMineSupportsReady(building.timber);
  const supportRecovering = deposit?.isRich === true
    && !onsiteSupportReady
    && richMineSupportsReady(building.timber, inboundSupportTimber);
  const active = onsiteLabor > 0
    && sourceUsable
    && onsiteSupportReady
    && !storageFull;
  const throughput = (deposit?.isRich ? RICH_MINE_THROUGHPUT_MULTIPLIER : 1)
    * civilianToolThroughputMultiplier(building.ironwork ?? 0);
  const cycleSeconds = laborScaledInterval(
    definition.harvestInterval,
    onsiteLabor,
  ) / throughput;
  const batch = resource === 'iron'
    ? MINE_IRON_PER_CYCLE
    : MINE_SALT_PER_CYCLE;
  const grade = deposit?.isRich ? 'Rich' : 'Ordinary';
  const supportRunway = richMineSupportRunwayCycles(
    building.timber,
    inboundSupportTimber,
  );
  const supportRows = deposit?.isRich
    ? `<li><span>Deep shaft supports</span><span>${Math.max(0, building.timber).toFixed(1)} onsite${
        inboundSupportTimber > 1e-6
          ? ` + ${inboundSupportTimber.toFixed(1)} inbound`
          : ''
      } / ${RICH_MINE_SUPPORT_TARGET.toFixed(1)} timber target · ${supportRunway.toFixed(1)} cycles</span></li>
      <li><span>Timber crib wear</span><span>${MINE_TIMBER_SUPPORT_PER_CYCLE.toFixed(1)} timber per completed deep batch · nearest road-linked lumber mill or village storehouse supplies it</span></li>`
    : '<li><span>Shaft timber</span><span>Ordinary surface seam · no recurring deep-support cost</span></li>';

  return {
    eyebrow: deposit === null
      ? 'Mineral mine'
      : `${grade} ${resource} mine`,
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: deposit === null
      ? 'Stopped - no physical iron or salt deposit beneath the shaft'
      : !sourceUsable
        ? `Exhausted - finite ${resource} seam is spent`
        : storageFull
          ? `Paused - ${resource} yard is full`
          : onsiteLabor === 0
            ? building.assignedLabor > 0
              ? 'Extraction paused - the full roster is away with its cart'
              : 'Idle - assign miners'
            : !onsiteSupportReady
              ? supportRecovering
                ? `Waiting - timber supports are approaching the rich deep ${resource} shaft`
                : `Stopped - rich deep ${resource} shaft awaits timber supports`
            : deposit.isRich
              ? `Extracting rich deep ${resource} - source does not deplete`
              : `Extracting finite ${resource} seam - ${Math.round(deposit.remaining)} reserve remains`,
    statusState: active
      ? 'active'
      : sourceUsable && (onsiteSupportReady || supportRecovering)
        ? 'idle'
        : 'warning',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      <li><span>Physical source</span><span>${
        deposit === null
          ? 'Missing - mine cannot produce'
          : deposit.isRich
            ? `Rich ${resourceLabel} seam - non-depleting deep workings`
            : `Ordinary ${resourceLabel} seam - finite`
      }</span></li>
      <li><span>Geological reserve</span><span>${
        deposit === null
          ? 'None beneath shaft'
          : deposit.isRich
            ? `Deep source does not deplete - surface marker ${Math.round(deposit.remaining)} / ${Math.round(deposit.maxYield)}`
            : `${Math.round(deposit.remaining)} / ${Math.round(deposit.maxYield)} ${resourceLabel}`
      }</span></li>
      <li><span>Extraction batch</span><span>${batch.toFixed(1)} ${resource} per completed cycle${
        deposit?.isRich
          ? ` - ${Math.round((RICH_MINE_THROUGHPUT_MULTIPLIER - 1) * 100)}% faster deep working with maintained timber cribs`
          : ''
      }</span></li>
      <li><span>Production interval</span><span>${
        active
          ? `${cycleSeconds.toFixed(1)}s`
          : 'paused'
      } (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      <li><span>Dispatch</span><span>${
        deposit === null
          ? 'No dispatch until the shaft is centered on a physical mineral deposit'
          : resource === 'iron'
          ? 'Mine carts serve road-linked smithies; market iron covers a local shortfall'
          : 'Mine carts serve road-linked smokehouses and pastoral holdings; market salt covers a local shortfall'
      }</span></li>
      ${supportRows}
      ${civilianToolRows(building)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind)}
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
