const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const { signUpload } = require('../controllers/uploadController');

const router = express.Router();

router.post(
  '/signature',
  authenticate,
  [
    body('folder').optional({ nullable: true }).isString(),
    body('resourceType').optional({ nullable: true }).isIn(['image', 'video', 'raw']),
    body('publicId').optional({ nullable: true }).isString(),
  ],
  signUpload,
);

module.exports = router;
