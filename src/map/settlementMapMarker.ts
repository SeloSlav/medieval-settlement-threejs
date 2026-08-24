import type { BuildingState, ResidenceState, SettlementState } from '../resources/types.ts';

export type SettlementMapMarkerTier = 'founders' | 'hamlet' | 'village' | 'town';

export type SettlementMapMarker = {
  settlementId?: string;
  x: number;
  z: number;
  tier: SettlementMapMarkerTier;
  label: string;
  residenceCount: number;
  population: number;
};

export type PersistentSettlementMapMarker = SettlementMapMarker & {
  settlementId: string;
  name: string;
};

type SettlementResidence = Pick<
  ResidenceState,
  'id' | 'settlementId' | 'x' | 'z' | 'tier' | 'population'
>;
type SettlementBuilding = Pick<
  BuildingState,
  'id' | 'kind' | 'x' | 'z' | 'constructionComplete'
>;

export type SettlementMapMarkerInput = {
  residences: Iterable<SettlementResidence>;
  buildings: Iterable<SettlementBuilding>;
};

export type PersistentSettlementMapMarkerInput = SettlementMapMarkerInput & {
  settlements: Iterable<SettlementState>;
};

/** One stable emblem per authoritative community; camps may disappear, towns do not. */
export function deriveSettlementMapMarkers(
  input: PersistentSettlementMapMarkerInput,
): PersistentSettlementMapMarker[] {
  const residences = [...input.residences];
  const buildings = [...input.buildings];
  return [...input.settlements]
    .filter((settlement) => settlement.active)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((settlement) => {
      const memberHomes = residences.filter((residence) =>
        residence.settlementId === settlement.id && residence.tier > 0);
      const population = memberHomes.reduce(
        (sum, residence) => sum + Math.max(0, residence.population),
        0,
      );
      const tier = memberHomes.length === 0
        ? 'founders'
        : settlementTier(memberHomes.length, population);
      const memberCenter = weightedMemberCenter(memberHomes);
      const camp = settlement.foundingCampId
        ? buildings.find((building) => building.id === settlement.foundingCampId)
        : undefined;
      const x = memberCenter?.x ?? camp?.x ?? settlement.anchorX;
      const z = memberCenter?.z ?? camp?.z ?? settlement.anchorZ;
      const homeLabel = memberHomes.length === 1 ? 'home' : 'homes';
      const residentLabel = population === 1 ? 'resident' : 'residents';
      return {
        settlementId: settlement.id,
        name: settlement.name,
        x,
        z,
        tier,
        label: tier === 'founders'
          ? `${settlement.name} · founding community · ${settlement.unhousedFounders} at camp`
          : `${settlement.name} · ${memberHomes.length} ${homeLabel} · ${population} ${residentLabel}`,
        residenceCount: memberHomes.length,
        population,
      };
    });
}

function weightedMemberCenter(
  residences: readonly SettlementResidence[],
): { x: number; z: number } | null {
  if (residences.length === 0) return null;
  let x = 0;
  let z = 0;
  let weight = 0;
  for (const residence of residences) {
    const residenceWeight = 1 + residence.tier * 0.38 + Math.max(0, residence.population) * 0.11;
    x += residence.x * residenceWeight;
    z += residence.z * residenceWeight;
    weight += residenceWeight;
  }
  return { x: x / weight, z: z / weight };
}

/** Nearby completed homes belong to one readable residential settlement. */
export const SETTLEMENT_RESIDENCE_LINK_RADIUS = 115;

/**
 * Resolves one primary settlement emblem for the first-person map.
 * A founders' camp is the fallback until the first completed home exists;
 * afterwards the largest inhabited residential cluster owns the marker.
 */
export function deriveSettlementMapMarker(
  input: SettlementMapMarkerInput,
): SettlementMapMarker | null {
  const residences = Array.from(input.residences)
    .filter((residence) => residence.tier > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (residences.length === 0) {
    return foundersCampMarker(input.buildings);
  }

  const cluster = primaryResidenceCluster(residences);
  const tier = settlementTier(cluster.residenceCount, cluster.population);
  const residenceLabel = cluster.residenceCount === 1 ? 'home' : 'homes';
  const populationLabel = cluster.population === 1 ? 'resident' : 'residents';
  return {
    x: cluster.x,
    z: cluster.z,
    tier,
    label: `${settlementTierLabel(tier)} · ${cluster.residenceCount} ${residenceLabel} · ${cluster.population} ${populationLabel}`,
    residenceCount: cluster.residenceCount,
    population: cluster.population,
  };
}

function foundersCampMarker(
  buildings: Iterable<SettlementBuilding>,
): SettlementMapMarker | null {
  const camp = Array.from(buildings)
    .filter((building) => building.kind === 'founders_camp')
    .sort((a, b) => {
      const completionOrder = Number(b.constructionComplete) - Number(a.constructionComplete);
      return completionOrder || a.id.localeCompare(b.id);
    })[0];
  if (!camp) return null;
  return {
    x: camp.x,
    z: camp.z,
    tier: 'founders',
    label: "Founders' camp · settlement origin",
    residenceCount: 0,
    population: 0,
  };
}

type ResidenceClusterPresentation = {
  x: number;
  z: number;
  residenceCount: number;
  population: number;
  score: number;
  stableId: string;
};

function primaryResidenceCluster(
  residences: readonly SettlementResidence[],
): ResidenceClusterPresentation {
  const cellSize = SETTLEMENT_RESIDENCE_LINK_RADIUS;
  const radiusSquared = SETTLEMENT_RESIDENCE_LINK_RADIUS ** 2;
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < residences.length; index++) {
    const residence = residences[index];
    const key = spatialKey(
      Math.floor(residence.x / cellSize),
      Math.floor(residence.z / cellSize),
    );
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  }

  const visited = new Uint8Array(residences.length);
  let best: ResidenceClusterPresentation | null = null;
  for (let startIndex = 0; startIndex < residences.length; startIndex++) {
    if (visited[startIndex] === 1) continue;
    visited[startIndex] = 1;
    const queue = [startIndex];
    const memberIndices: number[] = [];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentIndex = queue[cursor];
      const current = residences[currentIndex];
      memberIndices.push(currentIndex);
      const cellX = Math.floor(current.x / cellSize);
      const cellZ = Math.floor(current.z / cellSize);

      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const candidates = buckets.get(spatialKey(cellX + offsetX, cellZ + offsetZ));
          if (!candidates) continue;
          for (const candidateIndex of candidates) {
            if (visited[candidateIndex] === 1) continue;
            const candidate = residences[candidateIndex];
            const distanceSquared = (candidate.x - current.x) ** 2
              + (candidate.z - current.z) ** 2;
            if (distanceSquared > radiusSquared) continue;
            visited[candidateIndex] = 1;
            queue.push(candidateIndex);
          }
        }
      }
    }

    const presentation = describeResidenceCluster(residences, memberIndices);
    if (
      !best
      || presentation.score > best.score + 1e-6
      || (
        Math.abs(presentation.score - best.score) <= 1e-6
        && presentation.stableId.localeCompare(best.stableId) < 0
      )
    ) {
      best = presentation;
    }
  }

  return best!;
}

function describeResidenceCluster(
  residences: readonly SettlementResidence[],
  memberIndices: readonly number[],
): ResidenceClusterPresentation {
  let weightedX = 0;
  let weightedZ = 0;
  let totalWeight = 0;
  let population = 0;
  let tierScore = 0;
  for (const index of memberIndices) {
    const residence = residences[index];
    const residentCount = Math.max(0, residence.population);
    const weight = 1 + residence.tier * 0.38 + residentCount * 0.11;
    weightedX += residence.x * weight;
    weightedZ += residence.z * weight;
    totalWeight += weight;
    population += residentCount;
    tierScore += residence.tier;
  }
  const x = weightedX / Math.max(totalWeight, 1e-6);
  const z = weightedZ / Math.max(totalWeight, 1e-6);
  let radiusSquaredSum = 0;
  for (const index of memberIndices) {
    const residence = residences[index];
    radiusSquaredSum += (residence.x - x) ** 2 + (residence.z - z) ** 2;
  }
  const radius = Math.sqrt(radiusSquaredSum / Math.max(memberIndices.length, 1));
  return {
    x,
    z,
    residenceCount: memberIndices.length,
    population,
    // Size wins first, then actual inhabitants and upgraded homes; the small
    // spread penalty breaks near-ties in favor of the denser neighborhood.
    score: memberIndices.length * 10 + population * 1.25 + tierScore * 0.7 - radius * 0.018,
    stableId: residences[memberIndices[0]].id,
  };
}

function settlementTier(
  residenceCount: number,
  population: number,
): Exclude<SettlementMapMarkerTier, 'founders'> {
  if (residenceCount >= 18 || population >= 60) return 'town';
  if (residenceCount >= 6 || population >= 18) return 'village';
  return 'hamlet';
}

function settlementTierLabel(tier: Exclude<SettlementMapMarkerTier, 'founders'>): string {
  if (tier === 'town') return 'Town center';
  if (tier === 'village') return 'Village center';
  return 'Hamlet center';
}

function spatialKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}
