const express = require('express');
const { body } = require('express-validator');
const { login } = require('../controllers/adminAuthController');

const router = express.Router();

router.post(
  '/login',
  [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('password').trim().notEmpty().withMessage('Password is required'),
  ],
  login,
);

module.exports = router;
