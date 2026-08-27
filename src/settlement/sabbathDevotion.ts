import { compareStableEntityIds, roadPathRoute } from '../logistics/roadLogistics.ts';
import { visibleGraveSitePlacements } from '../residences/graveyardLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { GraveyardState } from '../resources/types.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { SUNDAY_MASS_END_HOUR } from './chapelMass.ts';

export const SABBATH_DEVOTION_START_HOUR = SUNDAY_MASS_END_HOUR;
export const SABBATH_DEVOTION_END_HOUR = 16.5;
export const MAX_GRAVEYARD_VISITORS = 7;
export const DEVOTIONAL_PRAYER_SECONDS = 2.5;

const DEVOTION_SLOT_HOURS = 1.25;
const DEVOTION_ACTIVE_HOURS = 1.08;

export type SabbathDevotionKind = 'shrine' | 'graveyard';

/**
 * Gives every parishioner one stable afternoon opportunity after Sunday mass.
 * Destination caps are applied separately by the renderer, allowing successive
 * cohorts to disperse without turning a small shrine into another crowd scene.
 */
export function isSabbathDevotionTime(
  clock: Pick<GameClock, 'hour' | 'minute' | 'totalDays' | 'isSunday'>,
  sabbathObservedToday: boolean,
  personIdentity: string,
): boolean {
  if (!clock.isSunday || !sabbathObservedToday) return false;
  const hour = clock.hour + clock.minute / 60;
  if (hour < SABBATH_DEVOTION_START_HOUR || hour >= SABBATH_DEVOTION_END_HOUR) {
    return false;
  }

  const slotCount = Math.max(
    1,
    Math.floor(
      (SABBATH_DEVOTION_END_HOUR - SABBATH_DEVOTION_START_HOUR)
        / DEVOTION_SLOT_HOURS,
    ),
  );
  const seed = hashStringSeed(
    `sabbath-devotion-slot:${clock.totalDays}:${personIdentity}`,
  );
  const slot = seed % slotCount;
  const slotStart = SABBATH_DEVOTION_START_HOUR + slot * DEVOTION_SLOT_HOURS;
  return hour >= slotStart && hour < slotStart + DEVOTION_ACTIVE_HOURS;
}

/** Stable per-Sabbath split, used only when both destination types exist. */
export function sabbathDevotionPreference(
  totalDays: number,
  personIdentity: string,
): SabbathDevotionKind {
  return hashStringSeed(
    `sabbath-devotion-kind:${totalDays}:${personIdentity}`,
  ) % 2 === 0
    ? 'shrine'
    : 'graveyard';
}

export function sabbathDevotionObservanceKey(
  clock: Pick<GameClock, 'totalDays'>,
): string {
  return `sabbath:${clock.totalDays}`;
}

/**
 * Only occupied burial grounds belonging to an operational parish participate.
 * Empty consecrated parcels remain quiet until there is somebody to remember.
 */
export function operationalSabbathGraveyards(
  graveyards: Iterable<GraveyardState>,
  operationalChapelIds: ReadonlySet<string>,
): GraveyardState[] {
  return [...graveyards]
    .filter((graveyard) =>
      graveyard.burials > 0
      && operationalChapelIds.has(graveyard.chapelId)
    )
    .sort((left, right) => compareStableEntityIds(left.id, right.id));
}

export function indexSabbathGraveyardsByChapel(
  graveyards: readonly GraveyardState[],
): Map<string, GraveyardState[]> {
  const byChapel = new Map<string, GraveyardState[]>();
  for (const graveyard of graveyards) {
    const parishGrounds = byChapel.get(graveyard.chapelId);
    if (parishGrounds) parishGrounds.push(graveyard);
    else byChapel.set(graveyard.chapelId, [graveyard]);
  }
  return byChapel;
}

export function pickSabbathGraveyard(
  graveyards: readonly GraveyardState[],
  totalDays: number,
  personIdentity: string,
): GraveyardState | null {
  if (graveyards.length === 0) return null;
  const seed = hashStringSeed(
    `sabbath-graveyard:${totalDays}:${personIdentity}`,
  );
  return graveyards[seed % graveyards.length] ?? null;
}

export function graveyardPrayerPoint(
  graveyard: GraveyardState,
  visitorSlot: number,
): PointXZ & { yaw: number } {
  const sites = visibleGraveSitePlacements(graveyard);
  const slot = Math.max(
    0,
    Math.min(MAX_GRAVEYARD_VISITORS - 1, Math.floor(visitorSlot)),
  );
  if (sites.length === 0) {
    const center = graveyardCenter(graveyard);
    const angle = slot / MAX_GRAVEYARD_VISITORS * Math.PI * 2;
    const x = center.x + Math.sin(angle) * 1.25;
    const z = center.z + Math.cos(angle) * 1.25;
    return { x, z, yaw: Math.atan2(center.x - x, center.z - z) };
  }

  const siteIndex = Math.min(
    sites.length - 1,
    Math.floor((slot + 0.5) / MAX_GRAVEYARD_VISITORS * sites.length),
  );
  const site = sites[siteIndex]!;
  const side = slot % 2 === 0 ? -1 : 1;
  const lateralAngle = site.yaw + side * Math.PI * 0.5;
  const x = site.x + Math.sin(lateralAngle) * 0.72;
  const z = site.z + Math.cos(lateralAngle) * 0.72;
  return {
    x,
    z,
    yaw: Math.atan2(site.headX - x, site.headZ - z),
  };
}

export function graveyardDevotionPath(
  origin: PointXZ,
  graveyard: GraveyardState,
  visitorSlot: number,
  roadNetwork: RoadNetwork | null,
): PointXZ[] {
  const destination = graveyardPrayerPoint(graveyard, visitorSlot);
  if (roadNetwork) {
    const center = graveyardCenter(graveyard);
    const route = roadPathRoute(
      roadNetwork,
      origin.x,
      origin.z,
      center.x,
      center.z,
    );
    if (route && route.polyline.length >= 2) {
      return [
        ...route.polyline
          .slice(0, -1)
          .map((point) => ({ x: point.x, z: point.z })),
        destination,
      ];
    }
  }
  return [
    { x: origin.x, z: origin.z },
    destination,
  ];
}

function graveyardCenter(graveyard: GraveyardState): PointXZ {
  let x = 0;
  let z = 0;
  for (const corner of graveyard.corners) {
    x += corner.x;
    z += corner.z;
  }
  return {
    x: x / graveyard.corners.length,
    z: z / graveyard.corners.length,
  };
}
