import { Me, Workspace, WorkspaceList } from '@briefly/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { loadConfig } from '../../platform/config';
import { signToken, testEnv, testJwks } from '../../test/fixtures';
import { DbError } from '../../platform/db-error';
import type { IdentityRepo } from '../infra/identity-repo';

const acme: Workspace = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', role: 'admin' };
const globexId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Stands in for RLS: alice's token only ever reaches Acme.
const tokensSeen: string[] = [];
const repoFor = (token: string): IdentityRepo => {
  tokensSeen.push(token);
  return {
    provisionMe: async () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'alice@test.dev' }),
    listWorkspaces: async () => [acme],
    findWorkspace: async (id) => (id === acme.id ? acme : null),
  };
};

describe('identity routes', () => {
  const app = buildApp(loadConfig(testEnv), { jwks: testJwks, repoFor });
  afterAll(() => app.close());

  const get = async (url: string, token?: string) =>
    app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('requires a token on every non-public route', async () => {
    for (const url of ['/api/me', '/api/workspaces', `/api/workspaces/${acme.id}`]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('rejects a token issued to another Okta client', async () => {
    const res = await get('/api/me', await signToken({ cid: '0oaOTHER' }));

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('forwards the caller’s own token to the data layer', async () => {
    const token = await signToken();
    tokensSeen.length = 0;

    await get('/api/me', token);

    expect(tokensSeen).toEqual([token]);
  });

  it('returns the provisioned user', async () => {
    const res = await get('/api/me', await signToken());

    expect(res.statusCode).toBe(200);
    expect(Me.parse(res.json()).email).toBe('alice@test.dev');
  });

  it('lists the caller’s workspaces', async () => {
    const res = await get('/api/workspaces', await signToken());

    expect(WorkspaceList.parse(res.json())).toEqual({ workspaces: [acme] });
  });

  it('returns a workspace the caller belongs to', async () => {
    const res = await get(`/api/workspaces/${acme.id}`, await signToken());

    expect(Workspace.parse(res.json())).toEqual(acme);
  });

  it('answers 404 for another tenant’s workspace, same as a missing one', async () => {
    const res = await get(`/api/workspaces/${globexId}`, await signToken());

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('answers a database refusal with 403 in the contract shape, naming nothing internal', async () => {
    const refusing = buildApp(loadConfig(testEnv), {
      jwks: testJwks,
      repoFor: () => ({ ...repoFor(''), provisionMe: async () => Promise.reject(new DbError('provision_me', '42501')) }),
    });

    const res = await refusing.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${await signToken()}` } });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    await refusing.close();
  });

  it('rejects a malformed workspace id before touching the database', async () => {
    const res = await get('/api/workspaces/acme', await signToken());

    expect(res.statusCode).toBe(400);
  });
});
