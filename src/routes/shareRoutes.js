const express = require('express');

const authenticate = require('../middleware/auth');
const {
  shareUnified,
  sharePostByEmail,
  sharePostBySms,
} = require('../controllers/shareController');

const router = express.Router();

router.post('/', authenticate, shareUnified);
router.post('/email', authenticate, sharePostByEmail);
router.post('/sms', authenticate, sharePostBySms);

module.exports = router;
