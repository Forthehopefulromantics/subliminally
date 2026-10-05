// The one place Visualization talks to Anthropic.
//
// The model is VISUALIZATION_MODEL when set, otherwise the one the app's other
// writers already use, so a key that works for them works here.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.VISUALIZATION_MODEL || 'claude-sonnet-4-6';
const TIMEOUT_MS = 45000;

export class WriterError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || ''; }
}

export function writerConfigured() { return !!ANTHROPIC_API_KEY; }

/* Models sometimes wrap JSON in a fence or a sentence despite being told not
   to. Take the first balanced-looking object out of whatever came back. */
export function parseJsonObject(text) {
  const raw = String(text || '').replace(/```json|```/gi, '').trim();
  try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { /* fall through */ }
  }
  return null;
}

export async function askWriter({ system, user, maxTokens, temperature }) {
  if (!ANTHROPIC_API_KEY) throw new WriterError('not_configured');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens || 1400,
        temperature: temperature == null ? 0.9 : temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (err) {
    throw new WriterError(err && err.name === 'AbortError' ? 'timeout' : 'network', err && err.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new WriterError('upstream', `${res.status} ${detail.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  const text = ((data && data.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = parseJsonObject(text);
  if (!parsed) throw new WriterError('malformed', text.slice(0, 200));
  return parsed;
}
