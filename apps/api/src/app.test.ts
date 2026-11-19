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

describe('security headers and unknown paths', () => {
  const prod = buildApp(loadConfig({ ...testEnv, NODE_ENV: 'production' }), { jwks: testJwks });
  afterAll(() => prod.close());

  it('sends a strict CSP that admits only our own scripts and the Okta origin', async () => {
    const res = await prod.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(`connect-src 'self' ${new URL(testEnv.OKTA_ISSUER).origin}`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('puts the headers on refusals too', async () => {
    const res = await prod.inject({ method: 'GET', url: '/api/me' });

    expect(res.statusCode).toBe(401);
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sends no HSTS outside production', async () => {
    const dev = buildApp(loadConfig(testEnv), { jwks: testJwks });

    expect((await dev.inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security']).toBeUndefined();
    await dev.close();
  });

  it('answers unknown API routes with the error contract', async () => {
    const res = await prod.inject({ method: 'GET', url: '/api/nope', headers: { authorization: `Bearer ${await signToken()}` } });

    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('still asks for a token when the API path is percent-encoded', async () => {
    expect((await prod.inject({ method: 'GET', url: '/%61pi/me' })).statusCode).toBe(401);
    expect((await prod.inject({ method: 'POST', url: '/%61pi/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/briefs' })).statusCode).toBe(401);
  });

  it('refuses to register a protected route outside /api, where the token check does not run', async () => {
    const app = buildApp(loadConfig(testEnv), { jwks: testJwks });

    expect(() => app.get('/internal/x', async () => 'secret')).toThrow(/outside \/api/);
    await app.close();
  });
});
