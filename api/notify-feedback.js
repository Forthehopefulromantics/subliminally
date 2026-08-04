// /api/notify-feedback.js
// Vercel serverless function — called by a Supabase Database Webhook whenever
// a new row is inserted into the `feedback` table. Sends you an email via Resend.
//
// Required environment variable (Vercel -> Project -> Settings -> Environment Variables):
//   RESEND_API_KEY  - from resend.com -> API Keys (the same account used for confirmation emails)
//
// Setup on the Supabase side (Database Webhooks), see the instructions that came with this file.

export const config = { api: { bodyParser: true } };

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_TO = 'hello@subliminallybyfthr.com';
const NOTIFY_FROM = 'Subliminally <notifications@subliminallybyfthr.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!RESEND_API_KEY) {
    res.status(500).json({ error: 'RESEND_API_KEY is not set' });
    return;
  }

  try {
    // Supabase Database Webhooks send the new row as { type, table, record, ... }
    const payload = req.body || {};
    const record = payload.record || payload;
    const type = record.type || 'support';
    const message = record.message || '(no message)';
    const contactEmail = record.contact_email || 'not provided';
    const createdAt = record.created_at || new Date().toISOString();

    const subject = type === 'idea' ? 'New idea shared on Subliminally' : 'New support request on Subliminally';

    const html = `
      <div style="font-family: sans-serif; max-width: 560px;">
        <h2>${subject}</h2>
        <p><strong>From:</strong> ${contactEmail}</p>
        <p><strong>Type:</strong> ${type}</p>
        <p><strong>Sent:</strong> ${createdAt}</p>
        <hr>
        <p style="white-space: pre-wrap;">${String(message).replace(/</g, '&lt;')}</p>
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
