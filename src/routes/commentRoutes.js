const express = require('express');
const authenticate = require('../middleware/auth');
const {
  createComment,
  getComments,
  deleteComment,
  likeComment,
  unlikeComment,
} = require('../controllers/commentController');

const router = express.Router();

router.get('/', authenticate, getComments);

router.post('/', authenticate, createComment);

router.post('/:commentId/like', authenticate, likeComment);

router.delete('/:commentId/like', authenticate, unlikeComment);

router.delete('/:commentId', authenticate, deleteComment);

module.exports = router;
