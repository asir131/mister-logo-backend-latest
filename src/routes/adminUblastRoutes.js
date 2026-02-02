const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const requireAdmin = require('../middleware/admin');
const {
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
} = require('../controllers/adminUblastController');
const {
  listUsers,
  restrictUser,
  unrestrictUser,
} = require('../controllers/adminUserController');
const { listUserPosts } = require('../controllers/adminPostController');
const { getTrending } = require('../controllers/trendingController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = express.Router();

router.use(requireAdmin);

router.get('/ublasts', listUblasts);
router.get('/official-posts', listOfficialUblasts);
router.get('/official-posts/:ublastId/engagements', getUblastEngagements);
router.post(
  '/ublasts',
  upload.single('media'),
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('scheduledFor')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('scheduledFor must be a valid date'),
  ],
  createUblast,
);
router.post('/ublasts/:ublastId/release', releaseUblast);

router.get('/ublasts/submissions', listSubmissions);
router.patch(
  '/ublasts/submissions/:submissionId',
  [
    body('status').isIn(['approved', 'rejected']).withMessage('Invalid status'),
    body('reviewNotes').optional({ nullable: true }).isString(),
  ],
  reviewSubmission,
);

router.get('/trending/manual', listManualPlacements);
router.get('/trending/overview', getTrending);
router.post(
  '/trending/manual',
  [
    body('postId').trim().isMongoId().withMessage('Valid postId is required'),
    body('position').optional({ nullable: true }).isInt({ min: 0 }),
    body('startAt').optional({ nullable: true }).isISO8601(),
    body('endAt').optional({ nullable: true }).isISO8601(),
  ],
  createManualPlacement,
);
router.patch(
  '/trending/manual/:placementId',
  [body('position').isInt({ min: 1, max: 16 }).withMessage('Position must be 1-16')],
  updateManualPlacement,
);
router.delete('/trending/manual/:placementId', deleteManualPlacement);

router.get('/users', listUsers);
router.patch('/users/:userId/restrict', restrictUser);
router.patch('/users/:userId/unrestrict', unrestrictUser);
router.get('/posts', listUserPosts);

module.exports = router;
