import {
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps, laborScaledInterval } from '../resourceTotals.ts';
import type {
  InspectableTarget,
  ResourceNodeState,
} from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';

const MINERAL_CENTER_TOLERANCE = 2.5;

export function renderMineralMineInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition('mine');
  const deposit = mineralDepositBeneath(
    context.gameState.quarries.values(),
    building.x,
    building.z,
  );
  const resource = deposit?.resource === 'salt' ? 'salt' : 'iron';
  const resourceLabel = resource === 'iron' ? 'iron-bearing ore' : 'rock salt';
  const stock = Math.max(0, building[resource] ?? 0);
  const capacity = buildingStorageCaps('mine')[resource] ?? 0;
  const storageFull = capacity > 0 && stock >= capacity - 1e-6;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const sourceUsable = deposit != null
    && (deposit.isRich === true || deposit.remaining > 1e-6);
  const active = onsiteLabor > 0 && sourceUsable && !storageFull;
  const throughput = deposit?.isRich ? RICH_MINE_THROUGHPUT_MULTIPLIER : 1;
  const cycleSeconds = laborScaledInterval(
    definition.harvestInterval,
    onsiteLabor,
  ) / throughput;
  const batch = resource === 'iron'
    ? MINE_IRON_PER_CYCLE
    : MINE_SALT_PER_CYCLE;
  const grade = deposit?.isRich ? 'Rich' : 'Ordinary';

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
            : deposit.isRich
              ? `Extracting rich deep ${resource} - source does not deplete`
              : `Extracting finite ${resource} seam - ${Math.round(deposit.remaining)} reserve remains`,
    statusState: active ? 'active' : sourceUsable ? 'idle' : 'warning',
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
          ? ` - ${Math.round((RICH_MINE_THROUGHPUT_MULTIPLIER - 1) * 100)}% faster deep working`
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

function mineralDepositBeneath(
  deposits: Iterable<ResourceNodeState>,
  x: number,
  z: number,
): ResourceNodeState | null {
  const toleranceSq = MINERAL_CENTER_TOLERANCE * MINERAL_CENTER_TOLERANCE;
  for (const deposit of deposits) {
    if (deposit.resource !== 'iron' && deposit.resource !== 'salt') continue;
    const dx = deposit.x - x;
    const dz = deposit.z - z;
    if (dx * dx + dz * dz <= toleranceSq) return deposit;
  }
  return null;
}
