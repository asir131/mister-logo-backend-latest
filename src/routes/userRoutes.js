const express = require('express');

const authenticate = require('../middleware/auth');
const {
  getSuggestedArtists,
  getUserOverview,
  getUserPosts,
  searchUsers,
} = require('../controllers/userController');

const router = express.Router();

router.get('/search', authenticate, searchUsers);
router.get('/suggested-artists', authenticate, getSuggestedArtists);
router.get('/:userId/overview', authenticate, getUserOverview);
router.get('/:userId/posts', authenticate, getUserPosts);

module.exports = router;
