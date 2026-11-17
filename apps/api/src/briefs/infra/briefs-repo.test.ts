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
  source_name: null,
  source_mime: null,
  source_size: null,
  submitted_by: null,
  submitted_at: null,
  decided_at: null,
  decision_comment: null,
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

  it('maps an uploaded brief\'s source file', async () => {
    const { db } = fakeDb([{ data: { ...row, source_name: 'brief.pdf', source_mime: 'application/pdf', source_size: 1234 }, error: null }]);

    expect((await briefsRepo(db).get(wsA, id))?.source).toEqual({ name: 'brief.pdf', mime: 'application/pdf', size: 1234 });
  });

  it('creates an uploaded brief under the id its original was stored at', async () => {
    const { db, calls } = fakeDb([{ data: row, error: null }]);

    await briefsRepo(db).create(wsA, { title: 't', body: 'b' }, { id, source: { name: 'brief.pdf', mime: 'application/pdf', size: 1234 } });

    expect(calls).toContainEqual([
      'insert',
      { workspace_id: wsA, title: 't', body: 'b', id, source_name: 'brief.pdf', source_mime: 'application/pdf', source_size: 1234 },
    ]);
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

  it('submits by sending only the status, at the version that was reviewed', async () => {
    const { db, calls } = fakeDb([{ data: [{ ...row, status: 'in_review' }], error: null }]);

    expect(await briefsRepo(db).submit(wsA, id, 2)).toMatchObject({ kind: 'ok', brief: { status: 'in_review' } });
    expect(calls).toContainEqual(['update', { status: 'in_review' }]);
    expect(calls).toContainEqual(['eq', 'version', 2]);
  });

  it('decides only on a brief that is in review', async () => {
    const { db, calls } = fakeDb([{ data: [{ ...row, status: 'changes_requested', decision_comment: 'Add dates' }], error: null }]);

    const result = await briefsRepo(db).decide(wsA, id, { decision: 'request_changes', comment: 'Add dates' });

    expect(result).toMatchObject({ kind: 'ok', brief: { status: 'changes_requested', decisionComment: 'Add dates' } });
    expect(calls).toContainEqual(['update', { status: 'changes_requested', decision_comment: 'Add dates' }]);
    expect(calls).toContainEqual(['eq', 'status', 'in_review']);
  });

  it('passes a workflow refusal from the trigger on with its own code', async () => {
    const { db } = fakeDb([{ data: null, error: { code: 'BRF03' } }]);

    await expect(briefsRepo(db).submit(wsA, id, 2)).rejects.toMatchObject({ statusCode: 409, message: 'no_current_review' });
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
