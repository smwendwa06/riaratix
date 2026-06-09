const pool = require('../config/db');
const { sendOrganizerEmail } = require('../utils/mailer');
 
// ── DASHBOARD STATS ──
exports.getStats = async (req, res) => {
  try {
    const [users, events, tickets, revenue, pendingOrgs] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE role IN ('student', 'pending_organizer')`),
      pool.query(`SELECT COUNT(*) FROM events WHERE status IN ('approved', 'live')`),
      pool.query(`SELECT COALESCE(SUM(quantity_sold), 0) AS total FROM ticket_tiers`),
      pool.query(`SELECT COALESCE(SUM(quantity_sold * price), 0) AS total FROM ticket_tiers`),
      pool.query(`SELECT COUNT(*) FROM organizers WHERE verified = FALSE`),
    ]);
    return res.status(200).json({
      stats: {
        total_students:     users.rows[0].count,
        total_events:       events.rows[0].count,
        total_tickets:      tickets.rows[0].total,
        total_revenue:      revenue.rows[0].total,
        pending_organizers: pendingOrgs.rows[0].count,
      }
    });
  } catch (err) {
    console.error('getStats error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── PENDING EVENTS ──
exports.getPendingEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, o.club_name AS organizer_name, u.email AS organizer_email
      FROM events e
      JOIN organizers o ON e.organizer_id = o.id
      JOIN users u ON o.user_id = u.id
      WHERE e.status = 'pending_approval'
      ORDER BY e.created_at ASC
    `);
    return res.status(200).json({ events: result.rows });
  } catch (err) {
    console.error('getPendingEvents error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── APPROVE EVENT ──
exports.approveEvent = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE events SET status = 'approved' WHERE id = $1`, [id]);
    return res.status(200).json({ message: 'Event approved and set to live.' });
  } catch (err) {
    console.error('approveEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── REJECT EVENT ──
exports.rejectEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query(
      `UPDATE events SET status = 'cancelled' WHERE id = $1`,
      [id]
    );
    return res.status(200).json({ message: 'Event rejected.' });
  } catch (err) {
    console.error('rejectEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── ALL ORGANIZERS ──
exports.getOrganizers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.full_name, u.email, u.student_number,
        COUNT(e.id) AS total_events
      FROM organizers o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN events e ON e.organizer_id = o.id
      GROUP BY o.id, u.full_name, u.email, u.student_number
      ORDER BY o.created_at DESC
    `);
    return res.status(200).json({ organizers: result.rows });
  } catch (err) {
    console.error('getOrganizers error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── VERIFY ORGANIZER ──
exports.verifyOrganizer = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const org = await client.query(`SELECT user_id FROM organizers WHERE id = $1`, [id]);
    if (org.rows.length === 0) return res.status(404).json({ error: 'Organizer not found.' });
    await client.query('BEGIN');
    await client.query(
      `UPDATE organizers SET verified = TRUE, verified_at = NOW(), verified_by = $1 WHERE id = $2`,
      [req.user.id, id]
    );
    await client.query(`UPDATE users SET role = 'organizer' WHERE id = $1`, [org.rows[0].user_id]);
    await client.query('COMMIT');
 
    // Send approval email
    try {
      const user = await pool.query(`SELECT u.email, u.full_name, o.club_name FROM users u JOIN organizers o ON o.user_id = u.id WHERE u.id = $1`, [org.rows[0].user_id]);
      if (user.rows.length > 0) {
        const { email, full_name, club_name } = user.rows[0];
        await sendOrganizerEmail(email, full_name, { type: 'approved', clubName: club_name });
      }
    } catch (mailErr) { console.error('Organizer approved email failed:', mailErr.message); }
 
    return res.status(200).json({ message: 'Organizer verified successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('verifyOrganizer error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  } finally { client.release(); }
};
 
// ── REJECT ORGANIZER ──
exports.rejectOrganizer = async (req, res) => {
  try {
    const { id } = req.params;
    // Get user_id first
    const org = await pool.query(`SELECT user_id FROM organizers WHERE id = $1`, [id]);
    if (org.rows.length === 0) return res.status(404).json({ error: 'Organizer not found.' });
    // Fetch details before deleting
    const orgDetails = await pool.query(`SELECT u.email, u.full_name, o.club_name FROM organizers o JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [id]);
 
    // Delete organizer profile and revert role
    await pool.query(`DELETE FROM organizers WHERE id = $1`, [id]);
    await pool.query(`UPDATE users SET role = 'student' WHERE id = $1`, [org.rows[0].user_id]);
 
    // Send rejection email
    try {
      if (orgDetails.rows.length > 0) {
        const { email, full_name, club_name } = orgDetails.rows[0];
        const reason = (req.body && req.body.reason) || null;
        await sendOrganizerEmail(email, full_name, { type: 'rejected', clubName: club_name, reason });
      }
    } catch (mailErr) { console.error('Organizer rejected email failed:', mailErr.message); }
 
    return res.status(200).json({ message: 'Organizer application rejected.' });
  } catch (err) {
    console.error('rejectOrganizer error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── ALL USERS ──
exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, email, student_number, role, is_verified, is_active, phone_number, created_at
      FROM users ORDER BY created_at DESC
    `);
    return res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('getUsers error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── UPDATE USER ──
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, role, phone_number } = req.body;
    if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'Name is required.' });
    const allowed = ['student', 'pending_organizer', 'organizer', 'admin'];
    if (role && !allowed.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    const result = await pool.query(
      `UPDATE users SET
        full_name    = COALESCE($1, full_name),
        role         = COALESCE($2, role),
        phone_number = COALESCE($3, phone_number)
       WHERE id = $4 RETURNING id, full_name, role, email, phone_number`,
      [full_name.trim() || null, role || null, phone_number || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    return res.status(200).json({ message: 'User updated successfully.', user: result.rows[0] });
  } catch (err) {
    console.error('updateUser error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── DEACTIVATE USER ──
exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account.' });
    await pool.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [id]);
    return res.status(200).json({ message: 'User deactivated.' });
  } catch (err) {
    console.error('deactivateUser error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── REACTIVATE USER ──
exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [id]);
    return res.status(200).json({ message: 'User reactivated.' });
  } catch (err) {
    console.error('reactivateUser error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
// ── ALL EVENTS ──
exports.getAllEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, o.club_name AS organizer_name,
        COALESCE(SUM(tt.quantity_sold * tt.price), 0) AS total_revenue,
        COALESCE(SUM(tt.quantity_sold), 0) AS total_sold
      FROM events e
      JOIN organizers o ON e.organizer_id = o.id
      LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
      GROUP BY e.id, o.club_name
      ORDER BY e.created_at DESC
    `);
    return res.status(200).json({ events: result.rows });
  } catch (err) {
    console.error('getAllEvents error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};