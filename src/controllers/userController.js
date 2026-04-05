const mongoose = require('mongoose');

const User = require('../models/User');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Follow = require('../models/Follow');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  const dayDiff = today.getDate() - dob.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

async function getSuggestedArtists(req, res) {
  const viewerId = req.user.id;
  const limit = parsePaging(req.query.limit, 10, 30);
  const viewerProfile = await Profile.findOne({ userId: viewerId })
    .select('role')
    .lean();
  const viewerRole = String(viewerProfile?.role || '')
    .trim()
    .toLowerCase();

  const following = await Follow.find({ followerId: viewerId })
    .select('followingId')
    .lean();

  const excludedIds = [
    new mongoose.Types.ObjectId(viewerId),
    ...following
      .map((row) => row?.followingId)
      .filter(Boolean)
      .map((id) =>
        id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id),
      ),
  ];

  const artists = await Profile.aggregate([
    {
      $match: {
        userId: { $nin: excludedIds },
        ...(viewerRole
          ? { role: new RegExp(`^${escapeRegex(viewerRole)}$`, 'i') }
          : {}),
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $match: {
        'user.isBlocked': { $ne: true },
        'user.isBanned': { $ne: true },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$userId',
        name: {
          $ifNull: ['$displayName', '$user.name'],
        },
        role: '$role',
        username: '$username',
        profileImageUrl: '$profileImageUrl',
        followersCount: { $ifNull: ['$followersCount', 0] },
        postsCount: { $ifNull: ['$postsCount', 0] },
      },
    },
    {
      $sort: {
        followersCount: -1,
        postsCount: -1,
        id: 1,
      },
    },
    { $limit: limit },
  ]);

  return res.status(200).json({
    artists,
    totalCount: artists.length,
  });
}

async function getUserOverview(req, res) {
  const { userId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const user = await User.findById(userId).lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const profile = await Profile.findOne({ userId }).lean();

  let followersCount = profile?.followersCount;
  let followingCount = profile?.followingCount;
  let postsCount = profile?.postsCount;
  let counts = {
    image: profile?.imageCount ?? 0,
    video: profile?.videoCount ?? 0,
    audio: profile?.audioCount ?? 0,
  };

  if (
    followersCount === undefined ||
    followingCount === undefined ||
    postsCount === undefined
  ) {
    const visibilityMatch = {
      $and: [
        { $or: [{ status: 'published' }, { status: { $exists: false } }] },
        { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
      ],
    };

    const [followers, following, posts, mediaCounts] = await Promise.all([
      Follow.countDocuments({ followingId: userId }),
      Follow.countDocuments({ followerId: userId }),
      Post.countDocuments({ userId, ...visibilityMatch }),
      Post.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), ...visibilityMatch } },
        { $group: { _id: '$mediaType', count: { $sum: 1 } } },
      ]),
    ]);

    followersCount = followers;
    followingCount = following;
    postsCount = posts;
    counts = { image: 0, video: 0, audio: 0 };
    mediaCounts.forEach((entry) => {
      if (entry._id && counts[entry._id] !== undefined) {
        counts[entry._id] = entry.count;
      }
    });
  }

  const viewerIsFollowing =
    req.user.id !== userId &&
    (await Follow.exists({
      followerId: req.user.id,
      followingId: userId,
    }));

  const safeProfile = profile
    ? (() => {
        const { dateOfBirth, ...restProfile } = profile;
        return {
          ...restProfile,
          age: calculateAge(dateOfBirth),
        };
      })()
    : null;

  return res.status(200).json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
    },
    profile: safeProfile,
    stats: {
      postsCount,
      followersCount,
      followingCount,
    },
    mediaCounts: counts,
    viewerIsFollowing: Boolean(viewerIsFollowing),
  });
}

async function getUserPosts(req, res) {
  const { userId } = req.params;
  const { mediaType } = req.query;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const normalizedMediaType =
    typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : '';

  if (
    normalizedMediaType &&
    !['image', 'video', 'audio'].includes(normalizedMediaType)
  ) {
    return res
      .status(400)
      .json({ error: 'mediaType must be image, video, or audio.' });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 6, 24);
  const skip = (page - 1) * limit;

  const match = {
    userId: new mongoose.Types.ObjectId(userId),
    $and: [
      { $or: [{ status: 'published' }, { status: { $exists: false } }] },
      { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
    ],
  };
  if (normalizedMediaType) {
    match.mediaType = normalizedMediaType;
  }

  const [totalCount, posts] = await Promise.all([
    Post.countDocuments(match),
    Post.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'likes',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
            { $count: 'count' },
          ],
          as: 'likeCounts',
        },
      },
      {
        $lookup: {
          from: 'comments',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
            { $count: 'count' },
          ],
          as: 'commentCounts',
        },
      },
      {
        $addFields: {
          likeCount: {
            $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0],
          },
          commentCount: {
            $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0],
          },
        },
      },
      {
        $project: {
          description: 1,
          mediaType: 1,
          mediaUrl: 1,
          createdAt: 1,
          likeCount: 1,
          commentCount: 1,
        },
      },
    ]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    posts,
    page,
    totalPages,
    totalCount,
    mediaType: normalizedMediaType || null,
  });
}

async function searchUsers(req, res) {
  const searchText =
    typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = parsePaging(req.query.limit, 8, 20);

  if (!searchText) {
    return res.status(200).json({ users: [] });
  }

  const searchRegex = new RegExp(escapeRegex(searchText), 'i');

  const users = await User.aggregate([
    {
      $match: {
        isBlocked: { $ne: true },
        isBanned: { $ne: true },
      },
    },
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
      $addFields: {
        displayName: {
          $ifNull: ['$profile.displayName', '$name'],
        },
        username: '$profile.username',
        profileImageUrl: '$profile.profileImageUrl',
      },
    },
    {
      $match: {
        $or: [
          { name: searchRegex },
          { displayName: searchRegex },
          { username: searchRegex },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: '$displayName',
        username: 1,
        profileImageUrl: 1,
      },
    },
    { $sort: { name: 1, username: 1 } },
    { $limit: limit },
  ]);

  return res.status(200).json({ users });
}

module.exports = {
  getSuggestedArtists,
  getUserOverview,
  getUserPosts,
  searchUsers,
};
