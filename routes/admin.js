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

module.exports = router;
