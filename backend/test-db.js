const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration PostgreSQL/Neon DIRECTE
const pool = new Pool({
    user: 'neondb_owner',
    password: 'npg_sx92FcdagZNv',
    host: 'ep-wild-snow-ad6jpbfo-pooler.c-2.us-east-1.aws.neon.tech',
    database: 'apocalypse_db',
    port: 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test de connexion au démarrage
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erreur de connexion à PostgreSQL:', err.message);
    } else {
        console.log('✅ Connecté à PostgreSQL/Neon!');
        release();
    }
});

// Route pour sauvegarder les messages
app.post('/api/chat-save', async (req, res) => {
    try {
        const { userId, message, response } = req.body;
        
        console.log('💾 Sauvegarde message:', { userId, messageLength: message.length });
        
        const result = await pool.query(
            `INSERT INTO chat_messages (user_id, user_message, ai_response, created_at) 
             VALUES ($1, $2, $3, NOW()) 
             RETURNING id`,
            [userId, message, response]
        );
        
        console.log('✅ Message sauvegardé ID:', result.rows[0].id);
        
        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour vérifier la base de données
app.get('/api/check-db', async (req, res) => {
    try {
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM chat_messages');
        const usersResult = await pool.query('SELECT COUNT(DISTINCT user_id) as count FROM chat_messages');
        const lastMessageResult = await pool.query('SELECT created_at FROM chat_messages ORDER BY created_at DESC LIMIT 1');
        
        res.json({
            success: true,
            totalMessages: totalResult.rows[0].count,
            uniqueUsers: usersResult.rows[0].count,
            lastMessage: lastMessageResult.rows[0] ? lastMessageResult.rows[0].created_at : 'Aucun message'
        });
    } catch (error) {
        console.error('Erreur vérification DB:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour créer la table si elle n'existe pas
app.post('/api/init-db', async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                user_message TEXT NOT NULL,
                ai_response TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        res.json({ success: true, message: 'Table chat_messages créée/verifiée' });
    } catch (error) {
        console.error('Erreur init DB:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route de test simple
app.get('/', (req, res) => {
    res.json({ 
        message: '🚀 Backend Apocalypse Chat fonctionne!',
        endpoints: [
            'GET  /api/check-db',
            'POST /api/chat-save',
            'POST /api/init-db'
        ]
    });
});

app.listen(port, () => {
    console.log(`🚀 Serveur backend démarré sur http://localhost:${port}`);
    console.log(`📊 Testez avec: http://localhost:${port}/api/check-db`);
});