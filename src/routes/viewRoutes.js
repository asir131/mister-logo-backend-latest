const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const { recordPostView } = require('../controllers/viewController');

const router = express.Router();

router.post(
  '/post',
  authenticate,
  [body('postId').trim().isMongoId().withMessage('Valid postId is required')],
  recordPostView,
);

module.exports = router;
