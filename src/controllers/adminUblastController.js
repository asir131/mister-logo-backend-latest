const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const UBlast = require('../models/UBlast');
const UBlastSubmission = require('../models/UBlastSubmission');
const TrendingPlacement = require('../models/TrendingPlacement');
const Post = require('../models/Post');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const User = require('../models/User');
const UblastOffer = require('../models/UblastOffer');
const { uploadMediaBuffer } = require('../services/mediaStorage');
const { fireAndForgetNotifyAndPush } = require('../services/notifyAndPush');
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

async function broadcastAdminUblast(io, ublast, event = 'created') {
  if (!io || !ublast) return;

  const users = await User.find({ isBanned: { $ne: true } }).select('_id').lean();
  const userIds = users.map((user) => String(user._id)).filter(Boolean);
  if (!userIds.length) return;

  const heading = event === 'released' ? 'New UBlast Is Live' : 'New UBlast Created';
  const body =
    ublast?.title && String(ublast.title).trim().length
      ? `Admin posted: ${String(ublast.title).trim()}`
      : 'Admin posted a new UBlast.';

  fireAndForgetNotifyAndPush({
    io,
    userIds,
    title: heading,
    body,
    type: 'ublast',
    screen: '/(tabs)/trending',
    data: {
      type: 'ublast',
      ublastId: String(ublast._id),
      event,
    },
  });
}
async function createUblast(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { title, content, scheduledFor } = req.body;

  let mediaUrl;
  let mediaType;
  if (req.file) {
    mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Unsupported media type.' });
    }
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'unap/ublasts',
      resource_type: 'auto',
      contentType: req.file.mimetype,
    });
    mediaUrl = uploadResult.secure_url || uploadResult.url;
  }

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);
  const isScheduled = Boolean(scheduledDate);
  const now = new Date();

  const createPayload = {
    title,
    content,
    mediaUrl,
    mediaType,
    status: isScheduled ? 'scheduled' : 'released',
    scheduledFor: scheduledDate || undefined,
    createdBy: req.user?.id,
  };

  if (!isScheduled) {
    createPayload.releasedAt = now;
    createPayload.topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    createPayload.expiresAt = new Date(now.getTime() + shareWindowHours * 60 * 60 * 1000);
  }

  const created = await UBlast.create(createPayload);

  if (!isScheduled) {
    const io = req.app?.get('io');
    broadcastAdminUblast(io, created, 'released').catch((err) => {
      console.error('Admin UBlast create broadcast failed:', err?.message || err);
    });
  }

  return res.status(201).json({ ublast: created });
}

async function releaseUblast(req, res) {
  const { ublastId } = req.params;
  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  const now = new Date();
  const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const expiresAt = new Date(
    now.getTime() + Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48) * 60 * 60 * 1000,
  );

  const updated = await UBlast.findByIdAndUpdate(
    ublastId,
    {
      $set: {
        status: 'released',
        releasedAt: now,
        expiresAt,
        topExpiresAt,
      },
    },
    { new: true },
  );

  if (!updated) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }

  const io = req.app?.get('io');
  broadcastAdminUblast(io, updated, 'released').catch((err) => {
    console.error('Admin UBlast release broadcast failed:', err?.message || err);
  });

  return res.status(200).json({ ublast: updated });
}

async function listUblasts(req, res) {
  const match = {};
  if (req.query.status) {
    match.status = req.query.status;
  }
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, ublasts] = await Promise.all([
    UBlast.countDocuments(match),
    UBlast.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const adminId = req.user?.id?.toString?.() || '';
  const mapped = ublasts.map((ublast) => ({
    ...ublast,
    isEditable: !ublast.createdBy || ublast.createdBy.toString() === adminId,
  }));
  return res.status(200).json({ ublasts: mapped, page, totalPages, totalCount });
}

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function listOfficialUblasts(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, ublasts] = await Promise.all([
    UBlast.countDocuments(),
    UBlast.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const creatorIds = Array.from(
    new Set(ublasts.map((ublast) => ublast.createdBy).filter(Boolean)),
  );
  const creators = creatorIds.length
    ? await User.find({ _id: { $in: creatorIds } }).select('name').lean()
    : [];
  const creatorById = new Map(creators.map((user) => [user._id.toString(), user]));

  const submissionLinks = await UBlastSubmission.find({
    approvedUblastId: { $in: ublasts.map((ublast) => ublast._id) },
  })
    .select('approvedUblastId')
    .lean();
  const submissionMap = new Set(
    submissionLinks.map((entry) => entry.approvedUblastId.toString()),
  );

  const now = Date.now();
  const mapped = ublasts.map((ublast) => {
    const creator = ublast.createdBy
      ? creatorById.get(ublast.createdBy.toString())
      : null;
    const isActive =
      ublast.status === 'released' && ublast.expiresAt && ublast.expiresAt.getTime() > now;
    let badgeType = 'Admin UBlast';
    if (ublast.rewardType === 'reward') {
      badgeType = 'Rewarded UBlast';
    } else if (submissionMap.has(ublast._id.toString())) {
      badgeType = 'User Submission';
    }
    return {
      id: ublast._id,
      title: ublast.title,
      content: ublast.content || '',
      mediaType: ublast.mediaType || 'text',
      status: isActive ? 'Active' : 'Timeout',
      createdAt: ublast.createdAt,
      createdBy: creator?.name || 'Admin',
      badgeType,
      rewardType: ublast.rewardType || null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    ublasts: mapped,
    page,
    totalPages,
    totalCount,
  });
}

async function getUblastEngagements(req, res) {
  const { ublastId } = req.params;
  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const posts = await Post.find({ ublastId })
    .select('_id viewCount createdAt')
    .sort({ createdAt: -1 })
    .lean();
  if (posts.length === 0) {
    return res.status(200).json({
      likes: 0,
      views: 0,
      comments: 0,
      shares: 0,
      sharedPosts: [],
      page,
      totalPages: 1,
      totalCount: 0,
    });
  }

  const postIds = posts.map((post) => post._id);
  const views = posts.reduce((sum, post) => sum + (post.viewCount || 0), 0);

  const [likes, comments, totalCount, pagedShares] = await Promise.all([
    Like.countDocuments({ postId: { $in: postIds } }),
    Comment.countDocuments({ postId: { $in: postIds } }),
    Post.countDocuments({ _id: { $in: postIds } }),
    Post.find({ _id: { $in: postIds } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('userId createdAt')
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    likes,
    views,
    comments,
    shares: totalCount,
    sharedPosts: pagedShares,
    page,
    totalPages,
    totalCount,
  });
}

async function listSubmissions(req, res) {
  const match = {};
  if (req.query.status) {
    match.status = req.query.status;
  }
  if (req.query.ublastId && mongoose.isValidObjectId(req.query.ublastId)) {
    match.ublastId = req.query.ublastId;
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, submissions] = await Promise.all([
    UBlastSubmission.countDocuments(match),
    UBlastSubmission.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('ublastId', 'title')
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({ submissions, page, totalPages, totalCount });
}

async function reviewSubmission(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { submissionId } = req.params;
  if (!mongoose.isValidObjectId(submissionId)) {
    return res.status(400).json({ error: 'Invalid submission id.' });
  }

  const { status, reviewNotes } = req.body;

  const updated = await UBlastSubmission.findByIdAndUpdate(
    submissionId,
    {
      $set: {
        status,
        reviewNotes: reviewNotes || undefined,
        reviewedAt: new Date(),
        reviewedBy: req.user?.id,
      },
    },
    { new: true },
  );

  if (!updated) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  if (status === 'rejected' && updated.approvedUblastId) {
    await UBlast.deleteOne({ _id: updated.approvedUblastId });
    updated.approvedUblastId = undefined;
    await updated.save();
    return res.status(200).json({ submission: updated });
  }

  if (status === 'approved' && !updated.approvedUblastId) {
    const now = new Date();
    const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);
    const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const user = await User.findById(updated.userId).select('name').lean();
    const fallbackTitle = user?.name ? `UBlast from ${user.name}` : 'UBlast Submission';
    const title = updated.title?.trim() || fallbackTitle;
    const content = updated.content?.trim() || undefined;

    const createdUblast = await UBlast.create({
      title,
      content,
      mediaUrl: updated.mediaUrl,
      mediaType: updated.mediaType,
      status: 'released',
      scheduledFor: updated.proposedDate || undefined,
      releasedAt: now,
      expiresAt: new Date(now.getTime() + shareWindowHours * 60 * 60 * 1000),
      topExpiresAt,
      createdBy: updated.userId,
    });

    updated.approvedUblastId = createdUblast._id;
    await updated.save();
  }

  if (status === 'approved' && updated.approvedUblastId) {
    const existing = await UBlast.findById(updated.approvedUblastId).lean();
    const now = new Date();
    const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);
    const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (existing) {
      await UBlast.updateOne(
        { _id: updated.approvedUblastId },
        {
          $set: {
            status: 'released',
            releasedAt: now,
            expiresAt: new Date(now.getTime() + shareWindowHours * 60 * 60 * 1000),
            topExpiresAt,
          },
        },
      );
    } else {
      const user = await User.findById(updated.userId).select('name').lean();
      const fallbackTitle = user?.name ? `UBlast from ${user.name}` : 'UBlast Submission';
      const title = updated.title?.trim() || fallbackTitle;
      const content = updated.content?.trim() || undefined;

      const recreated = await UBlast.create({
        title,
        content,
        mediaUrl: updated.mediaUrl,
        mediaType: updated.mediaType,
        status: 'released',
        scheduledFor: updated.proposedDate || undefined,
        releasedAt: now,
        expiresAt: new Date(now.getTime() + shareWindowHours * 60 * 60 * 1000),
        topExpiresAt,
        createdBy: updated.userId,
      });
      updated.approvedUblastId = recreated._id;
      await updated.save();
    }
  }


  if (status === 'approved' && updated.approvedUblastId) {
    const io = req.app?.get('io');
    const releasedUblast = await UBlast.findById(updated.approvedUblastId);
    if (releasedUblast) {
      broadcastAdminUblast(io, releasedUblast, 'released').catch((err) => {
        console.error('Submission approval UBlast broadcast failed:', err?.message || err);
      });
    }
  }

  return res.status(200).json({ submission: updated });
}


async function listManualPlacements(req, res) {
  const now = new Date();
  const placements = await TrendingPlacement.find({
    section: 'manual',
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  })
    .sort({ position: 1, createdAt: -1 })
    .lean();
  return res.status(200).json({ placements });
}

async function createManualPlacement(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { postId, position, startAt, endAt } = req.body;
  const postExists = await Post.exists({ _id: postId });
  if (!postExists) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const normalizedPosition = Number.isFinite(Number(position))
    ? Number(position)
    : null;

  if (normalizedPosition !== null && (normalizedPosition < 1 || normalizedPosition > 16)) {
    return res
      .status(400)
      .json({ error: 'Position must be between 1 and 16.' });
  }

  const now = new Date();
  const activeMatch = {
    section: 'manual',
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  };

  let finalPosition = normalizedPosition;
  if (finalPosition === null) {
    const existing = await TrendingPlacement.find(activeMatch)
      .select('position')
      .lean();
    const used = new Set(existing.map((entry) => entry.position));
    for (let i = 1; i <= 16; i += 1) {
      if (!used.has(i)) {
        finalPosition = i;
        break;
      }
    }
  }

  if (!finalPosition) {
    return res.status(400).json({ error: 'No manual pin slots available.' });
  }

  const conflict = await TrendingPlacement.exists({
    ...activeMatch,
    position: finalPosition,
  });
  if (conflict) {
    return res.status(409).json({ error: 'Manual slot already occupied.' });
  }

  const created = await TrendingPlacement.create({
    section: 'manual',
    postId,
    position: finalPosition,
    startAt: startAt ? new Date(startAt) : now,
    endAt: endAt ? new Date(endAt) : null,
    createdBy: req.user?.id,
  });

  return res.status(201).json({ placement: created });
}

async function deleteManualPlacement(req, res) {
  const { placementId } = req.params;
  if (!mongoose.isValidObjectId(placementId)) {
    return res.status(400).json({ error: 'Invalid placement id.' });
  }
  const result = await TrendingPlacement.deleteOne({ _id: placementId });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Placement not found.' });
  }
  return res.status(200).json({ deleted: true });
}

async function updateManualPlacement(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { placementId } = req.params;
  if (!mongoose.isValidObjectId(placementId)) {
    return res.status(400).json({ error: 'Invalid placement id.' });
  }

  const nextPosition = Number(req.body.position);
  if (Number.isNaN(nextPosition) || nextPosition < 1 || nextPosition > 16) {
    return res.status(400).json({ error: 'Position must be between 1 and 16.' });
  }

  const placement = await TrendingPlacement.findById(placementId);
  if (!placement) {
    return res.status(404).json({ error: 'Placement not found.' });
  }

  const now = new Date();
  const activeMatch = {
    section: 'manual',
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  };

  const conflict = await TrendingPlacement.findOne({
    ...activeMatch,
    position: nextPosition,
    _id: { $ne: placement._id },
  });

  if (conflict) {
    const currentPosition = placement.position;
    conflict.position = currentPosition;
    await conflict.save();
  }

  placement.position = nextPosition;
  await placement.save();

  return res.status(200).json({ placement });
}

async function updateUblast(req, res) {
  const { ublastId } = req.params;
  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  const existing = await UBlast.findById(ublastId);
  if (!existing) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }
  if (existing.createdBy && existing.createdBy.toString() !== req.user?.id) {
    return res.status(403).json({ error: 'You can only edit your own UBlasts.' });
  }

  const updates = {};
  if (req.body.title !== undefined) updates.title = req.body.title;
  if (req.body.content !== undefined) updates.content = req.body.content;
  if (req.body.scheduledFor !== undefined) {
    updates.scheduledFor = req.body.scheduledFor ? new Date(req.body.scheduledFor) : undefined;
  }

  if (req.file) {
    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Unsupported media type.' });
    }
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'unap/ublasts',
      resource_type: 'auto',
      contentType: req.file.mimetype,
    });
    updates.mediaUrl = uploadResult.secure_url || uploadResult.url;
    updates.mediaType = mediaType;
  }

  const updated = await UBlast.findByIdAndUpdate(
    ublastId,
    { $set: updates },
    { new: true },
  ).lean();

  return res.status(200).json({ ublast: updated });
}

async function deleteUblast(req, res) {
  const { ublastId } = req.params;
  if (!mongoose.isValidObjectId(ublastId)) {
    return res.status(400).json({ error: 'Invalid UBlast id.' });
  }

  const existing = await UBlast.findById(ublastId);
  if (!existing) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }

  await Promise.all([
    UblastOffer.deleteMany({ ublastId: existing._id }),
    UBlast.deleteOne({ _id: existing._id }),
  ]);

  return res.status(200).json({ deleted: true });
}

module.exports = {
  createUblast,
  releaseUblast,
  listUblasts,
  listOfficialUblasts,
  getUblastEngagements,
  listSubmissions,
  reviewSubmission,
  listManualPlacements,
  createManualPlacement,
  deleteManualPlacement,
  updateManualPlacement,
  updateUblast,
  deleteUblast,
};







