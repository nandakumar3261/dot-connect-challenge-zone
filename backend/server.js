require('dotenv').config();
const mongoose = require('mongoose');
const createApp = require('./app');

const app = createApp();
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DoTT Connect Challenge Zone running on http://localhost:${PORT}`);
      console.log(`  Public leaderboard : http://localhost:${PORT}/`);
      console.log(`  Staff sign-in      : http://localhost:${PORT}/staff/login.html`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
