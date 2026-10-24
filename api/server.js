const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// ─── Configuration ───────────────────────────────────────────────────────────
const API_PORT = process.env.API_PORT || 3000;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'taskmanager',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const app = express();
app.use(cors());
app.use(express.json());

// ─── Initialisation de la base ──────────────────────────────────────────────
async function initDB() {
  const maxRetries = 10;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS taches (
          id             SERIAL PRIMARY KEY,
          titre          TEXT NOT NULL,
          description    TEXT DEFAULT '',
          priorite       TEXT DEFAULT 'moyenne' CHECK (priorite IN ('basse', 'moyenne', 'haute')),
          terminee       BOOLEAN DEFAULT false,
          date_echeance  DATE,
          date_creation  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('[INIT] Table "taches" prête (schéma étendu).');

      // Migration : ajouter les nouvelles colonnes si elles n'existent pas
      // (pour ne pas casser une base existante)
      const migrations = [
        "ALTER TABLE taches ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''",
        "ALTER TABLE taches ADD COLUMN IF NOT EXISTS priorite TEXT DEFAULT 'moyenne'",
        "ALTER TABLE taches ADD COLUMN IF NOT EXISTS date_echeance DATE",
        "ALTER TABLE taches ADD COLUMN IF NOT EXISTS date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
      ];
      for (const sql of migrations) {
        try { await pool.query(sql); } catch (_) { /* colonne existe déjà */ }
      }
      console.log('[INIT] Migrations appliquées.');
      return;
    } catch (err) {
      console.log(`[INIT] Tentative ${i}/${maxRetries} - La base n'est pas encore prête: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error('[INIT] Impossible de se connecter à PostgreSQL après plusieurs tentatives.');
  process.exit(1);
}

// ─── Routes de santé ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', database: 'connected' });
  } catch (err) {
    console.error('[READY] Erreur de connexion DB:', err.message);
    res.status(500).json({ status: 'not ready', database: 'disconnected' });
  }
});

// ─── CRUD : /api/taches ─────────────────────────────────────────────────────

// GET - Lister toutes les tâches
app.get('/api/taches', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM taches ORDER BY date_creation DESC'
    );
    console.log(`[GET] ${result.rows.length} tâche(s) récupérée(s).`);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une tâche
app.post('/api/taches', async (req, res) => {
  const { titre, description, priorite, date_echeance } = req.body;

  if (!titre || titre.trim() === '') {
    return res.status(400).json({ error: 'Le titre est requis.' });
  }

  const validPriorites = ['basse', 'moyenne', 'haute'];
  const safePriorite = validPriorites.includes(priorite) ? priorite : 'moyenne';

  try {
    const result = await pool.query(
      `INSERT INTO taches (titre, description, priorite, terminee, date_echeance)
       VALUES ($1, $2, $3, false, $4)
       RETURNING *`,
      [
        titre.trim(),
        (description || '').trim(),
        safePriorite,
        date_echeance || null,
      ]
    );
    console.log(`[POST] Tâche créée: "${result.rows[0].titre}" (id=${result.rows[0].id}, priorité=${safePriorite})`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Mettre à jour une tâche
app.put('/api/taches/:id', async (req, res) => {
  const { id } = req.params;
  const { titre, description, priorite, terminee, date_echeance } = req.body;

  // Construire dynamiquement la requête UPDATE
  const fields = [];
  const values = [];
  let idx = 1;

  if (titre !== undefined) {
    fields.push(`titre = $${idx++}`);
    values.push(titre.trim());
  }
  if (description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(description.trim());
  }
  if (priorite !== undefined) {
    const validPriorites = ['basse', 'moyenne', 'haute'];
    if (!validPriorites.includes(priorite)) {
      return res.status(400).json({ error: 'Priorité invalide. Valeurs acceptées : basse, moyenne, haute.' });
    }
    fields.push(`priorite = $${idx++}`);
    values.push(priorite);
  }
  if (terminee !== undefined) {
    fields.push(`terminee = $${idx++}`);
    values.push(terminee);
  }
  if (date_echeance !== undefined) {
    fields.push(`date_echeance = $${idx++}`);
    values.push(date_echeance || null);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE taches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tâche non trouvée.' });
    }
    console.log(`[PUT] Tâche id=${id} mise à jour: ${fields.join(', ')}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une tâche
app.delete('/api/taches/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM taches WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tâche non trouvée.' });
    }
    console.log(`[DELETE] Tâche id=${id} ("${result.rows[0].titre}") supprimée.`);
    res.json({ message: 'Tâche supprimée.', tache: result.rows[0] });
  } catch (err) {
    console.error('[DELETE] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Démarrage ──────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[SERVER] API démarrée sur le port ${API_PORT}`);
  });
});
