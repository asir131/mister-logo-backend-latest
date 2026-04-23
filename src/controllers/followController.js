const mongoose = require('mongoose');

const Follow = require('../models/Follow');
const User = require('../models/User');
const Profile = require('../models/Profile');
const { fireAndForgetNotifyAndPush } = require('../services/notifyAndPush');

async function resolveDisplayName(userId) {
  const [user, profile] = await Promise.all([
    User.findById(userId).select('name').lean(),
    Profile.findOne({ userId }).select('displayName username').lean(),
  ]);
  return profile?.displayName || profile?.username || user?.name || 'Someone';
}

async function followUser(req, res) {
  const followerId = req.user.id;
  const { userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (followerId === userId) {
    return res.status(400).json({ error: 'You cannot follow yourself.' });
  }

  const targetExists = await User.exists({ _id: userId });
  if (!targetExists) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const existing = await Follow.findOne({ followerId, followingId: userId });
  if (existing) {
    return res.status(200).json({ following: true });
  }

  await Follow.create({ followerId, followingId: userId });

  await Promise.all([
    Profile.updateOne(
      { userId },
      {
        $addToSet: { followers: { userId: followerId, followedAt: new Date() } },
        $inc: { followersCount: 1 },
      },
    ),
    Profile.updateOne(
      { userId: followerId },
      {
        $addToSet: { following: { userId, followedAt: new Date() } },
        $inc: { followingCount: 1 },
      },
    ),
  ]);

  const actorName = await resolveDisplayName(followerId);
  fireAndForgetNotifyAndPush({
    io: req.app.get('io'),
    userIds: [userId],
    title: 'New follower',
    body: `${actorName} started following you.`,
    type: 'follow',
    data: {
      actorUserId: followerId,
    },
    screen: '/screens/home/notification',
  });

  return res.status(200).json({ following: true });
}

async function unfollowUser(req, res) {
  const followerId = req.user.id;
  const { userId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const result = await Follow.deleteOne({ followerId, followingId: userId });

  if (result.deletedCount > 0) {
    await Promise.all([
      Profile.updateOne(
        { userId },
        {
          $pull: { followers: { userId: followerId } },
          $inc: { followersCount: -1 },
        },
      ),
      Profile.updateOne(
        { userId: followerId },
        {
          $pull: { following: { userId } },
          $inc: { followingCount: -1 },
        },
      ),
    ]);
  }

  return res.status(200).json({ following: false });
}

async function listFollowers(req, res) {
  const { userId } = req.params;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const [rows, total] = await Promise.all([
    Follow.find({ followingId: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Follow.countDocuments({ followingId: userId }),
  ]);

  const ids = rows.map((row) => String(row.followerId || '')).filter(Boolean);
  const profiles = await Profile.find({ userId: { $in: ids } })
    .select('userId displayName username role profileImageUrl followersCount')
    .lean();
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();

  const profileMap = new Map(
    profiles.map((profile) => [String(profile.userId), profile])
  );
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  const items = ids.map((id) => {
    const profile = profileMap.get(id);
    const user = userMap.get(id);
    return {
      id,
      name: profile?.displayName || profile?.username || user?.name || 'User',
      username: profile?.username || '',
      role: profile?.role || '',
      profileImageUrl: profile?.profileImageUrl || '',
      followersCount: Number(profile?.followersCount || 0),
    };
  });

  return res.status(200).json({
    users: items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  });
}

async function listFollowing(req, res) {
  const { userId } = req.params;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const [rows, total] = await Promise.all([
    Follow.find({ followerId: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Follow.countDocuments({ followerId: userId }),
  ]);

  const ids = rows.map((row) => String(row.followingId || '')).filter(Boolean);
  const profiles = await Profile.find({ userId: { $in: ids } })
    .select('userId displayName username role profileImageUrl followersCount')
    .lean();
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();

  const profileMap = new Map(
    profiles.map((profile) => [String(profile.userId), profile])
  );
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  const items = ids.map((id) => {
    const profile = profileMap.get(id);
    const user = userMap.get(id);
    return {
      id,
      name: profile?.displayName || profile?.username || user?.name || 'User',
      username: profile?.username || '',
      role: profile?.role || '',
      profileImageUrl: profile?.profileImageUrl || '',
      followersCount: Number(profile?.followersCount || 0),
    };
  });

  return res.status(200).json({
    users: items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  });
}

module.exports = {
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
};
