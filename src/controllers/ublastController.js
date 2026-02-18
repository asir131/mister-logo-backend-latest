const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const UBlast = require('../models/UBlast');
const UBlastSubmission = require('../models/UBlastSubmission');
const User = require('../models/User');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const UblastOffer = require('../models/UblastOffer');
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
  if (user.ublastManualBlocked) return true;
  if (isBlockedUntil(user.ublastBlockedUntil)) return true;
  return false;
}

async function getEligibility(req, res) {
  const user = await User.findById(req.user.id)
    .select('ublastBlockedUntil ublastManualBlocked isBlocked isBanned')
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
  const page = Number.parseInt(req.query.page, 10) > 0 ? Number.parseInt(req.query.page, 10) : 1;
  const limit = Number.parseInt(req.query.limit, 10) > 0 ? Math.min(50, Number.parseInt(req.query.limit, 10)) : 12;
  const skip = (page - 1) * limit;

  const [totalCount, ublasts] = await Promise.all([
    UBlast.countDocuments({
      status: 'released',
      expiresAt: { $gt: now },
      $or: [{ targetUserId: null }, { targetUserId: { $exists: false } }, { targetUserId: userId }],
    }),
    UBlast.find({
      status: 'released',
      expiresAt: { $gt: now },
      $or: [{ targetUserId: null }, { targetUserId: { $exists: false } }, { targetUserId: userId }],
    })
      .sort({ releasedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

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
      rewardLabel: ublast.rewardLabel || null,
      rewardType: ublast.rewardType || null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    ublasts: formatted,
    page,
    totalPages,
    totalCount,
  });
}

async function submitUblast(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { ublastId } = req.params;
  const { proposedDate, title, content } = req.body;

  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Submission media file is required.' });
  }

  const user = await User.findById(userId)
    .select('ublastBlockedUntil isBlocked isBanned ublastManualBlocked')
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
      title: title ? title.trim() : undefined,
      content: content ? content.trim() : undefined,
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
    .select('ublastBlockedUntil isBlocked isBanned ublastManualBlocked')
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
  if (ublast.rewardType === 'offer') {
    const offer = await UblastOffer.findOne({ ublastId, userId }).lean();
    if (!offer) {
      return { status: 403, error: 'Payment required to share this UBlast.' };
    }
    if (offer.status !== 'paid') {
      return { status: 403, error: 'Payment required to share this UBlast.' };
    }
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

  // allow multiple shares; do not dedupe by existing share

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
    status: 'published',
    publishedAt: new Date(),
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

async function submitUblastRequest(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { proposedDate, title, content } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Submission media file is required.' });
  }

  const user = await User.findById(userId)
    .select('ublastBlockedUntil isBlocked isBanned ublastManualBlocked')
    .lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (isUserIneligible(user)) {
    return res.status(403).json({ error: 'You are blocked from UBlast submissions.' });
  }

  const mediaType = detectMediaType(req.file.mimetype);
  if (!mediaType) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  try {
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'unap/ublast-submissions',
      resource_type: 'auto',
    });

    const created = await UBlastSubmission.create({
      userId,
      proposedDate: proposedDate ? new Date(proposedDate) : undefined,
      title: title ? title.trim() : undefined,
      content: content ? content.trim() : undefined,
      mediaUrl: uploadResult.secure_url || uploadResult.url,
      mediaType,
      status: 'pending',
    });

    return res.status(201).json({ submission: created });
  } catch (err) {
    console.error('UBlast request submission error:', err);
    return res.status(500).json({ error: 'Could not submit UBlast request.' });
  }
}

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function listMySubmissions(req, res) {
  const userId = req.user.id;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 12, 50);
  const skip = (page - 1) * limit;

  const [totalCount, submissions] = await Promise.all([
    UBlastSubmission.countDocuments({ userId }),
    UBlastSubmission.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    submissions,
    page,
    totalPages,
    totalCount,
  });
}

async function updateSubmission(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const userId = req.user.id;
  const { submissionId } = req.params;

  if (!mongoose.isValidObjectId(submissionId)) {
    return res.status(400).json({ error: 'Invalid submission id.' });
  }

  const user = await User.findById(userId)
    .select('ublastBlockedUntil isBlocked isBanned ublastManualBlocked')
    .lean();
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (isUserIneligible(user)) {
    return res.status(403).json({ error: 'You are blocked from UBlast submissions.' });
  }

  const submission = await UBlastSubmission.findOne({
    _id: submissionId,
    userId,
  });
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  if (submission.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending submissions can be edited.' });
  }

  const updates = {};
  if (req.body.title !== undefined) updates.title = req.body.title.trim();
  if (req.body.content !== undefined) updates.content = req.body.content.trim();
  if (req.body.proposedDate !== undefined) {
    updates.proposedDate = req.body.proposedDate
      ? new Date(req.body.proposedDate)
      : undefined;
  }

  if (req.file) {
    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Unsupported media type.' });
    }
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'unap/ublast-submissions',
      resource_type: 'auto',
    });
    updates.mediaUrl = uploadResult.secure_url || uploadResult.url;
    updates.mediaType = mediaType;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updates provided.' });
  }

  const updated = await UBlastSubmission.findOneAndUpdate(
    { _id: submissionId, userId },
    { $set: updates },
    { new: true },
  );

  return res.status(200).json({ submission: updated });
}

module.exports = {
  getEligibility,
  getActiveUblasts,
  submitUblast,
  submitUblastRequest,
  listMySubmissions,
  updateSubmission,
  shareUblast,
  shareUblastInternal,
};

