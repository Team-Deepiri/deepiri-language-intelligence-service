import http from 'http';
import { Server } from 'socket.io';
import { logger } from '../utils/logger';

let io: Server | null = null;

export function initializeSocket(server: http.Server): void {
    io = new Server(server, {
        cors: {
            origin: [
                'http://localhost:5173',
                'http://localhost:3000',
                'http://127.0.0.1:5173',
            ],
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        },
    });

    io.on('connection', (socket) => {
        logger.info('Socket.IO client connected', { socketId: socket.id });

        socket.on('disconnect', (reason) => {
            logger.info('Socket.IO client disconnected', {
                socketId: socket.id,
                reason,
            });
        });
    });
}

export function broadcastEvent(eventName: string, payload: unknown): void {
    if (!io) {
        logger.warn('Socket.IO not initialized, skipping broadcast', { eventName });
        return;
    }

    io.emit(eventName, payload);
}
