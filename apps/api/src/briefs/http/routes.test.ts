import { DbError } from '../../platform/db-error';
import { BriefList, BriefResponse, BriefSummary, type Brief, type Workspace, type WorkspaceRole } from '@briefly/contracts';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import type { IdentityRepo } from '../../identity/infra/identity-repo';
import { loadConfig } from '../../platform/config';
import { signToken, testEnv, testJwks } from '../../test/fixtures';
import type { BriefsRepo, UpdateResult } from '../infra/briefs-repo';

const wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const wsB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const brief: Brief = {
  id: briefId,
  workspaceId: wsA,
  title: 'Spring launch',
  status: 'draft',
  version: 1,
  body: 'Confidential client plan',
  updatedAt: '2026-11-18T09:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: null,
  submittedBy: null,
  submittedAt: null,
  decidedAt: null,
  decisionComment: null,
};

// The caller is a member of workspace A only, with whatever role the test sets.
let role: WorkspaceRole = 'editor';
let updateResult: UpdateResult = { kind: 'ok', brief: { ...brief, version: 2 } };
const briefs = {
  list: vi.fn(async (ws: string) => (ws === wsA ? [brief] : [])),
  get: vi.fn(async (ws: string, id: string) => (ws === wsA && id === briefId ? brief : null)),
  create: vi.fn(async () => brief),
  update: vi.fn(async () => updateResult),
  remove: vi.fn(async (ws: string, id: string) => ws === wsA && id === briefId),
  submit: vi.fn<BriefsRepo['submit']>(async () => ({ kind: 'ok', brief: { ...brief, status: 'in_review' } })),
  decide: vi.fn<BriefsRepo['decide']>(async () => ({ kind: 'ok', brief: { ...brief, status: 'approved' } })),
} satisfies BriefsRepo;
const sources = { put: vi.fn(async () => 'ok' as const), get: vi.fn(async () => null), remove: vi.fn(async () => true) };
const identity = (): IdentityRepo => ({
  provisionMe: async () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'a@test.dev' }),
  listWorkspaces: async () => [{ id: wsA, name: 'A', role }],
  findWorkspace: async (id): Promise<Workspace | null> => (id === wsA ? { id: wsA, name: 'A', role } : null),
});

describe('briefs routes', () => {
  const app = buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor: identity, briefsFor: () => briefs, sourcesFor: () => sources });
  afterAll(() => app.close());

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${await signToken()}` } });

  it('lists briefs with what the caller may do', async () => {
    role = 'approver';
    const res = await call('GET', `/api/workspaces/${wsA}/briefs`);

    // The response schema strips the body: listing never ships brief text.
    expect(BriefList.parse(res.json())).toEqual({ briefs: [BriefSummary.parse(brief)], permissions: { create: false } });
    expect(res.body).not.toContain(brief.body);
  });

  it('answers 404 for a workspace the caller is not in', async () => {
    for (const [method, url] of [
      ['GET', `/api/workspaces/${wsB}/briefs`],
      ['GET', `/api/workspaces/${wsB}/briefs/${briefId}`],
      ['DELETE', `/api/workspaces/${wsB}/briefs/${briefId}`],
    ] as const) {
      role = 'admin';
      expect((await call(method, url)).statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('answers 404 for a brief that belongs to another workspace, even via a workspace the caller is in', async () => {
    const res = await call('GET', `/api/workspaces/${wsA}/briefs/b1ef0000-0000-4000-8000-0000000000ff`);

    expect(res.statusCode).toBe(404);
  });

  it('lets an editor create, scoped to the workspace in the URL', async () => {
    role = 'editor';
    const res = await call('POST', `/api/workspaces/${wsA}/briefs`, { title: '  Spring launch ', body: 'x' });

    expect(res.statusCode).toBe(201);
    expect(BriefResponse.parse(res.json()).permissions).toEqual({ edit: true, delete: false, submit: true, decide: false });
    expect(briefs.create).toHaveBeenLastCalledWith(wsA, { title: 'Spring launch', body: 'x' });
  });

  it.each([
    ['approver', 'POST', `/api/workspaces/${wsA}/briefs`, { title: 't', body: '' }],
    ['approver', 'PUT', `/api/workspaces/${wsA}/briefs/${briefId}`, { title: 't', body: '', version: 1 }],
    ['editor', 'DELETE', `/api/workspaces/${wsA}/briefs/${briefId}`, undefined],
  ] as const)('refuses a%s %s with 403 before touching the data', async (r, method, url, payload) => {
    role = r;
    briefs.create.mockClear();
    briefs.update.mockClear();
    briefs.remove.mockClear();

    const res = await call(method, url, payload);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect(briefs.create).not.toHaveBeenCalled();
    expect(briefs.update).not.toHaveBeenCalled();
    expect(briefs.remove).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'ok', brief: { ...brief, version: 2 } }, 200],
    [{ kind: 'conflict' }, 409],
    [{ kind: 'not_found' }, 404],
    [{ kind: 'forbidden' }, 403],
  ] as const)('maps an update result %j to %i', async (result, status) => {
    role = 'editor';
    updateResult = result;

    const res = await call('PUT', `/api/workspaces/${wsA}/briefs/${briefId}`, { title: 't', body: 'b', version: 1 });

    expect(res.statusCode).toBe(status);
  });

  it('lets an admin delete, and removes the original with it', async () => {
    role = 'admin';

    expect((await call('DELETE', `/api/workspaces/${wsA}/briefs/${briefId}`)).statusCode).toBe(204);
    expect(sources.remove).toHaveBeenLastCalledWith(`workspaces/${wsA}/briefs/${briefId}/original`);
  });

  it('still answers 204 when the original cannot be removed (the row, and so all access, is already gone)', async () => {
    role = 'admin';
    sources.remove.mockRejectedValueOnce(new Error('storage down'));

    expect((await call('DELETE', `/api/workspaces/${wsA}/briefs/${briefId}`)).statusCode).toBe(204);
  });

  it('submits a brief for review', async () => {
    role = 'editor';

    const res = await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/submit`, { version: 1 });

    expect(res.statusCode).toBe(200);
    expect(BriefResponse.parse(res.json()).brief.status).toBe('in_review');
    expect(briefs.submit).toHaveBeenLastCalledWith(wsA, briefId, 1);
  });

  it.each([
    ['BRF03', 409, 'no_current_review'],
    ['BRF01', 409, 'locked'],
    ['BRF04', 409, 'invalid_transition'],
  ])('passes the workflow refusal %s on as %i %s', async (code, status, error) => {
    role = 'editor';
    briefs.submit.mockRejectedValueOnce(new DbError('briefs.submit', code));

    const res = await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/submit`, { version: 1 });

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
  });

  it('lets an approver decide', async () => {
    role = 'approver';

    const res = await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/decision`, { decision: 'approve' });

    expect(BriefResponse.parse(res.json()).brief.status).toBe('approved');
  });

  it('refuses a decision from an editor before asking the database', async () => {
    role = 'editor';
    briefs.decide.mockClear();

    expect((await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/decision`, { decision: 'approve' })).statusCode).toBe(403);
    expect(briefs.decide).not.toHaveBeenCalled();
  });

  it('answers 403 self_approval when the database refuses the submitter', async () => {
    role = 'admin';
    briefs.decide.mockRejectedValueOnce(new DbError('briefs.decide', 'BRF02'));

    const res = await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/decision`, { decision: 'approve' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'self_approval' });
  });

  it('needs a comment to send a brief back', async () => {
    role = 'approver';

    expect((await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/decision`, { decision: 'request_changes', comment: '  ' })).statusCode).toBe(400);
  });

  it('answers 409 not_in_review when the brief was not waiting for a decision', async () => {
    role = 'approver';
    briefs.decide.mockResolvedValueOnce({ kind: 'conflict' });

    expect((await call('POST', `/api/workspaces/${wsA}/briefs/${briefId}/decision`, { decision: 'approve' })).json()).toEqual({ error: 'not_in_review' });
  });

  it('never echoes brief text back in a validation error', async () => {
    role = 'editor';
    const secret = 'Confidential launch date 2027-03-01';

    const tooLong = await call('POST', `/api/workspaces/${wsA}/briefs`, { title: secret.repeat(10), body: secret });
    const badJson = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsA}/briefs`,
      payload: `{"title":"${secret}", body`,
      headers: { authorization: `Bearer ${await signToken()}`, 'content-type': 'application/json' },
    });

    expect(tooLong.statusCode).toBe(400);
    expect(badJson.statusCode).toBe(400);
    expect(tooLong.body).not.toContain('Confidential');
    expect(badJson.body).not.toContain('Confidential');
  });
});
