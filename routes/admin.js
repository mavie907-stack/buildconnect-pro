const { Router } = require('express');

// DEBUG: log each import
const adminController = require('../controllers/admin');
console.log('🔍 adminController keys:', Object.keys(adminController));

const authMiddleware = require('../middleware/auth');
console.log('🔍 authMiddleware keys:', Object.keys(authMiddleware));

const adminMiddleware = require('../middleware/admin');
console.log('🔍 adminMiddleware keys:', Object.keys(adminMiddleware));

const {
  getStats, getAllUsers, getUserDetails, updateUser, deleteUser,
  getAllProjects, updateProjectStatus, deleteProject, globalSearch,
} = adminController;

const { authenticate } = authMiddleware;
const { isAdmin }      = adminMiddleware;

console.log('🔍 authenticate:', typeof authenticate);
console.log('🔍 isAdmin:', typeof isAdmin);
console.log('🔍 getStats:', typeof getStats);
console.log('🔍 globalSearch:', typeof globalSearch);

const router = Router();

router.use(authenticate);
router.use(isAdmin);

// Dashboard
router.get('/stats', getStats);

// Users
router.get('/users',        getAllUsers);
router.get('/users/:id',    getUserDetails);
router.put('/users/:id',    updateUser);
router.delete('/users/:id', deleteUser);

// Projects
router.get('/projects',        getAllProjects);
router.put('/projects/:id',    updateProjectStatus);
router.delete('/projects/:id', deleteProject);

// Search
router.get('/search', globalSearch);

module.exports = router;
