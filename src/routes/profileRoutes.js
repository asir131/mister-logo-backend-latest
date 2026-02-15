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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      const err = new Error('Only image uploads are allowed.');
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
  upload.single('profileImage'),
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('role').trim().notEmpty().withMessage('Role is required'),
    body('displayName').optional({ nullable: true }).trim(),
    dateOfBirthField,
    body('bio').optional({ nullable: true }).trim(),
    body('autoTranslateEnabled').optional({ nullable: true }).isBoolean().toBoolean(),
    body('preferredLanguage').optional({ nullable: true }).isString(),
    urlField('instagramUrl', 'Instagram URL'),
    urlField('tiktokUrl', 'TikTok URL'),
    urlField('youtubeUrl', 'YouTube URL'),
    urlField('facebookUrl', 'Facebook URL'),
    urlField('spotifyArtistUrl', 'Spotify artist URL'),
  ],
  completeProfile,
);

router.get('/me', authenticate, getProfile);

router.patch(
  '/me',
  authenticate,
  upload.single('profileImage'),
  [
    body('username').optional({ nullable: true }).trim().notEmpty(),
    body('role').optional({ nullable: true }).trim(),
    body('displayName').optional({ nullable: true }).trim(),
    dateOfBirthField,
    body('bio').optional({ nullable: true }).trim(),
    body('autoTranslateEnabled').optional({ nullable: true }).isBoolean().toBoolean(),
    body('preferredLanguage').optional({ nullable: true }).isString(),
    urlField('instagramUrl', 'Instagram URL'),
    urlField('tiktokUrl', 'TikTok URL'),
    urlField('youtubeUrl', 'YouTube URL'),
    urlField('facebookUrl', 'Facebook URL'),
    urlField('spotifyArtistUrl', 'Spotify artist URL'),
  ],
  updateProfile,
);

module.exports = router;
