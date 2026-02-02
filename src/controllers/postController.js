const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const SavedPost = require('../models/SavedPost');
const { uploadMediaBuffer } = require('../services/cloudinary');
const { enqueuePostShare } = require('../services/shareQueue');
const lateApi = require('../services/lateApi');
const { resolvePlatformsForUser } = require('../services/lateAccounts');
const UBlast = require('../models/UBlast');
const User = require('../models/User');

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

function resolveUploadResourceType(mediaType) {
  if (mediaType === 'image') return 'image';
  if (mediaType === 'video' || mediaType === 'audio') return 'video';
  return 'auto';
}

function parseScheduledFor(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function scheduleShareStatus(shareToFacebook, shareToInstagram) {
  return {
    twitter: { status: 'none' },
    tiktok: { status: 'none' },
    snapchat: { status: 'none' },
    youtube: { status: 'none' },
    facebook: { status: shareToFacebook ? 'queued' : 'none' },
    instagram: { status: shareToInstagram ? 'queued' : 'none' },
  };
}

function normalizeShareTargets(rawTargets, shareToFacebook, shareToInstagram) {
  const targets = new Set();
  if (Array.isArray(rawTargets)) {
    rawTargets.forEach((target) => targets.add(String(target)));
  } else if (typeof rawTargets === 'string' && rawTargets.trim()) {
    try {
      const parsed = JSON.parse(rawTargets);
      if (Array.isArray(parsed)) {
        parsed.forEach((target) => targets.add(String(target)));
      } else {
        rawTargets
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((target) => targets.add(String(target)));
      }
    } catch (err) {
      rawTargets
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((target) => targets.add(String(target)));
    }
  }

  if (shareToFacebook) targets.add('facebook');
  if (shareToInstagram) targets.add('instagram');
  return Array.from(targets);
}

function buildShareStatusFromTargets(targets) {
  const queued = new Set(targets || []);
  return {
    twitter: { status: queued.has('twitter') ? 'pending' : 'none' },
    tiktok: { status: queued.has('tiktok') ? 'pending' : 'none' },
    snapchat: { status: queued.has('snapchat') ? 'pending' : 'none' },
    youtube: { status: queued.has('youtube') ? 'pending' : 'none' },
    facebook: { status: queued.has('facebook') ? 'pending' : 'none' },
    instagram: { status: queued.has('instagram') ? 'pending' : 'none' },
  };
}

function buildAttemptsFromTargets(targets) {
  const base = {
    twitter: 0,
    tiktok: 0,
    snapchat: 0,
    youtube: 0,
    facebook: 0,
    instagram: 0,
  };
  const selected = new Set(targets || []);
  Object.keys(base).forEach((key) => {
    if (!selected.has(key)) {
      base[key] = 0;
    }
  });
  return base;
}

async function enforceUblastShareRequirement(userId) {
  const now = new Date();
  const activeUblasts = await UBlast.find({
    status: 'released',
    expiresAt: { $gt: now },
  })
    .select('_id')
    .lean();

  if (activeUblasts.length === 0) return null;

  const shared = await Post.find({
    userId,
    ublastId: { $in: activeUblasts.map((ublast) => ublast._id) },
  })
    .select('ublastId')
    .lean();

  if (shared.length < 1) {
    return 'You must share at least one active UBlast before creating new posts.';
  }
  return null;
}

async function createPost(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { description } = req.body;
  const scheduledForRaw = req.body.scheduledFor;
  const scheduledForInput = parseScheduledFor(scheduledForRaw);
  const now = new Date();

  if (scheduledForRaw && !scheduledForInput) {
    return res.status(400).json({ error: 'scheduledFor must be a valid date.' });
  }

  if (scheduledForInput && scheduledForInput.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'scheduledFor must be in the future.' });
  }

  if (!scheduledForInput) {
    const ublastError = await enforceUblastShareRequirement(userId);
    if (ublastError) {
      return res.status(403).json({ error: ublastError });
    }
  }

  const hasFile = Boolean(req.file);
  const mediaUrl = req.body.mediaUrl;
  const mediaType = hasFile ? detectMediaType(req.file.mimetype) : req.body.mediaType;

  if (!hasFile && (!mediaUrl || !mediaType)) {
    return res.status(400).json({ error: 'Media file or mediaUrl+mediaType is required.' });
  }

  if (hasFile && !mediaType) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  if (!hasFile && !['image', 'video', 'audio'].includes(mediaType)) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  let resolvedMediaUrl = mediaUrl;

  if (!mediaType) {
    return res.status(400).json({ error: 'Unsupported media type.' });
  }

  const shareToFacebook = Boolean(req.body.shareToFacebook);
  const shareToInstagram = Boolean(req.body.shareToInstagram);
  const shareTargets = normalizeShareTargets(
    req.body.shareTargets,
    shareToFacebook,
    shareToInstagram,
  );
  const user = await User.findById(userId).select('lateAccountId').lean();

  try {
    if (hasFile) {
      console.log('Post upload:', {
        mimetype: req.file.mimetype,
        mediaType,
        resourceType: resolveUploadResourceType(mediaType),
      });
    }
    let uploadResult;
    if (hasFile) {
      uploadResult = await uploadMediaBuffer(req.file.buffer, {
        folder: 'mister/posts',
        resource_type: resolveUploadResourceType(mediaType),
      });
      resolvedMediaUrl = uploadResult.secure_url || uploadResult.url;
    }

    const isScheduled = Boolean(scheduledForInput);
    const shareStatus = isScheduled
      ? {
          twitter: { status: 'none' },
          tiktok: { status: 'none' },
          snapchat: { status: 'none' },
          youtube: { status: 'none' },
          facebook: { status: 'none' },
          instagram: { status: 'none' },
        }
      : buildShareStatusFromTargets(shareTargets);

    const created = await Post.create({
      userId,
      description,
      mediaType,
      mediaUrl: resolvedMediaUrl,
      mediaPublicId: hasFile ? uploadResult.public_id : undefined,
      mimeType: hasFile ? req.file.mimetype : undefined,
      size: hasFile ? req.file.size : undefined,
      shareToFacebook,
      shareToInstagram,
      shareTargets,
      shareStatus,
      attempts: buildAttemptsFromTargets(shareTargets),
      status: isScheduled ? 'scheduled' : 'published',
      scheduledFor: isScheduled ? scheduledForInput : undefined,
      publishedAt: isScheduled ? undefined : now,
    });

    if (isScheduled && shareTargets.length > 0) {
      try {
        const { platforms, missing, lateProfileId } = await resolvePlatformsForUser(
          userId,
          shareTargets,
        );
        if (missing.length) {
          const failedStatus = {};
          missing.forEach((platform) => {
            failedStatus[`shareStatus.${platform}`] = {
              status: 'failed',
              error: 'Platform account not connected.',
              updatedAt: new Date(),
            };
          });
          await Post.updateOne({ _id: created._id }, { $set: failedStatus });
        }
        if (platforms.length === 0) {
          return res.status(201).json({
            message: 'Post scheduled successfully.',
            post: created,
          });
        }
        const latePost = await lateApi.createPost({
          content: description || '',
          mediaUrls: [created.mediaUrl],
          platforms,
          scheduledAt: scheduledForInput.toISOString(),
          lateAccountId: lateProfileId,
        });
        await Post.updateOne(
          { _id: created._id },
          {
            $set: {
              latePostId: latePost.id || latePost.postId,
              shareStatus: buildShareStatusFromTargets(shareTargets),
            },
          },
        );
      } catch (err) {
        console.error('LATE scheduled post error:', err);
        const failedStatus = {};
        shareTargets.forEach((platform) => {
          failedStatus[`shareStatus.${platform}`] = {
            status: 'failed',
            error: err.message,
            updatedAt: new Date(),
          };
        });
        await Post.updateOne(
          { _id: created._id },
          { $set: failedStatus },
        );
      }
    }

    if (!isScheduled) {
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
    }

    return res.status(201).json({
      message: isScheduled
        ? 'Post scheduled successfully.'
        : 'Post created successfully.',
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

  if (post.status === 'published' || !post.status) {
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
  }

  return res.status(200).json({ message: 'Post deleted.' });
}

async function updatePost(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  if (req.body.scheduledFor) {
    return res.status(400).json({ error: 'Use scheduled edit for scheduled posts.' });
  }

  const post = await Post.findOne({ _id: postId, userId });
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  if (post.status === 'scheduled') {
    return res.status(400).json({ error: 'Use scheduled edit for scheduled posts.' });
  }

  const updates = {};
  if (req.body.description !== undefined) {
    updates.description = req.body.description;
  }
  if (req.body.shareToFacebook !== undefined) {
    updates.shareToFacebook = Boolean(req.body.shareToFacebook);
  }
  if (req.body.shareToInstagram !== undefined) {
    updates.shareToInstagram = Boolean(req.body.shareToInstagram);
  }

  const shouldUpdateTargets =
    req.body.shareTargets !== undefined ||
    req.body.shareToFacebook !== undefined ||
    req.body.shareToInstagram !== undefined;
  if (shouldUpdateTargets) {
    const shareTargets = normalizeShareTargets(
      req.body.shareTargets ?? post.shareTargets,
      updates.shareToFacebook ?? post.shareToFacebook,
      updates.shareToInstagram ?? post.shareToInstagram,
    );
    updates.shareTargets = shareTargets;
    updates.shareStatus = buildShareStatusFromTargets(shareTargets);
    updates.attempts = buildAttemptsFromTargets(shareTargets);
  }

  if (req.file) {
    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Unsupported media type.' });
    }
    try {
      const uploadResult = await uploadMediaBuffer(req.file.buffer, {
        folder: 'mister/posts',
        resource_type: resolveUploadResourceType(mediaType),
      });
      updates.mediaType = mediaType;
      updates.mediaUrl = uploadResult.secure_url || uploadResult.url;
      updates.mediaPublicId = uploadResult.public_id;
      updates.mimeType = req.file.mimetype;
      updates.size = req.file.size;
    } catch (err) {
      console.error('Update post upload error:', err);
      return res.status(500).json({ error: 'Could not upload media.' });
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No changes provided.' });
  }

  const previousMediaType = post.mediaType;
  const previousMediaUrl = post.mediaUrl;

  post.set(updates);
  await post.save();

  if (post.status === 'published' || !post.status) {
    const profileUpdates = [];
    const newMediaType = updates.mediaType || previousMediaType;
    const newMediaUrl = updates.mediaUrl || previousMediaUrl;

    if (updates.mediaUrl) {
      const inc = {};
      if (previousMediaType && newMediaType && previousMediaType !== newMediaType) {
        inc[`${previousMediaType}Count`] = -1;
        inc[`${newMediaType}Count`] = 1;
      }

      profileUpdates.push(
        Profile.updateOne(
          { userId },
          {
            $pull: {
              [`${previousMediaType}Posts`]: { postId: post._id },
            },
          },
        ),
      );

      const pushPayload = {
        $push: {
          [`${newMediaType}Posts`]: {
            postId: post._id,
            mediaUrl: newMediaUrl,
            description: post.description,
            createdAt: post.createdAt,
          },
        },
      };
      if (Object.keys(inc).length) {
        pushPayload.$inc = inc;
      }
      profileUpdates.push(Profile.updateOne({ userId }, pushPayload));
    } else if (updates.description !== undefined && newMediaType) {
      profileUpdates.push(
        Profile.updateOne(
          { userId },
          {
            $set: {
              [`${newMediaType}Posts.$[entry].description`]: post.description,
            },
          },
          { arrayFilters: [{ 'entry.postId': post._id }] },
        ),
      );
    }

    if (profileUpdates.length) {
      await Promise.all(profileUpdates);
    }
  }

  if (updates.shareTargets && post.status !== 'scheduled') {
    enqueuePostShare(post);
  }

  return res.status(200).json({ post });
}

async function sharePostInternal({ userId, postId }) {
  if (!mongoose.isValidObjectId(postId)) {
    return { status: 400, error: 'Invalid post id.' };
  }

  const ublastError = await enforceUblastShareRequirement(userId);
  if (ublastError) {
    return { status: 403, error: ublastError };
  }

  const source = await Post.findById(postId).lean();
  if (!source) {
    return { status: 404, error: 'Post not found.' };
  }

  if (
    (source.status && source.status !== 'published') ||
    source.status === 'removed' ||
    source.isApproved === false
  ) {
    return { status: 400, error: 'Post is not available for sharing.' };
  }

  if (!source.mediaUrl || !source.mediaType) {
    return { status: 400, error: 'Post media is missing.' };
  }

  const profile = await Profile.findOne({ userId }).lean();
  if (!profile) {
    return { status: 400, error: 'Profile required before sharing.' };
  }

  const created = await Post.create({
    userId,
    description: source.description,
    mediaType: source.mediaType,
    mediaUrl: source.mediaUrl,
    shareToFacebook: false,
    shareToInstagram: false,
    shareStatus: {
      twitter: { status: 'none' },
      tiktok: { status: 'none' },
      snapchat: { status: 'none' },
      youtube: { status: 'none' },
      facebook: { status: 'none' },
      instagram: { status: 'none' },
    },
    ublastId: source.ublastId,
    sharedFromPostId: source._id,
    status: 'published',
    publishedAt: new Date(),
  });

  await Profile.updateOne(
    { userId },
    {
      $inc: {
        postsCount: 1,
        [`${source.mediaType}Count`]: 1,
      },
      $push: {
        [`${source.mediaType}Posts`]: {
          postId: created._id,
          mediaUrl: created.mediaUrl,
          description: created.description,
          createdAt: created.createdAt,
        },
      },
    },
  );

  return { post: created };
}

async function sharePost(req, res) {
  const { id: userId } = req.user;
  const { postId } = req.params;

  const result = await sharePostInternal({ userId, postId });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json({ post: result.post });
}

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function listScheduledPosts(req, res) {
  const userId = req.user.id;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 10, 50);
  const skip = (page - 1) * limit;

  const match = {
    userId,
    status: 'scheduled',
    scheduledFor: { $exists: true },
  };

  const [totalCount, posts] = await Promise.all([
    Post.countDocuments(match),
    Post.find(match)
      .sort({ scheduledFor: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    posts,
    page,
    totalPages,
    totalCount,
  });
}

async function updateScheduledPost(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const userId = req.user.id;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const scheduledForInput = parseScheduledFor(req.body.scheduledFor);
  if (!scheduledForInput) {
    return res.status(400).json({ error: 'scheduledFor must be provided.' });
  }
  if (scheduledForInput.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'scheduledFor must be in the future.' });
  }

  const updates = {
    scheduledFor: scheduledForInput,
  };

  if (req.body.description !== undefined) {
    updates.description = req.body.description;
  }
  if (req.body.shareToFacebook !== undefined) {
    updates.shareToFacebook = Boolean(req.body.shareToFacebook);
  }
  if (req.body.shareToInstagram !== undefined) {
    updates.shareToInstagram = Boolean(req.body.shareToInstagram);
  }
  if (req.body.shareTargets !== undefined) {
    updates.shareTargets = normalizeShareTargets(
      req.body.shareTargets,
      updates.shareToFacebook ?? false,
      updates.shareToInstagram ?? false,
    );
    updates.shareStatus = buildShareStatusFromTargets(updates.shareTargets);
  }

  if (req.file) {
    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: 'Unsupported media type.' });
    }
    const uploadResult = await uploadMediaBuffer(req.file.buffer, {
      folder: 'mister/posts',
      resource_type: resolveUploadResourceType(mediaType),
    });
    updates.mediaType = mediaType;
    updates.mediaUrl = uploadResult.secure_url || uploadResult.url;
    updates.mediaPublicId = uploadResult.public_id;
    updates.mimeType = req.file.mimetype;
    updates.size = req.file.size;
  }

  const updated = await Post.findOneAndUpdate(
    { _id: postId, userId, status: 'scheduled' },
    { $set: updates },
    { new: true },
  );

  if (!updated) {
    return res.status(404).json({ error: 'Scheduled post not found.' });
  }

  return res.status(200).json({ post: updated });
}

async function cancelScheduledPost(req, res) {
  const userId = req.user.id;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const updated = await Post.findOneAndUpdate(
    { _id: postId, userId, status: 'scheduled' },
    { $set: { status: 'cancelled' } },
    { new: true },
  );

  if (!updated) {
    return res.status(404).json({ error: 'Scheduled post not found.' });
  }

  return res.status(200).json({ post: updated });
}

async function listMyPosts(req, res) {
  const userId = req.user.id;
  const viewerId = new mongoose.Types.ObjectId(userId);
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 10, 50);
  const skip = (page - 1) * limit;

  const match = { userId: viewerId };

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
          as: 'author',
        },
      },
      { $unwind: '$author' },
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
        $lookup: {
          from: 'comments',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
            { $sort: { createdAt: -1 } },
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
                _id: 1,
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
          ],
          as: 'comments',
        },
      },
      {
        $lookup: {
          from: 'likes',
          let: { postId: '$_id', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$postId', '$$postId'] },
                    { $eq: ['$userId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerLike',
        },
      },
      {
        $lookup: {
          from: 'savedposts',
          let: { postId: '$_id', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$postId', '$$postId'] },
                    { $eq: ['$userId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerSaved',
        },
      },
      {
        $addFields: {
          likeCount: {
            $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0],
          },
          commentCount: {
            $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0],
          },
          viewerHasLiked: { $gt: [{ $size: '$viewerLike' }, 0] },
          viewerIsFollowing: false,
          viewerHasSaved: { $gt: [{ $size: '$viewerSaved' }, 0] },
          isShared: { $cond: [{ $ifNull: ['$sharedFromPostId', false] }, true, false] },
        },
      },
      {
        $project: {
          description: 1,
          mediaType: 1,
          mediaUrl: 1,
          ublastId: 1,
          sharedFromPostId: 1,
          createdAt: 1,
          status: 1,
          isShared: 1,
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          viewerHasLiked: 1,
          viewerIsFollowing: 1,
          viewerHasSaved: 1,
          comments: 1,
          author: {
            id: '$author._id',
            name: '$author.name',
            email: '$author.email',
          },
          profile: {
            username: '$profile.username',
            displayName: '$profile.displayName',
            role: '$profile.role',
            profileImageUrl: '$profile.profileImageUrl',
          },
        },
      },
    ]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    posts,
    page,
    totalPages,
    totalCount,
  });
}

async function deleteCancelledScheduledPost(req, res) {
  const userId = req.user.id;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const deleted = await Post.findOneAndDelete({
    _id: postId,
    userId,
    status: 'cancelled',
  });

  if (!deleted) {
    return res.status(404).json({ error: 'Cancelled scheduled post not found.' });
  }

  return res.status(200).json({ message: 'Cancelled scheduled post deleted.' });
}

module.exports = {
  createPost,
  deletePost,
  updatePost,
  sharePost,
  sharePostInternal,
  listScheduledPosts,
  updateScheduledPost,
  cancelScheduledPost,
  deleteCancelledScheduledPost,
  listMyPosts,
};
