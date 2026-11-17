import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DbError } from '../../platform/db-error';
import type { ReviewsRepo } from '../application/generate-review';
import type { StoredReview } from '../domain/review';

const COLUMNS = 'brief_id, workspace_id, brief_version, state, result, error_code, model, started_at, completed_at, edited_at';

const Row = z.object({
  brief_id: z.string(),
  workspace_id: z.string(),
  brief_version: z.number(),
  state: z.enum(['pending', 'succeeded', 'failed']),
  result: z.unknown(),
  error_code: z.string().nullable(),
  model: z.string().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  edited_at: z.string().nullable(),
});

const toStored = (row: z.infer<typeof Row>): StoredReview => ({
  briefVersion: row.brief_version,
  state: row.state,
  result: row.result,
  errorCode: row.error_code,
  model: row.model,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  editedAt: row.edited_at,
});

// Runs as the caller (RLS: editors/admins of the workspace, only while the brief is editable). No upsert of
// whole rows: column grants make ON CONFLICT DO UPDATE on brief_id/workspace_id a permission error.
export function reviewsRepo(db: SupabaseClient): ReviewsRepo {
  const table = () => db.from('brief_reviews');

  return {
    async get(wsId, briefId) {
      const { data, error } = await table().select(COLUMNS).eq('workspace_id', wsId).eq('brief_id', briefId).maybeSingle();
      if (error) throw new DbError('reviews.get', error.code);
      return data === null ? null : toStored(Row.parse(data));
    },

    async claim(wsId, briefId, briefVersion, startedAt, staleBefore) {
      const started = startedAt.toISOString();
      // First review of this brief: inserting the row is the claim.
      const inserted = await table()
        .upsert({ brief_id: briefId, workspace_id: wsId, brief_version: briefVersion, state: 'pending', started_at: started }, { onConflict: 'brief_id', ignoreDuplicates: true })
        .select('brief_id');
      if (inserted.error) throw new DbError('reviews.claim_insert', inserted.error.code);
      if ((inserted.data ?? []).length > 0) return true;

      // Otherwise take it over unless a live generation holds it. Postgres re-checks this WHERE on the locked
      // row, so of two simultaneous clicks exactly one gets a row back.
      const { data, error } = await table()
        // The previous review (result, version, edits) stays until a new one succeeds.
        .update({ state: 'pending', started_at: started, error_code: null })
        .eq('workspace_id', wsId)
        .eq('brief_id', briefId)
        .or(`state.neq.pending,started_at.lt.${staleBefore.toISOString()}`)
        .select('brief_id');
      if (error) throw new DbError('reviews.claim', error.code);
      return data.length > 0;
    },

    async complete(wsId, briefId, startedAt, outcome) {
      const values =
        outcome.state === 'succeeded'
          ? { state: 'succeeded', result: outcome.review, brief_version: outcome.briefVersion, error_code: null, model: outcome.model, edited_at: null }
          : { state: 'failed', error_code: outcome.error };
      const { data, error } = await table()
        .update({ ...values, completed_at: new Date().toISOString() })
        .eq('workspace_id', wsId)
        .eq('brief_id', briefId)
        .eq('state', 'pending')
        .eq('started_at', startedAt.toISOString())
        .select('brief_id');
      if (error) throw new DbError('reviews.complete', error.code);
      return data.length > 0;
    },

    async saveEdit(wsId, briefId, briefVersion, review) {
      const { data, error } = await table()
        .update({ result: review, edited_at: new Date().toISOString() })
        .eq('workspace_id', wsId)
        .eq('brief_id', briefId)
        .eq('state', 'succeeded')
        .eq('brief_version', briefVersion)
        .select('brief_id');
      if (error) throw new DbError('reviews.save_edit', error.code);
      return data.length > 0;
    },
  };
}
