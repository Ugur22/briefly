import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { DbError, identityRepo } from './identity-repo';

type Result = { data: unknown; error: { code?: string } | null };

// Just enough of supabase-js's query builder: awaitable, with the modifiers the repo uses.
function fakeDb(result: Result) {
  const builder = {
    eq: vi.fn(() => builder),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  const rpc = vi.fn(() => builder);
  return { db: { rpc } as unknown as SupabaseClient, rpc, builder };
}

const acme = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', role: 'admin' };

describe('identityRepo', () => {
  it('maps provision_me to Me, dropping internal columns', async () => {
    const { db, rpc } = fakeDb({
      data: { id: '11111111-1111-4111-8111-111111111111', email: 'a@test.dev', issuer: 'x', subject: 'uid' },
      error: null,
    });

    await expect(identityRepo(db).provisionMe()).resolves.toEqual({ id: '11111111-1111-4111-8111-111111111111', email: 'a@test.dev' });
    expect(rpc).toHaveBeenCalledWith('provision_me');
  });

  it('lists workspaces through my_workspaces', async () => {
    const { db } = fakeDb({ data: [acme], error: null });

    await expect(identityRepo(db).listWorkspaces()).resolves.toEqual([acme]);
  });

  it('filters my_workspaces by id and returns null when RLS hides it', async () => {
    const { db, builder } = fakeDb({ data: null, error: null });

    await expect(identityRepo(db).findWorkspace(acme.id)).resolves.toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('id', acme.id);
  });

  it('turns a database refusal into a 403 that names nothing internal', async () => {
    const { db } = fakeDb({ data: null, error: { code: '42501' } });

    const err = await identityRepo(db).provisionMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(err).toMatchObject({ statusCode: 403, message: 'forbidden', op: 'provision_me', code: '42501' });
  });

  it('turns other database errors into a generic 500', async () => {
    const { db } = fakeDb({ data: null, error: { code: '57014' } });

    await expect(identityRepo(db).listWorkspaces()).rejects.toMatchObject({ statusCode: 500, message: 'database request failed' });
  });

  it('rejects rows that break the contract instead of passing them on', async () => {
    const { db } = fakeDb({ data: [{ ...acme, role: 'owner' }], error: null });

    await expect(identityRepo(db).listWorkspaces()).rejects.toThrow();
  });
});
