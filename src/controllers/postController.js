const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const SavedPost = require('../models/SavedPost');
const { uploadMediaBuffer, uploadImageBuffer } = require('../services/mediaStorage');
const { compressVideoBufferIfNeeded, MB } = require('../services/videoCompression');
const { createPreviewFromUrl } = require('../services/videoPreview');
const { enqueuePreviewTask } = require('../services/previewQueue');
const { createSignedReadUrlFromUrl, createSignedReadUrlFromObjectName } = require('../services/gcsStorage');
const { enqueuePostShare } = require('../services/shareQueue');
const outstandApi = require('../services/outstandApi');
const { resolveAccountsForUser } = require('../services/outstandAccounts');
const UBlast = require('../models/UBlast');
const User = require('../models/User');
const VIDEO_DIRECT_UPLOAD_LIMIT_BYTES =
  Number.parseInt(process.env.VIDEO_DIRECT_UPLOAD_LIMIT_MB || '100', 10) * MB;
const VIDEO_COMPRESS_TARGET_BYTES =
  Number.parseInt(process.env.VIDEO_COMPRESS_TARGET_MB || '260', 10) * MB;
const VIDEO_MAX_INPUT_BYTES =
  Number.parseInt(process.env.VIDEO_MAX_INPUT_MB || '1000', 10) * MB;

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

function normalizePostType(value) {
  if (!value) return 'upost';
  const normalized = String(value).toLowerCase();
  if (['upost', 'uclip', 'ushare', 'ublast'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveUploadResourceType(mediaType) {
  if (mediaType === 'image') return 'image';
  if (mediaType === 'video' || mediaType === 'audio') return 'video';
  return 'auto';
}

function toPlayableCloudinaryVideoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('/res.cloudinary.com/') || !url.includes('/video/upload/')) {
    return url;
  }
  const upgradedQuality = url.replace(/q_auto:[^,/]+/g, 'q_auto:best');
  if (upgradedQuality !== url) {
    return upgradedQuality;
  }
  if (url.includes('/video/upload/f_mp4,') || url.includes('/video/upload/f_mp4/')) {
    if (url.includes('/video/upload/f_mp4,vc_h264,ac_aac/')) {
      return url.replace(
        '/video/upload/f_mp4,vc_h264,ac_aac/',
        '/video/upload/f_mp4,vc_h264,ac_aac,q_auto:best/',
      );
    }
    if (url.includes('/video/upload/f_mp4/')) {
      return url.replace('/video/upload/f_mp4/', '/video/upload/f_mp4,q_auto:best/');
    }
    return url.replace('/video/upload/f_mp4,', '/video/upload/f_mp4,q_auto:best,');
  }
  return url.replace(
    '/video/upload/',
    '/video/upload/f_mp4,vc_h264,ac_aac,q_auto:best/'
  );
}

function normalizeMediaUrlForPlayback(mediaUrl, mediaType) {
  if (mediaType !== 'video') return mediaUrl;
  return toPlayableCloudinaryVideoUrl(mediaUrl);
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

async function generateVideoPreview(postId, mediaUrl) {
  if (!postId || !mediaUrl) return '';
  try {
    let sourceUrl = mediaUrl;
    try {
      const proxyObjectName = extractObjectNameFromProxyUrl(mediaUrl);
      if (proxyObjectName) {
        const signed = await createSignedReadUrlFromObjectName(proxyObjectName, 20);
        sourceUrl = signed.readUrl;
      } else {
        const signed = await createSignedReadUrlFromUrl(mediaUrl, 20);
        sourceUrl = signed.readUrl;
      }
    } catch (err) {
      // Non-GCS URLs fall back to the original mediaUrl.
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
    await Post.updateOne(
      { _id: postId },
      { $set: { mediaPreviewUrl: previewUpload.secure_url || previewUpload.url } },
    );
    return previewUpload.secure_url || previewUpload.url || '';
  } catch (err) {
    console.error('Post preview generation failed:', err?.message || err);
    return '';
  }
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

function normalizeShareTarget(value) {
  const target = String(value || '').toLowerCase().trim();
  if (!target) return '';
  if (target === 'x') return 'twitter';
  return target;
}

function pickDescriptionCandidate(source) {
  if (!source) return '';
  const direct = String(source.description || '').trim();
  if (direct) return direct;
  const content = String(source.content || '').trim();
  if (content) return content;
  const text = String(source.text || '').trim();
  if (text) return text;
  return '';
}

async function resolveSharedDescription(source) {
  // First priority: current source description/content/text
  const first = pickDescriptionCandidate(source);
  if (first) return first;

  // Fallback: walk sharedFrom chain a few steps to preserve original caption
  let currentId = source?.sharedFromPostId;
  let depth = 0;
  while (currentId && depth < 4) {
    const parent = await Post.findById(currentId)
      .select('description content text sharedFromPostId')
      .lean();
    if (!parent) break;
    const candidate = pickDescriptionCandidate(parent);
    if (candidate) return candidate;
    currentId = parent.sharedFromPostId;
    depth += 1;
  }

  return '';
}

function isBlockedUntil(dateValue) {
  if (!dateValue) return false;
  return new Date(dateValue).getTime() > Date.now();
}

function isUserUblastIneligible(user) {
  if (!user) return true;
  if (user.isBlocked || user.isBanned) return true;
  if (user.ublastManualBlocked) return true;
  if (isBlockedUntil(user.ublastBlockedUntil)) return true;
  return false;
}

async function createPost(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const { description } = req.body;
  const scheduledForRaw = req.body.scheduledFor;
  const scheduledForInput = parseScheduledFor(scheduledForRaw);
  const now = new Date();
  const postType = normalizePostType(req.body.postType);

  if (scheduledForRaw && !scheduledForInput) {
    return res.status(400).json({ error: 'scheduledFor must be a valid date.' });
  }

  if (scheduledForInput && scheduledForInput.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'scheduledFor must be in the future.' });
  }

  if (!postType) {
    return res.status(400).json({ error: 'postType must be upost, uclip, ushare, or ublast.' });
  }

  const hasFile = Boolean(req.file);
  const mediaUrl = req.body.mediaUrl;
  const mediaPreviewUrl = req.body.mediaPreviewUrl;
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

  if (postType === 'uclip' && mediaType !== 'video') {
    return res.status(400).json({ error: 'UClips must be video only.' });
  }

  let resolvedMediaUrl = normalizeMediaUrlForPlayback(mediaUrl, mediaType);

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
    let uploadBuffer = req.file?.buffer;
    let uploadMimetype = req.file?.mimetype;
    let uploadSize = req.file?.size || 0;
    if (hasFile) {
      if (mediaType === 'video') {
        const compressed = await compressVideoBufferIfNeeded({
          buffer: uploadBuffer,
          mimetype: uploadMimetype,
          inputSize: uploadSize,
          targetBytes: VIDEO_COMPRESS_TARGET_BYTES,
          maxInputBytes: VIDEO_MAX_INPUT_BYTES,
        });
        uploadBuffer = compressed.buffer;
        uploadMimetype = compressed.mimetype;
        uploadSize = compressed.outputSize;
        if (compressed.compressed) {
          console.log('Post video compressed:', {
            originalBytes: compressed.originalSize,
            outputBytes: compressed.outputSize,
            thresholdBytes: VIDEO_DIRECT_UPLOAD_LIMIT_BYTES,
          });
        }
      }
      uploadResult = await uploadMediaBuffer(uploadBuffer, {
        folder: 'mister/posts',
        resource_type: resolveUploadResourceType(mediaType),
        contentType: uploadMimetype,
      });
      resolvedMediaUrl = normalizeMediaUrlForPlayback(uploadResult.secure_url || uploadResult.url, mediaType);
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
      mediaPreviewUrl: mediaPreviewUrl || undefined,
      postType,
      mediaPublicId: hasFile ? uploadResult.public_id : undefined,
      mimeType: hasFile ? uploadMimetype : undefined,
      size: hasFile ? uploadSize : undefined,
      shareToFacebook,
      shareToInstagram,
      shareTargets,
      shareStatus,
      attempts: buildAttemptsFromTargets(shareTargets),
      status: isScheduled ? 'scheduled' : 'published',
      scheduledFor: isScheduled ? scheduledForInput : undefined,
      publishedAt: isScheduled ? undefined : now,
    });

    if (mediaType === 'video' && !created.mediaPreviewUrl) {
      const immediatePreviewUrl = await generateVideoPreview(created._id, created.mediaUrl);
      if (immediatePreviewUrl) {
        created.mediaPreviewUrl = immediatePreviewUrl;
      } else {
        enqueuePreviewTask(
          () => generateVideoPreview(created._id, created.mediaUrl),
          { priority: true }
        );
      }
    }

    if (isScheduled && shareTargets.length > 0) {
      try {
        const shareTargetsForOutstand = shareTargets.filter(
          (target) => target !== "twitter",
        );
        if (shareTargets.includes("twitter")) {
          await Post.updateOne(
            { _id: created._id },
            {
              $set: {
                "shareStatus.twitter": {
                  status: "skipped",
                  error: "User-initiated share required.",
                  updatedAt: new Date(),
                },
              },
            },
          );
        }
        if (shareTargetsForOutstand.length === 0) {
          return res.status(201).json({
            message: 'Post scheduled successfully.',
            post: created,
          });
        }
        const { accountIds, missing } = await resolveAccountsForUser(
          userId,
          shareTargetsForOutstand,
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
        if (accountIds.length === 0) {
          return res.status(201).json({
            message: 'Post scheduled successfully.',
            post: created,
          });
        }
        const outstandPost = await outstandApi.createPost({
          content: description || '',
          mediaUrls: [created.mediaUrl],
          accounts: accountIds,
          scheduledAt: scheduledForInput.toISOString(),
        });
        await Post.updateOne(
          { _id: created._id },
          {
            $set: {
              latePostId: outstandPost.id || outstandPost.postId,
              shareStatus: buildShareStatusFromTargets(shareTargets),
            },
          },
        );
      } catch (err) {
        console.error('Outstand scheduled post error:', err);
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
  if (req.body.postType !== undefined) {
    const normalized = normalizePostType(req.body.postType);
    if (!normalized || normalized !== post.postType) {
      return res.status(400).json({ error: 'postType cannot be changed.' });
    }
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
    if (post.postType === 'uclip' && mediaType !== 'video') {
      return res.status(400).json({ error: 'UClips must be video only.' });
    }
    try {
      let uploadBuffer = req.file.buffer;
      let uploadMimetype = req.file.mimetype;
      let uploadSize = req.file.size || 0;
      if (mediaType === 'video') {
        const compressed = await compressVideoBufferIfNeeded({
          buffer: uploadBuffer,
          mimetype: uploadMimetype,
          inputSize: uploadSize,
          targetBytes: VIDEO_COMPRESS_TARGET_BYTES,
          maxInputBytes: VIDEO_MAX_INPUT_BYTES,
        });
        uploadBuffer = compressed.buffer;
        uploadMimetype = compressed.mimetype;
        uploadSize = compressed.outputSize;
      }
      const uploadResult = await uploadMediaBuffer(uploadBuffer, {
        folder: 'mister/posts',
        resource_type: resolveUploadResourceType(mediaType),
        contentType: uploadMimetype,
      });
      updates.mediaType = mediaType;
      updates.mediaUrl = normalizeMediaUrlForPlayback(uploadResult.secure_url || uploadResult.url, mediaType);
      updates.mediaPublicId = uploadResult.public_id;
      updates.mimeType = uploadMimetype;
      updates.size = uploadSize;
    if (mediaType === 'video') {
      enqueuePreviewTask(
        () => generateVideoPreview(post._id, updates.mediaUrl),
        { priority: true }
      );
    }
    } catch (err) {
      console.error('Update post upload error:', err);
      return res.status(err?.status || 500).json({ error: err?.message || 'Could not upload media.' });
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

async function sharePostInternal({ userId, postId, target }) {
  if (!mongoose.isValidObjectId(postId)) {
    return { status: 400, error: 'Invalid post id.' };
  }

  const source = await Post.findById(postId).lean();
  if (!source) {
    return { status: 404, error: 'Post not found.' };
  }

  const isUblastOrigin =
    Boolean(source?.ublastId) || String(source?.postType || '').toLowerCase() === 'ublast';
  if (isUblastOrigin) {
    const user = await User.findById(userId)
      .select('ublastBlockedUntil ublastManualBlocked isBlocked isBanned')
      .lean();
    if (!user) {
      return { status: 404, error: 'User not found.' };
    }
    if (isUserUblastIneligible(user)) {
      return { status: 403, error: 'You are not eligible to share UBlast now.' };
    }
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

  const resolvedDescription = await resolveSharedDescription(source);

  const profile = await Profile.findOne({ userId }).lean();
  if (!profile) {
    return { status: 400, error: 'Profile required before sharing.' };
  }

  const normalizedTarget = normalizeShareTarget(target);
  const strictExternalOnlyTargets = new Set(['youtube']);
  const externalTargets = new Set([
    'instagram',
    'twitter',
    'tiktok',
    'youtube',
    'snapchat',
    'spotify',
  ]);
  const statusTrackableTargets = new Set([
    'instagram',
    'twitter',
    'tiktok',
    'youtube',
    'snapchat',
  ]);

  let externalTarget = externalTargets.has(normalizedTarget)
    ? normalizedTarget
    : '';
  let shareTargets =
    externalTarget && statusTrackableTargets.has(externalTarget)
      ? [externalTarget]
      : [];
  let targetWarning = null;

  let accountIds = [];
  if (externalTarget === "twitter") {
    targetWarning = "X share must be user-initiated.";
    externalTarget = '';
    shareTargets = [];
  }

  if (externalTarget) {
    try {
      const resolved = await resolveAccountsForUser(userId, [externalTarget]);
      accountIds = resolved.accountIds || [];
      if (!accountIds.length || (resolved.missing || []).length) {
        if (strictExternalOnlyTargets.has(externalTarget)) {
          return {
            status: 400,
            error: `${externalTarget} account not connected.`,
          };
        }
        targetWarning = `${externalTarget} account not connected. Shared only in UNAP.`;
        externalTarget = '';
        shareTargets = [];
      }
    } catch (err) {
      if (strictExternalOnlyTargets.has(externalTarget)) {
        return {
          status: 500,
          error:
            err.message || `Could not prepare ${externalTarget} share.`,
        };
      }
      targetWarning =
        err.message || `Could not prepare ${externalTarget} share. Shared only in UNAP.`;
      externalTarget = '';
      shareTargets = [];
    }
  }

  // YouTube shares from post share modal should not create an in-app shared post.
  if (externalTarget && strictExternalOnlyTargets.has(externalTarget)) {
    try {
      await outstandApi.createPost({
        content: source.description || '',
        mediaUrls: [source.mediaUrl],
        accounts: accountIds,
      });
      return {
        post: null,
        message: `Post shared and queued to ${externalTarget}.`,
      };
    } catch (err) {
      return {
        status: 502,
        error: err.message || `${externalTarget} publish failed.`,
      };
    }
  }

  const created = await Post.create({
    userId,
    description: resolvedDescription,
    mediaType: source.mediaType,
    mediaUrl: source.mediaUrl,
    shareToFacebook: shareTargets.includes('facebook'),
    shareToInstagram: shareTargets.includes('instagram'),
    shareTargets,
    shareStatus: buildShareStatusFromTargets(shareTargets),
    attempts: buildAttemptsFromTargets(shareTargets),
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

  if (externalTarget) {
    try {
      const outstandPost = await outstandApi.createPost({
        content: created.description || '',
        mediaUrls: [created.mediaUrl],
        accounts: accountIds,
      });
      await Post.updateOne(
        { _id: created._id },
        { $set: { latePostId: outstandPost.id || outstandPost.postId } },
      );
    } catch (err) {
      if (statusTrackableTargets.has(externalTarget)) {
        await Post.updateOne(
          { _id: created._id },
          {
            $set: {
              [`shareStatus.${externalTarget}`]: {
                status: 'failed',
                error: err.message || 'External share failed.',
                updatedAt: new Date(),
              },
            },
            $inc: { [`attempts.${externalTarget}`]: 1 },
          },
        );
      }
      return {
        post: created,
        warning: `Shared in app, but ${externalTarget} publish failed.`,
      };
    }

    return {
      post: created,
      message: `Post shared and queued to ${externalTarget}.`,
    };
  }

  return {
    post: created,
    message: targetWarning || undefined,
  };
}

async function sharePost(req, res) {
  const { id: userId } = req.user;
  const { postId } = req.params;
  const { target } = req.body || {};

  const result = await sharePostInternal({ userId, postId, target });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json({
    post: result.post,
    message: result.message || result.warning,
    warning: result.warning,
  });
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
    let uploadBuffer = req.file.buffer;
    let uploadMimetype = req.file.mimetype;
    let uploadSize = req.file.size || 0;
    if (mediaType === 'video') {
      const compressed = await compressVideoBufferIfNeeded({
        buffer: uploadBuffer,
        mimetype: uploadMimetype,
        inputSize: uploadSize,
        targetBytes: VIDEO_COMPRESS_TARGET_BYTES,
        maxInputBytes: VIDEO_MAX_INPUT_BYTES,
      });
      uploadBuffer = compressed.buffer;
      uploadMimetype = compressed.mimetype;
      uploadSize = compressed.outputSize;
    }
    const uploadResult = await uploadMediaBuffer(uploadBuffer, {
      folder: 'mister/posts',
      resource_type: resolveUploadResourceType(mediaType),
      contentType: uploadMimetype,
    });

    updates.mediaType = mediaType;
    updates.mediaUrl = normalizeMediaUrlForPlayback(uploadResult.secure_url || uploadResult.url, mediaType);
    updates.mediaPublicId = uploadResult.public_id;
    updates.mimeType = uploadMimetype;
    updates.size = uploadSize;
    if (mediaType === 'video') {
      const immediatePreviewUrl = await generateVideoPreview(postId, updates.mediaUrl);
      if (immediatePreviewUrl) {
        updates.mediaPreviewUrl = immediatePreviewUrl;
      } else {
        enqueuePreviewTask(
          () => generateVideoPreview(postId, updates.mediaUrl),
          { priority: true }
        );
      }
    }
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
          mediaPreviewUrl: 1,
          ublastId: 1,
          sharedFromPostId: 1,
          postType: 1,
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

async function listUclips(req, res) {
  const viewerId = new mongoose.Types.ObjectId(req.user.id);
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 10, 50);
  const skip = (page - 1) * limit;

  const visibilityMatch = {
    postType: 'uclip',
    mediaType: 'video',
    $and: [
      { $or: [{ status: 'published' }, { status: { $exists: false } }] },
      { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
    ],
  };

  const [totalCount, posts] = await Promise.all([
    Post.countDocuments(visibilityMatch),
    Post.aggregate([
      { $match: visibilityMatch },
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
          from: 'posts',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$sharedFromPostId', '$$postId'] } } },
            { $count: 'count' },
          ],
          as: 'shareCounts',
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
          from: 'follows',
          let: { authorId: '$userId', viewerId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$followingId', '$$authorId'] },
                    { $eq: ['$followerId', '$$viewerId'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'viewerFollow',
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
          likeCount: { $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0] },
          commentCount: { $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0] },
          shareCount: { $ifNull: [{ $arrayElemAt: ['$shareCounts.count', 0] }, 0] },
          viewerHasLiked: { $gt: [{ $size: '$viewerLike' }, 0] },
          viewerIsFollowing: {
            $cond: [
              { $eq: ['$userId', viewerId] },
              false,
              { $gt: [{ $size: '$viewerFollow' }, 0] },
            ],
          },
          viewerHasSaved: { $gt: [{ $size: '$viewerSaved' }, 0] },
        },
      },
      {
        $addFields: {
          score: {
            $add: [
              '$likeCount',
              '$commentCount',
              '$shareCount',
              { $ifNull: ['$viewCount', 0] },
            ],
          },
        },
      },
      { $sort: { createdAt: -1, score: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          description: 1,
          mediaType: 1,
          mediaUrl: 1,
          mediaPreviewUrl: 1,
          postType: 1,
          createdAt: 1,
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          shareCount: 1,
          viewerHasLiked: 1,
          viewerIsFollowing: 1,
          viewerHasSaved: 1,
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

async function getPostById(req, res) {
  const { id: userId } = req.user;
  const { postId } = req.params;

  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const viewerId = new mongoose.Types.ObjectId(userId);
  const objectPostId = new mongoose.Types.ObjectId(postId);

  const source = await Post.findById(postId)
    .select('userId status isApproved postType')
    .lean();

  if (!source) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const isOwner = source.userId?.toString() === userId.toString();
  const isVisibleToViewer =
    isOwner ||
    ((source.status === 'published' || source.status === undefined) &&
      (source.isApproved === true || source.isApproved === undefined) &&
      source.postType !== 'uclip');

  if (!isVisibleToViewer) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  const [post] = await Post.aggregate([
    { $match: { _id: objectPostId } },
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
        from: 'follows',
        let: { authorId: '$userId', viewerId },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$followingId', '$$authorId'] },
                  { $eq: ['$followerId', '$$viewerId'] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'viewerFollow',
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
        likeCount: { $ifNull: [{ $arrayElemAt: ['$likeCounts.count', 0] }, 0] },
        commentCount: { $ifNull: [{ $arrayElemAt: ['$commentCounts.count', 0] }, 0] },
        viewerHasLiked: { $gt: [{ $size: '$viewerLike' }, 0] },
        viewerIsFollowing: {
          $cond: [
            { $eq: ['$userId', viewerId] },
            false,
            { $gt: [{ $size: '$viewerFollow' }, 0] },
          ],
        },
        viewerHasBookmarked: { $gt: [{ $size: '$viewerSaved' }, 0] },
      },
    },
    {
      $project: {
        description: 1,
        mediaType: 1,
        mediaUrl: 1,
        mediaPreviewUrl: 1,
        ublastId: 1,
        createdAt: 1,
        viewCount: 1,
        likeCount: 1,
        commentCount: 1,
        viewerHasLiked: 1,
        viewerIsFollowing: 1,
        viewerHasBookmarked: 1,
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
  ]);

  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  let postWithDueAt = post;
  if (post?.ublastId && mongoose.isValidObjectId(post.ublastId)) {
    const ublast = await UBlast.findById(post.ublastId)
      .select('releasedAt createdAt')
      .lean();

    if (ublast) {
      const releasedAt = ublast.releasedAt || ublast.createdAt;
      if (releasedAt) {
        const shareWindowHours = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);
        postWithDueAt = {
          ...post,
          dueAt: new Date(
            new Date(releasedAt).getTime() + shareWindowHours * 60 * 60 * 1000,
          ),
        };
      }
    }
  }

  return res.status(200).json({ post: postWithDueAt });
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

async function requestPreview(req, res) {
  const { postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  const post = await Post.findById(postId).select('mediaType mediaUrl mediaPreviewUrl').lean();
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }
  if (post.mediaType !== 'video') {
    return res.status(400).json({ error: 'Preview is only available for video posts.' });
  }

  if (post.mediaPreviewUrl) {
    return res.status(200).json({
      status: 'ready',
      mediaPreviewUrl: post.mediaPreviewUrl,
    });
  }

  enqueuePreviewTask(
    () => generateVideoPreview(postId, post.mediaUrl),
    { priority: true }
  );
  return res.status(202).json({ status: 'processing' });
}

module.exports = {
  createPost,
  deletePost,
  updatePost,
  sharePost,
  sharePostInternal,
  getPostById,
  listScheduledPosts,
  updateScheduledPost,
  cancelScheduledPost,
  deleteCancelledScheduledPost,
  listMyPosts,
  listUclips,
  requestPreview,
};

