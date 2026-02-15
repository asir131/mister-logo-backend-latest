const { validationResult } = require('express-validator');

const mongoose = require('mongoose');
const Ucut = require('../models/Ucut');
const UcutLike = require('../models/UcutLike');
const UcutComment = require('../models/UcutComment');
const Follow = require('../models/Follow');
const Profile = require('../models/Profile');
const User = require('../models/User');
const { uploadMediaBuffer } = require('../services/cloudinary');
const { splitMedia, DEFAULT_SEGMENT_SECONDS } = require('../services/mediaSplit');
const { fireAndForgetPush } = require('../services/pushNotify');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

function detectMediaType(mimetype) {
  if (!mimetype) return null;
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('image/')) return 'image';
  return null;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildExpiryDate() {
  const hours = Number(process.env.UCUT_EXPIRES_HOURS || 24);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function canViewUcut(viewerId, ownerId) {
  if (viewerId.toString() === ownerId.toString()) return true;
  const follows = await Follow.exists({
    followerId: viewerId,
    followingId: ownerId,
  });
  return Boolean(follows);
}

function activeUcutFilter() {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
}

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function resolveDisplayName(userId) {
  const [user, profile] = await Promise.all([
    User.findById(userId).select('name').lean(),
    Profile.findOne({ userId }).select('displayName username').lean(),
  ]);
  return profile?.displayName || profile?.username || user?.name || 'Someone';
}

async function createUcut(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const text = req.body?.text ? String(req.body.text).trim() : '';
  const hasText = Boolean(text);
  const hasFile = Boolean(req.file);
  const remoteMediaUrl = req.body?.mediaUrl ? String(req.body.mediaUrl).trim() : '';
  const remoteMediaTypeRaw = req.body?.mediaType ? String(req.body.mediaType).trim() : '';
  const remoteMediaType = ['image', 'video', 'audio'].includes(remoteMediaTypeRaw)
    ? remoteMediaTypeRaw
    : '';
  const hasRemoteMedia = Boolean(remoteMediaUrl && remoteMediaType);

  if (!hasText && !hasFile && !hasRemoteMedia) {
    return res.status(400).json({ error: 'Text, media file, or media URL is required.' });
  }

  if (remoteMediaUrl && !isValidHttpUrl(remoteMediaUrl)) {
    return res.status(400).json({ error: 'mediaUrl must be a valid http/https URL.' });
  }

  if (remoteMediaUrl && !remoteMediaType) {
    return res.status(400).json({ error: 'mediaType must be image, video, or audio when mediaUrl is used.' });
  }

  if (hasFile) {
    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Only image, audio, or video files are allowed.' });
    }

    if (mediaType === 'image') {
      try {
        const uploadResult = await uploadMediaBuffer(req.file.buffer, {
          folder: 'unap/ucuts',
          resource_type: 'image',
        });

        const created = await Ucut.create({
          userId,
          type: 'image',
          mediaType: 'image',
          text: hasText ? text : undefined,
          segments: [{ url: uploadResult.secure_url || uploadResult.url, order: 1 }],
          segmentCount: 1,
          expiresAt: buildExpiryDate(),
        });

        return res.status(201).json({ ucut: created, wasSplit: false });
      } catch (err) {
        return res.status(500).json({ error: 'Could not upload image.' });
      }
    }

    const segmentSeconds = Number(
      process.env.UCUT_SEGMENT_SECONDS || DEFAULT_SEGMENT_SECONDS,
    );

    let splitResult;
    try {
      splitResult = await splitMedia({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        segmentSeconds,
      });
    } catch (err) {
      return res.status(500).json({
        error: err.message || 'Unable to process media. Ensure ffmpeg/ffprobe are available.',
      });
    }

    const segmentUploads = [];
    const uploadResourceType = mediaType === 'audio' || mediaType === 'video' ? 'video' : 'auto';
    for (let i = 0; i < splitResult.segments.length; i += 1) {
      const segmentBuffer = splitResult.segments[i];
      const uploadResult = await uploadMediaBuffer(segmentBuffer, {
        folder: 'unap/ucuts',
        resource_type: uploadResourceType,
      });
      segmentUploads.push({
        url: uploadResult.secure_url || uploadResult.url,
        order: i + 1,
      });
    }

    const created = await Ucut.create({
      userId,
      type: mediaType,
      mediaType,
      text: hasText ? text : undefined,
      segments: segmentUploads,
      segmentCount: segmentUploads.length,
      originalDurationSeconds: splitResult.durationSeconds,
      segmentDurationSeconds: segmentSeconds,
      expiresAt: buildExpiryDate(),
    });

    return res.status(201).json({
      ucut: created,
      wasSplit: splitResult.wasSplit,
    });
  }

  if (hasRemoteMedia) {
    const created = await Ucut.create({
      userId,
      type: remoteMediaType,
      mediaType: remoteMediaType,
      text: hasText ? text : undefined,
      segments: [{ url: remoteMediaUrl, order: 1 }],
      segmentCount: 1,
      expiresAt: buildExpiryDate(),
    });

    return res.status(201).json({ ucut: created, wasSplit: false });
  }

  const created = await Ucut.create({
    userId,
    type: 'text',
    text,
    segments: [],
    segmentCount: 0,
    expiresAt: buildExpiryDate(),
  });

  return res.status(201).json({ ucut: created });
}

async function listMyUcuts(req, res) {
  const userId = req.user.id;
  const ucuts = await Ucut.find({
    userId,
    ...activeUcutFilter(),
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return res.status(200).json({ ucuts });
}

async function listFeed(req, res) {
  const viewerId = req.user.id;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const match = {
    ...activeUcutFilter(),
  };

  const [totalCount, ucuts] = await Promise.all([
    Ucut.countDocuments(match),
    Ucut.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const ucutIds = ucuts.map((ucut) => ucut._id);
  const ownerIds = Array.from(new Set(ucuts.map((ucut) => ucut.userId.toString())));
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: ownerIds } })
      .select('name')
      .lean(),
    Profile.find({ userId: { $in: ownerIds } })
      .select('userId displayName username profileImageUrl')
      .lean(),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const profileById = new Map(
    profiles.map((profile) => [profile.userId.toString(), profile]),
  );
  const [likeCounts, commentCounts, viewerLikes] = await Promise.all([
    UcutLike.aggregate([
      { $match: { ucutId: { $in: ucutIds } } },
      { $group: { _id: '$ucutId', count: { $sum: 1 } } },
    ]),
    UcutComment.aggregate([
      { $match: { ucutId: { $in: ucutIds } } },
      { $group: { _id: '$ucutId', count: { $sum: 1 } } },
    ]),
    UcutLike.find({ ucutId: { $in: ucutIds }, userId: viewerId })
      .select('ucutId')
      .lean(),
  ]);

  const likeById = new Map(likeCounts.map((item) => [item._id.toString(), item.count]));
  const commentById = new Map(commentCounts.map((item) => [item._id.toString(), item.count]));
  const viewerLikeSet = new Set(viewerLikes.map((entry) => entry.ucutId.toString()));

  const enriched = ucuts.map((ucut) => {
    const ownerId = ucut.userId.toString();
    const user = userById.get(ownerId);
    const profile = profileById.get(ownerId);

    return {
      ...ucut,
      likeCount: likeById.get(ucut._id.toString()) || 0,
      commentCount: commentById.get(ucut._id.toString()) || 0,
      viewerHasLiked: viewerLikeSet.has(ucut._id.toString()),
      canComment: true,
      owner: {
        id: ownerId,
        name: profile?.displayName || profile?.username || user?.name || 'Unknown',
        username: profile?.username || '',
        profileImageUrl: profile?.profileImageUrl || null,
      },
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    ucuts: enriched,
    page,
    totalPages,
    totalCount,
  });
}

async function likeUcut(req, res) {
  const userId = req.user.id;
  const { ucutId } = req.params;

  if (!mongoose.isValidObjectId(ucutId)) {
    return res.status(400).json({ error: 'Invalid UCut id.' });
  }

  const ucut = await Ucut.findOne({ _id: ucutId, ...activeUcutFilter() }).lean();
  if (!ucut) {
    return res.status(404).json({ error: 'UCut not found.' });
  }

  const result = await UcutLike.updateOne(
    { ucutId, userId },
    { $setOnInsert: { ucutId, userId } },
    { upsert: true },
  );

  const isNewLike = Boolean(result?.upsertedCount);
  const ownerId = ucut.userId?.toString();
  if (isNewLike && ownerId && ownerId !== userId) {
    const actorName = await resolveDisplayName(userId);
    fireAndForgetPush({
      userIds: [ownerId],
      title: 'New like',
      body: `${actorName} liked your UCut.`,
      data: {
        type: 'like',
        actorUserId: String(userId),
        ucutId: String(ucutId),
      },
      screen: '/screens/home/ucuts-view',
    });
  }

  return res.status(200).json({ liked: true });
}

async function unlikeUcut(req, res) {
  const userId = req.user.id;
  const { ucutId } = req.params;

  if (!mongoose.isValidObjectId(ucutId)) {
    return res.status(400).json({ error: 'Invalid UCut id.' });
  }

  await UcutLike.deleteOne({ ucutId, userId });
  return res.status(200).json({ liked: false });
}

async function listComments(req, res) {
  const userId = req.user.id;
  const { ucutId } = req.params;

  if (!mongoose.isValidObjectId(ucutId)) {
    return res.status(400).json({ error: 'Invalid UCut id.' });
  }

  const ucut = await Ucut.findOne({ _id: ucutId, ...activeUcutFilter() }).lean();
  if (!ucut) {
    return res.status(404).json({ error: 'UCut not found.' });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, comments] = await Promise.all([
    UcutComment.countDocuments({ ucutId }),
    UcutComment.find({ ucutId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    comments,
    page,
    totalPages,
    totalCount,
  });
}

async function addComment(req, res) {
  const userId = req.user.id;
  const { ucutId } = req.params;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!mongoose.isValidObjectId(ucutId)) {
    return res.status(400).json({ error: 'Invalid UCut id.' });
  }

  if (!text) {
    return res.status(400).json({ error: 'Comment text is required.' });
  }

  const ucut = await Ucut.findOne({ _id: ucutId, ...activeUcutFilter() }).lean();
  if (!ucut) {
    return res.status(404).json({ error: 'UCut not found.' });
  }

  const comment = await UcutComment.create({
    ucutId,
    userId,
    text,
  });

  const ownerId = ucut.userId?.toString();
  if (ownerId && ownerId !== userId) {
    const actorName = await resolveDisplayName(userId);
    const previewText = text.slice(0, 80);
    fireAndForgetPush({
      userIds: [ownerId],
      title: 'New comment',
      body: `${actorName}: ${previewText}`,
      data: {
        type: 'comment',
        actorUserId: String(userId),
        ucutId: String(ucutId),
      },
      screen: '/screens/home/ucuts-view',
    });
  }

  return res.status(201).json({ comment });
}

async function listUserUcuts(req, res) {
  const viewerId = req.user.id;
  const { userId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const ucuts = await Ucut.find({
    userId,
    ...activeUcutFilter(),
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  if (!ucuts.length) {
    return res.status(200).json({ ucuts: [] });
  }

  const ucutIds = ucuts.map((ucut) => ucut._id);
  const [users, profiles, likeCounts, commentCounts, viewerLikes] = await Promise.all([
    User.find({ _id: userId }).select('name').lean(),
    Profile.find({ userId }).select('userId displayName username profileImageUrl').lean(),
    UcutLike.aggregate([
      { $match: { ucutId: { $in: ucutIds } } },
      { $group: { _id: '$ucutId', count: { $sum: 1 } } },
    ]),
    UcutComment.aggregate([
      { $match: { ucutId: { $in: ucutIds } } },
      { $group: { _id: '$ucutId', count: { $sum: 1 } } },
    ]),
    UcutLike.find({ ucutId: { $in: ucutIds }, userId: viewerId })
      .select('ucutId')
      .lean(),
  ]);

  const user = users[0];
  const profile = profiles[0];
  const likeById = new Map(likeCounts.map((item) => [item._id.toString(), item.count]));
  const commentById = new Map(commentCounts.map((item) => [item._id.toString(), item.count]));
  const viewerLikeSet = new Set(viewerLikes.map((entry) => entry.ucutId.toString()));

  const owner = {
    id: userId,
    name: profile?.displayName || profile?.username || user?.name || 'Unknown',
    username: profile?.username || '',
    profileImageUrl: profile?.profileImageUrl || null,
  };

  const enriched = ucuts.map((ucut) => ({
    ...ucut,
    likeCount: likeById.get(ucut._id.toString()) || 0,
    commentCount: commentById.get(ucut._id.toString()) || 0,
    viewerHasLiked: viewerLikeSet.has(ucut._id.toString()),
    canComment: true,
    owner,
  }));

  return res.status(200).json({ ucuts: enriched });
}

async function deleteUcut(req, res) {
  const userId = req.user.id;
  const { ucutId } = req.params;

  if (!mongoose.isValidObjectId(ucutId)) {
    return res.status(400).json({ error: 'Invalid UCut id.' });
  }

  const deleted = await Ucut.findOneAndDelete({ _id: ucutId, userId });
  if (!deleted) {
    return res.status(404).json({ error: 'UCut not found.' });
  }

  await Promise.all([
    UcutLike.deleteMany({ ucutId }),
    UcutComment.deleteMany({ ucutId }),
  ]);

  return res.status(200).json({ deleted: true });
}

module.exports = {
  createUcut,
  listMyUcuts,
  listFeed,
  listUserUcuts,
  likeUcut,
  unlikeUcut,
  listComments,
  addComment,
  deleteUcut,
};
