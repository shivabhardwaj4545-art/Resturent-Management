import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app, { allowedOrigins } from './app';
import { initializeSocketService } from './services/socket.service';
import { logger } from './utils/logger';
import { connectRedis, isRedisReady } from './services/redis.service';
import { prisma } from './lib/prisma';

import { ensureDatabaseSeeded } from './utils/autoSeed';
import { startKeepAliveJob } from './jobs/keepAlive.job';

// Gracefully handle background disconnections / uncaught exceptions in production without crashing the server process
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection captured gracefully:', reason?.message || reason);
});

process.on('uncaughtException', (error: any) => {
  logger.error('Uncaught Exception captured gracefully:', error?.stack || error?.message || error);
});

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOST = '0.0.0.0';

async function bootstrap() {
  try {
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
            normalizedOrigin.startsWith('http://localhost:') ||
            normalizedOrigin.startsWith('http://127.0.0.1:') ||
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

    // Start server immediately on 0.0.0.0 so Render's port scanner passes instantly
    httpServer.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
      logger.info(`📚 API docs: http://${HOST}:${PORT}/api-docs`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
      startKeepAliveJob();
    });

    // Initialize database & redis in parallel after server is already listening
    initializeBackgroundServices().catch((err) => {
      logger.error('Error during background services initialization:', err);
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

async function initializeBackgroundServices() {
  // Test DB connection with retry loop
  let dbConnected = false;
  const isDev = process.env.NODE_ENV !== 'production';
  let retries = isDev ? 100 : 5; // Retry up to 100 times in dev to allow postgres container to boot
  while (retries > 0 && !dbConnected) {
    try {
      await prisma.$connect();
      dbConnected = true;
      logger.info('✅ Database connected');
      // Auto-ensure default live credentials & demo restaurant exist
      await ensureDatabaseSeeded();
    } catch (err) {
      retries--;
      if (retries === 0) {
        logger.error('❌ Database connection failed after maximum retries.');
        break;
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
}

bootstrap();


