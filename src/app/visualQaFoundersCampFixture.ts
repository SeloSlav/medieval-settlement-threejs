import type { BuildingState, GameState } from '../resources/types.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import { selectFoundingSite } from '../world/worldBootstrapData.ts';
import { STARTING_STONE, STARTING_TIMBER } from '../generated/gameBalance.ts';

export const VISUAL_QA_FOUNDERS_CAMP_ID = 'visual-qa-founders-camp-fixture';

/**
 * Presentation-only fallback for development visual-QA captures. It never
 * enters GameState or a server snapshot and is omitted when a real camp exists.
 */
export function createVisualQaFoundersCampFixture(
  worldLayout: WorldLayout,
  getHeightAt: (x: number, z: number) => number,
): BuildingState {
  const site = selectFoundingSite(worldLayout, getHeightAt);
  return {
    id: VISUAL_QA_FOUNDERS_CAMP_ID,
    kind: 'founders_camp',
    x: site.x,
    z: site.z,
    workRadius: 0,
    actionCooldown: 0,
    timber: STARTING_TIMBER,
    firewood: 24,
    stone: STARTING_STONE,
    water: 0,
    food: 0,
    ale: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    gold: 8,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    foundingShelterActive: true,
  };
}

export function withVisualQaFoundersCamp(
  buildings: Iterable<BuildingState>,
  fixture: BuildingState,
): readonly BuildingState[] {
  const presented = [...buildings];
  if (!presented.some((building) => building.kind === 'founders_camp')) {
    presented.push(fixture);
  }
  return presented;
}

export function withVisualQaFoundersCampState(
  state: GameState,
  fixture: BuildingState,
): GameState {
  if ([...state.buildings.values()].some(
    (building) => building.kind === 'founders_camp',
  )) {
    return state;
  }
  const buildings = new Map(state.buildings);
  buildings.set(fixture.id, fixture);
  return { ...state, buildings };
}
