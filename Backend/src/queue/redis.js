// Production-ready Redis client with:
// - Lazy connection (connects only when needed)
// - TLS support for hosted Redis (Upstash, etc.)
// - Startup health check
// - Graceful shutdown
// - BullMQ compatibility (maxRetriesPerRequest: null)
// - Configurable per environment

const dotenv = require('dotenv');
dotenv.config();

const logger = require('../utils/logger');
const isProduction = process.env.NODE_ENV === 'production';
const useMock = process.env.USE_MOCK_REDIS === 'true';

// If mock mode, use ioredis-mock entirely
if (useMock) {
  try {
    const mockRedis = require('ioredis-mock');
    const redis = new mockRedis();
    
    async function checkRedisHealth() {
      logger.info('Redis health check passed (mock mode)');
      return true;
    }
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down mock Redis...');
      try { await redis.quit(); } catch (e) { /* ignore */ }
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      logger.info('Shutting down mock Redis...');
      try { await redis.quit(); } catch (e) { /* ignore */ }
      process.exit(0);
    });
    
    module.exports = { redis, checkRedisHealth };
    return;
  } catch (e) {
    console.warn('ioredis-mock not available, using real Redis');
  }
}

// Real Redis for production
let redis;

if (process.env.REDIS_URL) {
  // REDIS_URL takes priority - supports both redis:// and rediss:// (TLS)
  // rediss:// automatically enables TLS for Upstash and similar managed Redis
  const Redis = require('ioredis');
  
  logger.info('Connecting to Redis via REDIS_URL', { url: process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@') });
  
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requirement
    retryStrategy: times => {
      if (times > 20) return null;
      return Math.min(times * 100, 5000);
    },
    connectTimeout: 10000,
    lazyConnect: true
  });
} else if (isProduction) {
  // Production without REDIS_URL - exit with error
  logger.error('REDIS_URL is required in production');
  process.exit(1);
} else {
  // Development mode - localhost fallback
  const Redis = require('ioredis');
  
  logger.warn('No REDIS_URL set, falling back to localhost:6379 (dev only)');
  
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // BullMQ requirement
    retryStrategy: times => {
      if (times > 20) return null;
      return Math.min(times * 100, 5000);
    },
    connectTimeout: 5000,
    lazyConnect: true
  });
}

// Event handlers
let isConnected = false;

redis.on('connect', () => {
  isConnected = true;
  logger.info('Redis connected successfully');
});

redis.on('ready', () => {
  logger.info('Redis ready (authenticated & usable)');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

// Startup health check
async function checkRedisHealth() {
  try {
    // Only call connect if not already connected
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.ping();
    logger.info('Redis health check passed (PING OK)');
    return true;
  } catch (err) {
    logger.error('Redis health check FAILED', { error: err.message });
    if (isProduction) {
      process.exit(1);
    }
    logger.warn('Redis unavailable in dev mode — continuing without queue features');
    return false;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down Redis connection...');
  try { await redis.quit(); } catch (e) { /* ignore */ }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Interrupted – shutting down Redis');
  try { await redis.quit(); } catch (e) { /* ignore */ }
  process.exit(0);
});

module.exports = {
  redis,
  checkRedisHealth
};