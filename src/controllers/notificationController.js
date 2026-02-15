const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { getFirebaseMessaging } = require('../services/firebaseAdmin');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'android' || platform === 'ios' || platform === 'web') {
    return platform;
  }
  return 'unknown';
}

function toStringRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });
  return out;
}

function normalizeTokenArray(tokens) {
  if (!Array.isArray(tokens)) return [];
  const unique = new Set();
  tokens.forEach((item) => {
    const token = String(item || '').trim();
    if (token) unique.add(token);
  });
  return Array.from(unique);
}

async function getTokensForUser(userId) {
  const user = await User.findById(userId).select('pushTokens').lean();
  if (!user) return [];
  const list = Array.isArray(user.pushTokens) ? user.pushTokens : [];
  return list.map((item) => String(item?.token || '').trim()).filter(Boolean);
}

async function registerPushToken(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError) return;

  const userId = req.user.id;
  const token = String(req.body?.token || '').trim();
  const platform = normalizePlatform(req.body?.platform);
  const deviceId = req.body?.deviceId ? String(req.body.deviceId).trim() : '';
  const appVersion = req.body?.appVersion
    ? String(req.body.appVersion).trim()
    : '';

  if (!token) {
    return res.status(400).json({ error: 'token is required.' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (!Array.isArray(user.pushTokens)) {
    user.pushTokens = [];
  }

  const now = new Date();
  const existingIndex = user.pushTokens.findIndex((item) => item.token === token);
  if (existingIndex >= 0) {
    user.pushTokens[existingIndex].platform = platform;
    user.pushTokens[existingIndex].deviceId =
      deviceId || user.pushTokens[existingIndex].deviceId;
    user.pushTokens[existingIndex].appVersion =
      appVersion || user.pushTokens[existingIndex].appVersion;
    user.pushTokens[existingIndex].updatedAt = now;
  } else {
    user.pushTokens.push({
      token,
      platform,
      deviceId: deviceId || undefined,
      appVersion: appVersion || undefined,
      updatedAt: now,
    });
  }

  await user.save();

  return res.status(200).json({
    registered: true,
    totalTokens: user.pushTokens.length,
  });
}

async function unregisterPushToken(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError) return;

  const userId = req.user.id;
  const token = String(req.body?.token || '').trim();

  if (!token) {
    return res.status(400).json({ error: 'token is required.' });
  }

  const update = await User.updateOne(
    { _id: userId },
    { $pull: { pushTokens: { token } } },
  );

  return res.status(200).json({
    removed: true,
    modifiedCount: update.modifiedCount || 0,
  });
}

async function listMyPushTokens(req, res) {
  const user = await User.findById(req.user.id).select('pushTokens').lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  return res.status(200).json({ tokens: user.pushTokens || [] });
}

async function sendPushNotification(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError) return;

  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const directToken = String(req.body?.token || '').trim();
  const directTokens = normalizeTokenArray(req.body?.tokens);
  const targetUserId = req.body?.userId ? String(req.body.userId).trim() : '';
  const dataPayload = toStringRecord(req.body?.data);
  const screen = req.body?.screen ? String(req.body.screen).trim() : '';

  if (!title && !body) {
    return res.status(400).json({ error: 'title or body is required.' });
  }

  let tokens = [];
  if (directToken) tokens.push(directToken);
  if (directTokens.length) tokens = tokens.concat(directTokens);

  if (!tokens.length) {
    const resolvedUserId = targetUserId || req.user.id;
    if (!mongoose.isValidObjectId(resolvedUserId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    tokens = await getTokensForUser(resolvedUserId);
  }

  tokens = Array.from(
    new Set(tokens.map((item) => String(item || '').trim()).filter(Boolean)),
  );
  if (!tokens.length) {
    return res.status(404).json({ error: 'No push token found for target.' });
  }

  const payloadData = {
    ...dataPayload,
    ...(screen ? { screen } : {}),
  };

  let messaging;
  try {
    messaging = getFirebaseMessaging();
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Firebase messaging is not configured.',
    });
  }

  const invalidTokenCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ]);
  const invalidTokens = [];
  const chunkSize = 500;
  let successCount = 0;
  let failureCount = 0;
  const failures = [];

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const slice = tokens.slice(i, i + chunkSize);
    const result = await messaging.sendEachForMulticast({
      tokens: slice,
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
      const message = entry.error?.message || 'Failed to send';
      const token = slice[index];
      failures.push({ token, code, message });
      if (invalidTokenCodes.has(code)) {
        invalidTokens.push(token);
      }
    });
  }

  if (invalidTokens.length) {
    await User.updateMany(
      { 'pushTokens.token': { $in: invalidTokens } },
      { $pull: { pushTokens: { token: { $in: invalidTokens } } } },
    );
  }

  return res.status(200).json({
    sent: true,
    total: tokens.length,
    successCount,
    failureCount,
    cleanedInvalidTokens: invalidTokens.length,
    failures,
  });
}

module.exports = {
  registerPushToken,
  unregisterPushToken,
  listMyPushTokens,
  sendPushNotification,
};
