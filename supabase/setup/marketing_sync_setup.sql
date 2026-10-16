-- One-time setup for the Resend sync. NOT a migration: it holds placeholders for secrets.
-- Run it in Supabase -> SQL Editor after replacing the <...> values, once the Edge Functions
-- are deployed. Never commit it with real values filled in.

-- 1. Tell the database where the sync function lives and how to authenticate to it.
--    (Stored encrypted in Supabase Vault; marketing_kick() reads them at runtime.)
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/resend-sync', 'marketing_sync_url');
select vault.create_secret('<SAME VALUE AS THE MARKETING_SYNC_SECRET EDGE FUNCTION SECRET>', 'marketing_sync_secret');
-- To rotate later: select vault.update_secret((select id from vault.secrets where name = 'marketing_sync_secret'), '<new>');

-- 2. Scheduled drain: retries failed events with backoff and heals anything a poke missed.
--    Needs the pg_cron extension (Dashboard -> Integrations -> Cron, or: create extension pg_cron;).
select cron.schedule(
  'marketing-sync-drain',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'marketing_sync_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'marketing_sync_secret')),
    body    := '{"action":"drain"}'::jsonb,
    timeout_milliseconds := 10000);
  $$);

-- Nightly safety net: queue anyone whose Resend state drifted (never touches `unknown` accounts).
select cron.schedule('marketing-sync-reconcile', '17 3 * * *',
  $$ select public.marketing_enqueue_unsynced(500); $$);

-- 3. Make yourself an admin so Settings shows the sync health card.
--    insert into public.app_admins (user_id) select id from auth.users where email = '<your email>';
