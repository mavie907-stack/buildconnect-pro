const { Router } = require('express');
const {
  createRFP,
  listRFPs,
  getRFPById,
  updateRFP,
  deleteRFP,
  publishRFP,
  closeRFP,
  getMyRFPs
} = require('../controllers/rfp');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = Router();

// Public routes (no auth required)
router.get('/', optionalAuth, listRFPs);
router.get('/:id', optionalAuth, getRFPById);

// Protected routes (auth required)
router.post('/', authenticate, createRFP);
router.get('/my', authenticate, getMyRFPs);
router.put('/:id', authenticate, updateRFP);
router.delete('/:id', authenticate, deleteRFP);
router.post('/:id/publish', authenticate, publishRFP);
router.post('/:id/close', authenticate, closeRFP);

module.exports = router;
