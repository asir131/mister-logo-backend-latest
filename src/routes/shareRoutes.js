const express = require('express');

const authenticate = require('../middleware/auth');
const { shareUnified } = require('../controllers/shareController');

const router = express.Router();

router.post('/', authenticate, shareUnified);

module.exports = router;
