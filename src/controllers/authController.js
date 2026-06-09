const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOTPEmail } = require('../utils/mailer');
require('dotenv').config();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.register = async (req, res) => {
  const { full_name, email, student_number, password } = req.body;
  try {
    if (!email.endsWith('.ac.ke')) {
      return res.status(400).json({ error: 'Must use a university email address.' });
    }
    const existing = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (!user.is_verified) {
        const otp = generateOTP();
        const otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query('UPDATE users SET otp = $1, otp_expires_at = $2 WHERE id = $3', [otp, otp_expires_at, user.id]);
        await sendOTPEmail(email, full_name, otp);
        return res.status(200).json({ message: 'Verification code resent. Please check your email.', requires_verification: true, email });
      }
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO users (full_name, email, student_number, password_hash, role, is_verified, otp, otp_expires_at)
       VALUES ($1, $2, $3, $4, 'student', FALSE, $5, $6)`,
      [full_name, email, student_number, password_hash, otp, otp_expires_at]
    );
    await sendOTPEmail(email, full_name, otp);
    return res.status(201).json({ message: 'Account created! Please check your email for a verification code.', requires_verification: true, email });
  } catch (err) {
    console.error('Register error:', err.message, err.detail, err.code);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ error: 'Account already verified.' });
    if (!user.otp || user.otp !== otp) return res.status(400).json({ error: 'Invalid verification code.' });
    if (new Date() > new Date(user.otp_expires_at)) return res.status(400).json({ error: 'Verification code has expired. Please register again.' });
    await pool.query('UPDATE users SET is_verified = TRUE, otp = NULL, otp_expires_at = NULL WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    return res.status(200).json({
      message: 'Email verified! Welcome to RiaraTix.',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, student_number: user.student_number, role: user.role },
    });
  } catch (err) {
    console.error('Verify OTP error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Your account has been deactivated.' });
    if (!user.is_verified) return res.status(403).json({ error: 'Please verify your email before logging in.', requires_verification: true, email: user.email });
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, student_number: user.student_number, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

exports.resendOTP = async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT id, full_name, is_verified FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ error: 'Account is already verified.' });
    const otp = generateOTP();
    const otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('UPDATE users SET otp = $1, otp_expires_at = $2 WHERE id = $3', [otp, otp_expires_at, user.id]);
    await sendOTPEmail(email, user.full_name, otp);
    return res.status(200).json({ message: 'Verification code resent. Please check your email.' });
  } catch (err) {
    console.error('Resend OTP error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
 
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    if (!email || !email.endsWith('.ac.ke')) {
      return res.status(400).json({ error: 'Please provide a valid university email.' });
    }
    const result = await pool.query('SELECT id, full_name, is_verified FROM users WHERE email = $1', [email]);
    // Always return success to prevent email enumeration
    if (result.rows.length === 0 || !result.rows[0].is_verified) {
      return res.status(200).json({ message: 'If that email exists, a reset code has been sent.' });
    }
    const user = result.rows[0];
    const otp = generateOTP();
    const reset_otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      'UPDATE users SET reset_otp = $1, reset_otp_expires_at = $2 WHERE id = $3',
      [otp, reset_otp_expires_at, user.id]
    );
    await sendOTPEmail(email, user.full_name, otp, 'reset');
    return res.status(200).json({ message: 'If that email exists, a reset code has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err.message, err.detail, err.code);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
 
exports.verifyResetOTP = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = await pool.query('SELECT id, reset_otp, reset_otp_expires_at FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    const user = result.rows[0];
    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({ error: 'Invalid reset code.' });
    }
    if (new Date() > new Date(user.reset_otp_expires_at)) {
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    }
    // Mark OTP as verified by setting a short-lived window (keep reset_otp for the next step to confirm)
    await pool.query(
      'UPDATE users SET reset_otp_verified = TRUE WHERE id = $1',
      [user.id]
    );
    return res.status(200).json({ message: 'Code verified. You may now set a new password.' });
  } catch (err) {
    console.error('Verify reset OTP error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
 
exports.resetPassword = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const result = await pool.query(
      'SELECT id, reset_otp, reset_otp_expires_at, reset_otp_verified FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    const user = result.rows[0];
    // Guard: OTP must have been verified and not expired
    if (!user.reset_otp_verified) {
      return res.status(403).json({ error: 'Reset code was not verified. Please restart the process.' });
    }
    if (!user.reset_otp_expires_at || new Date() > new Date(user.reset_otp_expires_at)) {
      return res.status(400).json({ error: 'Reset session expired. Please request a new code.' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_otp = NULL, reset_otp_expires_at = NULL, reset_otp_verified = FALSE WHERE id = $2',
      [password_hash, user.id]
    );
    return res.status(200).json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
 
exports.updateProfile = async (req, res) => {
  const { full_name, phone_number } = req.body;
  try {
    if (!full_name || full_name.trim().split(' ').length < 2) {
      return res.status(400).json({ error: 'Please provide your first and last name.' });
    }
    await pool.query(
      `UPDATE users SET full_name = $1, phone_number = $2, updated_at = NOW() WHERE id = $3`,
      [full_name.trim(), phone_number?.trim() || null, req.user.id]
    );
    const result = await pool.query(
      `SELECT id, full_name, email, student_number, role, phone_number, is_verified, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];
    return res.status(200).json({ message: 'Profile updated successfully.', user });
  } catch (err) {
    console.error('Update profile error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
 
exports.me = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, student_number, role, phone_number, is_verified, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};