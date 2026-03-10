1const { Router } = require('express');
2const {
3  getStats, getAllUsers, getUserDetails, updateUser, deleteUser,
4  getAllProjects, updateProjectStatus, deleteProject, globalSearch,
5} = require('../controllers/admin');
6const { authenticate } = require('../middleware/auth');
7const { isAdmin }      = require('../middleware/admin');
8
9const router = Router();
10
11router.use(authenticate);
12router.use(isAdmin);
13
14// Dashboard
15router.get('/stats', getStats);
16
17// Users
18router.get('/users',        getAllUsers);
19router.get('/users/:id',    getUserDetails);
20router.put('/users/:id',    updateUser);
21router.delete('/users/:id', deleteUser);
22
23// Projects
24router.get('/projects',        getAllProjects);
25router.put('/projects/:id',    updateProjectStatus);
26router.delete('/projects/:id', deleteProject);
27
28// Search
29router.get('/search', globalSearch);
30
31module.exports = router;
