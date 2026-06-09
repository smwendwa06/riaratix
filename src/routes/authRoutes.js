const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/register',          authController.register);
router.post('/verify-otp',        authController.verifyOTP);
router.post('/resend-otp',        authController.resendOTP);
router.post('/login',             authController.login);
router.post('/forgot-password',   authController.forgotPassword);
router.post('/verify-reset-otp',  authController.verifyResetOTP);
router.post('/reset-password',    authController.resetPassword);
router.get('/me',                 authMiddleware, authController.me);
router.put('/profile',            authMiddleware, authController.updateProfile);

module.exports = router;