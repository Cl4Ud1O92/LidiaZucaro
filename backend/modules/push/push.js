// backend/modules/push/push.js
const express = require('express');
const webpush = require('web-push');
const router = express.Router();

const { db } = require('../../config/database');
const { verifyToken } = require('../../middleware/auth');

// Inserisci qui le chiavi generate
const VAPID_PUBLIC_KEY = 'BLDlROHkWt7U9P-REoHGlv8Di3aov-cmQ5-zy58ppWbsm7buTA8vGKac6MQNvTRKyVJA6aVKlQwUIptrkYC97TI';
const VAPID_PRIVATE_KEY = '6maOM6ryTBKHc1gaC49bLRa2s2HyexKmmNe3p7uHosc';

webpush.setVapidDetails(
  'mailto:info@tuodominio.it',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Esporremo la chiave pubblica al frontend
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Salva subscription dell'admin
router.post('/subscribe-admin', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }

  const subscription = req.body; // { endpoint, keys: { p256dh, auth } }
  const { endpoint, keys } = subscription;

  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Subscription non valida' });
  }

  db.run(
    `INSERT INTO admin_push_subscriptions (admin_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)`,
    [req.user.id, endpoint, keys.p256dh, keys.auth],
    function (err) {
      if (err) {
        console.error('Errore salvataggio subscription:', err);
        return res.status(500).json({ error: 'Errore DB' });
      }
      res.json({ success: true });
    }
  );
});

// Funzione di utilità per inviare notifiche agli admin
async function notifyAdminsNewAppointment(appointment) {
  // appointment: { id, username, service, date, time }
  db.all(
    `SELECT endpoint, p256dh, auth FROM admin_push_subscriptions`,
    async (err, rows) => {
      if (err) {
        console.error('Errore lettura subscription:', err);
        return;
      }
      const payload = JSON.stringify({
        title: 'Nuova richiesta appuntamento',
        body: `${appointment.username} ha richiesto ${appointment.service} il ${appointment.date} alle ${appointment.time}`,
        data: { appointmentId: appointment.id }
      });

      for (const row of rows) {
        const subscription = {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth
          }
        };
        try {
          await webpush.sendNotification(subscription, payload);
        } catch (e) {
          console.error('Errore invio push:', e.statusCode);
          // TODO: se 410/404 puoi eliminare la subscription morta
        }
      }
    }
  );
}

module.exports = {
  router,
  notifyAdminsNewAppointment
};
