// /api/notify-feedback.js
// Vercel serverless function — called by a Supabase Database Webhook whenever
// a new row is inserted into the `feedback` table. Sends you an email via Resend.
//
// Required environment variable (Vercel -> Project -> Settings -> Environment Variables):
//   RESEND_API_KEY  - from resend.com -> API Keys (the same account used for confirmation emails)
//   FEEDBACK_WEBHOOK_AUTH - random shared Authorization header also configured
//                           on the Supabase Database Webhook
//
// Setup on the Supabase side (Database Webhooks), see the instructions that came with this file.

export const config = { api: { bodyParser: true } };

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FEEDBACK_WEBHOOK_AUTH = process.env.FEEDBACK_WEBHOOK_AUTH;
const NOTIFY_TO = 'hello@subliminallybyfthr.com';
const NOTIFY_FROM = 'Subliminally <notifications@subliminallybyfthr.com>';

async function authorized(value) {
  if (!value || !FEEDBACK_WEBHOOK_AUTH) return false;
  const crypto = await import('crypto');
  const actual = Buffer.from(value);
  const expected = Buffer.from(FEEDBACK_WEBHOOK_AUTH);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!RESEND_API_KEY) {
    res.status(500).json({ error: 'RESEND_API_KEY is not set' });
    return;
  }
  if (!FEEDBACK_WEBHOOK_AUTH) {
    res.status(503).json({ error: 'FEEDBACK_WEBHOOK_AUTH is not set' });
    return;
  }
  if (!(await authorized(req.headers.authorization))) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    // Supabase Database Webhooks send the new row as { type, table, record, ... }
    const payload = req.body || {};
    const record = payload.record || payload;
    const type = record.type === 'idea' ? 'idea' : 'support';
    const message = String(record.message || '(no message)').slice(0, 10000);
    const rawEmail = String(record.contact_email || '').trim().slice(0, 320);
    const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : 'not provided';
    const createdAt = String(record.created_at || new Date().toISOString()).slice(0, 100);

    const subject = type === 'idea' ? 'New idea shared on Subliminally' : 'New support request on Subliminally';

    const html = `
      <div style="font-family: sans-serif; max-width: 560px;">
        <h2>${escapeHtml(subject)}</h2>
        <p><strong>From:</strong> ${escapeHtml(contactEmail)}</p>
        <p><strong>Type:</strong> ${escapeHtml(type)}</p>
        <p><strong>Sent:</strong> ${escapeHtml(createdAt)}</p>
        <hr>
        <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
      </div>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: contactEmail !== 'not provided' ? contactEmail : undefined,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const text = await resendRes.text();
      console.error('Resend send failed:', resendRes.status, text);
      res.status(502).json({ error: 'Email send failed', detail: text });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    console.error('notify-feedback error:', err);
    res.status(500).json({ error: 'Handler error', detail: err.message || String(err) });
  }
}
