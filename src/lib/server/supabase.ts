import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const rawSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(rawSupabaseUrl && rawSupabaseKey);

if (!isSupabaseConfigured) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[Supabase] CRITICAL: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in production. Supabase database queries and RPC calls will fail.'
    );
  } else {
    console.warn(
      '[Supabase] Notice: Running with fallback credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for live database operations.'
    );
  }
}

const supabaseUrl = rawSupabaseUrl || 'https://dummy.supabase.co';
const supabaseServiceKey = rawSupabaseKey || 'dummy';

export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function ensureUserProfile(
  uid: string,
  data?: { email?: string | null; displayName?: string | null; avatarUrl?: string | null }
) {
  if (!uid || !isSupabaseConfigured) return;
  try {
    const payload: Record<string, any> = {
      uid,
      updated_at: new Date().toISOString()
    };
    if (data?.email) payload.email = data.email;
    if (data?.displayName) payload.display_name = data.displayName;
    if (data?.avatarUrl) payload.avatar_url = data.avatarUrl;

    const { error } = await adminSupabase
      .from('profiles')
      .upsert(payload, { onConflict: 'uid' });

    if (error) {
      console.warn('[Supabase] Failed to ensure profile for', uid, error.message);
    }
  } catch (err) {
    console.warn('[Supabase] Exception in ensureUserProfile:', err);
  }
}

