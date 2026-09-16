import { bearerToken, whoIsCalling, tierForUser, serviceHeaders } from './supabase-auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const TIER_ORDER = ['none', 'whisper', 'ritual'];

function tierAtLeast(actual, required) {
  return TIER_ORDER.indexOf(actual) >= TIER_ORDER.indexOf(required);
}

async function consumeQuota(userId, action) {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_ai_quota`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ p_user_id: userId, p_action: action }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI quota check failed (${response.status}): ${detail}`);
  }
  return response.json();
}

// Authenticate every credit-spending AI request, enforce paid features on the
// server, and consume a durable quota before contacting the model provider.
export async function authorizeAiRequest(req, { action, requiredTier = 'none' }) {
  const user = await whoIsCalling(bearerToken(req));
  if (!user) return { error: 'Sign in to generate content.', status: 401 };

  const tier = await tierForUser(user.id);
  if (!tierAtLeast(tier, requiredTier)) {
    return { error: `${requiredTier === 'ritual' ? 'Ritual' : 'A paid plan'} is required for this feature.`, status: 403 };
  }

  try {
    const quota = await consumeQuota(user.id, action);
    if (!quota || quota.allowed !== true) {
      return {
        error: 'You have reached the generation limit. Please try again later.',
        status: 429,
        retryAfter: Number(quota && quota.retry_after_seconds) || 3600,
      };
    }
  } catch (error) {
    console.error('AI quota error:', error);
    return { error: 'Generation protection is temporarily unavailable.', status: 503 };
  }

  return { user, tier };
}

export function cleanPromptValue(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function sendAuthorizationError(res, result) {
  if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
  res.status(result.status).json({ error: result.error });
}
