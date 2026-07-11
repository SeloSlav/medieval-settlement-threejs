import type { BuildingKind } from '../resources/types.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';

export type BuildingTerrainSource = {
  kind: BuildingKind;
  x: number;
  z: number;
};

type BuildingPadParams = {
  radiusX: number;
  radiusZ: number;
  innerFade: number;
  outerFade: number;
};

type BuildingPadSite = BuildingTerrainSource & BuildingPadParams & {
  rotation: number;
  platformHeight: number;
};

const PAD_PARAMS: Record<BuildingKind, BuildingPadParams> = {
  lumber_mill: { radiusX: 10.2, radiusZ: 4.8, innerFade: 0.86, outerFade: 1.38 },
  reforester: { radiusX: 4.4, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.32 },
  woodcutters_lodge: { radiusX: 4.6, radiusZ: 4.3, innerFade: 0.88, outerFade: 1.34 },
  stone_quarry: { radiusX: 10.5, radiusZ: 10.5, innerFade: 0.82, outerFade: 1.42 },
  well: { radiusX: 2.2, radiusZ: 2.2, innerFade: 0.9, outerFade: 1.2 },
  hunters_hall: { radiusX: 5.2, radiusZ: 4.8, innerFade: 0.88, outerFade: 1.34 },
  foragers_shed: { radiusX: 4.2, radiusZ: 3.8, innerFade: 0.88, outerFade: 1.3 },
  chapel: { radiusX: 3.4, radiusZ: 4.2, innerFade: 0.9, outerFade: 1.28 },
  marketplace: { radiusX: 4.2, radiusZ: 3.4, innerFade: 0.9, outerFade: 1.3 },
};

const FOOTPRINT_SAMPLE_FRACTIONS = [0, 0.55, 0.82, 1] as const;
/** Matches placement preview silhouette scale in BuildingPlacementPreview. */
const FOOTPRINT_PREVIEW_SCALE = 0.92;

export class BuildingTerrainLayout {
  readonly sites: BuildingPadSite[];

  private constructor(sites: BuildingPadSite[]) {
    this.sites = sites;
  }

  static fromBuildings(
    buildings: Iterable<BuildingTerrainSource>,
    sampleNaturalHeight: (x: number, z: number) => number,
  ): BuildingTerrainLayout {
    const sites: BuildingPadSite[] = [];
    for (const building of buildings) {
      sites.push(createPadSite(building, sampleNaturalHeight));
    }
    return new BuildingTerrainLayout(sites);
  }

  getPlatformRaise(x: number, z: number, naturalHeight: number): number {
    let targetHeight = naturalHeight;
    for (const site of this.sites) {
      const raise = sampleSiteRaise(x, z, site, naturalHeight);
      targetHeight = Math.max(targetHeight, naturalHeight + raise);
    }
    return targetHeight - naturalHeight;
  }

  getAffectedBounds(): TerrainBounds[] {
    return this.sites.map((site) => siteBounds(site));
  }

  isBlockedForGrass(x: number, z: number): boolean {
    for (const site of this.sites) {
      if (sampleSiteBlend(x, z, site, 0, site.outerFade * 1.04) >= 0.24) return true;
    }
    return false;
  }
}

export function getBuildingPadParams(kind: BuildingKind): BuildingPadParams {
  return PAD_PARAMS[kind];
}

export function sampleBuildingFootprintHeights(
  kind: BuildingKind,
  x: number,
  z: number,
  sampleNaturalHeight: (x: number, z: number) => number,
): number[] {
  return sampleBuildingFootprintPoints(kind, x, z).map((point) => sampleNaturalHeight(point.x, point.z));
}

export function sampleBuildingFootprintPoints(
  kind: BuildingKind,
  x: number,
  z: number,
): Array<{ x: number; z: number }> {
  const params = PAD_PARAMS[kind];
  const rotation = buildingPlacementYaw(kind, x, z);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const points: Array<{ x: number; z: number }> = [];

  for (const fraction of FOOTPRINT_SAMPLE_FRACTIONS) {
    const sampleFraction = fraction === 1 ? FOOTPRINT_PREVIEW_SCALE : fraction;
    for (const sx of [-1, 0, 1] as const) {
      for (const sz of [-1, 0, 1] as const) {
        if (fraction === 0 && (sx !== 0 || sz !== 0)) continue;
        const localX = sx * params.radiusX * params.innerFade * sampleFraction;
        const localZ = sz * params.radiusZ * params.innerFade * sampleFraction;
        points.push({
          x: x + localX * cos - localZ * sin,
          z: z + localX * sin + localZ * cos,
        });
      }
    }
  }

  return points;
}

function createPadSite(
  building: BuildingTerrainSource,
  sampleNaturalHeight: (x: number, z: number) => number,
): BuildingPadSite {
  const params = PAD_PARAMS[building.kind];
  const rotation = buildingPlacementYaw(building.kind, building.x, building.z);
  const footprintHeights = sampleBuildingFootprintHeights(building.kind, building.x, building.z, sampleNaturalHeight);
  const platformHeight = Math.max(...footprintHeights);

  return {
    ...building,
    ...params,
    rotation,
    platformHeight,
  };
}

function sampleSiteRaise(x: number, z: number, site: BuildingPadSite, naturalHeight: number): number {
  const blend = sampleSiteBlend(x, z, site, site.innerFade, site.outerFade);
  if (blend <= 0) return 0;

  const needed = site.platformHeight - naturalHeight;
  if (needed <= 0) return 0;

  return blend * needed;
}

function sampleSiteBlend(
  x: number,
  z: number,
  site: BuildingPadSite,
  innerFade: number,
  outerFade: number,
): number {
  const dx = x - site.x;
  const dz = z - site.z;
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normDist = Math.hypot(localX / site.radiusX, localZ / site.radiusZ);
  return 1 - smoothstep(innerFade, outerFade, normDist);
}

function siteBounds(site: BuildingPadSite): TerrainBounds {
  const extentX = site.radiusX * site.outerFade;
  const extentZ = site.radiusZ * site.outerFade;
  const cornerRadius = Math.hypot(extentX, extentZ);
  return {
    minX: site.x - cornerRadius,
    maxX: site.x + cornerRadius,
    minZ: site.z - cornerRadius,
    maxZ: site.z + cornerRadius,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}
