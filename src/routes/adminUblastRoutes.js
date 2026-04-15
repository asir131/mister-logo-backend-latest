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
  updateUblast,
  deleteUblast,
} = require('../controllers/adminUblastController');
const {
  listUsers,
  restrictUser,
  unrestrictUser,
  clearLinkedAccounts,
  deleteUsersBulk,
} = require('../controllers/adminUserController');
const {
  listThreads,
  listMessages,
  updateThreadStatus,
} = require('../controllers/adminSupportController');
const {
  changeAdminPassword,
  getAdminSettings,
  updateAdminSettings,
  createAdmin,
  listAdmins,
  deleteAdmin,
  resetAdminPassword,
} = require('../controllers/adminSettingsController');
const { listUserPosts, deletePost, regeneratePreview } = require('../controllers/adminPostController');
const { getTrending } = require('../controllers/trendingController');
const { getAdminStats } = require('../controllers/adminStatsController');
const { listModerationActions } = require('../controllers/adminModerationController');
const { listReports, deleteReportedContent } = require('../controllers/adminReportController');
const { sendBulkEmail, sendBulkSms } = require('../controllers/adminCommunicationsController');
const {
  createRewardUblast,
  createOffer,
  getOfferSummary,
  listOffers,
  listRewardedUblasts,
} = require('../controllers/adminUblastOfferController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 },
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
router.patch('/ublasts/:ublastId', upload.single('media'), updateUblast);
router.delete('/ublasts/:ublastId', deleteUblast);

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
router.delete('/users/:userId/linked-accounts', clearLinkedAccounts);
router.post('/users/delete', deleteUsersBulk);
router.get('/posts', listUserPosts);
router.delete('/posts/:postId', deletePost);
router.post('/posts/:postId/preview', regeneratePreview);
router.get('/reports', listReports);
router.delete('/reports/:reportId/content', deleteReportedContent);
router.get('/stats', getAdminStats);
router.get('/moderation/actions', listModerationActions);
router.post(
  '/communications/email',
  [
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('content').trim().notEmpty().withMessage('Content is required'),
    body('filter').optional({ nullable: true }).isIn(['all', 'active', 'restricted', 'selected']),
    body('userIds').optional({ nullable: true }).isArray(),
  ],
  sendBulkEmail,
);

router.post(
  '/communications/sms',
  [
    body('content').trim().notEmpty().withMessage('Content is required'),
    body('filter').optional({ nullable: true }).isIn(['all', 'active', 'restricted', 'selected']),
    body('userIds').optional({ nullable: true }).isArray(),
  ],
  sendBulkSms,
);
router.get('/ublast-offers/summary', getOfferSummary);
router.get('/ublast-offers', listOffers);
router.get('/rewarded-ublasts', listRewardedUblasts);
router.post('/ublasts/:ublastId/reward', createRewardUblast);
router.post('/ublasts/:ublastId/offer', createOffer);

router.get('/support/threads', listThreads);
router.get('/support/threads/:threadId/messages', listMessages);
router.patch('/support/threads/:threadId/status', updateThreadStatus);
router.patch(
  '/settings/password',
  [
    body('newPassword').trim().notEmpty().withMessage('New password is required'),
    body('confirmPassword').trim().notEmpty().withMessage('Confirm password is required'),
  ],
  changeAdminPassword,
);
router.get('/settings', getAdminSettings);
router.patch(
  '/settings',
  [
    body('shareWindowHours').isInt({ min: 1 }).withMessage('Share window hours must be >= 1'),
    body('topTrendingHours').isInt({ min: 1 }).withMessage('Top trending hours must be >= 1'),
    body('restrictionDays').isInt({ min: 1 }).withMessage('Restriction days must be >= 1'),
    body('warningGraceHours').isInt({ min: 0 }).withMessage('Warning grace hours must be >= 0'),
  ],
  updateAdminSettings,
);
router.get('/settings/admins', listAdmins);
router.post(
  '/settings/admins',
  [
    body('adminId').trim().notEmpty().withMessage('Admin ID is required'),
    body('password').trim().notEmpty().withMessage('Password is required'),
  ],
  createAdmin,
);
router.delete('/settings/admins/:adminId', deleteAdmin);
router.patch(
  '/settings/admins/:adminId/password',
  [body('newPassword').trim().notEmpty().withMessage('New password is required')],
  resetAdminPassword,
);

module.exports = router;
