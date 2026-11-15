// Single key factory: workspace-scoped keys ('ws', wsId, ...) join here in Phase 2 so a workspace switch or logout can drop them by prefix.
export const queryKeys = {
  health: ['health'] as const,
};
