const express = require('express');
const authenticate = require('../middleware/auth');
const { createComment, getComments, deleteComment } = require('../controllers/commentController');

const router = express.Router();

router.get('/', authenticate, getComments);

router.post('/', authenticate, createComment);

router.delete('/:commentId', authenticate, deleteComment);

module.exports = router;
