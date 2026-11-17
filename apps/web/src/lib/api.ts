import {
  BriefList,
  BriefResponse,
  HealthResponse,
  Me,
  Workspace,
  WorkspaceList,
  type BriefCreate,
  type BriefUpdate,
} from '@briefly/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  // `code` is the API's `{ error }` value when it sent one (e.g. 'no_text' for an upload), for specific messages.
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`API request failed with status ${status}`);
  }
}

// 400 is a malformed id in the URL; to the user that is the same as something that doesn't exist.
export const isNotFound = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 400);

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
async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = auth.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { headers };
  if (method !== 'GET') init.method = method;
  // FormData sets its own multipart Content-Type (with the boundary); everything else is JSON.
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  if (res.status === 401) auth.onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  return res;
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json().catch(() => null);
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : undefined;
}

const getJson = async <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> =>
  schema.parse(await (await request('GET', path)).json());

const sendJson = async <S extends z.ZodType>(method: 'POST' | 'PUT', path: string, body: unknown, schema: S): Promise<z.infer<S>> =>
  schema.parse(await (await request(method, path, body)).json());

const ws = (wsId: string) => `/api/workspaces/${encodeURIComponent(wsId)}`;
const brief = (wsId: string, briefId: string) => `${ws(wsId)}/briefs/${encodeURIComponent(briefId)}`;

export const fetchHealth = () => getJson('/api/health', HealthResponse);
export const fetchMe = () => getJson('/api/me', Me);
export const fetchWorkspaces = async () => (await getJson('/api/workspaces', WorkspaceList)).workspaces;
export const fetchWorkspace = (wsId: string) => getJson(ws(wsId), Workspace);

export const fetchBriefs = (wsId: string) => getJson(`${ws(wsId)}/briefs`, BriefList);
export const fetchBrief = (wsId: string, briefId: string) => getJson(brief(wsId, briefId), BriefResponse);
export const createBrief = (wsId: string, input: BriefCreate) => sendJson('POST', `${ws(wsId)}/briefs`, input, BriefResponse);
export const updateBrief = (wsId: string, briefId: string, input: BriefUpdate) =>
  sendJson('PUT', brief(wsId, briefId), input, BriefResponse);
export const deleteBrief = async (wsId: string, briefId: string) => {
  await request('DELETE', brief(wsId, briefId));
};

export const uploadBrief = async (wsId: string, file: File, title?: string) => {
  const form = new FormData();
  if (title?.trim()) form.append('title', title);
  form.append('file', file);
  return BriefResponse.parse(await (await request('POST', `${ws(wsId)}/briefs/upload`, form)).json());
};

// The original comes back as bytes, not JSON, so it skips the contract parsing; the token stays in the header.
export const downloadBriefSource = async (wsId: string, briefId: string): Promise<Blob> =>
  (await request('GET', `${brief(wsId, briefId)}/source`)).blob();
