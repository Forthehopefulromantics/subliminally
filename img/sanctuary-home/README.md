# The Sanctuary home

Nine backgrounds, one per space in the two-story home. **They are backgrounds
and nothing else.** Every avatar, button, label, reward, hotspot and animation
is a layer drawn on top by the app, so nothing is baked in that later has to be
translated, re-themed, moved for a notch, or removed for a redesign.

Five are here. Four are still missing, and they are marked below.

| File | Space | Status |
|---|---|---|
| `00-home-overview.webp` | The whole house and garden, seen in cutaway | ✅ |
| `01-living-room-hub.webp` | Living room — the hub, and the first room anyone sees | ❌ **missing** |
| `02-bedroom-dreamscape.webp` | Bedroom — rest, subliminals, the subconscious | ✅ |
| `03-library-story-room.webp` | Library — journalling, memory, the photo calendar | ❌ **missing** |
| `04-mirror-identity-room.webp` | Mirror — identity, affirmations, self-concept | ✅ |
| `05-waters-bathroom.webp` | Waters — emotional release, EFT, grief | ✅ |
| `06-creative-vision-studio.webp` | Studio — vision boards, goals, recording | ❌ **missing** |
| `07-practice-garden.webp` | Garden — habits, consistency, the seeds | ✅ |
| `08-horizon-balcony.webp` | Balcony — the future, milestones, direction | ❌ **missing** |

`01` is the one to draw first: it is the default unlocked room, so it is the
only one of the four that blocks the first release rather than a later one.

## Sending new ones

**Send the PNG at whatever size it comes out of the generator, and don't convert
it.** Conversion happens here, because it is easy to get wrong in a way that
only shows up as a slow app months later.

For the record, the five above arrived as 19.45 MB of PNG and were written as
1.26 MB of WebP — fifteen times smaller, with a mean per-pixel difference of
about 3 in 255, which is under the threshold at which anyone can see it. That
matters more than it sounds: everything in `img/` is bundled into the iOS and
Android binaries, so artwork weight is App Store download weight.

- **Roughly 9:16.** These are 941 × 1672, which is 9:16 to within a rounding
  error. The app's stage is exactly 9:16 and does not crop, so anything at a
  different ratio will letterbox rather than fill.
- **No text, no UI, no characters.** See above.
- **Leave the top and bottom eighth calm.** A status bar sits over one and a
  navigation bar over the other, and neither can move.
- **Doors and entrances belong away from the very edges,** because that is where
  a hotspot has to be tappable with a thumb.

## Naming

The numbers are the order rooms open in, and the names are the room keys the
code uses. **Renaming a file renames a room**, so don't, even if the order later
changes — the order lives in `js/sanctuary.js`, not in the filenames.
