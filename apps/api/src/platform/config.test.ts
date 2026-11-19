import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { testEnv } from '../test/fixtures';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(testEnv)).toMatchObject({ PORT: 3000, HOST: '127.0.0.1' });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ ...testEnv, PORT: 'abc' })).toThrow(/Invalid environment/);
  });

  it('fails fast when Okta or Supabase settings are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/OKTA_ISSUER/);
  });

  it('rejects an issuer with a trailing slash, which would never match iss', () => {
    expect(() => loadConfig({ ...testEnv, OKTA_ISSUER: `${testEnv.OKTA_ISSUER}/` })).toThrow(/OKTA_ISSUER/);
  });

  it('refuses to serve a web bundle built for another Okta issuer, which the CSP would block', () => {
    expect(() => loadConfig({ ...testEnv, WEB_DIST: '/app/web', WEB_OKTA_ISSUER: 'https://other.test/oauth2/default' })).toThrow(/WEB_OKTA_ISSUER/);
    expect(loadConfig({ ...testEnv, WEB_DIST: '/app/web', WEB_OKTA_ISSUER: testEnv.OKTA_ISSUER }).WEB_DIST).toBe('/app/web');
  });
});
