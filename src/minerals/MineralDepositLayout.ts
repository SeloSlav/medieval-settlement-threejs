import {
  GAME_HABITAT_DEPOSIT_CLEARANCE,
  type ForagingSite,
} from '../foraging/ForagingLayout.ts';
import type { QuarrySite } from '../quarries/QuarryLayout.ts';
import { CENTRAL_CLEARING_RADIUS, mulberry32 } from '../props/forestField.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import type { WorldMapSize } from '../world/worldGenerationSettings.ts';
import {
  regionalPlacementAffinity,
  sampleRegionalPlacementCandidate,
  type ResourcePlacementTarget,
} from '../world/resourceRegionDistribution.ts';
import {
  ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS,
  RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS,
} from '../resources/physicalDepositProtection.ts';

export type MineralDepositResource = 'iron' | 'salt';
export type MineralDepositGrade = 'ordinary' | 'rich';
export type MineralDepositFormation =
  | 'bedrock'
  | 'rock_salt'
  | 'coastal_evaporite'
  | 'dry_basin_evaporite';

export type MineralDepositSite = {
  x: number;
  z: number;
  rotation: number;
  resource: MineralDepositResource;
  grade: MineralDepositGrade;
  formation: MineralDepositFormation;
  radiusX: number;
  radiusZ: number;
};

export type MineralDepositLayoutOptions = {
  riverLayout: RiverLayout;
  richSiteCount: number;
  ordinarySiteCount: number;
  quarrySites?: readonly QuarrySite[];
  foragingSites?: readonly ForagingSite[];
  claySites?: ReadonlyArray<{ x: number; z: number }>;
  playableHalf?: number;
  seed?: number;
  mapSize?: WorldMapSize;
  resourceVariety?: number;
  /** Soft regional targets in the same rich-first order as the mineral roster. */
  placementTargets?: readonly ResourcePlacementTarget[];
};

export type MineralDepositRosterEntry = {
  resource: MineralDepositResource;
  grade: MineralDepositGrade;
};

const PLAYABLE_EDGE_CLEARANCE = 34;
const RESOURCE_CLEARANCE = 58;
const MIN_DEPOSIT_SPACING = 72;

export function mineralDepositNodeId(site: MineralDepositSite, index: number): string {
  return `deposit-${site.resource}-${site.grade}-${index}`;
}

export function mineralDepositMaxYield(site: MineralDepositSite): number {
  if (site.grade === 'rich') return site.resource === 'iron' ? 900 : 1_080;
  return site.resource === 'iron' ? 300 : 360;
}

export function mineralDepositLabel(site: MineralDepositSite): string {
  const resource = site.resource === 'iron'
    ? 'Iron'
    : site.formation === 'coastal_evaporite'
      ? 'Coastal salt'
      : site.formation === 'dry_basin_evaporite'
        ? 'Dry-basin salt'
        : 'Salt';
  return `${site.grade === 'rich' ? 'Rich ' : ''}${resource} deposit`;
}

export class MineralDepositLayout {
  readonly sites: readonly MineralDepositSite[];
  readonly seed: number;

  private constructor(seed: number, sites: MineralDepositSite[]) {
    this.seed = seed;
    this.sites = sites;
  }

  static create(options: MineralDepositLayoutOptions): MineralDepositLayout {
    const seed = options.seed ?? 0x1f04e3;
    const playableHalf = options.playableHalf ?? 410;
    const roster = createMineralDepositRoster({
      seed,
      mapSize: options.mapSize ?? 'medium',
      richSiteCount: options.richSiteCount,
      ordinarySiteCount: options.ordinarySiteCount,
      resourceVariety: options.resourceVariety ?? 50,
    });
    const avoidSites = [
      ...(options.quarrySites ?? []),
      ...(options.foragingSites ?? []),
      ...(options.claySites ?? []),
    ];
    const rng = mulberry32(seed ^ 0x6d2b79f5);
    const sites: MineralDepositSite[] = [];

    for (let index = 0; index < roster.length; index++) {
      const entry = roster[index];
      const site = pickMineralSite(
        rng,
        options.riverLayout,
        playableHalf,
        entry,
        sites,
        avoidSites,
        options.foragingSites ?? [],
        options.placementTargets?.[index],
      );
      if (site) sites.push(site);
    }

    return new MineralDepositLayout(seed, sites);
  }

  isBlockedForProps(x: number, z: number): boolean {
    return this.sites.some((site) => siteBlend(x, z, site, 1.08) > 0);
  }

  isBlockedForGrass(x: number, z: number): boolean {
    return this.sites.some((site) => siteBlend(x, z, site, 1.16) > 0);
  }
}

export function createMineralDepositRoster(options: {
  seed: number;
  mapSize: WorldMapSize;
  richSiteCount: number;
  ordinarySiteCount: number;
  resourceVariety: number;
}): MineralDepositRosterEntry[] {
  const richCount = Math.max(0, Math.floor(options.richSiteCount));
  const ordinaryCount = Math.max(0, Math.floor(options.ordinarySiteCount));
  const rng = mulberry32(options.seed ^ 0x4b1d5a77);
  const primary: MineralDepositResource = rng() < 0.5 ? 'iron' : 'salt';
  const secondary: MineralDepositResource = primary === 'iron' ? 'salt' : 'iron';
  const variety = clamp01(options.resourceVariety / 100);
  const secondaryChance = lerp(0.18, 0.6, variety);
  const grades: MineralDepositGrade[] = [
    ...Array.from({ length: richCount }, () => 'rich' as const),
    ...Array.from({ length: ordinaryCount }, () => 'ordinary' as const),
  ];

  // Rich deposits are complete surface sources too, so the first two slots can
  // guarantee iron and salt even when one or both families have no ordinary
  // node in a small map's tightly bounded roll.
  return grades.map((grade, index) => ({
    resource: index === 0
      ? primary
      : index === 1
        ? secondary
        : rng() < secondaryChance
          ? secondary
          : primary,
    grade,
  }));
}

function pickMineralSite(
  rng: () => number,
  riverLayout: RiverLayout,
  playableHalf: number,
  entry: MineralDepositRosterEntry,
  existing: readonly MineralDepositSite[],
  avoidSites: ReadonlyArray<{ x: number; z: number }>,
  foragingSites: readonly ForagingSite[],
  placementTarget?: ResourcePlacementTarget,
): MineralDepositSite | null {
  const formation = mineralDepositFormation(entry.resource, riverLayout);
  let best: MineralDepositSite | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let attempt = 0; attempt < 720; attempt++) {
    const radiusX = entry.grade === 'rich'
      ? lerp(22, 29, rng())
      : lerp(15, 21, rng());
    const radiusZ = entry.grade === 'rich'
      ? lerp(17, 23, rng())
      : lerp(12, 17, rng());
    const limit = playableHalf - PLAYABLE_EDGE_CLEARANCE - Math.max(radiusX, radiusZ);
    const point = sampleRegionalPlacementCandidate(
      rng,
      placementTarget,
      limit,
      attempt,
      720,
    );
    if (!point) continue;
    const { x, z } = point;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 52) continue;
    if (!hasClearance(x, z, existing, MIN_DEPOSIT_SPACING)) continue;
    if (!hasClearance(x, z, avoidSites, RESOURCE_CLEARANCE)) continue;
    if (!footprintIsDry(riverLayout, x, z, radiusX, radiusZ)) continue;
    const candidate: MineralDepositSite = {
      x,
      z,
      rotation: rng() * Math.PI,
      resource: entry.resource,
      grade: entry.grade,
      formation,
      radiusX,
      radiusZ,
    };
    const scoreNoise = formation === 'bedrock' ? 0 : rng() * 0.08;
    if (!hasGameHabitatClearance(candidate, foragingSites)) continue;
    // Iron keeps the established unconstrained bedrock distribution. Only salt
    // needs a surface-water-specific placement preference.
    if (formation === 'bedrock') return candidate;
    const score = mineralSitePreference(candidate, riverLayout, playableHalf)
      + scoreNoise
      + regionalPlacementAffinity(x, z, placementTarget) * 6;
    if (score <= bestScore) continue;
    best = candidate;
    bestScore = score;
  }
  return best;
}

function hasGameHabitatClearance(
  candidate: MineralDepositSite,
  foragingSites: readonly ForagingSite[],
): boolean {
  const protectedRadius = candidate.grade === 'rich'
    ? RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS
    : ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS;
  return foragingSites
    .filter((site) => site.kind === 'game')
    .every((site) =>
      Math.hypot(candidate.x - site.x, candidate.z - site.z)
        > protectedRadius + GAME_HABITAT_DEPOSIT_CLEARANCE
    );
}

function mineralDepositFormation(
  resource: MineralDepositResource,
  riverLayout: RiverLayout,
): MineralDepositFormation {
  if (resource === 'iron') return 'bedrock';
  if (riverLayout.getCoastalShoreX(0) !== null) return 'coastal_evaporite';
  if (riverLayout.corridors.length === 0) return 'dry_basin_evaporite';
  return 'rock_salt';
}

function mineralSitePreference(
  site: MineralDepositSite,
  riverLayout: RiverLayout,
  playableHalf: number,
): number {
  if (site.formation === 'coastal_evaporite') {
    const shoreX = riverLayout.getCoastalShoreX(site.z);
    if (shoreX === null) return -100;
    const inlandDistance = site.x - shoreX;
    return 8 - Math.abs(inlandDistance - 52) / 18;
  }
  if (site.formation === 'dry_basin_evaporite') {
    const basinDistance = Math.hypot(
      site.x - riverLayout.drain.x,
      site.z - riverLayout.drain.z,
    );
    return 5 - basinDistance / Math.max(1, playableHalf * 0.24);
  }
  if (site.formation === 'rock_salt') {
    return estimatedWaterClearance(riverLayout, site.x, site.z) / 32;
  }
  return 0;
}

function estimatedWaterClearance(
  riverLayout: RiverLayout,
  x: number,
  z: number,
): number {
  for (let radius = 24; radius <= 120; radius += 12) {
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      if (riverLayout.isWaterAt(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      )) return radius;
    }
  }
  return 132;
}

function footprintIsDry(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  radiusX: number,
  radiusZ: number,
): boolean {
  if (riverLayout.isWaterAt(x, z)) return false;
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    if (riverLayout.isWaterAt(
      x + Math.cos(angle) * radiusX * 0.75,
      z + Math.sin(angle) * radiusZ * 0.75,
    )) {
      return false;
    }
  }
  return true;
}

function hasClearance(
  x: number,
  z: number,
  sites: ReadonlyArray<{ x: number; z: number }>,
  clearance: number,
): boolean {
  return sites.every((site) => Math.hypot(x - site.x, z - site.z) >= clearance);
}

function siteBlend(
  x: number,
  z: number,
  site: MineralDepositSite,
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
