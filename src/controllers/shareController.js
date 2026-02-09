const { sharePostInternal } = require('./postController');
const { shareUblastInternal } = require('./ublastController');

async function shareUnified(req, res) {
  const { id: userId } = req.user;
  const { type, id, shareType, postId, ublastId, target } = req.body;

  const resolvedPostId = postId || (type === 'post' ? id : null);
  const resolvedUblastId = ublastId || (type === 'ublast' ? id : null);

  if (resolvedPostId) {
    const result = await sharePostInternal({
      userId,
      postId: resolvedPostId,
      target,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(201).json({
      post: result.post,
      sharedFromUblast: false,
      message: result.message || result.warning,
      warning: result.warning,
    });
  }

  if (resolvedUblastId) {
    const result = await shareUblastInternal({ userId, ublastId: resolvedUblastId, shareType });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({ post: result.post, sharedFromUblast: true });
  }

  if (!id) {
    return res.status(400).json({ error: 'postId, ublastId, or id is required.' });
  }

  const ublastResult = await shareUblastInternal({ userId, ublastId: id, shareType });
  if (!ublastResult.error) {
    return res.status(200).json({ post: ublastResult.post, sharedFromUblast: true });
  }

  const postResult = await sharePostInternal({ userId, postId: id, target });
  if (!postResult.error) {
    return res.status(201).json({
      post: postResult.post,
      sharedFromUblast: false,
      message: postResult.message || postResult.warning,
      warning: postResult.warning,
    });
  }

  return res.status(400).json({ error: 'Invalid share request.' });
}

module.exports = {
  shareUnified,
};
