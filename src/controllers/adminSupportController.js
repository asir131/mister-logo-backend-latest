const mongoose = require('mongoose');

const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const Profile = require('../models/Profile');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

async function listThreads(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, threads] = await Promise.all([
    SupportThread.countDocuments({}),
    SupportThread.find({})
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const userIds = threads.map((thread) => thread.userId);
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select(
        'name email phoneNumber connectedPlatforms connectedAccounts ublastManualBlocked ublastBlockedUntil',
      )
      .lean(),
    Profile.find({ userId: { $in: userIds } })
      .select('userId displayName username profileImageUrl followersCount postsCount')
      .lean(),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const profileById = new Map(
    profiles.map((profile) => [profile.userId.toString(), profile]),
  );

  const mapped = threads.map((thread) => {
    const user = userById.get(thread.userId.toString());
    const profile = profileById.get(thread.userId.toString());
    const blocked =
      user?.ublastManualBlocked ||
      (user?.ublastBlockedUntil && new Date(user.ublastBlockedUntil).getTime() > Date.now());
    return {
      id: thread._id,
      userId: thread.userId,
      status: thread.status,
      lastMessageAt: thread.lastMessageAt,
      lastSubject: thread.lastSubject || '',
      user: {
        id: user?._id,
        name: profile?.displayName || user?.name || 'User',
        username: profile?.username || '',
        email: user?.email || '',
        phone: user?.phoneNumber || '',
        avatar: profile?.profileImageUrl || '',
        linkedPlatforms: user?.connectedPlatforms || [],
        linkedAccounts: user?.connectedAccounts || [],
        totalPosts: profile?.postsCount || 0,
        followers: profile?.followersCount || 0,
        ublastBlocked: Boolean(blocked),
      },
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    threads: mapped,
    page,
    totalPages,
    totalCount,
  });
}

async function listMessages(req, res) {
  const { threadId } = req.params;
  if (!mongoose.isValidObjectId(threadId)) {
    return res.status(400).json({ error: 'Invalid thread id.' });
  }
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 50, 200);
  const skip = (page - 1) * limit;

  const [totalCount, messages] = await Promise.all([
    SupportMessage.countDocuments({ threadId }),
    SupportMessage.find({ threadId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    messages,
    page,
    totalPages,
    totalCount,
  });
}

async function updateThreadStatus(req, res) {
  const { threadId } = req.params;
  const status = String(req.body?.status || '').toLowerCase();
  if (!mongoose.isValidObjectId(threadId)) {
    return res.status(400).json({ error: 'Invalid thread id.' });
  }
  if (!['pending', 'solved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const updated = await SupportThread.findByIdAndUpdate(
    threadId,
    { $set: { status } },
    { new: true },
  ).lean();
  if (!updated) {
    return res.status(404).json({ error: 'Thread not found.' });
  }
  return res.status(200).json({ status: updated.status });
}

module.exports = {
  listThreads,
  listMessages,
  updateThreadStatus,
};
