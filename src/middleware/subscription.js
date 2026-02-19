const User = require('../models/User');
const RFP = require('../models/RFP');
const { Op } = require('sequelize');

const canPostProject = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    const tier = user.subscription_tier || 'free';
    const status = user.subscription_status || 'active';

    if (status !== 'active') {
      return res.status(403).json({
        success: false,
        error: { 
          message: 'Your subscription is not active. Please renew to continue.',
          code: 'SUBSCRIPTION_INACTIVE'
        },
      });
    }

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

    if (tier === 'free') {
      if (totalProjects >= 1) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Free tier limit reached (1 project). Upgrade to post more!',
            code: 'LIMIT_REACHED',
            tier: 'free',
            limit: 1,
            current: totalProjects
          },
        });
      }
    } else if (tier === 'monthly') {
      if (projectsThisMonth >= 5) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Monthly limit reached (5 projects). Upgrade to Annual for unlimited!',
            code: 'LIMIT_REACHED',
            tier: 'monthly',
            limit: 5,
            current: projectsThisMonth
          },
        });
      }
    }

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
