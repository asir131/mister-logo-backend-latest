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

function normalizeMentionIds(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(',');
    }
  }
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((item) => String(item || '').trim())
        .filter((item) => mongoose.isValidObjectId(item)),
    ),
  );
}

function extractMentionUsernames(text = '') {
  const matches = String(text || '').matchAll(/(^|[\s([{"'])@([a-zA-Z0-9_.-]{2,30})/g);
  return Array.from(
    new Set(
      Array.from(matches)
        .map((match) => String(match[2] || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function resolveMentions({ text = '', mentionIds = [] }) {
  const ids = normalizeMentionIds(mentionIds);
  const usernames = extractMentionUsernames(text);
  if (!ids.length && !usernames.length) return [];

  const or = [];
  if (ids.length) {
    or.push({ userId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
  }
  if (usernames.length) {
    or.push({
      username: {
        $in: usernames.map(
          (username) => new RegExp(`^${String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        ),
      },
    });
  }

  const profiles = await Profile.find({ $or: or })
    .select('userId username displayName')
    .lean();

  const byUserId = new Map();
  profiles.forEach((profile) => {
    const userId = String(profile.userId || '');
    if (!userId || byUserId.has(userId)) return;
    byUserId.set(userId, {
      userId,
      username: String(profile.username || ''),
      name: String(profile.displayName || profile.username || 'User'),
    });
  });

  return Array.from(byUserId.values());
}

function notifyUnique({ req, userIds = [], title, body, type, data, screen, skipUserIds = [] }) {
  const skip = new Set(skipUserIds.map((id) => String(id || '').trim()).filter(Boolean));
  const recipients = Array.from(
    new Set(
      userIds
        .map((id) => String(id || '').trim())
        .filter((id) => id && !skip.has(id)),
    ),
  );
  if (!recipients.length) return [];

  fireAndForgetNotifyAndPush({
    io: req.app.get('io'),
    userIds: recipients,
    title,
    body,
    type,
    data,
    screen,
  });

  return recipients;
}

async function hydrateComments(rawComments = [], viewerUserId = '') {
  if (!rawComments.length) return [];

  const commentIds = rawComments.map((comment) => comment._id);
  const viewerObjectId = mongoose.isValidObjectId(viewerUserId)
    ? new mongoose.Types.ObjectId(viewerUserId)
    : null;
  const replies = await Comment.aggregate([
    { $match: { parentCommentId: { $in: commentIds } } },
    { $sort: { createdAt: 1 } },
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
        parentCommentId: 1,
        replyCount: 1,
        mentions: 1,
        likeCount: { $size: { $ifNull: ['$likedBy', []] } },
        viewerHasLiked: viewerObjectId
          ? { $in: [viewerObjectId, { $ifNull: ['$likedBy', []] }] }
          : { $literal: false },
        user: {
          id: '$user._id',
          name: '$user.name',
          email: '$user.email',
          avatarUrl: '$user.avatarUrl',
        },
        profile: {
          username: '$profile.username',
          displayName: '$profile.displayName',
          profileImageUrl: '$profile.profileImageUrl',
        },
      },
    },
  ]);

  const repliesByParent = new Map();
  replies.forEach((reply) => {
    const key = String(reply.parentCommentId || '');
    if (!repliesByParent.has(key)) repliesByParent.set(key, []);
    repliesByParent.get(key).push(reply);
  });

  return rawComments.map((comment) => ({
    ...comment,
    likeCount: Array.isArray(comment.likedBy)
      ? comment.likedBy.length
      : Number(comment.likeCount || 0),
    viewerHasLiked: viewerObjectId && Array.isArray(comment.likedBy)
      ? comment.likedBy.some((id) => String(id) === String(viewerObjectId))
      : Boolean(comment.viewerHasLiked),
    likedBy: undefined,
    replies: repliesByParent.get(String(comment._id)) || [],
  }));
}

async function createComment(req, res) {
  const userId = req.user.id;
  const { postId, text } = req.body;
  const parentCommentId = req.body?.parentCommentId
    ? String(req.body.parentCommentId).trim()
    : '';

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required.' });
  }

  if (parentCommentId && !mongoose.isValidObjectId(parentCommentId)) {
    return res.status(400).json({ error: 'Invalid parent comment id.' });
  }

  const post = await Post.findById(postId)
    .select('_id userId')
    .lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  let parentComment = null;
  if (parentCommentId) {
    parentComment = await Comment.findOne({
      _id: parentCommentId,
      postId,
      parentCommentId: null,
    })
      .select('_id userId')
      .lean();
    if (!parentComment) {
      return res.status(404).json({ error: 'Parent comment not found.' });
    }
  }

  const trimmedText = text.trim();
  const mentions = await resolveMentions({
    text: trimmedText,
    mentionIds: req.body?.mentionIds,
  });
  const comment = await Comment.create({
    userId,
    postId,
    parentCommentId: parentComment ? parentComment._id : null,
    text: trimmedText,
    mentions,
  });

  if (parentComment) {
    await Comment.updateOne(
      { _id: parentComment._id },
      { $inc: { replyCount: 1 } },
    );
  }

  const actorName = await resolveDisplayName(userId);
  const previewText = trimmedText.slice(0, 80);
  const actorId = String(userId);
  const postOwnerId = post.userId?.toString();
  const notified = new Set([actorId]);

  const ownerId = post.userId?.toString();
  if (!parentComment && ownerId && ownerId !== userId) {
    notifyUnique({
      req,
      userIds: [ownerId],
      skipUserIds: Array.from(notified),
      title: 'New comment',
      body: `${actorName}: ${previewText}`,
      type: 'comment',
      data: {
        actorUserId: userId,
        postId: String(postId),
        commentId: String(comment._id),
      },
      screen: '/screens/home/notification',
    }).forEach((id) => notified.add(id));
  }

  if (parentComment) {
    notifyUnique({
      req,
      userIds: [parentComment.userId],
      skipUserIds: Array.from(notified),
      title: 'New reply',
      body: `${actorName} replied: ${previewText}`,
      type: 'comment_reply',
      data: {
        actorUserId: userId,
        postId: String(postId),
        commentId: String(parentComment._id),
        replyId: String(comment._id),
      },
      screen: '/screens/home/notification',
    }).forEach((id) => notified.add(id));

    notifyUnique({
      req,
      userIds: [postOwnerId],
      skipUserIds: Array.from(notified),
      title: 'New reply on your post',
      body: `${actorName} replied: ${previewText}`,
      type: 'comment_reply',
      data: {
        actorUserId: userId,
        postId: String(postId),
        commentId: String(parentComment._id),
        replyId: String(comment._id),
      },
      screen: '/screens/home/notification',
    }).forEach((id) => notified.add(id));
  }

  const mentionRecipients = mentions.map((mention) => mention.userId);
  notifyUnique({
    req,
    userIds: mentionRecipients,
    skipUserIds: Array.from(notified),
    title: 'New mention',
    body: `${actorName} mentioned you in a ${parentComment ? 'reply' : 'comment'}.`,
    type: 'mention',
    data: {
      actorUserId: userId,
      postId: String(postId),
      commentId: String(parentComment?._id || comment._id),
      replyId: parentComment ? String(comment._id) : '',
    },
    screen: '/screens/home/notification',
  });

  const enriched = await hydrateComments([comment.toObject()], userId);
  const responseComment = enriched[0] || comment;
  if (parentComment) {
    responseComment.parentCommentId = parentComment._id;
  }

  return res.status(201).json({ comment: responseComment });
}

async function getComments(req, res) {
  const { postId } = req.query;
  const viewerUserId = req.user.id;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 5, 50);
  const skip = (page - 1) * limit;

  const [totalCount, comments] = await Promise.all([
    Comment.countDocuments({ postId, parentCommentId: null }),
    Comment.aggregate([
      {
        $match: {
          postId: new mongoose.Types.ObjectId(postId),
          parentCommentId: null,
        },
      },
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
          parentCommentId: 1,
          replyCount: 1,
          mentions: 1,
          likedBy: 1,
          likeCount: { $size: { $ifNull: ['$likedBy', []] } },
          viewerHasLiked: {
            $in: [
              new mongoose.Types.ObjectId(viewerUserId),
              { $ifNull: ['$likedBy', []] },
            ],
          },
          user: {
            id: '$user._id',
            name: '$user.name',
            email: '$user.email',
            avatarUrl: '$user.avatarUrl',
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

  const hydratedComments = await hydrateComments(comments, viewerUserId);
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    comments: hydratedComments,
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

  if (comment.parentCommentId) {
    await Comment.updateOne(
      { _id: comment.parentCommentId },
      { $inc: { replyCount: -1 } },
    );
  } else {
    await Comment.deleteMany({ parentCommentId: comment._id });
  }

  return res.status(200).json({ message: 'Comment deleted.' });
}

async function likeComment(req, res) {
  const userId = req.user.id;
  const { commentId } = req.params;

  if (!mongoose.isValidObjectId(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  const updateResult = await Comment.updateOne(
    { _id: commentId, likedBy: { $ne: userId } },
    { $addToSet: { likedBy: userId } },
  );

  const comment = await Comment.findById(commentId)
    .select('_id postId userId parentCommentId likedBy')
    .lean();

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found.' });
  }

  const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy : [];
  const isNewLike = Boolean(updateResult?.modifiedCount);
  const ownerId = comment.userId?.toString();

  if (isNewLike && ownerId && ownerId !== userId) {
    const actorName = await resolveDisplayName(userId);
    fireAndForgetNotifyAndPush({
      io: req.app.get('io'),
      userIds: [ownerId],
      title: 'New comment like',
      body: `${actorName} liked your comment.`,
      type: 'comment_like',
      data: {
        actorUserId: userId,
        postId: String(comment.postId || ''),
        commentId: String(comment.parentCommentId || comment._id),
        replyId: comment.parentCommentId ? String(comment._id) : '',
      },
      screen: '/screens/home/notification',
    });
  }

  return res.status(200).json({
    commentId: String(comment._id),
    likeCount: likedBy.length,
    viewerHasLiked: true,
  });
}

async function unlikeComment(req, res) {
  const userId = req.user.id;
  const { commentId } = req.params;

  if (!mongoose.isValidObjectId(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  const comment = await Comment.findByIdAndUpdate(
    commentId,
    { $pull: { likedBy: userId } },
    { new: true },
  )
    .select('_id likedBy')
    .lean();

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found.' });
  }

  const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy : [];

  return res.status(200).json({
    commentId: String(comment._id),
    likeCount: likedBy.length,
    viewerHasLiked: false,
  });
}

module.exports = {
  createComment,
  getComments,
  deleteComment,
  likeComment,
  unlikeComment,
};
