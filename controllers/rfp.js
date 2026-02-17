const { Op } = require('sequelize');
const RFP = require('../models/RFP');
const User = require('../models/User');

const createRFP = async (req, res) => {
  try {
    const { title, description, industry, project_type, budget_min, budget_max,
      currency, location, timeline, deliverables, privacy_level, proposal_deadline, status } = req.body;

    if (!title || !description || !project_type || !proposal_deadline) {
      return res.status(400).json({
        success: false,
        error: { message: 'Title, description, project_type and proposal_deadline are required', statusCode: 400 },
      });
    }

    const rfp = await RFP.create({
      client_id: req.userId,
      title, description,
      industry: industry || [],
      project_type,
      budget_min, budget_max,
      currency: currency || 'USD',
      location: location || { remote: false },
      timeline: timeline || {},
      deliverables: deliverables || [],
      privacy_level: privacy_level || 'public',
      proposal_deadline,
      status: status || 'draft',
    });

    res.status(201).json({ success: true, data: rfp, message: 'RFP created successfully' });
  } catch (error) {
    console.error('Create RFP error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create RFP', statusCode: 500 } });
  }
};

const listRFPs = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status = 'open' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const where = {};

    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await RFP.findAndCountAll({
      where,
      include: [{ model: User, as: 'client', attributes: ['id', 'name', 'company'] }],
      limit: Number(limit),
      offset,
      order: [['createdAt', 'DESC']],
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('List RFPs error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list RFPs', statusCode: 500 } });
  }
};

const getRFPById = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id, {
      include: [{ model: User, as: 'client', attributes: ['id', 'name', 'company'] }],
    });

    if (!rfp) {
      return res.status(404).json({ success: false, error: { message: 'RFP not found', statusCode: 404 } });
    }

    await rfp.update({ view_count: rfp.view_count + 1 });
    res.json({ success: true, data: rfp });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to get RFP', statusCode: 500 } });
  }
};

const updateRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) {
      return res.status(404).json({ success: false, error: { message: 'RFP not found', statusCode: 404 } });
    }
    if (rfp.client_id !== req.userId) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized', statusCode: 403 } });
    }
    await rfp.update(req.body);
    res.json({ success: true, data: rfp, message: 'RFP updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to update RFP', statusCode: 500 } });
  }
};

const deleteRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) {
      return res.status(404).json({ success: false, error: { message: 'RFP not found', statusCode: 404 } });
    }
    if (rfp.client_id !== req.userId) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized', statusCode: 403 } });
    }
    await rfp.destroy();
    res.json({ success: true, message: 'RFP deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to delete RFP', statusCode: 500 } });
  }
};

const publishRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp || rfp.client_id !== req.userId) {
      return res.status(404).json({ success: false, error: { message: 'RFP not found', statusCode: 404 } });
    }
    await rfp.update({ status: 'open', published_at: new Date() });
    res.json({ success: true, data: rfp, message: 'RFP published' });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to publish RFP', statusCode: 500 } });
  }
};

const closeRFP = async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp || rfp.client_id !== req.userId) {
      return res.status(404).json({ success: false, error: { message: 'RFP not found', statusCode: 404 } });
    }
    await rfp.update({ status: 'cancelled' });
    res.json({ success: true, data: rfp, message: 'RFP closed' });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to close RFP', statusCode: 500 } });
  }
};

const getMyRFPs = async (req, res) => {
  try {
    const where = { client_id: req.userId };
    if (req.query.status) where.status = req.query.status;
    const rfps = await RFP.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rfps });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to get your RFPs', statusCode: 500 } });
  }
};

module.exports = { createRFP, listRFPs, getRFPById, updateRFP, deleteRFP, publishRFP, closeRFP, getMyRFPs };
