// backend/modules/appointments/appointments.js
const express = require('express');
const router = express.Router();
const { db } = require('../../config/database');
const { verifyToken } = require('../../middleware/auth');
const { notifyAdminsNewAppointment } = require('../push/push');

// Genera slot orari per un giorno (fasce 08:30–13:00, 15:00–19:00 ogni 30')
function generateDailySlots(dateStr) {
  const slots = [];
  const morningStart = new Date(`${dateStr}T08:30:00`);
  const morningEnd   = new Date(`${dateStr}T13:00:00`);
  const afternoonStart = new Date(`${dateStr}T15:00:00`);
  const afternoonEnd   = new Date(`${dateStr}T19:00:00`);

  let current = new Date(morningStart);
  while (current < morningEnd) {
    slots.push(current.toTimeString().slice(0, 5));
    current.setMinutes(current.getMinutes() + 30);
  }

  current = new Date(afternoonStart);
  while (current < afternoonEnd) {
    slots.push(current.toTimeString().slice(0, 5));
    current.setMinutes(current.getMinutes() + 30);
  }

  return slots;
}

// GET /api/appointments/slots?date=YYYY-MM-DD - slot liberi per quella data
router.get('/slots', verifyToken, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Data richiesta' });

  const allSlots = generateDailySlots(date);

  db.all(
    `SELECT time FROM appointments 
     WHERE date = ? AND status IN ('pending','confirmed')`,
    [date],
    (err, rows) => {
      if (err) {
        console.error('Errore lettura slot:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      const occupied = rows.map(r => r.time);
      const available = allSlots.filter(t => !occupied.includes(t));
      res.json({ date, slots: available });
    }
  );
});

// GET /api/appointments - lista completa per ADMIN
router.get('/', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }

  db.all(
    `SELECT a.id, a.user_id, u.username, a.service, a.date, a.time, a.note, a.status, a.created_at
     FROM appointments a
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.date ASC, a.time ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Errore lista appuntamenti:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      res.json(rows);
    }
  );
});

// GET /api/appointments/me - appuntamenti del cliente loggato
router.get('/me', verifyToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT id, service, date, time, note, status, created_at
     FROM appointments
     WHERE user_id = ?
     ORDER BY date ASC, time ASC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Errore lista appuntamenti cliente:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      res.json(rows);
    }
  );
});

// POST /api/appointments - nuova richiesta appuntamento (cliente)
router.post('/', verifyToken, (req, res) => {
  const userId = req.user.id;
  const { service, date, time, note } = req.body;

  if (!service || !date || !time) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }

  // controlla che lo slot sia ancora libero
  db.get(
    `SELECT id FROM appointments 
     WHERE date = ? AND time = ? AND status IN ('pending','confirmed')`,
    [date, time],
    (err, row) => {
      if (err) {
        console.error('Errore controllo slot:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      if (row) {
        return res.status(409).json({ error: 'Slot già occupato' });
      }

      db.run(
        `INSERT INTO appointments (user_id, service, date, time, note, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [userId, service, date, time, note || ''],
        function (err2) {
          if (err2) {
            console.error('Errore inserimento appuntamento:', err2);
            return res.status(500).json({ error: 'Errore DB' });
          }

          const appointmentId = this.lastID;

          // recupera username per la notifica
          db.get(
            `SELECT username FROM users WHERE id = ?`,
            [userId],
            (err3, user) => {
              if (err3) {
                console.error('Errore lettura utente per notifica:', err3);
              } else if (user) {
                // notifica push agli admin: nuova richiesta
                notifyAdminsNewAppointment({
                  id: appointmentId,
                  username: user.username,
                  service,
                  date,
                  time
                });
              }

              res.status(201).json({
                id: appointmentId,
                user_id: userId,
                service,
                date,
                time,
                note: note || '',
                status: 'pending'
              });
            }
          );
        }
      );
    }
  );
});

// PUT /api/appointments/:id/confirm - conferma appuntamento (admin)
router.put('/:id/confirm', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }
  const { id } = req.params;

  db.run(
    `UPDATE appointments SET status = 'confirmed' WHERE id = ?`,
    [id],
    function (err) {
      if (err) {
        console.error('Errore conferma appuntamento:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Appuntamento non trovato' });
      }
      res.json({ success: true });
    }
  );
});

// PUT /api/appointments/:id/reject - rifiuta appuntamento (admin)
router.put('/:id/reject', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }
  const { id } = req.params;

  db.run(
    `UPDATE appointments SET status = 'rejected' WHERE id = ?`,
    [id],
    function (err) {
      if (err) {
        console.error('Errore rifiuto appuntamento:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Appuntamento non trovato' });
      }
      res.json({ success: true });
    }
  );
});

module.exports = router;
