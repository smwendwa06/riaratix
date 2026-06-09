const { Pool } = require('pg');
require('dotenv').config();
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
 
// Prevent crashes on unexpected connection errors
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.code || err.message);
});
 
// Test connection on startup with retries
async function connectWithRetry(retries = 5, delay = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL');
      client.release();
      return;
    } catch (err) {
      console.error(`❌ DB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i < retries) {
        console.log(`   Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error('   Could not connect to DB. App will retry on each request.');
      }
    }
  }
}
 
connectWithRetry();
 
module.exports = pool;