const pool = require('../config/db');
const { sendReminderEmail } = require('../utils/mailer');
 
async function expireTickets() {
  // Skip if DB is unreachable to avoid log spam
  try {
    await pool.query('SELECT 1');
  } catch (connErr) {
    console.error('Expire tickets job skipped — DB unavailable:', connErr.code || connErr.message);
    return;
  }
  try {
    // ── Send reminder emails at 90, 60, 30 min marks ──
    const reminders = [
      { minsLeft: 90, label: '1 hour 30 minutes', bucket: '90' },
      { minsLeft: 60, label: '1 hour',            bucket: '60' },
      { minsLeft: 30, label: '30 minutes',         bucket: '30' },
    ];
 
    for (const { minsLeft, label, bucket } of reminders) {
      const window_start = new Date(Date.now() + (minsLeft - 2.5) * 60000);
      const window_end   = new Date(Date.now() + (minsLeft + 2.5) * 60000);
 
      const due = await pool.query(`
        SELECT t.id, t.expires_at, t.tier_id, t.reminder_sent,
               u.email, u.full_name,
               tt.name AS tier_name, tt.price,
               e.title AS event_title, e.starts_at
        FROM tickets t
        JOIN users u        ON t.user_id  = u.id
        JOIN ticket_tiers tt ON t.tier_id  = tt.id
        JOIN events e        ON tt.event_id = e.id
        WHERE t.status = 'pending'
          AND t.expires_at IS NOT NULL
          AND t.expires_at BETWEEN $1 AND $2
          AND (t.reminder_sent IS NULL OR NOT (t.reminder_sent @> $3::jsonb))
      `, [window_start, window_end, JSON.stringify([bucket])]);
 
      for (const ticket of due.rows) {
        try {
          await sendReminderEmail(ticket.email, ticket.full_name, {
            ticketId:   ticket.id,
            eventTitle: ticket.event_title,
            tierName:   ticket.tier_name,
            amount:     ticket.price,
            minsLeft:   minsLeft,
            label,
            expiresAt:  ticket.expires_at,
          });
          // Safely parse reminder_sent — could be null, string, or array
          let currentSent = [];
          try {
            const raw = ticket.reminder_sent;
            if (Array.isArray(raw)) currentSent = raw;
            else if (typeof raw === 'string') currentSent = JSON.parse(raw);
          } catch { currentSent = []; }
 
          await pool.query(
            `UPDATE tickets SET reminder_sent = $1 WHERE id = $2`,
            [JSON.stringify([...currentSent, bucket]), ticket.id]
          );
          console.log(`📧 Sent ${minsLeft}min reminder to ${ticket.email} for ticket ${ticket.id}`);
        } catch (mailErr) {
          console.error(`Failed to send reminder for ticket ${ticket.id}:`, mailErr.message);
        }
      }
    }
 
    // ── Expire overdue tickets ──
    const expired = await pool.query(`
      SELECT t.id, t.tier_id,
             u.email, u.full_name,
             tt.name AS tier_name, tt.price,
             e.title AS event_title
      FROM tickets t
      JOIN users u         ON t.user_id  = u.id
      JOIN ticket_tiers tt ON t.tier_id  = tt.id
      JOIN events e        ON tt.event_id = e.id
      WHERE t.status = 'pending'
        AND t.expires_at IS NOT NULL
        AND t.expires_at < NOW()
    `);
 
    for (const ticket of expired.rows) {
      await pool.query(`UPDATE tickets SET status = 'cancelled', reminder_sent = NULL WHERE id = $1`, [ticket.id]);
      await pool.query(`UPDATE ticket_tiers SET quantity_sold = GREATEST(quantity_sold - 1, 0) WHERE id = $1`, [ticket.tier_id]);
      await pool.query(`UPDATE payments SET status = 'failed' WHERE ticket_id = $1 AND status = 'pending'`, [ticket.id]);
 
      // Send expiry notification email
      try {
        await sendReminderEmail(ticket.email, ticket.full_name, {
          ticketId:   ticket.id,
          eventTitle: ticket.event_title,
          tierName:   ticket.tier_name,
          amount:     ticket.price,
          expired:    true,
        });
        console.log(`📧 Sent expiry email to ${ticket.email} for ticket ${ticket.id}`);
      } catch (mailErr) {
        console.error(`Failed to send expiry email for ticket ${ticket.id}:`, mailErr.message);
      }
    }
 
    if (expired.rows.length > 0) {
      console.log(`⏰ Expired ${expired.rows.length} pending ticket(s).`);
    }
 
  } catch (err) {
    console.error('Expire tickets job error:', err.message);
  }
}
 
module.exports = expireTickets;