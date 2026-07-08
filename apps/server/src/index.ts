import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app, { allowedOrigins } from './app';
import { initializeSocketService } from './services/socket.service';
import { logger } from './utils/logger';
import { connectRedis, isRedisReady } from './services/redis.service';
import { prisma } from './lib/prisma';

// Gracefully handle Redis disconnections / connection failures in production without crashing the process
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'Connection is closed.' || reason?.code === 'ECONNREFUSED') {
    logger.warn(`Redis: connection issue captured gracefully: ${reason.message}`);
    return;
  }
  logger.error('Unhandled Rejection at:', reason);
});

process.on('uncaughtException', (error: any) => {
  if (error?.message === 'Connection is closed.' || error?.code === 'ECONNREFUSED') {
    logger.warn(`Redis: uncaught socket connection exception captured gracefully: ${error.message}`);
    return;
  }
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

const PORT = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  try {
    // Test DB connection with retry loop
    let dbConnected = false;
    const isDev = process.env.NODE_ENV !== 'production';
    let retries = isDev ? 100 : 5; // Retry up to 100 times (~3.3 minutes) in dev to allow postgres container to boot
    while (retries > 0 && !dbConnected) {
      try {
        await prisma.$connect();
        dbConnected = true;
        logger.info('✅ Database connected');
      } catch (err) {
        retries--;
        if (retries === 0) {
          logger.error('❌ Database connection failed after maximum retries.');
          throw err;
        }
        logger.warn(`⚠️ Database connection failed. Retrying in 2 seconds... (${retries} retries remaining)`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Connect Redis
    await connectRedis();
    if (isRedisReady()) {
      logger.info('✅ Redis connected');
    } else {
      logger.warn('⚠️ Redis connection failed. Operating with in-memory fallback cache and rate limiter.');
    }

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.io
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          const normalizedOrigin = origin.replace(/\/$/, '');
          if (
            allowedOrigins.includes(normalizedOrigin) ||
            normalizedOrigin.endsWith('.up.railway.app') ||
            normalizedOrigin.endsWith('.onrender.com') ||
            process.env.NODE_ENV !== 'production'
          ) {
            return callback(null, true);
          }
          callback(new Error('CORS: origin not allowed by Socket.io'));
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    initializeSocketService(io);
    logger.info('✅ Socket.io initialized');

    // Start server
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`📚 API docs: http://localhost:${PORT}/api-docs`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);
      await prisma.$disconnect();
      httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap(); // Trigger reload
