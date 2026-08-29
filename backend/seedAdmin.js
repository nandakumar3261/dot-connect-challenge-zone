require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// Creates (or updates) the first administrator account from the .env values.
async function seed() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD in your .env file first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await bcrypt.hash(password, 10);

  await User.findOneAndUpdate(
    { username },
    { username, passwordHash, role: 'admin', displayName: 'Administrator', active: true },
    { upsert: true, new: true }
  );

  console.log(`Administrator account ready: ${username}`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
