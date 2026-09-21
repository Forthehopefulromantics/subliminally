// /api/voices.js
// Vercel serverless function — what the voice step is allowed to offer, and to
// whom.
//
// There are three answers now and the page does not decide any of them:
//
//   serenity  the built-in voice, free and paid alike
//   mine      the voice this person cloned — only if they have one
//   (record)  recording yourself, which never involves this route at all
//
// What comes back is names, keys and the two confirmation sentences. The
// ElevenLabs ids stay on the server (lib/voices.js), so nothing in the page
// source and nothing in a saved subliminal carries a provider id around.
//
// A GET, because it is a list and it changes only when someone clones a voice.
// Signed in only: the answer includes whether *you* have a voice of your own.

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, tierForUser } from '../lib/supabase-auth.js';
import { DEVICE_VOICE_KEY, MY_VOICE_KEY, SERENITY_VOICE_KEY, publicPresetVoices } from '../lib/voices.js';
import { VOICE_CLONE_CONSENT, VOICE_CLONE_PROCESSING_CONSENT, getVoiceProfile } from '../lib/user-voices.js';
import { isConfigured } from '../lib/elevenlabs.js';
import { CLONE_TIER } from '../lib/voice-access.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }

  const [tier, profile] = await Promise.all([
    tierForUser(user.id),
    getVoiceProfile(user.id).catch(() => null),
  ]);

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    provider: isConfigured() ? 'elevenlabs' : null,
    deviceVoiceKey: DEVICE_VOICE_KEY,
    myVoiceKey: MY_VOICE_KEY,
    serenityVoiceKey: SERENITY_VOICE_KEY,
    tier,
    // One row: Serenity. The page draws its own three cards; this is what the
    // built-in one is called and what it says underneath.
    presets: publicPresetVoices(),
    // Which plan cloning needs, so the page locks the card off the same answer
    // the route enforces rather than a copy of the rule.
    cloneTier: CLONE_TIER,
    // The page shows both sentences and sends them back with the sample; the
    // clone route accepts nothing else, so the two can never drift apart.
    consentStatement: VOICE_CLONE_CONSENT,
    processingConsentStatement: VOICE_CLONE_PROCESSING_CONSENT,
    // The voice id itself is not in here. The page only ever needs to know that
    // there is one, and what to call it.
    myVoice: profile
      ? { key: MY_VOICE_KEY, name: profile.display_name || 'Your AI Voice', desc: 'your cloned voice', createdAt: profile.created_at || null }
      : null,
  });
}
