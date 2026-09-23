# Before launch

Things that are built but not switched on, and things only Kyla can do.
Check this list before submitting to the App Store or announcing.

## Not switched on yet

### ElevenLabs — studio voices and voice cloning — switched on

**Switched on 2026-09-21.** `api/tts.js`, `api/voices.js` and
`api/voice-clone.js` were already complete; both things they were waiting on are
now done:

1. `supabase/migrations/20261003_elevenlabs_voices.sql` — **run 2026-09-21.** It
   created `user_voice_profiles`, `tts_clips`, `tts_generations` and the private
   `tts-cache` bucket, all row-level-secured to their owner with read-only
   policies. The backfill inserted no rows (no profile had a `cloned_voice_id`)
   and the voice-key rewrites touched nothing (`subliminals` was empty).
2. `ELEVENLABS_API_KEY` — **set in Vercel** (project `subliminally`, team
   `fthr1`), all three environments, and a redeploy done. Environment variables
   only reach new builds, so a redeploy is required after any change to it.

The key is read in one place, `lib/elevenlabs.js`, and attached as the
`xi-api-key` header by `callProvider()`; `api/delete-account.js` reads it too, to
delete a cloned voice when an account goes. It is never sent to the browser —
`isConfigured()` returns a boolean and nothing more. If it is ever unset the
routes reply 503 and the app falls back to the device voice, exactly as before.

### The V1 voice picker

Three cards, and only three:

| Card | Free | Premium | ElevenLabs? |
| --- | --- | --- | --- |
| Record your own voice | ✅ | ✅ | no — recorded in the browser |
| **Serenity** (`PrH4gjaYIM8R16R889Vf`) — *use* | 🔒 | ✅ | yes, per line |
| **Serenity** — *Play Preview* | ✅ | ✅ | **no** — one stored file |
| Clone your voice | 🔒 | ✅ | yes |

A free account **sees all three**, with a lock and a RITUAL badge on the two
that are paid, and tapping a locked one opens the existing upgrade sheet rather
than doing nothing or failing. The device voice is no longer a card; it stays as
the silent fallback whenever a generated voice cannot be used.

**The Serenity demo is free, and is not the same thing as Serenity.** Two
different routes, on purpose:

- `/api/voice-preview` — one short pre-generated file of Serenity saying the
  fixed line in `lib/voice-preview.js`. No sign-in, no parameters, no request
  body: there is nothing to submit to it. It is generated **once, ever** (the
  first request of the app's life), kept in the `tts-cache` bucket at
  `_preview/<clip key>.mp3`, and read back after that. The response is
  `public, max-age=31536000, immutable`, so in practice most presses are
  answered by the browser or the CDN and never reach the function.
- `/api/tts` — Serenity reading **your** affirmations, a request per line. This
  is the premium one and the gate is unchanged: a 403 before a character
  reaches the provider.

Somebody deciding whether to pay for a voice has to be able to hear it; hearing
it must not be a way to get it. That is the whole distinction, and
`npm run test:voice` holds both halves of it.

The six voices the picker used to offer — Sarah, Charlotte, Alice, Lily, Daniel
and George — are **retired, not deleted**. They are in `LEGACY_PRESET_VOICES` in
`lib/voices.js`: `/api/voices` no longer lists them and nothing can pick one, but
`/api/tts` still resolves them, so a subliminal saved with one plays in the voice
it was saved with and off the clips already cached. No stored row was rewritten.

Nothing else needs configuring at ElevenLabs: Serenity is a voice created in the
dashboard and named by key in `lib/voices.js`, and a cloned voice is created
through the API. Adding a voice later is one row in that file — the picker asks
the server what exists, so the page does not change.

What this costs, and what it does not:

- **A sequence is generated once.** Twenty minutes and eight hours are the same
  audio; the player loops it in the browser. Length never multiplies the bill.
- **Nothing is generated twice.** Every clip is kept in `tts-cache` against the
  person, the voice, the words and the pace, so rebuilding or replaying reads it
  back. `tts_generations` is the ledger, and the rate limits (40 a minute, 150 an
  hour, 600 a day, per person) are counted off it — cache hits are free and are
  not counted.
- **The demo is generated once, ever.** Not per press, per person or per page —
  one file for the life of the app, at `_preview/<clip key>.mp3`. The path is
  derived from the words, the voice, the pace and the model, so changing any of
  them is a new file generated once rather than a stale one to invalidate.
- **A voice is cloned once.** Building a subliminal never creates a clone;
  `user_voice_profiles` holds the one voice per person and it is reused. A clone
  is only ever created with the confirmation sentence in `lib/user-voices.js`,
  which the page shows and the route checks.
- `npm run test:voice` exercises all of the above against stubbed services.

Two things that will bite:

- **A paid plan is required.** The free tier forbids commercial API use and
  gives about one subliminal's worth of characters a month. Creator (~$22/mo)
  is the realistic floor, and voice cloning needs Creator or above.
- **Every generated voice is gated to a paid plan**, at the top of `api/tts.js`
  and `api/voice-clone.js`, off the one definition in `hasPremiumAccess()`. A
  free account gets a 403 before anything reaches ElevenLabs. That includes
  Kyla's own account — testing Serenity needs a tier on it, or the gate needs a
  test bypass. The Preview button is the exception and needs neither: it plays
  the stored demo on any account, including none.

- **The demo's first press is the only one that spends anything.** It has to
  happen once on production, after `ELEVENLABS_API_KEY` is set, before anybody
  can hear it — pressing Preview once (or opening
  `https://subliminallybyfthr.com/api/voice-preview`) is enough, and every press
  after that on every device is free. If the file is ever deleted from the
  bucket, the next press regenerates it and stores it again.

### RevenueCat webhook

Set `REVENUECAT_WEBHOOK_AUTH` in Vercel → `subliminally` → Settings →
Environment Variables, and give RevenueCat the same value when you point its
webhook at `/api/revenuecat-webhook`. The two have to match — that shared value
is the only thing proving a webhook call really came from RevenueCat.

**The value does not belong in this file.** It was written out here in full until
2026-09-21; read it from Vercel, or from the RevenueCat dashboard, when you need
it.

**Rotate it.** Removing it here does not unpublish it: it is still in this
repository's git history, and until 2026-09-21 `LAUNCH.md` was not in
`.vercelignore`, so it may also have been served as a static file from the site.
Generate a new value, set it in Vercel, update the RevenueCat webhook to match,
and redeploy. Until that is done, treat the old value as known.

### Higher Self emotion portraits — complete

All nineteen identities have all three emotion portraits (`welcoming`,
`celebrating`, `reassuring`) in `img/avatar/emotion/` — 57 files, built from the
six supplied packs. Nothing here is waiting on artwork and nothing needs
switching on.

If an identity is ever redrawn, or a new one is added to the roster, unzip the
pack anywhere and run:

```
npm install --no-save sharp
node scripts/build-higher-self-emotions.js <unzipped-pack-dir>...
```

It resizes them, writes them into `img/avatar/emotion/`, rewrites
`js/avatar-emotions.js`, and prints anything missing. A pack already built from
is skipped rather than re-encoded, so re-running is cheap. The mapping from
stored avatar id to pack id lives in the script — a **new** identity needs a
line adding there and to `AVATAR_PACK` in `js/kaly.js`, and an id that has
already shipped must never be renamed.

The fallback is still in place and still matters: an identity whose emotion is
missing shows **its own** reassuring drawing, then its own keeper drawing, and
the console says which file was wanted. It never borrows another identity's
face.

### Avatar colour customization — NOT built

The Habit tracker's second slide promises "+3 habit spaces after completion"
and nothing else, deliberately. The first-cycle reward was also meant to unlock
**hair-colour, skin-tone and outfit-colour customization**, and that is not
implemented and must not be announced as if it were.

The reason is the artwork, not the controls. The supplied portraits are
flattened WebP images: one layer, no separate hair, skin or clothing. Adding
colour pickers over them would do nothing, and tinting the whole image would
recolour the face, the robe, the background glow and the Light effects
together. Either would be a promise the app cannot keep.

What it actually needs, before the reward can be offered:

1. **Layered or maskable art** — each identity re-exported either as separate
   hair / skin / garment layers, or with per-region alpha masks, for all three
   emotions and both existing states. 19 identities x 3 emotions is 57 files
   to redo, and they have to agree with each other: the same chosen hair colour
   must look the same in welcoming, celebrating and reassuring.
2. **Somewhere to store the choice** — three columns or one jsonb on
   `profiles`, read wherever the avatar is drawn.
3. **A composition step** — canvas or CSS masking in `avatarMarkup()` and
   `higherSelfDialogue()`, applied identically everywhere she appears.
4. **The controls themselves**, unlocked off `habitCyclesDone() >= 1`.

Until 1 exists, 2-4 are not worth building. `HO_SPEECH['start-small']` and the
facts beside it are written so the promise is not made.

## Apple review

- **Guideline 4.8.** The app offers Google sign-in, so it must also offer Sign
  in with Apple, or drop Google. This is a submission blocker and the decision
  hasn't been made.
- Old $10 / $22 / $35 Stripe products should be archived so nobody lands on a
  dead price.

## Supabase

Redirect URLs that must be registered (Authentication -> URL Configuration ->
Redirect URLs):

- `https://www.subliminallybyfthr.com/reset-password.html`
- `https://www.subliminallybyfthr.com/**` — where Google sign-in returns on web
- `com.fthr.subliminally://login-callback` — where it returns in the apps
- `http://localhost:3000/**` — only if you test sign-in locally

Site URL must be `https://www.subliminallybyfthr.com`.

Google sign-in also needs, in the **Google Cloud Console** (APIs & Services ->
Credentials -> the OAuth 2.0 Web application client), this exact authorized
redirect URI — it is Supabase's address, not ours, and without it Google stops
the sign-in with `redirect_uri_mismatch` before it ever comes back:

- `https://eiqylxcgexndzopesvhd.supabase.co/auth/v1/callback`

That client's ID and secret go in Supabase under Authentication -> Sign In /
Providers -> Google, with the provider toggled on. While the consent screen is
in **Testing**, only accounts listed as test users can sign in — publish it, or
add the testers. The consent screen also needs its **App name** set, or the
sign-in sheet shows the Supabase project id instead of "Subliminally by FTHR".

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
| `20260926_habit_icons.sql` | run 2026-09-20 — it had been missed |
| `20260929_onboarding_personalization.sql` | superseded — its columns are in 20260930 |
| `20260930_onboarding_slideshow.sql` | run |
| `20261001_habit_onboarding.sql` | already in the database — applied directly on 2026-09-19, not from this folder |
| `20261002_drop_unused_habit_counters.sql` | run 2026-09-20 |
| `20261003_elevenlabs_voices.sql` | run 2026-09-21 — before `ELEVENLABS_API_KEY` was set, as it had to be |

This table stopped being updated after `20260921`; the ones between it and
`20260929` are in the database (their columns and tables are there). `20260929`
is the one that was written and never run, and that is what broke onboarding:
every save named columns the database did not have, so PostgREST rejected the
whole write and nothing saved at all — which is why people were asked the same
questions again on every login. `20260930` carries those columns plus the
completion flag, and is safe to run whether or not `20260929` ever was.

`20260926` was the one still genuinely missing, and it had been missed
quietly: `habits.icon` did not exist, so the icon picker had been saving
nothing since it shipped (`setHabitIcon` warns and carries on), and the Habit
tracker's setup would have failed its first write outright, because PostgREST
rejects an insert naming a column it cannot see — the same failure mode as
`20260929`. Run on 2026-09-20.

`20261001` was **already in the database** before this folder had a file for
it: it was applied directly in Supabase on 2026-09-19 as
`habit_tracker_onboarding`. The file now reproduces that migration exactly, so
a fresh environment matches production and re-running it changes nothing.

### Columns the directly-applied migration brought, and what happened to them

It added five columns the app did not touch. Three are now resolved and two
are still deliberately unused:

| Column | Now |
| --- | --- |
| `profiles.habit_cycle_number` | **Dropped** by `20261002`. Cycles are derived from `habit_checkins` — a stored counter can only drift from the days actually practised, and a column that *can* go down invites something to take it down. |
| `profiles.habit_slots` | **Dropped** by `20261002`. Same reasoning; eight profiles had been left holding a stale `3` that nothing maintained. |
| `habits.duration_minutes` | **In use.** Offered on the setup's "Make it yours" slide and on every habit row — see `setHabitDuration()`. Blank is a real answer and the default: plenty of habits have no length. It is stored and shown back, nothing more — it does not time anything, does not nag, and is not part of whether a day counted. |
| `habits.days_of_week` | Still unused. Nothing filters a habit out on its off days, so a day picker would change nothing visible. It needs `renderHabits()` and the streak logic to respect it first. |
| `habits.reminder_at` | Still unused, and should stay that way until notifications exist. **Nothing sends one.** Taking a reminder time and never using it is the same broken promise as the colour customization above. |

`habit_cycle_number`'s original comment said avatar customization unlocks at
cycle 2. That is the reward described in the section above as not built, and
dropping the column does not change that either way: the artwork is still
flattened.

### Non-negotiables are a morning and night thing

`routineStatusFor()` is only ever asked about morning and night, so a ✦ on an
Anytime habit would decide nothing. The control is not offered there rather
than offered and ignored — no toggle on the row, no checkbox on the setup
slide, and the count line drops the tally. If Anytime should ever count toward
keeping a routine, that is a change to `routineStatusFor()` and `routineKept()`
first, and the control follows it.
