const express = require('express');
const router = express.Router();
const organizerController = require('../controllers/organizerController');
const authMiddleware = require('../middleware/auth');

router.get('/', organizerController.getAllOrganizers);
router.post('/', authMiddleware, organizerController.createOrganizer);
router.get('/me', authMiddleware, organizerController.getMyProfile);

module.exports = router;