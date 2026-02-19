const User = require('../models/User');
const RFP = require('../models/RFP');

// Check if user can post a project based on their subscription
const canPostProject = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    // Get subscription tier (default to 'free' if not set)
    const tier = user.subscription_tier || 'free';
    const status = user.subscription_status || 'active';

    // Check if subscription is active
    if (status !== 'active') {
      return res.status(403).json({
        success: false,
        error: { 
          message: 'Your subscription is not active. Please renew to continue posting projects.',
          code: 'SUBSCRIPTION_INACTIVE'
        },
      });
    }

    // Count user's projects
    const totalProjects = await RFP.count({ where: { client_id: req.userId } });
    
    // Get projects posted this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const projectsThisMonth = await RFP.count({
      where: {
        client_id: req.userId,
        createdAt: { [require('sequelize').Op.gte]: startOfMonth }
      }
    });

    // Check limits based on tier
    if (tier === 'free') {
      if (totalProjects >= 1) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'You have reached your free tier limit (1 project). Upgrade to post more!',
            code: 'LIMIT_REACHED',
            tier: 'free',
            limit: 1,
            current: totalProjects,
            upgradeUrl: '/pricing'
          },
        });
      }
    } else if (tier === 'monthly') {
      if (projectsThisMonth >= 5) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'You have reached your monthly limit (5 projects this month). Upgrade to Annual for unlimited!',
            code: 'LIMIT_REACHED',
            tier: 'monthly',
            limit: 5,
            current: projectsThisMonth,
            upgradeUrl: '/pricing'
          },
        });
      }
    }
    // Annual tier = unlimited, no check needed

    // User can post - attach stats to request for use in controller
    req.userStats = {
      tier,
      totalProjects,
      projectsThisMonth,
      limit: tier === 'free' ? 1 : tier === 'monthly' ? 5 : 'unlimited'
    };

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to check subscription limits' },
    });
  }
};

module.exports = { canPostProject };
