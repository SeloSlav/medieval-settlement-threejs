import type { ForagingSite } from '../foraging/ForagingLayout.ts';
import type { QuarrySite } from '../quarries/QuarryLayout.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { CENTRAL_CLEARING_RADIUS } from '../props/forestField.ts';

export type ClayDepositSite = {
  x: number;
  z: number;
  rotation: number;
  kind: 'ordinary' | 'rich';
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
export const RICH_CLAY_DEPOSIT_MAX_YIELD = 3_600;

export function clayDepositNodeId(site: ClayDepositSite, index: number): string {
  return `clay-${site.kind}-${index}`;
}

export function clayDepositLabel(site: ClayDepositSite): string {
  return site.kind === 'rich' ? 'Rich clay deposit' : 'Clay deposit';
}

export function clayDepositMaxYield(site: ClayDepositSite): number {
  return site.kind === 'rich'
    ? RICH_CLAY_DEPOSIT_MAX_YIELD
    : ORDINARY_CLAY_DEPOSIT_MAX_YIELD;
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
 * Deterministic alluvial deposits are generated beside rivers. Every world has
 * at least one ordinary bank; rich banks are optional seed rolls supplied by
 * the regional resource plan.
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
    const candidates = collectBankCandidates(
      options.riverLayout,
      playableHalf,
      seed,
    );
    const richSiteCount = Math.max(0, Math.min(1, Math.floor(options.richSiteCount ?? 1)));
    const ordinarySiteCount = Math.max(1, Math.min(4, Math.floor(options.ordinarySiteCount ?? 1)));
    const grades: ClayDepositSite['kind'][] = [
      ...Array.from({ length: richSiteCount }, () => 'rich' as const),
      ...Array.from({ length: ordinarySiteCount }, () => 'ordinary' as const),
    ];
    const rankedCandidates = candidates.sort((a, b) => b.score - a.score);
    const sites: ClayDepositSite[] = [];

    for (const grade of grades) {
      const selected = rankedCandidates.find((candidate) =>
        hasResourceClearance(candidate, avoidSites)
        && hasClayBankClearance(candidate, sites)
      ) ?? rankedCandidates.find((candidate) => hasClayBankClearance(candidate, sites));
      if (!selected) continue;
      sites.push({
        x: selected.x,
        z: selected.z,
        rotation: selected.rotation,
        kind: grade,
        radiusX: grade === 'rich' ? RICH_BANK_RADIUS_X : ORDINARY_BANK_RADIUS_X,
        radiusZ: grade === 'rich' ? RICH_BANK_RADIUS_Z : ORDINARY_BANK_RADIUS_Z,
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
};

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
