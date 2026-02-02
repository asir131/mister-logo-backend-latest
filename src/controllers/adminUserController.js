const mongoose = require('mongoose');

const User = require('../models/User');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

function isBlockedUntil(dateValue) {
  if (!dateValue) return false;
  return new Date(dateValue).getTime() > Date.now();
}

function buildStatus(user) {
  const blockedUntil = user?.ublastBlockedUntil;
  if (user?.ublastManualBlocked) return 'Blocked';
  if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) return 'Blocked';
  return 'Active';
}

async function listUsers(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, users] = await Promise.all([
    User.countDocuments(),
    User.aggregate([
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'profiles',
          localField: '_id',
          foreignField: 'userId',
          as: 'profile',
        },
      },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phoneNumber: 1,
          isBlocked: 1,
          isBanned: 1,
          ublastManualBlocked: 1,
          ublastBlockedUntil: 1,
          createdAt: 1,
          updatedAt: 1,
          'profile.username': 1,
          'profile.displayName': 1,
          'profile.profileImageUrl': 1,
          'profile.followersCount': 1,
          'profile.postsCount': 1,
        },
      },
    ]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const mapped = users.map((user) => ({
    id: user._id,
    name: user.profile?.displayName || user.name,
    username: user.profile?.username || '',
    email: user.email,
    phone: user.phoneNumber || '',
    avatar: user.profile?.profileImageUrl || '',
    followers: user.profile?.followersCount || 0,
    totalPosts: user.profile?.postsCount || 0,
    status: buildStatus(user),
    ublastBlocked: Boolean(user.ublastManualBlocked || isBlockedUntil(user.ublastBlockedUntil)),
    ublastBlockedUntil: user.ublastBlockedUntil || null,
    lastActivity: user.updatedAt,
    joinedDate: user.createdAt,
  }));

  return res.status(200).json({
    users: mapped,
    page,
    totalPages,
    totalCount,
  });
}

async function restrictUser(req, res) {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { ublastManualBlocked: true } },
    { new: true },
  );
  if (!updated) {
    return res.status(404).json({ error: 'User not found.' });
  }
  return res.status(200).json({
    userId,
    status: buildStatus(updated),
    ublastBlocked: true,
    ublastBlockedUntil: updated.ublastBlockedUntil || null,
  });
}

async function unrestrictUser(req, res) {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { ublastManualBlocked: false }, $unset: { ublastBlockedUntil: '' } },
    { new: true },
  );
  if (!updated) {
    return res.status(404).json({ error: 'User not found.' });
  }
  return res.status(200).json({
    userId,
    status: buildStatus(updated),
    ublastBlocked: Boolean(isBlockedUntil(updated.ublastBlockedUntil)),
    ublastBlockedUntil: updated.ublastBlockedUntil || null,
  });
}

module.exports = {
  listUsers,
  restrictUser,
  unrestrictUser,
};
