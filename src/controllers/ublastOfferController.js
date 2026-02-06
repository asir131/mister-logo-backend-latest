const mongoose = require('mongoose');
const Stripe = require('stripe');

const UblastOffer = require('../models/UblastOffer');
const UBlast = require('../models/UBlast');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const APP_WEB_BASE_URL = process.env.APP_WEB_BASE_URL || 'http://localhost:3000';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function listMyOffers(req, res) {
  const userId = req.user.id;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, offers] = await Promise.all([
    UblastOffer.countDocuments({ userId }),
    UblastOffer.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('ublastId', 'title content mediaUrl mediaType rewardLabel rewardType')
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({ offers, page, totalPages, totalCount });
}

async function createPaymentIntent(req, res) {
  const { offerId } = req.params;
  if (!mongoose.isValidObjectId(offerId)) {
    return res.status(400).json({ error: 'Invalid offer id.' });
  }
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  const offer = await UblastOffer.findOne({ _id: offerId, userId: req.user.id });
  if (!offer) {
    return res.status(404).json({ error: 'Offer not found.' });
  }
  if (offer.status !== 'pending') {
    return res.status(400).json({ error: 'Offer is not payable.' });
  }
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    offer.status = 'expired';
    await offer.save();
    return res.status(400).json({ error: 'Offer expired.' });
  }

  const intent = await stripe.paymentIntents.create({
    amount: offer.priceCents,
    currency: offer.currency || 'usd',
    metadata: { offerId: offer._id.toString(), userId: offer.userId.toString() },
  });

  offer.paymentIntentId = intent.id;
  await offer.save();

  return res.status(200).json({
    clientSecret: intent.client_secret,
  });
}

async function createCheckoutSession(req, res) {
  const { offerId } = req.params;
  if (!mongoose.isValidObjectId(offerId)) {
    return res.status(400).json({ error: 'Invalid offer id.' });
  }
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  const offer = await UblastOffer.findOne({ _id: offerId, userId: req.user.id })
    .populate('ublastId', 'title')
    .lean();
  if (!offer) {
    return res.status(404).json({ error: 'Offer not found.' });
  }
  if (offer.status !== 'pending') {
    return res.status(400).json({ error: 'Offer is not payable.' });
  }
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    await UblastOffer.updateOne(
      { _id: offerId },
      { $set: { status: 'expired' } },
    );
    return res.status(400).json({ error: 'Offer expired.' });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_intent_data: {
      metadata: { offerId: offer._id.toString(), userId: offer.userId.toString() },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: offer.currency || 'usd',
          unit_amount: offer.priceCents,
          product_data: {
            name: offer.ublastId?.title || 'UBlast Offer',
          },
        },
      },
    ],
    success_url: `${APP_WEB_BASE_URL}/trending?payment=success&offerId=${offer._id}`,
    cancel_url: `${APP_WEB_BASE_URL}/trending?payment=cancel&offerId=${offer._id}`,
  });

  return res.status(200).json({ url: session.url });
}

async function cancelOffer(req, res) {
  const { offerId } = req.params;
  if (!mongoose.isValidObjectId(offerId)) {
    return res.status(400).json({ error: 'Invalid offer id.' });
  }

  const offer = await UblastOffer.findOne({ _id: offerId, userId: req.user.id });
  if (!offer) {
    return res.status(404).json({ error: 'Offer not found.' });
  }
  if (offer.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending offers can be cancelled.' });
  }
  offer.status = 'cancelled';
  offer.cancelledAt = new Date();
  await offer.save();

  return res.status(200).json({ offerId: offer._id, status: offer.status });
}

async function handleStripeWebhook(req, res) {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const offerId = intent.metadata?.offerId;
    if (offerId && mongoose.isValidObjectId(offerId)) {
      await UblastOffer.updateOne(
        { _id: offerId },
        { $set: { status: 'paid', paidAt: new Date() } },
      );
    }
  }

  if (event.type === 'payment_intent.canceled') {
    const intent = event.data.object;
    const offerId = intent.metadata?.offerId;
    if (offerId && mongoose.isValidObjectId(offerId)) {
      await UblastOffer.updateOne(
        { _id: offerId },
        { $set: { status: 'cancelled', cancelledAt: new Date() } },
      );
    }
  }

  return res.status(200).json({ received: true });
}

module.exports = {
  listMyOffers,
  createPaymentIntent,
  createCheckoutSession,
  cancelOffer,
  handleStripeWebhook,
};
