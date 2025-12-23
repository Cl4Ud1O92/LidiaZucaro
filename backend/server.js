const express = require('express');
const cors = require('cors');

const { initDB } = require('./config/database');

const authRoutes = require('./modules/auth/auth');
const appointmentRoutes = require('./modules/appointments/appointments');
const userRoutes = require('./modules/users/users');

const app = express();
app.use(cors());
app.use(express.json());

initDB();

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Lidia backend v2 up & running' });
});

// Auth
app.use('/api/auth', authRoutes);

// User
app.use('/api/users', userRoutes);

// Appuntamenti
app.use('/api/appointments', appointmentRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server Lidia v2 in ascolto su http://localhost:${PORT}`)
);
