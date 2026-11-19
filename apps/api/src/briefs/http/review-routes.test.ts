import { BriefReviewResponse, REVIEW_AREAS, type Brief, type WorkspaceRole } from '@briefly/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { loadConfig } from '../../platform/config';
import { signToken, testEnv, testJwks } from '../../test/fixtures';
import type { ReviewGenerator, ReviewsRepo } from '../application/generate-review';
import type { StoredReview } from '../domain/review';
import type { BriefsRepo } from '../infra/briefs-repo';

const wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const brief: Brief = {
  id: briefId,
  workspaceId: wsA,
  title: 'Spring launch',
  status: 'draft',
  version: 2,
  body: 'text',
  updatedAt: '2026-11-18T09:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: null,
  submittedBy: null,
  submittedAt: null,
  decidedAt: null,
  decisionComment: null,
};
const review = {
  summary: 'ok',
  areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: 'present', note: 'n' }])),
  questions: [],
  risks: [],
};
const succeeded: StoredReview = {
  briefVersion: 2,
  state: 'succeeded',
  result: review,
  errorCode: null,
  model: 'claude-opus-5-5',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  editedAt: null,
};

let role: WorkspaceRole = 'editor';
let row: StoredReview | null = null;
const reviews = {
  get: vi.fn(async () => row),
  claim: vi.fn(async () => true),
  complete: vi.fn(async () => {
    row = succeeded;
    return true;
  }),
  saveEdit: vi.fn(async () => true),
} satisfies ReviewsRepo;
const briefs = { list: vi.fn(), get: vi.fn(async (ws: string, id: string) => (ws === wsA && id === briefId ? brief : null)), create: vi.fn(), update: vi.fn(), remove: vi.fn(), submit: vi.fn(), decide: vi.fn() } satisfies BriefsRepo;
const identity = (): IdentityRepo => ({ provisionMe: vi.fn(), listWorkspaces: vi.fn(), findWorkspace: async (id) => (id === wsA ? { id: wsA, name: 'A', role } : null) });
const generate = vi.fn<ReviewGenerator>(async () => ({ ok: true, review: { ...review, areas: review.areas as never }, model: 'claude-opus-5-5' }));

describe('review routes', () => {
  const app = buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor: identity, briefsFor: () => briefs, reviewsFor: () => reviews, generate });
  const offline = buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor: identity, briefsFor: () => briefs, reviewsFor: () => reviews, generate: null });
  afterAll(async () => {
    await app.close();
    await offline.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    role = 'editor';
    row = null;
  });

  const url = `/api/workspaces/${wsA}/briefs/${briefId}/review`;
  const call = async (method: 'GET' | 'POST' | 'PUT', payload?: unknown, target = app) =>
    target.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${await signToken()}` } });

  it('reports no review yet, with what the caller may do', async () => {
    const res = await call('GET');

    expect(BriefReviewResponse.parse(res.json())).toEqual({ review: null, permissions: { generate: true, edit: true } });
  });

  it('generates a review for an editor', async () => {
    const res = await call('POST');

    expect(res.statusCode).toBe(200);
    expect(BriefReviewResponse.parse(res.json()).review).toMatchObject({ state: 'succeeded', briefVersion: 2, outdated: false });
    expect(generate).toHaveBeenCalledWith({ title: 'Spring launch', body: 'text' });
  });

  it('refuses an approver with 403 and never calls the model', async () => {
    role = 'approver';

    expect((await call('POST')).statusCode).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it('answers 409 busy while another generation runs', async () => {
    reviews.claim.mockResolvedValueOnce(false);

    const res = await call('POST');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'busy' });
  });

  it('answers 503 ai_unavailable without a configured model, and offers no Generate button', async () => {
    expect((await call('POST', undefined, offline)).json()).toEqual({ error: 'ai_unavailable' });
    expect((await call('GET', undefined, offline)).json().permissions).toEqual({ generate: false, edit: true });
  });

  it('saves an edit made against the current brief version', async () => {
    row = succeeded;

    const res = await call('PUT', { review, briefVersion: 2 });

    expect(res.statusCode).toBe(200);
    expect(reviews.saveEdit).toHaveBeenCalledWith(wsA, briefId, 2, review);
  });

  it('refuses an edit made against older brief text, saving nothing', async () => {
    row = succeeded;

    const res = await call('PUT', { review, briefVersion: 1 });

    expect(res.json()).toEqual({ error: 'outdated' });
    expect(reviews.saveEdit).not.toHaveBeenCalled();
  });

  it('says there is no review to edit, rather than calling it outdated', async () => {
    row = { ...succeeded, state: 'failed', errorCode: 'timeout', result: null };

    expect((await call('PUT', { review, briefVersion: 2 })).json()).toEqual({ error: 'no_review' });
  });

  it('answers 404 for a brief in another workspace', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/briefs/${briefId}/review`, headers: { authorization: `Bearer ${await signToken()}` } });

    expect(res.statusCode).toBe(404);
  });
});

describe('review generation limits', () => {
  const minute = 60_000;
  const limits = { uploadPerUser: { max: 100, timeWindow: minute }, generatePerUser: { max: 2, timeWindow: minute }, generatePerWorkspace: { max: 3, timeWindow: minute } };
  const limited = () => buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor: identity, briefsFor: () => briefs, reviewsFor: () => reviews, generate, limits });
  const post = async (app: ReturnType<typeof limited>, uid = '00uALICE', wsId = wsA) =>
    app.inject({ method: 'POST', url: `/api/workspaces/${wsId}/briefs/${briefId}/review`, headers: { authorization: `Bearer ${await signToken({ uid })}` } });

  beforeEach(() => {
    vi.clearAllMocks();
    role = 'editor';
    row = null;
  });

  it('answers 429 with Retry-After once a user is over their limit, without calling the model; others are unaffected', async () => {
    const app = limited();
    await post(app);
    await post(app);

    const res = await post(app);

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(generate).toHaveBeenCalledTimes(2);
    expect((await post(app, '00uBOB')).statusCode).toBe(200);
    await app.close();
  });

  it('does not let a user stuck at their limit drain the workspace by retrying', async () => {
    const app = limited();
    await post(app, '00uALICE');
    await post(app, '00uALICE');
    for (let i = 0; i < 5; i++) expect((await post(app, '00uALICE')).statusCode).toBe(429);

    expect((await post(app, '00uBOB')).statusCode).toBe(200);
    await app.close();
  });

  it('refuses parallel requests past the limit even though they all passed the check', async () => {
    const app = limited();
    const codes = (await Promise.all([1, 2, 3, 4].map(() => post(app)))).map((r) => r.statusCode);

    expect(codes.filter((c) => c === 200)).toHaveLength(2);
    await app.close();
  });

  it('caps the workspace across users', async () => {
    const app = limited();
    await post(app, '00uALICE');
    await post(app, '00uALICE');
    await post(app, '00uBOB');

    expect((await post(app, '00uCAROL')).statusCode).toBe(429);
    await app.close();
  });

  it('does not count calls refused for role or membership', async () => {
    const app = limited();
    role = 'approver';
    for (let i = 0; i < 3; i++) expect((await post(app)).statusCode).toBe(403);
    for (let i = 0; i < 3; i++) expect((await post(app, '00uMALLORY', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).statusCode).toBe(404);
    role = 'editor';

    expect((await post(app)).statusCode).toBe(200);
    expect((await post(app)).statusCode).toBe(200);
    await app.close();
  });
});
