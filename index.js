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
const emailConversationRoutes = require('./src/routes/emailConversationRoutes');
const emailTemplateRoutes = require('./src/routes/emailTemplateRoutes');
const emailLogRoutes = require('./src/routes/emailLogRoutes');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const whatsappTemplateRoutes = require('./src/routes/whatsappTemplateRoutes');
const whatsAppLogRoutes = require('./src/routes/whatsAppLogRoutes');
const superAdminRoutes = require('./src/routes/superAdminRoutes');
const billingRoutes = require('./src/routes/billingRoutes'); // Billing & Subscriptions
const agencyRoutes = require('./src/routes/agencyRoutes'); // Reseller actions
const metaRoutes = require('./src/routes/metaRoutes'); // Meta Lead Sync
const customFieldRoutes = require('./src/routes/customFieldRoutes'); // Custom Lead Fields
const reportRoutes = require('./src/routes/reportRoutes'); // Reports & Analytics
const taskRoutes = require('./src/routes/taskRoutes'); // Tasks & Reminders
const analyticsRoutes = require('./src/routes/analyticsRoutes'); // Advanced Analytics
const automationRoutes = require('./src/routes/automationRoutes'); // Visual Automation Engine

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/dist')));
app.use(express.static('public')); // Keep for existing public assets if any

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

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

    // Seed SuperAdmin WhatsApp credentials from .env into DB
    try {
      console.log('\n📱 Seeding SuperAdmin WhatsApp credentials...');
      const seedSuperAdminWhatsApp = require('./scripts/seedWhatsApp');
      await seedSuperAdminWhatsApp(
        process.env.WHATSAPP_TOKEN,
        process.env.Phone_Number_ID || process.env.WA_PHONE_NUMBER_ID,
        process.env.WA_BUSINESS_ID
      );
    } catch (error) {
      console.error('⚠️  Failed to seed WhatsApp credentials:', error.message);
      console.error('Server will continue with .env fallback.');
    }


    // Start Google Sheet Auto-Sync Scheduler
    try {
      const { startSheetSyncScheduler } = require('./src/services/sheetSyncQueue');
      await startSheetSyncScheduler();
    } catch (error) {
      console.error('⚠️  Failed to start Sheet Sync Scheduler:', error.message);
      console.error('Server will continue, but auto-sync will not be available.');
    }
    
    // Initialize Agenda for Broadcasting and Automations
    try {
      const Agenda = require('agenda');
      const agenda = new Agenda({ db: { address: MONGO_URI, collection: 'agendaJobs' } });
      
      const { defineBroadcastJob } = require('./src/controllers/whatsappBroadcastController');
      defineBroadcastJob(agenda);
      
      const { defineAutomationJobs } = require('./src/services/AutomationService');
      defineAutomationJobs(agenda);

      await agenda.start();
      console.log('✅ Agenda Job Queue Started for Broadcasts & Automations');
    } catch(error) {
      console.error('⚠️ Failed to start Agenda Queues:', error.message);
    }
    
    // Start IMAP Email Polling Service
    try {
      const { startEmailSyncPolling } = require('./src/services/imapService');
      startEmailSyncPolling();
    } catch (error) {
      console.error('⚠️ Failed to start IMAP Polling Service:', error.message);
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

// 1. Auth & Super Admin & Billing
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/agency', agencyRoutes);

// 2. Leads System (FIXED PATHS) 🛠️
app.use('/api/leads', leadRoutes);    // URL: /api/leads/
app.use('/api/stages', stageRoutes);  // URL: /api/stages/
app.use('/api/custom-fields', customFieldRoutes); // Custom Lead Fields
app.use('/api/tags', require('./src/routes/tagRoutes')); // Lead Tags Configuration
app.use('/api/tasks', taskRoutes); // Tasks & Reminders
app.use('/api/automations', automationRoutes); // Visual Automations
app.use('/api/analytics', analyticsRoutes); // Advanced Analytics

// 3. Communications
app.use('/api/email', emailRoutes);
app.use('/api/email-conversations', emailConversationRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/email-logs', emailLogRoutes);

// WhatsApp Webhook (PUBLIC - no auth, Meta needs to access)
const whatsappWebhookRoutes = require('./src/routes/whatsappWebhookRoutes');
app.use('/webhook/whatsapp', whatsappWebhookRoutes);

// WhatsApp API (authenticated) - SPECIFIC ROUTES FIRST
app.use('/api/whatsapp/templates', whatsappTemplateRoutes);
const whatsappBroadcastRoutes = require('./src/routes/whatsappBroadcastRoutes');
app.use('/api/whatsapp/broadcasts', whatsappBroadcastRoutes);

// General WhatsApp Routes AFTER specific ones
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp-logs', whatsAppLogRoutes);

// Chatbot flows
const chatbotRoutes = require('./src/routes/chatbotRoutes');
app.use('/api/chatbot/flows', chatbotRoutes);

// 4. Meta Lead Sync
app.use('/api/meta', metaRoutes);
app.use('/api/activity-logs', require('./src/routes/activityLogRoutes'));
app.use('/api/reports', reportRoutes); // Reports & Analytics

// Meta Webhook URL: /api/meta/webhook

// 5. CATCH-ALL HANDLER FOR REACT SPA
// Must be AFTER all API routes - serves React app for client-side routing
app.use((req, res, next) => {
  // Only handle GET requests that aren't for API endpoints
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/webhook/')) {
    const indexPath = path.join(__dirname, 'client/dist/index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('Error serving index.html:', err.message);
        res.status(404).send('Frontend not built. Run: npm run build');
      }
    });
  } else {
    next();
  }
});

// 6. HEALTH CHECK & KEEP-ALIVE (Prevent Render Free Tier Step)
app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// Self-Ping Mechanism (Runs every 10 minutes)
const axios = require('axios');
const reloadWebsite = () => {
  // Replace with your actual Render URL if auto-detection fails
  const url = process.env.SERVER_URL || `http://localhost:${PORT}`;
  axios.get(`${url}/api/health`)
    .then(() => console.log(`✅ Keep-Alive Ping Successful: ${url}`))
    .catch(err => console.error(`❌ Keep-Alive Ping Failed: ${err.message}`));
};

// 🔥 SERVER START
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Running on Port ${PORT}`);

  // Start Keep-Alive Loop (only in production or if configured)
  if (process.env.NODE_ENV === 'production') {
    console.log('⏰ Starting Keep-Alive mechanism (every 10 mins)...');
    setInterval(reloadWebsite, 600000); // 10 minutes
  }

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
  console.log("👉 WA Verify Token:", verifyToken ? "✅ Loaded" : "❌ Missing");
  console.log("📡 WhatsApp Webhook URL (configure in Meta):");
  console.log(`   GET/POST: http://your-domain.com:${PORT}/webhook/whatsapp`);
  console.log(`   For local testing: http://localhost:${PORT}/webhook/whatsapp`);
  if (!verifyToken) {
    console.log("⚠️  Set VERIFY_TOKEN or WA_WEBHOOK_VERIFY_TOKEN in .env to match Meta's webhook verify token!");
  }
});