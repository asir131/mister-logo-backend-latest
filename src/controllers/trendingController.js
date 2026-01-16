const mongoose = require('mongoose');

const UBlast = require('../models/UBlast');
const TrendingPlacement = require('../models/TrendingPlacement');
const Post = require('../models/Post');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function getTrending(req, res) {
  const now = new Date();
  const limitTop = parsePaging(req.query.topLimit, 16, 16);
  const limitManual = parsePaging(req.query.manualLimit, 16, 16);
  const limitOrganic = parsePaging(req.query.organicLimit, 64, 100);

  const activeUblasts = await UBlast.find({
    status: 'released',
    releasedAt: { $lte: now },
    expiresAt: { $gt: now },
  })
    .sort({ releasedAt: -1 })
    .limit(limitTop)
    .lean();

  const activeUblastIds = activeUblasts.map((ublast) => ublast._id);
  const visibilityMatch = {
    $and: [
      {
        $or: [{ status: 'published' }, { status: { $exists: false } }],
      },
      {
        $or: [{ isApproved: true }, { isApproved: { $exists: false } }],
      },
    ],
  };

  const topPosts = activeUblastIds.length
    ? await Post.find({
        ublastId: { $in: activeUblastIds },
        ...visibilityMatch,
      })
        .sort({ createdAt: -1 })
        .limit(limitTop)
        .lean()
    : [];

  const manualPlacements = await TrendingPlacement.find({
    section: 'manual',
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  })
    .sort({ position: 1, createdAt: -1 })
    .limit(limitManual)
    .lean();

  const manualPostIds = manualPlacements.map((placement) => placement.postId);
  const manualPosts = manualPostIds.length
    ? await Post.find({
        _id: { $in: manualPostIds },
        ...visibilityMatch,
      }).lean()
    : [];

  const manualById = new Map(
    manualPosts.map((post) => [post._id.toString(), post]),
  );

  const manual = manualPlacements
    .map((placement) => ({
      placementId: placement._id,
      position: placement.position,
      post: manualById.get(placement.postId.toString()) || null,
    }))
    .filter((entry) => entry.post);

  const excludedIds = new Set([
    ...manualPostIds.map((id) => id.toString()),
    ...topPosts.map((post) => post._id.toString()),
  ]);

  const organicMatch = {
    $and: [
      { $or: [{ status: 'published' }, { status: { $exists: false } }] },
      { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
    ],
    $or: [{ ublastId: null }, { ublastId: { $exists: false } }],
    ...(excludedIds.size
      ? { _id: { $nin: Array.from(excludedIds, (id) => new mongoose.Types.ObjectId(id)) } }
      : {}),
  };

  const organic = await Post.aggregate([
    { $match: organicMatch },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'author',
      },
    },
    { $unwind: '$author' },
    {
      $match: {
        'author.isBlocked': { $ne: true },
        'author.isBanned': { $ne: true },
      },
    },
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
      $lookup: {
        from: 'savedposts',
        let: { postId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
          { $count: 'count' },
        ],
        as: 'savedCounts',
      },
    },
    {
      $addFields: {
        likeCount: { $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0] },
        commentCount: { $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0] },
        saveCount: { $ifNull: [{ $arrayElemAt: ['$savedCounts.count', 0] }, 0] },
      },
    },
    {
      $addFields: {
        ageHours: {
          $divide: [{ $subtract: [now, '$createdAt'] }, 1000 * 60 * 60],
        },
        engagementScore: {
          $divide: [
            {
              $add: [
                { $multiply: ['$likeCount', 3] },
                { $multiply: ['$commentCount', 2] },
                { $multiply: ['$saveCount', 4] },
              ],
            },
            { $pow: [{ $add: ['$ageHours', 2] }, 1.5] },
          ],
        },
      },
    },
    { $sort: { engagementScore: -1, createdAt: -1 } },
    { $limit: limitOrganic },
    {
      $project: {
        description: 1,
        mediaType: 1,
        mediaUrl: 1,
        createdAt: 1,
        userId: 1,
        engagementScore: 1,
        likeCount: 1,
        commentCount: 1,
        saveCount: 1,
      },
    },
  ]);

  const items = [
    ...topPosts.map((post) => ({ type: 'ublast', post })),
    ...manual.map((entry) => ({ type: 'manual', post: entry.post, position: entry.position })),
    ...organic.map((post) => ({ type: 'organic', post })),
  ];

  return res.status(200).json({
    top: topPosts,
    manual,
    organic,
    items,
  });
}

module.exports = { getTrending };
