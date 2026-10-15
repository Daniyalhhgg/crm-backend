const express = require('express');
const router = express.Router();
const { register, login, getCurrentAdmin, logout } = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, getCurrentAdmin);
router.post('/logout', auth, logout);

module.exports = router;