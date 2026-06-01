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
const appointmentRoutes = require('./src/routes/appointmentRoutes'); // Appointment Booking
const bookingRoutes = require('./src/routes/bookingRoutes'); // Public Booking Pages
const supportRoutes = require('./src/routes/supportRoutes'); // In-built Help Center
const { authMiddleware } = require('./src/middleware/authMiddleware');
const requireModule = require('./src/middleware/moduleMiddleware');
const { renderPublicBookingPage } = require('./src/views/publicBookingPage');
const webLeadRoutes = require('./src/routes/webLeadRoutes'); // Web-to-Lead embed
const mcpRoutes = require('./src/routes/mcpRoutes'); // Claude AI / MCP server
const sequenceRoutes = require('./src/routes/sequenceRoutes'); // Drip Sequences
const billingRoutes = require('./src/routes/billingRoutes'); // Cashfree Autodebit Subscriptions

const app = express();

// Render → Cloudflare → Express adds two proxy hops, so X-Forwarded-For has
// "<client>, <render-edge>". Trust both so express-rate-limit can read the
// real client IP from req.ip without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 2);

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
  'https://app.adfliker.com',
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
  console.warn('   → Set FRONTEND_URL to your production domain before deploying (e.g. https://app.adfliker.com)');
}

// ⚠️ PRODUCTION NOTE:
// Connection pool size must reflect real concurrent load.
// Oversizing wastes RAM and can hit Atlas connection limits.
// DO NOT increase blindly — monitor active connections via Atlas metrics before changing.
mongoose.connect(MONGO_URI, {
  // Sized for 100+ tenants on a single instance. Node is single-threaded, so the
  // pool mainly absorbs concurrent I/O waits (not CPU) — 150 gives ample headroom
  // while staying well under the Atlas tier connection cap (e.g. M10 ≈ 1500).
  // Override via env without a redeploy; watch Atlas "active connections" when tuning.
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 150,
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 10,  // warm connections to avoid cold-start latency
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

    // Normalize any agency workspace that still carries stale trial state from
    // earlier code paths. Agencies are lifetime-free — they should never have a
    // planExpiryDate or subscriptionStatus=trial. Idempotent and cheap to run.
    try {
      const User = require('./src/models/User');
      const WorkspaceSettings = require('./src/models/WorkspaceSettings');
      const agencies = await User.find({ role: 'agency' }).select('_id').lean();
      if (agencies.length > 0) {
        const result = await WorkspaceSettings.updateMany(
          {
            userId: { $in: agencies.map(a => a._id) },
            $or: [
              { planExpiryDate: { $ne: null } },
              { subscriptionStatus: 'trial' },
              { billingType: 'trial' }
            ]
          },
          {
            $set: {
              planExpiryDate: null,
              subscriptionPlan: 'Lifetime Free',
              subscriptionStatus: 'active',
              billingType: 'paid_by_agency'
            }
          }
        );
        if (result.modifiedCount > 0) {
          console.log(`🤝 Normalized ${result.modifiedCount} agency workspace(s) to lifetime-free.`);
        }
      }
    } catch (err) {
      console.warn('⚠️  Agency normalization on startup failed:', err.message);
    }

    // ℹ️  WhatsApp credentials are per-tenant (configured via Settings → WhatsApp Config).
    // Super Admin does NOT have a WhatsApp inbox, so no seed is needed.


    // Google Sheet sync is now PUSH-based (Apps Script webhook) — no polling scheduler needed
    console.log('📋 Google Sheet Sync: Push mode (zero polling cost)');

    // ── BullMQ: Broadcast worker (Redis-backed, concurrency: 2) ─────────────────
    // Broadcasts are the heaviest job type. Running them on BullMQ gives:
    //   - global concurrency cap across all tenants (max 2 simultaneous)
    //   - Redis-backed queue (sub-ms dispatch vs Agenda's 30s polling)
    //   - built-in 3-attempt exponential-backoff retry on crash
    try {
      if (!process.env.REDIS_URL) {
        console.warn('⚠️  REDIS_URL not set — BullMQ Broadcast Worker will not start.');
        console.warn('   Add REDIS_URL to .env to enable broadcast queue.');
      } else {
        const { startBroadcastWorker, getBroadcastQueue } = require('./src/services/broadcastQueueService');
        startBroadcastWorker();

        // ── Orphan recovery ────────────────────────────────────────────────────
        // On every startup, find broadcasts whose BullMQ job was lost (e.g. Redis
        // restart wiped the queue). Re-queue them so they are not stuck forever.
        // This makes free-tier ephemeral Redis survivable.
        try {
          const WhatsAppBroadcast = require('./src/models/WhatsAppBroadcast');
          const queue = getBroadcastQueue();
          const now   = new Date();

          // PROCESSING: job was running or waiting — re-queue immediately
          const stuck = await WhatsAppBroadcast.find({ status: 'PROCESSING' }).lean();
          for (const bc of stuck) {
            const existingJob = bc.jobId ? await queue.getJob(bc.jobId) : null;
            if (!existingJob) {
              const job = await queue.add('process-broadcast', {
                broadcastId: bc._id.toString(),
                userId:      bc.userId.toString(),
                tenantId:    bc.userId.toString()
              });
              await WhatsAppBroadcast.findByIdAndUpdate(bc._id, { $set: { jobId: job.id } });
              console.log(`[Orphan Recovery] Re-queued PROCESSING broadcast ${bc._id}`);
            }
          }

          // SCHEDULED: job was delayed — re-add with remaining delay (or immediately if past due)
          const scheduled = await WhatsAppBroadcast.find({ status: 'SCHEDULED' }).lean();
          for (const bc of scheduled) {
            const existingJob = bc.jobId ? await queue.getJob(bc.jobId) : null;
            if (!existingJob) {
              const delayMs = bc.scheduledFor ? Math.max(0, new Date(bc.scheduledFor) - now) : 0;
              const job = await queue.add('process-broadcast', {
                broadcastId: bc._id.toString(),
                userId:      bc.userId.toString(),
                tenantId:    bc.userId.toString()
              }, { delay: delayMs });
              await WhatsAppBroadcast.findByIdAndUpdate(bc._id, { $set: { jobId: job.id } });
              console.log(`[Orphan Recovery] Re-queued SCHEDULED broadcast ${bc._id} (delay: ${delayMs}ms)`);
            }
          }
        } catch (recoveryErr) {
          console.error('⚠️ Orphan broadcast recovery failed (non-critical):', recoveryErr.message);
        }
      }
    } catch (error) {
      console.error('⚠️ Failed to start BullMQ Broadcast Worker:', error.message);
    }

    // ── Agenda: Automations, WhatsApp chatbot delays, Email scheduling ────────
    // These lower-volume jobs remain on Agenda (MongoDB-backed) — no Redis needed.
    try {
      const { Agenda } = require('agenda');
      const { setAgenda } = require('./src/services/agendaService');

      const agenda = new Agenda({
        db: { address: MONGO_URI, collection: 'agendaJobs' },
        processEvery: '30 seconds',
        maxConcurrency: 20
      });

      // ⚠️ IMPORTANT: ALL job definitions must be registered BEFORE agenda.start()
      // Agenda ignores jobs defined after start() for already-queued tasks.

      // 1. CRM Automation rule jobs (EXECUTE_AUTOMATION_ACTION)
      const { defineAutomationJobs } = require('./src/services/AutomationService');
      defineAutomationJobs(agenda);

      // 2. WhatsApp chatbot delay jobs + CHECK_REPLY_TIMEOUT
      const { defineWhatsAppJobs } = require('./src/services/whatsappQueueService');
      defineWhatsAppJobs(agenda);

      // 3. Email Scheduling jobs (send_scheduled_email)
      const { defineEmailJobs } = require('./src/services/emailQueueService');
      defineEmailJobs(agenda);

      // 4. Drip Sequence step jobs (PROCESS_SEQUENCE_STEP)
      const { defineSequenceJobs } = require('./src/services/sequenceService');
      defineSequenceJobs(agenda);

      // ✅ Start AFTER all definitions are registered
      await agenda.start();
      setAgenda(agenda); // Register for graceful shutdown
      console.log('✅ Agenda Job Queue Started (Automations, WhatsApp, Email)');

      // Purge stale jobs older than 7 days to prevent DB bloat
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

// 1b. Billing / Cashfree Autodebit Subscriptions
// Webhook is public (signature-verified inside the controller); customer +
// superadmin routes apply authMiddleware per-route inside billingRoutes.js.
app.use('/api/billing', billingRoutes);

// 2. Leads System
// Plan-gated by the 'leads' module (covers leads + their pipeline config: stages,
// custom fields, tags). Mirrors the email/whatsapp/automations gates so a tier
// without Leads can't reach these APIs directly even if the nav is hidden.
app.use('/api/leads', authMiddleware, requireModule('leads'), leadRoutes);
app.use('/api/stages', authMiddleware, requireModule('leads'), stageRoutes);
app.use('/api/custom-fields', authMiddleware, requireModule('leads'), customFieldRoutes);
app.use('/api/tags', authMiddleware, requireModule('leads'), require('./src/routes/tagRoutes'));
app.use('/api/tasks', authMiddleware, taskRoutes);
// Plan-gated by the 'automations' module (drip Sequences are part of Automations,
// not a separate module). Mirrors the email/whatsapp/chatbot gates so a Basic-tier
// user can't reach these APIs directly even if the nav is hidden.
app.use('/api/automations', authMiddleware, requireModule('automations'), automationRoutes);
app.use('/api/sequences', authMiddleware, requireModule('automations'), sequenceRoutes);
app.use('/api/appointments', authMiddleware, appointmentRoutes);

// In-built Help Center (auth handled inside route file — supports customer + super admin)
app.use('/api/support', supportRoutes);

// Public booking page (no auth — customer-facing)
app.use('/api/book', bookingRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));

// 🌐 Web-to-Lead Capture (public /capture + authenticated /config, /regenerate)
app.use('/api/web-leads', webLeadRoutes);

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
const quickReplyRoutes = require('./src/routes/quickReplyRoutes');
app.use('/api/whatsapp/quick-replies', authMiddleware, quickReplyRoutes);

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
app.use('/mcp', mcpRoutes);           // Claude AI MCP server (API-key auth, no JWT)

// Meta Webhook URL: /api/meta/webhook

// 5. BULL BOARD — queue monitoring dashboard (only when Redis is configured)
// Access: /admin/queues?key=<BULL_BOARD_SECRET>
// To enable: set REDIS_URL and BULL_BOARD_SECRET in your environment variables.
// BULL_BOARD_SECRET acts as the password — use a long random string.
if (process.env.REDIS_URL && process.env.BULL_BOARD_SECRET) {
  try {
    const { createBullBoard }  = require('@bull-board/api');
    const { BullMQAdapter }    = require('@bull-board/api/bullMQAdapter');
    const { ExpressAdapter }   = require('@bull-board/express');
    const { getBroadcastQueue } = require('./src/services/broadcastQueueService');

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [new BullMQAdapter(getBroadcastQueue())],
      serverAdapter
    });

    // Simple secret-key auth — no JWT, no session; admin opens URL with ?key=<secret>
    app.use('/admin/queues', (req, res, next) => {
      if (req.query.key !== process.env.BULL_BOARD_SECRET) {
        return res.status(401).send('Unauthorized — add ?key=<BULL_BOARD_SECRET> to the URL');
      }
      next();
    }, serverAdapter.getRouter());

    console.log('✅ Bull Board: /admin/queues?key=<BULL_BOARD_SECRET>');
  } catch (e) {
    console.warn('⚠️  Bull Board failed to start:', e.message);
  }
}

// 6. HEALTH CHECK & KEEP-ALIVE (must be BEFORE catch-all)
app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// Public Booking Page (HTML + Tailwind, no React required)
// This prevents blank screens if the SPA bundle doesn't yet include /book/:slug.
app.get('/book/:slug', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderPublicBookingPage(req.params.slug));
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
let isShuttingDown = false;
const gracefulShutdown = async (signal, exitCode = 0) => {
  if (isShuttingDown) return;   // ignore repeat signals / errors raised during shutdown
  isShuttingDown = true;
  console.log(`\n⚠️ ${signal} received. Starting graceful shutdown...`);

  // Watchdog: if cleanup hangs (e.g. a stuck socket), force-exit so the platform
  // can restart a fresh process instead of leaving a half-dead one running.
  const watchdog = setTimeout(() => {
    console.error('⏱️  Graceful shutdown timed out after 10s — forcing exit.');
    process.exit(exitCode);
  }, 10000);
  watchdog.unref();

  // 1. Stop accepting new requests
  server.close(() => {
    console.log('✅ HTTP server closed');
  });

  // 2. Stop BullMQ broadcast worker
  try {
    const { getBroadcastWorker } = require('./src/services/broadcastQueueService');
    const worker = getBroadcastWorker();
    if (worker) {
      await worker.close();
      console.log('✅ BullMQ broadcast worker stopped');
    }
  } catch (e) {
    // Worker may not be initialized (e.g. REDIS_URL not set)
  }

  // 3. Close Redis connection
  try {
    const { closeRedisConnection } = require('./src/services/redisConnection');
    await closeRedisConnection();
  } catch (e) {
    // Redis may not be initialized
  }

  // 4. Stop Agenda queue (automations, chatbot delays, email)
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

  // 5. Close MongoDB connection
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (e) {
    console.error('Error closing MongoDB:', e.message);
  }

  console.log('👋 Graceful shutdown complete');
  process.exit(exitCode);
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
  // After an uncaught exception the process is in an undefined state — continuing to
  // serve risks corrupt data and hard-to-debug behaviour. Shut down cleanly and exit
  // non-zero so the platform (Render) restarts a fresh process.
  gracefulShutdown('uncaughtException', 1);
});
