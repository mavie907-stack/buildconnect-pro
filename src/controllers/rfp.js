const RFP = require('../models/RFP');
const User = require('../models/User');
const { Op } = require('sequelize');

// Create RFP
const createRFP = async (req, res) => {
  try {
    const {
      title,
      description,
      project_type,
      budget_min,
      budget_max,
      currency,
      location,
      proposal_deadline,
      deliverables,
      status
    } = req.body;

    if (!title || !description || !project_type || !proposal_deadline) {
      return res.status(400).json({
        success: false,
        error: { message: 'Title, description, project type and deadline are required' }
      });
    }

    const rfp = await RFP.create({
      client_id: req.userId,
      title,
      description,
      project_type,
      budget_min: budget_min || null,
      budget_max: budget_max || null,
      currency: currency || 'USD',
      location: location || {},
      proposal_deadline,
      deliverables: deliverables || [],
      status: status || 'draft',
      view_count: 0,
      featured: false
    });

    const rfpWithClient = await RFP.findByPk(rfp.id, {
      include: [{ 
        model: User, 
        as: 'client', 
        attributes: ['id', 'name', 'email', 'company'] 
      }]
    });

    res.status(201).json({
      success: true,
      data: rfpWithClient,
      message: 'Project created successfully'
    });

  } catch (error) {
    console.error('Create RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create project', details: error.message }
    });
  }
};

// List RFPs
const listRFPs = async (req, res) => {
  try {
    const { 
      status, 
      search, 
      project_type,
      page = 1, 
      limit = 20 
    } = req.query;

    const offset = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;
    if (project_type) where.project_type = project_type;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await RFP.findAndCountAll({
      where,
      include: [{ 
        model: User, 
        as: 'client', 
        attributes: ['id', 'name', 'email', 'company', 'role'] 
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('List RFPs error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load projects' }
    });
  }
};

// Get RFP by ID
const getRFPById = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id, {
      include: [{ 
        model: User, 
        as: 'client', 
        attributes: ['id', 'name', 'email', 'company', 'role', 'location', 'bio'] 
      }]
    });

    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' }
      });
    }

    // Increment view count
    await rfp.increment('view_count');

    res.json({
      success: true,
      data: rfp
    });

  } catch (error) {
    console.error('Get RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load project' }
    });
  }
};

// Update RFP
const updateRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);

    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' }
      });
    }

    if (rfp.client_id !== req.userId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Not authorized to update this project' }
      });
    }

    const {
      title,
      description,
      project_type,
      budget_min,
      budget_max,
      currency,
      location,
      proposal_deadline,
      deliverables,
      status
    } = req.body;

    await rfp.update({
      title: title || rfp.title,
      description: description || rfp.description,
      project_type: project_type || rfp.project_type,
      budget_min: budget_min !== undefined ? budget_min : rfp.budget_min,
      budget_max: budget_max !== undefined ? budget_max : rfp.budget_max,
      currency: currency || rfp.currency,
      location: location || rfp.location,
      proposal_deadline: proposal_deadline || rfp.proposal_deadline,
      deliverables: deliverables || rfp.deliverables,
      status: status || rfp.status
    });

    const updatedRFP = await RFP.findByPk(rfp.id, {
      include: [{ 
        model: User, 
        as: 'client', 
        attributes: ['id', 'name', 'email', 'company'] 
      }]
    });

    res.json({
      success: true,
      data: updatedRFP,
      message: 'Project updated successfully'
    });

  } catch (error) {
    console.error('Update RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update project' }
    });
  }
};

// Delete RFP
const deleteRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);

    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' }
      });
    }

    if (rfp.client_id !== req.userId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Not authorized to delete this project' }
      });
    }

    await rfp.destroy();

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete project' }
    });
  }
};

// Publish RFP
const publishRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);

    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' }
      });
    }

    if (rfp.client_id !== req.userId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Not authorized to publish this project' }
      });
    }

    await rfp.update({ status: 'open' });

    res.json({
      success: true,
      data: rfp,
      message: 'Project published successfully'
    });

  } catch (error) {
    console.error('Publish RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to publish project' }
    });
  }
};

// Close RFP
const closeRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);

    if (!rfp) {
      return res.status(404).json({
        success: false,
        error: { message: 'Project not found' }
      });
    }

    if (rfp.client_id !== req.userId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Not authorized to close this project' }
      });
    }

    await rfp.update({ status: 'closed' });

    res.json({
      success: true,
      data: rfp,
      message: 'Project closed successfully'
    });

  } catch (error) {
    console.error('Close RFP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to close project' }
    });
  }
};

// Get My RFPs
const getMyRFPs = async (req, res) => {
  try {
    const rfps = await RFP.findAll({
      where: { client_id: req.userId },
      include: [{ 
        model: User, 
        as: 'client', 
        attributes: ['id', 'name', 'email', 'company'] 
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: rfps
    });

  } catch (error) {
    console.error('Get my RFPs error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load your projects' }
    });
  }
};

module.exports = {
  createRFP,
  listRFPs,
  getRFPById,
  updateRFP,
  deleteRFP,
  publishRFP,
  closeRFP,
  getMyRFPs
};
