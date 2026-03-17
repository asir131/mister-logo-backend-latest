const express = require('express');
const { body } = require('express-validator');

const authenticate = require('../middleware/auth');
const { signUpload, createResumableUpload } = require('../controllers/uploadController');

const router = express.Router();

router.post(
  '/signature',
  authenticate,
  [
    body('folder').optional({ nullable: true }).isString(),
    body('resourceType').optional({ nullable: true }).isIn(['image', 'video', 'raw']),
    body('publicId').optional({ nullable: true }).isString(),
    body('contentType').optional({ nullable: true }).isString(),
    body('fileName').optional({ nullable: true }).isString(),
  ],
  signUpload,
);

router.post(
  '/resumable',
  authenticate,
  [
    body('folder').optional({ nullable: true }).isString(),
    body('fileName').optional({ nullable: true }).isString(),
    body('contentType').optional({ nullable: true }).isString(),
  ],
  createResumableUpload,
);

module.exports = router;
