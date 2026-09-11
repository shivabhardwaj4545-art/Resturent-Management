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

    socket.on('join:user', (targetUserId: string) => {
      void socket.join(`user:${targetUserId}`);
      logger.debug(`Socket ${socket.id} joined user:${targetUserId}`);
    });

    // Join restaurant room (for restaurant owners & customers)
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

    // Join table room (for customer on specific table)
    socket.on('join:table', (data: { restaurantId: string; tableNumber: string }) => {
      const { restaurantId, tableNumber } = data;
      if (restaurantId && tableNumber) {
        const roomName = `table:${restaurantId}:${String(tableNumber).trim()}`;
        void socket.join(roomName);
        logger.debug(`Socket ${socket.id} joined ${roomName}`);
      }
    });

    // Customer calls for waiter — re-emit to restaurant owner room
    socket.on('waiter:call', (data: { restaurantId: string; tableNumber: string }) => {
      const { restaurantId, tableNumber } = data;
      logger.info(`Waiter called for restaurant ${restaurantId}, table ${tableNumber}`);
      const payload = {
        tableNumber,
        restaurantId,
        calledAt: new Date().toISOString(),
      };
      io.to(`restaurant:${restaurantId}`).emit('waiter:called', payload);
      io.to(`restaurant:${restaurantId}`).emit('waiter_called', payload);
    });

    // Owner responds to waiter call — notify customer on specific table ONLY
    socket.on('waiter:respond', (data: { restaurantId: string; tableNumber: string }) => {
      const { restaurantId, tableNumber } = data;
      const cleanTable = String(tableNumber).trim();
      logger.info(`Owner sent waiter for restaurant ${restaurantId}, table ${cleanTable}`);
      const payload = {
        tableNumber: cleanTable,
        restaurantId,
        message: `Waiter is coming in a few minutes to Table ${cleanTable}`,
        timestamp: new Date().toISOString(),
      };
      io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter:responded', payload);
      io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter_responded', payload);
      io.to(`restaurant:${restaurantId}`).emit('waiter:responded', payload);
      io.to(`restaurant:${restaurantId}`).emit('waiter_responded', payload);
    });

    // Owner dismisses waiter call — notify customer on specific table ONLY
    socket.on('waiter:dismiss', (data: { restaurantId: string; tableNumber: string }) => {
      const { restaurantId, tableNumber } = data;
      const cleanTable = String(tableNumber).trim();
      logger.info(`Owner dismissed waiter call for restaurant ${restaurantId}, table ${cleanTable}`);
      const payload = {
        tableNumber: cleanTable,
        restaurantId,
        message: `Waiter is busy right now. You can retry after a few minutes.`,
        timestamp: new Date().toISOString(),
      };
      io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter:dismissed', payload);
      io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter_dismissed', payload);
      io.to(`restaurant:${restaurantId}`).emit('waiter:dismissed', payload);
      io.to(`restaurant:${restaurantId}`).emit('waiter_dismissed', payload);
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
  addOnStatus?: string | null;
  lastAddOnAt?: Date | string | null;
  paymentStatus?: string;
  updatedAt: string;
  estimatedTime?: number;
  driverId?: string;
  driverName?: string;
  paidAt?: string;
}): void {
  if (!io) return;
  io.to(`order:${orderId}`).emit('order:status_updated', data);
  io.to(`order:${orderId}`).emit('order_status_changed', data);
  io.to(`restaurant:${restaurantId}`).emit('order:status_updated', data);
  io.to(`restaurant:${restaurantId}`).emit('order_status_changed', data);

  if (data.status === 'CANCELLED') {
    io.to(`order:${orderId}`).emit('order_cancelled', data);
    io.to(`restaurant:${restaurantId}`).emit('order_cancelled', data);
  }

  if (data.driverId || data.status === 'ON_THE_WAY') {
    io.to(`order:${orderId}`).emit('driver_assigned', data);
    io.to(`restaurant:${restaurantId}`).emit('driver_assigned', data);
  }
}

// Emit new order to restaurant
export function emitNewOrder(restaurantId: string, order: unknown): void {
  if (!io) return;
  io.to(`restaurant:${restaurantId}`).emit('order:new', order);
  io.to(`restaurant:${restaurantId}`).emit('new_order', order);
  io.to(`restaurant:${restaurantId}`).emit('kitchen:new_order', order);
  io.to(`restaurant:${restaurantId}`).emit('notification:new', {
    type: 'NEW_ORDER',
    title: '🛍️ New Order Received!',
    message: 'A new order has been placed.',
    data: order,
  });
}

// Emit notification to user
export function emitNotification(userId: string, notification: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit('notification:new', notification);
}

// Emit loyalty update to user
export function emitUserLoyaltyUpdate(userId: string, points: number): void {
  if (!io) return;
  io.to(`user:${userId}`).emit('user:loyalty_updated', { userId, points });
}

// Emit waiter call notification to restaurant
export function emitWaiterCall(
  restaurantId: string,
  tableNumber: string,
  type: 'default' | 'payment' | 'addons' = 'default',
  amount?: number,
  paymentMethod?: string,
  itemsSummary?: string
): void {
  if (!io) return;
  const payload = {
    tableNumber,
    restaurantId,
    calledAt: new Date().toISOString(),
    type,
    amount,
    paymentMethod,
    itemsSummary,
  };
  io.to(`restaurant:${restaurantId}`).emit('waiter:called', payload);
  io.to(`restaurant:${restaurantId}`).emit('waiter_called', payload);
  io.to(`restaurant:${restaurantId}`).emit('notification:new', {
    type: 'WAITER_CALL',
    title: `🔔 Waiter Call - Table ${tableNumber}`,
    message: `Table ${tableNumber} requested assistance.`,
    data: payload,
  });
}

export function emitWaiterResponse(restaurantId: string, tableNumber: string): void {
  if (!io) return;
  const cleanTable = String(tableNumber).trim();
  const payload = {
    tableNumber: cleanTable,
    restaurantId,
    message: `Waiter is coming to Table ${cleanTable}`,
    timestamp: new Date().toISOString(),
  };
  io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter:responded', payload);
  io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter_responded', payload);
  io.to(`restaurant:${restaurantId}`).emit('waiter:responded', payload);
  io.to(`restaurant:${restaurantId}`).emit('waiter_responded', payload);
}

export function emitWaiterDismiss(restaurantId: string, tableNumber: string): void {
  if (!io) return;
  const cleanTable = String(tableNumber).trim();
  const payload = {
    tableNumber: cleanTable,
    restaurantId,
    message: `Waiter is occupied right now. You can try again in 30 seconds.`,
    timestamp: new Date().toISOString(),
  };
  io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter:dismissed', payload);
  io.to(`table:${restaurantId}:${cleanTable}`).emit('waiter_dismissed', payload);
  io.to(`restaurant:${restaurantId}`).emit('waiter:dismissed', payload);
  io.to(`restaurant:${restaurantId}`).emit('waiter_dismissed', payload);
}

export function emitPaymentNotReceived(orderId: string, amount: number): void {
  if (!io) return;
  io.to(`order:${orderId}`).emit('payment:not_received', {
    orderId,
    amount,
    message: 'Payment Not Received',
    timestamp: new Date().toISOString(),
  });
}

export function getSocketIO(): SocketIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
