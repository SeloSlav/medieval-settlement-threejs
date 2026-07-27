import { CONSTRUCTION_DELIVERY_UNLOAD_SEC } from '../../generated/gameBalance.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import { selectConstructionRouteSource } from '../../logistics/constructionLogistics.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import { buildingLaborView, buildingRoadAccessRow } from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  CONSTRUCTION_PRIORITIES,
  CONSTRUCTION_PRIORITY_HOLD,
  constructionPriorityLabel,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../../logistics/constructionPriority.ts';

type ConstructionMaterial = 'timber' | 'stone';
type SupplyResolution = {
  state:
    | 'ready-free'
    | 'ready-staffed'
    | 'busy'
    | 'no-hauler'
    | 'unreachable'
    | 'fire-disabled'
    | 'missing';
  source: BuildingState | null;
  routeDistance: number | null;
};

export function renderConstructionInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const inbound = context.worldQueries.getInboundSupplyTrip(building);
  const progress = Math.round(building.constructionProgress * 100);
  const priority = normalizeConstructionPriority(building.constructionPriority);
  const held = priority === CONSTRUCTION_PRIORITY_HOLD;
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
  const supply = pendingMaterial && !held
    ? resolveConstructionSupply(context, building, pendingMaterial)
    : null;
  const origin = inbound ? context.worldQueries.getBuilding(inbound.buildingId) : null;

  let statusText = `${progress}% built`;
  let statusState = 'active';
  if (held) {
    statusText = 'Construction held — reservations retained';
    statusState = 'warning';
  } else if (building.assignedLabor <= 0) {
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
      case 'fire-disabled':
        statusText = `Reserved ${amount} is fire-quarantined at ${sourceLabel} — repair it or supply another store`;
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
  const nextSourceDistance = inbound?.pathDistance ?? supply?.routeDistance ?? null;
  const nextSourceLabel = nextSource
    ? `${getBuildingDefinition(nextSource.kind).label}${
        nextSourceDistance == null ? '' : ` · ${Math.round(nextSourceDistance)}m haul`
      }${supply?.state === 'fire-disabled' ? ' · fire-disabled' : ''}`
    : 'None';
  const priorityControls = `<div class="inspector-action-panel">
      <p class="resource-inspector-note">Queue priority — urgent sites claim available carts and scarce stored material first. Hold stops hauling and builder work while retaining reservations.</p>
      <div class="resource-action-row">${CONSTRUCTION_PRIORITIES.map((candidate) =>
        constructionPriorityButton(candidate, priority)).join('')}</div>
    </div>`;

  return {
    eyebrow: 'Construction site',
    title: definition.label,
    statusText,
    statusState,
    detailsHtml: `
      <li><span>Builder progress</span><span>${progress}%</span></li>
      <li><span>Queue priority</span><span>${constructionPriorityLabel(priority)}</span></li>
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
    supplementalPanelHtml: priorityControls,
  };
}

function constructionPriorityButton(
  candidate: ConstructionPriority,
  current: ConstructionPriority,
): string {
  return `<button type="button" class="resource-action-button" data-construction-priority="${candidate}" ${
    candidate === current ? 'disabled' : ''
  }>${constructionPriorityLabel(candidate)}</button>`;
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
  const sources = [...context.gameState.buildings.values()].filter((source) =>
    source.id !== site.id
    && source.constructionComplete !== false
    && source[material] > 1e-6);
  const fireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  );
  const routeDistances = new Map<string, number>();
  const readySources: BuildingState[] = [];
  const waitingForLabor: BuildingState[] = [];
  const busy: BuildingState[] = [];
  const unreachable: BuildingState[] = [];
  const fireBlocked: BuildingState[] = [];
  for (const source of sources) {
    if (fireDisabled.has(source.id)) {
      fireBlocked.push(source);
      continue;
    }
    const roadDistance = context.worldQueries.getRoadPathDistance(
      source.x,
      source.z,
      site.x,
      site.z,
    );
    const routeDistance = roadDistance ?? (
      requiresRoad ? null : directDistance(source, site)
    );
    if (routeDistance == null) {
      unreachable.push(source);
      continue;
    }
    routeDistances.set(source.id, routeDistance);
    if (
      context.worldQueries.getActiveDeliveryTrip(source)
      || (
        source.kind === 'village_storehouse'
        && context.worldQueries.getInboundSupplyTrip(source)
      )
    ) {
      busy.push(source);
      continue;
    }
    if (source.assignedLabor > 0 || freeHaulers > 0) readySources.push(source);
    else waitingForLabor.push(source);
  }

  const routeDistanceFor = (source: BuildingState): number | null =>
    routeDistances.get(source.id) ?? null;
  const ready = selectConstructionRouteSource(readySources, routeDistanceFor);
  if (ready) {
    return {
      state: ready.source.assignedLabor > 0 ? 'ready-staffed' : 'ready-free',
      source: ready.source,
      routeDistance: ready.routeDistance,
    };
  }

  const waiting = selectConstructionRouteSource(waitingForLabor, routeDistanceFor);
  if (waiting) {
    return {
      state: 'no-hauler',
      source: waiting.source,
      routeDistance: waiting.routeDistance,
    };
  }
  const occupied = selectConstructionRouteSource(busy, routeDistanceFor);
  if (occupied) {
    return {
      state: 'busy',
      source: occupied.source,
      routeDistance: occupied.routeDistance,
    };
  }
  const disabled = selectConstructionRouteSource(
    fireBlocked,
    (source) => directDistance(source, site),
  );
  if (disabled) {
    return {
      state: 'fire-disabled',
      source: disabled.source,
      routeDistance: null,
    };
  }
  const disconnected = selectConstructionRouteSource(
    unreachable,
    (source) => directDistance(source, site),
  );
  if (disconnected) {
    return { state: 'unreachable', source: disconnected.source, routeDistance: null };
  }
  return { state: 'missing', source: null, routeDistance: null };
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

function directDistance(left: BuildingState, right: BuildingState): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function formatAmount(value: number): string {
  return value < 10 && Math.abs(value - Math.round(value)) > 0.01
    ? value.toFixed(1)
    : Math.round(value).toString();
}
