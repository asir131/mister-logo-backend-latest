const mongoose = require('mongoose');

const Post = require('../models/Post');
const UBlast = require('../models/UBlast');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function getFeed(req, res) {
  const viewerId = new mongoose.Types.ObjectId(req.user.id);
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 5, 20);
  const skip = (page - 1) * limit;
  const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);

  const visibilityMatch = {
    $and: [
      { $or: [{ status: 'published' }, { status: { $exists: false } }] },
      { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
      { postType: { $ne: 'uclip' } },
    ],
  };

  const [totalCount, posts] = await Promise.all([
    Post.countDocuments(visibilityMatch),
    Post.aggregate([
      { $match: visibilityMatch },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
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
        $lookup: {
          from: 'posts',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$sharedFromPostId', '$$postId'] } } },
            { $count: 'count' },
          ],
          as: 'shareCounts',
        },
      },
      {
        $lookup: {
          from: 'likes',
          let: { postId: '$_id', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$postId', '$$postId'] },
                    { $eq: ['$userId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerLike',
        },
      },
      {
        $lookup: {
          from: 'follows',
          let: { authorId: '$userId', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$followingId', '$$authorId'] },
                    { $eq: ['$followerId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerFollow',
        },
      },
      {
        $lookup: {
          from: 'savedposts',
          let: { postId: '$_id', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$postId', '$$postId'] },
                    { $eq: ['$userId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerSaved',
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
          shareCount: {
            $ifNull: [{ $arrayElemAt: ['$shareCounts.count', 0] }, 0],
          },
          viewerHasLiked: { $gt: [{ $size: '$viewerLike' }, 0] },
          viewerIsFollowing: {
            $cond: [
              { $eq: ['$userId', viewerId] },
              false,
              { $gt: [{ $size: '$viewerFollow' }, 0] },
            ],
          },
          viewerHasSaved: { $gt: [{ $size: '$viewerSaved' }, 0] },
        },
      },
      {
        $project: {
          description: 1,
          mediaType: 1,
          mediaUrl: 1,
          mediaPreviewUrl: 1,
          ublastId: 1,
          createdAt: 1,
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          shareCount: 1,
          viewerHasLiked: 1,
          viewerIsFollowing: 1,
          viewerHasSaved: 1,
          author: {
            id: '$author._id',
            name: '$author.name',
            email: '$author.email',
          },
          profile: {
            username: '$profile.username',
            displayName: '$profile.displayName',
            role: '$profile.role',
            profileImageUrl: '$profile.profileImageUrl',
          },
        },
      },
    ]),
  ]);

  const ublastIds = [
    ...new Set(
      posts
        .map((post) => post?.ublastId)
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ];

  let postsWithDueAt = posts;
  if (ublastIds.length > 0) {
    const ublasts = await UBlast.find({ _id: { $in: ublastIds } })
      .select('_id releasedAt createdAt')
      .lean();
    const byId = new Map(ublasts.map((u) => [String(u._id), u]));

    postsWithDueAt = posts.map((post) => {
      const ublastId = post?.ublastId ? String(post.ublastId) : null;
      if (!ublastId) return post;

      const ublast = byId.get(ublastId);
      if (!ublast) return post;

      const releasedAt = ublast.releasedAt || ublast.createdAt;
      if (!releasedAt) return post;

      return {
        ...post,
        dueAt: new Date(
          new Date(releasedAt).getTime() + shareWindowHours * 60 * 60 * 1000,
        ),
      };
    });
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    posts: postsWithDueAt,
    page,
    totalPages,
    totalCount,
  });
}

module.exports = {
  getFeed,
};
