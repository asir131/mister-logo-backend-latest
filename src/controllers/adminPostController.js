const mongoose = require('mongoose');

const Post = require('../models/Post');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const ModerationAction = require('../models/ModerationAction');
const { createPreviewFromUrl } = require('../services/videoPreview');
const { uploadImageBuffer } = require('../services/mediaStorage');
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
    width: 720,
    seekSec: 1.0,
  });
  const previewUpload = await uploadImageBuffer(previewBuffer, {
    folder: 'mister/posts-previews',
    resource_type: 'image',
    contentType: 'image/jpeg',
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
          mediaPreviewUrl: 1,
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
            avatarUrl: '$user.avatarUrl',
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
        avatar: post.profile?.profileImageUrl || post.user?.avatarUrl || '',
        email: post.user?.email || '',
      },
      content: post.description || '',
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl || '',
      mediaPreviewUrl: post.mediaPreviewUrl || '',
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

function mapProfileUser(user, profile) {
  return {
    id: user?._id || user?.id || '',
    name: profile?.displayName || profile?.username || user?.name || 'Unknown',
    username: profile?.username || '',
    email: user?.email || '',
    avatar: profile?.profileImageUrl || user?.avatarUrl || '',
  };
}

async function getPostDetail(req, res) {
  const { postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const post = await Post.findById(postId).lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const [owner, ownerProfile, likeCount, commentCount, comments, likes] = await Promise.all([
    User.findById(post.userId).select('name email avatarUrl').lean(),
    Profile.findOne({ userId: post.userId })
      .select('displayName username profileImageUrl')
      .lean(),
    Like.countDocuments({ postId }),
    Comment.countDocuments({ postId }),
    Comment.find({ postId, parentCommentId: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Like.find({ postId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const userIds = Array.from(
    new Set([
      ...comments.map((comment) => comment.userId?.toString()).filter(Boolean),
      ...likes.map((like) => like.userId?.toString()).filter(Boolean),
    ]),
  );
  const [engagementUsers, engagementProfiles] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } }).select('name email avatarUrl').lean()
      : [],
    userIds.length
      ? Profile.find({ userId: { $in: userIds } })
          .select('userId displayName username profileImageUrl')
          .lean()
      : [],
  ]);

  const userById = new Map(engagementUsers.map((user) => [user._id.toString(), user]));
  const profileByUserId = new Map(
    engagementProfiles.map((profile) => [profile.userId.toString(), profile]),
  );
  const mapEngagementUser = (userId) => {
    const id = userId?.toString?.() || '';
    return mapProfileUser(userById.get(id), profileByUserId.get(id));
  };
  let signedMediaUrl = '';
  let signedPreviewUrl = '';
  try {
    if (post.mediaUrl) {
      const signed = await createSignedReadUrlFromUrl(post.mediaUrl, 30);
      signedMediaUrl = signed.readUrl;
    }
  } catch (err) {
    // Non-GCS or unavailable media falls back to the stored URL/proxy path.
  }
  try {
    if (post.mediaPreviewUrl) {
      const signed = await createSignedReadUrlFromUrl(post.mediaPreviewUrl, 30);
      signedPreviewUrl = signed.readUrl;
    }
  } catch (err) {
    // Non-GCS or unavailable preview falls back to the stored URL/proxy path.
  }

  return res.status(200).json({
    post: {
      id: post._id,
      userId: post.userId,
      user: mapProfileUser(owner, ownerProfile),
      content: post.description || '',
      mediaType: post.mediaType || '',
      mediaUrl: post.mediaUrl || '',
      mediaPreviewUrl: post.mediaPreviewUrl || '',
      signedMediaUrl,
      signedPreviewUrl,
      mediaOriginalUrl: post.mediaOriginalUrl || '',
      postType: post.postType || 'upost',
      status: post.status || '',
      platforms: post.shareTargets || [],
      viewCount: post.viewCount || 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    },
    counts: {
      views: post.viewCount || 0,
      likes: likeCount,
      comments: commentCount,
    },
    comments: comments.map((comment) => ({
      id: comment._id,
      text: comment.text,
      replyCount: comment.replyCount || 0,
      likeCount: Array.isArray(comment.likedBy) ? comment.likedBy.length : 0,
      createdAt: comment.createdAt,
      user: mapEngagementUser(comment.userId),
    })),
    likes: likes.map((like) => ({
      id: like._id,
      createdAt: like.createdAt,
      user: mapEngagementUser(like.userId),
    })),
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
  getPostDetail,
  deletePost,
  regeneratePreview,
};
