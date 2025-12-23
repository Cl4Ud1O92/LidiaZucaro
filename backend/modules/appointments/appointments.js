// backend/modules/appointments/appointments.js
const express = require('express');
const router = express.Router();

const { db } = require('../../config/database');
const { createEvent } = require('./googleCalendar');
const { verifyToken, requireAdmin } = require('../../middleware/auth');

// Utility: genera slot (mar–sab, 08:30–13:00 e 15:00–19:00, step 30 min)
function generateDailySlots(dateStr) {
  const slots = [];

  const ranges = [
    { start: '08:30', end: '13:00' },
    { start: '15:00', end: '19:00' }
  ];

  for (const range of ranges) {
    let [h, m] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);

    while (h < endH || (h === endH && m < endM)) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      slots.push({ time: `${hh}:${mm}`, status: 'free' });
      m += 30;
      if (m >= 60) {
        m -= 60;
        h += 1;
      }
    }
  }

  return slots;
}

// 1) Lista tutti gli appuntamenti (admin)
router.get('/', (req, res) => {
  db.all(
    `SELECT a.*, u.username 
     FROM appointments a
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY date, time`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 1b) Appuntamenti di un singolo cliente (dashboard)
// GET /api/appointments/my?username=maria
router.get('/my', (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ error: 'Username mancante' });
  }

  db.all(
    `SELECT a.*
     FROM appointments a
     JOIN users u ON a.user_id = u.id
     WHERE u.username = ?
     ORDER BY date, time`,
    [username],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 1c) Slot disponibili per una data
// GET /api/appointments/slots?date=2025-12-24
router.get('/slots', (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res.status(400).json({ error: 'Data mancante' });
  }

  db.all(
    `SELECT time FROM appointments 
     WHERE date = ? AND status IN ('pending', 'confirmed')`,
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const bookedTimes = new Set(rows.map(r => r.time));
      const slots = generateDailySlots(date).map(s => ({
        time: s.time,
        status: bookedTimes.has(s.time) ? 'busy' : 'free'
      }));

      res.json(slots);
    }
  );
});

// 2) Crea nuova richiesta appuntamento
router.post('/', (req, res) => {
  const { user_id, service, date, time, note } = req.body;

  if (!user_id || !service || !date || !time) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }

  db.run(
    `INSERT INTO appointments (user_id, service, date, time, note, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [user_id, service, date, time, note || ''],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 3) Conferma appuntamento + Google Calendar (solo admin)
router.post('/:id/confirm', verifyToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  // Recupera appuntamento + utente
  db.get(
    `SELECT a.*, u.username 
     FROM appointments a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.id = ?`,
    [id],
    (err, appt) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!appt) return res.status(404).json({ error: 'Appuntamento non trovato' });

      // Aggiorna stato a confirmed
      db.run(
        `UPDATE appointments SET status = 'confirmed' WHERE id = ?`,
        [id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          // Prepara evento Calendar (30 minuti)
          const startDateTime = new Date(`${appt.date}T${appt.time}:00`);
          const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);

          const event = {
            summary: `${appt.service} - ${appt.username || 'Cliente'}`,
            description: appt.note || '',
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: 'Europe/Rome',
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: 'Europe/Rome',
            },
          };

          createEvent(event)
            .then((ev) => {
              res.json({ success: true, eventId: ev.id });
            })
            .catch((err3) => {
              console.error('Errore Calendar:', err3);
              res.status(500).json({ success: false, error: 'Errore Google Calendar' });
            });
        }
      );
    }
  );
});

// 4) Rifiuta appuntamento (solo admin)
// POST /api/appointments/:id/reject
router.post('/:id/reject', verifyToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  db.run(
    `UPDATE appointments SET status = 'rejected' WHERE id = ?`,
    [id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});


module.exports = router;
