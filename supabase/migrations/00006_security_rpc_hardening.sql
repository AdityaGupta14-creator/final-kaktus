-- The quota functions run with their owner's privileges. Keep them callable only
-- from the server's Supabase service-role client, never from public browser roles.
ALTER FUNCTION public.consume_subscription_quota(TEXT, INTEGER) SET search_path = pg_catalog, public;
ALTER FUNCTION public.restore_subscription_quota(TEXT, INTEGER) SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.consume_subscription_quota(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_subscription_quota(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_subscription_quota(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_subscription_quota(TEXT, INTEGER) TO service_role;
