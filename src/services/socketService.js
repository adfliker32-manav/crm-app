// ============================================================
// 🔌 SOCKET.IO SERVICE — Enterprise Real-Time Messaging Layer
// ============================================================
// Singleton module: call initSocket(httpServer) once at startup,
// then use getIO() or emitToUser() from any controller/service.
// ============================================================

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

/**
 * Initialize Socket.IO and attach to the HTTP server.
 * Called once from index.js after creating the HTTP server.
 */
const initSocket = (httpServer) => {
    // ⚠️ SECURITY: Socket.IO CORS MUST match Express CORS.
    // Previously origin: '*' which allowed any website to open WebSocket connections.
    // Now sourced from the shared allowlist rather than a second hand-maintained
    // copy — the local copy had already drifted, omitting the production domain
    // 'https://app.adfliker.com'. Socket.IO compares array entries exactly.
    const { ALLOWED_ORIGINS: allowedOrigins } = require('../config/allowedOrigins');

    io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true
        },
        // ── Reverse Proxy Compatibility (Cloudflare → Render → Node) ──
        // Cloudflare can corrupt compressed WebSocket frames; disable compression
        perMessageDeflate: false,
        // Don't use cookies for session tracking — reverse proxies may strip them
        // between the GET handshake and POST data, causing UNKNOWN_SID (400)
        cookie: false,
        // Express 5 compatibility — prevent trailing slash redirect on /socket.io
        addTrailingSlash: false,
        // Allow both transports; prefer websocket (persistent conn = no sticky sessions needed)
        transports: ['websocket', 'polling'],
        // Increase timeouts for Cloudflare proxy latency
        pingTimeout: 60000,
        pingInterval: 25000,
        // Allow Engine.IO v3 clients as fallback
        allowEIO3: true,
        // Increase buffer size for large payloads
        maxHttpBufferSize: 1e6,
        // Connection state recovery — reconnecting clients reuse their session
        connectionStateRecovery: {
            maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        }
    });

    // ── JWT Authentication Middleware ──
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        console.log(`🔌 [Socket.IO] Connection attempt from socket ${socket.id}. Token present: ${!!token}`);

        if (!token) {
            console.warn(`❌ [Socket.IO] Authentication failed: No token provided for socket ${socket.id}`);
            return next(new Error('Authentication required'));
        }

        try {
            const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
            const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
            const userId = decoded.userId || decoded.id;

            // ⚠️ jwt.verify only proves the token was signed by us and hasn't hit
            // its own exp. The REST layer additionally enforces session revocation
            // and the absolute session cap; without the same checks here a revoked
            // token would lose API access but keep this real-time channel open —
            // which streams WhatsApp messages, email, and support conversations.
            if (decoded.absExp && Math.floor(Date.now() / 1000) > decoded.absExp) {
                console.warn(`❌ [Socket.IO] Rejected socket ${socket.id}: session past absolute cap`);
                return next(new Error('Session expired'));
            }

            const User = require('../models/User');
            // `parentId` is selected here so the join:company guard below can be
            // built from server-resolved state. It MUST come from the database:
            // reading it off the socket (or the token) leaves it undefined, and an
            // undefined value in a query filter is dropped by BSON rather than
            // matching nothing — which silently turns the guard into a no-op.
            const userDoc = await User.findById(userId).select('tokenVersion is_active parentId role').lean();
            if (!userDoc) {
                console.warn(`❌ [Socket.IO] Rejected socket ${socket.id}: user no longer exists`);
                return next(new Error('Account no longer exists'));
            }
            if (userDoc.is_active === false) {
                console.warn(`❌ [Socket.IO] Rejected socket ${socket.id}: account deactivated`);
                return next(new Error('Account deactivated'));
            }
            if ((decoded.tv || 0) !== (userDoc.tokenVersion || 0)) {
                console.warn(`❌ [Socket.IO] Rejected socket ${socket.id}: session revoked`);
                return next(new Error('Session revoked'));
            }

            // BUG-10 FIX: WebSocket channels not subscription-gated.
            // If the workspace is expired, do not allow real-time channels (which stream
            // premium features like WhatsApp/Emails) to remain open.
            const WorkspaceSettings = require('../models/WorkspaceSettings');
            const tenantId = userDoc.role === 'agent' ? userDoc.parentId : userDoc._id;
            // Agencies and SuperAdmins don't have workspaces in the same way, or they are lifetime free.
            if (userDoc.role === 'manager' || userDoc.role === 'agent') {
                const ws = await WorkspaceSettings.findOne({ userId: tenantId }).select('planExpiryDate').lean();
                if (ws?.planExpiryDate) {
                    const expiry = new Date(ws.planExpiryDate).getTime();
                    if (Date.now() > expiry) {
                        console.warn(`❌ [Socket.IO] Rejected socket ${socket.id}: workspace subscription expired`);
                        return next(new Error('subscription_required'));
                    }
                }
            }

            socket.userId = userId;
            socket.userRole = decoded.role;
            // Normalized to a string id or null — never undefined. The join guard
            // relies on this distinction.
            socket.parentId = userDoc.parentId ? String(userDoc.parentId) : null;
            console.log(`✅ [Socket.IO] Authentication successful for user: ${socket.userId}`);
            next();
        } catch (err) {
            console.warn(`❌ [Socket.IO] Authentication failed for socket ${socket.id}: ${err.message}`);
            return next(new Error('Invalid or expired token'));
        }
    });

    // ── Connection Handler ──
    io.on('connection', (socket) => {
        const userId = socket.userId;
        console.log(`🔌 Socket connected: user=${userId}, socketId=${socket.id}`);

        // Join user to their private room (tenant isolation)
        socket.join(`user:${userId}`);

        // If the user is an agent, also join their parent's room
        // so managers can see agent activity and vice versa
        // This is handled lazily — the frontend sends a join request
        // ⚠️ SECURITY: Validate ownership before joining company rooms.
        // Previously any user could join ANY user's room by sending arbitrary IDs.
        // ⚠️ SECURITY: `socket.parentId` was previously never assigned, so the
        // "parent manager" branch below was `{ _id: undefined }`. BSON DROPS an
        // undefined value rather than serializing it, so that branch reached Mongo
        // as an empty predicate `{}` — which matches every document. The $or was
        // therefore always satisfied and the whole query collapsed to
        // `User.find({ _id: { $in: companyUserIds } })`: any id the client sent was
        // accepted, letting any tenant join any other tenant's room and receive
        // their live WhatsApp/email/lead/notification stream.
        //
        // The branches are now assembled from server-resolved state and only ever
        // contain defined values. Anything not provably in the caller's own company
        // tree is rejected and logged.
        socket.on('join:company', async (companyUserIds) => {
            if (!Array.isArray(companyUserIds) || companyUserIds.length === 0) return;
            // Bound the request so one client can't ask us to resolve a huge set.
            if (companyUserIds.length > 200) {
                console.warn(`🛑 [Socket.IO] join:company rejected for ${userId}: oversized request (${companyUserIds.length})`);
                return;
            }

            try {
                const User = require('../models/User');

                // Reject anything that isn't a well-formed ObjectId before it can
                // reach the query layer (also blocks operator-injection probes such
                // as { $ne: null }, which are objects and fail this test).
                const requestedIds = companyUserIds
                    .filter(id => typeof id === 'string' || typeof id === 'object')
                    .map(id => String(id))
                    .filter(id => /^[a-f\d]{24}$/i.test(id));
                if (requestedIds.length === 0) return;

                // Allowed relationships, built WITHOUT any possibly-undefined value:
                //   1. self
                //   2. direct children (agents under this manager)
                //   3. the caller's own parent manager — only when one actually exists
                const branches = [
                    { _id: userId },
                    { parentId: userId }
                ];
                if (socket.parentId) {
                    branches.push({ _id: socket.parentId });
                }

                const validUsers = await User.find({
                    _id: { $in: requestedIds },
                    $or: branches
                }).select('_id').lean();

                const validIds = new Set(validUsers.map(u => String(u._id)));
                for (const id of requestedIds) {
                    if (validIds.has(id)) {
                        socket.join(`user:${id}`);
                    } else {
                        console.warn(`🛑 [Socket.IO] Denied room join: user ${userId} -> user:${id}`);
                    }
                }
            } catch (err) {
                console.error('Socket join:company error:', err.message);
            }
        });

        // Client can request to watch a specific conversation
        // 🔴 BUG FIX: Validate ownership — prevent cross-tenant conversation spying
        socket.on('watch:conversation', async (conversationId) => {
            try {
                if (!conversationId) return;
                const WhatsAppConversation = require('../models/WhatsAppConversation');
                const { getCompanyUserIds } = require('../utils/whatsappUtils');
                const companyUserIds = await getCompanyUserIds(userId);
                const owns = await WhatsAppConversation.exists({
                    _id: conversationId,
                    userId: { $in: companyUserIds }
                });
                if (owns) {
                    socket.join(`conversation:${conversationId}`);
                }
            } catch (err) {
                console.error('watch:conversation auth error:', err.message);
            }
        });

        socket.on('unwatch:conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
        });

        socket.on('disconnect', (reason) => {
            console.log(`🔌 Socket disconnected: user=${userId}, reason=${reason}`);
        });
    });

    // ── Log Engine Connection Errors (Diagnostic) ──
    io.engine.on("connection_error", (err) => {
        console.warn(`⚠️ [Socket.IO] Engine connection error: code=${err.code}, message="${err.message}", req=${err.req?.method} ${err.req?.url}`);
    });

    console.log('✅ Socket.IO initialized — real-time messaging ready');
    return io;
};

/**
 * Get the Socket.IO server instance.
 * Returns null if not initialized (graceful degradation).
 */
const getIO = () => io;

/**
 * Emit an event to all sockets belonging to a specific user.
 * Safe to call even if Socket.IO is not initialized.
 * 
 * @param {string} userId - The target user's MongoDB _id
 * @param {string} event - Event name (e.g. 'whatsapp:newMessage')
 * @param {object} data - The payload to send
 */
const emitToUser = (userId, event, data) => {
    if (!io) return; // Graceful degradation if Socket.IO not initialized
    io.to(`user:${userId}`).emit(event, data);
};

/**
 * Emit an event to every user in a company (manager + agents) so a shared inbox
 * updates live for the whole team, not just the acting user.
 *
 * @param {Array<string|ObjectId>} userIds - company user ids
 * @param {string} event
 * @param {object} data
 */
const emitToUsers = (userIds, event, data) => {
    if (!io || !Array.isArray(userIds)) return;
    for (const uid of userIds) io.to(`user:${String(uid)}`).emit(event, data);
};

/**
 * Emit an event to all sockets watching a specific conversation.
 * 
 * @param {string} conversationId - The conversation's MongoDB _id
 * @param {string} event - Event name
 * @param {object} data - The payload
 */
const emitToConversation = (conversationId, event, data) => {
    if (!io) return;
    io.to(`conversation:${conversationId}`).emit(event, data);
};

module.exports = { initSocket, getIO, emitToUser, emitToUsers, emitToConversation };
