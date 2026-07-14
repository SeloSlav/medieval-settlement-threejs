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
  'threshing_barn',
]);

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

  if (!WORK_EXTENT_KINDS.has(kind) || workRadius <= 0) return null;

  return {
    type: 'work',
    label: kind === 'threshing_barn' ? 'Field work extent' : 'Work extent',
    radius: workRadius,
  };
}
