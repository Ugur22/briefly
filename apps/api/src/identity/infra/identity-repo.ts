import { Me, Workspace } from '@briefly/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export type IdentityRepo = {
  provisionMe(): Promise<Me>;
  listWorkspaces(): Promise<Workspace[]>;
  findWorkspace(id: string): Promise<Workspace | null>;
};

const UserRow = z.object({ id: z.uuid(), email: z.string() });

// Postgres/PostgREST codes for "this token isn't accepted here". Node already verified the token, so reaching
// one means Node and the database disagree about trust (e.g. a changed client id): refuse, don't 500.
const REFUSED = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303']);

// The message goes to the client, so it names nothing internal; op and code are kept for the error log.
export class DbError extends Error {
  readonly statusCode: number;
  constructor(
    readonly op: string,
    readonly code: string | undefined,
  ) {
    const refused = code !== undefined && REFUSED.has(code);
    super(refused ? 'forbidden' : 'database request failed');
    this.statusCode = refused ? 403 : 500;
  }
}

// Every call runs as the caller (their token, RLS on); nothing here can see another tenant's rows.
export function identityRepo(db: SupabaseClient): IdentityRepo {
  return {
    async provisionMe() {
      const { data, error } = await db.rpc('provision_me').single();
      if (error) throw new DbError('provision_me', error.code);
      const row = UserRow.parse(data);
      return { id: row.id, email: row.email };
    },

    async listWorkspaces() {
      const { data, error } = await db.rpc('my_workspaces');
      if (error) throw new DbError('my_workspaces', error.code);
      return z.array(Workspace).parse(data);
    },

    async findWorkspace(id) {
      const { data, error } = await db.rpc('my_workspaces').eq('id', id).maybeSingle();
      if (error) throw new DbError('my_workspaces', error.code);
      return data === null ? null : Workspace.parse(data);
    },
  };
}
