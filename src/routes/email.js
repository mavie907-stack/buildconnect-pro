const { Router } = require('express');
const { sendBulkEmail, getEmailTemplates } = require('../controllers/email');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(isAdmin);

// Send bulk email
router.post('/bulk', sendBulkEmail);

// Get email templates
router.get('/templates', getEmailTemplates);

module.exports = router;
