import { STARTING_POPULATION } from '../../generated/gameBalance.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import type { InspectableTarget } from '../types.ts';
import { buildingStorageRows } from './buildingCommon.ts';
import {
  hiddenDemolish,
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

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
  const hasMaterial = building.timber + building.stone > 1e-6;
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
      <li><span>Active cart</span><span>${activeTrip ? formatTripPhaseLabel(activeTrip.phase) : 'None'}</span></li>
      <li><span>Lockbox</span><span>${lockboxStatus}</span></li>
      ${buildingStorageRows(building, building.kind)}
      <li><span>Final clearance</span><span>After every cart returns, the stockyard is empty, and both a Town Hall and Village Storehouse are complete</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
