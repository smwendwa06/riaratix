const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middleware/auth');
 
router.post('/',               authMiddleware, ticketController.purchaseTicket);       // pay now
router.post('/reserve',        authMiddleware, ticketController.reserveTicket);        // reserve, pay later
router.get('/my-tickets',      authMiddleware, ticketController.getMyTickets);
router.post('/checkin',        authMiddleware, ticketController.checkIn);
router.get('/event/:event_id', authMiddleware, ticketController.getEventTickets);
router.post('/complimentary',  authMiddleware, ticketController.issueComplimentaryTicket);
router.get('/guests/:event_id',authMiddleware, ticketController.getGuestList);
router.get('/:id',             authMiddleware, ticketController.getTicket);             // wildcard last
 
module.exports = router;