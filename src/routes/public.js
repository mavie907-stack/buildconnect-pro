const { Router } = require('express');
const {
  getPublicStats,
  getFeaturedProjects,
  getRecentActivity
} = require('../controllers/public');

const router = Router();

// Public routes - no authentication required
router.get('/stats', getPublicStats);
router.get('/featured-projects', getFeaturedProjects);
router.get('/recent-activity', getRecentActivity);

module.exports = router;
