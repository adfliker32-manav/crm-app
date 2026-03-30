// ============================================================
// 🔌 useSocket — React hook for Socket.IO real-time connection
// ============================================================
// Singleton pattern: all components share one WebSocket connection.
// Authenticates with JWT from localStorage.
// Auto-reconnects on disconnect.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Singleton socket instance — shared across all hook consumers
let socketInstance = null;
let refCount = 0;

const getSocketUrl = () => {
    // In dev, connect to the backend server directly
    if (import.meta.env.DEV) {
        return import.meta.env.VITE_API_URL
            ? import.meta.env.VITE_API_URL.replace('/api', '')
            : 'http://localhost:5000';
    }
    // In production, same origin (Socket.IO auto-detects)
    return undefined;
};

const useSocket = () => {
    const [isConnected, setIsConnected] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        refCount++;

        if (!socketInstance) {
            const token = localStorage.getItem('token');
            if (!token) {
                console.warn('🔌 Socket: No auth token found, skipping connection');
                return;
            }

            const url = getSocketUrl();
            socketInstance = io(url, {
                auth: { token },
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 10000,
                timeout: 20000,
                autoConnect: true
            });

            socketInstance.on('connect', () => {
                console.log('🔌 Socket.IO connected:', socketInstance.id);
                setIsConnected(true);
            });

            socketInstance.on('disconnect', (reason) => {
                console.log('🔌 Socket.IO disconnected:', reason);
                if (mountedRef.current) setIsConnected(false);
            });

            socketInstance.on('connect_error', (err) => {
                console.warn('🔌 Socket.IO connection error:', err.message);
                if (mountedRef.current) setIsConnected(false);
            });
        } else {
            // Re-using existing connection, sync state
            setIsConnected(socketInstance.connected);
        }

        return () => {
            mountedRef.current = false;
            refCount--;

            // Only disconnect when ALL consumers have unmounted
            if (refCount <= 0 && socketInstance) {
                console.log('🔌 Socket.IO: All consumers unmounted, disconnecting');
                socketInstance.disconnect();
                socketInstance = null;
                refCount = 0;
            }
        };
    }, []);

    return { socket: socketInstance, isConnected };
};

export default useSocket;
