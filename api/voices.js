// /api/voices.js
// Vercel serverless function — which voices this person may choose from.
//
// The picker in the builder used to hold the ElevenLabs ids itself, which meant
// the list could drift from the list the server would accept, and anyone reading
// the page source could see our voice ids. Now the page asks, and what comes back
// is names and keys: 'serenity', 'mine'. The ids stay on the server.
//
// What comes back is what may be *chosen*, which in V1 is one AI voice. The six
// retired voices are deliberately absent: /api/tts still resolves them so saved
// subliminals keep playing, but nothing offers them as a new choice.
//
// A GET, because it is a list and it changes only when someone clones a voice.
// Signed in only: the answer includes whether *you* have a voice of your own.

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, tierForUser } from '../lib/supabase-auth.js';
import { DEVICE_VOICE_KEY, MY_VOICE_KEY, publicPresetVoices } from '../lib/voices.js';
import { VOICE_CLONE_CONSENT, getVoiceProfile } from '../lib/user-voices.js';
import { isConfigured } from '../lib/elevenlabs.js';

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
    tier,
    presets: publicPresetVoices(),
    // The page shows this sentence and sends it back with the sample; the clone
    // route accepts nothing else, so the two can never drift apart.
    consentStatement: VOICE_CLONE_CONSENT,
    // The voice id itself is not in here. The page only ever needs to know that
    // there is one, and what to call it.
    myVoice: profile
      ? { key: MY_VOICE_KEY, name: profile.display_name || 'My voice', desc: 'your voice', createdAt: profile.created_at || null }
      : null,
  });
}
