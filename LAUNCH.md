# Before launch

Things that are built but not switched on, and things only Kyla can do.
Check this list before submitting to the App Store or announcing.

## Not switched on yet

### ElevenLabs — studio voices and voice cloning

**Deliberately deferred until launch.** `api/tts.js` and `api/voice-clone.js` are
complete; with no key set the route replies 503 and the app falls back to the
device voice, which is what happens today.

To switch on:

1. elevenlabs.io → avatar → **API Keys** → create one.
2. Vercel → `subliminally` → **Settings → Environment Variables**.
3. Add `ELEVENLABS_API_KEY`, all three environments.
4. **Deployments → ⋯ → Redeploy.** Environment variables only reach new builds.

Two things that will bite:

- **A paid plan is required.** The free tier forbids commercial API use and
  gives about one subliminal's worth of characters a month. Creator (~$22/mo)
  is the realistic floor, and voice cloning needs Creator or above.
- **Studio voices are gated to Whisper and up** in `api/tts.js`. A free account
  gets "Studio voices come with Whisper" even once the key is set. Kyla's own
  account needs a tier, or the gate needs a test bypass.

### RevenueCat webhook

`REVENUECAT_WEBHOOK_AUTH` = `dhEdleK-okLF-HlqrfZLVGrU4O5S2szsBRYsxo7xFlo` in
Vercel, and point the RevenueCat webhook at `/api/revenuecat-webhook`.

## Apple review

- **Guideline 4.8.** The app offers Google sign-in, so it must also offer Sign
  in with Apple, or drop Google. This is a submission blocker and the decision
  hasn't been made.
- Old $10 / $22 / $35 Stripe products should be archived so nobody lands on a
  dead price.

## Supabase

Two redirect URLs must be registered:

- `https://www.subliminallybyfthr.com/reset-password.html`
- `com.fthr.subliminally://login-callback`

And the Google OAuth consent screen needs its **App name** set, or the sign-in
sheet shows the Supabase project id instead of "Subliminally by FTHR".

## Migrations

Run in order in the Supabase SQL editor. All are safe to re-run.

| File | Status |
| --- | --- |
| `20260912_habits_and_journal_photos.sql` | run |
| `20260914_journal_photos_one_per_day.sql` | run |
| `20260915_voice_journal_entries.sql` | run |
| `20260916_cloned_voice.sql` | run |
| `20260917_core_habits.sql` | run |
| `20260918_habit_order.sql` | run |
| `20260919_higher_self.sql` | run |
| `20260920_usernames_and_avatar.sql` | run |
| `20260921_light.sql` | run |
