const { validationResult } = require('express-validator');

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const SavedPost = require('../models/SavedPost');
const { uploadMediaBuffer } = require('../services/cloudinary');
const { enqueuePostShare } = require('../services/shareQueue');
const UBlast = require('../models/UBlast');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

function detectMediaType(mimetype) {
  if (!mimetype) return null;
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return null;
}

async function createPost(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { description } = req.body;

  const now = new Date();
  const activeUblasts = await UBlast.find({
    status: 'released',
    expiresAt: { $gt: now },
  })
    .select('_id')
    .lean();

  if (activeUblasts.length > 0) {
    const shared = await Post.find({
      userId,
      ublastId: { $in: activeUblasts.map((ublast) => ublast._id) },
    })
      .select('ublastId')
      .lean();

    if (shared.length < activeUblasts.length) {
      return res.status(403).json({
        error: 'You must share active UBlasts before creating new posts.',
      });
    }
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Media file is required.' });
  }

  const mediaType = detectMediaType(req.file.mimetype);
  if (!mediaType) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  const shareToFacebook = Boolean(req.body.shareToFacebook);
  const shareToInstagram = Boolean(req.body.shareToInstagram);

  try {
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'mister/posts',
    });

    const shareStatus = {
      facebook: { status: shareToFacebook ? 'queued' : 'none' },
      instagram: { status: shareToInstagram ? 'queued' : 'none' },
    };

    const created = await Post.create({
      userId,
      description,
      mediaType,
      mediaUrl: uploadResult.secure_url || uploadResult.url,
      mediaPublicId: uploadResult.public_id,
      mimeType: req.file.mimetype,
      size: req.file.size,
      shareToFacebook,
      shareToInstagram,
      shareStatus,
    });

    const profileUpdate = {
      $inc: {
        postsCount: 1,
        [`${mediaType}Count`]: 1,
      },
      $push: {
        [`${mediaType}Posts`]: {
          postId: created._id,
          mediaUrl: created.mediaUrl,
          description: created.description,
          createdAt: created.createdAt,
        },
      },
    };
    await Profile.updateOne({ userId }, profileUpdate);

    enqueuePostShare(created);

    return res.status(201).json({
      message: 'Post created successfully.',
      post: created,
    });
  } catch (err) {
    console.error('Create post error:', err);
    return res.status(500).json({ error: 'Could not create post.' });
  }
}

async function deletePost(req, res) {
  const { id: userId } = req.user;
  const { postId } = req.params;

  const post = await Post.findOneAndDelete({ _id: postId, userId });
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  await Promise.all([
    Like.deleteMany({ postId: post._id }),
    Comment.deleteMany({ postId: post._id }),
    SavedPost.deleteMany({ postId: post._id }),
  ]);

  await Profile.updateOne(
    { userId },
    {
      $inc: {
        postsCount: -1,
        [`${post.mediaType}Count`]: -1,
      },
      $pull: {
        [`${post.mediaType}Posts`]: { postId: post._id },
      },
    },
  );

  return res.status(200).json({ message: 'Post deleted.' });
}

module.exports = {
  createPost,
  deletePost,
};
