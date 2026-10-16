# Marketing consent ↔ Resend sync

Supabase is the source of truth for **who agreed to marketing email**. Resend Contacts is a
downstream copy used only for sending marketing campaigns. Transactional mail (sign-up
confirmation, password reset, security, billing, service notices) never reads any of this.

```
signup form ──► auth.users ──trigger──► marketing_consent ──trigger──► marketing_outbox
Settings ─────► set_marketing_consent()─┘                                  │ pg_net poke + pg_cron
                                                                           ▼
                              Resend Contacts ◄── resend-sync (Edge Function, service role)
                                    │ contact.updated / email.bounced / email.complained
                                    ▼
                         resend-webhook (Svix-verified) ──► email_suppressions + consent → unsubscribed
```

## Rules the system enforces

| Rule | Where |
|---|---|
| Only `subscribed` + **verified email** + no newer opt-out is ever sent to Resend | `processReconcile` in `_shared/core.ts` |
| `unknown` (all legacy users) is never sent, never queued, never changed by backfill | migration, `marketing_enqueue_unsynced` |
| Nothing from Resend can *subscribe* anyone; webhooks only move toward unsubscribed | `handleResendWebhook` |
| Only an **explicit opt-in that is still the latest decision** may lift an existing Resend opt-out | `explicitOptIn` (`payload.optin_at == consent_at`) |
| Stale events can't reverse newer decisions: provider events apply only if newer than `consent_at`; suppression rows only move forward in `event_at` | `apply_provider_suppression` |
| No feedback loop: consent changes sourced from Resend (`resend_*`) are not queued back; our own echoes (`contact.updated` unsubscribed=false) are ignored | `marketing_consent_enqueue`, webhook handler |
| Users can read only their own row; every write is `set_marketing_consent()` on `auth.uid()` or service role | RLS + revoked grants |
| Signup/auth/transactional mail never wait on Resend: triggers only write local rows, are exception-guarded, and the network call is async (`pg_net`) | triggers |
| Dedupe by `lower(btrim(email))`; one pending event per user (newer merges into it); contact upsert = GET → create / update | `normalize_email`, unique partial index |
| Retries: exponential backoff (30 s × 2ⁿ, capped 6 h, honours `Retry-After`), 8 attempts → `dead`; 401/403 stops the drain and parks the batch as `failed`; replay re-queues `failed`+`dead` | `marketing_complete_outbox`, `drain` |
| Logs are JSON lines, emails masked (`k***@d***.com`), key/token/JWT patterns scrubbed; the Resend key lives only in an Edge Function secret | `makeLogger`, `scrub` |

**Consent states.** `subscribed` (ticked the box / opted in in Settings; has timestamp, disclosure
version, source), `unsubscribed` (opted out, or Resend reported an unsubscribe / hard bounce /
complaint), `unknown` (everyone else — including every historical account, and new accounts that
left the box unticked; unticked is *no proof of consent*, not an opt-out).

**Disclosure versions.** Current: `2026-10-v1` =
"Yes! Send me affirmations, wellness tips, product updates, and exclusive Subliminally offers. I can
unsubscribe anytime." (Settings uses the same version for its shorter label.) If you change the
wording, bump `MARKETING_CONSENT_VERSION` in `js/account.js` and record the new text here.

**Confirmed opt-in.** A signup tick is stored immediately but nothing reaches Resend until the
address is verified (`email_confirmed_at`), so nobody can subscribe someone else's address.
**Keep "Confirm email" enabled** in Supabase Auth settings — if it is turned off, addresses are
unverified at signup and this protection is gone.

**Social signup.** The tick (only shown on the sign-up form) is held in `localStorage` for ≤ 1 h,
then recorded via `set_marketing_consent(…, 'signup_google', version)` after the first session.
The RPC refuses `signup_*` sources for accounts older than a day. Signing in with Google from the
*log-in* form can create an account with consent `unknown` (there is no checkbox there); those
users can opt in under Settings. (Apple sign-in isn't in the app today; `signup_apple` is
pre-allowed for when it is.)

**Complaints / bounces and re-opt-in.** A complaint or hard bounce sets the account to
`unsubscribed` and records a suppression. A person can still explicitly re-opt-in in Settings
(that is a new, later, explicit decision); Resend's own suppression list continues to block hard
bounces and complaints at send time regardless.

**Email change.** Consent stays with the account (the owner just verified the new address): the old
contact is removed (or kept *unsubscribed* if a suppression is on file for it) and the new one
created. **Account deletion** removes the contact the same way; a recorded opt-out/bounce/complaint
outlives the account so the address isn't mailed if it signs up again.

## Deploying (in this order — nothing is deployed by this change)

1. **Back up** (Dashboard → Database → Backups) and confirm the tests pass: `npm run test:marketing-sync`.
2. **Resend dashboard**
   - Create (or pick) the **Segment** used for marketing broadcasts; copy its id. *(Resend replaced
     "Audiences" with "Segments"; contacts are global and belong to segments.)*
   - Use a **full-access** API key for the contact calls (sending-only keys can't manage contacts).
     Ideally create a separate key from the one your auth emails use, so it can be rotated alone.
   - Webhooks → Add endpoint (after step 4 gives you the URL). Events: `contact.updated`,
     `contact.created`, `email.bounced`, `email.complained`. Copy the **signing secret** (`whsec_…`).
3. **Migration**: run `supabase/migrations/20261017_marketing_consent_sync.sql` (SQL Editor or
   `supabase db push`). It creates the tables/RPCs/triggers and gives every existing account an
   `unknown` row. It sends nothing.
4. **Edge Function secrets and deploy** (`supabase` CLI, project `eiqylxcgexndzopesvhd`):
   ```bash
   supabase secrets set RESEND_API_KEY=<key> RESEND_SEGMENT_ID=<segment id> \
     RESEND_WEBHOOK_SECRET=<whsec_…> MARKETING_SYNC_SECRET=$(openssl rand -hex 32)
   supabase functions deploy resend-sync    --no-verify-jwt
   supabase functions deploy resend-webhook --no-verify-jwt
   ```
   `--no-verify-jwt` is required: neither Resend nor pg_net sends a Supabase JWT. They are protected
   by the Svix signature and the `x-sync-secret` header respectively; both refuse anything else.
5. **Webhook URL** to paste into Resend:
   `https://eiqylxcgexndzopesvhd.supabase.co/functions/v1/resend-webhook`
6. **Wire the database to the function**: fill in and run `supabase/setup/marketing_sync_setup.sql`
   (Vault secrets for the function URL + the same `MARKETING_SYNC_SECRET`; the 5-minute `pg_cron`
   drain and nightly reconcile; enable `pg_cron` first — it is not on the project yet). This is the
   "database webhook": an outbox insert pokes `resend-sync` asynchronously. (The Dashboard's
   Database Webhooks UI on `marketing_outbox` INSERT also works if you prefer it; keep the shared
   secret header.)
7. **Make yourself admin**: `insert into public.app_admins (user_id) select id from auth.users where email = '<you>';`
   Settings then shows *Email sync health*.
8. **Import existing Resend opt-outs** (read-only against Resend, safe to repeat). Dry run first:
   ```bash
   curl -sS -X POST https://eiqylxcgexndzopesvhd.supabase.co/functions/v1/resend-sync \
     -H "x-sync-secret: $MARKETING_SYNC_SECRET" -H 'content-type: application/json' \
     -d '{"action":"backfill_optouts","dry_run":true}'
   # then, if the counts look right:  -d '{"action":"backfill_optouts","dry_run":false}'
   ```
   Legacy accounts stay `unknown`; only people already unsubscribed in Resend become
   `unsubscribed`. **No one is subscribed and no campaign is sent by any of this.** Sending a
   campaign remains a manual decision in Resend, to the marketing segment only.
9. Deploy the site (Vercel) so the checkbox and Settings card go live — migration first, so the
   RPCs exist when the UI calls them (the UI degrades quietly if they don't).

### Operations

- **Health**: Settings → *Email sync health* (admins), or `select public.marketing_sync_health();`
  as an admin. Counts only — there is no function or view that returns the address list.
- **Replay failed events**: the *Replay failed events* button, or
  `curl … -d '{"action":"replay"}'`. Fixing a bad API key? Update the secret, then replay.
- **Re-sync drift after an outage**: `-d '{"action":"enqueue_unsynced"}'` (never touches `unknown`).
- **Logs**: Dashboard → Edge Functions → logs; events `sync.event_done`, `sync.event_failed`,
  `sync.honoured_resend_optout`, `webhook.processed`, `webhook.bad_signature`, …

## Rollback

1. Stop the inputs: `select cron.unschedule('marketing-sync-drain'); select cron.unschedule('marketing-sync-reconcile');`
   delete the webhook in Resend; `delete from vault.secrets where name like 'marketing_sync_%';`
2. Optional: undeploy the functions (`supabase functions delete resend-sync resend-webhook`).
3. **Export proof of consent first** (it is dropped in step 4):
   `copy (select * from public.marketing_consent) to stdout with csv header;` and the same for
   `public.email_suppressions`.
4. Run `supabase/rollback/20261017_marketing_consent_sync_down.sql`. It removes only what this
   change added; `profiles`, `auth.users` and the existing `handle_new_user` trigger are untouched,
   so signup keeps working throughout (tested).
5. Revert the site commit (checkbox/Settings card). Resend contacts are not modified by a rollback.

## Things to verify in the dashboards (I could not reach resend.com from the build sandbox)

The Resend calls follow the current Contacts API as I know it: `GET/POST /contacts`,
`GET/PATCH/DELETE /contacts/{email}`, `POST /contacts/{email}/segments/{segment_id}`,
`GET /contacts?limit&after`, and Svix-style webhook headers. Before the first real run, check in
the Resend docs/dashboard that (a) those paths and the `segments: [{id}]` body field match, (b) the
webhook payload carries `created_at` at the top level and `data.unsubscribed` / `data.to` /
`data.bounce.type` as the code expects, and (c) the Dashboard "Send test event" for
`contact.updated` returns 200 from the function. The fake Resend in the tests encodes the same
assumptions, so a mismatch will show up as a failed event in the health report rather than as a
wrong send. Try it with your own address first.

## Files

See the summary in the pull request / commit message; the test suite is `npm run test:marketing-sync`.
