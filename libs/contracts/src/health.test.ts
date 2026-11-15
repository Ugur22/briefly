import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts a healthy payload', () => {
    expect(HealthResponse.safeParse({ status: 'ok', version: '1.0.0', commit: 'abc' }).success).toBe(true);
  });

  it('rejects anything but status ok', () => {
    expect(HealthResponse.safeParse({ status: 'degraded', version: '1.0.0', commit: 'abc' }).success).toBe(false);
  });
});
