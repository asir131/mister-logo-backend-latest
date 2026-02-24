const mongoose = require('mongoose');

const Notification = require('../models/Notification');
const Profile = require('../models/Profile');
const { fireAndForgetPush } = require('./pushNotify');

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

function toObjectData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return { ...data };
}

function serializeNotification(doc) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    title: String(doc.title || ''),
    body: String(doc.body || ''),
    type: String(doc.type || 'system'),
    screen: doc.screen ? String(doc.screen) : '',
    data: toObjectData(doc.data),
    read: Boolean(doc.read),
    readAt: doc.readAt || null,
    createdAt: doc.createdAt,
  };
}

function extractActorIds(data) {
  const payload = toObjectData(data);
  const maybeIds = [payload.actorUserId, payload.senderId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(
    new Set(maybeIds.filter((id) => mongoose.isValidObjectId(id))),
  );
}

async function enrichNotificationData(data) {
  const payload = toObjectData(data);

  const existingProfileImageUrl = String(payload.profileImageUrl || '').trim();
  if (existingProfileImageUrl) {
    payload.profileImageUrl = existingProfileImageUrl;
    return payload;
  }

  const actorIds = extractActorIds(payload);
  if (!actorIds.length) return payload;

  const profiles = await Profile.find({ userId: { $in: actorIds } })
    .select('userId profileImageUrl')
    .lean();

  const profileByUserId = new Map(
    profiles.map((profile) => [
      String(profile.userId),
      String(profile.profileImageUrl || '').trim(),
    ]),
  );

  const actorUserId = String(payload.actorUserId || '').trim();
  const senderId = String(payload.senderId || '').trim();

  const resolvedImageUrl =
    (actorUserId ? profileByUserId.get(actorUserId) : '') ||
    (senderId ? profileByUserId.get(senderId) : '') ||
    '';

  if (resolvedImageUrl) {
    payload.profileImageUrl = resolvedImageUrl;
  }

  return payload;
}

async function saveNotifications({
  userIds = [],
  title = '',
  body = '',
  type = 'system',
  screen = '',
  data = {},
}) {
  const recipients = normalizeUserIds(userIds);
  if (!recipients.length) return [];

  const docs = recipients.map((id) => ({
    userId: id,
    title: String(title || ''),
    body: String(body || ''),
    type: String(type || 'system'),
    screen: screen ? String(screen) : '',
    data: toObjectData(data),
    read: false,
    readAt: null,
  }));

  const created = await Notification.insertMany(docs);
  return created.map(serializeNotification);
}

function emitNotifications(io, notifications = []) {
  if (!io || !Array.isArray(notifications) || !notifications.length) return;
  notifications.forEach((item) => {
    io.to(`user:${item.userId}`).emit('notification:new', item);
  });
}

function fireAndForgetNotifyAndPush({
  io,
  userIds = [],
  title = '',
  body = '',
  type = 'system',
  data = {},
  screen = '',
  skipPushUserIds = [],
}) {
  const recipients = normalizeUserIds(userIds);
  if (!recipients.length) return;

  const skipPushSet = new Set(normalizeUserIds(skipPushUserIds));
  const pushRecipients = recipients.filter((id) => !skipPushSet.has(id));

  if (String(type || '').toLowerCase() === 'ublast') {
    console.log('[NotifyAndPush][ublast] enqueue recipients=' + recipients.length);
  }

  Promise.resolve()
    .then(async () => {
      const enrichedData = await enrichNotificationData(data);

      const notifications = await saveNotifications({
        userIds: recipients,
        title,
        body,
        type,
        data: enrichedData,
        screen,
      });

      emitNotifications(io, notifications);

      if (String(type || '').toLowerCase() === 'ublast') {
        console.log(
          '[NotifyAndPush][ublast] saved=' + notifications.length + ' emitted=' + notifications.length,
        );
      }

      if (!pushRecipients.length) return;

      fireAndForgetPush({
        userIds: pushRecipients,
        title,
        body,
        data: {
          ...toObjectData(enrichedData),
          type: String(type || enrichedData?.type || 'system'),
        },
        screen,
      });
    })
    .catch((err) => {
      console.error('Save notification failed:', err?.message || err);
    });
}

module.exports = {
  saveNotifications,
  emitNotifications,
  fireAndForgetNotifyAndPush,
};
