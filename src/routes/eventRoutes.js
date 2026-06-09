const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const authMiddleware = require('../middleware/auth');

router.get('/', eventController.getAllEvents);
router.get('/organizer/my-events', authMiddleware, eventController.getMyEvents);
router.get('/:id', eventController.getEvent);
router.post('/', authMiddleware, eventController.createEvent);
router.put('/:id', authMiddleware, eventController.updateEvent);
router.delete('/:id', authMiddleware, eventController.deleteEvent);

module.exports = router;