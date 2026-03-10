const {
  getStats, getAllUsers, getUserDetails, updateUser, deleteUser,
  getAllProjects, updateProjectStatus, deleteProject, globalSearch,
} = require('../controllers/admin');
const { authenticate } = require('../middleware/auth');
const { isAdmin }      = require('../middleware/admin');

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
