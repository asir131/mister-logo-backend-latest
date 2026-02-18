const Notification = require('../models/Notification');
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

  saveNotifications({
    userIds: recipients,
    title,
    body,
    type,
    data,
    screen,
  })
    .then((notifications) => {
      emitNotifications(io, notifications);
    })
    .catch((err) => {
      console.error('Save notification failed:', err?.message || err);
    });

  const pushRecipients = recipients.filter((id) => !skipPushSet.has(id));
  if (!pushRecipients.length) return;

  fireAndForgetPush({
    userIds: pushRecipients,
    title,
    body,
    data: {
      ...toObjectData(data),
      type: String(type || data?.type || 'system'),
    },
    screen,
  });
}

module.exports = {
  saveNotifications,
  emitNotifications,
  fireAndForgetNotifyAndPush,
};
