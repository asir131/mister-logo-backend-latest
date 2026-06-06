const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const {
  completeProfile,
  updateProfile,
  getProfile,
} = require('../controllers/profileController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isProfileImage = file.fieldname === 'profileImage' && file.mimetype.startsWith('image/');
    const isUsnapVideo = file.fieldname === 'usnapVideo' && file.mimetype.startsWith('video/');
    const isUsnapThumbnail = file.fieldname === 'usnapThumbnail' && file.mimetype.startsWith('image/');
    if (!isProfileImage && !isUsnapVideo && !isUsnapThumbnail) {
      const err = new Error('Only profile images and USnap videos are allowed.');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const router = express.Router();

const urlField = (field, label) =>
  body(field)
    .optional({ nullable: true, checkFalsy: true })
    .isURL({ require_protocol: true })
    .withMessage(`${label} must be a valid URL with http/https.`);

const dateOfBirthField = body('dateOfBirth')
  .optional({ nullable: true, checkFalsy: true })
  .isISO8601()
  .withMessage('Date of birth must be a valid date (YYYY-MM-DD).')
  .toDate()
  .custom((value) => {
    if (value && value > new Date()) {
      throw new Error('Date of birth cannot be in the future.');
    }
    return true;
  });

router.post(
  '/complete',
  authenticate,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'usnapVideo', maxCount: 1 },
    { name: 'usnapThumbnail', maxCount: 1 },
  ]),
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('role').trim().notEmpty().withMessage('Role is required'),
    body('displayName').optional({ nullable: true }).trim(),
    dateOfBirthField,
    body('bio').optional({ nullable: true }).trim(),
    body('usnapDurationMs').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }),
    body('autoTranslateEnabled').optional({ nullable: true }).isBoolean().toBoolean(),
    body('preferredLanguage').optional({ nullable: true }).isString(),
    urlField('instagramUrl', 'Instagram URL'),
    urlField('tiktokUrl', 'TikTok URL'),
    urlField('youtubeUrl', 'YouTube URL'),
    urlField('facebookUrl', 'Facebook URL'),
    urlField('twitterUrl', 'Twitter URL'),
    urlField('snapchatUrl', 'Snapchat URL'),
    urlField('spotifyArtistUrl', 'Spotify artist URL'),
    urlField('businessLink', 'Buseness link'),
  ],
  completeProfile,
);

router.get('/me', authenticate, getProfile);

router.patch(
  '/me',
  authenticate,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'usnapVideo', maxCount: 1 },
    { name: 'usnapThumbnail', maxCount: 1 },
  ]),
  [
    body('username').optional({ nullable: true }).trim().notEmpty(),
    body('role').optional({ nullable: true }).trim(),
    body('displayName').optional({ nullable: true }).trim(),
    dateOfBirthField,
    body('bio').optional({ nullable: true }).trim(),
    body('usnapDurationMs').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }),
    body('removeUsnapVideo').optional({ nullable: true }).isBoolean().toBoolean(),
    body('autoTranslateEnabled').optional({ nullable: true }).isBoolean().toBoolean(),
    body('preferredLanguage').optional({ nullable: true }).isString(),
    urlField('instagramUrl', 'Instagram URL'),
    urlField('tiktokUrl', 'TikTok URL'),
    urlField('youtubeUrl', 'YouTube URL'),
    urlField('facebookUrl', 'Facebook URL'),
    urlField('twitterUrl', 'Twitter URL'),
    urlField('snapchatUrl', 'Snapchat URL'),
    urlField('spotifyArtistUrl', 'Spotify artist URL'),
    urlField('businessLink', 'Buseness link'),
  ],
  updateProfile,
);

module.exports = router;
