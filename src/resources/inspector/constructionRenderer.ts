import { CONSTRUCTION_DELIVERY_UNLOAD_SEC } from '../../generated/gameBalance.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import { buildingLaborView, buildingRoadAccessRow } from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

type ConstructionMaterial = 'timber' | 'stone';
type SupplyResolution = {
  state: 'ready-free' | 'ready-staffed' | 'busy' | 'no-hauler' | 'unreachable' | 'missing';
  source: BuildingState | null;
};

export function renderConstructionInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const inbound = context.worldQueries.getInboundSupplyTrip(building);
  const progress = Math.round(building.constructionProgress * 100);
  const timberPending = Math.max(
    0,
    building.constructionReservedTimber - building.constructionTreasuryTimber,
  );
  const stonePending = Math.max(
    0,
    building.constructionReservedStone - building.constructionTreasuryStone,
  );
  const hasUndelivered = building.constructionReservedTimber > 1e-6
    || building.constructionReservedStone > 1e-6;
  const pendingMaterial: ConstructionMaterial | null = stonePending > 1e-6
    ? 'stone'
    : timberPending > 1e-6
      ? 'timber'
      : null;
  const pendingAmount = pendingMaterial === 'stone' ? stonePending : timberPending;
  const supply = pendingMaterial
    ? resolveConstructionSupply(context, building, pendingMaterial)
    : null;
  const origin = inbound ? context.worldQueries.getBuilding(inbound.buildingId) : null;

  let statusText = `${progress}% built`;
  let statusState = 'active';
  if (building.assignedLabor <= 0) {
    statusText = 'Waiting for builders';
    statusState = 'warning';
  } else if (inbound) {
    const sourceLabel = origin ? getBuildingDefinition(origin.kind).label : 'material source';
    const amount = `${formatAmount(inbound.amount)} ${inbound.cargoKind}`;
    if (inbound.phase === 'unloading') {
      statusText = `Unloading ${amount} from ${sourceLabel}`;
    } else if (origin?.assignedLabor === 0) {
      statusText = `Unassigned hauler bringing ${amount} from ${sourceLabel}`;
    } else if (origin?.kind === 'village_storehouse') {
      statusText = `Storehouse crew bringing ${amount}`;
    } else {
      statusText = `${sourceLabel} crew bringing ${amount}`;
    }
  } else if (pendingMaterial && supply) {
    const sourceLabel = supply.source
      ? getBuildingDefinition(supply.source.kind).label
      : 'material source';
    const amount = `${formatAmount(pendingAmount)} ${pendingMaterial}`;
    switch (supply.state) {
      case 'ready-free':
        statusText = `Unassigned worker fetching ${amount} from ${sourceLabel}`;
        break;
      case 'ready-staffed':
        statusText = supply.source?.kind === 'village_storehouse'
          ? `Storehouse crew preparing ${amount}`
          : `${sourceLabel} crew preparing ${amount}`;
        break;
      case 'busy':
        statusText = `Waiting for a free cart at ${sourceLabel}`;
        statusState = 'warning';
        break;
      case 'no-hauler':
        statusText = `Waiting for an unassigned hauler — ${amount} is at ${sourceLabel}`;
        statusState = 'warning';
        break;
      case 'unreachable':
        statusText = `No road route to ${amount} at ${sourceLabel}`;
        statusState = 'warning';
        break;
      case 'missing':
        statusText = `No completed building currently holds the reserved ${pendingMaterial}`;
        statusState = 'warning';
        break;
    }
  } else if (hasUndelivered) {
    statusText = 'Moving founders’ reserve onto the site';
  } else {
    statusText = `${progress}% built · materials ready`;
  }

  const incomingLabel = inbound
    ? `${formatAmount(inbound.amount)} ${inbound.cargoKind} from ${
        origin ? getBuildingDefinition(origin.kind).label : 'material source'
      }`
    : 'None';
  const nextSource = origin ?? supply?.source ?? null;
  const nextSourceLabel = nextSource ? getBuildingDefinition(nextSource.kind).label : 'None';

  return {
    eyebrow: 'Construction site',
    title: definition.label,
    statusText,
    statusState,
    detailsHtml: `
      <li><span>Builder progress</span><span>${progress}%</span></li>
      <li><span>Timber delivered</span><span>${formatAmount(building.constructionDeliveredTimber)} / ${formatAmount(building.constructionRequiredTimber)}</span></li>
      <li><span>Stone delivered</span><span>${formatAmount(building.constructionDeliveredStone)} / ${formatAmount(building.constructionRequiredStone)}</span></li>
      <li><span>Incoming haul</span><span>${incomingLabel}</span></li>
      <li><span>Material source</span><span>${nextSourceLabel}</span></li>
      <li><span>Reserved at stores</span><span>${formatAmount(timberPending)} timber · ${formatAmount(stonePending)} stone</span></li>
      <li><span>Founders’ reserve</span><span>${formatAmount(building.constructionTreasuryTimber)} timber · ${formatAmount(building.constructionTreasuryStone)} stone</span></li>
      ${buildingRoadAccessRow(context.worldQueries, building)}
    `,
    demolish: {
      visible: true,
      label: 'Cancel construction',
      hint: 'Cancels immediately. Undelivered reservations are released; delivered materials are salvaged at the usual demolition rate.',
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}

function resolveConstructionSupply(
  context: InspectorRenderContext,
  site: BuildingState,
  material: ConstructionMaterial,
): SupplyResolution {
  const requiresRoad = getBuildingDefinition(site.kind).requiresRoad;
  const freeHaulers = Math.max(
    0,
    context.populationStats.available - countActiveFreeConstructionHaulers(context),
  );
  const sources = [...context.gameState.buildings.values()]
    .filter((source) =>
      source.id !== site.id
      && source.constructionComplete !== false
      && source[material] > 1e-6)
    .sort((left, right) => {
      const priority = constructionSourcePriority(left) - constructionSourcePriority(right);
      if (priority !== 0) return priority;
      const leftDistance = squaredDistance(left, site);
      const rightDistance = squaredDistance(right, site);
      if (Math.abs(leftDistance - rightDistance) > 1e-6) {
        return leftDistance - rightDistance;
      }
      return left.id.localeCompare(right.id, undefined, { numeric: true });
    });

  let waitingForLabor: BuildingState | null = null;
  let busy: BuildingState | null = null;
  let unreachable: BuildingState | null = null;
  for (const source of sources) {
    const reachable = !requiresRoad || context.worldQueries.getRoadPathDistance(
      source.x,
      source.z,
      site.x,
      site.z,
    ) != null;
    if (!reachable) {
      unreachable ??= source;
      continue;
    }
    if (context.worldQueries.getActiveDeliveryTrip(source)) {
      busy ??= source;
      continue;
    }
    if (source.assignedLabor > 0) {
      return { state: 'ready-staffed', source };
    }
    if (freeHaulers > 0) {
      return { state: 'ready-free', source };
    }
    waitingForLabor ??= source;
  }

  if (waitingForLabor) return { state: 'no-hauler', source: waitingForLabor };
  if (busy) return { state: 'busy', source: busy };
  if (unreachable) return { state: 'unreachable', source: unreachable };
  return { state: 'missing', source: null };
}

function countActiveFreeConstructionHaulers(context: InspectorRenderContext): number {
  let count = 0;
  for (const trip of context.gameState.deliveryTrips.values()) {
    if (
      trip.destinationKind !== 'building'
      || (trip.cargoKind !== 'timber' && trip.cargoKind !== 'stone')
      || Math.abs(trip.unloadSeconds - CONSTRUCTION_DELIVERY_UNLOAD_SEC) > 1e-6
    ) continue;
    const origin = context.gameState.buildings.get(trip.buildingId);
    if (origin?.assignedLabor === 0) count += trip.deliveryWorkers;
  }
  return count;
}

function constructionSourcePriority(source: BuildingState): number {
  const kindPriority = source.kind === 'village_storehouse'
    ? 0
    : source.kind === 'carpenter'
      ? 1
      : source.kind === 'lumber_mill' || source.kind === 'stone_quarry'
        ? 2
        : 3;
  return source.assignedLabor > 0 ? kindPriority : kindPriority + 4;
}

function squaredDistance(left: BuildingState, right: BuildingState): number {
  return (left.x - right.x) ** 2 + (left.z - right.z) ** 2;
}

function formatAmount(value: number): string {
  return value < 10 && Math.abs(value - Math.round(value)) > 0.01
    ? value.toFixed(1)
    : Math.round(value).toString();
}
