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

/**
 * Returns gameplay extent metadata for inspector readouts, not placement exclusions.
 * Wells can display their service radius through the inspector coverage toggle.
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
