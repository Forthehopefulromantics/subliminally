# Audio architecture

How a Subliminally session is put together, what the pre-change audit found, and
what the frequency-layer / lyrics-list work added. Code lives in `js/builder.js`
(engine), `js/player.js` (immersive player UI) and the three new modules below.

## One session, one clock, one context

- **One `AudioContext` per play** (`finalCtx`), opened inside the tap and closed by
  `stopFinal()` / `finishFinal()`. Every layer hangs off it.
- **One output bus** (`audioOut(ctx)`): all layers -> `bus` -> soft limiter ->
  speaker. On iPhone/iPad (browser and the Capacitor wrapper) the tail goes
  through a `MediaStreamDestination` into an `<audio>` element instead of
  `ctx.destination`, so the ringer switch does not silence it and iOS treats it as
  media playback. Exactly one route is ever connected.
- **One session clock**: `getFinalElapsedMs()` (wall time minus time spent
  paused). The progress bar, lock-screen position, session end *and* the
  affirmation timeline all read it.
- **One guard for every callback**: `finalCallback` / `finalLater` drop callbacks
  from an earlier session (`finalSession` counter) and hold them while paused.

## Layers

| Layer | Owner | Notes |
| --- | --- | --- |
| Frequencies (1-4) | `FrequencyMixer` (`js/frequency-layers.js`) | idempotent `sync(layers)`; one voice per Hz; fades in/out; `master` gain = the Frequency fader |
| Nature / meditation ambience | `AmbienceBed` (`js/ambience.js`) | unchanged |
| Soothing pad, custom track | `restartSoothingLayer`, `startCustomTrackPlayback` | unchanged |
| Affirmation voice | `playClip` / device speech | reports `lineStarted` / `lineEnded` to the timeline |
| Second (layered) voice | `runLayerSequence` | never reports lines, so it can never be highlighted |

## What the audit found (and what was done)

- The tone was two oscillators, the second **detuned to 1.003 x the chosen Hz**,
  and changing frequency ramped them in place. Layers now run exact sines; the
  detuned partner is gone (it was a 0.3% pitch shift of the advertised tone).
- Tone gain was a fixed `slider * 0.10`. Per-tone gain now scales by `1/sqrt(n)`
  so four tones peak at ~2x one tone (measured offline in the e2e: 0.10 vs 0.20).
- `audioOut` fed the speaker with no protection against overs; a soft limiter
  (identity below 0.8, rounded above, never past 1.0) now sits at the end.
- Highlight timing: the immersive player used to show whatever text `#finalLine`
  held, set *before* the clip had loaded. It now follows the audio itself.
- The player's root element was a `<section>`, which the page-view rule
  `body[data-view] > nav ~ section:not(...)` hides with `!important`. It is a
  `<div>` now.
- `scripts/sync-web-assets.js` did not copy `css/` into the native bundle.

## The timeline (`js/affirmation-timeline.js`)

`AffirmationTimeline` stamps `lineStart(i)` / `lineEnd(i)` on the session clock.
`stateOf(i)` is `active | queued | played | upcoming`. `beginPass()` runs at the top
of each `runSequence` (the first pass and every loop). Pause/resume only toggle a
flag, because the session clock already excludes pauses. `LyricsList`
(`js/lyrics-list.js`) paints that state and owns follow-mode scrolling.

## Persistence (no schema change)

Everything new is stored in the existing `subliminals.mix_settings` jsonb:

- `freqLayers: [{hz, vol}]` - `frequency_hz` still holds the first layer.
- `affirmationMeta: [{order, durationMs, startMs, endMs, recordedText}]` - one per
  affirmation; the audio is `recording_urls[i]`, the text is `affirmations[i]`.

An unfinished recording is kept on the device (see "Recording and saving" below)
until the subliminal is saved or the draft is discarded.

## Limits

`AffirmationKit.AFFIRMATION_LIMITS`: Record Your Own Voice **100**; Serenity 10;
Clone Your Voice 10. `MAX_AFFIRMATIONS` (100) is the most the review step, the
paste/upload import and the recording manager will hold; `MIN_AFFIRMATIONS` (5)
is the fewest. The count picker on the first screen offers 5 / 10 / 20 / 50 / 100
and a custom number (`AffirmationKit.clampCount`, 5-100).

The voice screen holds Continue (never deletes) when the chosen voice carries
fewer lines than there are. The cost rule is enforced at three doors, none of
which Record Your Own Voice touches:

1. the voice screen (`voiceLimitProblem`) - Serenity/Clone with more than 10 lines
   cannot continue, and nothing is removed;
2. `ttsRequest` in `js/builder.js` - refuses to send a request to `/api/tts` while
   the list is longer than the AI limit, so a reopened subliminal, a changed voice
   or a stale tab cannot reach the provider with a long list;
3. `/api/tts` itself - unchanged (25 lines per request, per-user hourly/daily
   ceilings).

`/api/generate-affirmations` writes up to 100 lines of *text*. That is a few
thousand tokens from the text model; no voice is generated until a voice is
chosen and the person plays or builds it.

## Recording and saving

Each take is its own file and its own small record; nothing is ever rewritten as
a whole.

- **Recording UI** (`js/builder.js`, step 6): hold-to-record (the original) or
  tap-to-record with Pause / Resume / Cancel. Pause time is excluded from the
  take's length. A numbered, scrollable list shows every line with Record /
  Re-record, Play / Stop, Remove recording (keeps the words), Edit, move, Delete;
  Go to line, Next unrecorded, and a "Recording N of M" counter with a progress
  bar. A microphone refusal, a recorder error or a cancelled take change nothing
  else.
- **On the device** (`js/draft-store.js`, IndexedDB): a small `draft:<owner>`
  record (words, order, settings, `takeIds`) plus one `take:<owner>:<id>` record
  per take. A take is written once; line 90 is one small write. The previous
  single-record layout is still read and is upgraded the first time it is saved.
- **In the account** (`js/take-sync.js`): each take is uploaded to the private
  `recordings` bucket as it is made, to `<userId>/takes/<takeId>.<ext>`. The path
  is derived from the take's own id, so a take can only ever be one object; a
  retry after a lost response gets "already exists", which is treated as success.
  A pool of 3 uploads, 3 retries with back-off, retried again when the connection
  returns or the page becomes visible, and once more at Save. A failed upload is
  shown on its row and never stops recording.
- **Save** writes only the list of paths (`recording_urls`). If any take could not
  be uploaded, nothing is written (so an existing subliminal can never be saved
  over with holes in its list) and pressing Save again sends only what is
  missing. Saving twice at once writes one row. Saving over a subliminal whose
  recordings did not all download is refused.
- **Nothing existing is removed.** Files that belong to a saved subliminal are
  `committed` and are never deleted. The only deletions from the app are uploads
  that never became part of a saved subliminal (a replaced or removed take, a
  discarded draft), and `removeUnreferencedRecordings` checks every one against
  the person's subliminals first and deletes nothing if that list cannot be read.
- **Loading** (`fetchSavedTakes` in `js/profile.js`): one signing request for all
  paths, downloads six at a time. A path that is `null` is "never recorded"; a
  failed download is counted as an error, never confused with that.

## Playback memory

A hundred decoded takes held for a whole session is about a hundred seconds of
uncompressed audio. Past `CLIP_WINDOW_OVER` (24) recorded lines only the line
being spoken and the next are held decoded (`keepClipsNear`); the next is decoded
ahead of its turn so the gap between lines is unchanged. Lists of 24 or fewer
behave exactly as before. Stopping gives the decoded audio back.

## Tests

`npm run test:unit` includes `test:affirmations` (limits, count presets, custom
clamp) and `test:take-sync` (one object per take, joined duplicate uploads, a
pool of 3 over 100 takes, retries, lost-response safety, only uncommitted uploads
removed). `npm run test:layers-lyrics` and `npm run test:own-voice-100` are
browser tests (serve the repo on :8123 first): the latter records, refreshes,
edits, saves, reopens, re-records and plays a complete 100-affirmation subliminal.

## Serenity (generated voice): generate, verify, then play

Serenity and Clone Your Voice share one path in `js/builder.js` (`runStudioPrepare`):

1. **Generating Voice** - `/api/tts`, batched 6 lines per request, up to 3 attempts per batch with
   exponential backoff for timeouts / 5xx / bad audio. Quota, auth and rate limits are not retried.
2. **Saving Audio** - every returned link is downloaded and checked in the browser (reachable, >= 1.5 KB,
   an audio header, decodes, not silent). The bytes are kept on the line's handle, so playback needs
   neither the link nor the network. A bad link is re-requested; bad content is re-requested with
   `repair: true`, which makes the stored copy again. One second chance, then **Failed**.
3. **Ready to Play** - only now is `studioReadyKey` set. Play compares against it and, if not ready,
   waits for / triggers preparation. **There is no device-voice fallback** for a generated voice
   (device speech is silent on iPhone once Web Audio runs). **Retry Audio** re-runs it.

Server (`api/tts.js`): audio is validated before it is stored (`verifySpeechAudio`), the upload and the
`tts_clips` row are both required, a cached row whose audio is gone is forgotten and regenerated
(self-heal), and the function stops starting work 10 s before its 60 s limit. Failures are written to
`tts_failures` (codes only, never text) by the route and by `/api/tts-report` (browser-side faults), and
the fifth failure in 30 minutes emails the admin once an hour (`lib/tts-diagnostics.js`).
Apply `supabase/migrations/20261018_tts_failures.sql`; nothing breaks if it is not applied yet.

Plan lookups: `getMyTierChecked()` throws when the lookup fails, so a transient error is a retryable
network failure rather than "free plan" (which used to be cached for 5 minutes).

Tests: `npm run test:voice` (server), `npm run test:voice-routing` (client logic),
`npm run test:serenity-e2e` (Chromium, iPhone UA, real mp3s, measured speaker output).

## Voice echo (`js/voice-echo.js`)

Each affirmation voice layer -- `voice` (the main voice) and `layerVoice` (the
second, layered voice) -- has its own echo: `{ on, mix (0-100), delayMs (100-1000) }`,
off by default. The settings object is per layer; `VoiceEcho.set(layer, patch)` is the
only mutation and touches that layer alone.

- **Signal path**, one `EchoBus` per layer per `AudioContext`: clip gain -> `input` ->
  `dry` -> `out`, and `input` -> `send` -> `delay` -> low-pass -> `wet` -> `out`, with
  `delay` -> low-pass -> `feedback` -> `delay`. `out` feeds `audioOut(ctx)` (and the
  recording destination when the main voice is being recorded). `playClip` routes
  through it via `voiceLayerInput`, for buffer clips (Record Your Own Voice) and
  element clips (Serenity, cloned voices) alike.
- **Non-destructive**: it only shapes playback. Nothing is regenerated or re-uploaded
  when an echo changes, and the cached/decoded clips are never touched.
- **Off = dry**: dry 1, send/wet/feedback 0. The delay line receives nothing while off.
- **Headroom**: dry = 1 - 0.3 x mix, wet = 0.5 x mix, feedback = 0.45 x mix (hard cap
  0.45, low-passed in the loop), so the worst-case coherent sum stays under 1.7 before
  the output soft limiter. All parameter moves glide (`setTargetAtTime`, 40 ms).
- **Live**: the controls call `applyLive` on the existing bus, so moving a slider while
  a line plays is heard immediately; no restart.
- **Persistence**: `mix_settings.voiceEcho` (no schema change) via `readMixSettings` /
  `restoreMixSettings`, plus a device copy (`localStorage fthr_voice_echo:<id>`) so a
  refresh or closed tab before the account write lands loses nothing; the newer copy
  wins on open. An unsaved recording draft carries it in the draft record.
- **Controls** are `[data-echo-layer]` blocks (toggle + Intensity + Delay) in the
  builder mixer and in the player / Adjust Sounds sheets, wired by delegation.
- **Safari**: only `DelayNode`, `GainNode`, `BiquadFilterNode`; no AudioWorklet. The
  output still leaves through the single iOS media-element route in `audioOut`.
- Tests: `npm run test:echo` (model, persistence, independence) and
  `npm run test:echo-e2e` (offline render in Chromium: delay timing, silence between,
  no clipping at max, off == dry bit-for-bit, other layer's output unchanged).
