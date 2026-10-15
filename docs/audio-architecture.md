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

An unfinished recording is kept in IndexedDB (`js/draft-store.js`) until the
subliminal is saved or the draft is discarded.

## Limits

`AffirmationKit.AFFIRMATION_LIMITS`: Record Your Own Voice 20; Serenity 10;
Clone Your Voice 10. The review step allows up to 20 lines; the voice screen
holds Continue (never deletes) when the chosen voice carries fewer.
