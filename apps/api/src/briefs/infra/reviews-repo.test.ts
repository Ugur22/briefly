import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { reviewsRepo } from './reviews-repo';

describe('reviewsRepo.claim', () => {
  // Records the calls; each awaited query takes the next result.
  function fakeDb(results: { data: unknown; error: null }[]) {
    const calls: [string, ...unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'upsert', 'update', 'eq', 'or']) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (r: unknown) => unknown) => Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve);
    return { db: builder as unknown as SupabaseClient, calls };
  }
  const started = new Date('2026-11-18T10:00:00Z');
  const stale = new Date('2026-11-18T09:58:00Z');

  it('claims a first review by inserting it, without an upsert that would rewrite brief_id', async () => {
    const { db, calls } = fakeDb([{ data: [{ brief_id: 'b' }], error: null }]);

    expect(await reviewsRepo(db).claim('w', 'b', 3, started, stale)).toBe(true);
    expect(calls).toContainEqual(['upsert', expect.objectContaining({ state: 'pending' }), { onConflict: 'brief_id', ignoreDuplicates: true }]);
    expect(calls.some(([m]) => m === 'update')).toBe(false);
  });

  it('takes over an existing review only if no live generation holds it, keeping the previous result', async () => {
    const { db, calls } = fakeDb([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    expect(await reviewsRepo(db).claim('w', 'b', 3, started, stale)).toBe(false);
    expect(calls).toContainEqual(['or', `state.neq.pending,started_at.lt.${stale.toISOString()}`]);
    expect(calls).toContainEqual(['update', { state: 'pending', started_at: started.toISOString(), error_code: null }]);
  });
});
