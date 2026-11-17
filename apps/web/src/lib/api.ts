import { HealthResponse, Me, Workspace, WorkspaceList } from '@briefly/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
  }
}

type ApiAuth = {
  getAccessToken: () => string | undefined;
  onUnauthorized: () => void;
};

let auth: ApiAuth = { getAccessToken: () => undefined, onUnauthorized: () => {} };

// Set once at startup; kept out of this module so tests don't need Okta.
export function configureApi(next: ApiAuth) {
  auth = next;
}

// The only place that calls /api/*: responses are parsed against the shared contract, so drift fails loudly here.
async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = auth.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { headers });
  if (res.status === 401) auth.onUnauthorized();
  if (!res.ok) throw new ApiError(res.status);
  return schema.parse(await res.json());
}

export const fetchHealth = () => getJson('/api/health', HealthResponse);
export const fetchMe = () => getJson('/api/me', Me);
export const fetchWorkspaces = async () => (await getJson('/api/workspaces', WorkspaceList)).workspaces;
export const fetchWorkspace = (wsId: string) => getJson(`/api/workspaces/${encodeURIComponent(wsId)}`, Workspace);
