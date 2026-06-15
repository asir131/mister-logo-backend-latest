const mongoose = require('mongoose');

const SavedPost = require('../models/SavedPost');
const Post = require('../models/Post');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function savePost(req, res) {
  const userId = req.user.id;
  const { postId } = req.body;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const postExists = await Post.exists({ _id: postId });
  if (!postExists) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  await SavedPost.findOneAndUpdate(
    { userId, postId },
    { $setOnInsert: { userId, postId } },
    { upsert: true, new: true },
  );

  return res.status(200).json({ saved: true });
}

async function unsavePost(req, res) {
  const userId = req.user.id;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  await SavedPost.deleteOne({ userId, postId });

  return res.status(200).json({ saved: false });
}

async function getSavedPosts(req, res) {
  const viewerId = new mongoose.Types.ObjectId(req.user.id);
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 5, 20);
  const skip = (page - 1) * limit;

  const [result] = await SavedPost.aggregate([
    { $match: { userId: viewerId } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'posts',
        localField: 'postId',
        foreignField: '_id',
        as: 'post',
      },
    },
    { $unwind: '$post' },
    {
      $match: {
        $and: [
          { $or: [{ 'post.status': 'published' }, { 'post.status': { $exists: false } }] },
          { $or: [{ 'post.isApproved': true }, { 'post.isApproved': { $exists: false } }] },
        ],
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'post.userId',
        foreignField: '_id',
        as: 'author',
      },
    },
    { $unwind: '$author' },
    {
      $lookup: {
        from: 'profiles',
        localField: 'post.userId',
        foreignField: 'userId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'likes',
        let: { postId: '$post._id' },
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
        let: { postId: '$post._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
          { $count: 'count' },
        ],
        as: 'commentCounts',
      },
    },
    {
      $lookup: {
        from: 'likes',
        let: { postId: '$post._id', viewerId },
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
        let: { authorId: '$post.userId', viewerId },
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
      $addFields: {
        likeCount: {
          $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0],
        },
        commentCount: {
          $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0],
        },
        viewerHasLiked: { $gt: [{ $size: '$viewerLike' }, 0] },
        viewerIsFollowing: {
          $cond: [
            { $eq: ['$post.userId', viewerId] },
            false,
            { $gt: [{ $size: '$viewerFollow' }, 0] },
          ],
        },
        viewerHasSaved: true,
      },
    },
    {
      $project: {
        _id: '$post._id',
        description: '$post.description',
        mentions: '$post.mentions',
        mediaType: '$post.mediaType',
        mediaUrl: '$post.mediaUrl',
        createdAt: '$post.createdAt',
        likeCount: 1,
        commentCount: 1,
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
    {
      $facet: {
        metadata: [{ $count: 'totalCount' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]);

  const totalCount = result?.metadata?.[0]?.totalCount || 0;
  const posts = result?.data || [];

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    posts,
    page,
    totalPages,
    totalCount,
  });
}

module.exports = {
  savePost,
  unsavePost,
  getSavedPosts,
};
