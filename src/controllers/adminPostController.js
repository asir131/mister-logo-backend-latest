const mongoose = require('mongoose');

const Post = require('../models/Post');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const ModerationAction = require('../models/ModerationAction');
const { createPreviewFromUrl } = require('../services/videoPreview');
const { uploadMediaBuffer } = require('../services/mediaStorage');
const {
  createSignedReadUrlFromUrl,
  createSignedReadUrlFromObjectName,
} = require('../services/gcsStorage');

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

function getAdminIdentifier(req) {
  if (req?.admin?.email) return req.admin.email;
  if (req?.admin?.username) return req.admin.username;
  return 'system';
}

function extractObjectNameFromProxyUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    const path = parsed.pathname || '';
    const marker = '/media/';
    const idx = path.indexOf(marker);
    if (idx === -1) return null;
    const objectPath = path.slice(idx + marker.length);
    return objectPath ? decodeURIComponent(objectPath) : null;
  } catch {
    return null;
  }
}

async function regeneratePostPreview(post) {
  if (!post?.mediaUrl) {
    throw new Error('Media URL missing.');
  }
  let sourceUrl = post.mediaUrl;
  try {
    const proxyObjectName = extractObjectNameFromProxyUrl(post.mediaUrl);
    if (proxyObjectName) {
      const signed = await createSignedReadUrlFromObjectName(proxyObjectName, 20);
      sourceUrl = signed.readUrl;
    } else {
      const signed = await createSignedReadUrlFromUrl(post.mediaUrl, 20);
      sourceUrl = signed.readUrl;
    }
  } catch (err) {
    // Non-GCS URLs fall back to original mediaUrl
  }

  const previewBuffer = await createPreviewFromUrl({
    sourceUrl,
    width: 480,
  });
  const previewUpload = await uploadMediaBuffer(previewBuffer, {
    folder: 'mister/posts-previews',
    resource_type: 'video',
    contentType: 'video/mp4',
  });
  const previewUrl = previewUpload.secure_url || previewUpload.url;
  await Post.updateOne(
    { _id: post._id },
    { $set: { mediaPreviewUrl: previewUrl } },
  );
  return previewUrl;
}

async function logModerationAction(action) {
  try {
    await ModerationAction.create(action);
  } catch (err) {
    // ignore logging errors
  }
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
            email: '$user.email',
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
        email: post.user?.email || '',
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

async function deletePost(req, res) {
  const { postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }
  const post = await Post.findById(postId).lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }
  const user = await User.findById(post.userId, { email: 1 }).lean();
  const deleted = await Post.findByIdAndDelete(postId);
  if (!deleted) {
    return res.status(404).json({ error: 'Post not found.' });
  }
  await Promise.all([
    Like.deleteMany({ postId }),
    Comment.deleteMany({ postId }),
  ]);
  await logModerationAction({
    type: 'delete_post',
    targetType: 'post',
    targetId: deleted._id,
    targetEmail: user?.email || '',
    performedBy: getAdminIdentifier(req),
  });
  return res.status(200).json({ deleted: true });
}

async function regeneratePreview(req, res) {
  const { postId } = req.params;
  const force = String(req.query.force || '').toLowerCase() === 'true';
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const post = await Post.findById(postId).lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }
  if (post.mediaType !== 'video') {
    return res.status(400).json({ error: 'Preview can only be generated for video posts.' });
  }
  if (post.mediaPreviewUrl && !force) {
    return res.status(200).json({
      message: 'Preview already exists.',
      mediaPreviewUrl: post.mediaPreviewUrl,
    });
  }

  try {
    const previewUrl = await regeneratePostPreview(post);
    return res.status(200).json({
      message: 'Preview regenerated.',
      mediaPreviewUrl: previewUrl,
    });
  } catch (err) {
    console.error('Admin preview regeneration failed:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Could not regenerate preview.' });
  }
}

module.exports = {
  listUserPosts,
  deletePost,
  regeneratePreview,
};
