import { STARTING_POPULATION } from '../../generated/gameBalance.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import {
  planFoundingStockyardRelocation,
  type FoundingStockyardRelocationPlan,
} from '../../logistics/foundingStockyardLogistics.ts';
import type { InspectableTarget } from '../types.ts';
import { buildingStorageRows } from './buildingCommon.ts';
import {
  hiddenDemolish,
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

function materialLabel(plan: FoundingStockyardRelocationPlan): string {
  if (plan.commodity === null) return 'material';
  return cargoKindLabel(plan.commodity);
}

function storageNeed(plan: FoundingStockyardRelocationPlan): string {
  switch (plan.commodity) {
    case 'timber':
    case 'stone':
    case 'firewood':
      return 'a Village Storehouse with intake enabled';
    case 'food':
    case 'grain':
    case 'barley':
    case 'flour':
    case 'preservedFood':
      return 'a Granary or another compatible provision store';
    case 'malt':
      return 'a Brewhouse with dry malt storage';
    case 'ale':
    case 'honey':
    case 'wine':
      return 'a Marketplace, Monastery, or compatible producer';
    case 'ironwork':
      return 'a Carpenter or Marketplace';
    case 'polearms':
      return 'a Guardhouse or Carpenter';
    case 'wool':
      return "a Weaver's Workshop or Pastoral Farmstead";
    case 'cloth':
      return "a Marketplace or Weaver's Workshop";
    case 'water':
      return 'a Well or water-using workshop';
    case null:
      return 'compatible permanent storage';
    default: {
      const unreachable: never = plan.commodity;
      return unreachable;
    }
  }
}

function permanentStorageStatus(
  plan: FoundingStockyardRelocationPlan,
  activeTrip: ReturnType<InspectorRenderContext['worldQueries']['getActiveDeliveryTrip']>,
  context: InspectorRenderContext,
): string {
  const plannedTarget = plan.targetBuildingId
    ? context.gameState.buildings.get(plan.targetBuildingId)
    : null;
  const plannedTargetLabel = plannedTarget
    ? context.worldQueries.getBuildingLabel(plannedTarget.kind)
    : 'compatible storage';
  switch (plan.blocker) {
    case 'active-trip': {
      if (!activeTrip) return 'Handcart active';
      const target = activeTrip.targetBuildingId
        ? context.gameState.buildings.get(activeTrip.targetBuildingId)
        : null;
      const destination = target
        ? context.worldQueries.getBuildingLabel(target.kind)
        : 'destination';
      return `${cargoKindLabel(activeTrip.cargoKind)} → ${destination} · ${formatTripPhaseLabel(activeTrip.phase)}`;
    }
    case 'shelters':
      return 'Relocation begins after every founder has a residence place';
    case 'empty':
      return 'Material yard empty';
    case 'reserved':
      return 'Remaining timber and stone are committed to construction or household improvements';
    case 'no-storage':
      return `Build ${storageNeed(plan)} before clearing ${materialLabel(plan).toLowerCase()}`;
    case 'intake-disabled':
      return `Enable ${materialLabel(plan).toLowerCase()} intake at a Village Storehouse`;
    case 'target-full':
      return `Create ${materialLabel(plan).toLowerCase()} room at ${storageNeed(plan)}`;
    case 'fire':
      return `Repair compatible storage for ${materialLabel(plan).toLowerCase()}`;
    case 'receiving':
      return 'Compatible storage is already receiving another cart';
    case 'disconnected':
      return `Connect the camp to ${storageNeed(plan)} by road`;
    case 'labor':
      return `${plan.targetRoom.toFixed(0)} ${materialLabel(plan).toLowerCase()} ready · awaiting one free hauler for ${plannedTargetLabel}`;
    case 'ready':
      return `${plan.targetRoom.toFixed(0)} ${materialLabel(plan).toLowerCase()} next · ${plannedTargetLabel} ${plan.routeDistance?.toFixed(0) ?? '?'} m by road`;
    default: {
      const unreachable: never = plan.blocker;
      return unreachable;
    }
  }
}

export function renderFoundersCampInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const shelterActive = building.foundingShelterActive !== false;
  const unhousedFounders = shelterActive
    ? Math.max(0, STARTING_POPULATION - context.populationStats.housed)
    : 0;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const relocationPlan = planFoundingStockyardRelocation({
    state: context.gameState,
    camp: building,
    activeTrip,
    availableLabor: context.populationStats.available,
    roadPathDistance: (ax, az, bx, bz) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
  });
  const hasStock = relocationPlan.pendingAmount > 1e-6 || building.gold > 1e-6;
  const completedTownHall = Array.from(context.gameState.buildings.values()).find(
    (candidate) =>
      candidate.kind === 'town_hall'
      && candidate.constructionComplete !== false,
  ) ?? null;
  const townHallRoadDistance = completedTownHall === null
    ? null
    : context.worldQueries.getRoadPathDistance(
        building.x,
        building.z,
        completedTownHall.x,
        completedTownHall.z,
      );
  const lockboxTrip = activeTrip?.cargoKind === 'gold' ? activeTrip : null;
  const lockboxStatus = lockboxTrip
    ? `${building.gold.toFixed(0)} gold on site · ${lockboxTrip.amount.toFixed(0)} travelling by handcart`
    : building.gold <= 1e-6
      ? 'Empty'
      : completedTownHall === null
        ? `${building.gold.toFixed(0)} gold · awaiting a completed Town Hall`
        : townHallRoadDistance === null
          ? `${building.gold.toFixed(0)} gold · connect the camp and Town Hall by road`
          : `${building.gold.toFixed(0)} gold · awaiting the next free hauler`;

  const status = activeTrip
    ? [`Handcart ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()}`, 'active'] as const
    : shelterActive
      ? [`${unhousedFounders} founder${unhousedFounders === 1 ? '' : 's'} awaiting a home`, 'warning'] as const
      : hasStock
        ? ['Shelters cleared · founding stores remain', 'ok'] as const
        : ['Empty · awaiting permanent civic storage', 'idle'] as const;

  return {
    eyebrow: shelterActive ? 'Settlement origin' : 'Temporary stockyard',
    title: shelterActive ? "Founders' camp" : 'Founding stockyard',
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      <li><span>Founding households</span><span>${STARTING_POPULATION} people · ${context.populationStats.housed} rehoused</span></li>
      <li><span>Shelter lifecycle</span><span>${shelterActive ? 'Tents clear after all founders have residence places' : 'All founders rehoused'}</span></li>
      <li><span>Construction supply</span><span>Free workers carry reserved loads by handcart; the founding stockyard can begin off-road</span></li>
      <li><span>Permanent storage</span><span>${permanentStorageStatus(relocationPlan, activeTrip, context)}</span></li>
      <li><span>Clearance order</span><span>Construction materials move first; provisions, drink, textiles, armaments, and water follow to compatible permanent stores</span></li>
      <li><span>Active cart</span><span>${activeTrip ? formatTripPhaseLabel(activeTrip.phase) : 'None'}</span></li>
      <li><span>Lockbox</span><span>${lockboxStatus}</span></li>
      ${buildingStorageRows(building, building.kind)}
      <li><span>Final clearance</span><span>After every cart returns, all founders are housed, the yard is empty, and both a Town Hall and Village Storehouse are complete</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
