const TELNYX_API_URL = 'https://api.telnyx.com/v2/messages';

function getTelnyxConfig() {
  const {
    TELNYX_API_KEY,
    TELNYX_FROM_NUMBER,
    TELNYX_MESSAGING_PROFILE_ID,
  } = process.env;

  if (!TELNYX_API_KEY) {
    const error = new Error('Telnyx API key is not configured.');
    error.status = 500;
    throw error;
  }

  if (!TELNYX_FROM_NUMBER && !TELNYX_MESSAGING_PROFILE_ID) {
    const error = new Error(
      'Configure TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID.',
    );
    error.status = 500;
    throw error;
  }

  return {
    apiKey: TELNYX_API_KEY,
    fromNumber: TELNYX_FROM_NUMBER || null,
    messagingProfileId: TELNYX_MESSAGING_PROFILE_ID || null,
  };
}

async function sendSms({ to, body }) {
  const { apiKey, fromNumber, messagingProfileId } = getTelnyxConfig();

  const payload = {
    to,
    text: body,
  };

  if (fromNumber) {
    payload.from = fromNumber;
  }
  if (!fromNumber && messagingProfileId) {
    payload.messaging_profile_id = messagingProfileId;
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
    const message =
      parsed?.errors?.[0]?.detail ||
      parsed?.errors?.[0]?.title ||
      parsed?.message ||
      `Telnyx SMS failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return parsed?.data || { success: true };
}

module.exports = {
  sendSms,
};
