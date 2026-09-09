import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client — only ever used server-side (never bundled into
 * the frontend). Bypasses RLS entirely, so every call site here is responsible
 * for its own authorization (e.g. scoping writes to the right id_empresa).
 * Used for: Supabase Auth Admin API (creating real accounts, Fase 4) and any
 * gateway write that must succeed regardless of the RLS policies enabled on
 * the caller's own session.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados no gateway.');
  }

  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
