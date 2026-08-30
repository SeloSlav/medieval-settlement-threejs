export function getAvailableAnimationLabels(
  knownLabels: readonly string[],
  assignments: readonly string[],
  clipIndex: number,
): string[] {
  const currentLabel = assignments[clipIndex] ?? '';
  const assignedElsewhere = new Set(
    assignments.filter((label, index) => index !== clipIndex && Boolean(label)),
  );
  const availableLabels = knownLabels.filter((label) => !assignedElsewhere.has(label));
  if (currentLabel && !availableLabels.includes(currentLabel)) {
    availableLabels.unshift(currentLabel);
  }
  return availableLabels;
}

export function countUnassignedAnimationLabels(
  knownLabels: readonly string[],
  assignments: readonly string[],
): number {
  const assigned = new Set(assignments.filter(Boolean));
  return knownLabels.filter((label) => !assigned.has(label)).length;
}

export function selectAnimationLabelCatalog(
  knownLabels: readonly string[],
  labelsExcludedFromReducedExport: ReadonlySet<string>,
  animationCount: number,
): string[] {
  const reduced = knownLabels.filter(
    (label) => !labelsExcludedFromReducedExport.has(label),
  );
  return reduced.length === animationCount ? reduced : [...knownLabels];
}
