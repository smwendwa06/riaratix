const pool = require('../config/db');
const { sendOrganizerEmail } = require('../utils/mailer');
 
exports.createOrganizer = async (req, res) => {
  const client = await pool.connect();
  try {
    const { club_name, description, logo_url, contact_phone } = req.body;
 
    if (!club_name || !club_name.trim()) {
      return res.status(400).json({ error: 'Club/society name is required.' });
    }
 
    // Check if user already applied
    const existing = await client.query(
      'SELECT id, verified FROM organizers WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      const org = existing.rows[0];
      if (!org.verified) return res.status(409).json({ error: 'Your organizer application is still pending admin approval.' });
      return res.status(409).json({ error: 'You already have an approved organizer profile.' });
    }
 
    await client.query('BEGIN');
 
    // Insert organizer profile — verified = false (pending admin approval)
    const result = await client.query(
      `INSERT INTO organizers (user_id, club_name, description, logo_url, contact_phone, verified)
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING *`,
      [req.user.id, club_name.trim(), description || null, logo_url || null, contact_phone || null]
    );
 
    // Only update role AFTER successful insert, and only to 'pending_organizer'
    // so they can't access dashboard until admin approves
    await client.query(
      "UPDATE users SET role = 'pending_organizer' WHERE id = $1",
      [req.user.id]
    );
 
    await client.query('COMMIT');
 
    // Send application submitted email (fire-and-forget)
    try {
      const userResult = await pool.query(`SELECT email, full_name FROM users WHERE id = $1`, [req.user.id]);
      if (userResult.rows.length > 0) {
        const { email, full_name } = userResult.rows[0];
        await sendOrganizerEmail(email, full_name, { type: 'submitted', clubName: club_name.trim() });
      }
    } catch (mailErr) { console.error('Organizer submitted email failed:', mailErr.message); }
 
    return res.status(201).json({
      message: 'Application submitted! An admin will review your profile shortly.',
      organizer: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createOrganizer error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};
 
exports.getMyProfile = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM organizers WHERE user_id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Organizer profile not found.' });
    return res.status(200).json({ organizer: result.rows[0] });
  } catch (err) {
    console.error('getMyProfile error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};
 
exports.getAllOrganizers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.club_name, o.description, o.logo_url, o.verified,
             u.email, COUNT(e.id) AS total_events
      FROM organizers o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN events e ON e.organizer_id = o.id
      GROUP BY o.id, u.email
      ORDER BY o.club_name ASC
    `);
    return res.status(200).json({ organizers: result.rows });
  } catch (err) {
    console.error('getAllOrganizers error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};