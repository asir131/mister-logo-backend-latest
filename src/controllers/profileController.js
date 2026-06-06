const { validationResult } = require('express-validator');

const Profile = require('../models/Profile');
const { uploadImageBuffer, uploadMediaBuffer } = require('../services/mediaStorage');
const { createPreviewFromUrl } = require('../services/videoPreview');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function normalizeDateOfBirth(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function uploadProfileImage(file, userId) {
  if (!file) return null;
  const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await uploadImageBuffer(file.buffer, {
    folder: 'unap/profile',
    public_id: `profile_${userId}_${uploadId}`,
    overwrite: false,
    resource_type: 'image',
    contentType: file.mimetype,
  });
  return result.secure_url || result.url;
}

function createCloudinaryVideoThumbnailUrl(videoUrl) {
  const url = String(videoUrl || '');
  if (!url.includes('/res.cloudinary.com/') || !url.includes('/video/upload/')) {
    return '';
  }
  return url.replace(
    '/video/upload/',
    '/video/upload/so_1.0,f_jpg,q_85,w_720,c_limit,e_sharpen:80/',
  );
}

async function uploadUsnapVideo(file, userId) {
  if (!file) return null;
  const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await uploadMediaBuffer(file.buffer, {
    folder: 'unap/usnaps',
    public_id: `usnap_${userId}_${uploadId}`,
    overwrite: false,
    resource_type: 'video',
    contentType: file.mimetype,
  });
  const videoUrl = result.secure_url || result.url;
  let thumbnailUrl = createCloudinaryVideoThumbnailUrl(videoUrl);

  if (!thumbnailUrl && videoUrl) {
    try {
      const previewBuffer = await createPreviewFromUrl({ sourceUrl: videoUrl, width: 720 });
      const previewResult = await uploadImageBuffer(previewBuffer, {
        folder: 'unap/usnaps/previews',
        public_id: `usnap_preview_${userId}_${uploadId}`,
        overwrite: false,
        resource_type: 'image',
        contentType: 'image/jpeg',
      });
      thumbnailUrl = previewResult.secure_url || previewResult.url || '';
    } catch (err) {
      console.warn('USnap preview generation failed:', err?.message || err);
    }
  }

  return {
    videoUrl,
    thumbnailUrl,
  };
}

async function uploadUsnapThumbnail(file, userId) {
  if (!file) return '';
  const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await uploadImageBuffer(file.buffer, {
    folder: 'unap/usnaps/previews',
    public_id: `usnap_preview_${userId}_${uploadId}`,
    overwrite: false,
    resource_type: 'image',
    contentType: file.mimetype,
  });
  return result.secure_url || result.url || '';
}

function normalizeUsnapDuration(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return durationMs;
}

async function completeProfile(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;
  const {
    username,
    displayName,
    role,
    dateOfBirth,
    bio,
    instagramUrl,
    tiktokUrl,
    youtubeUrl,
    facebookUrl,
    twitterUrl,
    snapchatUrl,
    spotifyArtistUrl,
    businessLink,
    autoTranslateEnabled,
    preferredLanguage,
  } = req.body;

  if (!req.files?.profileImage?.[0] && !req.file) {
    return res.status(400).json({ error: 'Profile image is required.' });
  }

  try {
    const existingProfile = await Profile.findOne({ userId }).lean();
    if (existingProfile) {
      return res.status(409).json({ error: 'Profile already completed.' });
    }

    const normalizedUsername = normalizeUsername(username);
    const usernameTaken = await Profile.findOne({ username: normalizedUsername }).lean();
    if (usernameTaken) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const usnapDurationMs = normalizeUsnapDuration(req.body.usnapDurationMs);
    if (usnapDurationMs && usnapDurationMs > 60000) {
      return res.status(400).json({ error: 'USnap video must be 1 minute or less.' });
    }

    const profileImageUrl = await uploadProfileImage(req.files?.profileImage?.[0] || req.file, userId);
    const usnapUpload = await uploadUsnapVideo(req.files?.usnapVideo?.[0], userId);
    const usnapThumbnailUrl =
      (await uploadUsnapThumbnail(req.files?.usnapThumbnail?.[0], userId)) ||
      usnapUpload?.thumbnailUrl ||
      undefined;

    const created = await Profile.create({
      userId,
      username: normalizedUsername,
      displayName,
      role,
      dateOfBirth: normalizeDateOfBirth(dateOfBirth) || undefined,
      bio,
      profileImageUrl,
      usnapVideoUrl: usnapUpload?.videoUrl || undefined,
      usnapThumbnailUrl,
      usnapDurationMs,
      instagramUrl,
      tiktokUrl,
      youtubeUrl,
      facebookUrl,
      twitterUrl,
      snapchatUrl,
      spotifyArtistUrl,
      businessLink,
      autoTranslateEnabled:
        autoTranslateEnabled !== undefined
          ? autoTranslateEnabled === true || autoTranslateEnabled === 'true'
          : true,
      preferredLanguage:
        preferredLanguage && preferredLanguage !== 'auto' ? preferredLanguage : undefined,
      postsCount: 0,
      followersCount: 0,
      followingCount: 0,
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      followers: [],
      following: [],
      imagePosts: [],
      videoPosts: [],
      audioPosts: [],
    });

    return res.status(201).json({
      message: 'Profile completed successfully.',
      profile: created,
    });
  } catch (err) {
    console.error('Complete profile error:', err);
    return res.status(500).json({ error: 'Could not complete profile.' });
  }
}

function assignIfPresent(target, source, key, valueTransform) {
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    target[key] = valueTransform ? valueTransform(source[key]) : source[key];
  }
}

async function updateProfile(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { id: userId } = req.user;

  try {
    const existingProfile = await Profile.findOne({ userId }).lean();
    if (!existingProfile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const updates = {};
    if (req.body.username !== undefined) {
      const normalizedUsername = normalizeUsername(req.body.username);
      const usernameTaken = await Profile.findOne({
        username: normalizedUsername,
        userId: { $ne: userId },
      }).lean();
      if (usernameTaken) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      updates.username = normalizedUsername;
    }

    assignIfPresent(updates, req.body, 'displayName');
    assignIfPresent(updates, req.body, 'role');
    assignIfPresent(updates, req.body, 'dateOfBirth', normalizeDateOfBirth);
    assignIfPresent(updates, req.body, 'bio');
    assignIfPresent(updates, req.body, 'instagramUrl');
    assignIfPresent(updates, req.body, 'tiktokUrl');
    assignIfPresent(updates, req.body, 'youtubeUrl');
    assignIfPresent(updates, req.body, 'facebookUrl');
    assignIfPresent(updates, req.body, 'twitterUrl');
    assignIfPresent(updates, req.body, 'snapchatUrl');
    assignIfPresent(updates, req.body, 'spotifyArtistUrl');
    assignIfPresent(updates, req.body, 'businessLink');
    assignIfPresent(
      updates,
      req.body,
      'autoTranslateEnabled',
      (value) => value === true || value === 'true',
    );
    assignIfPresent(
      updates,
      req.body,
      'preferredLanguage',
      (value) => {
        if (!value || value === 'auto') return null;
        return value;
      },
    );

    if (req.files?.profileImage?.[0] || req.file) {
      updates.profileImageUrl = await uploadProfileImage(req.files?.profileImage?.[0] || req.file, userId);
    }

    if (req.files?.usnapVideo?.[0]) {
      const usnapDurationMs = normalizeUsnapDuration(req.body.usnapDurationMs);
      if (usnapDurationMs && usnapDurationMs > 60000) {
        return res.status(400).json({ error: 'USnap video must be 1 minute or less.' });
      }
      const usnapUpload = await uploadUsnapVideo(req.files.usnapVideo[0], userId);
      const uploadedThumbnailUrl = await uploadUsnapThumbnail(
        req.files?.usnapThumbnail?.[0],
        userId,
      );
      updates.usnapVideoUrl = usnapUpload?.videoUrl || '';
      updates.usnapThumbnailUrl = uploadedThumbnailUrl || usnapUpload?.thumbnailUrl || '';
      updates.usnapDurationMs = usnapDurationMs;
    }

    if (req.body.removeUsnapVideo === true || req.body.removeUsnapVideo === 'true') {
      updates.usnapVideoUrl = '';
      updates.usnapThumbnailUrl = '';
      updates.usnapDurationMs = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No profile changes provided.' });
    }

    const updated = await Profile.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true },
    );

    return res.status(200).json({
      message: 'Profile updated successfully.',
      profile: updated,
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
}

async function getProfile(req, res) {
  const { id: userId } = req.user;

  try {
    const profile = await Profile.findOne({ userId }).lean();
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    return res.status(200).json({ profile });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Could not fetch profile.' });
  }
}

module.exports = {
  completeProfile,
  updateProfile,
  getProfile,
};

