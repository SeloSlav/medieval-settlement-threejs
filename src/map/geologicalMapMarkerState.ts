import type { ResourceNodeState } from '../resources/types.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';

export const LOW_GEOLOGICAL_RESERVE_SHARE = 0.2;

export type GeologicalMapMarkerLevel =
  | 'unknown'
  | 'stable'
  | 'low'
  | 'depleted'
  | 'deep';

export type GeologicalMapMarkerPresentation = {
  label: string;
  level: GeologicalMapMarkerLevel;
};

export function geologicalNodeForMapMarker(
  marker: Pick<WorldMapMarker, 'id' | 'kind'>,
  nodes: ReadonlyMap<string, ResourceNodeState>,
): ResourceNodeState | undefined {
  return marker.kind === 'quarry' || marker.kind === 'clay'
    ? nodes.get(marker.id)
    : undefined;
}

/**
 * Gives all four physical geological resources one shared map vocabulary.
 * Rich stone keeps a finite visible outcrop but also supports a non-depleting
 * Large Quarry; rich clay, iron, and salt are deep sources from the outset.
 */
export function describeGeologicalMapMarker(
  marker: Pick<WorldMapMarker, 'label'>,
  node: ResourceNodeState | undefined,
): GeologicalMapMarkerPresentation {
  if (!node) {
    return {
      label: marker.label,
      level: 'unknown',
    };
  }

  const resource = geologicalResourceLabel(node.resource);
  const remaining = Math.max(0, finiteOrZero(node.remaining));
  const capacity = Math.max(0, finiteOrZero(node.maxYield));
  if (node.isRich === true) {
    if (node.resource === 'stone') {
      return {
        label: `${marker.label} · ${formatReserve(remaining)} / ${formatReserve(capacity)} surface stone remaining · supports a non-depleting Large Quarry`,
        level: 'deep',
      };
    }
    return {
      label: `${marker.label} · rich deep ${resource} source · does not deplete`,
      level: 'deep',
    };
  }

  const level: GeologicalMapMarkerLevel = remaining <= 1e-6
    ? 'depleted'
    : capacity > 1e-6
      && remaining / capacity <= LOW_GEOLOGICAL_RESERVE_SHARE
      ? 'low'
      : 'stable';
  return {
    label: `${marker.label} · ${formatReserve(remaining)} / ${formatReserve(capacity)} finite ${resource} remaining`,
    level,
  };
}

function geologicalResourceLabel(resource: ResourceNodeState['resource']): string {
  switch (resource) {
    case 'stone':
    case 'clay':
    case 'iron':
    case 'salt':
      return resource;
    default:
      return 'geological material';
  }
}

function formatReserve(value: number): string {
  if (value > 1e-6 && value < 1) return '<1';
  return Math.round(value).toString();
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
