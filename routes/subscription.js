const { Router } = require('express');
const {
  getSubscriptionInfo,
  upgradeSubscription,
  cancelSubscription,
  createCheckoutSession
} = require('../controllers/subscription');
const { authenticate } = require('../middleware/auth');

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get current subscription info
router.get('/me', getSubscriptionInfo);

// Create Stripe checkout session
router.post('/checkout', createCheckoutSession);

// Upgrade subscription (after successful payment)
router.post('/upgrade', upgradeSubscription);

// Cancel subscription
router.post('/cancel', cancelSubscription);

module.exports = router;
