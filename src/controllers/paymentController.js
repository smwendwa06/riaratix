const pool = require('../config/db');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── Payment audit logger ──
const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
console.log('📁 Log directory:', LOG_DIR);

function logPayment(type, data) {
  const timestamp = new Date().toISOString();
  const logFile = path.join(LOG_DIR, `payments_${new Date().toISOString().slice(0,10)}.log`);
  const line = `[${timestamp}] [${type}] ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, line);
  console.log(`📝 Logged to ${logFile}`);
}
 
const getMpesaToken = async () => {
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      auth: {
        username: process.env.MPESA_CONSUMER_KEY.trim(),
        password: process.env.MPESA_CONSUMER_SECRET.trim(),
      },
    }
  );
  console.log('Token response:', JSON.stringify(response.data));
  return response.data.access_token;
};
 
const getMpesaPassword = () => {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
  return { password, timestamp };
};
 
const formatPhone = (phone) => {
  phone = phone.replace(/\s+/g, '').replace(/-/g, '').replace(/\+/g, '');
  if (phone.startsWith('0') && phone.length === 10) return `254${phone.slice(1)}`;
  if (phone.startsWith('254') && phone.length === 12) return phone;
  return phone; // return as-is, will fail validation below
};
 
exports.initiatePayment = async (req, res) => {
  try {
    const { ticket_id, phone_number } = req.body;
 
    // --- Validate inputs early ---
    if (!ticket_id || !phone_number) {
      return res.status(400).json({ error: 'ticket_id and phone_number are required.' });
    }
 
    const paymentResult = await pool.query(`
      SELECT p.*, t.user_id, tt.price, tt.name AS tier_name, e.title AS event_title
      FROM payments p
      JOIN tickets t ON p.ticket_id = t.id
      JOIN ticket_tiers tt ON t.tier_id = tt.id
      JOIN events e ON tt.event_id = e.id
      WHERE p.ticket_id = $1 AND t.user_id = $2
    `, [ticket_id, req.user.id]);
 
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }
 
    const payment = paymentResult.rows[0];
 
    if (payment.status === 'completed') {
      return res.status(400).json({ error: 'This ticket has already been paid for.' });
    }
 
    const phone = formatPhone(phone_number);
 
    // Must be exactly 12 digits: 254 + 9 digits, Safaricom prefix
    if (!/^254(7\d{8}|1\d{8})$/.test(phone)) {
      return res.status(400).json({
        error: `Invalid phone number format. Enter a 10-digit Safaricom number starting with 07 or 01. Got: ${phone}`
      });
    }
 
    const amount = Math.ceil(Number(payment.amount));
    if (!amount || amount < 1) {
      return res.status(400).json({ error: 'Invalid payment amount.' });
    }
 
    // --- Log what we're about to send ---
    console.log('=== STK Push Request ===');
    console.log('Phone:', phone);
    console.log('Amount:', amount);
    console.log('Shortcode:', process.env.MPESA_SHORTCODE);
    console.log('Callback URL:', process.env.MPESA_CALLBACK_URL);
 
    let token;
    try {
      token = await getMpesaToken();
      console.log('Access token obtained:', token ? '✓ ' + token.slice(0,20) + '...' : '✗ EMPTY');
    } catch (tokenErr) {
      console.error('=== TOKEN FETCH FAILED ===');
      console.error('Status:', tokenErr.response?.status);
      console.error('Data:', JSON.stringify(tokenErr.response?.data));
      console.error('Message:', tokenErr.message);
      return res.status(500).json({ error: 'Failed to get M-Pesa token. Check your consumer key/secret.' });
    }
    const { password, timestamp } = getMpesaPassword();
    console.log('Timestamp:', timestamp);
    console.log('Password length:', password.length);
 
    const shortcode = String(process.env.MPESA_SHORTCODE);
 
    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: 'RiaraTix',
      TransactionDesc: `Ticket for ${payment.event_title}`.slice(0, 13),
    };
 
    console.log('STK Payload:', JSON.stringify(stkPayload, null, 2));
 
    let stkResponse;
    try {
      stkResponse = await axios.post(
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkPayload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (stkErr) {
      console.error('=== STK PUSH AXIOS ERROR ===');
      console.error('Status:', stkErr.response?.status);
      console.error('Headers:', JSON.stringify(stkErr.response?.headers));
      console.error('Data:', JSON.stringify(stkErr.response?.data));
      console.error('Raw data:', stkErr.response?.data);
      console.error('Message:', stkErr.message);
      return res.status(500).json({
        error: 'Failed to initiate M-Pesa payment.',
        detail: stkErr.response?.data || stkErr.message,
      });
    }
 
    console.log('STK Response:', JSON.stringify(stkResponse.data, null, 2));
 
    const { CheckoutRequestID, ResponseCode, CustomerMessage } = stkResponse.data;
 
    if (ResponseCode !== '0') {
      return res.status(400).json({ error: 'Failed to initiate payment. Try again.' });
    }
 
    await pool.query(
      `UPDATE payments SET mpesa_phone = $1, card_ref = $2 WHERE id = $3`,
      [phone, CheckoutRequestID, payment.id]
    );
 
    logPayment('STK_INITIATED', {
      payment_id: payment.id,
      ticket_id,
      phone,
      amount,
      event_title: payment.event_title,
      tier_name: payment.tier_name,
      checkout_request_id: CheckoutRequestID,
    });
 
    return res.status(200).json({
      message: CustomerMessage || `STK push sent to ${phone}.`,
      payment_id: payment.id,
      amount,
      phone,
      checkout_request_id: CheckoutRequestID,
    });
 
  } catch (err) {
    // Log the full Daraja error response so we can see exactly what's wrong
    console.error('=== initiatePayment ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Daraja error data:', JSON.stringify(err.response?.data));
    console.error('Message:', err.message);
 
    const darajaError = err.response?.data?.errorMessage
      || err.response?.data?.ResultDesc
      || (err.response?.data === '' ? 'Daraja rejected the request (empty response — usually invalid phone or shortcode)' : null)
      || err.message;
 
    return res.status(500).json({
      error: 'Failed to initiate M-Pesa payment.',
      detail: darajaError,
    });
  }
};
 
exports.mpesaCallback = async (req, res) => {
  try {
    console.log('=== M-Pesa Callback received ===');
    console.log(JSON.stringify(req.body, null, 2));
 
    const { Body } = req.body;
    const { stkCallback } = Body;
    const { ResultCode, CheckoutRequestID, CallbackMetadata } = stkCallback;
 
    const paymentResult = await pool.query(
      `SELECT p.*, t.id AS ticket_id FROM payments p JOIN tickets t ON p.ticket_id = t.id WHERE p.card_ref = $1`,
      [CheckoutRequestID]
    );
 
    if (paymentResult.rows.length === 0) {
      return res.status(200).json({ message: 'Payment not found.' });
    }
 
    const payment = paymentResult.rows[0];
 
    if (ResultCode !== 0) {
      await pool.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [payment.id]);
      logPayment('PAYMENT_FAILED', { checkout_request_id: CheckoutRequestID, payment_id: payment.id, result_code: ResultCode });
      return res.status(200).json({ message: 'Payment failed.' });
    }
 
    const mpesa_ref = CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const amount_paid = CallbackMetadata.Item.find(i => i.Name === 'Amount')?.Value;
    const phone_used = CallbackMetadata.Item.find(i => i.Name === 'PhoneNumber')?.Value;
 
    await pool.query(
      `UPDATE payments SET status = 'completed', mpesa_ref = $1, paid_at = NOW() WHERE id = $2`,
      [mpesa_ref, payment.id]
    );
    await pool.query(`UPDATE tickets SET status = 'confirmed' WHERE id = $1`, [payment.ticket_id]);
 
    logPayment('PAYMENT_CONFIRMED', {
      payment_id: payment.id,
      ticket_id: payment.ticket_id,
      mpesa_ref,
      amount: amount_paid,
      phone: phone_used,
      checkout_request_id: CheckoutRequestID,
    });
 
    return res.status(200).json({ message: 'Payment confirmed.' });
  } catch (err) {
    console.error('mpesaCallback error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.getPaymentStatus = async (req, res) => {
  try {
    const { ticket_id } = req.params;
    const result = await pool.query(
      `SELECT p.*, t.status AS ticket_status FROM payments p JOIN tickets t ON p.ticket_id = t.id WHERE p.ticket_id = $1 AND t.user_id = $2`,
      [ticket_id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found.' });
    return res.status(200).json({ payment: result.rows[0] });
  } catch (err) {
    console.error('getPaymentStatus error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.requestRefund = async (req, res) => {
  try {
    const { ticket_id } = req.body;
    const result = await pool.query(
      `SELECT p.*, t.status AS ticket_status, t.checked_in_at FROM payments p JOIN tickets t ON p.ticket_id = t.id WHERE p.ticket_id = $1 AND t.user_id = $2`,
      [ticket_id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found.' });
    const payment = result.rows[0];
    if (payment.checked_in_at) return res.status(400).json({ error: 'Cannot refund a ticket that has already been used.' });
    if (payment.status === 'refunded') return res.status(400).json({ error: 'This ticket has already been refunded.' });
 
    await pool.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [payment.id]);
    await pool.query(`UPDATE tickets SET status = 'cancelled' WHERE id = $1`, [ticket_id]);
    await pool.query(
      `UPDATE ticket_tiers SET quantity_sold = quantity_sold - 1 WHERE id = (SELECT tier_id FROM tickets WHERE id = $1)`,
      [ticket_id]
    );
 
    logPayment('REFUND_PROCESSED', {
      payment_id: payment.id,
      ticket_id,
      amount: payment.amount,
    });
 
    return res.status(200).json({ message: 'Refund processed. Amount will be returned to your M-Pesa within 24 hours.' });
  } catch (err) {
    console.error('requestRefund error:', err.message);
    return res.status(500).json({ error: 'Failed to process refund.' });
  }
};