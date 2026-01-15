const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');

// 1. Register & Login (Public)
router.post('/register', authController.register);
router.post('/login', authController.login);

// 2. Add New Agent (Manager Only)
router.post('/add-agent', authMiddleware, authController.createAgent);

// 👇 YE MISSING THA: Team List fetch karne ke liye
router.get('/my-team', authMiddleware, authController.getMyTeam);

// 3. Remove Agent (Manager Only)
router.delete('/remove-agent/:id', authMiddleware, authController.deleteAgent);

module.exports = router;