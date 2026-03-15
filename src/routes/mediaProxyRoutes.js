const express = require('express');
const { streamMedia } = require('../controllers/mediaProxyController');

const router = express.Router();

// Public media proxy for social share crawlers
router.get('/media', streamMedia);
router.get(/^\/media\/(.+)/, (req, res, next) => {
  req.params = req.params || {};
  req.params.objectPath = req.params[0];
  return streamMedia(req, res, next);
});

module.exports = router;
