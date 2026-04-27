const path = require('path');
// 1. .env file ko zabardasti load karo (Safe Mode)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const { initSocket } = require('./src/services/socketService');

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
const agencyRoutes = require('./src/routes/agencyRoutes'); // Reseller actions
const metaRoutes = require('./src/routes/metaRoutes'); // Meta Lead Sync
const customFieldRoutes = require('./src/routes/customFieldRoutes'); // Custom Lead Fields
const reportRoutes = require('./src/routes/reportRoutes'); // Reports & Analytics
const taskRoutes = require('./src/routes/taskRoutes'); // Tasks & Reminders
const analyticsRoutes = require('./src/routes/analyticsRoutes'); // Advanced Analytics
const automationRoutes = require('./src/routes/automationRoutes'); // Visual Automation Engine
const { authMiddleware } = require('./src/middleware/authMiddleware');

const app = express();

// Middleware
// IMPORTANT: We use a verify callback to capture the raw request body buffer.
// Meta signs the RAW bytes of the payload, not the re-serialized JSON.
// Without this, verifySignature() will always fail when META_APP_SECRET is set.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // Attach the raw Buffer to req for webhook signature verification
  }
}));
// ⚠️ SECURITY: Helmet adds critical HTTP headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
// Without this, the app is vulnerable to clickjacking, MIME sniffing, and protocol downgrade attacks.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow serving static assets cross-origin
  contentSecurityPolicy: false // Disable CSP to avoid breaking inline scripts in React
}));

// ⚠️ SECURITY: CORS must be restricted to known frontend origins.
// Wide-open CORS allows any website to make authenticated API calls using stolen tokens.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, webhooks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Request logger (only in development to avoid log pollution in production)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/dist')));
app.use(express.static('public')); // Keep for existing public assets if any

// ⚠️ SECURITY: Uploaded files are served ONLY through authenticated routes.
// Previously exposed at /uploads with NO auth — any URL guess could access private documents.
// Now protected: files are only accessible via the authenticated download endpoints.
app.use('/uploads', authMiddleware, express.static('uploads'));

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

// ⚠️ NON-CRITICAL STARTUP WARNINGS — won't block startup but flags config gaps
if (!process.env.META_APP_SECRET) {
  console.warn('⚠️  WARNING: META_APP_SECRET is not set in .env');
  console.warn('   → WhatsApp webhook signature verification is DISABLED.');
  console.warn('   → Anyone can send fake webhook events to your server.');
  console.warn('   → Set META_APP_SECRET from your Meta App Dashboard → Settings → Basic.');
}
if (!process.env.META_APP_ID || process.env.META_APP_ID === 'YOUR_META_APP_ID') {
  console.warn('⚠️  WARNING: META_APP_ID is not configured in .env');
  console.warn('   → Meta Lead Sync (Facebook Lead Ads) will NOT work.');
  console.warn('   → Set META_APP_ID from your Meta App Dashboard → Settings → Basic.');
}
if (!process.env.FRONTEND_URL) {
  console.warn('⚠️  WARNING: FRONTEND_URL is not set in .env');
  console.warn('   → CORS will only allow localhost origins.');
  console.warn('   → Set FRONTEND_URL to your production domain before deploying (e.g. https://your-app.onrender.com)');
}

// ⚠️ PRODUCTION NOTE:
// Connection pool size must reflect real concurrent load.
// Oversizing wastes RAM and can hit Atlas connection limits.
// DO NOT increase blindly — monitor active connections via Atlas metrics before changing.
mongoose.connect(MONGO_URI, {
  maxPoolSize: 50,  // Right-sized for ~20 clients (was 250 — wasted ~200MB RAM)
  minPoolSize: 5,   // Keep 5 alive for cold-start prevention (was 20 — held too many idle)
  serverSelectionTimeoutMS: 15000, // Wait 15s instead of 30s before failing if DB is unreachable
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
})
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

    // ℹ️  WhatsApp credentials are per-tenant (configured via Settings → WhatsApp Config).
    // Super Admin does NOT have a WhatsApp inbox, so no seed is needed.


    // Google Sheet sync is now PUSH-based (Apps Script webhook) — no polling scheduler needed
    console.log('📋 Google Sheet Sync: Push mode (zero polling cost)');

    // Initialize Agenda for Broadcasting, Automations, and WhatsApp Queue
    try {
      const { Agenda } = require('agenda');
      const agenda = new Agenda({
        db: { address: MONGO_URI, collection: 'agendaJobs' },
        processEvery: '30 seconds',
        maxConcurrency: 20
      });

      // ⚠️ IMPORTANT: ALL job definitions must be registered BEFORE agenda.start()
      // Agenda ignores jobs defined after start() for already-queued tasks.

      // 1. Broadcast jobs (WhatsApp bulk sends)
      const { defineBroadcastJob } = require('./src/controllers/whatsappBroadcastController');
      defineBroadcastJob(agenda);

      // 2. CRM Automation rule jobs (EXECUTE_AUTOMATION_ACTION)
      const { defineAutomationJobs } = require('./src/services/AutomationService');
      defineAutomationJobs(agenda);

      // 3. WhatsApp chatbot delay jobs + CHECK_REPLY_TIMEOUT
      const { defineWhatsAppJobs } = require('./src/services/whatsappQueueService');
      defineWhatsAppJobs(agenda);

      // 4. Email Scheduling jobs (send_scheduled_email)
      const { defineEmailJobs } = require('./src/services/emailQueueService');
      defineEmailJobs(agenda);

      // ✅ Start AFTER all definitions are registered
      await agenda.start();
      console.log('✅ Agenda Job Queue Started (Broadcasts, Automations, WhatsApp Queue)');

      // ⚠️ PRODUCTION NOTE:
      // Agenda does NOT auto-clean completed/failed jobs.
      // Without TTL, this collection will grow indefinitely and increase storage cost.
      // This cleanup runs on startup to purge stale jobs older than 7 days.
      try {
        const jobsCollection = mongoose.connection.db.collection('agendaJobs');
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const cleanupResult = await jobsCollection.deleteMany({
          $or: [
            { lastFinishedAt: { $lt: sevenDaysAgo } },
            { failedAt: { $lt: sevenDaysAgo } }
          ]
        });
        if (cleanupResult.deletedCount > 0) {
          console.log(`🧹 Cleaned up ${cleanupResult.deletedCount} stale Agenda jobs (>7 days old)`);
        }
      } catch (cleanupErr) {
        console.error('⚠️ Agenda cleanup failed (non-critical):', cleanupErr.message);
      }
    } catch (error) {
      console.error('⚠️ Failed to start Agenda Queues:', error.message);
    }

    // Start IMAP Email Polling Service
    try {
      const { startEmailSyncPolling } = require('./src/services/imapService');
      startEmailSyncPolling();
    } catch (error) {
      console.error('⚠️ Failed to start IMAP Polling Service:', error.message);
    }

    // Start Chatbot Followup Service
    try {
      const { initializeFollowupService } = require('./src/services/chatbotFollowupService');
      initializeFollowupService();
    } catch (error) {
      console.error('⚠️ Failed to start Chatbot Followup Service:', error.message);
    }

    // 🕐 Start Trial Expiry Cron Job (Trial → free_limited auto-downgrade)
    try {
      const { startCronJobs } = require('./src/services/cronJobs');
      startCronJobs();
    } catch (error) {
      console.error('⚠️ Failed to start Trial Expiry Cron:', error.message);
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
// ⏱️ RED ALERT API TELEMETRY
// ===========================
const telemetryService = require('./src/services/telemetryService');

app.use((req, res, next) => {
  // Only track actual API calls
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/webhook/')) {
    return next();
  }

  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const timeInMs = (diff[0] * 1e3) + (diff[1] * 1e-6);

    // Extract tenant ID if auth middleware set it (for abuse tracking)
    const tenantId = req.tenantId || req.user?.id || null;

    telemetryService.recordApiRequest(res.statusCode, tenantId, timeInMs);
  });

  next();
});

// Flush Telemetry counts every 15 minutes to reset the 'rolling' window
setInterval(() => {
  telemetryService.flush();
}, 15 * 60 * 1000);

// ===========================
// 🛣️ ROUTES SETUP
// ===========================

// 1. Auth & Super Admin
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/agency', agencyRoutes);

// 2. Leads System
app.use('/api/leads', authMiddleware, leadRoutes);
app.use('/api/stages', authMiddleware, stageRoutes);
app.use('/api/custom-fields', authMiddleware, customFieldRoutes);
app.use('/api/tags', authMiddleware, require('./src/routes/tagRoutes'));
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/automations', authMiddleware, automationRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));

// 3. Communications
app.use('/api/email', authMiddleware, emailRoutes);
app.use('/api/email-conversations', authMiddleware, emailConversationRoutes);
app.use('/api/email-templates', authMiddleware, emailTemplateRoutes);
app.use('/api/email-logs', authMiddleware, emailLogRoutes);

// WhatsApp Webhook (PUBLIC - no auth, Meta needs to access)
const whatsappWebhookRoutes = require('./src/routes/whatsappWebhookRoutes');
app.use('/webhook/whatsapp', whatsappWebhookRoutes);

// Google Sheet Push Webhook (PUBLIC - no auth, Apps Script needs to access)
const sheetWebhookRoutes = require('./src/routes/sheetWebhookRoutes');
app.use('/api/webhooks', sheetWebhookRoutes);

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

// 5. HEALTH CHECK & KEEP-ALIVE (must be BEFORE catch-all)
app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// 6. CATCH-ALL HANDLER FOR REACT SPA
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
const server = http.createServer(app);

// 🔌 Initialize Socket.IO on the same HTTP server
initSocket(server);

// ⚠️ SECURITY: Global error handler — catches unhandled errors from any middleware/route.
// Without this, Express sends raw stack traces to the client.
app.use((err, req, res, next) => {
  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'CORS: Origin not allowed' });
  }
  console.error('Unhandled Error:', err.stack || err.message);
  res.status(err.status || 500).json({ message: 'Internal server error' });
});

server.listen(PORT, () => {
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

// ⚠️ PRODUCTION: Graceful shutdown — cleanly close connections when server is stopped.
// Without this, Render restarts can leave orphaned DB connections and interrupted Agenda jobs.
const gracefulShutdown = async (signal) => {
  console.log(`\n⚠️ ${signal} received. Starting graceful shutdown...`);
  
  // 1. Stop accepting new requests
  server.close(() => {
    console.log('✅ HTTP server closed');
  });

  // 2. Stop Agenda queue
  try {
    const { getAgenda } = require('./src/services/agendaService');
    const agenda = getAgenda();
    if (agenda) {
      await agenda.stop();
      console.log('✅ Agenda job queue stopped');
    }
  } catch (e) {
    // Agenda may not be initialized
  }

  // 3. Close MongoDB connection
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (e) {
    console.error('Error closing MongoDB:', e.message);
  }

  console.log('👋 Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ⚠️ CRASH PROTECTION: Catch unhandled promise rejections and uncaught exceptions.
// Without these, a single unhandled rejection (e.g. a DB query inside setImmediate)
// will crash the entire Node.js process — taking down ALL users simultaneously.
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
  // Do NOT exit — keep the server alive for other users
});

process.on('uncaughtException', (error) => {
  console.error('💥 UNCAUGHT EXCEPTION:', error);
  // For truly fatal errors, log and exit gracefully
  if (error.message?.includes('ENOMEM') || error.message?.includes('out of memory')) {
    console.error('🔥 Fatal memory error — shutting down...');
    process.exit(1);
  }
  // For non-fatal exceptions, keep running
});