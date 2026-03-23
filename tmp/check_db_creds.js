const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' }); // load parent's .env if needed, let's just use .env from where it runs
const path = require('path');
const User = require(path.join(__dirname, '../src/models/User'));

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected!');
    const users = await User.find({}).select('email name waBusinessId waPhoneNumberId waAccessToken');
    console.log("Found", users.length, "users");
    users.forEach(u => {
      console.log(`User: ${u.email}`);
      console.log(`  Phone ID: ${u.waPhoneNumberId}`);
      console.log(`  Business ID: ${u.waBusinessId}`);
      console.log(`  Token Length: ${u.waAccessToken ? u.waAccessToken.length : 'NULL'}`);
    });
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
