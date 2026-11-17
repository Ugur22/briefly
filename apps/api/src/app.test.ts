import { HealthResponse } from '@briefly/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './platform/config';
import { signToken, testEnv, testJwks } from './test/fixtures';

describe('api', () => {
  const app = buildApp(loadConfig({ ...testEnv, APP_VERSION: '1.2.3', GIT_SHA: 'abc123' }), { jwks: testJwks });
  afterAll(() => app.close());

  it('reports health with version and commit, without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc123' });
  });

  it('answers 401 for unknown routes when anonymous, so routes can’t be enumerated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(401);
  });

  it('answers 503, not 401, when Okta’s key set is unreachable, so users are not signed out by an outage', async () => {
    const offline = buildApp(loadConfig(testEnv), {
      jwks: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const res = await offline.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${await signToken()}` } });

    expect(res.statusCode).toBe(503);
    await offline.close();
  });

  it('answers 404 for unknown routes when signed in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { authorization: `Bearer ${await signToken()}` } });

    expect(res.statusCode).toBe(404);
  });
});
