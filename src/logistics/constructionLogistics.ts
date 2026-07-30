import type { BuildingState } from '../resources/types.ts';
import { compareStableEntityIds } from './roadLogistics.ts';
import {
  carpenterCartServiceIronworkTarget,
  carpenterCartServiceTimberTarget,
} from '../economy/carpenterSupport.ts';

export type ConstructionSourceLike = Pick<
  BuildingState,
  'id' | 'kind' | 'assignedLabor'
>;

export type ConstructionMaterial = 'timber' | 'stone' | 'ironwork';
export type ConstructionStockSourceLike = ConstructionSourceLike
  & Pick<
    BuildingState,
    'timber' | 'stone' | 'ironwork' | 'carpenterCartServiceTargetTrips'
  >;

export type RoutedConstructionSource<T extends ConstructionSourceLike> = {
  source: T;
  routeDistance: number;
};

/**
 * Existing construction sourcing preference, kept explicit for client/server
 * parity: founding stockyards, reclamation piles, and storehouses first, then
 * carpenters, primary producers, and other stores. An unstaffed source needs a
 * free settlement hauler and follows its staffed counterpart in the same class order.
 */
export function constructionSourcePriority(source: ConstructionSourceLike): number {
  const kindPriority = source.kind === 'founders_camp'
    || source.kind === 'salvage_pile'
    || source.kind === 'village_storehouse'
    ? 0
    : source.kind === 'carpenter'
      ? 1
      : source.kind === 'lumber_mill'
        || source.kind === 'stone_quarry'
        || source.kind === 'large_quarry'
        ? 2
        : 3;
  return source.assignedLabor > 0 ? kindPriority : kindPriority + 4;
}

export function constructionSourceAvailableStock(
  source: ConstructionStockSourceLike,
  material: ConstructionMaterial,
): number {
  const stock = Math.max(0, source[material] ?? 0);
  const serviceReserve = source.kind === 'carpenter'
    ? material === 'timber'
      ? carpenterCartServiceTimberTarget(
          source.carpenterCartServiceTargetTrips,
        )
      : material === 'ironwork'
        ? carpenterCartServiceIronworkTarget(
            source.carpenterCartServiceTargetTrips,
          )
        : 0
    : 0;
  return Math.max(0, stock - serviceReserve);
}

/**
 * Selects one construction source without sorting the entire settlement.
 *
 * Route queries are limited to the highest source-priority class that has a
 * reachable candidate. Within that class, real haul distance and stable id
 * determine the winner.
 */
export function selectConstructionRouteSource<T extends ConstructionSourceLike>(
  sources: readonly T[],
  routeDistanceFor: (source: T) => number | null,
): RoutedConstructionSource<T> | null {
  const groups: T[][] = Array.from({ length: 8 }, () => []);
  for (const source of sources) {
    groups[constructionSourcePriority(source)].push(source);
  }

  for (const group of groups) {
    let best: RoutedConstructionSource<T> | null = null;
    for (const source of group) {
      const routeDistance = routeDistanceFor(source);
      if (routeDistance == null) continue;
      if (
        best == null
        || routeDistance + 1e-6 < best.routeDistance
        || (
          Math.abs(routeDistance - best.routeDistance) <= 1e-6
          && compareStableEntityIds(source.id, best.source.id) < 0
        )
      ) {
        best = { source, routeDistance };
      }
    }
    if (best) return best;
  }

  return null;
}
