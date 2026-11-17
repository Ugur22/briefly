// Single key factory. Workspace data lives under ['ws', wsId, ...] so a workspace switch can drop it by prefix;
// sign-out and a 401 clear the whole cache.
export const queryKeys = {
  health: ['health'] as const,
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (wsId: string) => ['ws', wsId] as const,
};
