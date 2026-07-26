export const CONSTRUCTION_PRIORITIES = [0, 1, 2, 3] as const;
export type ConstructionPriority = (typeof CONSTRUCTION_PRIORITIES)[number];

export const CONSTRUCTION_PRIORITY_HOLD: ConstructionPriority = 0;
export const CONSTRUCTION_PRIORITY_LOW: ConstructionPriority = 1;
export const CONSTRUCTION_PRIORITY_NORMAL: ConstructionPriority = 2;
export const CONSTRUCTION_PRIORITY_URGENT: ConstructionPriority = 3;

export function normalizeConstructionPriority(value: number | undefined): ConstructionPriority {
  if (value == null || !Number.isFinite(value)) return CONSTRUCTION_PRIORITY_NORMAL;
  return Math.max(
    CONSTRUCTION_PRIORITY_HOLD,
    Math.min(CONSTRUCTION_PRIORITY_URGENT, Math.floor(value)),
  ) as ConstructionPriority;
}

export function constructionPriorityLabel(priority: ConstructionPriority): string {
  switch (priority) {
    case CONSTRUCTION_PRIORITY_HOLD: return 'Hold';
    case CONSTRUCTION_PRIORITY_LOW: return 'Low';
    case CONSTRUCTION_PRIORITY_NORMAL: return 'Normal';
    case CONSTRUCTION_PRIORITY_URGENT: return 'Urgent';
  }
  return 'Normal';
}
