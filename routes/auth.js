const { Router } = require('express');
const { register, login, refreshToken, getMe, updateMe, logout } = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);

module.exports = router;
