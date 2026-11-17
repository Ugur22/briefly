import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type UserClientFactory = (accessToken: string) => SupabaseClient;

// One client per request, carrying the caller's own Okta token: Postgres sees their claims and RLS decides.
// The publishable key only identifies the project; it grants nothing on its own.
export function userClientFactory(url: string, publishableKey: string): UserClientFactory {
  return (accessToken) =>
    createClient(url, publishableKey, {
      accessToken: async () => accessToken,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
}
