import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** True when the public Supabase URL + anon/publishable key were provided at build time. */
export const supabaseConfigured = Boolean(url && anonKey && !anonKey.startsWith('your-'));

/**
 * Browser client. Only the public anon/publishable key is ever shipped; all
 * authorisation is enforced by Postgres RLS and SECURITY DEFINER functions.
 * Sessions persist in localStorage (supabase-js default) so participants
 * stay signed in to their events on this device.
 */
export const supabase: SupabaseClient = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key-missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'roundhouse-auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const supabaseUrl = url ?? '';
export const supabaseAnonKey = anonKey ?? '';
