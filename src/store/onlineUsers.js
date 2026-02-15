const socketsByUserId = new Map();

function ensureUserSet(userId) {
  const key = String(userId);
  const existing = socketsByUserId.get(key);
  if (existing) return existing;
  const created = new Set();
  socketsByUserId.set(key, created);
  return created;
}

function addOnlineUser(userId, socketId) {
  if (!userId) return false;
  const key = String(userId);
  const set = ensureUserSet(key);
  const wasOnline = set.size > 0;

  if (socketId) {
    set.add(String(socketId));
  } else {
    set.add(`unknown:${Date.now()}`);
  }

  return !wasOnline && set.size > 0;
}

function removeOnlineUser(userId, socketId) {
  if (!userId) return false;
  const key = String(userId);
  const set = socketsByUserId.get(key);
  if (!set) return false;

  const wasOnline = set.size > 0;

  if (socketId) {
    set.delete(String(socketId));
  } else {
    set.clear();
  }

  if (set.size === 0) {
    socketsByUserId.delete(key);
  }

  return wasOnline && !socketsByUserId.has(key);
}

function isUserOnline(userId) {
  if (!userId) return false;
  const set = socketsByUserId.get(String(userId));
  return Boolean(set && set.size > 0);
}

function getOnlineUserIds() {
  return new Set(Array.from(socketsByUserId.keys()));
}

module.exports = {
  addOnlineUser,
  removeOnlineUser,
  isUserOnline,
  getOnlineUserIds,
};
