const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const resultRoutes = require('./routes/results');
const volunteerRoutes = require('./routes/volunteers');
const publicRoutes = require('./routes/public');
const exportRoutes = require('./routes/exportData');

// Builds the Express app. Kept separate from server.js so tests can import the
// app without opening a database connection or a listening socket.
function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/students', studentRoutes);
  app.use('/api/results', resultRoutes);
  app.use('/api/volunteers', volunteerRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api', publicRoutes); // /api/config, /api/leaderboard, /api/stats

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // One server, one port serves everything:
  //   /            -> public leaderboard (QR target, §15)
  //   /staff/      -> staff sign-in (volunteers & admins, §3)
  app.use('/staff', express.static(path.join(__dirname, '..', 'staff-web')));
  app.use('/', express.static(path.join(__dirname, '..', 'public-web')));

  return app;
}

module.exports = createApp;
