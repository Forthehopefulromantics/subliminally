# Affirmation recovery runbook (read-only)

Scope: one user's account. Never run these without the `user_id` filled in, and never
paste results into shared channels. Every query below is SELECT-only.

## Where data lives

| Data | Location | Written when |
|---|---|---|
| Affirmation text | `public.subliminals.affirmations` (jsonb array) | Save to library |
| Recordings (primary voice) | Storage bucket `recordings`, path `<user_id>/<ts>/<i>.<ext>`; paths in `subliminals.recording_urls` | Save to library (`uploadVoiceTakes`, js/billing.js) |
| Second-voice layer | `layer_affirmations`, `layer_recording_urls` (same bucket, `<ts>-layer`) | Save |
| Order/timing/recorded text | `subliminals.mix_settings.affirmationMeta` | Save (newer builds only) |
| Unsaved takes (blobs) | Browser IndexedDB `subliminally-drafts` / `drafts` / key `draft:<user_id>` (js/draft-store.js) | After each take (builds since 6a31c11) |
| Unsaved takes, older builds | In-memory `recordings[]` only (blob: URLs) | Lost on refresh/close |
| Generated TTS | `tts_clips` + bucket `tts-cache` | AI voices only, not own-voice |

## Findings (verified against project `eiqylxcgexndzopesvhd`, aggregate queries only)

* 182 subliminals; **58 hold more than 10 affirmations (max 100)** and 58 hold more than 10
  recording paths (max 123). The "10" limit was never enforced at storage: before 6a31c11
  an imported list was kept whole (`state.count = state.affirmations.length`), and 10 was
  only the generate-chip size / Serenity-Clone voice capacity.
* `recordings` bucket: 2,845 objects across 106 user folders.
* Over-limit lines are therefore **saved, not discarded**, if she pressed Save. The cap only
  excludes lines from generation by voices that cannot read more than 10.
* Reopening a saved subliminal copies the whole array (`s.affirmations.slice()`, js/profile.js:219);
  no truncation. **Risk in current build:** `importAffirmations()` (builder.js ~1058) keeps only the
  first 20 of a pasted/uploaded list. The rest is cut from UI state and not saved.

NOT yet verified: that *her* account holds them. The user id/email was not provided.

## Procedure (support engineer, Supabase SQL editor or MCP `execute_sql`)

1. Resolve the user (email only used here):
   `select id, created_at from auth.users where email = '<her email>';`
2. Her saved subliminals, sizes only:
   ```sql
   select id, title, created_at,
          jsonb_array_length(affirmations) n_aff,
          jsonb_array_length(recording_urls) n_rec,
          (select count(*) from jsonb_array_elements(recording_urls) e where e <> 'null') n_rec_nonnull
   from public.subliminals where user_id = '<USER_ID>' order by created_at desc;
   ```
3. Text export (one subliminal):
   ```sql
   select ord, line from public.subliminals s,
     jsonb_array_elements_text(s.affirmations) with ordinality as t(line, ord)
   where s.id = '<SUBLIMINAL_ID>' and s.user_id = '<USER_ID>' order by ord;
   ```
4. Recording objects actually present (orphans included, e.g. saves that failed mid-way):
   ```sql
   select name, created_at, (metadata->>'size')::int bytes
   from storage.objects
   where bucket_id = 'recordings' and name like '<USER_ID>/%' order by name;
   ```
   Compare with `recording_urls`; objects not referenced by any row are recoverable orphans.
5. Retrieval: create **time-limited signed URLs** (1 h) for only those paths
   (dashboard Storage > recordings > her folder, or `createSignedUrl`). Do not make the
   bucket public. Send the files via a secure link; let it expire afterwards.
6. If nothing is saved: the only possibility is her device. Have her open the app in the **same
   browser/profile**, sign in, open Create; a draft prompt appears if the build is >= 6a31c11.
   Don't clear site data or reinstall. Desktop: DevTools > Application > IndexedDB >
   subliminally-drafts. iOS Safari can evict site storage after ~7 days of non-use, so act
   immediately. Native (Capacitor) data lives in the app sandbox: uninstalling deletes it.

## Cannot be recovered

* Takes from an older build that were never saved and whose tab/app was closed (memory only).
* Lines past the first 20 of a list pasted/uploaded under the current build and never saved otherwise.
* Anything on a device where site data was cleared or the app reinstalled.

## Proposed safeguards (non-breaking; no destructive schema change)

1. Stop silent truncation in `importAffirmations`: show the full count, let her choose, keep the
   overflow in a "parked" list stored in the draft instead of dropping it.
2. Visible `N/limit` counter before recording starts (`countLabel` exists; surface it on the
   paste/import and voice steps, tied to the *selected* voice).
3. Disable Record (not just warn) once `limitFor(voice)` is reached.
4. Autosave draft **text** server-side as well as IndexedDB, so a lost device still has text.
5. Upload each take to `recordings` as made (`<user_id>/drafts/<draftId>/<i>`), promote on Save;
   never overwrite on re-record (version suffix).
6. "Download backup": zip of affirmations.txt + all takes, built client-side from signed URLs
   of her own paths.
7. Compatibility: additive only (new optional `mix_settings` keys, new storage prefix). Rows with
   10+ lines must keep playing: no CHECK constraint, no trimming. Test with a 100-line fixture
   plus `npm run test:unit`.
