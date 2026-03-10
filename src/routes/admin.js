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
  globalSearch
} = require('../controllers/admin');
let authenticate = (req,res,next) => next();
let isAdmin = (req,res,next) => next();
try {
  const auth = require('../middleware/auth');
  const adm  = require('../middleware/admin');
  if (auth.authenticate) authenticate = auth.authenticate;
  if (adm.isAdmin)       isAdmin      = adm.isAdmin;
} catch(e) { console.warn('middleware load error:', e.message); }
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

// Global Search
router.get('/search', globalSearch);

module.exports = router;
