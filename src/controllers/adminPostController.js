const mongoose = require('mongoose');

const Post = require('../models/Post');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

function buildUblastBlockedStatus(user) {
  if (!user) return false;
  const blockedUntil = user.ublastBlockedUntil;
  if (user.ublastManualBlocked) return true;
  if (!blockedUntil) return false;
  return new Date(blockedUntil).getTime() > Date.now();
}

async function listUserPosts(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const match = {
    $or: [{ ublastId: null }, { ublastId: { $exists: false } }],
  };

  const [totalCount, posts] = await Promise.all([
    Post.countDocuments(match),
    Post.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
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
        $lookup: {
          from: 'profiles',
          localField: 'userId',
          foreignField: 'userId',
          as: 'profile',
        },
      },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
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
          likeCount: { $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0] },
          commentCount: {
            $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0],
          },
          ublastBlocked: {
            $or: [
              { $eq: ['$user.ublastManualBlocked', true] },
              {
                $and: [
                  { $ne: ['$user.ublastBlockedUntil', null] },
                  { $gt: ['$user.ublastBlockedUntil', '$$NOW'] },
                ],
              },
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          description: 1,
          mediaType: 1,
          mediaUrl: 1,
          shareTargets: 1,
          shareToFacebook: 1,
          shareToInstagram: 1,
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          createdAt: 1,
          status: 1,
          user: {
            _id: '$user._id',
            name: '$user.name',
            ublastManualBlocked: '$user.ublastManualBlocked',
            ublastBlockedUntil: '$user.ublastBlockedUntil',
            isBlocked: '$user.isBlocked',
            isBanned: '$user.isBanned',
          },
          ublastBlocked: 1,
          profile: {
            displayName: '$profile.displayName',
            username: '$profile.username',
            profileImageUrl: '$profile.profileImageUrl',
          },
        },
      },
    ]),
  ]);

  const mapped = posts.map((post) => {
    const platforms = new Set(post.shareTargets || []);
    if (post.shareToFacebook) platforms.add('facebook');
    if (post.shareToInstagram) platforms.add('instagram');
    const userName =
      post.profile?.displayName || post.profile?.username || post.user?.name || 'Unknown';
    const ublastBlocked =
      typeof post.ublastBlocked === 'boolean'
        ? post.ublastBlocked
        : buildUblastBlockedStatus(post.user);

    return {
      id: post._id,
      userId: post.userId,
      user: {
        id: post.user?._id,
        name: userName,
        avatar: post.profile?.profileImageUrl || '',
      },
      content: post.description || '',
      mediaType: post.mediaType,
      platforms: Array.from(platforms),
      stats: {
        views: post.viewCount || 0,
        likes: post.likeCount || 0,
        comments: post.commentCount || 0,
      },
      status: ublastBlocked ? 'Blocked' : 'Active',
      ublastBlocked,
      ublastBlockedUntil: post.user?.ublastBlockedUntil || null,
      createdAt: post.createdAt,
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    posts: mapped,
    page,
    totalPages,
    totalCount,
  });
}

module.exports = {
  listUserPosts,
};
