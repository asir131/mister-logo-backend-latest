const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const UBlast = require('../models/UBlast');
const UBlastSubmission = require('../models/UBlastSubmission');
const User = require('../models/User');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const { uploadMediaBuffer } = require('../services/cloudinary');

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

function isBlockedUntil(dateValue) {
  if (!dateValue) return false;
  return new Date(dateValue).getTime() > Date.now();
}

function isUserIneligible(user) {
  if (!user) return true;
  if (user.isBlocked || user.isBanned) return true;
  if (isBlockedUntil(user.ublastBlockedUntil)) return true;
  return false;
}

async function getEligibility(req, res) {
  const user = await User.findById(req.user.id)
    .select('ublastBlockedUntil isBlocked isBanned')
    .lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  const blockedUntil = user.ublastBlockedUntil;
  const blocked = isUserIneligible(user);
  return res.status(200).json({
    eligible: !blocked,
    blockedUntil: blocked ? blockedUntil : null,
  });
}

async function getActiveUblasts(req, res) {
  const userId = req.user.id;
  const now = new Date();

  const ublasts = await UBlast.find({
    status: 'released',
    expiresAt: { $gt: now },
  })
    .sort({ releasedAt: -1 })
    .limit(32)
    .lean();

  if (ublasts.length === 0) {
    return res.status(200).json({ ublasts: [] });
  }

  const sharedPosts = await Post.find({
    userId,
    ublastId: { $in: ublasts.map((u) => u._id) },
  })
    .select('ublastId createdAt')
    .lean();

  const sharedByUblast = new Map(
    sharedPosts.map((post) => [post.ublastId.toString(), post]),
  );

  const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);
  const formatted = ublasts.map((ublast) => {
    const sharedPost = sharedByUblast.get(ublast._id.toString());
    const releasedAt = ublast.releasedAt || ublast.createdAt;
    const dueAt = releasedAt
      ? new Date(new Date(releasedAt).getTime() + shareWindowHours * 60 * 60 * 1000)
      : null;
    return {
      ...ublast,
      dueAt,
      viewerHasShared: Boolean(sharedPost),
      sharedAt: sharedPost?.createdAt || null,
    };
  });

  return res.status(200).json({ ublasts: formatted });
}

async function submitUblast(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { ublastId } = req.params;
  const { proposedDate } = req.body;

  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Submission media file is required.' });
  }

  const user = await User.findById(userId)
    .select('ublastBlockedUntil isBlocked isBanned')
    .lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (isUserIneligible(user)) {
    return res.status(403).json({ error: 'You are blocked from UBlast submissions.' });
  }

  const ublast = await UBlast.findById(ublastId).lean();
  if (!ublast) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }

  if (ublast.status !== 'released' || !ublast.expiresAt || ublast.expiresAt <= new Date()) {
    return res.status(400).json({ error: 'UBlast is not active.' });
  }

  const mediaType = detectMediaType(req.file.mimetype);
  if (!mediaType) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  const exists = await UBlastSubmission.exists({ ublastId, userId });
  if (exists) {
    return res.status(409).json({ error: 'Submission already exists.' });
  }

  try {
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'unap/ublast-submissions',
      resource_type: 'auto',
    });

    const created = await UBlastSubmission.create({
      ublastId,
      userId,
      proposedDate: proposedDate ? new Date(proposedDate) : undefined,
      mediaUrl: uploadResult.secure_url || uploadResult.url,
      mediaType,
    });

    return res.status(201).json({ submission: created });
  } catch (err) {
    console.error('UBlast submission error:', err);
    return res.status(500).json({ error: 'Could not submit UBlast.' });
  }
}

async function shareUblast(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { ublastId } = req.params;
  const { shareType } = req.body;

  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  const result = await shareUblastInternal({ userId, ublastId, shareType });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.status(200).json({ post: result.post });
}

async function shareUblastInternal({ userId, ublastId, shareType }) {
  const now = new Date();
  const user = await User.findById(userId)
    .select('ublastBlockedUntil isBlocked isBanned')
    .lean();
  if (!user) {
    return { status: 404, error: 'User not found.' };
  }
  if (isUserIneligible(user)) {
    return { status: 403, error: 'You are not eligible to share this UBlast.' };
  }

  if (!ublastId) {
    return { status: 400, error: 'UBlast id is required.' };
  }

  const ublast = await UBlast.findById(ublastId).lean();
  if (!ublast) {
    return { status: 404, error: 'UBlast not found.' };
  }
  if (ublast.status !== 'released' || !ublast.expiresAt || ublast.expiresAt <= now) {
    return { status: 400, error: 'UBlast is not active.' };
  }

  const releaseTime = ublast.releasedAt ? new Date(ublast.releasedAt) : null;
  const dueAt = releaseTime
    ? new Date(
        releaseTime.getTime() + Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48) * 60 * 60 * 1000,
      )
    : null;

  if (dueAt && new Date(dueAt).getTime() < now.getTime()) {
    const blockUntil = new Date(
      now.getTime() + Number(process.env.UBLAST_BLOCK_DAYS || 90) * 24 * 60 * 60 * 1000,
    );
    await User.updateOne({ _id: userId }, { $set: { ublastBlockedUntil: blockUntil } });
    return { status: 403, error: 'Share window expired.' };
  }

  const existingPost = await Post.findOne({
    userId,
    ublastId: ublast._id,
  }).lean();
  if (existingPost) {
    return { post: existingPost };
  }

  if (!ublast.mediaUrl || !ublast.mediaType) {
    return { status: 400, error: 'UBlast media is missing.' };
  }

  const profile = await Profile.findOne({ userId }).lean();
  if (!profile) {
    return { status: 400, error: 'Profile required before sharing.' };
  }

  const description = ublast.content || ublast.title || 'UBlast';

  const post = await Post.create({
    userId,
    description,
    mediaType: ublast.mediaType,
    mediaUrl: ublast.mediaUrl,
    shareToFacebook: false,
    shareToInstagram: false,
    shareStatus: {
      facebook: { status: 'none' },
      instagram: { status: 'none' },
    },
    ublastId: ublast._id,
  });

  await Profile.updateOne(
    { userId },
    {
      $inc: {
        postsCount: 1,
        [`${ublast.mediaType}Count`]: 1,
      },
      $push: {
        [`${ublast.mediaType}Posts`]: {
          postId: post._id,
          mediaUrl: post.mediaUrl,
          description: post.description,
          createdAt: post.createdAt,
        },
      },
    },
  );

  return { post };
}

module.exports = {
  getEligibility,
  getActiveUblasts,
  submitUblast,
  shareUblast,
};
