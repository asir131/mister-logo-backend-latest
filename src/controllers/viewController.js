const { validationResult } = require('express-validator');
const Post = require('../models/Post');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

async function recordPostView(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { postId } = req.body;

  const updated = await Post.findByIdAndUpdate(
    postId,
    { $inc: { viewCount: 1 } },
    { new: true },
  ).select('viewCount');

  if (!updated) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  return res.status(200).json({ viewCount: updated.viewCount });
}

module.exports = {
  recordPostView,
};
