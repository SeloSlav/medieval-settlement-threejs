import type { ResidenceState } from '../resources/types.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';
import {
  RESOURCE_NODE_ART_FAMILIES,
  resourceNodeArtFamily,
  type ResourceNodeArtKey,
  type ResourceNodeArtVariant,
} from '../resources/resourceNodeArt.ts';

export const MAP_STAMP_RESOURCE_KINDS = RESOURCE_NODE_ART_FAMILIES;

export type MapStampResourceKind = typeof MAP_STAMP_RESOURCE_KINDS[number];
export type MapStampVariant = ResourceNodeArtVariant;
export type MapStampKey = ResourceNodeArtKey;
export type MapPoint = { x: number; y: number };
export type WorldPoint = { x: number; z: number };

export const MAP_ART_RESOLUTION = 512;

const RESIDENCE_WIDTH = 6.6;
const RESIDENCE_DEPTH = 7.4;

export function resourceKindForMapMarker(
  marker: WorldMapMarker,
): MapStampResourceKind | null {
  if (marker.kind === 'building') return null;
  return resourceNodeArtFamily(marker.kind, marker.resource);
}

export function mapStampKey(
  marker: WorldMapMarker,
  isRich: boolean,
): MapStampKey | null {
  const resource = resourceKindForMapMarker(marker);
  return resource ? `${resource}-${isRich ? 'rich' : 'normal'}` : null;
}

export function mapStampArtSize(
  marker: WorldMapMarker,
  isRich: boolean,
): number {
  if (isRich) return 42;
  return marker.quarryKind === 'large' ? 31 : 27;
}

export function worldToMapPixels(
  point: WorldPoint,
  bounds: TerrainBounds,
  width: number,
  height: number,
): MapPoint {
  return {
    x: ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    y: ((point.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height,
  };
}

export function residenceFootprintCorners(
  residence: Pick<ResidenceState, 'x' | 'z' | 'yaw'>,
): [WorldPoint, WorldPoint, WorldPoint, WorldPoint] {
  const halfWidth = RESIDENCE_WIDTH * 0.5;
  const halfDepth = RESIDENCE_DEPTH * 0.5;
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  const worldPoint = (localX: number, localZ: number): WorldPoint => ({
    x: residence.x + localX * cos + localZ * sin,
    z: residence.z - localX * sin + localZ * cos,
  });
  return [
    worldPoint(-halfWidth, -halfDepth),
    worldPoint(halfWidth, -halfDepth),
    worldPoint(halfWidth, halfDepth),
    worldPoint(-halfWidth, halfDepth),
  ];
}
