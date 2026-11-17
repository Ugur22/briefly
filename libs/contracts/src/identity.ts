import { z } from 'zod';

export const Me = z.object({
  id: z.uuid(),
  email: z.string(),
});
export type Me = z.infer<typeof Me>;

export const WorkspaceRole = z.enum(['editor', 'approver', 'admin']);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

export const Workspace = z.object({
  id: z.uuid(),
  name: z.string(),
  role: WorkspaceRole,
});
export type Workspace = z.infer<typeof Workspace>;

export const WorkspaceList = z.object({
  workspaces: z.array(Workspace),
});
export type WorkspaceList = z.infer<typeof WorkspaceList>;

export const WorkspaceParams = z.object({
  wsId: z.uuid(),
});

export const ApiErrorBody = z.object({
  error: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
