import { buildingKindLabel } from '../resources/WorldLayoutRegistry.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type {
  BuildingState,
  ForagingNodeState,
  ResourceKind,
  ResourceNodeKind,
} from '../resources/types.ts';
import {
  clayDepositLabel,
  clayDepositNodeId,
  type ClayDepositSite,
} from '../clay/ClayDepositLayout.ts';

export type WorldMapMarkerKind = ResourceNodeKind | 'clay' | 'building';

export type WorldMapMarker = {
  id: string;
  kind: WorldMapMarkerKind;
  label: string;
  x: number;
  z: number;
  quarryKind?: 'large' | 'small';
  resource?: ResourceKind;
};

export function buildLayoutWorldMapMarkers(
  registry: WorldLayoutRegistry,
  clayDepositSites: readonly ClayDepositSite[] = [],
): WorldMapMarker[] {
  const resourceMarkers = registry.definitionList
    .filter((definition) => {
      if (definition.kind === 'quarry') {
        return definition.resource === 'stone'
          || definition.resource === 'iron'
          || definition.resource === 'salt';
      }
      return definition.kind === 'game'
        || definition.kind === 'berries'
        || definition.kind === 'mushrooms'
        || definition.kind === 'fish';
    })
    .map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      label: definition.label,
      x: definition.x,
      z: definition.z,
      quarryKind: definition.quarryKind,
      resource: definition.resource,
    }));
  const clayMarkers = clayDepositSites.map((site, index) => ({
    id: clayDepositNodeId(site, index),
    kind: 'clay' as const,
    label: clayDepositLabel(site),
    x: site.x,
    z: site.z,
  }));
  return [...resourceMarkers, ...clayMarkers];
}

export function buildBuildingWorldMapMarkers(buildings: Iterable<BuildingState>): WorldMapMarker[] {
  return Array.from(buildings, (building) => ({
    id: building.id,
    kind: 'building',
    label: buildingKindLabel(building.kind),
    x: building.x,
    z: building.z,
  }));
}

export function isWorldMapForagingMarkerVisible(
  marker: WorldMapMarker,
  foragingNodes: Map<string, ForagingNodeState>,
): boolean {
  if (
    marker.kind !== 'game'
    && marker.kind !== 'berries'
    && marker.kind !== 'mushrooms'
    && marker.kind !== 'fish'
  ) return true;
  const state = foragingNodes.get(marker.id);
  return Boolean(state);
}

export function filterWorldMapMarkersByKind<K extends WorldMapMarkerKind>(
  markers: readonly WorldMapMarker[],
  kind: K,
): Array<WorldMapMarker & { kind: K }> {
  return markers.filter((marker): marker is WorldMapMarker & { kind: K } => marker.kind === kind);
}

export function filterWorldMapForagingMarkers(markers: readonly WorldMapMarker[]): WorldMapMarker[] {
  return markers.filter(
    (marker) =>
      marker.kind === 'game'
      || marker.kind === 'berries'
      || marker.kind === 'mushrooms'
      || marker.kind === 'fish'
      || marker.kind === 'clay',
  );
}
