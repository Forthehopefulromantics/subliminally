# Audio audit and repair

Scope: Subliminally's playback, voice generation, recording, cloning, Serenity,
storage, mixer persistence and iPhone behaviour. No interface redesign, no
pricing/entitlement changes, no subliminals or recordings deleted.

## 1. Root causes

### "Plays for about a second, then stops" — NOT reproduced; code paths fixed

I could not reproduce this in desktop Chromium (playback ran continuously in
every scenario I could build). It has **not** been verified on an iPhone. What the
audit found are the code paths that can produce exactly this symptom:

| Path | What happened | Fix |
|---|---|---|
| `silenceCheck` in `playFinal` | If the audio context was not `running` 1.2 s after start (common on iOS while `resume()` is pending, or after an interruption) the **whole session was destroyed** with "This browser blocked the sound". | Asks the context to resume, then after a further 3 s *pauses* (position and settings kept) with a "tap play" message. Test 16/16b. |
| Switching subliminals | `playFromLibrary` called `primeAudio()` *before* `stopFinal()`; `stopFinal` then closed the context that had just been unlocked in the tap, and playback started later on a brand-new context outside the gesture — suspended on iOS, hence the 1.2 s self-destruct above. | Stop first, then prime; pending starts are cancelled by token. Test 11/11b. |
| Server clip cache | Any HTTP 200 from the voice provider was uploaded and recorded as a finished clip, with no check of size, mp3 validity or length. A truncated or empty body would be cached and replayed forever. | `lib/audio-validate.js` (frame walk, duration vs. words), Content-Length check, read-back size check, cached rows verified against storage before use. Only the bad line is regenerated. |
| Timer-driven line chain | A session was a chain of `ended` callbacks and `setTimeout`s per line; any dropped link (throttled timer, rejected `play()`, failed decode) silently ended or stalled it. | The whole pass is rendered once into one `AudioBuffer` and looped on the audio thread (`js/voice-track.js`). After start there is no timer, network request or decode in the voice's path. |

The player also logs every start/stop/pause with its reason. On a phone, run
`__audioDiag()` in the console after a failure; it names the exact path.

### Voice replaced by the iPhone's voice

1. `getMySubscriberRow` swallowed query errors; `fetchOnce` then cached "no plan"
   for 5 minutes, so a single failed request downgraded a paying member's Serenity
   playback to the device voice. (`resolveVoiceKey` returned `null` → device.)
2. Every playback failure (generation error, expired link, decode error) ended in
   `.catch(deviceSpeak)`.
3. A page load before auth settled looked like "no account" → device voice.
4. A Record-Your-Own subliminal whose upload failed was **saved anyway** with no
   recordings and no voice id, and reloaded as the device voice.
5. The Serenity preview and voice preview also fell back to the device voice.

### Settings not persisting

Pace/gap (and therefore the TTS speed that identifies cached clips), loop mode,
session length and background choice were never saved per subliminal; pace was not
restored on load, so reopening could fetch or generate clips at a different speed.
A failed mixer save was reported once and then forgotten.

### Other defects found

* In Library/Today/etc. a page-level CSS rule hid the full-screen player section,
  and `body.player-open` hides the Now bar, so **no Pause/Start Over was visible
  while playing from the Library**. Fixed with one rule in `css/player.css`.
* Two overlapping loads/starts (tapping a second subliminal quickly) could
  interleave state; guarded with sequence tokens.
* `/api/tts` could be asked twice for the same lines (prewarm plus play).

## 2. What changed

Files: `js/voice-track.js` (new), `js/builder.js`, `js/profile.js`,
`js/billing.js`, `js/mix-settings.js`, `js/player.js`, `css/player.css`,
`index.html`, `api/tts.js`, `api/voices.js`, `lib/tts-store.js`,
`lib/elevenlabs.js`, `lib/audio-validate.js` (new),
`supabase/migrations/20261012_audio_reliability.sql` (new), tests under
`scripts/`.

### Voice rules
* The saved voice is the voice that plays. `resolveSessionVoice` returns a voice or
  throws a coded error; it never returns "use the device".
* Failures show a bar over the current screen with the reason, **Retry** and
  dismiss; the selection is untouched and "Nothing was played in another voice".
* The device voice plays only for a subliminal explicitly saved with it
  (`voice_profile.kind = 'device'`, or a legacy row with no voice information).
* Voice identity: `voice_profile.fingerprint` is a short hash of the provider voice
  id (the id never reaches the browser). If the voice behind `serenity`/`mine`
  changes, playback stops with "Use my current voice" as an explicit choice.
* Plan lookup failures are errors with Retry, not "no plan", and are not cached.

### Assets
* Recordings: stored in the private `recordings` bucket (unchanged), now verified
  by read-back after upload (2 attempts); a failed upload **blocks the save**
  rather than creating a row that would play in another voice. A take that decodes
  to silence is rejected at record time and at playback.
* Serenity / clone: `tts_clips` + private `tts-cache` bucket (existing), keyed by
  user + provider voice + model + pace + normalized text, so unchanged content is
  reused and a change regenerates only the affected line. New columns:
  `status` (pending/generating/ready/failed), `byte_size`, `duration_ms`,
  `error_code`. A row is "ready" only after the mp3 validated and was read back.
* Clone profile: `user_voice_profiles` (unchanged). **The raw consent sample is not
  kept — the UI promises it is "never kept", and that is honoured.** Only the
  provider voice and generated outputs persist.
* Provider policy: generated audio is stored only for paid accounts (the route is
  already Ritual-gated); the provider's free tier forbids commercial use. Deleting
  an account removes `tts-cache` and `recordings` (existing `api/delete-account.js`).
* At play time every clip is fetched and decoded **before** the session starts.
  An expired or removed link is re-requested twice (server re-signs / regenerates
  that line) before failing visibly.

### Settings
`mix_settings` (v2) holds: six faders, `bg`, `bgLayer`, `soothingLayer`, `freqHz`,
`binauralBand`, `pace`, `gapMs`, `loopMode`, `durationMinutes`. Saves:
* are debounced (300 ms), immediate on pagehide/visibility change;
* are written to the device first (`localStorage`, marked unsynced);
* send only changed keys through `patch_subliminal_audio` (jsonb merge,
  revision-checked); falls back to a plain update if the function is not installed;
* retry with backoff (2 s … 2 min) and on `online`; the user sees
  "Couldn't save just now — your changes are kept on this device…";
* are re-sent on the next open if the tab closed first.

There is no echo/delay processor in the app, so nothing exists to persist for
those; "layering" (second voice, ambience layer) and repetition (pace, EFT repeat
column) are persisted.

### Playback engine
The voice is one looping `AudioBufferSourceNode`; line text, seek (lock-screen
previous/next) and "loop this affirmation" work from cue offsets. Pause is
`AudioContext.suspend()`; the position freezes exactly. Loop mode `none` ends after
one pass. A single `voiceRun` exists; stopping/switching clears it and closes the
context.

## 3. Migration (not yet run)

`supabase/migrations/20261012_audio_reliability.sql` — additive and idempotent.
The application works without it (clip lookups, saves and mixer writes fall back),
but **voice identity checks, `audio_rev` merging and clip status need it**. Run it
in the Supabase SQL editor. It also creates the read-only helper view
`subliminals_voice_audit` (no access for anon/authenticated).

## 4. Test results

Run: `npm run test:audio` (real Chromium, real mp3/wav audio through the real engine,
stand-in Supabase and voice provider), `npm run test:track`,
`npm run test:audio-validate`, `npm run test:mix`, `npm run test:audio-editor`
(needs `PLAYWRIGHT_MODULE`), `node scripts/audio-lifecycle-test.cjs`.

RESULTS_PLACEHOLDER

Not performed, and **not** to be treated as passed:

| # | Check | Status |
|---|---|---|
| 14 | Lock screen / background / app switch on **real iOS Safari** | **Manual device test required** |
| – | Bluetooth / route changes, ringer switch, phone-call interruption on a device | Manual |
| – | Media Session lock-screen controls on a device | Manual |
| – | Real ElevenLabs generation, real Supabase Storage and RLS | Not run (stand-ins only) |
| 6/7 | 60 / 480 minutes in **real time** | Verified with an accelerated wall clock and a real-time loop wrap; a real 8-hour soak was not run |
| 1b | iPhone user-agent | Chromium with an iPhone UA string exercises the media-element route; it is not iOS |

Manual iPhone script: add to Home Screen or open in Safari, play a Serenity
subliminal from the Library, lock the screen for 10 minutes, unlock (still
playing, same voice), switch apps, take a call, connect/disconnect headphones,
toggle the ringer switch. On any stop run `__audioDiag()` and send the output.

## 5. Limitations and configuration

* **Safari cannot guarantee background audio.** The engine uses a media element
  output route, a silent keeper element and Media Session, which is the best the
  web allows, but iOS may still suspend a web page's audio after long locks or
  memory pressure. The reliable solution is native: the Capacitor app (already
  present) with the `UIBackgroundModes: audio` capability and a native audio
  session (e.g. a plugin playing the rendered track via `AVAudioPlayer`/
  `AVAudioSession` category `.playback`). Not done here.
* A *second voice* layered under a **recorded** main voice, when chosen as "AI
  voice", is still the device voice (that is how it was saved; it is explicit,
  not a substitute). When the main voice is Serenity or a clone, the second voice
  now reads in the same studio voice.
* Rendered gaps are fixed per pass (varied from line to line, repeated each loop)
  rather than re-randomised each loop.
* Memory: a pass is held as decoded samples (~175 KB/s mono at 44.1 kHz).
* Run the migration; `ELEVENLABS_API_KEY`, `SUPABASE_*` env vars are unchanged.
* `test:voice` needs `npm install` (ffmpeg-static); `test:voice-routing` and
  `test:ambience` were already failing before this work (they crash on missing page
  elements) and are not repaired here; `test:voice-routing` also references the
  removed cloned-voice helpers.

## 6. Existing subliminals that may need one-time regeneration

Live data at audit time (read-only): 10 subliminals, 140 cached clips. One
subliminal has neither recordings nor a voice id — it is either a genuine early
device-voice subliminal or a Record-Your-Own subliminal whose upload failed. It
plays in the device voice and cannot be told apart from the data. Find candidates
after running the migration:

```sql
select id, title, user_id, inferred_kind from subliminals_voice_audit
where needs_voice_profile and inferred_kind = 'unknown_or_device';
```

Recordings that exist as rows but whose storage objects are missing are now
reported at play time ("recording couldn't be downloaded") with Retry; those
need re-recording (nothing was deleted). Clips with no recorded size are verified
against storage on next use and regenerated individually if missing or too small.
Subliminals saved before pace was persisted open at the default pace; if they
were built at "Drifting" or "Close together" their clips will be regenerated at
the default pace once (costing characters) unless the pace is set back and saved.
