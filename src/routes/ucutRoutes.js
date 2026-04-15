const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const {
  createUcut,
  listMyUcuts,
  listFeed,
  listUserUcuts,
  likeUcut,
  unlikeUcut,
  listComments,
  addComment,
  deleteUcut,
} = require('../controllers/ucutController');
const { reportUcut } = require('../controllers/reportController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
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
    body('text').optional({ nullable: true }).isString(),
    body('mediaUrl').optional({ nullable: true }).isURL({ require_protocol: true }),
    body('mediaType')
      .optional({ nullable: true })
      .isIn(['image', 'video', 'audio'])
      .withMessage('mediaType must be image, video, or audio'),
  ],
  createUcut,
);

router.get('/mine', authenticate, listMyUcuts);
router.get('/feed', authenticate, listFeed);
router.get('/user/:userId', authenticate, listUserUcuts);
router.post('/:ucutId/like', authenticate, likeUcut);
router.delete('/:ucutId/like', authenticate, unlikeUcut);
router.get('/:ucutId/comments', authenticate, listComments);
router.post('/:ucutId/comments', authenticate, addComment);
router.post(
  '/:ucutId/report',
  authenticate,
  [body('reason').trim().notEmpty().withMessage('Report reason is required')],
  reportUcut,
);
router.delete('/:ucutId', authenticate, deleteUcut);

module.exports = router;
