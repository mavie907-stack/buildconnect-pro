const { Op } = require('sequelize');
const User = require('../models/User');
const RFP = require('../models/RFP');

// Admin Dashboard Stats
const getStats = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const totalProjects = await RFP.count();
    const openProjects = await RFP.count({ where: { status: 'open' } });
    const draftProjects = await RFP.count({ where: { status: 'draft' } });
    
    const recentUsers = await User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'email', 'role', 'createdAt'],
    });

    const recentProjects = await RFP.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [{ model: User, as: 'client', attributes: ['name'] }],
    });

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalProjects,
          openProjects,
          draftProjects,
        },
        recentUsers,
        recentProjects,
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load stats' },
    });
  }
};

// Get All Users
const getAllUsers = async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (role) where.role = role;

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load users' },
    });
  }
};

// Get User Details
const getUserDetails = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [
        {
          model: RFP,
          as: 'rfps',
          limit: 10,
          order: [['createdAt', 'DESC']],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load user details' },
    });
  }
};

// Update User
const updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    const { name, email, role, company, location, bio, is_active } = req.body;
    await user.update({ name, email, role, company, location, bio, is_active });

    res.json({
      success: true,
      data: user.toPublicJSON(),
      message: 'User updated successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update user' },
    });
  }
};

// Delete User
const deleteUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
    }

    // Don't allow deleting yourself
    if (user.id === req.userId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Cannot delete your own account' },
      });
    }

    await user.destroy();
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete user' },
    });
  }
};

// Get All Projects (Admin)
const getAllProjects = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) where.status = status;

    const { count, rows } = await RFP.findAndCountAll({
      where,
      include: [{ model: User, as: 'client', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load projects' },
    });
  }
};

// Update Project Status (Admin)
const updateProjectStatus = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' },
      });
    }

    const { status, featured } = req.body;
    await rfp.update({ status, featured });

    res.json({
      success: true,
      data: rfp,
      message: 'Project updated successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update project' },
    });
  }
};

// Delete Project (Admin)
const deleteProject = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' },
      });
    }

    await rfp.destroy();
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete project' },
    });
  }
};

module.exports = {
  getStats,
  getAllUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  getAllProjects,
  updateProjectStatus,
  deleteProject,
};
