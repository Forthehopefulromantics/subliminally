-- Rolls back 20261017_marketing_consent_sync.sql.
--
-- WARNING: this drops the consent records and the suppression list. Export them first if you
-- want to keep proof of consent (see docs/marketing-sync.md, "Rollback"):
--   copy (select * from public.marketing_consent)  to stdout with csv header;
--   copy (select * from public.email_suppressions) to stdout with csv header;
-- Rolling back does not touch Resend contacts, and does not touch profiles or auth.users.
-- Disable the pg_cron job and the Resend webhook first (docs/marketing-sync.md).

drop trigger if exists on_auth_user_created_marketing on auth.users;
drop trigger if exists on_auth_user_email_changed_marketing on auth.users;

drop function if exists public.marketing_handle_new_user();
drop function if exists public.marketing_handle_email_change();

drop table if exists public.marketing_outbox;
drop table if exists public.resend_webhook_events;
drop table if exists public.email_suppressions;
drop table if exists public.marketing_consent;   -- takes its own triggers with it
drop table if exists public.app_admins;

drop function if exists public.marketing_consent_enqueue();
drop function if exists public.marketing_consent_deleted();
drop function if exists public.marketing_touch();
drop function if exists public.marketing_kick();
drop function if exists public.marketing_enqueue(uuid, text, text, jsonb);
drop function if exists public.set_marketing_consent(boolean, text, text);
drop function if exists public.get_my_marketing_preference();
drop function if exists public.is_app_admin();
drop function if exists public.marketing_sync_health();
drop function if exists public.marketing_replay_failed(integer);
drop function if exists public.marketing_requeue_failed(integer);
drop function if exists public.marketing_claim_outbox(integer, integer);
drop function if exists public.marketing_complete_outbox(bigint, boolean, text, boolean, integer);
drop function if exists public.marketing_sync_context(uuid);
drop function if exists public.marketing_mark_synced(uuid, text, text, text);
drop function if exists public.marketing_email_has_account(text);
drop function if exists public.marketing_get_suppression(text);
drop function if exists public.apply_provider_suppression(text, text, timestamptz, text);
drop function if exists public.marketing_record_webhook(text, text);
drop function if exists public.marketing_finish_webhook(text, text);
drop function if exists public.marketing_enqueue_unsynced(integer);
drop function if exists public.marketing_backfill_legacy_consent();
drop function if exists public.normalize_email(text);
