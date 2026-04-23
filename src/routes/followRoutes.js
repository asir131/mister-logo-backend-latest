const express = require('express');
const authenticate = require('../middleware/auth');
const {
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
} = require('../controllers/followController');

const router = express.Router();

router.post('/', authenticate, followUser);

router.get('/:userId/followers', authenticate, listFollowers);
router.get('/:userId/following', authenticate, listFollowing);

router.delete('/:userId', authenticate, unfollowUser);

module.exports = router;
