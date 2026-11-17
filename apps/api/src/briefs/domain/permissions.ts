import type { WorkspaceRole } from '@briefly/contracts';

export type BriefCapabilities = { create: boolean; edit: boolean; delete: boolean };

// Mirrors the RLS policies on public.briefs so the API can answer 403 with a reason and the web can hide
// what the user can't do. RLS stays the authority: a wrong entry here can deny, never grant.
const BY_ROLE: Record<WorkspaceRole, BriefCapabilities> = {
  editor: { create: true, edit: true, delete: false },
  approver: { create: false, edit: false, delete: false },
  admin: { create: true, edit: true, delete: true },
};

export const briefPermissions = (role: WorkspaceRole): BriefCapabilities => BY_ROLE[role];
