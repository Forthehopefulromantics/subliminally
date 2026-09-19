/* avatar-emotions.js — GENERATED. Do not edit by hand.

   Written by scripts/build-higher-self-emotions.js from the supplied Higher
   Self emotion packs. One entry per avatar id the app offers: the emotions
   whose artwork is actually in img/avatar/emotion/, each with the [width,
   height] of that file. An identity with an empty entry has no emotion artwork
   yet and falls back to its existing keeper drawing -- never to somebody
   else's face. Re-run the script when the remaining packs arrive and this file
   is rewritten.

   The sizes are here because the packs are not one shape: the portraits run
   anywhere from 1882x3344 to 2366x2660 before resizing, and every one keeps
   its own ratio. A single assumed size on the <img> would reserve the wrong
   box and shift the whole slide the moment the real picture arrived.

   Part of Subliminally. A plain script, loaded before kaly.js. */
const AVATAR_EMOTIONS = ['welcoming', 'celebrating', 'reassuring'];
const AVATAR_EMOTION_ART = {
  "box-braids": { welcoming:[800,1200], celebrating:[1037,1200], reassuring:[800,1200] },
  "straight-black": { welcoming:[788,1200], celebrating:[1000,1200], reassuring:[800,1200] },
  "tapered-afro": { welcoming:[988,1200], celebrating:[1005,1200], reassuring:[800,1200] },
  "copper-waves": { welcoming:[892,1200], celebrating:[933,1200], reassuring:[1000,1200] },
  "dark-blonde-ponytail": { welcoming:[900,1200], celebrating:[1000,1200], reassuring:[990,1200] },
  "shoulder-locs": { welcoming:[900,1200], celebrating:[1000,1200], reassuring:[977,1200] },
  "curly-bob": { welcoming:[893,1200], celebrating:[1000,1200], reassuring:[900,1200] },
  "silver-lilac": { welcoming:[675,1200], celebrating:[1027,1200], reassuring:[800,1200] },
  "blonde-curls": { welcoming:[878,1200], celebrating:[1000,1200], reassuring:[675,1200] },
  "lavender-hijab": { welcoming:[927,1200], celebrating:[1054,1200], reassuring:[901,1200] },
  "facial-piercings": { welcoming:[935,1200], celebrating:[1067,1200], reassuring:[843,1200] },
  "east-asian": { welcoming:[854,1200], celebrating:[1000,1200], reassuring:[800,1200] },
  "long-straight-black": { welcoming:[865,1200], celebrating:[1000,1200], reassuring:[800,1200] },
  "black-twists": {},
  "east-asian-crop": {},
  "latino-waves": {},
  "south-asian-curls": {},
  "blond-blue-eyes": {},
  "androgynous-undercut": {},
};
