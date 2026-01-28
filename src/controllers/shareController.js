const { sharePostInternal } = require('./postController');
const { shareUblastInternal } = require('./ublastController');

async function shareUnified(req, res) {
  const { id: userId } = req.user;
  const { type, id, shareType } = req.body;

  if (!type || !id) {
    return res.status(400).json({ error: 'type and id are required.' });
  }

  if (type === 'post') {
    const result = await sharePostInternal({ userId, postId: id });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(201).json({ post: result.post, sharedFromUblast: false });
  }

  if (type === 'ublast') {
    const result = await shareUblastInternal({ userId, ublastId: id, shareType });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({ post: result.post, sharedFromUblast: true });
  }

  return res.status(400).json({ error: 'type must be post or ublast.' });
}

module.exports = {
  shareUnified,
};
