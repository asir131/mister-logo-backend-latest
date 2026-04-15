const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const {
  getEligibility,
  getActiveUblasts,
  submitUblast,
  submitUblastRequest,
  listMySubmissions,
  updateSubmission,
  shareUblast,
} = require('../controllers/ublastController');
const { reportUblast } = require('../controllers/reportController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 },
});

const router = express.Router();

router.get('/eligibility', authenticate, getEligibility);
router.get('/active', authenticate, getActiveUblasts);
router.get('/submissions', authenticate, listMySubmissions);

router.post(
  '/submissions',
  authenticate,
  upload.single('media'),
  [
    body('title').optional({ nullable: true, checkFalsy: true }).isString(),
    body('content').optional({ nullable: true, checkFalsy: true }).isString(),
    body('proposedDate')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('proposedDate must be a valid date'),
  ],
  submitUblastRequest,
);

router.patch(
  '/submissions/:submissionId',
  authenticate,
  upload.single('media'),
  [
    body('title').optional({ nullable: true, checkFalsy: true }).isString(),
    body('content').optional({ nullable: true, checkFalsy: true }).isString(),
    body('proposedDate')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('proposedDate must be a valid date'),
  ],
  updateSubmission,
);

router.post(
  '/:ublastId/share',
  authenticate,
  [body('shareType').optional({ nullable: true }).isIn(['feed', 'story'])],
  shareUblast,
);
router.post(
  '/:ublastId/report',
  authenticate,
  [body('reason').trim().notEmpty().withMessage('Report reason is required')],
  reportUblast,
);

router.post(
  '/:ublastId/submissions',
  authenticate,
  upload.single('media'),
  [
    body('title').optional({ nullable: true, checkFalsy: true }).isString(),
    body('content').optional({ nullable: true, checkFalsy: true }).isString(),
    body('proposedDate')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('proposedDate must be a valid date'),
  ],
  submitUblast,
);

module.exports = router;
