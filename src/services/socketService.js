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
    const allowedOrigins = [
        process.env.FRONTEND_URL,
        'http://localhost:5173',
        'http://localhost:3000'
    ].filter(Boolean);

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
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        console.log(`🔌 [Socket.IO] Connection attempt from socket ${socket.id}. Token present: ${!!token}`);
        
        if (!token) {
            console.warn(`❌ [Socket.IO] Authentication failed: No token provided for socket ${socket.id}`);
            return next(new Error('Authentication required'));
        }

        try {
            const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
            const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
            socket.userId = decoded.userId || decoded.id;
            socket.userRole = decoded.role;
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
        socket.on('join:company', async (companyUserIds) => {
            if (!Array.isArray(companyUserIds)) return;
            try {
                const User = require('../models/User');
                // Only allow joining rooms of users that belong to your company
                const validUsers = await User.find({
                    _id: { $in: companyUserIds },
                    $or: [
                        { _id: userId },           // Self
                        { parentId: userId },       // Direct children (agents under this manager)
                        { _id: socket.parentId }    // Parent manager
                    ]
                }).select('_id').lean();
                
                const validIds = new Set(validUsers.map(u => u._id.toString()));
                companyUserIds.forEach(id => {
                    if (validIds.has(id.toString())) {
                        socket.join(`user:${id}`);
                    }
                });
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
