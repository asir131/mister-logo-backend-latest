const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const { sendSupportMessage, listMyThreads, listMyMessages } = require('../controllers/supportController');

const router = express.Router();

router.post(
  '/messages',
  authenticate,
  [
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('content').trim().notEmpty().withMessage('Discussion is required'),
  ],
  sendSupportMessage,
);

router.get('/threads', authenticate, listMyThreads);
router.get('/threads/:threadId/messages', authenticate, listMyMessages);

module.exports = router;
