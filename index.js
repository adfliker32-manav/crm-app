const path = require('path');
// 1. .env file ko zabardasti load karo (Safe Mode)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Routes Import
const leadRoutes = require('./src/routes/leadRoutes');
const authRoutes = require('./src/routes/authRoutes');
const emailRoutes = require('./src/routes/emailRoutes');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes'); // 👈 NEW: Webhook Import kiya

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 🔥 DATABASE CONNECTION
const MONGO_URI = "mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected to Cloud! ☁️'))
  .catch(err => console.error('❌ Cloud DB Error:', err));

// Routes Use
app.use('/api/auth', authRoutes);
app.use('/api', leadRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// 👇 NEW: Isse URL banega: http://localhost:3000/webhook
app.use('/webhook', webhookRoutes); 

// 🔥 SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Running on Port ${PORT}`);
  // Verification ke liye print karo
  console.log("👉 Verify Token in .env:", process.env.VERIFY_TOKEN ? "✅ Loaded" : "❌ Missing");
});