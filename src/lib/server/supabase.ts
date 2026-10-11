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

