const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const {
  getEligibility,
  getActiveUblasts,
  submitUblast,
  shareUblast,
} = require('../controllers/ublastController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = express.Router();

router.get('/eligibility', authenticate, getEligibility);
router.get('/active', authenticate, getActiveUblasts);

router.post(
  '/:ublastId/share',
  authenticate,
  [body('shareType').optional({ nullable: true }).isIn(['feed', 'story'])],
  shareUblast,
);

router.post(
  '/:ublastId/submissions',
  authenticate,
  upload.single('media'),
  [
    body('proposedDate')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('proposedDate must be a valid date'),
  ],
  submitUblast,
);

module.exports = router;
