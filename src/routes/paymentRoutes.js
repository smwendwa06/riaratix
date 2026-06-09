const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/auth');

router.post('/initiate', authMiddleware, paymentController.initiatePayment);
router.post('/callback', paymentController.mpesaCallback);
router.head('/callback', (req, res) => res.sendStatus(200)); // Daraja validates with HEAD before POST
router.get('/callback', (req, res) => res.sendStatus(200));  // also handle GET validation
router.get('/status/:ticket_id', authMiddleware, paymentController.getPaymentStatus);
router.post('/refund', authMiddleware, paymentController.requestRefund);

module.exports = router;