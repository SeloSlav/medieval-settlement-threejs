// Review-only authoring. Keep out of production presets until the complete
// visual and GPU comparison passes with the intentional canopy layers intact.
export const ENVIRONMENT_CONIFER_TRIAL = {
  douglasFir: { leavesPerBranch: 8, size: 0.9, startFrac: 0.04, cardCoverage: 1.3 },
  loblolly: { leavesPerBranch: 7, size: 1.1, startFrac: 0.1, cardCoverage: 1.3 },
  pine: { leavesPerBranch: 8, size: 1.05, startFrac: 0.08, cardCoverage: 1.3 },
} as const;
