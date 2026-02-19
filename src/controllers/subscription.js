const User = require('../models/User');
const RFP = require('../models/RFP');
const { Op } = require('sequelize');

// Get current user's subscription info
const getSubscriptionInfo = async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    // Count projects
    const totalProjects = await RFP.count({ where: { client_id: req.userId } });
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const projectsThisMonth = await RFP.count({
      where: {
        client_id: req.userId,
        createdAt: { [Op.gte]: startOfMonth }
      }
    });

    const tier = user.subscription_tier || 'free';
    const limits = {
      free: { total: 1, monthly: 1 },
      monthly: { total: 'unlimited', monthly: 5 },
      annual: { total: 'unlimited', monthly: 'unlimited' }
    };

    res.json({
      success: true,
      data: {
        tier,
        status: user.subscription_status || 'active',
        subscription_start: user.subscription_start,
        subscription_end: user.subscription_end,
        stripe_customer_id: user.stripe_customer_id,
        usage: {
          totalProjects,
          projectsThisMonth,
          limits: limits[tier]
        },
        canPost: (
          tier === 'annual' ||
          (tier === 'monthly' && projectsThisMonth < 5) ||
          (tier === 'free' && totalProjects < 1)
        )
      }
    });
  } catch (error) {
    console.error('Get subscription info error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get subscription info' },
    });
  }
};

// Upgrade subscription (manual for now, Stripe webhook will handle auto)
const upgradeSubscription = async (req, res) => {
  try {
    const { tier, stripe_customer_id, stripe_subscription_id } = req.body;

    if (!['monthly', 'annual'].includes(tier)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid subscription tier' },
      });
    }

    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    const now = new Date();
    const end = new Date();
    if (tier === 'monthly') {
      end.setMonth(end.getMonth() + 1);
    } else {
      end.setFullYear(end.getFullYear() + 1);
    }

    await user.update({
      subscription_tier: tier,
      subscription_status: 'active',
      subscription_start: now,
      subscription_end: end,
      stripe_customer_id: stripe_customer_id || user.stripe_customer_id,
      stripe_subscription_id: stripe_subscription_id || user.stripe_subscription_id
    });

    res.json({
      success: true,
      data: {
        tier: user.subscription_tier,
        status: user.subscription_status,
        subscription_end: user.subscription_end
      },
      message: `Successfully upgraded to ${tier} plan!`
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to upgrade subscription' },
    });
  }
};

// Cancel subscription
const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    await user.update({
      subscription_status: 'cancelled',
      // Keep tier active until end date
    });

    res.json({
      success: true,
      message: 'Subscription cancelled. You can continue using until ' + 
        new Date(user.subscription_end).toLocaleDateString()
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel subscription' },
    });
  }
};

// Create Stripe checkout session (placeholder - will integrate with Stripe)
const createCheckoutSession = async (req, res) => {
  try {
    const { tier } = req.body;
    
    if (!['monthly', 'annual'].includes(tier)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid subscription tier' },
      });
    }

    const prices = {
      monthly: { amount: 2900, interval: 'month' }, // $29.00
      annual: { amount: 19900, interval: 'year' }   // $199.00
    };

    // TODO: Integrate with Stripe API to create actual checkout session
    // For now, return mock data
    res.json({
      success: true,
      data: {
        checkoutUrl: `/checkout/${tier}`,
        price: prices[tier],
        tier
      },
      message: 'Stripe integration coming soon! Manual upgrade available.'
    });
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create checkout session' },
    });
  }
};

module.exports = {
  getSubscriptionInfo,
  upgradeSubscription,
  cancelSubscription,
  createCheckoutSession
};
