const path = require('path');
// 1. .env file ko zabardasti load karo (Safe Mode)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Routes Import
const authRoutes = require('./src/routes/authRoutes');
const leadRoutes = require('./src/routes/leadRoutes');   // ✅ Leads ke liye
const stageRoutes = require('./src/routes/stageRoutes'); // ✅ Stages ke liye (NEW)
const emailRoutes = require('./src/routes/emailRoutes');
const emailTemplateRoutes = require('./src/routes/emailTemplateRoutes');
const emailLogRoutes = require('./src/routes/emailLogRoutes');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const whatsappTemplateRoutes = require('./src/routes/whatsappTemplateRoutes');
const whatsAppLogRoutes = require('./src/routes/whatsAppLogRoutes');
const superAdminRoutes = require('./src/routes/superAdminRoutes');
const metaRoutes = require('./src/routes/metaRoutes'); // Meta Lead Sync
const customFieldRoutes = require('./src/routes/customFieldRoutes'); // Custom Lead Fields
const reportRoutes = require('./src/routes/reportRoutes'); // Reports & Analytics

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});
app.use(express.static('public'));
// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/dist')));

// 🔥 DATABASE CONNECTION
// SECURITY FIX: Use environment variable instead of hardcoded credentials
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ CRITICAL: MONGO_URI not found in environment variables!');
  console.error('Please set MONGO_URI in your .env file');
  process.exit(1);
}

// Validate Super Admin credentials
if (!process.env.SUPERADMIN_EMAIL || !process.env.SUPERADMIN_PASSWORD) {
  console.error('❌ CRITICAL: SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in .env');
  console.error('Add these to your .env file:');
  console.error('   SUPERADMIN_EMAIL=superadmin@crm.com');
  console.error('   SUPERADMIN_PASSWORD=YourSecurePassword123!');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected to Cloud! ☁️');

    // Auto-create/update Super Admin on startup
    try {
      console.log('\n🔐 Initializing Super Admin...');
      const createSuperAdmin = require('./scripts/createSuperAdmin');
      await createSuperAdmin();
    } catch (error) {
      console.error('⚠️  Failed to initialize Super Admin:', error.message);
      console.error('Server will continue, but Super Admin may not be available.');
    }
  })
  .catch(err => {
    console.error('\n❌ MongoDB Connection Error:');
    console.error('   Error:', err.message);
    if (err.code === 8000 || err.message.includes('authentication failed')) {
      console.error('\n⚠️  Authentication Failed - Check your credentials:');
      console.error('   1. Verify username and password in MONGO_URI');
      console.error('   2. If password contains special characters, URL-encode them');
      console.error('   3. Check MongoDB Atlas: Database Access -> User credentials');
      console.error('   4. Ensure IP address is whitelisted in Network Access');
      console.error('\n   Example MONGO_URI format:');
      console.error('   mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority');
    } else if (err.message.includes('MONGO_URI')) {
      console.error('   Please check your .env file and ensure MONGO_URI is set correctly');
    }
    console.error('');
    process.exit(1);
  });

// ===========================
// 🛣️ ROUTES SETUP
// ===========================

// 1. Auth & Super Admin
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superAdminRoutes);

// 2. Leads System (FIXED PATHS) 🛠️
app.use('/api/leads', leadRoutes);    // URL: /api/leads/
app.use('/api/stages', stageRoutes);  // URL: /api/stages/
app.use('/api/custom-fields', customFieldRoutes); // Custom Lead Fields

// 3. Communications
app.use('/api/email', emailRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/email-logs', emailLogRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp/templates', whatsappTemplateRoutes);
app.use('/api/whatsapp-logs', whatsAppLogRoutes);

// 4. Meta Lead Sync
app.use('/api/meta', metaRoutes);
app.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));
app.use('/api/reports', reportRoutes); // Reports & Analytics

// Meta Webhook URL: /api/meta/webhook

// Catch-all handler: for any request that doesn't match API routes,
// send back React's index.html file (for client-side routing)
app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// 🔥 SERVER START
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Running on Port ${PORT}`);
  console.log("👉 Verify Token in .env:", process.env.VERIFY_TOKEN ? "✅ Loaded" : "❌ Missing");
  console.log("📡 WhatsApp Webhook URL:");
  console.log(`   GET/POST: http://your-domain.com:${PORT}/api/whatsapp/webhook`);
  console.log(`   For local testing: http://localhost:${PORT}/api/whatsapp/webhook`);
  console.log("⚠️  Make sure VERIFY_TOKEN in .env matches Meta's webhook verify token!");
});