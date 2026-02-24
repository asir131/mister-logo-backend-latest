const express = require('express');
const { outstandWebhook } = require('../controllers/webhookController');
const { handleStripeWebhook } = require('../controllers/ublastOfferController');

const router = express.Router();

router.post('/outstand', outstandWebhook);
router.post('/stripe', handleStripeWebhook);

module.exports = router;
