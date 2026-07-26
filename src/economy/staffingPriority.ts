export const STAFFING_PRIORITIES = [1, 2, 3] as const;
export type StaffingPriority = (typeof STAFFING_PRIORITIES)[number];

export const STAFFING_PRIORITY_LOW = 1 as const;
export const STAFFING_PRIORITY_NORMAL = 2 as const;
export const STAFFING_PRIORITY_HIGH = 3 as const;

export function normalizeStaffingPriority(value: number | undefined): StaffingPriority {
  if (
    value === STAFFING_PRIORITY_LOW
    || value === STAFFING_PRIORITY_NORMAL
    || value === STAFFING_PRIORITY_HIGH
  ) {
    return value;
  }
  return STAFFING_PRIORITY_NORMAL;
}

export function staffingPriorityLabel(priority: StaffingPriority): string {
  switch (priority) {
    case STAFFING_PRIORITY_LOW:
      return 'Low';
    case STAFFING_PRIORITY_NORMAL:
      return 'Normal';
    case STAFFING_PRIORITY_HIGH:
      return 'High';
    default: {
      const unhandled: never = priority;
      return unhandled;
    }
  }
}

export function staffingPriorityHint(priority: StaffingPriority): string {
  switch (priority) {
    case STAFFING_PRIORITY_LOW:
      return 'Releases workers before normal and high-priority jobs, and fills after them.';
    case STAFFING_PRIORITY_NORMAL:
      return 'The settlement default for priority call-ups and population-loss reassignment.';
    case STAFFING_PRIORITY_HIGH:
      return 'Retains workers until lower-priority jobs release theirs, and fills before them.';
    default: {
      const unhandled: never = priority;
      return unhandled;
    }
  }
}
