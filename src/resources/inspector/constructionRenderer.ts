import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  constructionSourceAvailableStock,
  selectConstructionRouteSource,
} from '../../logistics/constructionLogistics.ts';
import { constructionLaborReady } from '../../economy/constructionLabor.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { deliveryTripHasPendingCargo } from '../../logistics/deliveryTrips.ts';
import { hasActiveRaiderThreat } from '../../security/combatAgents.ts';
import { deriveSettlementSchedule } from '../../world/settlementSchedule.ts';
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

type ConstructionMaterial = 'timber' | 'stone' | 'ironwork' | 'roofTiles';
type SupplyResolution = {
  state:
    | 'ready-free'
    | 'ready-staffed'
    | 'ready-builder'
    | 'busy'
    | 'builder-returning'
    | 'builder-crew-returning'
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
  const inboundTrips = [...context.gameState.deliveryTrips.values()].filter(
    (trip) => trip.destinationKind === 'building'
      && trip.targetBuildingId === building.id
      && deliveryTripHasPendingCargo(trip),
  );
  const inbound = inboundTrips[0] ?? null;
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
  const ironworkPending = Math.max(
    0,
    (building.constructionReservedIronwork ?? 0)
      - (building.constructionTreasuryIronwork ?? 0),
  );
  const roofTilesPending = Math.max(
    0,
    (building.constructionReservedRoofTiles ?? 0)
      - (building.constructionTreasuryRoofTiles ?? 0),
  );
  const hasUndelivered = building.constructionReservedTimber > 1e-6
    || building.constructionReservedStone > 1e-6
    || ironworkPending > 1e-6
    || roofTilesPending > 1e-6;
  const pendingMaterial: ConstructionMaterial | null = stonePending > 1e-6
    ? 'stone'
    : timberPending > 1e-6
      ? 'timber'
      : ironworkPending > 1e-6
        ? 'ironwork'
        : roofTilesPending > 1e-6
          ? 'roofTiles'
        : null;
  const pendingAmount = pendingMaterial === 'stone'
    ? stonePending
    : pendingMaterial === 'timber'
      ? timberPending
      : pendingMaterial === 'ironwork'
        ? ironworkPending
        : roofTilesPending;
  const supply = pendingMaterial && !held
    ? resolveConstructionSupply(context, building, pendingMaterial)
    : null;
  const origin = inbound ? context.worldQueries.getBuilding(inbound.buildingId) : null;
  const siteBuilderTrips = [...context.gameState.deliveryTrips.values()].filter(
    (trip) => trip.laborBuildingId === building.id,
  );
  const settlementSchedule = deriveSettlementSchedule(
    {
      simTick: context.gameState.tick,
      parishPolicy: context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY,
    },
    context.gameState,
  );
  const raiderPause = hasActiveRaiderThreat(context.combatAgents ?? []);

  let statusText = `${progress}% built`;
  let statusState = 'active';
  if (held) {
    statusText = 'Construction held — reservations retained';
    statusState = 'warning';
  } else if (raiderPause) {
    statusText = 'Raid shelter — builders and material carts resume when hostile raiders are cleared';
    statusState = 'warning';
  } else if (settlementSchedule.laborPaused) {
    statusText = `${settlementSchedule.laborPauseLabel ?? 'Scheduled labor pause'} — builders and material carts resume during work hours`;
    statusState = 'warning';
  } else if (building.assignedLabor <= 0) {
    const availableBuilders = Math.max(0, context.populationStats.available);
    const directRemedy = availableBuilders > 0
      ? `use Workforce + to assign one (${availableBuilders} available)`
      : 'release a worker from another assignment or wait for a reserved cart to return, then use Workforce +';
    const stewardGuidance = context.getConstructionLaborStewardEnabled?.()
      ? 'The enabled Town Hall steward also reviews ready sites at dawn while the hall is staffed.'
      : 'Staffing is manual; a staffed Town Hall can enable daily construction rotation.';
    statusText = `Waiting for builders — ${directRemedy}. ${stewardGuidance}`;
    statusState = 'warning';
  } else if (inbound) {
    const sourceLabel = origin ? getBuildingDefinition(origin.kind).label : 'material source';
    const amount = `${formatAmount(inbound.amount)} ${inbound.cargoKind}`;
    if (inbound.laborBuildingId === building.id && inbound.phase === 'unloading') {
      statusText = `Site builder unloading ${amount} from ${sourceLabel}`;
    } else if (inbound.laborBuildingId === building.id) {
      statusText = `Site builder bringing ${amount} from ${sourceLabel}`;
    } else if (inbound.phase === 'unloading') {
      statusText = `Unloading ${amount} from ${sourceLabel}`;
    } else if (origin?.assignedLabor === 0) {
      statusText = `Unassigned hauler bringing ${amount} from ${sourceLabel}`;
    } else if (origin?.kind === 'village_storehouse') {
      statusText = `Storehouse crew bringing ${amount}`;
    } else {
      statusText = `${sourceLabel} crew bringing ${amount}`;
    }
    if (inboundTrips.length > 1) {
      statusText = `${inboundTrips.length} material carts active — ${statusText}`;
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
      case 'ready-builder':
        statusText = `Site builder fetching ${amount} from ${sourceLabel}`;
        break;
      case 'busy':
        statusText = `Waiting for a free cart at ${sourceLabel}`;
        statusState = 'warning';
        break;
      case 'builder-returning':
        statusText = `Site builder returning with the cart — next load is ${amount} at ${sourceLabel}`;
        break;
      case 'builder-crew-returning':
        statusText = `Hauling crew returning — one builder remains onsite for arriving loads; next load is ${amount} at ${sourceLabel}`;
        break;
      case 'no-hauler':
        statusText = `Waiting for an unassigned hauler — ${amount} is at ${sourceLabel}`;
        statusState = 'warning';
        break;
      case 'unreachable':
        statusText = `No usable haul route to ${amount} at ${sourceLabel}`;
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
    ? `${inboundTrips.length > 1 ? `${inboundTrips.length} carts · ` : ''}${formatAmount(
        inboundTrips.reduce((total, trip) => total + trip.amount, 0),
      )} total material approaching; next ${formatAmount(inbound.amount)} ${inbound.cargoKind} from ${
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
      <li data-inspector-primary><span>Builder progress</span><span>${progress}%</span></li>
      <li data-inspector-primary><span>Queue priority</span><span>${constructionPriorityLabel(priority)}</span></li>
      <li data-inspector-primary><span>Timber delivered</span><span>${formatAmount(building.constructionDeliveredTimber)} / ${formatAmount(building.constructionRequiredTimber)}</span></li>
      <li data-inspector-primary><span>Stone delivered</span><span>${formatAmount(building.constructionDeliveredStone)} / ${formatAmount(building.constructionRequiredStone)}</span></li>
      ${(building.constructionRequiredIronwork ?? 0) > 0 ? `<li><span>Ironwork fittings delivered</span><span>${formatAmount(building.constructionDeliveredIronwork ?? 0)} / ${formatAmount(building.constructionRequiredIronwork ?? 0)}</span></li>` : ''}
      ${(building.constructionRequiredRoofTiles ?? 0) > 0 ? `<li><span>Fired roof tiles delivered</span><span>${formatAmount(building.constructionDeliveredRoofTiles ?? 0)} / ${formatAmount(building.constructionRequiredRoofTiles ?? 0)}</span></li>` : ''}
      <li><span>Incoming haul</span><span>${incomingLabel}</span></li>
      <li><span>Material source</span><span>${nextSourceLabel}</span></li>
      <li><span>Reserved at stores</span><span>${formatAmount(timberPending)} timber · ${formatAmount(stonePending)} stone · ${formatAmount(ironworkPending)} ironwork · ${formatAmount(roofTilesPending)} roof tiles</span></li>
      <li><span>Legacy ledger reserve</span><span>${formatAmount(building.constructionTreasuryTimber)} timber · ${formatAmount(building.constructionTreasuryStone)} stone · ${formatAmount(building.constructionTreasuryIronwork ?? 0)} ironwork · ${formatAmount(building.constructionTreasuryRoofTiles ?? 0)} roof tiles</span></li>
      ${buildingRoadAccessRow(context.worldQueries, building)}
    `,
    demolish: {
      visible: true,
      label: 'Cancel construction',
      hint: 'Cancels the worksite. Undelivered reservations are released; used materials remain here at the usual salvage rate, and carts already en route finish at the reclamation pile.',
    },
    labor: buildingLaborView(
      building,
      context.populationStats,
      context.worldQueries,
      siteBuilderTrips,
    ),
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
  // PopulationStats already deducts every trip's authoritative
  // freeHaulerWorkers reservation. Subtracting visible carts again makes the
  // inspector hide a genuinely available second founding hauler.
  const freeHaulers = Math.max(0, context.populationStats.available);
  const siteBuilderTrips = [...context.gameState.deliveryTrips.values()].filter(
    (trip) => trip.laborBuildingId === site.id,
  );
  const siteBuilderWorkersAway = Math.min(
    Math.max(0, site.assignedLabor),
    siteBuilderTrips.reduce(
      (total, trip) => total + Math.max(
        0,
        trip.deliveryWorkers - trip.freeHaulerWorkers,
      ),
      0,
    ),
  );
  const onsiteBuilders = Math.max(0, site.assignedLabor - siteBuilderWorkersAway);
  const builderCanLeave = onsiteBuilders > 1
    || (onsiteBuilders === 1 && siteBuilderWorkersAway === 0);
  const siteBuilderCanHaul = freeHaulers <= 0
    && builderCanLeave
    && !constructionLaborReady(site);
  const sources = [...context.gameState.buildings.values()].filter((source) =>
    source.id !== site.id
    && source.constructionComplete !== false
    && constructionSourceAvailableStock(source, material) > 1e-6);
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
    const routeDistance = context.worldQueries.getLocalDeliveryDistance(
      source.x,
      source.z,
      site.x,
      site.z,
    );
    if (routeDistance == null) {
      unreachable.push(source);
      continue;
    }
    routeDistances.set(source.id, routeDistance);
    if (
      (
        source.kind !== 'founders_camp'
        && context.worldQueries.getActiveDeliveryTrip(source)
      )
      || (
        source.kind === 'village_storehouse'
        && context.worldQueries.getInboundSupplyTrip(source)
      )
    ) {
      busy.push(source);
      continue;
    }
    if (
      (source.kind === 'village_storehouse' && source.assignedLabor > 0)
      || freeHaulers > 0
      || siteBuilderCanHaul
    ) readySources.push(source);
    else waitingForLabor.push(source);
  }

  const routeDistanceFor = (source: BuildingState): number | null =>
    routeDistances.get(source.id) ?? null;
  const ready = selectConstructionRouteSource(readySources, routeDistanceFor);
  if (ready) {
    const staffedStorehouse = ready.source.kind === 'village_storehouse'
      && ready.source.assignedLabor > 0;
    return {
      state: staffedStorehouse
        ? 'ready-staffed'
        : freeHaulers > 0
          ? 'ready-free'
          : 'ready-builder',
      source: ready.source,
      routeDistance: ready.routeDistance,
    };
  }

  const waiting = selectConstructionRouteSource(waitingForLabor, routeDistanceFor);
  if (waiting) {
    return {
      state: siteBuilderTrips.length > 0 && !constructionLaborReady(site)
        ? onsiteBuilders === 0
          ? 'builder-returning'
          : !builderCanLeave
            ? 'builder-crew-returning'
            : 'no-hauler'
        : 'no-hauler',
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

function directDistance(left: BuildingState, right: BuildingState): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function formatAmount(value: number): string {
  return value < 10 && Math.abs(value - Math.round(value)) > 0.01
    ? value.toFixed(1)
    : Math.round(value).toString();
}
