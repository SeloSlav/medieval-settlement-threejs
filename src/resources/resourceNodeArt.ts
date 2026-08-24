import type { ResourceKind, ResourceNodeKind } from './types.ts';

export const RESOURCE_NODE_ART_FAMILIES = [
  'stone',
  'game',
  'berries',
  'mushrooms',
  'fish',
  'clay',
  'iron',
  'salt',
] as const;

export type ResourceNodeArtFamily = typeof RESOURCE_NODE_ART_FAMILIES[number];
export type ResourceNodeArtVariant = 'normal' | 'rich';
export type ResourceNodeArtKey = `${ResourceNodeArtFamily}-${ResourceNodeArtVariant}`;

export function resourceNodeArtFamily(
  kind: ResourceNodeKind | 'clay',
  resource?: ResourceKind,
): ResourceNodeArtFamily {
  if (kind === 'quarry') {
    switch (resource) {
      case 'clay':
      case 'iron':
      case 'salt':
      case 'stone':
        return resource;
      default:
        return 'stone';
    }
  }
  return kind;
}

export function resourceNodeArtKey(
  kind: ResourceNodeKind | 'clay',
  resource: ResourceKind | undefined,
  isRich: boolean,
): ResourceNodeArtKey {
  return `${resourceNodeArtFamily(kind, resource)}-${isRich ? 'rich' : 'normal'}`;
}

export function resourceNodeArtUrl(
  kind: ResourceNodeKind | 'clay',
  resource: ResourceKind | undefined,
  isRich: boolean,
): string {
  return `/assets/ui/map-stamps/${resourceNodeArtKey(kind, resource, isRich)}.png`;
}
