const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const {
  createPost,
  deletePost,
  updatePost,
  sharePost,
  getPostById,
  listScheduledPosts,
  updateScheduledPost,
  cancelScheduledPost,
  deleteCancelledScheduledPost,
  listMyPosts,
  listUclips,
  requestPreview,
} = require('../controllers/postController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');
    if (!isImage && !isVideo && !isAudio) {
      const err = new Error('Only image, video, or audio uploads are allowed.');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const router = express.Router();

router.post(
  '/',
  authenticate,
  upload.single('media'),
  [
    body('description').optional({ nullable: true }).trim(),
    body('shareToFacebook').optional({ nullable: true }).isBoolean().toBoolean(),
    body('shareToInstagram').optional({ nullable: true }).isBoolean().toBoolean(),
    body('mediaUrl').optional({ nullable: true }).isURL({ require_protocol: true }),
    body('mediaType')
      .optional({ nullable: true })
      .isIn(['image', 'video', 'audio'])
      .withMessage('mediaType must be image, video, or audio'),
    body('postType')
      .optional({ nullable: true })
      .isIn(['upost', 'uclip', 'ushare', 'ublast'])
      .withMessage('postType must be upost, uclip, ushare, or ublast'),
    body('shareTargets')
      .optional({ nullable: true })
      .custom((value) => typeof value === 'string' || Array.isArray(value)),
    body('scheduledFor')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('scheduledFor must be a valid date'),
  ],
  createPost,
);

router.patch(
  '/:postId',
  authenticate,
  upload.single('media'),
  [
    body('description').optional({ nullable: true }).trim(),
    body('shareToFacebook').optional({ nullable: true }).isBoolean().toBoolean(),
    body('shareToInstagram').optional({ nullable: true }).isBoolean().toBoolean(),
    body('shareTargets')
      .optional({ nullable: true })
      .custom((value) => typeof value === 'string' || Array.isArray(value)),
    body('postType')
      .optional({ nullable: true })
      .isIn(['upost', 'uclip', 'ushare', 'ublast'])
      .withMessage('postType must be upost, uclip, ushare, or ublast'),
  ],
  updatePost,
);
router.get('/scheduled', authenticate, listScheduledPosts);
router.get('/mine', authenticate, listMyPosts);
router.get('/uclips', authenticate, listUclips);
router.post('/:postId/preview', authenticate, requestPreview);
router.get('/:postId', authenticate, getPostById);
router.patch(
  '/:postId/scheduled',
  authenticate,
  upload.single('media'),
  [
    body('description').optional({ nullable: true }).trim(),
    body('shareToFacebook').optional({ nullable: true }).isBoolean().toBoolean(),
    body('shareToInstagram').optional({ nullable: true }).isBoolean().toBoolean(),
    body('shareTargets')
      .optional({ nullable: true })
      .custom((value) => typeof value === 'string' || Array.isArray(value)),
    body('scheduledFor')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('scheduledFor must be a valid date'),
  ],
  updateScheduledPost,
);
router.post('/:postId/cancel', authenticate, cancelScheduledPost);
router.delete('/:postId/cancelled', authenticate, deleteCancelledScheduledPost);
router.delete('/:postId', authenticate, deletePost);
router.post('/:postId/share', authenticate, sharePost);

module.exports = router;
