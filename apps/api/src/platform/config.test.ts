import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toMatchObject({ NODE_ENV: 'development', PORT: 3000, HOST: '127.0.0.1' });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
