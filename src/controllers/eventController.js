const pool = require('../config/db');
const crypto = require('crypto');

exports.getAllEvents = async (req, res) => {
  try {
    const { category } = req.query;
    let query = `
      SELECT e.id, e.title, e.description, e.category, e.venue,
        e.poster_url, e.starts_at, e.ends_at, e.capacity,
        e.status, e.is_public, e.created_at,
        o.club_name AS organizer_name, o.logo_url AS organizer_logo,
        COALESCE(SUM(tt.quantity_sold), 0) AS total_sold,
        COALESCE(MIN(tt.price), 0) AS min_price
      FROM events e
      JOIN organizers o ON e.organizer_id = o.id
      LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
      WHERE e.status IN ('approved', 'live') AND e.is_public = TRUE
    `;
    const params = [];
    if (category) { query += ` AND e.category = $${params.length + 1}`; params.push(category); }
    query += ` GROUP BY e.id, o.club_name, o.logo_url ORDER BY e.starts_at ASC`;
    const result = await pool.query(query, params);
    return res.status(200).json({ events: result.rows });
  } catch (err) {
    console.error('getAllEvents error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};

exports.getEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const eventResult = await pool.query(`
      SELECT e.*, e.starts_at AS start_time, e.ends_at AS end_time, o.club_name AS organizer_name, o.logo_url AS organizer_logo, o.verified AS organizer_verified
      FROM events e JOIN organizers o ON e.organizer_id = o.id WHERE e.id = $1
    `, [id]);
    if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Event not found.' });
    const tiersResult = await pool.query(`
      SELECT id, name, description, price, quantity, quantity_sold, is_free, sale_starts, sale_ends
      FROM ticket_tiers WHERE event_id = $1 ORDER BY price ASC
    `, [id]);
    return res.status(200).json({ event: eventResult.rows[0], tiers: tiersResult.rows });
  } catch (err) {
    console.error('getEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const { title, description, category, venue, poster_url, starts_at, ends_at, capacity, is_public = true, tiers = [] } = req.body;
    const orgResult = await pool.query('SELECT id, verified FROM organizers WHERE user_id = $1', [req.user.id]);
    if (orgResult.rows.length === 0) return res.status(403).json({ error: 'You do not have an organizer profile.' });
    const organizer = orgResult.rows[0];
    const checkin_token = crypto.randomBytes(32).toString('hex');
    const eventResult = await pool.query(`
      INSERT INTO events (organizer_id, title, description, category, venue, poster_url, starts_at, ends_at, capacity, is_public, checkin_token, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [organizer.id, title, description, category, venue, poster_url, starts_at, ends_at, capacity, is_public, checkin_token, 'pending_approval']);
    const event = eventResult.rows[0];
    if (tiers.length > 0) {
      for (const tier of tiers) {
        await pool.query(`
          INSERT INTO ticket_tiers (event_id, name, description, price, quantity, is_free, sale_starts, sale_ends)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [event.id, tier.name, tier.description, tier.is_free ? 0 : tier.price, tier.quantity, tier.is_free || false, tier.sale_starts || null, tier.sale_ends || null]);
      }
    }
    return res.status(201).json({ message: 'Event created successfully.', event });
  } catch (err) {
    console.error('createEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, venue, poster_url, starts_at, ends_at, capacity, is_public } = req.body;
    const check = await pool.query(`SELECT e.id FROM events e JOIN organizers o ON e.organizer_id = o.id WHERE e.id = $1 AND o.user_id = $2`, [id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Not authorized to update this event.' });
    const result = await pool.query(`
      UPDATE events SET title=COALESCE($1,title), description=COALESCE($2,description), category=COALESCE($3,category),
      venue=COALESCE($4,venue), poster_url=COALESCE($5,poster_url), starts_at=COALESCE($6,starts_at),
      ends_at=COALESCE($7,ends_at), capacity=COALESCE($8,capacity), is_public=COALESCE($9,is_public) WHERE id=$10 RETURNING *
    `, [title, description, category, venue, poster_url, starts_at, ends_at, capacity, is_public, id]);
    return res.status(200).json({ event: result.rows[0] });
  } catch (err) {
    console.error('updateEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query(`SELECT e.id FROM events e JOIN organizers o ON e.organizer_id = o.id WHERE e.id = $1 AND o.user_id = $2`, [id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Not authorized to delete this event.' });
    await pool.query('DELETE FROM events WHERE id = $1', [id]);
    return res.status(200).json({ message: 'Event deleted successfully.' });
  } catch (err) {
    console.error('deleteEvent error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};

exports.getMyEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, COALESCE(SUM(tt.quantity_sold), 0) AS total_sold,
        COALESCE(SUM(tt.quantity_sold * tt.price), 0) AS total_revenue
      FROM events e JOIN organizers o ON e.organizer_id = o.id
      LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
      WHERE o.user_id = $1 GROUP BY e.id ORDER BY e.starts_at DESC
    `, [req.user.id]);
    return res.status(200).json({ events: result.rows });
  } catch (err) {
    console.error('getMyEvents error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
};