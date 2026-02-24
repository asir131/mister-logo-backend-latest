const express = require('express');
const authenticate = require('../middleware/auth');
const {
  connectOutstand,
  outstandCallback,
  listAccounts,
  disconnectAccount,
} = require('../controllers/accountsController');

const router = express.Router();

router.post('/connect-outstand', authenticate, connectOutstand);
router.get('/outstand-callback', outstandCallback);
router.get('/', authenticate, listAccounts);
router.delete('/:platform', authenticate, disconnectAccount);

module.exports = router;
