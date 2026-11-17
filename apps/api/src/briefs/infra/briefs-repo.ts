import { Brief, BriefSummary, type BriefCreate, type BriefSource, type BriefUpdate } from '@briefly/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DbError } from '../../platform/db-error';

export type UpdateResult =
  | { kind: 'ok'; brief: Brief }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'forbidden' };

export type BriefsRepo = {
  list(wsId: string): Promise<BriefSummary[]>;
  get(wsId: string, id: string): Promise<Brief | null>;
  // `upload` is set for a brief extracted from a file: the id its original was stored under, and the file's details.
  create(wsId: string, input: BriefCreate, upload?: { id: string; source: BriefSource }): Promise<Brief>;
  update(wsId: string, id: string, input: BriefUpdate): Promise<UpdateResult>;
  remove(wsId: string, id: string): Promise<boolean>;
};

const SUMMARY_COLUMNS = 'id, workspace_id, title, status, version, updated_at';
const COLUMNS = `${SUMMARY_COLUMNS}, body, created_at, source_name, source_mime, source_size`;

const SummaryRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  status: z.string(),
  version: z.number(),
  updated_at: z.string(),
});
const Row = SummaryRow.extend({
  body: z.string(),
  created_at: z.string(),
  source_name: z.string().nullable(),
  source_mime: z.string().nullable(),
  source_size: z.number().nullable(),
});

// PostgREST returns Postgres timestamps without the "T"/offset shape the contract pins; normalise to ISO.
const iso = (ts: string) => new Date(ts).toISOString();

const toSummary = (r: z.infer<typeof SummaryRow>): BriefSummary =>
  BriefSummary.parse({ id: r.id, workspaceId: r.workspace_id, title: r.title, status: r.status, version: r.version, updatedAt: iso(r.updated_at) });

const toBrief = (r: z.infer<typeof Row>): Brief =>
  Brief.parse({
    ...toSummary(r),
    body: r.body,
    createdAt: iso(r.created_at),
    source: r.source_name === null ? null : { name: r.source_name, mime: r.source_mime, size: r.source_size },
  });

// Every call runs as the caller and is scoped to the workspace in the URL as well as by RLS: someone in two
// workspaces must not see workspace B's brief under workspace A's address. Writes name their columns
// explicitly (never the request DTO, never upsert) because only title/body are grantable.
export function briefsRepo(db: SupabaseClient): BriefsRepo {
  const readVersion = async (wsId: string, id: string) => {
    const { data, error } = await db.from('briefs').select('version').eq('workspace_id', wsId).eq('id', id).maybeSingle();
    if (error) throw new DbError('briefs.read_version', error.code);
    return data === null ? null : z.object({ version: z.number() }).parse(data).version;
  };

  return {
    async list(wsId) {
      const { data, error } = await db
        .from('briefs')
        .select(SUMMARY_COLUMNS)
        .eq('workspace_id', wsId)
        .order('updated_at', { ascending: false });
      if (error) throw new DbError('briefs.list', error.code);
      return z.array(SummaryRow).parse(data).map(toSummary);
    },

    async get(wsId, id) {
      const { data, error } = await db.from('briefs').select(COLUMNS).eq('workspace_id', wsId).eq('id', id).maybeSingle();
      if (error) throw new DbError('briefs.get', error.code);
      return data === null ? null : toBrief(Row.parse(data));
    },

    async create(wsId, input, upload) {
      const source = upload
        ? { id: upload.id, source_name: upload.source.name, source_mime: upload.source.mime, source_size: upload.source.size }
        : {};
      const { data, error } = await db
        .from('briefs')
        .insert({ workspace_id: wsId, title: input.title, body: input.body, ...source })
        .select(COLUMNS)
        .single();
      if (error) throw new DbError('briefs.create', error.code);
      return toBrief(Row.parse(data));
    },

    // No .single(): zero rows is an answer here, not an error. Telling the three zero-row cases apart takes
    // one re-read; concurrent writers are safe because Postgres re-checks `version` on the row it locks.
    async update(wsId, id, input) {
      const { data, error } = await db
        .from('briefs')
        .update({ title: input.title, body: input.body })
        .eq('workspace_id', wsId)
        .eq('id', id)
        .eq('version', input.version)
        .select(COLUMNS);
      if (error) throw new DbError('briefs.update', error.code);
      const rows = z.array(Row).parse(data);
      if (rows[0]) return { kind: 'ok', brief: toBrief(rows[0]) };

      const current = await readVersion(wsId, id);
      if (current === null) return { kind: 'not_found' };
      if (current !== input.version) return { kind: 'conflict' };
      return { kind: 'forbidden' };
    },

    async remove(wsId, id) {
      const { data, error } = await db.from('briefs').delete().eq('workspace_id', wsId).eq('id', id).select('id');
      if (error) throw new DbError('briefs.remove', error.code);
      return z.array(z.object({ id: z.string() })).parse(data).length > 0;
    },
  };
}
