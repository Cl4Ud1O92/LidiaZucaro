// backend/modules/users/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { db } = require('../../config/database');
const { verifyToken, requireAdmin } = require('../../middleware/auth');

// GET /api/users  (lista utenti) – solo admin
router.get('/', verifyToken, requireAdmin, (req, res) => {
  db.all(
    `SELECT id, username, role, points, created_at
     FROM users
     ORDER BY id`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// POST /api/users  (crea nuova cliente) – solo admin
router.post('/', verifyToken, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password richiesti' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  const finalRole = role || 'client';

  db.run(
    `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
    [username, hashed, finalRole],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, username, role: finalRole });
    }
  );
});

module.exports = router;
