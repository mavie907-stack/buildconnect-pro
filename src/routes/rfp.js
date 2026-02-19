{ Router } = require('express');
const { canPostProject } = require('../middleware/subscription');
const { createRFP, listRFPs, getRFPById, updateRFP, deleteRFP, publishRFP, closeRFP, getMyRFPs } = require('../controllers/rfp');  
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = Router();

router.get('/my', authenticate, getMyRFPs);
router.post('/', authenticate, canPostProject, createRFP);
router.get('/', optionalAuth, listRFPs);
router.get('/:id', optionalAuth, getRFPById);
router.put('/:id', authenticate, updateRFP);
router.delete('/:id', authenticate, deleteRFP);
router.post('/:id/publish', authenticate, publishRFP);
router.post('/:id/close', authenticate, closeRFP);

module.exports = router;
