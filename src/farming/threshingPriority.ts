export const THRESHING_PRIORITY_LOW = 1;
export const THRESHING_PRIORITY_AUTO = 2;
export const THRESHING_PRIORITY_HIGH = 3;
export const THRESHING_PRIORITY_DEFAULT = THRESHING_PRIORITY_AUTO;

const TASK_SURPLUS_THRESHING = 1;
const TASK_NORMAL_FIELD = 2;
const TASK_DEMAND_THRESHING = 3;
const TASK_HIGH_FIELD = 4;
const TASK_URGENT_FIELD = 5;
const TASK_PRIORITY_THRESHING = 6;
const TASK_HARVEST = 7;

export type ThreshingPriority =
  | typeof THRESHING_PRIORITY_LOW
  | typeof THRESHING_PRIORITY_AUTO
  | typeof THRESHING_PRIORITY_HIGH;

export const THRESHING_PRIORITY_PRESETS = [
  {
    priority: THRESHING_PRIORITY_LOW,
    label: 'Fields first',
    hint: 'Threshes only after every ready field job is quiet.',
  },
  {
    priority: THRESHING_PRIORITY_AUTO,
    label: 'Automatic',
    hint: 'Restores seed and one dispatch load after High fields but before Normal fields.',
  },
  {
    priority: THRESHING_PRIORITY_HIGH,
    label: 'Thresh first',
    hint: 'Threshes before every non-harvest field job. A ready harvest always remains first.',
  },
] as const;

export function normalizeThreshingPriority(
  priority: number | undefined,
): ThreshingPriority {
  return priority === THRESHING_PRIORITY_LOW
      || priority === THRESHING_PRIORITY_AUTO
      || priority === THRESHING_PRIORITY_HIGH
    ? priority
    : THRESHING_PRIORITY_DEFAULT;
}

export function threshingPriorityLabel(priority: number | undefined): string {
  const normalized = normalizeThreshingPriority(priority);
  return THRESHING_PRIORITY_PRESETS.find((preset) => preset.priority === normalized)?.label
    ?? 'Automatic';
}

export function fieldTaskRank(priority: number, harvesting: boolean): number {
  if (priority <= 0) return 0;
  if (harvesting) return TASK_HARVEST;
  if (priority >= 3) return TASK_URGENT_FIELD;
  if (priority >= 2) return TASK_HIGH_FIELD;
  return TASK_NORMAL_FIELD;
}

export function threshingTaskRank(priority: number | undefined, demanded: boolean): number {
  const normalized = normalizeThreshingPriority(priority);
  if (normalized === THRESHING_PRIORITY_HIGH) return TASK_PRIORITY_THRESHING;
  if (normalized === THRESHING_PRIORITY_AUTO && demanded) return TASK_DEMAND_THRESHING;
  return TASK_SURPLUS_THRESHING;
}
