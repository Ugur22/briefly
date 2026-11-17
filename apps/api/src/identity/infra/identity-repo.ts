import { Me, Workspace } from '@briefly/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DbError } from '../../platform/db-error';

export type IdentityRepo = {
  provisionMe(): Promise<Me>;
  listWorkspaces(): Promise<Workspace[]>;
  findWorkspace(id: string): Promise<Workspace | null>;
};

const UserRow = z.object({ id: z.uuid(), email: z.string() });

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
