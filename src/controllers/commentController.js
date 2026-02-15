const mongoose = require('mongoose');

const Comment = require('../models/Comment');
const Post = require('../models/Post');
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

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function createComment(req, res) {
  const userId = req.user.id;
  const { postId, text } = req.body;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required.' });
  }

  const post = await Post.findById(postId)
    .select('_id userId')
    .lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const comment = await Comment.create({
    userId,
    postId,
    text: text.trim(),
  });

  const ownerId = post.userId?.toString();
  if (ownerId && ownerId !== userId) {
    const actorName = await resolveDisplayName(userId);
    const previewText = text.trim().slice(0, 80);
    fireAndForgetNotifyAndPush({
      io: req.app.get('io'),
      userIds: [ownerId],
      title: 'New comment',
      body: `${actorName}: ${previewText}`,
      type: 'comment',
      data: {
        actorUserId: userId,
        postId: String(postId),
      },
      screen: '/screens/home/notification',
    });
  }

  return res.status(201).json({ comment });
}

async function getComments(req, res) {
  const { postId } = req.query;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 5, 50);
  const skip = (page - 1) * limit;

  const [totalCount, comments] = await Promise.all([
    Comment.countDocuments({ postId }),
    Comment.aggregate([
      { $match: { postId: new mongoose.Types.ObjectId(postId) } },
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
        $project: {
          text: 1,
          createdAt: 1,
          user: {
            id: '$user._id',
            name: '$user.name',
            email: '$user.email',
          },
          profile: {
            username: '$profile.username',
            displayName: '$profile.displayName',
            profileImageUrl: '$profile.profileImageUrl',
          },
        },
      },
    ]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    comments,
    page,
    totalPages,
    totalCount,
  });
}

async function deleteComment(req, res) {
  const userId = req.user.id;
  const { commentId } = req.params;

  if (!mongoose.isValidObjectId(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  const comment = await Comment.findOneAndDelete({ _id: commentId, userId });
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found.' });
  }

  return res.status(200).json({ message: 'Comment deleted.' });
}

module.exports = {
  createComment,
  getComments,
  deleteComment,
};
