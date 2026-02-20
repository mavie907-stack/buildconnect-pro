const User = require('../models/User');
const RFP = require('../models/RFP');
const { Op } = require('sequelize');

// Get public platform statistics
const getPublicStats = async (req, res) => {
  try {
    // Total counts
    const totalUsers = await User.count({ where: { is_active: true } });
    const totalProjects = await RFP.count();
    const openProjects = await RFP.count({ where: { status: 'open' } });
    
    // Count by role
    const totalProfessionals = await User.count({ 
      where: { role: 'professional', is_active: true } 
    });
    const totalClients = await User.count({ 
      where: { role: 'client', is_active: true } 
    });
    
    // Count by project type
    const residentialProjects = await RFP.count({ 
      where: { project_type: 'residential' } 
    });
    const commercialProjects = await RFP.count({ 
      where: { project_type: 'commercial' } 
    });
    const interiorProjects = await RFP.count({ 
      where: { project_type: 'interior' } 
    });
    
    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentUsers = await User.count({
      where: {
        createdAt: { [Op.gte]: thirtyDaysAgo },
        is_active: true
      }
    });
    
    const recentProjects = await RFP.count({
      where: {
        createdAt: { [Op.gte]: thirtyDaysAgo }
      }
    });
    
    // Calculate total project value (estimate from budgets)
    const projectsWithBudget = await RFP.findAll({
      attributes: ['budget_min', 'budget_max'],
      where: {
        budget_min: { [Op.ne]: null },
        budget_max: { [Op.ne]: null }
      }
    });
    
    const totalValue = projectsWithBudget.reduce((sum, project) => {
      const avg = (project.budget_min + project.budget_max) / 2;
      return sum + avg;
    }, 0);
    
    // Growth rate (compare to previous 30 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    const previousMonthProjects = await RFP.count({
      where: {
        createdAt: {
          [Op.gte]: sixtyDaysAgo,
          [Op.lt]: thirtyDaysAgo
        }
      }
    });
    
    const growthRate = previousMonthProjects > 0 
      ? ((recentProjects - previousMonthProjects) / previousMonthProjects * 100).toFixed(1)
      : 0;
    
    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalProfessionals,
          totalClients,
          totalProjects,
          openProjects,
          totalProjectValue: Math.round(totalValue),
        },
        projectsByType: {
          residential: residentialProjects,
          commercial: commercialProjects,
          interior: interiorProjects,
        },
        recentActivity: {
          newUsersLast30Days: recentUsers,
          newProjectsLast30Days: recentProjects,
          growthRate: parseFloat(growthRate),
        },
        milestones: {
          platformLaunched: '2026-02-15', // Update this to your actual launch date
          totalProjectsCompleted: Math.floor(totalProjects * 0.3), // Estimate 30% completed
          averageMatchTime: '48 hours', // You can track this later
        }
      }
    });
    
  } catch (error) {
    console.error('Get public stats error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load platform statistics' }
    });
  }
};

// Get featured projects for homepage
const getFeaturedProjects = async (req, res) => {
  try {
    const featured = await RFP.findAll({
      where: {
        status: 'open',
        featured: true
      },
      include: [{
        model: User,
        as: 'client',
        attributes: ['id', 'name', 'company', 'location']
      }],
      order: [['createdAt', 'DESC']],
      limit: 6
    });
    
    // If not enough featured, add some recent ones
    if (featured.length < 6) {
      const additional = await RFP.findAll({
        where: {
          status: 'open',
          featured: false
        },
        include: [{
          model: User,
          as: 'client',
          attributes: ['id', 'name', 'company', 'location']
        }],
        order: [['createdAt', 'DESC']],
        limit: 6 - featured.length
      });
      
      featured.push(...additional);
    }
    
    res.json({
      success: true,
      data: featured
    });
    
  } catch (error) {
    console.error('Get featured projects error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load featured projects' }
    });
  }
};

// Get recent activity feed for homepage
const getRecentActivity = async (req, res) => {
  try {
    const recentProjects = await RFP.findAll({
      include: [{
        model: User,
        as: 'client',
        attributes: ['id', 'name', 'company']
      }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });
    
    const recentUsers = await User.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'role', 'company', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 10
    });
    
    // Combine and sort by date
    const activity = [
      ...recentProjects.map(p => ({
        type: 'project',
        id: p.id,
        title: p.title,
        user: p.client?.name,
        timestamp: p.createdAt,
        data: p
      })),
      ...recentUsers.map(u => ({
        type: 'user',
        id: u.id,
        title: `${u.name} joined as ${u.role}`,
        user: u.name,
        timestamp: u.createdAt,
        data: u
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
     .slice(0, 15);
    
    res.json({
      success: true,
      data: activity
    });
    
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load recent activity' }
    });
  }
};

module.exports = {
  getPublicStats,
  getFeaturedProjects,
  getRecentActivity
};
