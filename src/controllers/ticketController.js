const pool = require('../config/db');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { sendReminderEmail, sendCompTicketEmail } = require('../utils/mailer');
 
exports.reserveTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const { tier_id } = req.body;
    const user_id = req.user.id;
    await client.query('BEGIN');
 
    const tierResult = await client.query(`
      SELECT t.*, e.status AS event_status, e.title AS event_title
      FROM ticket_tiers t JOIN events e ON t.event_id = e.id WHERE t.id = $1 FOR UPDATE
    `, [tier_id]);
    if (tierResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket tier not found.' }); }
    const tier = tierResult.rows[0];
    if (!['approved', 'live'].includes(tier.event_status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This event is not available for ticketing.' }); }
    if (tier.quantity_sold >= tier.quantity) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Sorry, this ticket tier is sold out.' }); }
    if (tier.is_free) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Free tickets do not need to be reserved. Use RSVP.' }); }
 
    const existing = await client.query(`
      SELECT id FROM tickets WHERE user_id = $1 AND tier_id = $2 AND status IN ('pending', 'confirmed', 'used')
    `, [user_id, tier_id]);
    if (existing.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You already have a ticket for this tier.' }); }
 
    const qr_code = crypto.randomBytes(20).toString('hex');
    const expires_at = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
 
    const ticketResult = await client.query(`
      INSERT INTO tickets (tier_id, user_id, qr_code, status, expires_at)
      VALUES ($1, $2, $3, 'pending', $4) RETURNING *
    `, [tier_id, user_id, qr_code, expires_at]);
    const ticket = ticketResult.rows[0];
 
    await client.query(`UPDATE ticket_tiers SET quantity_sold = quantity_sold + 1 WHERE id = $1`, [tier_id]);
 
    const paymentResult = await client.query(`
      INSERT INTO payments (ticket_id, amount, method, status, platform_fee, net_amount)
      VALUES ($1, $2, 'mpesa', 'pending', $3, $4) RETURNING *
    `, [ticket.id, tier.price, (tier.price * 0.05).toFixed(2), (tier.price * 0.95).toFixed(2)]);
 
    await client.query('COMMIT');
 
    // Send immediate reservation confirmation email (fire-and-forget)
    try {
      const userResult = await pool.query(`SELECT email, full_name FROM users WHERE id = $1`, [user_id]);
      if (userResult.rows.length > 0) {
        const { email, full_name } = userResult.rows[0];
        await sendReminderEmail(email, full_name, {
          ticketId: ticket.id,
          eventTitle: tier.event_title,
          tierName: tier.name,
          amount: tier.price,
          minsLeft: 120,
          label: '2 hours',
          expiresAt: expires_at,
          confirmed: true,
        });
      }
    } catch (mailErr) {
      console.error('Reservation confirmation email failed:', mailErr.message);
      // Don't fail the request if email fails
    }
 
    return res.status(201).json({
      message: `Ticket reserved! You have 2 hours to complete payment. Reminders will be sent to your email.`,
      ticket,
      payment: paymentResult.rows[0],
      requires_payment: true,
      amount: tier.price,
      expires_at,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reserveTicket error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  } finally { client.release(); }
};
 
exports.purchaseTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const { tier_id } = req.body;
    const user_id = req.user.id;
    await client.query('BEGIN');
    const tierResult = await client.query(`
      SELECT t.*, e.status AS event_status, e.title AS event_title
      FROM ticket_tiers t JOIN events e ON t.event_id = e.id WHERE t.id = $1 FOR UPDATE
    `, [tier_id]);
    if (tierResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket tier not found.' }); }
    const tier = tierResult.rows[0];
    if (!['approved', 'live'].includes(tier.event_status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This event is not available for ticketing.' }); }
    if (tier.quantity_sold >= tier.quantity) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Sorry, this ticket tier is sold out.' }); }
    const existing = await client.query(`
    SELECT id FROM tickets 
    WHERE user_id = $1 AND tier_id = $2 
    AND status IN ('pending', 'confirmed', 'used')
   `, [user_id, tier_id]);
    if (existing.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You already have a ticket for this tier.' }); }
    const qr_code = crypto.randomBytes(20).toString('hex');
    const ticketResult = await client.query(`
      INSERT INTO tickets (tier_id, user_id, qr_code, status, expires_at)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [tier_id, user_id, qr_code, tier.is_free ? 'confirmed' : 'pending',
       tier.is_free ? null : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()]);
    const ticket = ticketResult.rows[0];
    await client.query(`UPDATE ticket_tiers SET quantity_sold = quantity_sold + 1 WHERE id = $1`, [tier_id]);
    if (tier.is_free) {
      await client.query('COMMIT');
      return res.status(201).json({ message: 'RSVP confirmed! Your free ticket has been issued.', ticket, requires_payment: false });
    }
    const paymentResult = await client.query(`
      INSERT INTO payments (ticket_id, amount, method, status, platform_fee, net_amount)
      VALUES ($1, $2, 'mpesa', 'pending', $3, $4) RETURNING *
    `, [ticket.id, tier.price, (tier.price * 0.05).toFixed(2), (tier.price * 0.95).toFixed(2)]);
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Ticket reserved. Complete payment to confirm.', ticket, payment: paymentResult.rows[0], requires_payment: true, amount: tier.price });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('purchaseTicket error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  } finally { client.release(); }
};
 
exports.getMyTickets = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.qr_code, t.status, t.checked_in_at, t.purchased_at, t.expires_at,
        tt.name AS tier_name, tt.price, tt.is_free,
        e.title AS event_title, e.venue, e.starts_at, e.ends_at, e.category,
        o.club_name AS organizer_name
      FROM tickets t
      JOIN ticket_tiers tt ON t.tier_id = tt.id
      JOIN events e ON tt.event_id = e.id
      JOIN organizers o ON e.organizer_id = o.id
      WHERE t.user_id = $1 ORDER BY e.starts_at DESC
    `, [req.user.id]);
    return res.status(200).json({ tickets: result.rows });
  } catch (err) {
    console.error('getMyTickets error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.getTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT t.*, tt.name AS tier_name, tt.price, tt.is_free,
        e.title AS event_title, e.venue, e.starts_at, e.ends_at, e.category, e.checkin_token,
        o.club_name AS organizer_name
      FROM tickets t JOIN ticket_tiers tt ON t.tier_id = tt.id
      JOIN events e ON tt.event_id = e.id JOIN organizers o ON e.organizer_id = o.id
      WHERE t.id = $1 AND t.user_id = $2
    `, [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket not found.' });
    return res.status(200).json({ ticket: result.rows[0] });
  } catch (err) {
    console.error('getTicket error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.checkIn = async (req, res) => {
  try {
    const { qr_code, checkin_token } = req.body;
    const ticketResult = await pool.query(`
      SELECT t.*, e.checkin_token, e.title AS event_title,
        COALESCE(tt.name, 'Complimentary') AS tier_name,
        COALESCE(tt.price, 0) AS price,
        u.full_name AS user_name, u.student_number,
        t.is_guest, t.guest_name, t.guest_email
      FROM tickets t
      LEFT JOIN ticket_tiers tt ON t.tier_id = tt.id
      LEFT JOIN events e ON COALESCE(tt.event_id, t.event_id) = e.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.qr_code = $1
    `, [qr_code]);
    if (ticketResult.rows.length === 0) return res.status(404).json({ error: 'Invalid QR code.' });
    const ticket = ticketResult.rows[0];
    if (ticket.checkin_token !== checkin_token) return res.status(403).json({ error: 'Invalid check-in token.' });
    if (ticket.status === 'used') return res.status(400).json({ error: 'This ticket has already been used.', ticket });
    if (ticket.status !== 'confirmed') return res.status(400).json({ error: 'Ticket is not confirmed. Payment may be pending.' });
    const updated = await pool.query(
      `UPDATE tickets SET status = 'used', checked_in_at = NOW() WHERE id = $1 RETURNING *`,
      [ticket.id]
    );
    return res.status(200).json({
      message: '✅ Check-in successful!',
      ticket: {
        ...updated.rows[0],
        tier_name: ticket.tier_name,
        price: ticket.price,
        user_name: ticket.user_name,
        student_number: ticket.student_number,
        event_title: ticket.event_title,
      },
    });
  } catch (err) {
    console.error('checkIn error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.getEventTickets = async (req, res) => {
  try {
    const { event_id } = req.params;
    const check = await pool.query(
      `SELECT e.id FROM events e JOIN organizers o ON e.organizer_id = o.id WHERE e.id = $1 AND o.user_id = $2`,
      [event_id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: 'Not authorized.' });
 
    const result = await pool.query(`
      SELECT
        t.id,
        t.qr_code                                        AS ticket_ref,
        t.status,
        t.checked_in_at,
        t.purchased_at                                   AS created_at,
        t.is_guest,
        t.guest_name,
        t.guest_email,
        COALESCE(tt.name, 'Complimentary')               AS tier_name,
        COALESCE(tt.price::text, '0')                    AS price,
        COALESCE(u.full_name, t.guest_name)              AS user_name,
        COALESCE(u.email, t.guest_email)                 AS email,
        COALESCE(u.student_number, 'Guest')              AS student_number
      FROM tickets t
      LEFT JOIN ticket_tiers tt ON t.tier_id = tt.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE (tt.event_id = $1 OR t.event_id = $1)
        AND (t.is_guest IS NULL OR t.is_guest = FALSE)
      ORDER BY t.purchased_at DESC
    `, [event_id]);
 
    return res.status(200).json({ tickets: result.rows });
  } catch (err) {
    console.error('getEventTickets error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
exports.issueComplimentaryTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const { event_id, guest_email, guest_name } = req.body;
 
    if (!event_id || !guest_email || !guest_name) {
      return res.status(400).json({ error: 'event_id, guest_email and guest_name are required.' });
    }
 
    // Verify the organizer owns this event
    const eventResult = await client.query(`
      SELECT e.*, o.user_id AS organizer_user_id
      FROM events e
      JOIN organizers o ON e.organizer_id = o.id
      WHERE e.id = $1
    `, [event_id]);
 
    if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Event not found.' });
    const event = eventResult.rows[0];
 
    if (event.organizer_user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to issue tickets for this event.' });
    }
 
    if (!['approved', 'live'].includes(event.status)) {
      return res.status(400).json({ error: 'Event is not available for ticketing.' });
    }
 
    await client.query('BEGIN');
 
    const qr_code = crypto.randomBytes(20).toString('hex');
    const normalizedEmail = guest_email.trim().toLowerCase();
 
    // Prevent duplicate comp ticket for same guest + event
    const existingGuest = await client.query(
      `SELECT id FROM tickets WHERE guest_email = $1 AND event_id = $2 AND is_guest = TRUE AND status != 'cancelled'`,
      [normalizedEmail, event_id]
    );
    if (existingGuest.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A complimentary ticket has already been issued to this email for this event.' });
    }
 
    // Link to existing RiaraTix account if email matches
    const registeredUser = await client.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
    const linked_user_id = registeredUser.rows.length > 0 ? registeredUser.rows[0].id : null;
 
    const ticketResult = await client.query(`
      INSERT INTO tickets (tier_id, event_id, user_id, qr_code, status, is_guest, guest_name, guest_email)
      VALUES (NULL, $1, $2, $3, 'confirmed', TRUE, $4, $5) RETURNING *
    `, [event_id, linked_user_id, qr_code, guest_name.trim(), normalizedEmail]);
 
    const ticket = ticketResult.rows[0];
    // Comp tickets do NOT count against quantity_sold — unlimited by design
    await client.query('COMMIT');
 
    // Generate QR code image as buffer
    const qrBuffer = await QRCode.toBuffer(qr_code, { width: 300, margin: 2 });
 
    // Send email with QR attached
    try {
      await sendCompTicketEmail(normalizedEmail, guest_name.trim(), {
        eventTitle: event.title,
        venue: event.venue || 'To Be Disclosed',
        startsAt: event.starts_at,
        qrCode: qr_code,
        qrBuffer,
        ticketId: ticket.id,
      });
    } catch (mailErr) {
      console.error('Comp ticket email failed:', mailErr.message);
    }
 
    return res.status(201).json({
      message: `Complimentary ticket issued to ${normalizedEmail}.`,
      ticket,
    });
 
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('issueComplimentaryTicket error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  } finally { client.release(); }
};
exports.getGuestList = async (req, res) => {
  try {
    const { event_id } = req.params;
 
    const check = await pool.query(
      `SELECT e.id FROM events e JOIN organizers o ON e.organizer_id = o.id
       WHERE e.id = $1 AND o.user_id = $2`,
      [event_id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: 'Not authorized.' });
 
    const result = await pool.query(`
      SELECT
        t.id, t.guest_name, t.guest_email,
        t.status, t.checked_in_at,
        t.purchased_at AS issued_at,
        e.title AS event_title
      FROM tickets t
      JOIN events e ON t.event_id = e.id
      WHERE t.event_id = $1 AND t.is_guest = TRUE
      ORDER BY t.purchased_at DESC
    `, [event_id]);
 
    return res.status(200).json({ guests: result.rows });
  } catch (err) {
    console.error('getGuestList error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};