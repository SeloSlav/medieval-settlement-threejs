import { MONASTERY_COVERAGE_RADIUS } from '../generated/gameBalance.ts';
import type { BuildingKind } from '../resources/types.ts';

export type BuildingExtent = {
  type: 'work' | 'service' | 'coverage';
  label: string;
  radius: number;
};

const WORK_EXTENT_KINDS = new Set<BuildingKind>([
  'lumber_mill',
  'reforester',
  'stone_quarry',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'apiary',
]);

const BUILDING_EXTENT_COLORS: Partial<Record<BuildingKind, number>> = {
  lumber_mill: 0xd7b463,
  reforester: 0x00cc66,
  stone_quarry: 0xa8a29e,
  large_quarry: 0xd5b866,
  well: 0x4f9fd4,
  hunters_hall: 0x8a6d45,
  foragers_shed: 0xb05c76,
  fishing_camp: 0x5b99b0,
  threshing_barn: 0xb8894c,
  monastery: 0xe4dfd2,
  watchtower: 0xe0ad4f,
  palisaded_refuge: 0xb87945,
};

export function buildingExtentColor(kind: BuildingKind): number {
  return BUILDING_EXTENT_COLORS[kind] ?? 0xd7b463;
}

/**
 * Returns a gameplay extent worth visualizing. A non-zero balance workRadius is
 * not, by itself, permission to draw a ring: processors and other point
 * buildings do not gain an extent overlay just because they are selected.
 */
export function getBuildingExtent(kind: BuildingKind, workRadius: number): BuildingExtent | null {
  if (kind === 'monastery') {
    return {
      type: 'coverage',
      label: 'Faith coverage',
      radius: MONASTERY_COVERAGE_RADIUS,
    };
  }

  if (kind === 'well' && workRadius > 0) {
    return {
      type: 'service',
      label: 'Water service extent',
      radius: workRadius,
    };
  }

  if (kind === 'watchtower' && workRadius > 0) {
    return {
      type: 'coverage',
      label: 'Watch coverage',
      radius: workRadius,
    };
  }

  if (kind === 'palisaded_refuge' && workRadius > 0) {
    return {
      type: 'coverage',
      label: 'Household rally reach',
      radius: workRadius,
    };
  }

  if (!WORK_EXTENT_KINDS.has(kind) || workRadius <= 0) return null;

  return {
    type: 'work',
    label: kind === 'threshing_barn'
      ? 'Field work extent'
      : kind === 'pastoral_farmstead'
        ? 'Pasture work extent'
      : kind === 'swineherd'
          ? 'Pannage work extent'
          : kind === 'apiary'
            ? 'Bee forage extent'
          : 'Work extent',
    radius: workRadius,
  };
}
