// /api/tts-report.js
// The browser tells us when audio the server handed back could not be used —
// downloaded empty, would not decode, decoded to silence, or failed once it
// started to play. The server cannot see those: from its side the request was a
// success. Without this, "Serenity doesn't play" is invisible to the people who
// can fix it.
//
// It takes a code and a stage from fixed lists and nothing else. No text, no
// audio, no free-form message: anything outside the lists is stored as a generic
// code. Signed-in callers only, and at most 30 reports per person per 10 minutes.

import { applyCors } from '../lib/cors.js';
import { bearerToken, serviceHeaders, whoIsCalling } from '../lib/supabase-auth.js';
import { maybeAlertAdmin, recordFailure } from '../lib/tts-diagnostics.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PER_WINDOW = 30;

async function recentReports(userId) {
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tts_failures?user_id=eq.${userId}&source=eq.client&created_at=gte.${since}&select=id&limit=1`,
    { headers: serviceHeaders({ Prefer: 'count=exact' }) },
  );
  if (!res.ok) return 0;
  const total = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if ((await recentReports(user.id)) >= PER_WINDOW) { res.status(429).json({ error: 'too_many_reports' }); return; }
  await recordFailure({ userId: user.id, voiceKey: body.voiceKey, code: body.code, stage: body.stage, source: 'client' });
  await maybeAlertAdmin();
  res.status(200).json({ ok: true });
}
