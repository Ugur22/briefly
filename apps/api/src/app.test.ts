import { HealthResponse } from '@briefly/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './platform/config';

describe('api', () => {
  const app = buildApp(loadConfig({ NODE_ENV: 'test', APP_VERSION: '1.2.3', GIT_SHA: 'abc123' }));
  afterAll(() => app.close());

  it('reports health with version and commit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc123' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
  });
});
