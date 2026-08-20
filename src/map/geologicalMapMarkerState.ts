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
 * Every rich geological node exposes the same two-part model: a finite
 * surface reserve for a nearby Mining Pit and a non-depleting underground
 * source for a Quarry centered on the node.
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
    return {
      label: `${marker.label} · ${formatReserve(remaining)} / ${formatReserve(capacity)} surface ${resource} remaining · underground ${resource} does not deplete · center a Quarry on this node`,
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
