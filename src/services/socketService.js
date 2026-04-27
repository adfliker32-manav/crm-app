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
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
                    return callback(null, true);
                }
                callback(new Error('Not allowed by CORS'));
            },
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling']
    });

    // ── JWT Authentication Middleware ──
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) {
            return next(new Error('Authentication required'));
        }

        try {
            const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
            const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
            socket.userId = decoded.userId || decoded.id;
            socket.userRole = decoded.role;
            next();
        } catch (err) {
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

module.exports = { initSocket, getIO, emitToUser, emitToConversation };
