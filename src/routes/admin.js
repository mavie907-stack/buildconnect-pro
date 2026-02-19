const { Router } = require('express');
const {
  getStats,
  getAllUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  getAllProjects,
  updateProjectStatus,
  deleteProject,
  globalSearch,
} = require('../controllers/admin');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const router = Router();

// All routes require authentication AND admin role
router.use(authenticate);
router.use(isAdmin);

// Dashboard Stats
router.get('/stats', getStats);

// User Management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Project Management
router.get('/projects', getAllProjects);
router.put('/projects/:id', updateProjectStatus);
router.delete('/projects/:id', deleteProject);
router.get('/search', globalSearch);

const globalSearch = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ 
        success: true, 
        data: { users: [], projects: [] },
        message: 'Query too short'
      });
    }

    const { Op } = require('sequelize');
    const User = require('../models/User');
    const RFP = require('../models/RFP');
    
module.exports = router;
