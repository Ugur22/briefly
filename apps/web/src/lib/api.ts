import {
  BriefList,
  BriefReviewResponse,
  type Decision,
  type ReviewEdit,
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

type SessionSnapshot = { accessToken: string | undefined; sessionKey?: string };
type ApiAuth = {
  getSessionSnapshot: () => SessionSnapshot;
  onUnauthorized: () => void;
};

let auth: ApiAuth = { getSessionSnapshot: () => ({ accessToken: undefined }), onUnauthorized: () => {} };

// Set once at startup; kept out of this module so tests don't need Okta.
export function configureApi(next: ApiAuth) {
  auth = next;
}

// The only place that calls /api/*: responses are parsed against the shared contract, so drift fails loudly here.
async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, read: (res: Response) => Promise<T> | T): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const config = auth;
  const { accessToken: token, sessionKey = token } = config.getSessionSnapshot();
  function assertCurrent() {
    const current = auth.getSessionSnapshot();
    if (auth !== config || (current.sessionKey ?? current.accessToken) !== sessionKey) {
      throw new DOMException('Session changed', 'AbortError');
    }
    return current;
  }

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

  let res: Response;
  let current: SessionSnapshot;
  let code: string | undefined;
  try {
    res = await fetch(path, init);
    assertCurrent();
    if (res.ok) return await read(res);
    code = await errorCode(res);
  } finally {
    current = assertCurrent();
  }
  if (res.status === 401 && token && token === current.accessToken) auth.onUnauthorized();
  throw new ApiError(res.status, code);
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json().catch(() => null);
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : undefined;
}

const getJson = async <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> =>
  request('GET', path, undefined, async res => schema.parse(await res.json()));

const sendJson = async <S extends z.ZodType>(method: 'POST' | 'PUT', path: string, body: unknown, schema: S): Promise<z.infer<S>> =>
  request(method, path, body, async res => schema.parse(await res.json()));

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
  await request('DELETE', brief(wsId, briefId), undefined, () => undefined);
};

export const uploadBrief = async (wsId: string, file: File, title?: string) => {
  const form = new FormData();
  if (title?.trim()) form.append('title', title);
  form.append('file', file);
  return sendJson('POST', `${ws(wsId)}/briefs/upload`, form, BriefResponse);
};

// The original comes back as bytes, not JSON, so it skips the contract parsing; the token stays in the header.
export const downloadBriefSource = async (wsId: string, briefId: string): Promise<Blob> =>
  request('GET', `${brief(wsId, briefId)}/source`, undefined, res => res.blob());

export const fetchReview = (wsId: string, briefId: string) => getJson(`${brief(wsId, briefId)}/review`, BriefReviewResponse);
// Waits for the model (up to ~50 s); the caller shows progress and keeps the button disabled meanwhile.
export const generateReview = async (wsId: string, briefId: string) =>
  sendJson('POST', `${brief(wsId, briefId)}/review`, undefined, BriefReviewResponse);
export const saveReview = (wsId: string, briefId: string, edit: ReviewEdit) => sendJson('PUT', `${brief(wsId, briefId)}/review`, edit, BriefReviewResponse);

export const submitBrief = (wsId: string, briefId: string, version: number) => sendJson('POST', `${brief(wsId, briefId)}/submit`, { version }, BriefResponse);
export const decideBrief = (wsId: string, briefId: string, decision: Decision) => sendJson('POST', `${brief(wsId, briefId)}/decision`, decision, BriefResponse);
