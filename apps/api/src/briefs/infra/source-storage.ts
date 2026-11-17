import type { BriefSourceMime } from '@briefly/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DbError } from '../../platform/db-error';

export type SourceStorage = {
  put(path: string, bytes: Uint8Array, mime: BriefSourceMime): Promise<'ok' | 'forbidden'>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<boolean>;
};

// supabase-js reports Storage refusals as HTTP 400 with the real code in `statusCode` ('403' RLS, '404' missing
// or hidden by RLS). Those are answers, not failures; anything else is.
const codeOf = (error: unknown) => String((error as { statusCode?: unknown }).statusCode ?? '');

// Runs as the caller with their own token, so Storage RLS decides, exactly as for the database.
export function sourceStorage(db: SupabaseClient): SourceStorage {
  const bucket = () => db.storage.from('briefs');

  return {
    async put(path, bytes, mime) {
      const { error } = await bucket().upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) return 'ok';
      if (codeOf(error) === '403') return 'forbidden';
      throw new DbError('storage.put', codeOf(error));
    },

    async get(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (codeOf(error) === '404') return null;
        throw new DbError('storage.get', codeOf(error));
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    // remove() succeeds with an empty list when RLS hides the object, so report whether anything went.
    async remove(path) {
      const { data, error } = await bucket().remove([path]);
      if (error) throw new DbError('storage.remove', codeOf(error));
      return data.length > 0;
    },
  };
}
