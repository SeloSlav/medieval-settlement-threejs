import {
  GAME_HABITAT_DEPOSIT_CLEARANCE,
  type ForagingSite,
} from '../foraging/ForagingLayout.ts';
import type { QuarrySite } from '../quarries/QuarryLayout.ts';
import type { ResourceNodeDefinition } from '../resources/types.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { CENTRAL_CLEARING_RADIUS } from '../props/forestField.ts';
import {
  regionalPlacementAffinity,
  type ResourcePlacementTarget,
} from '../world/resourceRegionDistribution.ts';

export type ClayDepositSite = {
  x: number;
  z: number;
  rotation: number;
  kind: 'ordinary' | 'rich';
  formation: 'alluvial' | 'coastal' | 'inland_basin';
  radiusX: number;
  radiusZ: number;
};

export type ClayDepositLayoutOptions = {
  riverLayout: RiverLayout;
  quarrySites?: readonly QuarrySite[];
  foragingSites?: readonly ForagingSite[];
  playableHalf?: number;
  seed?: number;
  ordinarySiteCount?: number;
  richSiteCount?: number;
  /** Soft regional targets, ordered rich sites first and ordinary sites second. */
  placementTargets?: readonly ResourcePlacementTarget[];
};

const PLAYABLE_EDGE_CLEARANCE = 34;
const RESOURCE_CLEARANCE = 78;
const RICH_BANK_RADIUS_X = 19;
const RICH_BANK_RADIUS_Z = 12;
const ORDINARY_BANK_RADIUS_X = 14;
const ORDINARY_BANK_RADIUS_Z = 9;
const MIN_CLAY_BANK_SPACING = 54;
export const RICH_CLAY_DEPOSIT_RADIUS = 24;
export const CLAY_DEPOSIT_CENTER_TOLERANCE = 2.5;
export const CLAY_DEPOSIT_SNAP_RADIUS = 58;
export const ORDINARY_CLAY_DEPOSIT_MAX_YIELD = 1_200;
export const COASTAL_CLAY_DEPOSIT_MAX_YIELD = 1_000;
export const INLAND_CLAY_DEPOSIT_MAX_YIELD = 720;
export const RICH_CLAY_DEPOSIT_MAX_YIELD = 3_600;

export function clayDepositNodeId(site: ClayDepositSite, index: number): string {
  return `clay-${site.kind}-${index}`;
}

export function clayDepositLabel(site: ClayDepositSite): string {
  const formation = site.formation === 'coastal'
    ? 'coastal clay deposit'
    : site.formation === 'inland_basin'
      ? 'inland clay deposit'
      : 'clay deposit';
  return site.kind === 'rich'
    ? `Rich ${formation}`
    : formation[0].toUpperCase() + formation.slice(1);
}

export function clayDepositMaxYield(site: ClayDepositSite): number {
  if (site.kind === 'rich') return RICH_CLAY_DEPOSIT_MAX_YIELD;
  if (site.formation === 'inland_basin') return INLAND_CLAY_DEPOSIT_MAX_YIELD;
  if (site.formation === 'coastal') return COASTAL_CLAY_DEPOSIT_MAX_YIELD;
  return ORDINARY_CLAY_DEPOSIT_MAX_YIELD;
}

export function clayDepositDefinition(
  site: ClayDepositSite,
  index: number,
): ResourceNodeDefinition {
  return {
    id: clayDepositNodeId(site, index),
    kind: 'quarry',
    resource: 'clay',
    x: site.x,
    z: site.z,
    label: clayDepositLabel(site),
    maxYield: clayDepositMaxYield(site),
    pickRadius: Math.max(site.radiusX, site.radiusZ) + 6,
    isRich: site.kind === 'rich',
  };
}

export function clayDepositAtCenter(
  sites: readonly ClayDepositSite[],
  x: number,
  z: number,
): ClayDepositSite | null {
  let nearest: ClayDepositSite | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const distance = Math.hypot(site.x - x, site.z - z);
    if (
      distance > CLAY_DEPOSIT_CENTER_TOLERANCE
      || distance >= nearestDistance
    ) {
      continue;
    }
    nearest = site;
    nearestDistance = distance;
  }
  return nearest;
}

export function nearestClayDeposit(
  sites: readonly ClayDepositSite[],
  x: number,
  z: number,
  maxDistance = CLAY_DEPOSIT_SNAP_RADIUS,
): ClayDepositSite | null {
  let nearest: ClayDepositSite | null = null;
  let nearestDistance = Math.max(0, maxDistance);
  for (const site of sites) {
    const distance = Math.hypot(site.x - x, site.z - z);
    if (distance > nearestDistance) continue;
    nearest = site;
    nearestDistance = distance;
  }
  return nearest;
}

/**
 * Deterministic clay deposits follow river alluvium or coastal sediment where
 * surface water exists. Waterless maps use smaller finite lenses in old inland
 * drainage basins, so ordinary clay remains locally available without making a
 * dry map as clay-rich as a river valley. Rich grades come from the shared
 * size-based resource budget.
 */
export class ClayDepositLayout {
  readonly sites: readonly ClayDepositSite[];
  readonly seed: number;

  private constructor(seed: number, sites: ClayDepositSite[]) {
    this.seed = seed;
    this.sites = sites;
  }

  static create(options: ClayDepositLayoutOptions): ClayDepositLayout {
    const seed = options.seed ?? 0x43a7c1;
    const playableHalf = options.playableHalf ?? 410;
    const avoidSites = [
      ...(options.quarrySites ?? []),
      ...(options.foragingSites ?? []),
    ];
    const candidates = [
      ...collectBankCandidates(options.riverLayout, playableHalf, seed),
      ...collectCoastalClayCandidates(options.riverLayout, playableHalf, seed),
      ...collectDryClayCandidates(options.riverLayout, playableHalf, seed),
    ];
    const richSiteCount = Math.max(0, Math.min(40, Math.floor(options.richSiteCount ?? 1)));
    const ordinarySiteCount = Math.max(0, Math.min(40, Math.floor(options.ordinarySiteCount ?? 1)));
    const grades: ClayDepositSite['kind'][] = [
      ...Array.from({ length: richSiteCount }, () => 'rich' as const),
      ...Array.from({ length: ordinarySiteCount }, () => 'ordinary' as const),
    ];
    const rankedCandidates = candidates.sort((a, b) => b.score - a.score);
    const sites: ClayDepositSite[] = [];

    for (let index = 0; index < grades.length; index++) {
      const grade = grades[index];
      const placementTarget = options.placementTargets?.[index];
      const selected = bestRegionalClayCandidate(
        rankedCandidates.filter((candidate) =>
          hasResourceClearance(candidate, avoidSites)
          && hasGameHabitatClearance(candidate, grade, options.foragingSites ?? [])
          && hasClayBankClearance(candidate, sites)
        ),
        placementTarget,
      ) ?? bestRegionalClayCandidate(
        rankedCandidates.filter((candidate) =>
          hasGameHabitatClearance(candidate, grade, options.foragingSites ?? [])
          && hasClayBankClearance(candidate, sites)
        ),
        placementTarget,
      );
      if (!selected) continue;
      const radii = clayDepositRadii(grade, selected.formation);
      sites.push({
        x: selected.x,
        z: selected.z,
        rotation: selected.rotation,
        kind: grade,
        formation: selected.formation,
        radiusX: radii.radiusX,
        radiusZ: radii.radiusZ,
      });
    }

    return new ClayDepositLayout(seed, sites);
  }

  isRichAt(x: number, z: number): boolean {
    return this.richnessAt(x, z) > 0;
  }

  richnessAt(x: number, z: number): number {
    let richness = 0;
    for (const site of this.sites) {
      if (site.kind !== 'rich') continue;
      const distance = Math.hypot(x - site.x, z - site.z);
      if (distance >= RICH_CLAY_DEPOSIT_RADIUS) continue;
      const t = 1 - distance / RICH_CLAY_DEPOSIT_RADIUS;
      richness = Math.max(richness, t * t * (3 - 2 * t));
    }
    return richness;
  }

  isBlockedForProps(x: number, z: number): boolean {
    return this.sites.some((site) => sampleEllipticalBlend(x, z, site, 1.08) > 0);
  }

  isBlockedForGrass(x: number, z: number): boolean {
    return this.sites.some((site) => sampleEllipticalBlend(x, z, site, 1.16) > 0);
  }
}

type BankCandidate = {
  x: number;
  z: number;
  rotation: number;
  score: number;
  formation: ClayDepositSite['formation'];
};

function bestRegionalClayCandidate(
  candidates: readonly BankCandidate[],
  placementTarget: ResourcePlacementTarget | undefined,
): BankCandidate | undefined {
  return candidates.reduce<BankCandidate | undefined>((best, candidate) => {
    if (!best) return candidate;
    const candidateScore = candidate.score
      + regionalPlacementAffinity(candidate.x, candidate.z, placementTarget) * 12;
    const bestScore = best.score
      + regionalPlacementAffinity(best.x, best.z, placementTarget) * 12;
    return candidateScore > bestScore ? candidate : best;
  }, undefined);
}

function collectBankCandidates(
  riverLayout: RiverLayout,
  playableHalf: number,
  seed: number,
): BankCandidate[] {
  const candidates: BankCandidate[] = [];
  const limit = playableHalf - PLAYABLE_EDGE_CLEARANCE;

  riverLayout.corridors.forEach((corridor, corridorIndex) => {
    for (let pointIndex = 3; pointIndex < corridor.points.length - 3; pointIndex += 4) {
      const point = corridor.points[pointIndex];
      if (point.progress < 0.16 || point.progress > 0.84) continue;
      const before = corridor.points[pointIndex - 2];
      const after = corridor.points[pointIndex + 2];
      const tangent = normalize(after.x - before.x, after.z - before.z);
      if (!tangent) continue;

      for (const side of [-1, 1] as const) {
        const bankOffset = point.halfWidth * 0.72 + 8.5;
        const normalX = -tangent.z * side;
        const normalZ = tangent.x * side;
        const x = point.x + normalX * bankOffset;
        const z = point.z + normalZ * bankOffset;
        if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
        if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 42) continue;
        if (!bankFootprintIsDry(riverLayout, x, z, tangent)) continue;
        if (!hasNearbyWater(riverLayout, x, z)) continue;

        const stableNoise = hashF64(
          seed ^ (side > 0 ? 0x5a17 : 0x29c3),
          corridorIndex,
          pointIndex,
        );
        candidates.push({
          x,
          z,
          rotation: Math.atan2(tangent.z, tangent.x),
          formation: 'alluvial',
          score:
            point.halfWidth * 2.2
            - Math.abs(point.progress - 0.58) * 7
            + stableNoise * 4,
        });
      }
    }
  });

  return candidates;
}

function collectCoastalClayCandidates(
  riverLayout: RiverLayout,
  playableHalf: number,
  seed: number,
): BankCandidate[] {
  if (riverLayout.getCoastalShoreX(0) === null) return [];
  const candidates: BankCandidate[] = [];
  const limit = playableHalf - PLAYABLE_EDGE_CLEARANCE;

  for (let index = 0; index < 48; index++) {
    const z = -limit + limit * 2 * hashF64(seed ^ 0x4ce1, index, 0);
    const shoreX = riverLayout.getCoastalShoreX(z);
    if (shoreX === null) continue;
    const beforeX = riverLayout.getCoastalShoreX(z - 5) ?? shoreX;
    const afterX = riverLayout.getCoastalShoreX(z + 5) ?? shoreX;
    const tangent = normalize(afterX - beforeX, 10);
    if (!tangent) continue;
    const inlandOffset = 18 + hashF64(seed ^ 0x2b79, index, 1) * 7;
    const x = shoreX + inlandOffset;
    if (Math.abs(x) > limit || Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 42) {
      continue;
    }
    if (!bankFootprintIsDry(riverLayout, x, z, tangent)) continue;
    if (!hasNearbyWater(riverLayout, x, z)) continue;
    candidates.push({
      x,
      z,
      rotation: Math.atan2(tangent.z, tangent.x),
      formation: 'coastal',
      score: 13 + hashF64(seed ^ 0x75a3, index, 2) * 4 - inlandOffset * 0.05,
    });
  }
  return candidates;
}

function collectDryClayCandidates(
  riverLayout: RiverLayout,
  playableHalf: number,
  seed: number,
): BankCandidate[] {
  const candidates: BankCandidate[] = [];
  const limit = playableHalf - PLAYABLE_EDGE_CLEARANCE;
  const minimumRadius = Math.min(limit * 0.48, CENTRAL_CLEARING_RADIUS + 54);
  const maximumRadius = Math.max(
    minimumRadius + 1,
    Math.min(limit * 0.72, playableHalf * 0.56),
  );

  for (let index = 0; index < 32; index += 1) {
    const angle = hashF64(seed ^ 0x7c31, index, 0) * Math.PI * 2;
    const radius = minimumRadius
      + (maximumRadius - minimumRadius) * hashF64(seed ^ 0x2d95, index, 1);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const probes = [
      { x, z },
      { x: x - 8, z },
      { x: x + 8, z },
      { x, z: z - 8 },
      { x, z: z + 8 },
    ];
    if (probes.some((probe) => riverLayout.isWaterAt(probe.x, probe.z))) continue;
    candidates.push({
      x,
      z,
      rotation: angle + Math.PI * 0.5,
      formation: 'inland_basin',
      score:
        hashF64(seed ^ 0x61a7, index, 2) * 4
        - Math.hypot(x - riverLayout.drain.x, z - riverLayout.drain.z)
          / playableHalf,
    });
  }
  return candidates;
}

function clayDepositRadii(
  grade: ClayDepositSite['kind'],
  formation: ClayDepositSite['formation'],
): { radiusX: number; radiusZ: number } {
  const base = grade === 'rich'
    ? { radiusX: RICH_BANK_RADIUS_X, radiusZ: RICH_BANK_RADIUS_Z }
    : { radiusX: ORDINARY_BANK_RADIUS_X, radiusZ: ORDINARY_BANK_RADIUS_Z };
  const scale = formation === 'inland_basin'
    ? 0.78
    : formation === 'coastal'
      ? 0.9
      : 1;
  return {
    radiusX: base.radiusX * scale,
    radiusZ: base.radiusZ * scale,
  };
}

function bankFootprintIsDry(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  tangent: { x: number; z: number },
): boolean {
  const normal = { x: -tangent.z, z: tangent.x };
  const probes = [
    { x, z },
    { x: x + tangent.x * 5, z: z + tangent.z * 5 },
    { x: x - tangent.x * 5, z: z - tangent.z * 5 },
    { x: x + normal.x * 4, z: z + normal.z * 4 },
    { x: x - normal.x * 4, z: z - normal.z * 4 },
  ];
  return probes.every((probe) => !riverLayout.isWaterAt(probe.x, probe.z));
}

function hasNearbyWater(riverLayout: RiverLayout, x: number, z: number): boolean {
  for (const radius of [6, 10, 14, 18, 22]) {
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      if (riverLayout.isWaterAt(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      )) {
        return true;
      }
    }
  }
  return false;
}

function hasResourceClearance(
  candidate: BankCandidate,
  sites: ReadonlyArray<{ x: number; z: number }>,
): boolean {
  return sites.every((site) =>
    Math.hypot(candidate.x - site.x, candidate.z - site.z) >= RESOURCE_CLEARANCE
  );
}

function hasClayBankClearance(
  candidate: BankCandidate,
  sites: ReadonlyArray<{ x: number; z: number }>,
): boolean {
  return sites.every((site) =>
    Math.hypot(candidate.x - site.x, candidate.z - site.z) >= MIN_CLAY_BANK_SPACING
  );
}

function hasGameHabitatClearance(
  candidate: BankCandidate,
  grade: ClayDepositSite['kind'],
  foragingSites: readonly ForagingSite[],
): boolean {
  const radii = clayDepositRadii(grade, candidate.formation);
  const protectedRadius = Math.max(radii.radiusX, radii.radiusZ) + 4;
  return foragingSites
    .filter((site) => site.kind === 'game')
    .every((site) =>
      Math.hypot(candidate.x - site.x, candidate.z - site.z)
        > protectedRadius + GAME_HABITAT_DEPOSIT_CLEARANCE
    );
}

function sampleEllipticalBlend(
  x: number,
  z: number,
  site: ClayDepositSite,
  scale: number,
): number {
  const dx = x - site.x;
  const dz = z - site.z;
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const distance = Math.hypot(
    localX / (site.radiusX * scale),
    localZ / (site.radiusZ * scale),
  );
  if (distance >= 1) return 0;
  const t = 1 - distance;
  return t * t * (3 - 2 * t);
}

function normalize(x: number, z: number): { x: number; z: number } | null {
  const length = Math.hypot(x, z);
  if (length <= 1e-6) return null;
  return { x: x / length, z: z / length };
}
