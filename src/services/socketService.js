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
    io = new Server(httpServer, {
        cors: {
            origin: '*', // Matches existing Express CORS config
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'] // Prefer WebSocket, fallback to polling
    });

    // ── JWT Authentication Middleware ──
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) {
            return next(new Error('Authentication required'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
        socket.on('join:company', (companyUserIds) => {
            if (Array.isArray(companyUserIds)) {
                companyUserIds.forEach(id => {
                    socket.join(`user:${id}`);
                });
                console.log(`   📂 Socket ${socket.id} joined ${companyUserIds.length} company rooms`);
            }
        });

        // Client can request to watch a specific conversation
        socket.on('watch:conversation', (conversationId) => {
            socket.join(`conversation:${conversationId}`);
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
