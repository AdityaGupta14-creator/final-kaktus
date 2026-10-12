import { createClient } from '@supabase/supabase-js';

function isValidHttpUrl(val?: string): boolean {
  if (!val || val.includes('[SENSITIVE]')) return false;
  try {
    const url = new URL(val);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const rawSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(
  isValidHttpUrl(rawSupabaseUrl) && 
  rawSupabaseKey && 
  !rawSupabaseKey.includes('[SENSITIVE]')
);

if (!isSupabaseConfigured) {
  if (process.env.NODE_ENV === 'production' && !rawSupabaseUrl?.includes('[SENSITIVE]')) {
    console.error(
      '[Supabase] CRITICAL: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in production. Supabase database queries and RPC calls will fail.'
    );
  } else {
    console.warn(
      '[Supabase] Notice: Running with fallback credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for live database operations.'
    );
  }
}

const supabaseUrl = isValidHttpUrl(rawSupabaseUrl) ? rawSupabaseUrl! : 'https://dummy.supabase.co';
const supabaseServiceKey = (rawSupabaseKey && !rawSupabaseKey.includes('[SENSITIVE]')) ? rawSupabaseKey : 'dummy-key';

export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

