// /api/client-event.js
// Receives the reliability events js/telemetry.js sends and writes them to the
// function log as one structured line each. That is the whole of it: no table, no
// third party, nothing stored beyond the platform's own log retention -- so
// there is no schema to migrate and nothing here that could hold a person's data.
//
// It is unauthenticated on purpose (a failed sign-in is an event too), which is
// why it trusts nothing: the event name and every field name come from fixed
// lists, values must be short plain codes, the body is size-capped, and each
// instance only accepts so many events a minute.

import { applyCors } from '../lib/cors.js';

const KINDS = /^(audio|save|auth|billing)_[a-z0-9_]{2,36}$|^unhandled_rejection$/;
const FIELDS = new Set(['code', 'stage', 'voice', 'status', 'ms', 'count', 'state', 'area', 'plan', 'reason']);
const PLATFORMS = new Set(['native-ios', 'native-android', 'ios-safari', 'android-web', 'desktop-web', 'unknown']);
const MAX_BODY_BYTES = 2048;
const PER_MINUTE = 600;

let windowStart = 0;
let seen = 0;

function plainCode(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string' || v.length > 40) return undefined;
  if (!/^[A-Za-z0-9_.:\-]+$/.test(v)) return undefined;
  if (/^[A-Za-z0-9_\-]{24,}$/.test(v)) return undefined;
  return v;
}

export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.kind !== 'string' || !KINDS.test(raw.kind)) return null;
  const fields = {};
  Object.keys(raw.fields && typeof raw.fields === 'object' ? raw.fields : {}).forEach((k) => {
    if (!FIELDS.has(k)) return;
    const v = plainCode(raw.fields[k]);
    if (v !== undefined) fields[k] = v;
  });
  return {
    kind: raw.kind,
    fields,
    sid: typeof raw.sid === 'string' && /^[a-z0-9]{4,12}$/.test(raw.sid) ? raw.sid : undefined,
    platform: PLATFORMS.has(raw.platform) ? raw.platform : 'unknown',
    online: raw.online === false ? false : true,
    visible: raw.visible === 'hidden' ? 'hidden' : 'visible',
  };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const now = Date.now();
  if (now - windowStart > 60000) { windowStart = now; seen = 0; }
  if (++seen > PER_MINUTE) { res.status(429).end(); return; }

  let raw = req.body;
  if (typeof raw === 'string') {
    if (raw.length > MAX_BODY_BYTES) { res.status(413).end(); return; }
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  } else if (raw && typeof raw === 'object' && JSON.stringify(raw).length > MAX_BODY_BYTES) {
    res.status(413).end(); return;
  }
  const event = sanitizeEvent(raw);
  if (!event) { res.status(204).end(); return; }

  console.log(JSON.stringify({ evt: 'client_event', ...event }));
  res.status(204).end();
}
