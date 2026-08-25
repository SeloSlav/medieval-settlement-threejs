import {
  CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
} from '../generated/gameBalance.ts';
import {
  parseBuildingServerId,
  parseFarmFieldServerId,
} from '../data/spacetimeIds.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type {
  BuildingState,
  FarmFieldState,
  GameState,
  LivestockHerdState,
} from '../resources/types.ts';
import { fieldCentroid } from './farmFieldMath.ts';

export type CattleFieldSupport = {
  buildingId: string;
  distance: number;
  ploughWorkMultiplier: number;
};

type CattleSupportState = Pick<GameState, 'buildings' | 'farmFields' | 'livestockHerds'>;

function eligibleCattleHerd(herd: LivestockHerdState): boolean {
  return herd.species === 'cattle'
    && herd.headCount >= 2
    && herd.health >= 0.65
    && herd.suppliedCapacity >= 2;
}

function compareServerIds(
  a: string,
  b: string,
  parse: (id: string) => bigint | null,
): number {
  const numericA = parse(a);
  const numericB = parse(b);
  if (numericA !== null && numericB !== null) {
    return numericA < numericB ? -1 : numericA > numericB ? 1 : 0;
  }
  return compareStableEntityIds(a, b);
}

function fieldRanksAhead(candidate: FarmFieldState, incumbent: FarmFieldState): boolean {
  return candidate.priority > incumbent.priority
    || (
      candidate.priority === incumbent.priority
      && compareServerIds(candidate.id, incumbent.id, parseFarmFieldServerId) < 0
    );
}

/**
 * Mirrors the authoritative bounded cattle-support selection: each viable
 * herd helps only the highest-priority nearby fields, with stable field-id
 * ordering as the tie-breaker.
 */
export function selectCattleSupportedFields(
  building: BuildingState,
  herd: LivestockHerdState,
  fields: Iterable<FarmFieldState>,
): Array<{ field: FarmFieldState; distance: number }> {
  if (!eligibleCattleHerd(herd)) return [];

  const selected: Array<{ field: FarmFieldState; distance: number }> = [];
  for (const field of fields) {
    const center = fieldCentroid(field.corners);
    const distance = Math.hypot(building.x - center.x, building.z - center.z);
    if (distance > building.workRadius) continue;

    const insertion = selected.findIndex(({ field: incumbent }) => (
      fieldRanksAhead(field, incumbent)
    ));
    if (insertion >= 0 && insertion < CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS) {
      selected.splice(insertion, 0, { field, distance });
      selected.length = Math.min(selected.length, CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS);
    } else if (selected.length < CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS) {
      selected.push({ field, distance });
    }
  }
  return selected;
}

export function computeCattleFieldSupport(
  state: CattleSupportState,
): Map<string, CattleFieldSupport> {
  const cattleByBuilding = new Map<string, LivestockHerdState[]>();
  for (const herd of state.livestockHerds.values()) {
    if (herd.species !== 'cattle') continue;
    const linked = cattleByBuilding.get(herd.buildingId) ?? [];
    linked.push(herd);
    cattleByBuilding.set(herd.buildingId, linked);
  }
  const eligibleHoldings: Array<{ building: BuildingState; herd: LivestockHerdState }> = [];
  for (const [buildingId, herds] of cattleByBuilding) {
    const headCount = herds.reduce((sum, herd) => sum + herd.headCount, 0);
    const suppliedCapacity = herds.reduce((sum, herd) => sum + herd.suppliedCapacity, 0);
    const health = headCount > 0
      ? herds.reduce((sum, herd) => sum + herd.health * herd.headCount, 0) / headCount
      : 0;
    const herd = {
      ...herds[0]!,
      headCount,
      suppliedCapacity,
      health,
    };
    if (!eligibleCattleHerd(herd)) continue;
    const building = state.buildings.get(buildingId);
    if (building) eligibleHoldings.push({ building, herd });
  }
  if (eligibleHoldings.length === 0) return new Map();

  const support = new Map<string, CattleFieldSupport>();
  for (const { building, herd } of eligibleHoldings) {
    for (const { field, distance } of selectCattleSupportedFields(
      building,
      herd,
      state.farmFields.values(),
    )) {
      const existing = support.get(field.id);
      if (
        existing
        && (
          existing.distance < distance - 1e-6
          || (
            Math.abs(existing.distance - distance) <= 1e-6
            && compareServerIds(
              existing.buildingId,
              building.id,
              parseBuildingServerId,
            ) <= 0
          )
        )
      ) {
        continue;
      }
      support.set(field.id, {
        buildingId: building.id,
        distance,
        ploughWorkMultiplier: CATTLE_PLOUGH_WORK_MULTIPLIER,
      });
    }
  }
  return support;
}
