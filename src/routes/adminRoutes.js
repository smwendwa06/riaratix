const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');

// Admin middleware — checks role
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
};

router.use(authMiddleware, adminOnly);

router.get('/stats', adminController.getStats);
router.get('/events', adminController.getAllEvents);
router.get('/events/pending', adminController.getPendingEvents);
router.put('/events/:id/approve', adminController.approveEvent);
router.put('/events/:id/reject', adminController.rejectEvent);
router.get('/organizers', adminController.getOrganizers);
router.put('/organizers/:id/verify', adminController.verifyOrganizer);
router.delete('/organizers/:id/reject', adminController.rejectOrganizer);
router.get('/users', adminController.getUsers);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/deactivate', adminController.deactivateUser);
router.put('/users/:id/reactivate', adminController.reactivateUser);

module.exports = router;