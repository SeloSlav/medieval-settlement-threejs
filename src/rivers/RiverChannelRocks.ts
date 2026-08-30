import type { RiverField } from './RiverField.ts';
import { hashF64 } from './riverHash.ts';

/**
 * Deterministic river-rock placement shared by geometry and water shading.
 *
 * coordinate domain: world XZ along authored corridor samples
 * primary field: stratified one-sided boulder stations
 * derived causes: contact whitewater + split/rejoining downstream wake
 * consumers: instanced carbonate boulders and the packed river surface map
 * filtering: baked at RiverField resolution, then bilinearly sampled once
 */
export type RiverChannelRockPlacement = Readonly<{
  x: number;
  z: number;
  scale: number;
  flowX: number;
  flowZ: number;
  side: -1 | 1;
  halfWidth: number;
  corridor: number;
  station: number;
  flowSpeed: number;
  /** 0 = quiet water, 1 = fully aerated obstacle wake. */
  rapidEnergy: number;
}>;

export const RIVER_CHANNEL_ROCK_LIMIT = 112;
export const RIVER_ROCK_WAKE_LENGTH_PER_SCALE = 8.5;
export const RIVER_ROCK_MIN_WAKE_LENGTH_METERS = 8;

export function getRiverChannelRockContactRadius(scale: number): number {
  // Water-worn Kupa boulders read as broad carbonate slabs, not near-spherical
  // columns rising from a two-metre bed. This same radius owns geometry,
  // collision clearance, and attached whitewater.
  return 0.72 + Math.max(0, scale) * 1.05;
}

export function createRiverChannelRockPlacements(
  riverField: RiverField,
): RiverChannelRockPlacement[] {
  const placements: RiverChannelRockPlacement[] = [];
  const seed = riverField.layout.seed ^ 0x4b75_7061;

  for (let corridorIndex = 0;
    corridorIndex < riverField.layout.corridors.length
      && placements.length < RIVER_CHANNEL_ROCK_LIMIT;
    corridorIndex += 1) {
    const points = riverField.layout.corridors[corridorIndex].points;
    if (points.length < 7) continue;

    let pointIndex = 4 + Math.floor(hashF64(seed, corridorIndex, 1) * 4);
    let station = 0;
    while (pointIndex < points.length - 4 && placements.length < RIVER_CHANNEL_ROCK_LIMIT) {
      const point = points[pointIndex];
      const previous = points[Math.max(0, pointIndex - 2)];
      const next = points[Math.min(points.length - 1, pointIndex + 2)];
      const tangentX = next.x - previous.x;
      const tangentZ = next.z - previous.z;
      const tangentLength = Math.hypot(tangentX, tangentZ);
      if (tangentLength > 1e-5 && point.halfWidth >= 3.4) {
        const flowX = tangentX / tangentLength;
        const flowZ = tangentZ / tangentLength;
        const crossX = -flowZ;
        const crossZ = flowX;
        const stationSeed = corridorIndex * 65_537 + station;
        const density = riverField.layout.terrainPreset === 'kupa_valley' ? 0.52 : 0.24;

        if (hashF64(seed, stationSeed, 7) < density) {
          const side: -1 | 1 = hashF64(seed, stationSeed, 11) < 0.5 ? -1 : 1;
          const clusterRoll = hashF64(seed, stationSeed, 13);
          const clusterCount = clusterRoll > 0.86 ? 3 : clusterRoll > 0.46 ? 2 : 1;

          for (let clusterIndex = 0;
            clusterIndex < clusterCount && placements.length < RIVER_CHANNEL_ROCK_LIMIT;
            clusterIndex += 1) {
            const rockKey = stationSeed * 5 + clusterIndex;
            const largeRock = clusterIndex === 0 && hashF64(seed, rockKey, 17) > 0.82;
            const scale = largeRock
              ? 1.65 + hashF64(seed, rockKey, 19) * 0.8
              : 0.62 + hashF64(seed, rockKey, 19) * 1.08;
            // Keep every station on one side of the thalweg. Even the most
            // central boulder therefore leaves the opposite branch open, while
            // outer rocks read as rounded marginal bars rather than a dam.
            const minimumCross = Math.max(scale * 1.2, point.halfWidth * 0.045);
            const maximumCross = Math.max(
              minimumCross,
              point.halfWidth * (0.3 + hashF64(seed, rockKey, 23) * 0.1),
            );
            const crossDistance = side * (
              minimumCross
              + (maximumCross - minimumCross) * hashF64(seed, rockKey, 29)
              + clusterIndex * scale * 0.78
            );
            const alongDistance = (
              hashF64(seed, rockKey, 31) - 0.5
            ) * (3.2 + clusterIndex * 2.1);
            const x = point.x + flowX * alongDistance + crossX * crossDistance;
            const z = point.z + flowZ * alongDistance + crossZ * crossDistance;
            const requiredInterior = Math.max(0.65, scale * 0.38);
            if (!riverField.isRenderedWetAt(x, z)) continue;
            if (riverField.sampleOrganicSignedDistance(x, z) < requiredInterior) continue;
            if (overlapsExistingChannelRock(placements, x, z, scale)) continue;
            const flowSpeed = riverField.layout.sampleFlowSpeed(x, z) ?? 0;
            const obstructionEnergy = flowSpeed * (0.62 + scale * 0.28);
            const rapidEnergy = smoothstep(0.78, 1.28, obstructionEnergy);
            placements.push({
              x,
              z,
              scale,
              flowX,
              flowZ,
              side,
              halfWidth: point.halfWidth,
              corridor: corridorIndex,
              station,
              flowSpeed,
              rapidEnergy,
            });
          }
        }
      }

      const stride = 5 + Math.floor(hashF64(seed, corridorIndex, station + 101) * 5);
      pointIndex += stride;
      station += 1;
    }
  }

  return placements;
}

export function computeRiverRockRapidFoam(
  rock: RiverChannelRockPlacement,
  x: number,
  z: number,
): number {
  const dx = x - rock.x;
  const dz = z - rock.z;
  const along = dx * rock.flowX + dz * rock.flowZ;
  const cross = -dx * rock.flowZ + dz * rock.flowX;
  const radius = getRiverChannelRockContactRadius(rock.scale);
  const distance = Math.hypot(along, cross);

  // Bright attached whitewater around the actual contact edge. The upstream
  // face is slightly stronger because that is where the current first shoots
  // over and around the carbonate boulder.
  const contactBand = 1 - smoothstep(
    radius * 0.18,
    radius * 0.72,
    Math.abs(distance - radius),
  );
  const upstreamWeight = 1 - smoothstep(-radius * 1.4, radius * 0.55, along);
  const contact = contactBand * (0.7 + upstreamWeight * 0.3);

  const wakeLength = Math.max(
    RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
    rock.scale * RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
  );
  const wakeProgress = clamp01(along / wakeLength);
  const downstream = smoothstep(-radius * 0.12, radius * 0.5, along)
    * (1 - smoothstep(0.58, 1, wakeProgress));
  // Two strands leave either shoulder of the rock and curl back toward one
  // another downstream. This preserves a visible open flow branch instead of
  // drawing a transverse foam wall.
  const strandCenter = radius * (0.92 - wakeProgress * 0.58);
  const strandWidth = radius * (0.2 + wakeProgress * 0.17);
  const strandDistance = Math.abs(Math.abs(cross) - strandCenter);
  const splitWake = downstream * (
    1 - smoothstep(strandWidth, strandWidth * 2.3, strandDistance)
  );
  const recirculation = downstream
    * (1 - smoothstep(0, radius * 0.68, Math.abs(cross)))
    * (1 - smoothstep(0.06, 0.52, wakeProgress));

  return clamp01(
    Math.max(contact * 0.94, splitWake * 0.72, recirculation * 0.38)
      * rock.rapidEnergy,
  );
}

function overlapsExistingChannelRock(
  placements: readonly RiverChannelRockPlacement[],
  x: number,
  z: number,
  scale: number,
): boolean {
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const other = placements[index];
    const clearance = (scale + other.scale) * 0.72 + 0.55;
    if ((x - other.x) ** 2 + (z - other.z) ** 2 < clearance ** 2) return true;
    // Placements are emitted downstream in strata. Once the along-world gap
    // is broad enough, older stations cannot overlap this local cluster.
    if (Math.abs(z - other.z) > 34 && Math.abs(x - other.x) > 34) break;
  }
  return false;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
