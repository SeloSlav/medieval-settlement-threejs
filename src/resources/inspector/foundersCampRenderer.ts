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
  return plan.commodity[0].toUpperCase() + plan.commodity.slice(1);
}

function permanentStorageStatus(
  plan: FoundingStockyardRelocationPlan,
  activeTrip: ReturnType<InspectorRenderContext['worldQueries']['getActiveDeliveryTrip']>,
  context: InspectorRenderContext,
): string {
  switch (plan.blocker) {
    case 'active-trip': {
      if (!activeTrip) return 'Handcart active';
      const target = activeTrip.targetBuildingId
        ? context.gameState.buildings.get(activeTrip.targetBuildingId)
        : null;
      const destination = target?.kind === 'village_storehouse'
        ? 'Village Storehouse'
        : target?.kind === 'town_hall'
          ? 'Town Hall'
          : 'construction site';
      return `${cargoKindLabel(activeTrip.cargoKind)} â†’ ${destination} Â· ${formatTripPhaseLabel(activeTrip.phase)}`;
    }
    case 'shelters':
      return 'Relocation begins after every founder has a residence place';
    case 'empty':
      return 'Material yard empty';
    case 'reserved':
      return 'Remaining timber and stone are committed to construction or household improvements';
    case 'no-storehouse':
      return 'Build a Village Storehouse before clearing the open yard';
    case 'intake-disabled':
      return `Enable ${materialLabel(plan).toLowerCase()} intake at a Village Storehouse`;
    case 'target-full':
      return `Create ${materialLabel(plan).toLowerCase()} room or raise a storehouse collection target`;
    case 'fire':
      return 'Repair a compatible fire-disabled Village Storehouse';
    case 'receiving':
      return 'Compatible storehouses are already receiving another cart';
    case 'disconnected':
      return 'Connect the camp to a compatible Village Storehouse by road';
    case 'labor':
      return `${plan.targetRoom.toFixed(0)} ${materialLabel(plan).toLowerCase()} ready Â· awaiting one free hauler`;
    case 'ready':
      return `${plan.targetRoom.toFixed(0)} ${materialLabel(plan).toLowerCase()} next Â· nearest storehouse ${plan.routeDistance?.toFixed(0) ?? '?'} m by road`;
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
  const hasMaterial = relocationPlan.pendingAmount > 1e-6;
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
      : hasMaterial
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
      <li><span>Active cart</span><span>${activeTrip ? formatTripPhaseLabel(activeTrip.phase) : 'None'}</span></li>
      <li><span>Lockbox</span><span>${lockboxStatus}</span></li>
      ${buildingStorageRows(building, building.kind)}
      <li><span>Final clearance</span><span>After every cart returns, all founders are housed, the yard is empty, and both a Town Hall and Village Storehouse are complete</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
