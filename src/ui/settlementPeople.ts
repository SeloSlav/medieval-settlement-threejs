import { computePopulationStats } from '../resources/resourceTotals.ts';
import {
  residenceHasActiveProject,
  type GameState,
} from '../resources/types.ts';

export type SettlementPeopleView = Readonly<{
  total: number;
  available: number;
  assigned: number;
  builders: number;
  workplaceWorkers: number;
  homeProjectWorkers: number;
  haulers: number;
  sick: number;
  homes: number;
  occupiedHomes: number;
  openHomes: number;
  emptyHomes: number;
  housed: number;
  unhoused: number;
  housingCapacity: number;
  vacantPlaces: number;
  migrationLabel: string;
  signature: string;
}>;

export const EMPTY_SETTLEMENT_PEOPLE_VIEW: SettlementPeopleView = {
  total: 0,
  available: 0,
  assigned: 0,
  builders: 0,
  workplaceWorkers: 0,
  homeProjectWorkers: 0,
  haulers: 0,
  sick: 0,
  homes: 0,
  occupiedHomes: 0,
  openHomes: 0,
  emptyHomes: 0,
  housed: 0,
  unhoused: 0,
  housingCapacity: 0,
  vacantPlaces: 0,
  migrationLabel: 'Place the starter camp to found the settlement.',
  signature: '__people-unfounded__',
};

/**
 * Compact top-HUD labor and housing ledger. It deliberately avoids a monthly
 * migration promise: arrivals are residence-specific and can pause on local
 * household supplies. The card reports the truthful capacity and candidate
 * homes that govern that flow instead.
 */
export function buildSettlementPeopleView(
  state: GameState,
  established: boolean,
): SettlementPeopleView {
  if (!established) return EMPTY_SETTLEMENT_PEOPLE_VIEW;

  const population = computePopulationStats(state);
  let builders = 0;
  let workplaceWorkers = 0;
  for (const building of state.buildings.values()) {
    const labor = Math.max(0, Math.floor(building.assignedLabor));
    if (building.constructionComplete === false) builders += labor;
    else workplaceWorkers += labor;
  }

  let homeProjectWorkers = 0;
  let homes = 0;
  let occupiedHomes = 0;
  let openHomes = 0;
  let emptyHomes = 0;
  for (const residence of state.residences.values()) {
    if (residence.abandoned || residence.tier === 0) continue;
    homes += 1;
    if (residence.population > 0) occupiedHomes += 1;
    const vacancies = Math.max(0, residence.populationCapacity - residence.population);
    if (vacancies > 0) {
      openHomes += 1;
      if (residence.population === 0) emptyHomes += 1;
    }
    if (residenceHasActiveProject(residence)) {
      homeProjectWorkers += Math.max(
        0,
        Math.floor(residence.upgradeAssignedLabor ?? 0),
      );
    }
  }

  const unhoused = Math.max(0, population.total - population.housed);
  const migrantPlaces = Math.max(0, population.vacant - unhoused);
  const migrationLabel = unhoused > 0
    ? population.vacant <= 0
      ? `${unhoused} ${unhoused === 1 ? 'resident needs' : 'residents need'} a home before migration can resume.`
      : migrantPlaces > 0
        ? `${unhoused} ${unhoused === 1 ? 'founder rehouses' : 'founders rehouse'} first · ${migrantPlaces} ${migrantPlaces === 1 ? 'place remains' : 'places remain'} for migrants.`
        : `${unhoused} ${unhoused === 1 ? 'founder rehouses' : 'founders rehouse'} before new migrants.`
    : population.vacant <= 0
      ? 'No open living space for new settlers.'
      : emptyHomes > 0
        ? `${emptyHomes} empty ${emptyHomes === 1 ? 'home is' : 'homes are'} ready for arrivals.`
        : `${population.vacant} open ${population.vacant === 1 ? 'place can' : 'places can'} receive later arrivals.`;
  const signature = [
    population.total,
    population.available,
    population.assigned,
    builders,
    workplaceWorkers,
    homeProjectWorkers,
    population.cartAssigned,
    population.sick ?? 0,
    homes,
    occupiedHomes,
    openHomes,
    emptyHomes,
    population.housed,
    unhoused,
    population.housingCapacity,
    population.vacant,
    migrationLabel,
  ].join(':');

  return {
    total: population.total,
    available: population.available,
    assigned: population.assigned,
    builders,
    workplaceWorkers,
    homeProjectWorkers,
    haulers: population.cartAssigned,
    sick: population.sick ?? 0,
    homes,
    occupiedHomes,
    openHomes,
    emptyHomes,
    housed: population.housed,
    unhoused,
    housingCapacity: population.housingCapacity,
    vacantPlaces: population.vacant,
    migrationLabel,
    signature,
  };
}
