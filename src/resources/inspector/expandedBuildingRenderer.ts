import { getBuildingDefinition } from '../buildings.ts';
import {
  CARPENTER_GOLD_PER_POLEARM,
  CARPENTER_TIMBER_PER_POLEARM,
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  GRAIN_TRANSFER_PER_TRIP,
  MONASTERY_CHARITY_FOOD_PER_DELIVERY,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
} from '../../generated/gameBalance.ts';
import { roadDeliveryTripSeconds } from '../../logistics/deliveryLogistics.ts';
import type { BuildingKind, BuildingState, InspectableTarget } from '../types.ts';
import { buildingDemolishHint, buildingExtentRow, buildingLaborView, buildingRoadAccessRow, buildingStorageRows } from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import { renderInboundSupplyRow, renderOutboundDeliveryRows, type DeliveryStatusContext } from './deliveryStatusRows.ts';
import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  DEFAULT_MONASTERY_POLICY,
  formatMonasteryFoodCharityTotal,
  formatMonasteryPilgrimageTotal,
  formatMonasteryTithePaidTotal,
} from '../../economy/monasteryPolicy.ts';
import { formatFreshFoodLoss } from '../../economy/foodPreservation.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';

const PROCESS: Record<string, string> = {
  threshing_barn: 'Farmstead crew works nearby drawn fields',
  watermill: 'Grain + river power → flour',
  granary: 'Bakes staple food and stores road-hauled wild food',
  brewery: 'Grain + water → ale',
  smokehouse: 'Fresh food + firewood → preserved food',
  apiary: 'Forest forage → honey + food',
  vineyard: 'Terraced vines → wine + food',
  monastery: 'Tithes + alms → charity, feasts, pilgrimages',
  carpenter: 'Timber + imported ironwork + coin → polearms and cartwright support',
  ferry_landing: 'River crossing → regional trade income',
};

const OUTBOUND_SUPPLY_KINDS = new Set<BuildingKind>([
  'threshing_barn',
  'watermill',
  'granary',
  'brewery',
  'smokehouse',
  'monastery',
  'carpenter',
]);

function buildingHasOutboundStock(building: BuildingState): boolean {
  switch (building.kind) {
    case 'threshing_barn':
      return building.grain > 0;
    case 'watermill':
      return building.flour > 0;
    case 'granary':
      return building.food > 0;
    case 'brewery':
      return building.ale > 0;
    case 'smokehouse':
      return building.preservedFood > 0;
    case 'monastery':
      return building.food > 0;
    case 'carpenter':
      return (building.polearms ?? 0) > 0;
    default:
      return false;
  }
}

function outboundDestinationLabel(building: BuildingState): string {
  switch (building.kind) {
    case 'threshing_barn':
      return 'Nearest road-linked mill or granary';
    case 'watermill':
      return 'Nearest road-linked granary';
    case 'granary':
      return 'Nearest road-linked smokehouse or home';
    case 'brewery':
      return 'Nearest monastery or lowest-runway claimed tier-3 home';
    case 'smokehouse':
      return 'Lowest-runway claimed tier-3 home';
    case 'monastery':
      return 'Nearest covered home needing food';
    case 'carpenter':
      return 'Nearest road-linked guardhouse';
    default:
      return 'Awaiting destination';
  }
}

function cargoPerTripLabel(building: BuildingState): string | null {
  switch (building.kind) {
    case 'threshing_barn':
    case 'watermill':
      return `${GRAIN_TRANSFER_PER_TRIP} per haul`;
    case 'monastery':
      return `${MONASTERY_CHARITY_FOOD_PER_DELIVERY} food per charity haul`;
    default:
      return null;
  }
}

function outboundTargetKinds(kind: BuildingKind): BuildingKind[] {
  switch (kind) {
    case 'threshing_barn':
      return ['watermill', 'brewery', 'granary', 'monastery'];
    case 'watermill':
      return ['granary'];
    case 'granary':
      return ['smokehouse'];
    case 'brewery':
      return ['monastery'];
    case 'carpenter':
      return ['guardhouse'];
    default:
      return [];
  }
}

function outboundTripTarget(
  building: BuildingState,
  context: InspectorRenderContext,
): { x: number; z: number } | null {
  const buildingTarget = context.worldQueries.findNearestRoadLinkedBuilding(
    building,
    outboundTargetKinds(building.kind),
  );
  if (buildingTarget) return buildingTarget;

  switch (building.kind) {
    case 'granary':
    case 'monastery':
      return context.worldQueries.findNearestRoadLinkedResidence(building, 1);
    case 'brewery':
      return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'ale');
    case 'smokehouse':
      return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
        building,
        'preservedFood',
      );
    default:
      return null;
  }
}

function plannedOutboundTripSeconds(
  building: BuildingState,
  context: InspectorRenderContext,
): number {
  const network = context.worldQueries.getRoadNetworkSnapshot();
  const target = outboundTripTarget(building, context);
  const speed = building.kind === 'monastery' || building.kind === 'granary' || building.kind === 'brewery' || building.kind === 'smokehouse'
    ? FOOD_DELIVERY_SPEED_MPS
    : TIMBER_DELIVERY_SPEED_MPS;
  const unload = building.kind === 'monastery' || building.kind === 'granary' || building.kind === 'brewery' || building.kind === 'smokehouse'
    ? FOOD_DELIVERY_UNLOAD_SEC
    : TIMBER_DELIVERY_UNLOAD_SEC;
  return roadDeliveryTripSeconds(network, building, target, speed, 1, unload);
}

function renderLogisticsRows(
  building: BuildingState,
  context: InspectorRenderContext,
): string {
  if (!OUTBOUND_SUPPLY_KINDS.has(building.kind)) return '';

  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const onRoad = roadAccess.startsWith('Connected');
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const destination = outboundDestinationLabel(building);
  const nearestTarget = outboundTripTarget(building, context);
  const pathDistance = nearestTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestTarget.x, nearestTarget.z)
    : null;
  const deliveryContext: DeliveryStatusContext = {
    getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    getResidence: (id: string) => context.worldQueries.getResidence(id),
    getBuilding: (id: string) => context.worldQueries.getBuilding(id),
    getBuildingLabel: (kind: BuildingKind) => context.worldQueries.getBuildingLabel(kind),
    getActiveTripPathDistance: (trip: DeliveryTripState) => context.worldQueries.getActiveTripPathDistance(trip),
  };

  if (!onRoad) {
    return `<li><span>Deliveries</span><span>Off road — connect to dispatch hauls</span></li>`;
  }

  const requiresLabor = building.kind !== 'monastery';
  if (requiresLabor && building.assignedLabor === 0) {
    return `<li><span>Deliveries</span><span>Idle — assign workers to dispatch hauls</span></li>`;
  }

  if (activeTrip) {
    const tripPath = context.worldQueries.getActiveTripPathDistance(activeTrip);
    return renderOutboundDeliveryRows(
      activeTrip,
      tripRemaining,
      destination,
      tripPath,
      plannedOutboundTripSeconds(building, context),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  const inboundRow = renderInboundSupplyRow(inboundTrip, deliveryContext);
  if (inboundRow) return inboundRow;

  if (buildingHasOutboundStock(building)) {
    return renderOutboundDeliveryRows(
      null,
      null,
      destination,
      pathDistance,
      plannedOutboundTripSeconds(building, context),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  return `<li><span>Deliveries</span><span>Ready — awaiting cargo or destination</span></li>`;
}

export function renderExpandedBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries);
  const carpenterStatus = building.kind === 'carpenter'
    ? building.assignedLabor <= 0
      ? { statusText: 'Idle — assign craftspeople to make polearms', statusState: 'idle' as const }
      : building.timber < CARPENTER_TIMBER_PER_POLEARM
        ? { statusText: `Waiting for timber — needs ${CARPENTER_TIMBER_PER_POLEARM} per polearm`, statusState: 'warning' as const }
        : context.resourceTotals.gold < CARPENTER_GOLD_PER_POLEARM
          ? { statusText: `Waiting for ${CARPENTER_GOLD_PER_POLEARM} gold of imported ironwork`, statusState: 'warning' as const }
          : { statusText: 'Shaping spear shafts and fitting iron heads', statusState: 'active' as const }
    : null;
  const fallbackActive = definition.acceptsLabor ? building.assignedLabor > 0 : true;
  const logisticsRows = renderLogisticsRows(building, context);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    gameClock(context.gameState.tick),
  );
  const granaryRows = building.kind === 'granary'
    ? `<li><span>Fresh-food intake</span><span>${building.granaryAcceptsFreshFood === false ? 'Local delivery only' : 'Centralize to 75% capacity'}</span></li>
      <li><span>Sheltered storage</span><span>${Math.round((1 - FRESH_FOOD_STORAGE_GRANARY_FACTOR) * 100)}% less spoilage · ${formatFreshFoodLoss(building.food * environment.freshFoodSpoilageFractionPerDay * FRESH_FOOD_STORAGE_GRANARY_FACTOR)}</span></li>`
    : '';
  const supplementalPanelHtml = building.kind === 'monastery'
    ? renderMonasteryPolicyPanel(context)
    : building.kind === 'threshing_barn'
      ? renderFarmsteadFieldPanel()
      : building.kind === 'granary'
        ? renderGranaryPolicyPanel(building)
        : undefined;
  return {
    eyebrow: 'Settlement building',
    title: definition.label,
    statusText: carpenterStatus?.statusText ?? processorStatus?.statusText ?? (fallbackActive ? 'Operating' : 'Awaiting workers'),
    statusState: carpenterStatus?.statusState ?? processorStatus?.statusState ?? (fallbackActive ? 'active' : 'warning'),
    detailsHtml: `<li><span>Role</span><span>${PROCESS[building.kind] ?? 'Settlement service'}</span></li>${building.kind === 'carpenter' ? `<li><span>Polearm batch</span><span>${CARPENTER_TIMBER_PER_POLEARM} timber + ${CARPENTER_GOLD_PER_POLEARM} treasury gold → 1 polearm</span></li>` : ''}${granaryRows}${processorStatus?.waterDetailHtml ?? ''}${buildingStorageRows(building, building.kind)}${buildingRoadAccessRow(context.worldQueries, building)}${buildingExtentRow(building.kind)}${logisticsRows}`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
    ...(supplementalPanelHtml ? { supplementalPanelHtml } : {}),
  };
}

function renderGranaryPolicyPanel(building: BuildingState): string {
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Centralizing fresh food sharply reduces spoilage but consumes a road haul before the granary can redistribute it. Keep intake off when nearby hunters, foragers, fishers, or swineherds should serve their own compact neighborhood.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-granary-accepts-fresh-food ${building.granaryAcceptsFreshFood === false ? '' : 'checked'} /><span>Collect fresh-food surplus</span></label>
      <p class="inspector-action-panel__hint">A staffed granary collects from road-linked producers until its food store reaches 75%. Staff are also required to dispatch household and smokehouse deliveries.</p>
    </div>
  `;
}

function renderFarmsteadFieldPanel(): string {
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Lay out cultivated land for this farmstead. Its crew will exclusively plough, sow, tend, and harvest the linked fields.</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button" data-land-parcel="field">Lay out farm field</button>
      </div>
    </div>
  `;
}

function renderMonasteryPolicyPanel(context: InspectorRenderContext): string {
  const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">The monastery decides how much parish tithe supports alms, pilgrimages, and feast-day charity.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-monastery-feasts ${policy.feastsEnabled ? 'checked' : ''} /><span>Hold feast-day charity</span></label>
      <label class="city-admin-panel__slider-label"><span>Parish tithe share</span><strong data-policy-monastery-tithe-value>${Math.round(policy.titheShare * 100)}%</strong></label>
      <input class="city-admin-panel__slider" type="range" data-policy-monastery-tithe min="0" max="80" step="5" value="${Math.round(policy.titheShare * 100)}" />
      <div class="city-admin-panel__range-hints"><span>Chapel keeps all</span><span>Monastery-led</span></div>
      <p class="inspector-action-panel__hint">Lifetime: ${formatMonasteryTithePaidTotal(policy.tithePaidTotal)} · ${formatMonasteryPilgrimageTotal(policy.pilgrimageGoldTotal)} · ${formatMonasteryFoodCharityTotal(policy.foodCharityTotal)}</p>
    </div>
  `;
}
