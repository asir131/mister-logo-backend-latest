const express = require('express');
const authenticate = require('../middleware/auth');
const { getTrending } = require('../controllers/trendingController');

const router = express.Router();

router.get('/', authenticate, getTrending);

module.exports = router;
