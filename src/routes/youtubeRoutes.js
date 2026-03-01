const express = require('express');

const authenticate = require('../middleware/auth');
const {
  getYouTubeConnectUrl,
  youtubeAuthCallback,
  sharePostToYoutube,
} = require('../controllers/youtubeController');

const router = express.Router();

router.get('/connect-url', authenticate, getYouTubeConnectUrl);
router.get('/callback', youtubeAuthCallback);
router.post('/share', authenticate, sharePostToYoutube);

module.exports = router;
