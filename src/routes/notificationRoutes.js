const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const {
  registerPushToken,
  unregisterPushToken,
  listMyPushTokens,
  sendPushNotification,
} = require('../controllers/notificationController');

const router = express.Router();

router.post(
  '/token',
  authenticate,
  [
    body('token').trim().notEmpty().withMessage('token is required'),
    body('platform').optional({ nullable: true }).isString(),
    body('deviceId').optional({ nullable: true }).isString(),
    body('appVersion').optional({ nullable: true }).isString(),
  ],
  registerPushToken,
);

router.delete(
  '/token',
  authenticate,
  [body('token').trim().notEmpty().withMessage('token is required')],
  unregisterPushToken,
);

router.get('/tokens/me', authenticate, listMyPushTokens);

router.post(
  '/send',
  authenticate,
  [
    body('title').optional({ nullable: true }).isString(),
    body('body').optional({ nullable: true }).isString(),
    body('token').optional({ nullable: true }).isString(),
    body('tokens').optional({ nullable: true }).isArray(),
    body('tokens.*').optional({ nullable: true }).isString(),
    body('userId').optional({ nullable: true }).isString(),
    body('screen').optional({ nullable: true }).isString(),
    body('data').optional({ nullable: true }).isObject(),
  ],
  sendPushNotification,
);

module.exports = router;
