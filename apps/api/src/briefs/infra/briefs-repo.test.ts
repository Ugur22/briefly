import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { briefsRepo } from './briefs-repo';

type Result = { data: unknown; error: { code?: string } | null };

// A stand-in for supabase-js's query builder: records every call, and each awaited query takes the next result.
function fakeDb(results: Result[]) {
  const calls: [string, ...unknown[]][] = [];
  const next = async () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'order']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.single = vi.fn(next);
  builder.maybeSingle = vi.fn(next);
  builder.then = (resolve: (r: Result) => unknown) => next().then(resolve);
  return { db: builder as unknown as SupabaseClient, calls };
}

const wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'b1ef0000-0000-4000-8000-000000000001';
const row = {
  id,
  workspace_id: wsA,
  title: 'Spring launch',
  status: 'draft',
  version: 2,
  updated_at: '2026-11-18 09:00:00.123+00',
  body: 'text',
  created_at: '2026-11-18 08:00:00+00',
};

describe('briefsRepo', () => {
  it('scopes reads to the workspace in the URL, not just the id', async () => {
    const { db, calls } = fakeDb([{ data: row, error: null }]);

    const brief = await briefsRepo(db).get(wsA, id);

    expect(calls).toContainEqual(['eq', 'workspace_id', wsA]);
    expect(calls).toContainEqual(['eq', 'id', id]);
    expect(brief).toMatchObject({ id, workspaceId: wsA, version: 2, updatedAt: '2026-11-18T09:00:00.123Z' });
  });

  it('writes only title and body, never the request DTO', async () => {
    const { db, calls } = fakeDb([{ data: [row], error: null }]);

    await briefsRepo(db).update(wsA, id, { title: 't', body: 'b', version: 2 });

    expect(calls).toContainEqual(['update', { title: 't', body: 'b' }]);
    expect(calls).toContainEqual(['eq', 'version', 2]);
  });

  it('inserts into the workspace from the URL with only the grantable columns', async () => {
    const { db, calls } = fakeDb([{ data: row, error: null }]);

    await briefsRepo(db).create(wsA, { title: 't', body: 'b' });

    expect(calls).toContainEqual(['insert', { workspace_id: wsA, title: 't', body: 'b' }]);
  });

  it.each([
    ['not_found', null],
    ['conflict', { version: 3 }],
    ['forbidden', { version: 2 }],
  ] as const)('tells a zero-row update apart: %s', async (kind, current) => {
    const { db } = fakeDb([
      { data: [], error: null },
      { data: current, error: null },
    ]);

    await expect(briefsRepo(db).update(wsA, id, { title: 't', body: 'b', version: 2 })).resolves.toEqual({ kind });
  });

  it('reports whether a delete removed anything', async () => {
    const removed = fakeDb([{ data: [{ id }], error: null }]);
    const hidden = fakeDb([{ data: [], error: null }]);

    await expect(briefsRepo(removed.db).remove(wsA, id)).resolves.toBe(true);
    await expect(briefsRepo(hidden.db).remove(wsA, id)).resolves.toBe(false);
  });

  it('turns a refused write into a 403 that names nothing internal', async () => {
    const { db } = fakeDb([{ data: null, error: { code: '42501' } }]);

    await expect(briefsRepo(db).create(wsA, { title: 't', body: '' })).rejects.toMatchObject({ statusCode: 403, message: 'forbidden' });
  });
});
