import { BUILDING_DEFINITIONS, type BuildingKind } from '../generated/gameBalance.ts';
import type {
  BuildingState,
  FarmFieldState,
  PastureState,
  ResidenceState,
  VineyardParcelState,
} from '../resources/types.ts';
import {
  resolveWorldDimensions,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';
import {
  SUBREGION_DEFINITIONS,
  SUBREGION_KINDS,
  naturalWoodlandFraction,
  subregionDefinition,
  type SubregionKind,
} from './subregionField.ts';

export type LandUseProfile = {
  shares: Record<SubregionKind, number>;
  bonuses: Record<SubregionKind, number>;
  totalArea: number;
  claimedArea: number;
};

export type LandUseState = {
  buildings: Iterable<Pick<BuildingState, 'kind' | 'constructionComplete'>>;
  residences: Iterable<Pick<ResidenceState, 'tier'>>;
  farmFields: Iterable<Pick<FarmFieldState, 'area'>>;
  pastures: Iterable<Pick<PastureState, 'area'>>;
  vineyardParcels?: Iterable<Pick<VineyardParcelState, 'area'>>;
};

export const RURAL_BUILDING_KINDS = new Set<BuildingKind>([
  'founders_camp',
  'salvage_pile',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'well',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'wayside_shrine',
  'stable',
  'watchtower',
  'palisaded_refuge',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
  'apiary',
  'watermill',
  'windmill',
]);

export const RESIDENCE_RURAL_AREA = 420;
export const RESIDENCE_URBAN_AREA = 320;
export const BUILDING_RURAL_MARGIN = 9;
export const BUILDING_URBAN_MARGIN = 12;

const AFFINITY_SENSITIVITY: Record<SubregionKind, number> = {
  meadow: 0.34,
  woodland: 0.32,
  farmland: 0.75,
  rural: 0.60,
  urban: 0.60,
};

let publishedProfile: LandUseProfile | null = null;
const listeners = new Set<() => void>();

export function computeLandUseProfile(
  settings: Pick<WorldGenerationSettings, 'mapSize' | 'forestDensity'>,
  state: LandUseState,
): LandUseProfile {
  const generationSize = resolveWorldDimensions(settings.mapSize).generationSize;
  const totalArea = generationSize * generationSize;
  let farmlandArea = sumFiniteAreas(state.farmFields);
  farmlandArea += sumFiniteAreas(state.vineyardParcels ?? []);
  let ruralArea = sumFiniteAreas(state.pastures);
  let urbanArea = 0;

  for (const building of state.buildings) {
    const definition = BUILDING_DEFINITIONS[building.kind];
    if (!definition) continue;
    const rural = RURAL_BUILDING_KINDS.has(building.kind);
    const margin = rural ? BUILDING_RURAL_MARGIN : BUILDING_URBAN_MARGIN;
    const claim = Math.PI * (definition.pickRadius + margin) ** 2;
    if (rural) ruralArea += claim;
    else urbanArea += claim;
  }
  for (const residence of state.residences) {
    if (residence.tier >= 3) urbanArea += RESIDENCE_URBAN_AREA;
    else ruralArea += RESIDENCE_RURAL_AREA;
  }

  farmlandArea = Math.max(0, farmlandArea);
  ruralArea = Math.max(0, ruralArea);
  urbanArea = Math.max(0, urbanArea);
  const rawClaimedArea = farmlandArea + ruralArea + urbanArea;
  const claimScale = rawClaimedArea > totalArea ? totalArea / rawClaimedArea : 1;
  farmlandArea *= claimScale;
  ruralArea *= claimScale;
  urbanArea *= claimScale;
  const claimedArea = farmlandArea + ruralArea + urbanArea;
  const naturalArea = Math.max(0, totalArea - claimedArea);
  const woodlandArea = naturalArea * naturalWoodlandFraction(settings.forestDensity);
  const meadowArea = naturalArea - woodlandArea;
  const shares: Record<SubregionKind, number> = {
    meadow: meadowArea / totalArea,
    woodland: woodlandArea / totalArea,
    farmland: farmlandArea / totalArea,
    rural: ruralArea / totalArea,
    urban: urbanArea / totalArea,
  };
  const bonuses = Object.fromEntries(SUBREGION_KINDS.map((kind) => [
    kind,
    Math.min(subregionDefinition(kind).maximumBonus, shares[kind] * AFFINITY_SENSITIVITY[kind]),
  ])) as Record<SubregionKind, number>;
  return { shares, bonuses, totalArea, claimedArea };
}

export function emptyLandUseProfile(
  settings: Pick<WorldGenerationSettings, 'mapSize' | 'forestDensity'>,
): LandUseProfile {
  return computeLandUseProfile(settings, {
    buildings: [], residences: [], farmFields: [], pastures: [], vineyardParcels: [],
  });
}

export function publishLandUseProfile(profile: LandUseProfile): void {
  publishedProfile = profile;
  for (const listener of listeners) listener();
}

export function getPublishedLandUseProfile(): LandUseProfile | null {
  return publishedProfile;
}

export function subscribeLandUseProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function describeLandUseProfile(profile: LandUseProfile): string {
  return SUBREGION_DEFINITIONS.map((definition) => {
    const share = Math.round(profile.shares[definition.kind] * 100);
    const bonus = Math.round(profile.bonuses[definition.kind] * 100);
    return `${definition.label} ${share}% (+${bonus}% ${definition.affinity.toLowerCase()})`;
  }).join(' · ');
}

function sumFiniteAreas(values: Iterable<{ area: number }>): number {
  let total = 0;
  for (const value of values) {
    if (Number.isFinite(value.area)) total += Math.max(0, value.area);
  }
  return total;
}
