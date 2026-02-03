const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const { translate } = require('../controllers/translateController');

const router = express.Router();

router.post(
  '/',
  authenticate,
  [
    body('texts')
      .isArray({ min: 1 })
      .withMessage('texts must be a non-empty array'),
    body('targetLang').notEmpty().withMessage('targetLang is required'),
    body('sourceLang').optional({ nullable: true }).isString(),
  ],
  translate,
);

module.exports = router;
