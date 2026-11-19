import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { signToken, testEnv, testJwks } from '../test/fixtures';
import { loadConfig } from './config';
import { loadWebApp } from './web-app';

const dist = mkdtempSync(join(tmpdir(), 'briefly-web-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');

describe('serving the web app', () => {
  const app = buildApp(loadConfig({ ...testEnv, NODE_ENV: 'production' }), { jwks: testJwks, web: loadWebApp(dist) });
  afterAll(() => app.close());

  it('serves index.html for client-side routes, uncached and under the CSP, without a token', async () => {
    for (const url of ['/', '/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/briefs', '/login/callback?code=x&state=y']) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    }
  });

  it('serves hashed assets as immutable with their type', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/javascript/);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404, never index.html, for a missing asset or any path with a file extension', async () => {
    for (const url of ['/assets/index-old999.js', '/assets/..%2Findex.html', '/favicon.ico', '/robots.txt']) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).not.toMatch(/html/);
    }
  });

  it('keeps the API behind its token and its error contract', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { authorization: `Bearer ${await signToken()}` } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('does not serve index.html for other methods', async () => {
    expect((await app.inject({ method: 'POST', url: '/w/x' })).statusCode).toBe(404);
  });

  it('answers an encoded API path with the API, not the web app', async () => {
    expect((await app.inject({ method: 'GET', url: '/%61pi/nope' })).headers['content-type']).not.toMatch(/html/);
  });

  it('does not serve a web app at all when none was built', async () => {
    const bare = buildApp(loadConfig(testEnv), { jwks: testJwks, web: null });

    expect((await bare.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    await bare.close();
  });
});
