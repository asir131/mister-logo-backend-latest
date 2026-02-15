const mongoose = require('mongoose');

const Like = require('../models/Like');
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

async function likePost(req, res) {
  const userId = req.user.id;
  const { postId } = req.body;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const post = await Post.findById(postId)
    .select('_id userId description')
    .lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const result = await Like.updateOne(
    { userId, postId },
    { $setOnInsert: { userId, postId } },
    { upsert: true },
  );

  const isNewLike = Boolean(result?.upsertedCount);
  const ownerId = post.userId?.toString();

  if (isNewLike && ownerId && ownerId !== userId) {
    const actorName = await resolveDisplayName(userId);
    fireAndForgetNotifyAndPush({
      io: req.app.get('io'),
      userIds: [ownerId],
      title: 'New like',
      body: `${actorName} liked your post.`,
      type: 'like',
      data: {
        actorUserId: userId,
        postId: String(postId),
      },
      screen: '/screens/home/notification',
    });
  }

  return res.status(200).json({ liked: true });
}

async function unlikePost(req, res) {
  const userId = req.user.id;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  await Like.deleteOne({ userId, postId });

  return res.status(200).json({ liked: false });
}

module.exports = {
  likePost,
  unlikePost,
};
