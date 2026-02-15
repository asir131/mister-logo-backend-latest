const User = require('../models/User');
const { getFirebaseMessaging } = require('./firebaseAdmin');

function normalizeUserIds(userIds) {
  if (!Array.isArray(userIds)) return [];
  return Array.from(
    new Set(
      userIds
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  );
}

function toStringData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });
  return out;
}

async function getTokensByUsers(userIds) {
  if (!userIds.length) return [];
  const users = await User.find({ _id: { $in: userIds } })
    .select('pushTokens')
    .lean();

  const tokenSet = new Set();
  users.forEach((user) => {
    const tokens = Array.isArray(user?.pushTokens) ? user.pushTokens : [];
    tokens.forEach((entry) => {
      const token = String(entry?.token || '').trim();
      if (token) tokenSet.add(token);
    });
  });

  return Array.from(tokenSet);
}

async function cleanInvalidTokens(invalidTokens) {
  if (!invalidTokens.length) return;
  await User.updateMany(
    { 'pushTokens.token': { $in: invalidTokens } },
    { $pull: { pushTokens: { token: { $in: invalidTokens } } } },
  );
}

async function sendPushToUsers({
  userIds = [],
  title = '',
  body = '',
  data = {},
  screen = '/screens/home/notification',
}) {
  const recipients = normalizeUserIds(userIds);
  if (!recipients.length) {
    return { sent: false, reason: 'no_recipients' };
  }

  const tokens = await getTokensByUsers(recipients);
  if (!tokens.length) {
    return { sent: false, reason: 'no_tokens' };
  }

  let messaging;
  try {
    messaging = getFirebaseMessaging();
  } catch (err) {
    return { sent: false, reason: 'firebase_unavailable', error: err.message };
  }

  const invalidTokenCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ]);
  const invalidTokens = [];

  const payloadData = {
    ...toStringData(data),
    ...(screen ? { screen: String(screen) } : {}),
  };

  const chunkSize = 500;
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const result = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title: title || undefined,
        body: body || undefined,
      },
      data: payloadData,
      android: { priority: 'high' },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    });

    successCount += result.successCount || 0;
    failureCount += result.failureCount || 0;

    (result.responses || []).forEach((entry, index) => {
      if (entry.success) return;
      const code = entry.error?.code || 'unknown';
      if (invalidTokenCodes.has(code)) {
        invalidTokens.push(chunk[index]);
      }
    });
  }

  if (invalidTokens.length) {
    await cleanInvalidTokens(Array.from(new Set(invalidTokens)));
  }

  return {
    sent: successCount > 0,
    total: tokens.length,
    successCount,
    failureCount,
  };
}

function fireAndForgetPush(payload) {
  sendPushToUsers(payload).catch((err) => {
    // Notification delivery should never break the primary API flow.
    console.error('Push notification send failed:', err?.message || err);
  });
}

module.exports = {
  sendPushToUsers,
  fireAndForgetPush,
};
