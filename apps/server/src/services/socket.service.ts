import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

let io: SocketIOServer;

export function initializeSocketService(socketServer: SocketIOServer): void {
  io = socketServer;

  io.use((socket, next) => {
    // Authenticate socket connection (optional - allows guest connections)
    const token = socket.handshake.auth.token as string | undefined;
    if (token) {
      try {
        const secret = process.env.JWT_ACCESS_SECRET ?? '';
        const decoded = jwt.verify(token, secret) as {
          id: string;
          email: string;
          role: string;
        };
        (socket as Socket & { userId?: string }).userId = decoded.id;
        (socket as Socket & { userRole?: string }).userRole = decoded.role;
      } catch {
        // Invalid token — allow as guest
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket as Socket & { userId?: string }).userId;
    logger.info(`Socket connected: ${socket.id}${userId ? ` (user: ${userId})` : ' (guest)'}`);

    // Join personal user room
    if (userId) {
      void socket.join(`user:${userId}`);
    }

    // Join restaurant room (for restaurant owners)
    socket.on('join:restaurant', (restaurantId: string) => {
      void socket.join(`restaurant:${restaurantId}`);
      logger.debug(`Socket ${socket.id} joined restaurant:${restaurantId}`);
    });

    // Join order tracking room
    socket.on('join:order', (orderId: string) => {
      void socket.join(`order:${orderId}`);
      logger.debug(`Socket ${socket.id} joined order:${orderId}`);
    });

    socket.on('leave:order', (orderId: string) => {
      void socket.leave(`order:${orderId}`);
    });

    // Customer calls for waiter — re-emit to restaurant owner room
    socket.on('waiter:call', (data: { restaurantId: string; tableNumber: string }) => {
      const { restaurantId, tableNumber } = data;
      logger.info(`Waiter called for restaurant ${restaurantId}, table ${tableNumber}`);
      io.to(`restaurant:${restaurantId}`).emit('waiter:called', {
        tableNumber,
        restaurantId,
        calledAt: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}

// Emit order status update to all listeners of this order
export function emitOrderStatusUpdate(orderId: string, restaurantId: string, data: {
  orderId: string;
  status?: string;
  paymentStatus?: string;
  updatedAt: string;
  estimatedTime?: number;
}): void {
  if (!io) return;
  io.to(`order:${orderId}`).emit('order:status_updated', data);
  io.to(`restaurant:${restaurantId}`).emit('order:status_updated', data);
}

// Emit new order to restaurant
export function emitNewOrder(restaurantId: string, order: unknown): void {
  if (!io) return;
  io.to(`restaurant:${restaurantId}`).emit('order:new', order);
}

// Emit notification to user
export function emitNotification(userId: string, notification: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit('notification:new', notification);
}

// Emit waiter call notification to restaurant
export function emitWaiterCall(restaurantId: string, tableNumber: string, type: 'default' | 'payment' = 'default', amount?: number): void {
  if (!io) return;
  io.to(`restaurant:${restaurantId}`).emit('waiter:called', {
    tableNumber,
    restaurantId,
    calledAt: new Date().toISOString(),
    type,
    amount,
  });
}

export function getSocketIO(): SocketIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
