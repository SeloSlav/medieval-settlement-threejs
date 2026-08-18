export type StaffingPriority = 1 | 2 | 3;

export const STAFFING_PRIORITY_LOW = 1 as const;
export const STAFFING_PRIORITY_NORMAL = 2 as const;
export const STAFFING_PRIORITY_HIGH = 3 as const;

/**
 * Completed workplaces have no player-directed tier. Keep the neutral value
 * as an internal compatibility input for existing fair-share queue helpers.
 */
export function normalizeStaffingPriority(_value: number | undefined): StaffingPriority {
  return STAFFING_PRIORITY_NORMAL;
}

