// server-new.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();

/* -------------------------
   CORS / JSON
------------------------- */
app.use(cors({
  origin: true,            
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '1mb' }));

/* -------------------------
   Connexion Postgres (Neon)
------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* -------------------------
   Sessions helpers
------------------------- */
async function createSession(userId, hours = 24 * 7) { // 7 jours
  const sessionToken = crypto.randomBytes(36).toString('base64url');
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  await pool.query(
    `INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)`,
    [userId, sessionToken, expiresAt]
  );
  return { sessionToken, expiresAt };
}

async function getUserByToken(token) {
  const q = `
    SELECT u.id, u.email, u.username, u.created_at, u.last_login, u.is_active
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_token = $1 AND s.expires_at > NOW()
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [token]);
  return rows[0] || null;
}

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: 'Missing token' });
    const user = await getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid/expired session' });
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/* -------------------------
   Santé / Debug
------------------------- */
app.get('/', (_req, res) => {
  res.json({
    message: '🚀 Apocalypse backend up',
    endpoints: [
      'POST /api/auth/signup',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET  /api/auth/me',
      'POST /api/chat-save',
      'GET  /api/chat-load',
      'POST /save-chat    (legacy trate.html)',
      'GET  /get-chat-history (legacy trate.html)'
    ],
  });
});

app.get('/api/check-db', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM chat_messages');
    res.json({ success: true, totalMessages: rows[0].count });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* -------------------------
   AUTH
------------------------- */
// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    if (!email || !password || !username)  
      return res.status(400).json({ success: false, error: 'Email, password and username required' });

    const exists = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (exists.rowCount)
      return res.status(409).json({ success: false, error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 10);
    const insert = await pool.query(
      `INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3)
       RETURNING id, email, username, created_at`,
      [email, password_hash, username]  
    );
    const user = insert.rows[0];

    const { sessionToken, expiresAt } = await createSession(user.id);
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({ 
      success: true, 
      token: sessionToken, 
      expiresAt, 
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ success: false, error: 'Email & password are required' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    if (!rows.length)
      return res.status(404).json({ success: false, error: 'Account not found' });

    const user = rows[0];
    if (user.is_active === false)
      return res.status(403).json({ success: false, error: 'Account disabled' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ success: false, error: 'Incorrect password' });

    const { sessionToken, expiresAt } = await createSession(user.id);
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      success: true,
      token: sessionToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at,
        last_login: user.last_login,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_sessions WHERE session_token = $1', [req.sessionToken]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* -------------------------
   CHAT (Official SPA API)
------------------------- */
// Save (AUTH REQUIRED) —> link to the logged-in user
app.post('/api/chat-save', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};

    // both formats are accepted for compatibility
    const user_message = body.user_message ?? body.message;
    const ai_response  = body.ai_response  ?? body.response;
    const step_of_faith = body.step_of_faith; 

    if (!user_message || !ai_response) {
      return res.status(400).json({ success: false, error: 'user_message/ai_response (ou message/response) requis' });
    }

    // user_id is VARCHAR(100) in your table -> stringify
    const userIdAsText = String(req.user.id);

    const q = `
      INSERT INTO chat_messages (user_id, user_message, ai_response, step_of_faith, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
    const { rows } = await pool.query(q, [userIdAsText, user_message, ai_response, step_of_faith]);
    res.json({ success: true, id: rows[0].id });
  } catch (e) {
    console.error('chat-save error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Loading (AUTH REQUIRED)
app.get('/api/chat-load', authMiddleware, async (req, res) => {
  try {
    const userIdAsText = String(req.user.id);
    const { rows } = await pool.query(
      `SELECT id, user_id, user_message, ai_response, step_of_faith, created_at
       FROM chat_messages
       WHERE user_id = $1
       ORDER BY created_at DESC`,  
      [userIdAsText]
    );
    res.json({ success: true, messages: rows });
  } catch (e) {
    console.error('chat-load error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
/* -------------------------
   Call the routes
------------------------- */
app.post('/save-chat', async (req, res) => {
  try {
    let userId = null;
    try {
      const h = req.headers['authorization'] || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : null;
      const u = t ? await getUserByToken(t) : null;
      if (u) userId = u.id;
    } catch {}

    const body = req.body || {};
    const user_message = body.user_message ?? body.message;
    const ai_response  = body.ai_response  ?? body.response;
    const fallbackUserId = body.userId ?? null; 

    if (!user_message || !ai_response) {
      return res.status(400).json({ success: false, error: 'user_message/ai_response (ou message/response) requis' });
    }

    const insertUserId = String(userId ?? fallbackUserId ?? '0'); 

    const q = `
      INSERT INTO chat_messages (user_id, user_message, ai_response, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id
    `;
    const { rows } = await pool.query(q, [insertUserId, user_message, ai_response]);
    res.json({ success: true, id: rows[0].id });
  } catch (e) {
    console.error('save-chat legacy error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/get-chat-history', async (req, res) => {
  try {
    // session if possible
    let userId = null;
    try {
      const h = req.headers['authorization'] || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : null;
      const u = t ? await getUserByToken(t) : null;
      if (u) userId = u.id;
    } catch {}

    userId = userId ?? req.query.userId ?? null;

    const where = userId ? 'WHERE user_id = $1' : '';
    const params = userId ? [String(userId)] : [];

    const { rows } = await pool.query(
      `SELECT id, user_id, user_message, ai_response, created_at
       FROM chat_messages
       ${where}
       ORDER BY created_at DESC
       LIMIT 50`,
      params
    );
    res.json({ success: true, messages: rows });
  } catch (e) {
    console.error('get-chat-history legacy error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});


/* -------------------------
   // INIT DB (optional)
------------------------- */
app.post('/api/init-db', async (_req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        username VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    res.json({ success: true, message: 'Tables existantes vérifiées/créées.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* =========================
SYMBOLS (read-only)
Table: apocalyptic_symbols
Columns: id, title, reference, category, image_url, meaning, context, application
========================= */

// GET /api/symbols?category=christ&search=lamb&limit=200
app.get('/api/symbols', async (req, res) => {
try {
 const { category, search, limit } = req.query;
 const params = [];
 let where = '';

 if (category) {
   params.push(category);
   where += (where ? ' AND ' : ' WHERE ') + `category = $${params.length}`;
 }
 if (search) {
   params.push(`%${search}%`);
   const idx = params.length; 
   where += (where ? ' AND ' : ' WHERE ') +
     `(title ILIKE $${idx} OR reference ILIKE $${idx} OR meaning ILIKE $${idx} OR context ILIKE $${idx} OR application ILIKE $${idx})`;
 }

 const lim = Math.min(parseInt(limit || '200', 10), 500);

 const q = `
   SELECT id, title, reference, category, image_url, meaning, context, application
   FROM apocalyptic_symbols
   ${where}
   ORDER BY id ASC
   LIMIT ${lim}
 `;
 const { rows } = await pool.query(q, params);
 res.json({ success: true, symbols: rows });
} catch (e) {
 res.status(500).json({ success: false, error: e.message });
}
});

// GET /api/symbols/:id
app.get('/api/symbols/:id', async (req, res) => {
try {
 const { rows } = await pool.query(
   `SELECT id, title, reference, category, image_url, meaning, context, application
    FROM apocalyptic_symbols
    WHERE id = $1
    LIMIT 1`,
   [req.params.id]
 );
 if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
 res.json({ success: true, symbol: rows[0] });
} catch (e) {
 res.status(500).json({ success: false, error: e.message });
}
});

/* =========================
   FAITH STEPS API
========================= */

// GET /api/faith-steps - // Retrieve all of the user's faith steps
app.get('/api/faith-steps', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, passage, meditation, step, completed, completed_at, created_at, source
       FROM faith_steps 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 100`,
      [req.user.id]
    );
    res.json({ success: true, steps: rows });
  } catch (e) {
    console.error('Error fetching faith steps:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/faith-steps - Create a new faith step
app.post('/api/faith-steps', authMiddleware, async (req, res) => {
  try {
    const { title, passage, meditation, step, source = 'custom' } = req.body;
    
    console.log('Creating faith step with data:', { title, passage, meditation, step, source, user_id: req.user.id });
    
    if (!title || !step) {
      return res.status(400).json({ 
        success: false, 
        error: 'Title and step are required' 
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO faith_steps (user_id, title, passage, meditation, step, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, title, passage, meditation, step, completed, completed_at, created_at, source`,
      [req.user.id, title, passage || null, meditation || null, step, source]
    );

    console.log('Faith step created successfully:', rows[0]);
    
    res.json({ 
      success: true, 
      step: rows[0] 
    });
  } catch (e) {
    console.error('Error creating faith step:', e);
    res.status(500).json({ 
      success: false, 
      error: 'Database error: ' + e.message 
    });
  }
});

// PUT /api/faith-steps/:id - Update a faith step (completion)
app.put('/api/faith-steps/:id', authMiddleware, async (req, res) => {
  try {
    const { completed } = req.body;
    const stepId = req.params.id;

    // Verify that the step belongs to the user
    const check = await pool.query(
      'SELECT id FROM faith_steps WHERE id = $1 AND user_id = $2',
      [stepId, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Faith step not found' });
    }

    const { rows } = await pool.query(
      `UPDATE faith_steps 
       SET completed = $1, completed_at = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, title, passage, meditation, step, completed, completed_at, created_at, source`,
      [completed, completed ? new Date() : null, stepId, req.user.id]
    );

    res.json({ success: true, step: rows[0] });
  } catch (e) {
    console.error('Error updating faith step:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/faith-steps/:id - Delete a faith step
app.delete('/api/faith-steps/:id', authMiddleware, async (req, res) => {
  try {
    const stepId = req.params.id;

    // Verify that the step belongs to the user
    const check = await pool.query(
      'SELECT id FROM faith_steps WHERE id = $1 AND user_id = $2',
      [stepId, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Faith step not found' });
    }

    await pool.query(
      'DELETE FROM faith_steps WHERE id = $1 AND user_id = $2',
      [stepId, req.user.id]
    );

    res.json({ success: true, message: 'Faith step deleted' });
  } catch (e) {
    console.error('Error deleting faith step:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/faith-steps/stats - Retrieve statistics
app.get('/api/faith-steps/stats', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         COUNT(*) as total_steps,
         COUNT(CASE WHEN completed = true THEN 1 END) as completed_steps,
         COUNT(DISTINCT DATE(created_at)) as unique_days
       FROM faith_steps 
       WHERE user_id = $1`,
      [req.user.id]
    );

    const stats = rows[0];
    
    // Calculate the streak (simplified)
    const streakResult = await pool.query(
      `SELECT COUNT(DISTINCT DATE(created_at)) as streak
       FROM faith_steps 
       WHERE user_id = $1 
       AND created_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [req.user.id]
    );

    res.json({ 
      success: true, 
      stats: {
        total: parseInt(stats.total_steps),
        completed: parseInt(stats.completed_steps),
        streak: Math.min(parseInt(streakResult.rows[0].streak), 7) // Max 7 jours
      }
    });
  } catch (e) {
    console.error('Error fetching faith steps stats:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
/* -------------------------
   Start
------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});