const TELNYX_API_URL = 'https://api.telnyx.com/v2/messages';

function getTelnyxConfig() {
  const {
    TELNYX_API_KEY,
    TELNYX_FROM_NUMBER,
    TELNYX_MESSAGING_PROFILE_ID,
    TELNYX_USE_NUMBER_POOL,
  } = process.env;
  const useNumberPool = String(TELNYX_USE_NUMBER_POOL || '').toLowerCase() === 'true';

  // Log minimal config presence for debugging (no secrets).
  console.log('[Telnyx] Config check', {
    hasApiKey: Boolean(TELNYX_API_KEY),
    fromNumber: TELNYX_FROM_NUMBER || null,
    messagingProfileId: TELNYX_MESSAGING_PROFILE_ID || null,
    useNumberPool,
  });

  if (!TELNYX_API_KEY) {
    const error = new Error('Telnyx API key is not configured.');
    error.status = 500;
    throw error;
  }

  if (useNumberPool && !TELNYX_MESSAGING_PROFILE_ID) {
    const error = new Error(
      'Configure TELNYX_MESSAGING_PROFILE_ID when TELNYX_USE_NUMBER_POOL=true.',
    );
    error.status = 500;
    throw error;
  }

  if (!useNumberPool && !TELNYX_FROM_NUMBER) {
    const error = new Error('Configure TELNYX_FROM_NUMBER.');
    error.status = 500;
    throw error;
  }

  return {
    apiKey: TELNYX_API_KEY,
    fromNumber: TELNYX_FROM_NUMBER || null,
    messagingProfileId: TELNYX_MESSAGING_PROFILE_ID || null,
    useNumberPool,
  };
}

async function sendSms({ to, body }) {
  const { apiKey, fromNumber, messagingProfileId, useNumberPool } = getTelnyxConfig();

  const payload = {
    to,
    text: body,
  };

  if (useNumberPool) {
    payload.messaging_profile_id = messagingProfileId;
  } else {
    payload.from = fromNumber;
    if (messagingProfileId) {
      payload.messaging_profile_id = messagingProfileId;
    }
  }

  const response = await fetch(TELNYX_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_) {
    parsed = null;
  }

  if (!response.ok) {
    console.error('[Telnyx] SMS request failed', {
      status: response.status,
      body: raw,
    });
    const message =
      parsed?.errors?.[0]?.detail ||
      parsed?.errors?.[0]?.title ||
      parsed?.message ||
      `Telnyx SMS failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.provider = 'telnyx';
    error.providerCode = parsed?.errors?.[0]?.code || null;
    throw error;
  }

  return parsed?.data || { success: true };
}

module.exports = {
  sendSms,
};
